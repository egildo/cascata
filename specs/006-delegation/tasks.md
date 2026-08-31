---
description: "Task list for v0.6 — Delegation (Transclusion)"
---

# Tasks: Delegation (Transclusion)

**Input**: Design documents from `/specs/006-delegation/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/delegation-resolution.md](./contracts/delegation-resolution.md)

**Tests**: Included and mandatory (Principle V).

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Create `tests/corpus/cases/validate-delegation/` directory

---

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T002 [P] `src/model/reference.ts`: add `"delegate"` to `ReferenceKind`
- [x] T003 [P] `src/diagnostics/codes.ts`: add `DELEGATION_CODES` (`delegate-value-unimplemented`,
      `fragment-reserved-key`, `remote-delegation-not-permitted`, `absolute-delegated-path`) — four new;
      `document-unreachable`, `reference-cycle`, `sandbox-escape`, `unsupported-scheme`,
      `depth-limit-exceeded` reused
- [x] T004 `src/resolve/delegate.ts`: `collectDelegationGrants(schemaTree, layer): {tree: DelegationGrantNode, problems: Diagnostic[]}` — reads `keys.<name>.delegate` and nested `keys.<child>.delegate` to arbitrary depth (D2: `keys` only), refusing anything but `allow` as `delegate-value-unimplemented`
- [x] T005 `src/resolve/delegate.ts`: `mergeGrantTrees(trees)` — unions grants across every schema layer in the pedigree (a grant from any layer makes a position delegable)
- [x] T006 `src/resolve/delegate.ts`: delegation-specific sandbox/absolute-path checks — `isAbsoluteDelegatedPath` (raw text, `path.isAbsolute`) and unconditional `isWithinSandbox` reuse (D6) — no `~/`-expansion, no authority exemption
- [x] T007 `src/resolve/delegate.ts`: `resolveDelegations(configTree, grantTree, configLocation, sandboxRoot, options)` — the transclusion walk (contracts/delegation-resolution.md's algorithm): per-graft `Origin` synthesis (D3), a dedicated `GraphBuilder` shared across the whole walk for cycle detection (FR-015/FR-026), `MAX_DELEGATION_DEPTH = 64` hop counter (D5), `$`-key refusal in fragment roots (FR-009), `resolveAllBranches` for sibling delegable positions (FR-027)
- [x] T008 `src/index.ts`: wire `resolveDelegations` into `resolve()` between pedigree assembly and `buildGraph`/`buildPedigree` — replace `graph.entry.tree` with the grafted tree; new `ResolveOptions.allowRemoteDelegation?: boolean` (FR-024)
- [x] T009 `src/merge/provenance.ts`: `MergedConfiguration.delegationBreadcrumbs: ReadonlyMap<string, readonly DelegationHop[]>`; threaded from `resolve()`'s own delegation-walk output through `merge()`
- [x] T010 `src/diagnostics/diagnostic.ts`: `Diagnostic.delegatedFrom?: readonly DelegationHop[]`
- [x] T011 `src/validate/violation.ts`: `Violation.delegatedFrom?`; `canonicalSentence` renders the `(delegated from ...)` clause when present; `renderViolation` threads it into `Diagnostic.delegatedFrom`
- [x] T012 `src/validate/check.ts`: `layerForSpanOrigin` gains the delegation fallback (D4) — an origin not matching any layer is checked against `configuration.delegationBreadcrumbs`; attributed to the config layer, breadcrumb attached to every violation built from that value
- [x] T013 `tests/unit/layering.test.ts` still green with no new boundary crossing (`src/resolve/delegate.ts` imports only `model/`, `graph/`, `diagnostics/`, and `resolve/location.ts`'s own siblings)

**Checkpoint**: Grants can be read and unioned; a config tree can be walked and grafted; the breadcrumb
has somewhere to live end to end. Nothing yet exercises it through `resolve()`.

---

## Phase 3: User Story 1 — A schema grants a key the right to be split into its own file (Priority: P1) 🎯 MVP

### Conformance cases (write first)

- [x] T014 [P] [US1] Case: a granted key accepts a path, fragment grafted at that position (Acceptance Scenario 1) — `tests/corpus/cases/validate-delegation/basic-grant/`
- [x] T015 [P] [US1] Case: **the razor** — an ungranted key with the identical string stays a string (Acceptance Scenario 2, FR-005, SC-002) — `tests/corpus/cases/validate-delegation/ungranted-key-stays-string/`
- [x] T016 [P] [US1] Case: a grant never compels — an inline mapping at a granted key is used as written (Acceptance Scenario 3, FR-004) — `tests/corpus/cases/validate-delegation/grant-not-compelled/`
- [x] T017 [P] [US1] Case: an unrecognized `delegate:` value is refused at its own position (Acceptance Scenario 4, FR-002) — `tests/corpus/cases/validate-delegation/delegate-value-unimplemented/`
- [x] T018 [P] [US1] Case: a config's own `delegate:` has no effect (Acceptance Scenario 5, FR-003) — `tests/corpus/cases/validate-delegation/config-delegate-ignored/`
- [x] T019 [P] [US1] Case: a delegated path naming a file that does not exist is refused at the delegating value's own position (Acceptance Scenario 6) — `tests/corpus/cases/validate-delegation/missing-fragment/`

### Implementation for User Story 1

- [x] T020 [US1] Wire T014-T019's shapes end to end through `resolve()`; fix whatever T004-T012 gets wrong against hand-derived expectations

**Checkpoint**: A granted key can be split into a file and grafted; an ungranted key never is.

---

## Phase 4: User Story 2 — A fragment is indistinguishable from having written it inline (Priority: P2)

### Conformance cases (write first)

- [x] T021 [P] [US2] Case: inline vs. split configs produce identical merged trees (Acceptance Scenario 1, FR-014, SC-001) — `tests/corpus/cases/validate-delegation/inline-identity-{inline,split}/`
- [x] T022 [P] [US2] Case: the same pair validated produces the same outcome, a violation in a fragment identical to inline (Acceptance Scenario 2) — implemented as `tests/corpus/cases/validate-delegation/violation-inline-counterpart/` (name adjusted from the task's own suggestion) + `tests/unit/delegation-violation-identical-to-inline.test.ts`, which compares the fragment-sourced diagnostic against the inline-sourced one field-by-field (code/pointer/reason/demand-pointer equal, `delegatedFrom` present vs. absent) — this single test discharges both T022 and T029 together
- [x] T023 [P] [US2] Case: a fragment under `cascade: append` accumulates exactly as inline (Acceptance Scenario 3) — `tests/corpus/cases/validate-delegation/fragment-under-append/` + `tests/corpus/validate-cases/T023-fragment-under-append.json`, asserting the actual accumulated tree `["root-item","frag-item"]` (root-first, confirmed against a debug run, not merely `ok:true`)
- [x] T024 [P] [US2] Case: a `$`-key inside a fragment is refused (Acceptance Scenario 4, FR-009) — `tests/corpus/cases/validate-delegation/fragment-dollar-key/`
- [x] T025 [P] [US2] Case: a fragment in a different format from its parent grafts normally (Acceptance Scenario 5, FR-016) — **SCOPE NOTE, not implemented as a cross-format fixture**: `src/adapters/registry.ts` registers exactly one adapter (`yaml`; its own doc comment: "JSON/TOML are v1.x, out of scope"), and `formatForLocation` recognizes only `.yaml`/`.yml`. There is no second adapter in this codebase to graft a fragment *from*, so Acceptance Scenario 5 cannot be exercised as a real cross-format fixture without inventing a fake adapter, which would prove nothing about the real format-blindness boundary. FR-016's actual claim — "a fragment may be in a different format than its parent — trivially true under the information model" — is a claim about the *architecture* (the `AdapterParseOutcome`/`Node` boundary `performGraft` re-parses through in `src/index.ts`, identical to how `resolve()` itself parses the entry document), not about any one format pairing; that boundary is already exercised by every existing delegation fixture, since each graft calls `parseYamlBytes` fresh through the same registry seam the top-level document uses. Recorded here as a scope note, per this task's own pre-written fallback, rather than invented.
- [x] T026 [P] [US2] Case: a fragment whose root is a scalar, and one whose root is a sequence, both graft as written (Acceptance Scenario 6, FR-011) — `tests/corpus/cases/validate-delegation/fragment-scalar-root/` + `tests/corpus/validate-cases/T026-fragment-scalar-and-sequence-roots.json`; the sequence-rooted case is already exercised by T023's `fragment-under-append/fragment.yaml` (a bare sequence at the fragment root), so no separate `fragment-sequence-root/` fixture was added — noted directly in T026's own case name rather than duplicated

### Implementation for User Story 2

- [x] T027 [US2] Fix whatever T021-T026 finds — confirmed: nothing beyond T007/T008's own walk needed fixing. The one genuine surprise (T040's first draft treating an inline string at a granted key as a delegation target) was a *test-design* error, not a `resolve()` defect — see T040's own note.

**Checkpoint**: Splitting a config into fragments changes nothing observable.

---

## Phase 5: User Story 3 — An error names the fragment and how it got there (Priority: P3)

### Conformance cases (write first)

- [x] T028 [P] [US3] Case: a violation inside a fragment carries the delegating document and position (Acceptance Scenario 1, FR-017) — `tests/corpus/cases/validate-delegation/violation-in-fragment/`
- [x] T029 [P] [US3] Case: a violation in a non-delegated value carries no breadcrumb (Acceptance Scenario 2, FR-018) — folded into T022's `delegation-violation-identical-to-inline.test.ts` (see T022): the inline counterpart's diagnostic is asserted to have `delegatedFrom` undefined in the same test that asserts the fragment counterpart's is defined
- [x] T030 [P] [US3] Case: `why()` on a pointer inside a fragment carries the breadcrumb (Acceptance Scenario 3, FR-020) — `tests/unit/delegation-why.test.ts`; required adding `delegatedFrom?` to `ProvenanceEntry` (`src/merge/provenance.ts`) and a lazy `withBreadcrumb()` helper applied in `why()`'s `"chain"`/`"synthesized"` return paths — see the milestone report for why this, not just a unit test, was the fix (closes the harness gap the coordinator flagged for US3)
- [x] T031 [P] [US3] Case: a fragment reached through two delegation hops carries a two-hop breadcrumb, outermost first (Acceptance Scenario 4, FR-012b) — `tests/corpus/cases/validate-delegation/two-hop-breadcrumb/` + `tests/unit/delegation-two-hop-breadcrumb.test.ts`, asserting `hops[0]`=config.yaml, `hops[1]`=hop-a.yaml, outermost-first, matching §10's canonical sentence ordering

### Implementation for User Story 3

- [x] T032 [US3] Fix whatever T028-T031 finds in T009-T012's breadcrumb wiring — the one real defect this phase surfaced (the cycle-tracker popping its stack before the recursive walk returned, so a genuine cycle was read as a fresh visit) was found and fixed earlier, during the original T028/T038 work, not by T029-T031; those three found nothing further wrong.

**Checkpoint**: Every fragment-sourced diagnostic explains how the fragment was reached.

---

## Phase 6: User Story 4 — A web-published schema cannot make the machine read what it should not (Priority: P4)

### Conformance cases (write first)

- [x] T033 [P] [US4] Case: a delegated `..` escape is refused (Acceptance Scenario 1, FR-022) — `tests/corpus/cases/validate-delegation/sandbox-escape/`
- [x] T034 [P] [US4] Case: an absolute delegated path is refused (Acceptance Scenario 2, FR-023) — `tests/corpus/cases/validate-delegation/absolute-path/`
- [x] T035 [P] [US4] Case: a remote delegation target with no opt-in is refused, naming the user's own opt-in as what's missing (Acceptance Scenario 3, FR-024) — `tests/unit/delegation-remote.test.ts` (moved from a JSON corpus fixture: needs a `RecordedTransport`/`cacheDir`, which `resolve-case.ts`'s descriptor format has no field for — the exact precedent `remote-fetch.test.ts` already set for User Story 3's own remote cases in v0.2)
- [x] T036 [P] [US4] Case: the same with opt-in succeeds under v0.2's remote rules — `tests/unit/delegation-remote.test.ts` (recorded transport, no network — constitution). Written behaviourally per SPEC.md Article VI (Sec16): "the host answered, or the host refused" — a third case in the same file confirms a host refusal (a recorded connection failure) is an ordinary diagnostic, never a thrown exception, with opt-in granted
- [x] T037 [P] [US4] Case: a delegated path resolves relative to the delegating config's own directory, not the schema's (Acceptance Scenario 5, FR-021) — `tests/corpus/cases/validate-delegation/relative-to-config/` (schema lives in a `schemas/` subdirectory; config and fragment sit beside each other at the top level, so the fragment would be `document-unreachable` if schema's directory were used instead) + `tests/corpus/validate-cases/T037-relative-to-config.json` asserting the grafted tree
- [x] T038 [P] [US4] Case: a delegation cycle (including a fragment naming itself, and a two-fragment cycle) is refused (Acceptance Scenario 6, FR-015) — `tests/corpus/cases/validate-delegation/delegation-cycle/`

### Implementation for User Story 4

- [x] T039 [US4] Fix whatever T033-T038 finds in T006-T008's security wiring — confirmed nothing further: `reference-cycle`, `sandbox-escape`, and `absolute-delegated-path` are all exercised by real fixtures (T033, T037, T038, plus the new T041 property test) and none needed a fix beyond what T020's original wiring pass already found.

**Checkpoint**: No delegated reference reaches outside what the operator explicitly permitted.

---

## Phase 7: Property Tests & Polish

- [x] T040 [P] Property test: inline-vs-split identity (FR-014, SC-001) — random configs, randomly split at random granted positions, merged trees compared structurally — `tests/unit/delegation-monotonicity.test.ts` (25 trials, seeded `mulberry32`). **Ambiguity found while writing this test, worth reporting**: the first draft used `type: string` demands and compared inline string literals against delegated ones; every "inline" string at a granted key was itself treated as a delegation target (per SPEC.md Sec8's own worked example: a string at a granted key means "load and graft" *unconditionally*, regardless of the key's own demand type), so the draft's inline variant failed with `sandbox-escape` on ordinary data. This is the razor working as designed, not a pipeline bug — but it means **a granted key can never hold an inline string literal**, which is not stated anywhere in SPEC.md Sec8 or the FRs and is easy to miss. Fixed by using single-field mappings (`demand: type: mapping`) as the unit of comparable data instead, per `grant-not-compelled`'s own precedent. Sabotage-tested: corrupting the fragment's written value turned the property red across nearly every trial (24/25, since most trials have at least one delegated key), confirming the test is not vacuous; restored clean.
- [x] T041 [P] Property test: sandbox confinement (SC-004) — random delegated paths, some escaping, confirm exactly the escaping ones refused — `tests/unit/delegation-sandbox-confinement.test.ts` (25 trials: random nesting depth for the delegating config, random `../` hop count for the delegated path; `hops <= depth` must resolve inside the sandbox including the exact boundary, `hops > depth` must be refused with `sandbox-escape`). Sabotage-tested: stubbing `isWithinSandbox` to always return `true` turned exactly the escaping trials red (16 of 25 — the other 9 trials had `hops <= depth` by chance and stayed green, correctly), never all 25, confirming the property discriminates rather than passing vacuously; restored clean.
- [x] T042 Publish `contracts/delegation-resolution.md`'s rules and the new diagnostic codes in `README.md` — done in the mid-milestone Article VI pass (commit `8a113e5`): a full `### Delegation (SPEC.md Sec8, Article VI, v0.6)` section plus a `### v0.6 diagnostic codes` table (4 new + 5 reused codes). Verified still accurate against the final code — no further changes needed.
- [x] T043 Confirm all 532 pre-v0.6 tests still pass unchanged
- [x] T044 Run every quickstart.md scenario end to end — all 11 scenarios exercised against real fixtures/unit tests (`pnpm vitest run tests/corpus/validate-corpus.test.ts tests/unit/delegation-monotonicity.test.ts tests/unit/delegation-sandbox-confinement.test.ts tests/unit/delegation-depth-limit.test.ts tests/unit/layering.test.ts` plus the remaining delegation unit tests), all green. Scenario 11's own text was **corrected in place** (not settled-noted) — it claimed a 65-real-file fixture reaches `MAX_DELEGATION_DEPTH`, which research.md D5's own correction already found false; quickstart.md is a runnable script, so a false claim there actively misleads a reader who tries it, unlike a historical record.
- [x] T045 Verify the six constitution gates — see the milestone report for the full walk. One gap found and closed: **Principle V's probe gate** had no non-ASCII probe specific to the delegation fresh-parse-per-graft path (every existing non-ASCII case in the corpus predates delegation and exercises only the entry-document parse path, which uses a different `Origin`/`LineCounter` instance than a graft does). Added `tests/corpus/cases/validate-delegation/fragment-non-ascii/` + `tests/corpus/validate-cases/T045-fragment-non-ascii-probe.json`: an astral-plane emoji and a precomposed accented character precede the violating value on the same flow-mapping line inside the fragment; the reported column (24) was hand-derived independently by code-point counting and confirmed to match the pipeline's actual output — a UTF-16 code-unit leak in the delegation-specific re-parse path would have reported column 25. It did not leak; the path is clean, but the gate had not actually been discharged for it before this.
- [x] T046 **The depth-limit case, verified genuinely reachable (D5)**: a generated chain of `MAX_DELEGATION_DEPTH + 1` fragment files, each delegating to the next, via real `resolve()` — `tests/corpus/cases/validate-delegation/depth-limit/` (generated) — confirm `depth-limit-exceeded`, not a stack overflow, and confirm (unlike v0.5's own depth guard) this is reachable through the public pipeline
- [x] T047 **Sabotage**: make delegation fire on any string that looks like a path, ignoring the grant — confirm every granted case stays green; only T015 (the razor) catches it
- [x] T048 **Sabotage**: drop the per-graft breadcrumb, sharing one `Origin`/provenance record across both grafts of one fragment (FR-013a) — confirm only a diamond case (the same fragment grafted twice) catches it — `tests/corpus/cases/validate-delegation/diamond-fragment/` (new case if T021-T038 didn't already need one)

---

## Closed out

Every task above is ticked. Two are ticked as an explicit **scope note** rather than a literal
implementation of their original wording, both recorded in place rather than silently reinterpreted:

- **T025** (format-freedom, cross-format fragment): no second format adapter exists in this
  codebase (`src/adapters/registry.ts` registers YAML only; JSON/TOML are v1.x). FR-016's actual
  claim is architectural — the graft path reuses the same `AdapterParseOutcome`/registry seam the
  entry document itself parses through — and that is exercised by every delegation fixture already.
  No fake adapter was invented to force a literal cross-format fixture.
- **T027/T032/T039** ("fix whatever the preceding cases found"): confirmed nothing new; the one
  real defect this milestone's implementation surfaced (the cycle tracker popping its stack before
  the recursive walk returned, misreading a genuine cycle as a fresh visit) was found and fixed
  earlier, during the original T020/T038 work, not by this later batch of cases.

Two items un-ticked as of the previous report round turned out, once actually built, to surface
genuine findings rather than being ordinary paperwork:

- **T040** (inline-vs-split property test): its first draft used `type: string` demands and
  compared inline string literals against delegated ones — every "inline" string at a granted key
  is *itself* a delegation trigger (SPEC.md Sec8's own worked example says so; it just is not stated
  as a consequence anywhere), so the draft failed with spurious `sandbox-escape` diagnostics on
  ordinary data, not a pipeline bug. Fixed by using single-field mappings as the comparable unit.
- **T045** (constitution gate verification): surfaced a genuine, previously-undischarged gap in
  Principle V's probe gate — no non-ASCII probe existed for the delegation-specific
  fresh-parse-per-graft path specifically (as opposed to the entry-document parse path, which many
  pre-v0.6 cases already probe). Closed with a new fixture; the path turned out clean, but the gate
  had not actually been checked for it before this pass.

**The corpus JSON harness now supports asserting `delegatedFrom`** (`tests/corpus/validate-case.ts`,
`tests/corpus/validate-runner.ts`) — the gap the coordinator's own message flagged as leaving US3
"structurally under-covered". T013 and T028's own JSON cases assert the breadcrumb directly now;
`tests/unit/delegation-diamond-breadcrumb.test.ts` is kept as an independent regression guard rather
than deleted, since a harness-schema regression could silently reopen the exact blind spot that made
it necessary in the first place.

## Notes

- Conformance cases before the code that judges them (Principle V), every expected value derived by
  hand against `spec.md`/`SPEC.md` §8, never by copying implementation output.
- Every citation: "v0.6 FR-nnn".
- `pnpm typecheck && pnpm test` green, tree clean, at every checkpoint.
