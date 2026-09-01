---
description: "Task list for v0.7, part 1 — Sealing, Authority, and the Embedding Surface"
---

# Tasks: Sealing, Authority, and the Embedding Surface

**Input**: Design documents from `/specs/007-sealing-and-embedding/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/host-api.md](./contracts/host-api.md),
[contracts/sealing-authority.md](./contracts/sealing-authority.md)

**Tests**: Included and mandatory (Principle V — conformance cases before the code that judges them).

**Order**: US1 → US2 → US3 → US4 → US5 → US6, per spec.md's own dependency ordering (not
priority-only). Do not reorder without amending Complexity Tracking.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 `mkdir -p tests/corpus/cases/seal tests/corpus/cases/authority`

---

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T002 `src/diagnostics/diagnostic.ts`: `Diagnostic.level: "error" | "info"` — **required**, no
      default; `createDiagnostic()`'s input type requires `level`
- [x] T003 Update every existing `createDiagnostic(` call site (grep first) across
      `src/adapters/yaml/{expand,floor,limits,parse}.ts`, `src/index.ts`, `src/merge/strategy.ts`,
      `src/resolve/{delegate,reference}.ts`, `src/validate/{check,types,violation,vocabulary}.ts` to
      pass `level: "error"` (FR-004 — no reclassification)
- [x] T004 `pnpm typecheck` green after T002/T003 (the compiler enumerates every missed call site —
      treat a typecheck failure here as the task's own checklist)

**Checkpoint**: Every diagnostic in the codebase now carries `level: "error"`. Nothing observable
has changed yet — this is purely the type gaining a mandatory field.

---

## Phase 3: User Story 1 — A diagnostic teaches without refusing (Priority: P1) 🎯 MVP

**Goal**: `Diagnostic.level` is real and load-bearing; a `delegate: allow` key with a leaf-shaped
demand lints instead of silently mismatching.

**Independent Test**: a schema granting `delegate: allow` on `type: string`; resolution succeeds
with one `info` diagnostic.

### Conformance cases (write first)

- [x] T005 [P] [US1] Case: every diagnostic in the existing corpus still carries `level: "error"` —
      extend `tests/corpus/runner.ts`'s (or the relevant corpus runner's) assertion to check
      `level` on every expected diagnostic; do NOT relax any existing fixture's expectation
      (Acceptance Scenario 5, FR-004) — `tests/unit/diagnostic-levels.test.ts`
- [x] T006 [P] [US1] Case: a result whose only diagnostics are `info` is `ok: true` and carries both
      the value and the lints (Acceptance Scenario 2, FR-002) — hand-derived expected shape, not
      copied from a first implementation attempt
- [x] T007 [P] [US1] Case: an `info` diagnostic carries every field an `error` of this milestone
      carries (Acceptance Scenario 3, FR-003) — assert field-by-field against a same-shaped `error`
      case
- [x] T008 [P] [US1] Case: `delegate: allow` at a key demanding `type: string` — resolution succeeds,
      one `info` diagnostic (`delegate-inline-string-loaded`) naming that an inline string there is
      loaded, not matched (Acceptance Scenario 4, FR-005, §8.1) —
      `tests/corpus/cases/validate-delegation/delegate-leaf-shape-lint/` (reusing v0.6's fixture
      family, since this is v0.6's own unanswered Edge Case) — `tests/unit/delegate-lint.test.ts`

### Implementation for User Story 1

- [x] T009 [US1] `src/diagnostics/codes.ts`: add `delegate-inline-string-loaded` to `DELEGATION_CODES`
- [x] T010 [US1] `src/resolve/delegate.ts`: at grant-collection time, detect a granted key whose
      `demand` is a leaf shape (`type` resolving, syntactically, to a name that is not `mapping`/
      `sequence`/a type nesting `keys`/`items`) an inline string scalar would satisfy, and emit
      `delegate-inline-string-loaded` at `level: "info"` — never a refusal, and never suppressing the
      graft itself
- [x] T011 [US1] `src/index.ts`: thread the new `info` diagnostics from delegation grant-collection
      into `ResolveResult`'s success path (today's `finalizeWithDelegation` treats any grant-collection
      `problems` as fatal — split `problems` into `errors`/`infos` and only `errors` fail the call)
- [x] T012 [US1] `src/merge/fold.ts` / `src/validate/check.ts`: confirm `info` diagnostics collected
      during resolve/merge survive into `MergedConfiguration`'s consumer-visible surface (a `lints`
      field or equivalent threading — see US5's `load()` for where these are finally surfaced; for
      this story, confirm `resolve()`'s own result carries them)
- [x] T013 [US1] Sabotage: force `delegate-inline-string-loaded` to `level: "error"` and confirm
      T008 fails; restore. Record in the milestone report.

**Checkpoint**: `Diagnostic.level` is exercised end to end by a real consumer. US2 can proceed.

---

## Phase 4: User Story 2 — An ancestor closes a question rather than narrowing it (Priority: P2)

**Goal**: `seal: open|closed` and `final` are real, per §6.3.

**Independent Test**: an ancestor declaring `final` on a key; a descendant restating it with a
strictly narrower demand is refused despite the narrowing.

### Conformance cases (write first)

- [x] T014 [P] [US2] Case: `seal: closed` refuses an undeclared child key, positioned at the child
      (Acceptance Scenario 1, FR-007) — `tests/corpus/cases/seal/closed-refuses-undeclared-child/`
- [x] T015 [P] [US2] Case: `seal: open` (default) admits the same undeclared child (Acceptance
      Scenario 2, FR-008) — `tests/corpus/cases/seal/open-admits-undeclared-child/`
- [x] T016 [P] [US2] Case: ancestor `open`, descendant `closed` — legal, takes effect from the
      descendant downward (Acceptance Scenario 3, FR-009) — `tests/corpus/cases/seal/tighten-open-to-closed/`
- [x] T017 [P] [US2] Case: ancestor `closed`, descendant `open` — refused as `seal-weakened`
      (Acceptance Scenario 4, FR-009) — `tests/corpus/cases/seal/weaken-closed-to-open/`
- [x] T018 [P] [US2] Case: ancestor `final`, descendant restates the **same** key with a strictly
      **narrower** demand — refused (`final-key-redeclared`), the discriminating case FR-010 names
      explicitly (Acceptance Scenario 5) — `tests/corpus/cases/seal/final-refuses-narrowing/`
- [x] T019 [P] [US2] Case: `final` + `provide`, config sets the key — refused (`final-key-set`,
      Acceptance Scenario 6, FR-011) — `tests/corpus/cases/seal/final-provide-refuses-config-set/`
- [x] T020 [P] [US2] Case: `final` **without** `provide`, config sets the key — accepted (Acceptance
      Scenario 7, FR-012) — `tests/corpus/cases/seal/final-no-provide-admits-config-set/`
- [x] T021 [P] [US2] Case: `final` + `provide` + `required: true` — `info` lint `required-vacuous`
      (Acceptance Scenario 8, FR-013, §5.5 verbatim) — `tests/corpus/cases/seal/final-provide-required-vacuous/`
- [x] T022 [P] [US2] Case: `seal`/`final` declared by a **config** — no effect (Acceptance Scenario 9,
      FR-014) — `tests/corpus/cases/seal/config-seal-final-ignored/`
- [x] T023 [P] [US2] Case: `seal: closed` on a key whose demand is not a mapping — accepted, inert
      (Edge Cases) — `tests/corpus/cases/seal/closed-on-non-mapping/`
- [x] T024 [P] [US2] Case: `final` on a key an ancestor already sealed `final` — refused
      (`final-key-redeclared`, restating v0.7's own reading of the Edge Case: redundant is still a
      declaration) — `tests/corpus/cases/seal/final-on-already-final/`
- [x] T025 [P] [US2] Case: `final` declared in the entry schema (no descendants) — legal, vacuous
      (Edge Cases) — `tests/corpus/cases/seal/final-in-leaf-schema/`
- [x] T026 [P] [US2] Property test: `seal: open → closed` is a legal monotone tightening; `closed →
      open` never is — add to `tests/unit/monotonicity.test.ts`'s table
- [x] T027 [P] [US2] Property test: `final` refuses **every** redeclaration shape (`demand`,
      `provide`, `cascade`, `seal`, `final`), not only widenings — add to
      `tests/unit/monotonicity.test.ts`'s table, generated across all five shapes

### Implementation for User Story 2

- [x] T028 [US2] `src/diagnostics/codes.ts`: add `unknown-seal-value`, `seal-violation`,
      `seal-weakened`, `final-key-redeclared`, `final-key-set`, `required-vacuous` to a new
      `SEALING_CODES` array
- [x] T029 [US2] `src/merge/strategy.ts`: `readKeysVocabulary`/`KeyVocabulary` gain `seal`/`final`
      raw nodes (siblings to `provide`/`cascade`, top-level keys only — research.md D4's scope
      decision)
- [x] T030 [US2] `src/merge/seal.ts` (new): `resolveSeal(layers): { readonly state: ReadonlyMap<string, KeySealState>; readonly diagnostics: Diagnostic[] }` — mirrors `resolveStrategies`'s shape: `unknown-seal-value`, tightening `open→closed`, refusing `closed→open` as `seal-weakened`, and refusing **any** redeclaration of a `final` key as `final-key-redeclared` once set
- [x] T031 [US2] `src/merge/fold.ts` / `src/merge/fold.ts`'s `foldConfiguration`: call `resolveSeal`
      alongside `resolveStrategies`, concatenate diagnostics (FR-028's v0.3 precedent, same pattern);
      stash the resolved seal state onto `MergedConfiguration` (a new field, e.g. `sealState`) for
      `src/validate/check.ts` to consume
- [x] T032 [US2] `src/validate/check.ts`: extend the recursive `keys`/`items` walk with a
      `seal: closed` check — for a key whose resolved seal is `closed` and whose accumulated
      `demand.keys` vocabulary is non-empty, refuse every present-but-undeclared child
      (`seal-violation`, positioned at the child)
- [x] T033 [US2] `src/validate/check.ts`: `final`+`provide` check — if the resolved seal state's
      `final.hasProvide` is true and the **config layer's own span** contributes the value at that
      key's pointer (not the schema's `provide` span), refuse `final-key-set`; if the config did
      **not** override it and `required: true` is also declared, emit the `required-vacuous` `info`
      lint instead
- [x] T034 [US2] Sabotage: break `seal-weakened`'s refusal (let `closed→open` silently tighten
      instead) — confirm T017 fails; restore. Record in the milestone report.
- [x] T035 [US2] Sabotage: break `final-key-redeclared` to only fire on widenings — confirm T018
      fails (this is FR-010's own named discriminating case; if a pre-existing test already caught
      it, say so and explain why T018 still adds value or does not). Restore. Record in the report.

**Checkpoint**: `seal`/`final` fully enforced. `008-metaschema-bootstrap` can describe them.

---

## Phase 5: User Story 3 — A published root legislates what its descendants must do (Priority: P3)

**Goal**: `authority:` section — `demandPinnedAdoption`, `finalAgainstForking`.

**Independent Test**: a root declaring `demandPinnedAdoption: true`; an unpinned descendant is
refused, a pinned one resolves.

### Conformance cases (write first)

- [ ] T036 [P] [US3] Case: root demands pinned adoption, descendant adopts unpinned — refused
      `adoption-not-pinned`, positioned at the `$adopts`, citing the root (Acceptance Scenario 1,
      FR-017) — `tests/corpus/cases/authority/demand-pinned-unpinned-refused/`
- [ ] T037 [P] [US3] Case: same root, descendant adopts **with** a correct `$pin` — succeeds,
      pedigree entry `verified: true` (Acceptance Scenario 2, FR-017) —
      `tests/corpus/cases/authority/demand-pinned-pinned-accepted/`
- [ ] T038 [P] [US3] Case: a descendant "retracts" the demand (declares nothing, or explicitly
      writes `demandPinnedAdoption: false`) — demand still binds for entries below it (Acceptance
      Scenario 3, FR-018) — `tests/unit/authority.test.ts`
- [ ] T039 [P] [US3] Case: the demand never protects the declaring document's **own** fetch
      (Acceptance Scenario 4, FR-019, §11's inherent limit) — `tests/unit/authority.test.ts`
- [ ] T040 [P] [US3] Case: `finalAgainstForking: true` — recorded and queryable, **zero**
      diagnostics produced (Acceptance Scenario 5, FR-020) —
      `tests/corpus/cases/authority/final-against-forking-recorded/`
- [ ] T041 [P] [US3] Case: an `authority:` member this version does not implement — refused at its
      own position, naming what is supported (Acceptance Scenario 6, FR-016) —
      `tests/corpus/cases/authority/unknown-authority-member/`
- [ ] T042 [P] [US3] Case: `authority:` declared by a **config** — no effect (FR-021) —
      `tests/corpus/cases/authority/config-authority-ignored/`
- [ ] T043 [P] [US3] Case: a root demanding pinned adoption that is itself reached unpinned (Edge
      Cases — the inherent limit "from the inside") — same fixture family as T039, asserted
      explicitly rather than left implicit

### Implementation for User Story 3

- [ ] T044 [US3] `src/diagnostics/codes.ts`: add `unknown-authority-member`, `adoption-not-pinned`
- [ ] T045 [US3] `src/graph/authority.ts` (new): `readAuthoritySection(schemaTree): { section: AuthoritySection; diagnostics: Diagnostic[] }` — closed vocabulary, `unknown-authority-member` for anything else
- [ ] T046 [US3] `src/graph/authority.ts`: `checkPinningDemand(pedigree, schemaTrees)` — single
      root-to-leaf walk per research.md D5: check-then-arm ordering, no retraction mechanism needed
      (FR-018 falls out of there being no `false`-branch semantics)
- [ ] T047 [US3] `src/graph/pedigree.ts`: `PedigreeEntry.finalAgainstForking: boolean`, populated from
      each schema's own `readAuthoritySection` result
- [ ] T048 [US3] `src/index.ts`: wire `readAuthoritySection`/`checkPinningDemand` into `resolve()`
      after the pedigree is built (schema documents only — never the config's own tree, FR-021 by
      construction)
- [ ] T049 [US3] Sabotage: break the check-then-arm ordering (arm before checking the declaring
      document's own `via`) — confirm T039 fails; restore. Record in the report.

**Checkpoint**: US2 + US3 both land. Independent of US4-US6; safe to commit here.

---

## Phase 6: User Story 4 — The library reads nothing; it asks (Priority: P4)

**Goal**: `Host` is the library's only route to local bytes/canonical identity/cache storage; the
boundary is enforced by a test, not a comment.

**Independent Test**: `grep`-equivalent test asserting no module under `src/` (save the shipped
host) imports `node:fs`/calls `fetch`; a full resolution driven by an in-memory host.

### Conformance cases / tests (write first, alongside the refactor since this story is largely mechanical relocation)

- [ ] T050 [US4] `tests/unit/layering.test.ts`: **write** the new gate-7 sweep (scans all of `src/`
      for `node:fs` imports and `fetch(` calls, exempting `src/host/node.ts` by name) — this MUST
      fail against the current tree before any other T05x task, proving the gate is real
      (Acceptance Scenario 1, FR-023, FR-024, SC-002)
- [ ] T051 [P] [US4] Case: a host backed entirely by an in-memory map resolves a config with
      `$adopts`, `$schema`, and delegated fragments identically to today's fixtures — a new
      in-memory `Host` test double, `tests/unit/host-test-double.ts`, mirroring
      `RecordedTransport`'s role (Acceptance Scenario 2, FR-030) — `tests/unit/host-in-memory.test.ts`
- [ ] T052 [P] [US4] Case: a host that declines to supply a document — the refusal is a diagnostic
      (`document-unreachable`), never a thrown exception (Acceptance Scenario 3, FR-028) —
      `tests/unit/host-refusal.test.ts`
- [ ] T053 [P] [US4] Case: `resolve()`/`load()` called with no `host` — throws (Acceptance Scenario
      4, FR-028) — `tests/unit/host-missing-throws.test.ts`
- [ ] T054 [P] [US4] Case: a location the host **can** canonicalize — host supplies identity, library
      reaches the confinement verdict (Acceptance Scenario 5, FR-026) — extend
      `tests/unit/sandbox-escape.test.ts`
- [ ] T055 [P] [US4] Case: a location the host **cannot** canonicalize — lexical fallback, no verdict
      either way (Acceptance Scenario 6, FR-027 — v0.2's `safeRealpath` behaviour, moved not changed)
      — extend `tests/unit/sandbox-escape.test.ts`
- [ ] T056 [P] [US4] Case: two different hosts supplying byte-identical documents — identical tree,
      provenance, diagnostics, same order (Acceptance Scenario 7, FR-031) —
      `tests/unit/host-determinism.test.ts`
- [ ] T057 [US4] Confirm every existing recorded remote fixture still passes **unmodified**
      (Acceptance Scenario 8, FR-030, SC-008) — do not touch fixture data; only the harness wiring
      that drives `resolve()` may change
- [ ] T058 [P] [US4] Case: the shipped Node host reads local files and fetches remote schemas with
      no adapter of the embedder's own (Acceptance Scenario 9) — `tests/unit/node-host.test.ts`
- [ ] T059 [P] [US4] Case: a host that answers with different bytes for the same location twice in
      one resolution (Edge Cases) — document the library's own non-position on this (it is a law
      about hosts, not enforceable library-side) with a test that shows the library does not crash
      and does not pretend to detect it
- [ ] T060 [P] [US4] Case: a host that canonicalizes two distinct locations to one identity (Edge
      Cases — a hardlink/case-insensitive filesystem) — confirm diamond dedup (existing
      content-hash mechanism) still applies — extend `tests/unit/graph-content-dedup.test.ts` or add
      a sibling

### Implementation for User Story 4

- [ ] T061 [US4] `src/resolve/host.ts` (new): the `Host`/`HostReadResult` interface, zero imports
- [ ] T062 [US4] `src/resolve/location.ts`: `readLocalDocument`/`safeRealpath`/`isWithinSandbox`/
      `isSandboxEscape` become async and Host-backed; remove the `node:fs` import entirely
- [ ] T063 [US4] `src/resolve/cache.ts`: `DocumentCache` takes a `Host` in its constructor;
      `existsSync`/`readFileSync`/`writeFileSync`/`mkdirSync` replaced by `host.cacheRead`/
      `host.cacheWrite` under `"meta/"`/`"blob/"`-prefixed keys; remove the `node:fs` import
- [ ] T064 [US4] `src/resolve/fetch.ts`: remove `createNetworkTransport` (moves to T066); this file
      no longer imports/calls the global `fetch`
- [ ] T065 [US4] `src/resolve/delegate.ts`: `isDelegationSandboxEscape` becomes async, threads
      `Host` through (mirrors T062)
- [ ] T066 [US4] `src/host/node.ts` (new, separate entry point): `createNodeHost(options?: {cacheDir?: string}): Host` (moved `readLocalDocument`/`safeRealpath`/cache bodies) and `createNodeTransport(maxBytes?: number): Transport` (moved `createNetworkTransport` verbatim)
- [ ] T067 [US4] `package.json`: `exports["./host/node"]` → `dist/host/node.{js,d.ts}`
- [ ] T068 [US4] `src/index.ts`: `ResolveOptions.host: Host` (required, throws if missing/malformed
      per FR-028); `ResolveOptions.cacheDir` removed; `ResolveOptions.transport` loses its
      real-network default (no silent fallback); every `walkAdoptsChain`/`performGraft`/
      `readAtTarget` call site threads `host` through and awaits the now-async sandbox checks
- [ ] T069 [US4] Update every test harness that calls `resolve()` directly (or via
      `tests/corpus/resolve-runner.ts`, `tests/unit/remote-test-helpers.ts`, and every `tests/unit/*.test.ts`
      calling `resolve()`) to construct and pass a `Host` — for local-only tests, either
      `tests/unit/host-test-double.ts`'s in-memory host reading from the same fixture directories, or
      `createNodeHost()` from `src/host/node.ts` (test files are exempt from the boundary); for
      remote tests, `createNodeHost({ cacheDir })` alongside the existing `RecordedTransport`
- [ ] T070 [US4] `pnpm test` green: **every** pre-v0.7 test file listed in the CLAUDE.md baseline
      (50 files, 610 tests) still passes, with only harness-level `resolve()` call sites touched —
      no fixture data, no expected-diagnostic data changed (FR-041, SC-007)
- [ ] T071 [US4] Sabotage: reintroduce a bare `import { readFileSync } from "node:fs"` into
      `src/resolve/location.ts` — confirm T050's new gate-7 sweep fails; restore. Record in the
      report (SC-002's own named sabotage).
- [ ] T072 [US4] Sabotage: have the in-memory test host silently substitute different bytes for a
      cache-hit vs. a fresh read within one call — confirm T056's determinism case fails; restore.

**Checkpoint**: The library performs no I/O anywhere except the named host exemption. Every
pre-existing behavior is preserved through the new seam. US5/US6 can now proceed.

---

## Phase 7: User Story 5 — One call (Priority: P5)

**Goal**: `load()` composes `resolve()` → `merge()` → `validate()`.

**Independent Test**: one `load()` call reproduces the staged calls' result exactly, diagnostic
order included.

### Conformance cases (write first)

- [ ] T073 [P] [US5] Case: `load()` on a resolving/merging/validating entry returns
      `{ ok: true, configuration, diagnostics }` (any `info` lints included), never a config
      together with `error`s (Acceptance Scenario 1, FR-032) — `tests/unit/load.test.ts`
- [ ] T074 [P] [US5] Case: `load()`'s result is identical to the staged calls in sequence, diagnostic
      order included (Acceptance Scenario 2, 3, FR-033) — run both paths against the same fixture,
      assert structural equality
- [ ] T075 [P] [US5] Case: `load()` on an entry whose schema chain is fine but produces only `info`
      lints — success with diagnostics, end to end (Edge Cases, reusing T006-T008's fixtures through
      the one-call path)
- [ ] T076 [P] [US5] Case: `load()` with a missing required option throws; a failure at any stage
      returns diagnostics, never a throw (Acceptance Scenario 5, FR-032)
- [ ] T077 [P] [US5] Case: `parse`/`resolve`/`merge`/`validate`/`why` remain independently callable
      and exported (Acceptance Scenario 4, FR-034) — a type-level/import-level assertion, not just a
      runtime one

### Implementation for User Story 5

- [ ] T078 [US5] `src/index.ts`: `LoadOptions`/`LoadResult` types (contracts/sealing-authority.md's
      shape) and `load(entryPath, options)` — composes `resolve()`, `merge()`, `validate()`,
      collecting `info` diagnostics from every stage into the success path
- [ ] T079 [US5] Sabotage: make `load()` return early on the first `info` lint as if it were fatal —
      confirm T075 fails; restore.

**Checkpoint**: The ordinary embedding path exists and is provably not a second pipeline
implementation.

---

## Phase 8: User Story 6 — A path means something relative to where it was written (Priority: P6)

**Goal**: `resource(configuration, pointer)` — a `path`/`url` value's resolved location, against its
declaring document.

**Independent Test**: a `path` value provided by a house layer in one directory, merged into a
config in another; the reported location resolves against the house layer's directory.

### Conformance cases (write first)

- [ ] T080 [P] [US6] Case: a `path` value's resolved location is available, computed against the
      directory of the document that **declared** it (Acceptance Scenario 1, FR-035) —
      `tests/unit/resource.test.ts`
- [ ] T081 [P] [US6] Case: a `path` value provided by an ancestor layer, inherited by a config in a
      different directory — resolves against the **ancestor's** directory, the discriminating case
      (Acceptance Scenario 2, FR-035, SC-006) — same file, a fixture with schema and config in
      different directories
- [ ] T082 [P] [US6] Case: a `path` value written inside a delegated fragment resolves against the
      **fragment's** own directory (Acceptance Scenario 3, FR-037) — reuse a v0.6 delegation fixture
      with a relative path inside the fragment
- [ ] T083 [P] [US6] Case: a `url` value resolves to itself (Acceptance Scenario 4, FR-036)
- [ ] T084 [P] [US6] Case: a `resource` path resolving **outside the sandbox root** is not refused —
      the resolved location is reported anyway (Acceptance Scenario 5, FR-038) — the case explicitly
      testing the "intuitive-but-wrong" behaviour is absent
- [ ] T085 [P] [US6] Case: no read, no existence check, for any `resource` value (Acceptance
      Scenario 6, FR-039) — assert via a host/fs spy that nothing was touched, not merely by
      inspecting the return value
- [ ] T086 [P] [US6] Case: a `resource` path in a document reached over `https://` — "the declaring
      document's directory" when the declaring document is a URL (Edge Cases) — the resolved
      location is a URL joined against the schema's own URL, not a filesystem path

### Implementation for User Story 6

- [ ] T087 [US6] `src/validate/resource.ts` (new): `resource(configuration, pointer): ResolvedResource`
      per research.md D6 — purely lexical, `span.origin.id`-derived, no schema/demand lookup
- [ ] T088 [US6] `src/index.ts`: export `resource`
- [ ] T089 [US6] Sabotage: break the URL-vs-path branch (treat every string as a path) — confirm
      T083 fails; restore.

**Checkpoint**: All six user stories complete.

---

## Phase 9: Polish & Cross-Cutting

- [ ] T090 [P] `pnpm typecheck` clean, zero `any`, zero assertion casts on the node model
- [ ] T091 [P] `grep -rn SABOTAGE src/ tests/` returns nothing
- [ ] T092 Tick every checkbox in this file as completed
- [ ] T093 Run `quickstart.md` end to end
- [ ] T094 Write the milestone report (ambiguities, invented details, sabotage results, changed
      tests) per CLAUDE.md's Method section

---

## Dependencies & Execution Order

- Setup (T001) → Foundational (T002-T004) → US1 (T005-T013) → US2 (T014-T035) → US3 (T036-T049) →
  US4 (T050-T072) → US5 (T073-T079) → US6 (T080-T089) → Polish (T090-T094).
- US2 and US3 are mutually independent (both sit only on Foundational + US1) and could be
  parallelized by two implementers; this milestone's own guidance keeps them sequential for one
  implementer's sake.
- US4 blocks US5 and US6 structurally (both need the finished `Host` seam and `load()`'s own
  dependency on `resolve()`'s new signature).
- Within each user story, every `[P]`-marked conformance-case task touches a distinct fixture
  file/directory and may be written in parallel; implementation tasks are sequenced by the
  dependencies stated in each task's own text.

## Implementation Strategy

MVP = US1 alone (diagnostic levels + the one lint that consumes them) — independently testable,
independently valuable (closes v0.6's Edge Case), and the prerequisite every later story needs.
Each subsequent story is a complete, independently-testable increment per spec.md's own Independent
Test criteria; commit after each story's checkpoint with a green tree (CLAUDE.md, per-story commits).
