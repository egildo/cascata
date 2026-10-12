/**
 * The Host seam — SPEC.md Article VI (§16); v0.7 FR-022, FR-025, FR-026;
 * specs/007-sealing-and-embedding/contracts/host-api.md; research.md D1.
 *
 * The library's **only** route to local bytes, canonical identity, and
 * cache storage. Four methods, three capabilities (research.md D1):
 *
 * - `read` — bytes at a **local** location, or a refusal. Never called
 *   for an `https://` location; the network fetch stays behind
 *   `resolve/transport.ts`'s own, already-existing `Transport` seam
 *   (`SPEC.md` §15's own amendment: that half of the seam has existed
 *   since v0.2, and is not one of the three things this milestone moves).
 * - `canonicalize` — the canonical identity of a location (following
 *   symlinks, case-normalizing where the filesystem does), or `undefined`
 *   if none can be determined. **Supply, never a verdict** (§16: "the
 *   host answers *which thing is at this location*... it never answers
 *   *whether that thing is inside the sandbox*") — the library alone
 *   compares identities and reaches the confinement verdict.
 * - `cacheRead`/`cacheWrite` — an opaque byte store keyed by strings the
 *   library constructs (content hashes, hashed URLs) — the storage half
 *   of the on-disk cache (FR-025); the caching *policy* (content
 *   addressing, freshness, RFC 9111's applicable subset) stays in
 *   `resolve/cache.ts`.
 * - `list` — **optional, v1.14 FR-009** — the entries of a directory and what
 *   each is. The same law: supply, never a verdict; only `expand()` asks.
 * - `locate` — **optional, v1.4 FR-001** — the location of a reference
 *   written in a URI scheme this host owns, or `undefined` for a scheme
 *   it does not. The same law as the three above: supply, never meaning.
 *   The host says *where `beltype:document` is*; the library alone
 *   decides what to do with the answer.
 *
 * This module itself performs no I/O and imports nothing — a pure
 * interface declaration, exactly like `resolve/transport.ts`'s own
 * `Transport`. The **implementation** lives on the far side of the seam,
 * at the separate entry point `src/host/node.ts` (`createNodeHost`).
 *
 * `src/resolve/` must never import from `src/adapters/`, and (as of
 * v0.7) no module under `src/` may import `node:fs` or call `fetch`,
 * except `src/host/node.ts` — both enforced by
 * `tests/unit/layering.test.ts`.
 */
export {};
//# sourceMappingURL=host.js.map