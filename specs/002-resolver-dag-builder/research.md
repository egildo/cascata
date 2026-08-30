# Phase 0 Research: Resolver & DAG Builder

**Date**: 2026-08-30 | **Plan**: [plan.md](./plan.md)

Conducted under constitution v1.1.0's **probe gate**: a conclusion that a dependency handles
something "for free" must have been exercised against non-ASCII, boundary, and adversarial input
before it is written down. That gate was added because v0.1's Phase 0 recorded two such conclusions
from an ASCII-only probe and both were wrong.

It justified itself on first use. The headline finding below would otherwise have reached
implementation as a hash collision in a security primitive.

## Probe results

| Question | Probe | Result |
|---|---|---|
| Can RFC 8785 (JCS) canonicalize this model? | 23-digit integer; `2` vs `2.0`; astral-character keys | **No — see D1.** `JSON.stringify` throws on a bigint; `Number(12345678901234567890123n)` is lossy and does not round-trip; `2` and `2.0` both serialize to `2` |
| Is SHA-256 available without a dependency? | `node:crypto` | **Yes.** Also `webcrypto.subtle`. 8 MiB — the size cap — hashes in **3.9ms** |
| Is BLAKE3 available without a dependency? | `crypto.getHashes()` | **No.** `blake2b512` and `blake2s256` are built in; BLAKE3 is not, and measured 8.4ms for BLAKE2b vs 3.9ms for SHA-256, since OpenSSL accelerates SHA-2 |
| Does Node's `fetch` cache per RFC 9111? | `Request.cache` | **No.** The property exists and reports a mode, but no HTTP cache is implemented. Caching is ours to build |
| Can an HTTPS→HTTP redirect be refused? | `redirect: 'manual' \| 'error' \| 'follow'` | **Yes** — all three modes honoured, so each hop can be inspected before it is followed |
| Can a hung fetch be bounded? | `AbortSignal.timeout` | **Yes**, built in |
| Can a scheme be rejected before any request? | WHATWG `URL` on `https:`/`http:`/`file:`/`data:` | **Yes** — `protocol` is available from parsing alone |

## Decisions

### D1 — A pin hashes the exact bytes, not a canonical form (amends `SPEC.md` §6.1)

**Decision**: `$pin` is SHA-256 over the document's exact bytes. RFC 8785 is withdrawn from the
design.

**Rationale**: JCS cannot express this model, in two independent ways. It serializes numbers as
ECMAScript `Number::toString` — IEEE-754 doubles — so an exact integer beyond that range, which §4.2
guarantees and v0.1 implements as `bigint`, is unrepresentable. And `2` (int) and `2.0` (float),
which §4.2 holds to be *different values that are not equal*, serialize identically. A canonicalizer
that maps unequal values to the same bytes produces hash collisions by construction, which in a
pinning mechanism means two different documents can satisfy the same pin. Raw bytes are faithful by
definition, need no canonicalizer, and follow W3C Subresource Integrity literally rather than by
analogy — §12 already cited SRI as the pattern.

**Cost accepted**: a pin names one artifact byte-for-byte. Reformatting a published schema breaks
its pin, and the same document expressed in another format hashes differently. This is the correct
reading: a pin is an integrity check on a fetch, not a statement about meaning.

**Alternatives considered**: defining a Cascata-specific canonical form preserving int/float and
arbitrary-precision integers (rejected — §2.8 puts originality at the core and conformance at the
membrane, and canonicalization is squarely at the membrane; it is also crypto-adjacent code where
subtle bugs are worst); keeping JCS and refusing to pin documents it cannot represent (rejected —
makes a core §4.2 guarantee and the security model mutually exclusive).

**Status**: `SPEC.md` §6.1, §11, §12, §14 amended and logged in §15 before this plan was written.

### D2 — SHA-256, not BLAKE3

**Decision**: SHA-256 via `node:crypto`.

**Rationale**: BLAKE3 is not in Node, so it costs a runtime dependency and an amendment to the
frozen dependency list, and it breaks two §12 citations — FIPS 180-4, and W3C SRI, whose allowed set
is sha256/384/512 only. Its advantage is speed, which the probe shows is immaterial here: 3.9ms for
the largest document the size cap permits, on a handful of documents per resolution. BLAKE2b, which
*is* built in and has RFC 7693, measured slower than SHA-256 because OpenSSL accelerates SHA-2.

**Alternatives considered**: BLAKE3 (rejected on the above); BLAKE2b (rejected — no dependency cost,
but loses the SRI citation and is slower here, so it buys nothing).

### D3 — Implement a named subset of RFC 9111

**Decision**: Implement freshness lifetime (`Cache-Control: max-age`, `immutable`, `Expires`),
revalidation (`ETag`/`If-None-Match`, `Last-Modified`/`If-Modified-Since`), and the `no-store` /
`no-cache` directives. Explicitly **not** implemented: `Vary` negotiation, range requests, shared
proxy semantics, stale-while-revalidate.

**Rationale**: Cascata fetches immutable, content-addressed schema documents over HTTPS from a
single client cache. The excluded machinery governs shared caches and content negotiation, neither
of which any code path here can reach. Writing untestable branches is a liability, not conformance.
Recorded in Complexity Tracking as a deviation from §2.8 rather than left implicit.

**Alternatives considered**: full RFC 9111 (rejected — unreachable branches); an off-the-shelf HTTP
cache (rejected — runtime dependency plus amendment); no caching (rejected — FR-016 requires offline
resolution of a previously resolved chain).

### D4 — Redirects are followed manually, one hop at a time

**Decision**: Fetch with `redirect: 'manual'`, inspect each `Location`, and refuse any hop whose
scheme is not HTTPS. A redirect limit applies.

**Rationale**: FR-013 refuses non-HTTPS references, and a redirect is how that check gets bypassed
if the client follows automatically. The probe confirmed `manual` is honoured, so the downgrade is
observable rather than something to trust the runtime about.

**Alternatives considered**: `redirect: 'follow'` and checking only the final URL (rejected — the
insecure hop has already happened); `redirect: 'error'` (rejected — legitimate schema hosting moves,
and refusing all redirects is stricter than §11 requires).

### D5 — Identity is location plus content hash, and dedup happens in two stages

**Decision**: Deduplicate by *location* before fetching, so a document referenced twice is fetched
once; deduplicate by *content hash* after, so two locations serving identical bytes converge to one
graph node. Cycle detection runs on location, since it must work before bytes exist.

**Rationale**: The two questions are genuinely different. "Have I already asked for this?" must be
answerable before a fetch; "is this the same document?" can only be answered after. Doing both is
what makes FR-009 and FR-019 hold simultaneously.

**Alternatives considered**: hash-only identity (rejected — cannot prevent the duplicate fetch, and
cannot detect a cycle before it completes); location-only identity (rejected — misses that two URLs
serve the same bytes, which is the case content-hash identity exists for — though note §6.1 makes adoption single-parent, so **no diamond can arise from `$adopts` in v1**; this machinery is for delegation (v0.6) and for multi-adoption via C3 when it lands. An earlier draft of this decision cited "the diamond §6.1 wants deduped", which inverted what §6.1 actually says.)

### D6 — The sandbox is judged on the resolved target, through symlinks

**Decision**: A schema-authored local reference is resolved to a real path — following symbolic
links — and refused if the result lies outside the caller-supplied root. A config-authored reference
is exempt (FR-020).

**Rationale**: A sandbox judged on the written path is bypassed by a link inside the root pointing
out of it. The asymmetry between config- and schema-authored references is §8.1's razor: the user
writing a path is consent, a schema demanding one is not.

**Alternatives considered**: judging the lexical path (rejected — trivially bypassed); confining
config references too (rejected — makes §9's own worked example, which references `~/.config`,
illegal).

### D7 — Remote behavior is tested against recorded responses

**Decision**: A fixture format holds status, headers, and body bytes for a URL. The fetch layer is
constructed with a transport, and tests supply a recorded one.

**Rationale**: The constitution forbids network access in tests, and every property worth testing
here — pin mismatch, redirect downgrade, revalidation, offline-from-cache — needs a controlled
response. A seam at the transport is the smallest one that gives it.

**Alternatives considered**: a local HTTP server in tests (rejected — that *is* network access, and
introduces port binding and flakiness); mocking `globalThis.fetch` (rejected — global mutation,
order-dependent across parallel test files).

### D8 — The bytes entry point supersedes the text one; the text one stays, documented

**Decision**: `parse(bytes, …)` becomes primary and enforces UTF-8. `parseText(text, …)` remains for
callers holding decoded text, documented as unable to enforce FR-002.

**Rationale**: v0.1's entry point could not enforce §4.2's UTF-8 mandate — verified: invalid bytes
become U+FFFD before Cascata sees them and the document is accepted. Removing the text entry
outright would break v0.1 consumers for a property they may not need; keeping it silently would
repeat the original error. Keeping it with the limitation stated is the honest middle.

**Alternatives considered**: removing it (rejected — gratuitous break); keeping it as primary
(rejected — leaves the mandate unenforceable, which is the defect being fixed).

## Open questions carried forward

- **Cache eviction is unspecified.** The cache grows without bound. Bounding it needs a policy
  nobody has asked for yet; recorded so it is a known omission rather than an oversight.
- **A lockfile is out of scope** (§11 calls the cache "lockfile-friendly"), but it is the mechanism
  that would close the bootstrap gap in §11's pinning story — a root's demand to be adopted with a
  pin cannot protect its own first fetch.
