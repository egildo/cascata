---
description: "Task list for v0.2 — Resolver & DAG Builder"
---

# Tasks: Resolver & DAG Builder

**Input**: Design documents from `/specs/002-resolver-dag-builder/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **Included and mandatory.** Constitution Principle V requires conformance cases before the
code claiming to conform, and the v1.1.0 probe gate binds Phase 0 research the same way. Test tasks
here are not optional.

**Organization**: Grouped by user story so each is independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no incomplete dependency
- **[Story]**: US1–US4, mapping to spec.md's user stories
- Exact file paths in every task

## Path Conventions

Single-package library, extending v0.1. `src/` and `tests/` at repository root, per plan.md's
Structure Decision.

## What is different about this milestone

v0.2 builds on working code rather than an empty repository. Two consequences:

- **Nothing here may weaken v0.1.** Its 168 tests must stay green throughout. Where v0.2 changes a
  v0.1 surface — the entry point taking bytes — the old behavior is preserved and documented, not
  replaced.
- **The Principle IV boundary grows.** `src/resolve/` and `src/graph/` join the policed set, and
  `graph/` must not import `resolve/` either. T012 makes that mechanical before the code exists to
  violate it.

---

## Phase 1: Setup

- [x] T001 Create the `src/resolve/` and `src/graph/` directory skeleton per plan.md's Structure Decision
- [x] T002 [P] Create the recorded-response fixture directory tests/corpus/recorded/ per contracts/recorded-responses.md
- [x] T003 [P] Add the test cache directory .cascata-cache/ to .gitignore so cache artifacts written by the suite are never committed

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Entities, hashing, and the hermetic test seam. Every story depends on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 [P] Add the v0.2 diagnostic codes from contracts/diagnostics.md to src/diagnostics/codes.ts, leaving v0.1's untouched
- [x] T005 [P] Define `Reference` with `text`, `span`, `kind`, `authority`, and optional `pin` in src/resolve/reference.ts, constructible only with a span (Principle III)
- [x] T006 Define `DocumentIdentity` as location plus content hash in src/resolve/identity.ts — depends on T005
- [x] T007 Implement SHA-256 over exact bytes in src/resolve/identity.ts per research D1 — no canonicalization, no text decoding — depends on T006
- [x] T008 Implement `$pin` parsing and verification, distinguishing malformed from mismatched, in src/resolve/identity.ts — depends on T007
- [x] T009 [P] Define the recorded-response transport seam in tests/corpus/transport.ts per contracts/recorded-responses.md, failing loudly on an unmatched request
- [x] T010 Assert unconsumed recordings fail a case, so a test expecting a fetch fails when none happens, in tests/corpus/transport.ts — depends on T009
- [x] T011 [P] Unit-test hashing and pin verification, including a pin that is well-formed but wrong versus one that is malformed, in tests/unit/identity.test.ts — depends on T008
- [x] T012 Extend the policed set in tests/unit/layering.test.ts: `src/resolve/` and `src/graph/` may not import adapters, and `src/graph/` may not import `src/resolve/` — depends on T001

**Checkpoint**: Entities, hashing, and a hermetic transport exist. Story work can begin.

---

## Phase 3: User Story 1 — Documents are read from bytes (Priority: P1) 🎯 MVP

**Goal**: The entry point takes bytes and enforces UTF-8 where it is actually enforceable.

**Independent Test**: Feed invalid UTF-8 bytes and get a refusal at the offending byte offset; feed
the same document as valid bytes and get a tree identical to v0.1's from equivalent text.

### Conformance cases for User Story 1 (write first — Principle V)

- [x] T013 [P] [US1] Cases for invalid UTF-8 — a truncated multi-byte sequence, an overlong encoding, a bare continuation byte — each asserting the offending byte offset, in tests/corpus/cases/bytes-encoding/
- [x] T014 [P] [US1] Cases asserting valid non-ASCII bytes produce spans identical to v0.1's from the equivalent text, in tests/corpus/cases/bytes-parity/
- [x] T015 [P] [US1] Case asserting a byte-order mark in the byte stream leaves positions unchanged, in tests/corpus/cases/bytes-bom/

### Implementation for User Story 1

- [x] T016 [US1] Decode and validate UTF-8 strictly, reporting the offending byte offset rather than substituting replacement characters, in src/adapters/yaml/parse.ts (FR-002)
- [x] T017 [US1] Add the bytes-accepting `parse()` to src/index.ts, keeping `parseText()` and documenting that it cannot enforce FR-002 (FR-001, FR-003) — depends on T016
- [x] T018 [US1] Confirm byte and text entry points produce identical trees for valid UTF-8, spans included, in tests/unit/entry-parity.test.ts (FR-004) — depends on T017

**Checkpoint**: §4.2's UTF-8 mandate is enforceable for the first time. MVP complete.

---

## Phase 4: User Story 2 — A config's schema chain resolves into a pedigree (Priority: P2)

**Goal**: Follow `$schema` and `$adopts` through local files into an acyclic graph with an ordered
pedigree.

**Independent Test**: A two-deep local chain yields a pedigree of three identities in root-to-leaf
order. No network.

### Conformance cases for User Story 2 (write first)

- [x] T019 [P] [US2] Cases for a three-deep local chain asserting pedigree order and each entry's identity, in tests/corpus/cases/chain-local/
- [x] T020 [P] [US2] Cases placing config and schema in **different directories**, asserting relative references resolve against the referring document rather than the entry or the working directory, in tests/corpus/cases/chain-relative/
- [x] T021 [P] [US2] Assert content-hash dedup — two locations with byte-identical content converge to one graph node, and an already-resolved location is answered as a duplicate — in tests/unit/graph-content-dedup.test.ts (v0.2 FR-009). **Retargeted after `SPEC.md` §9 settled `$adopts` as a scalar:** with single-parent adoption the chain is structurally a straight line, so no fixture in this milestone's vocabulary can produce two edges converging on one document. The dedup machinery is real — delegation (§8) and future multi-adoption need it — so it is tested directly rather than through a scenario that can no longer occur
- [x] T022 [P] [US2] Case for a schema declaring two `$adopts` parents, asserting `multiple-adoption` with both positions, in tests/corpus/cases/chain-invalid/
- [x] T023 [P] [US2] Case for an entry document with no `$schema`, asserting a single-document graph and an empty pedigree, in tests/corpus/cases/chain-none/
- [x] T024 [P] [US2] Cases for tilde expansion — a config `$schema` beginning `~/` resolving, and a schema `$adopts` beginning `~/` not expanding — in tests/corpus/cases/chain-tilde/

### Implementation for User Story 2

- [x] T025 [US2] Extract `$schema` and `$adopts` from a parsed tree into `Reference` values carrying their spans, in src/resolve/reference.ts (FR-005) — depends on T005
- [x] T026 [US2] Derive `authority` from the document carrying the reference, never from the reference's own text, in src/resolve/reference.ts — depends on T025
- [x] T027 [US2] Resolve relative references against the referring document's directory in src/resolve/location.ts (FR-006)
- [x] T028 [US2] Read local documents and assemble resolved documents carrying the reference that brought them in, in src/resolve/location.ts — depends on T027, T007
- [x] T029 [US2] Build the DAG with dedup by location before fetch and by content hash after, per research D5, in src/graph/build.ts (FR-007, FR-009) — depends on T028
- [x] T030 [US2] Detect cycles on location during resolution, before bytes exist, in src/graph/build.ts (FR-008) — depends on T029
- [x] T031 [US2] Refuse a second `$adopts` parent in src/resolve/reference.ts (v0.2 FR-005) — depends on T029. **Moved from `src/graph/build.ts`:** once `$adopts` became a single scalar (T032), multiplicity is a shape question answerable before any location is resolved, so it belongs at extraction rather than at graph build
- [x] T032 [US2] Refuse a sequence-valued `$adopts` with `multiple-adoption` and accept only a single string scalar per `SPEC.md` §9, in src/resolve/reference.ts (v0.2 FR-005) — removes the sequence-as-valid-syntax reading an implementer had to invent before §9 specified the shape
- [x] T033 [US2] Expand a leading `~/` in **config-authored** references only, never schema-authored ones, in src/resolve/location.ts (v0.2 FR-029) — `SPEC.md` §9's own worked chain depends on it
- [x] T034 [US2] Produce the ordered root-to-leaf pedigree with each entry's identity and originating reference position, in src/graph/pedigree.ts (FR-011, FR-012) — depends on T029
- [x] T035 [US2] Add `adapters/registry.ts` mapping a format name to an adapter, and the `resolve()` orchestrator in src/index.ts that consults it between resolve and graph — depends on T029, T034

**Checkpoint**: `SPEC.md` §9's worked chain is executable rather than illustrative.

---

## Phase 5: User Story 3 — Remote schemas fetched safely and cached (Priority: P3)

**Goal**: HTTPS-only fetching, hash verification when a pin is present, and a cache that makes the
second resolution work offline.

**Independent Test**: Resolve a chain with a remote reference against recorded responses; confirm
verification, refusal on mismatch, and success on a second run with every request failing.

### Conformance cases for User Story 3 (write first)

- [x] T036 [P] [US3] Cases for a successful HTTPS fetch joining the graph like a local document, in tests/corpus/cases/remote-fetch/
- [x] T037 [P] [US3] Cases for a pin that matches, one that mismatches, and one that is malformed, in tests/corpus/cases/remote-pin/
- [x] T038 [P] [US3] Cases for offline resolution from cache, for a document neither cached nor reachable, and for a **stale** cached document with no network (FR-018), in tests/corpus/cases/remote-offline/
- [x] T039 [P] [US3] Case asserting one remote identity referenced twice is fetched once, in tests/corpus/cases/remote-dedup/. **Retargeted, for T021's exact reason applied to the remote case:** `$adopts`/`$schema` being single string scalars makes a resolution structurally a straight chain, so no fixture in this milestone's vocabulary lets two *different* documents' references name the same remote URL — the diamond this scenario needs cannot arise end-to-end until delegation (§8) or multi-adoption exist. Tested directly instead, in tests/unit/graph-remote-dedup.test.ts, driving the same beginVisit/registerContent/finishVisit protocol `src/index.ts` uses, twice, against one shared `GraphBuilder`
- [x] T040 [P] [US3] Case asserting the pedigree distinguishes hash-verified entries from unpinned ones, in tests/corpus/cases/remote-audit/ (FR-026)
- [x] T041 [P] [US3] Cases for revalidation — a first response with an `ETag`, a second returning `304` — in tests/corpus/cases/remote-cache/
- [x] T042 [P] [US3] Cases for redirect safety — an HTTPS response redirecting to plain HTTP, and a redirect loop exceeding the hop cap — asserting `insecure-redirect` and `too-many-redirects`, in tests/corpus/cases/remote-redirect/ (FR-027, FR-028)

### Implementation for User Story 3

- [x] T043 [US3] Implement HTTPS-only fetching with a request timeout in src/resolve/fetch.ts (FR-013) — depends on T009
- [x] T044 [US3] Enforce the response size cap **during streaming**, so an unbounded body is cut off rather than measured after, in src/resolve/fetch.ts — depends on T043
- [x] T045 [US3] Follow redirects manually, one hop at a time, refusing any hop leaving HTTPS and capping the hop count at `maxRedirects`, per research D4 (FR-027, FR-028), in src/resolve/fetch.ts — depends on T043
- [x] T046 [US3] Implement the content-addressed cache store in src/resolve/cache.ts (FR-016) — depends on T007
- [x] T047 [US3] Implement the named RFC 9111 subset from research D3 — freshness lifetime, `ETag`/`Last-Modified` revalidation, `no-store`/`no-cache` — and nothing beyond it, in src/resolve/cache.ts (FR-017) — depends on T046
- [x] T048 [US3] Verify fetched bytes against a stated pin and **discard them on mismatch** so they never enter the graph, in src/resolve/fetch.ts (FR-014) — depends on T008, T043
- [x] T049 [US3] Fetch each distinct remote identity at most once per resolution in src/graph/build.ts (FR-019) — depends on T029, T043
- [x] T050 [US3] Record on each pedigree entry whether it was hash-verified, in src/graph/pedigree.ts (FR-026) — depends on T034, T048

**Checkpoint**: The cascade escapes one machine, and fetching still does not mean trusting.

---

## Phase 6: User Story 4 — Broken graphs refused precisely (Priority: P4)

**Goal**: Every resolution failure names a reference the author wrote, and its position.

**Independent Test**: One fixture per failure mode, each asserting the code and the position of the
offending reference.

### Conformance cases for User Story 4 (write first)

- [x] T051 [P] [US4] Cases for a self-referencing schema and a mutually referencing pair, asserting `reference-cycle` names every reference in the loop in chain order, in tests/corpus/cases/fail-cycle/. **Corrected `cycleDiagnostic`'s `related` while authoring this**: the pre-existing rendering (T029/T030, written before this task existed to judge it) over-included the reference that first *reached* the repeated location — not part of the loop itself, graph-theoretically — so a plain self-`$adopts` wrongly got one `related` entry instead of zero. See the milestone report.
- [x] T052 [P] [US4] Cases for a missing and an unreadable document, asserting `document-unreachable` at the reference's position, in tests/corpus/cases/fail-unreachable/. "Unreadable" realized as a directory named where a document was expected (`EISDIR`) — portable across CI/sandboxes; a permission-bits case is not, and is not attempted.
- [x] T053 [P] [US4] Cases for a **schema** referencing outside the sandbox by relative path, by absolute path, and **through a symlink whose target is outside**, in tests/unit/sandbox-escape.test.ts, not tests/corpus/cases/fail-sandbox/. **Retargeted for a portability reason, not a structural one**: the absolute-path sub-case must embed a real filesystem path that exists only once a temp directory is created at run time — a static fixture baked with one checkout's absolute path would not travel with the repository. All three sub-cases (including the two that could have been static) are built the same way, from one `mkdtempSync` root, so the file has one construction style throughout. Sabotage-confirmed: with symlink-following removed, exactly the symlink sub-case fails — the other two, being ordinary lexical `..`/absolute escapes, still pass, proving the distinction is real (see the milestone report).
- [x] T054 [P] [US4] Case asserting a **config's own** reference outside the sandbox is permitted, per `SPEC.md` §9's worked example, in tests/corpus/cases/sandbox-config-exempt/ — literally mirrors §9's `$schema: ~/.config/house.yaml` (a `~/` reference resolving outside a sandbox root that does not contain the home directory), doubling as the tilde-expansion exemption `SPEC.md` §9 depends on.
- [x] T055 [P] [US4] Cases for `unsupported-scheme` on `http:`, `file:`, and `data:`, asserting no request is attempted, in tests/corpus/cases/fail-scheme/. **Found a real gap while deriving `data:`'s expected diagnostic independently**: `src/resolve/location.ts`'s scheme detector required a `//` authority (`scheme://…`), so `data:text/plain,…` (no `//`, legal URI grammar) fell through to `"local"` and was read as a literal filename — fixed as part of T062; sabotage-confirmed the `data:` case (only) fails without the fix.
- [x] T056 [P] [US4] Case for a chain past `maxChainLength`, in tests/corpus/cases/fail-chain-limit/. Added an optional `maxChainLength` field to `tests/corpus/resolve-case.ts`'s descriptor format (threaded through to `resolve()`) so this case is a small, hand-writable 3-schema chain against a small custom limit (2), rather than 33+ files authored just to reach the production default of 32.
- [x] T057 [P] [US4] Case for a fetched document that is unparseable, asserting the failure is attributed to the reference that fetched it, in tests/unit/fetched-malformed.test.ts (FR-024) — same file-organization convention as T036 (`tests/unit/remote-fetch.test.ts`): the JSON `resolve-cases/` format has no field for a `Transport`.
- [x] T058 [P] [US4] Case with independent failures in separate branches — a missing local file and a disallowed scheme — asserting both are reported from one attempt, in tests/unit/resolve-collect-all.test.ts, not tests/corpus/cases/fail-multi/. **Retargeted, for T021/T039's exact reason applied to FR-025**: `data-model.md`'s "Graph" entry states outright that with `$adopts`/`$schema` single string scalars the pedigree "is a chain, never a tree... branching is a refusal rather than a shape to handle." Traced through `walkAdoptsChain`: at any point in a resolution there is exactly one reference being resolved, and each step's success is a precondition for discovering the next one's text — so no fixture in this milestone's vocabulary can produce two independent branch failures from one `resolve()` call, structurally, not as an implementation gap. Unlike T021/T039, this was **not** flagged with a retargeting note when this phase was authored; see the milestone report. Tested directly against `src/graph/build.ts`'s new `resolveAllBranches` — genuine, reusable collect-all machinery for delegation (§8, v0.6), where several simultaneous `delegate` references are real independent branches — with two synthetic candidates failing for unrelated reasons, standing in for "a missing local file" and "a disallowed scheme."

### Implementation for User Story 4

- [x] T059 [US4] Enforce the sandbox on the **resolved real path**, following symlinks, for schema-authored references only, in src/resolve/location.ts (FR-021) — depends on T026, T027. `isWithinSandbox`/`isSandboxEscape`, via `fs.realpathSync` on both the target and the root. Sabotage-confirmed: replacing `realpathSync` with lexical `path.resolve` breaks only T053's symlink sub-case.
- [x] T060 [US4] Exempt config-authored references from the sandbox in src/resolve/location.ts (FR-020) — depends on T059. `isSandboxEscape` gates on `candidate.authority`. Sabotage-confirmed: removing the gate breaks only T054.
- [x] T061 [US4] Require a caller-supplied sandbox root, erroring to the caller rather than inferring one, in src/index.ts (FR-022) — depends on T035. Already satisfied by `requireSandboxRoot` (Phase 4); confirmed present and unchanged.
- [x] T062 [US4] Refuse non-HTTPS schemes before any request is made, in src/resolve/location.ts (FR-013) — depends on T027. Extended `classifyReferenceLocation` with `SCHEME_PREFIX_PATTERN` (T055's `data:` finding).
- [x] T063 [US4] Enforce `maxChainLength` during resolution in src/graph/build.ts (FR-010) — depends on T029. `GraphBuilder` takes `maxChainLength` (default `DEFAULT_MAX_CHAIN_LENGTH` = 32) and `beginVisit` returns a new `"chain-limit-exceeded"` decision. Sabotage-confirmed against T056.
- [x] T064 [US4] Attach the originating reference and its span to every resolution diagnostic in src/resolve/reference.ts (FR-023, FR-024) — depends on T025, T004. Added `referenceDiagnostic` in `src/resolve/reference.ts`, structurally unable to construct a `Diagnostic` without a `Reference`; used by every diagnostic this phase adds (`sandbox-escape`, `chain-limit-exceeded`, the corrected `reference-cycle`). Pre-existing call sites (`document-unreachable`, `multiple-adoption`, the fetch/pin codes) already anchored to `candidate.span` by construction — verified by inspection, not refactored wholesale, to avoid churning call sites Phase 4/5's own conformance suite already covers; see the milestone report.
- [x] T065 [US4] Continue resolving independent branches past a failure so one attempt reports all of them, in src/graph/build.ts (FR-025) — depends on T059, T062, T063, T064. `resolveAllBranches`, generic collect-all over independent candidates. Not reachable end-to-end from `resolve()` in this milestone (see T058's note) and so not wired into `walkAdoptsChain`'s production call sites — sabotage-confirmed directly (stop-at-first-failure breaks exactly the two collect-all assertions in tests/unit/resolve-collect-all.test.ts, not the all-success/vacuous ones).

**Checkpoint**: Every failure is traceable to something the author wrote.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T066 [P] Document the resolution surface and the v0.2 diagnostic codes in README.md, citing contracts/resolve-api.md
- [ ] T067 [P] Add the two byte-validator cases an independent review found missing — a codepoint past U+10FFFF (lead byte `F5`–`FF`, or `F4` with a second byte above `8F`), and an invalid byte preceded by a **valid non-ASCII prefix**, which is what would catch a regression validating a decoded string rather than raw bytes — in tests/corpus/cases/bytes-encoding/
- [ ] T068 [P] Confirm resolution is deterministic — same inputs and cache state give the same graph, pedigree order, and diagnostic order — in tests/unit/resolve-determinism.test.ts (SC-009)
- [ ] T069 [P] Re-assert the suite performs no network access now that a fetch layer exists, in tests/unit/hermetic.test.ts
- [ ] T070 Confirm all 168 v0.1 tests still pass unchanged by running the full suite, so nothing in specs/001-information-model-yaml-adapter/ regressed
- [ ] T071 Run every validation scenario in specs/002-resolver-dag-builder/quickstart.md end to end
- [ ] T072 Verify the six merge gates in .specify/memory/constitution.md, plus the extended layering boundary from T012

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks all stories**
- **US1 (Phase 3)**: depends on Foundational only — genuinely independent of US2–US4
- **US2 (Phase 4)**: depends on Foundational; needs US1's bytes entry to read documents
- **US3 (Phase 5)**: depends on US2's graph and pedigree
- **US4 (Phase 6)**: depends on US2; its sandbox and scheme checks sit in the location layer US2 builds
- **Polish (Phase 7)**: depends on all stories

### Story independence — stated honestly

US1 is fully independent and is a real deliverable on its own. US2, US3, and US4 form a chain: you
cannot fetch remotely without resolving locally, and you cannot refuse a broken graph without a graph
builder. This is inherent to a resolution pipeline, as it was in v0.1's parsing pipeline. Each still
has its own checkpoint and delivers separately testable value.

### Within each story

- Conformance cases before the code they judge (Principle V)
- Entities before the layers that use them; resolve before graph; graph before the orchestrator

### Parallel opportunities

- T002, T003 in Setup
- T004, T005, T009 at the start of Foundational; then T011 alongside T012
- **All of T013–T015** (US1 cases), **T019–T024** (US2), **T036–T042** (US3), **T051–T058** (US4) —
  each group is separate directories with no shared state
- T066, T068, T069 in Polish

---

## Parallel Example: User Story 4 conformance cases

```bash
# Eight independent directories, authorable simultaneously:
Task: "Cycle cases in tests/corpus/cases/fail-cycle/"
Task: "Unreachable cases in tests/corpus/cases/fail-unreachable/"
Task: "Sandbox escape cases in tests/corpus/cases/fail-sandbox/"
Task: "Config exemption case in tests/corpus/cases/sandbox-config-exempt/"
Task: "Scheme cases in tests/corpus/cases/fail-scheme/"
Task: "Chain limit case in tests/corpus/cases/fail-chain-limit/"
Task: "Malformed fetched document case in tests/corpus/cases/fail-fetched-malformed/"
Task: "Multi-failure case in tests/corpus/cases/fail-multi/"
```

---

## Implementation Strategy

### MVP (User Story 1 only)

Setup → Foundational → US1. Stop and validate: the entry point takes bytes and §4.2's UTF-8 mandate
is enforceable for the first time. This is a genuine deliverable — it closes a defect v0.1 shipped —
and it is worth landing before the resolver begins.

### Incremental delivery

1. Setup + Foundational → entities, hashing, hermetic transport
2. US1 → bytes at the boundary → validate
3. US2 → local chains resolve into pedigrees → validate
4. US3 → remote fetching, pinning, caching → validate
5. US4 → precise refusals → validate

---

## Notes

**Five tasks carry most of the risk. Each has a failure mode that passes a naive test:**

- **T044 (streaming size cap)** — a cap measured *after* the body arrives is not a cap. A server
  advertising a small `Content-Length` and sending gigabytes must be cut off mid-stream. A test using
  an honest fixture passes either way.
- **T059 (sandbox through symlinks)** — a lexical path check looks exactly like a sandbox until a
  link inside the root points outside it. T053's symlink case is the one that separates them.
- **T048 (pin mismatch discards bytes)** — reporting a mismatch while still using the document is the
  easy mistake, and every assertion about the diagnostic passes while it happens. Assert the graph's
  contents, not just the diagnostic.
- **T065 (collect-all across branches)** — the same failure mode v0.1 hit: code that stops at the
  first failure passes every single-failure case. T058 is the only guard.
- **T030 (cycle detection before bytes)** — detection that waits for content never fires, because the
  cycle prevents the content from ever arriving.

**Also**: v0.1's 168 tests must stay green throughout (T070), and `parseText` must keep working —
this milestone corrects a v0.1 defect without breaking v0.1 consumers.
