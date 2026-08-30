# Feature Specification: Resolver & DAG Builder

**Feature Branch**: `002-resolver-dag-builder` *(spec directory; no separate git branch created)*

**Created**: 2026-08-29

**Status**: Draft

**Input**: User description: "Cascata v0.2, the second milestone of the SPEC.md §14 roadmap: the resolver and DAG builder."

**Implements**: `SPEC.md` §3 (resolve, graph build), §6.1 (`$adopts`, pedigree, `$pin`), §11 (security model), §12 (conformance map), §14 item 2.

**Builds on**: v0.1 ([001-information-model-yaml-adapter](../001-information-model-yaml-adapter/spec.md)), which turns one document's bytes into a positioned tree. v0.2 is what finds the documents.

## User Scenarios & Testing *(mandatory)*

The users are the **config author**, who writes `$schema` and expects the chain behind it to be found;
the **schema publisher**, who writes `$adopts` and expects descendants to certify against a stable
identity; and the **library consumer**, who hands Cascata an entry document and receives a graph.

### User Story 1 - Documents are read from bytes (Priority: P1)

A library consumer hands Cascata the **bytes** of a document rather than already-decoded text, and
gets back the same positioned tree v0.1 produced — or a refusal naming the exact byte where the
encoding is wrong.

**Why this priority**: Everything else in this milestone reads files and network responses, which
arrive as bytes. It is also a correction: v0.1 accepted decoded text, and at that boundary §4.2's
UTF-8 mandate is **unenforceable** — invalid byte sequences have already become replacement
characters by the time Cascata sees them, and are indistinguishable from a document that legitimately
contains those characters. This is the first milestone that touches bytes, so it is where that is
fixed.

**Independent Test**: Feed a byte sequence that is not valid UTF-8 and confirm it is refused with the
offending byte's position; feed the same document as valid UTF-8 bytes and confirm the tree matches
what v0.1 produced from the equivalent text.

**Acceptance Scenarios**:

1. **Given** bytes forming valid UTF-8, **When** read, **Then** the resulting tree is identical to
   the one produced from the same document in v0.1.
2. **Given** bytes containing an invalid UTF-8 sequence, **When** read, **Then** the document is
   refused with a diagnostic identifying the offending byte offset — not silently repaired into
   replacement characters.
3. **Given** bytes beginning with a byte-order mark, **When** read, **Then** positions are identical
   to the same document without one.
4. **Given** a caller that still supplies decoded text, **When** read, **Then** it still works, and
   the inability to check UTF-8 validity at that entry point is documented rather than implied.

---

### User Story 2 - A config's schema chain resolves into a pedigree (Priority: P2)

A config author writes `$schema` naming the schema governing their file. That schema names its own
parent with `$adopts`, which may name another, and so on. Cascata follows the chain, reads every
document in it, and produces a graph together with an **ordered pedigree** — the list of schema
identities from root to leaf — that the author can inspect to answer "what am I actually bound by?"

Adoption takes exactly one parent in v1, so the pedigree is a chain and never branches.

**Why this priority**: This is the milestone's reason for existing. Without it there is no cascade —
only isolated documents. It is also what makes `SPEC.md` §9's worked chain (published root → house
layer → config) executable rather than illustrative.

**Independent Test**: Point a config at a two-deep local schema chain and confirm the pedigree lists
all three identities in root-to-leaf order, and that each document's nodes are readable through the
graph. Requires no network.

**Acceptance Scenarios**:

1. **Given** a config whose `$schema` names a local schema that itself `$adopts` a further local
   schema, **When** resolved, **Then** all three documents are read, and the pedigree lists the **two
   schema** identities in root-to-leaf order — the config is the graph's entry, not a pedigree entry.
2. **Given** a reference written as a relative path, **When** resolved, **Then** it is interpreted
   relative to the directory of the document that **contains** the reference, not the working
   directory or the entry document.
3. **Given** a chain in which one schema is reachable by two different routes, **When** resolved,
   **Then** it is read once and appears once in the graph, matched by canonical identity rather than
   by the text of the reference.
4. **Given** a schema declaring more than one `$adopts` parent, **When** resolved, **Then** it is
   refused — v1 pedigree is a chain.
5. **Given** a resolved graph, **When** the pedigree is queried, **Then** each entry reports the
   identity of its document and where the reference to it was written.

---

### User Story 3 - Remote schemas are fetched safely and cached (Priority: P3)

A schema publisher hosts a schema at an HTTPS address. Configs reference it, verify it against a
content hash when one is given, and — once fetched — keep working without the network.

**Why this priority**: Published schemas are how the cascade escapes one machine, and the moment a
document is fetched rather than read locally, fetching must not mean trusting.

**Independent Test**: Resolve a chain containing a remote reference against recorded responses;
confirm the content hash is verified when present, that a mismatch is refused, that a non-HTTPS
address is refused, and that a second resolution succeeds with the network unavailable.

**Acceptance Scenarios**:

1. **Given** a reference to an HTTPS address, **When** resolved, **Then** the document is fetched and
   becomes part of the graph like any local one.
2. **Given** a reference over plain HTTP, **When** resolved, **Then** it is refused before any
   request is made.
3. **Given** a remote reference carrying a content hash, **When** the fetched bytes hash to something
   else, **Then** it is refused naming both the expected and actual hash — the bytes are never used.
4. **Given** a remote document already fetched, **When** the same identity is resolved again with no
   network available, **Then** it resolves from cache and succeeds.
5. **Given** a remote document never fetched and no network available, **When** resolved, **Then** it
   is refused with a diagnostic saying so, rather than hanging or reporting a different problem.
6. **Given** two documents referencing the same remote identity, **When** resolved, **Then** it is
   fetched once.
7. **Given** a chain containing one pinned and one unpinned remote reference, **When** the pedigree
   is queried, **Then** it distinguishes which entries were verified against a hash and which were
   taken on TLS alone.
8. **Given** an HTTPS reference whose response redirects to a plain HTTP address, **When** resolved,
   **Then** the hop is refused before it is followed — not merely noticed after the fact.
9. **Given** a reference whose responses redirect in a loop, **When** resolved, **Then** it is refused
   once the hop cap is exceeded, rather than followed indefinitely.

---

### User Story 4 - Broken graphs are refused precisely (Priority: P4)

Whatever is wrong with a set of references — a cycle, a missing file, an address that isn't allowed,
a schema reaching for a file it has no business reading — the author is told what and **where**, with
the position of the reference that caused it, in the document that wrote it.

**Why this priority**: A resolution failure is the least debuggable kind, because the evidence is
spread across files the author may not have opened. Precision here is what keeps the cascade
approachable as chains get longer.

**Independent Test**: One fixture per failure mode, each asserting the diagnostic code and the
position of the offending reference.

**Acceptance Scenarios**:

1. **Given** a chain that refers back to a document already in it, **When** resolved, **Then** the
   cycle is refused, naming the reference that closed it and the chain it closed.
2. **Given** a reference to a document that does not exist or cannot be read, **When** resolved,
   **Then** it is refused at the reference's own position.
3. **Given** a **schema** whose local reference points outside the sandbox root, **When** resolved,
   **Then** it is refused — a schema may not reach arbitrary files on the reader's machine.
4. **Given** a **config** whose own `$schema` points outside the sandbox root, **When** resolved,
   **Then** it is permitted: the author wrote it, and that is consent.
5. **Given** a chain longer than the configured limit, **When** resolved, **Then** it is refused
   rather than followed indefinitely.
6. **Given** a fetched document that is not readable as a document at all, **When** resolved, **Then**
   the failure is reported against the reference that fetched it, not as an anonymous parse error.
7. **Given** a resolution with several independent problems — a missing local file in one branch and
   a disallowed scheme in another — **When** resolved, **Then** both are reported from one attempt,
   not just whichever was reached first.
8. **Given** a caller that supplies no sandbox root, **When** resolution is requested, **Then** it is
   an error to the caller rather than a root being guessed from the entry document's location.

---

### Edge Cases

- **A document that refers to itself**, directly or through a chain of any length.
- **Two documents that refer to each other**, the shortest cycle that is not self-reference.
- **The same document reached by two different spellings** of the same location — a relative path and
  an absolute one, or two URLs differing only in case of the host.
- **A symbolic link** whose target lies outside the sandbox root: the escape must be judged on where
  the link leads, not where it sits.
- **A remote address that redirects**, including a redirect from HTTPS to plain HTTP.
- **A cached document whose freshness has expired** while the network is unavailable.
- **A reference that is syntactically a URL but names an unsupported scheme** — a file URL, a data URL.
- **An entry document with no `$schema` at all**, which is legal and yields a single-document graph.
- **A pin that is syntactically malformed**, as distinct from one that does not match.

## Requirements *(mandatory)*

### Functional Requirements

**Reading bytes** (§4.2, correcting v0.1 FR-016)

- **FR-001**: The primary entry point MUST accept bytes together with the identity of their source.
- **FR-002**: Bytes that are not valid UTF-8 (RFC 3629) MUST be refused with a diagnostic naming the
  offending byte offset. They MUST NOT be repaired into replacement characters.
- **FR-003**: A text-accepting entry point MAY remain for callers that already hold decoded text, and
  MUST document that it cannot enforce FR-002.
- **FR-004**: Given valid UTF-8 bytes, the resulting tree MUST be identical to the one v0.1 produced
  from the equivalent text, including every span.

**Resolving references** (§3, §6.1)

- **FR-005**: A config MUST be able to name its governing schema, and a schema MUST be able to name
  exactly one parent. A document declaring more than one parent MUST be refused.
- **FR-006**: A reference written as a relative path MUST resolve against the directory of the
  document containing it.
- **FR-007**: Every resolved document MUST carry a **canonical identity** — its location together
  with the hash of its bytes — and identity, not reference text, MUST decide whether two references
  name the same document.
- **FR-008**: The resolved set MUST form a directed acyclic graph. A cycle MUST be refused.
- **FR-009**: A document reachable by more than one route MUST be read once and appear once.
- **FR-010**: A configurable limit on chain length MUST be enforced.

**Pedigree** (§6.1)

- **FR-011**: Resolution MUST produce an ordered pedigree — the schema identities from root to leaf.
- **FR-012**: The pedigree MUST be queryable, each entry reporting its document's identity and the
  position of the reference that brought it in.

**Fetching** (§11)

- **FR-013**: Remote references MUST use HTTPS. Any other scheme MUST be refused before any network
  request is made.
- **FR-014**: When a reference carries a content hash, the fetched bytes MUST be verified against it
  and refused on mismatch, naming expected and actual. Unverified bytes MUST NOT enter the graph.
- **FR-027**: Redirects MUST be followed one hop at a time, and **every hop MUST satisfy FR-013**. A
  hop leaving HTTPS MUST be refused before it is followed. Checking only the final destination is
  insufficient — by then the insecure request has already been made, which is the exact bypass FR-013
  exists to prevent.
- **FR-028**: The number of redirect hops MUST be capped, and exceeding the cap MUST be refused. A
  redirect loop MUST NOT be followed indefinitely.
- **FR-015**: A malformed content hash MUST be refused distinctly from one that does not match.
- **FR-016**: Fetched documents MUST be cached by content identity and reused across runs, so that a
  previously resolved chain resolves with no network available.
- **FR-017**: Cache freshness MUST follow HTTP caching semantics (RFC 9111).
- **FR-018**: A document that is neither cached nor reachable MUST be refused with a diagnostic that
  says exactly that. A document that **is** cached but stale, with no network available, MUST still
  resolve: a content-addressed body cannot silently drift, so staleness is a revalidation hint
  rather than grounds for refusal.
- **FR-019**: Each distinct remote identity MUST be fetched at most once per resolution.
- **FR-026**: The pedigree MUST report, for each entry, whether it was verified against a content
  hash, so that an unpinned remote link is visible rather than silent (§11). This is what makes a
  published root's future demand for pinned adoption auditable.

**Sandbox** (§8.4's razor, applied to references)

- **FR-020**: A **config's own** reference MAY name a location outside the sandbox root: the author
  wrote it, which is consent.
- **FR-021**: A **schema's** reference to a local path MUST be confined to the sandbox root, with no
  parent-directory escapes and no absolute paths. Escape MUST be judged on the resolved target,
  including through symbolic links.
- **FR-022**: The sandbox root MUST be supplied by the caller, never inferred silently.

**Diagnostics** (§10)

- **FR-023**: Every resolution failure MUST report the position of the **reference** that caused it,
  in the document that wrote it — not merely the document that failed.
- **FR-024**: A failure inside a fetched document MUST be attributable to the reference that fetched
  it, so an author can trace it back to something they wrote.
- **FR-025**: Resolution MUST report every failure it can determine independently, rather than only
  the first, consistent with v0.1's collect-all behavior.

### Key Entities

- **Reference**: one document's pointer at another — its written text, its position, and whether it
  was authored by a config or by a schema.
- **Document Identity**: location plus content hash; the thing equality and deduplication use.
- **Resolved Document**: bytes, identity, and the reference that brought it in.
- **Pedigree**: the ordered chain of schema identities from root to leaf.
- **Graph**: resolved documents and the reference edges between them, acyclic.
- **Cache Entry**: bytes stored under a content identity, with the freshness metadata that fetched it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A config three schemas deep resolves into a pedigree listing the **three schema**
  identities in root-to-leaf order, with no network access. The config is not in the pedigree — it is
  the graph's entry, and the pedigree answers "what schemas am I bound by", to which the config is not
  an answer (FR-011).
- **SC-002**: 100% of resolution failures report a position in a document the author wrote, never an
  anonymous failure or one located only in a fetched file.
- **SC-003**: A previously resolved chain resolves successfully with the network unavailable, in 100%
  of cases where every document was fetched at least once before.
- **SC-004**: A remote document whose bytes do not match a stated hash is refused 100% of the time,
  and its bytes never reach the graph.
- **SC-005**: A non-HTTPS remote reference is refused without any network request being made, and a
  redirect leaving HTTPS is refused before that hop is followed, in 100% of cases.
- **SC-006**: A schema attempting to read a local file outside the sandbox root is refused 100% of the
  time, including via symbolic links.
- **SC-007**: A document reachable by N distinct routes is read once, and each distinct remote
  identity is fetched at most once per resolution.
- **SC-008**: Cycles and over-long chains are refused in bounded time in 100% of cases; none hangs.
- **SC-009**: Resolution is deterministic: the same inputs and cache state produce the same graph,
  the same pedigree order, and the same diagnostics in the same order on every run.
- **SC-010**: Invalid UTF-8 bytes are refused with a byte position in 100% of cases, and never
  silently become replacement characters.

## Assumptions

- **Pinning is verified when present, not required — and `SPEC.md` §11 now says so.** §11 was amended
  (logged in §15) to settle where the decision lives: the library ships the *mechanism* (verification,
  which is absolute) and a published root ships the *policy*, under §2.3's downward authority. A root
  demanding pinned adoption is governance, and governance arrives with sealing in §6.3 / roadmap v0.7.
  This spec and the canon therefore agree; FR-026 exists because §11's amendment made unpinned-link
  reportability a MUST.
- **Caching is on disk and content-addressed; a lockfile is not in v0.2.** §11 calls the cache
  "lockfile-friendly", which is a property of the design rather than a deliverable here.
- **The sandbox root is caller-supplied**, with no default inferred from the entry document's
  location, per Principle VI's "capabilities are granted, never ambient."
- **Chain-length and response-size limits get concrete documented defaults**, as v0.1's depth and size
  caps did.
- **Redirects are followed only within HTTPS**, and a redirect to any other scheme is refused as
  FR-013 would refuse it directly.
- **Registry-name references (§3) are out of scope for v0.2.** Only relative paths and HTTPS URLs
  resolve; a registry needs a resolution authority that does not exist yet.
- **No test performs network access.** Remote behavior is exercised against recorded responses, per
  the constitution's Technology & Security Constraints.

## Out of Scope

Each belongs to a later milestone in the `SPEC.md` §14 roadmap:

- Merging layers, per-key merge strategies, provenance chains, `why` (v0.3)
- Constraint checking, `demand`/`provide`, whole-chain validation, the error contract (v0.4)
- Named types (v0.5), delegation and transclusion (v0.6), sealing and authority (v0.7)
- `$extends` fork mode, multi-parent adoption and C3 linearization, `merge-by-key` (future)
- JSON Schema export, static subsumption checking, the JSON and TOML adapters (v1.x)
- Registry-name resolution, and any lockfile format
