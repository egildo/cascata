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
- [ ] T022 [P] [US2] Case: the same pair validated produces the same outcome, a violation in a fragment identical to inline (Acceptance Scenario 2) — `tests/corpus/cases/validate-delegation/fragment-violation-identical-to-inline/`
- [ ] T023 [P] [US2] Case: a fragment under `cascade: append` accumulates exactly as inline (Acceptance Scenario 3) — `tests/corpus/cases/validate-delegation/fragment-under-append/`
- [x] T024 [P] [US2] Case: a `$`-key inside a fragment is refused (Acceptance Scenario 4, FR-009) — `tests/corpus/cases/validate-delegation/fragment-dollar-key/`
- [ ] T025 [P] [US2] Case: a fragment in a different format from its parent grafts normally (Acceptance Scenario 5, FR-016) — `tests/corpus/cases/validate-delegation/fragment-different-format/` (a TOML or JSON fragment — check `src/adapters/registry.ts` for what's actually registered; YAML-only is fine if no other adapter exists, recorded as a scope note rather than invented)
- [ ] T026 [P] [US2] Case: a fragment whose root is a scalar, and one whose root is a sequence, both graft as written (Acceptance Scenario 6, FR-011) — `tests/corpus/cases/validate-delegation/fragment-scalar-root/`, `.../fragment-sequence-root/`

### Implementation for User Story 2

- [ ] T027 [US2] Fix whatever T021-T026 finds — most likely nothing beyond T007/T008's own walk, since indistinguishability is the design's own claim, not separate code

**Checkpoint**: Splitting a config into fragments changes nothing observable.

---

## Phase 5: User Story 3 — An error names the fragment and how it got there (Priority: P3)

### Conformance cases (write first)

- [x] T028 [P] [US3] Case: a violation inside a fragment carries the delegating document and position (Acceptance Scenario 1, FR-017) — `tests/corpus/cases/validate-delegation/violation-in-fragment/`
- [ ] T029 [P] [US3] Case: a violation in a non-delegated value carries no breadcrumb (Acceptance Scenario 2, FR-018) — reuse an existing non-delegated fixture; assert `delegatedFrom` absent
- [ ] T030 [P] [US3] Case: `why()` on a pointer inside a fragment carries the breadcrumb (Acceptance Scenario 3, FR-020) — `tests/unit/delegation-why.test.ts`
- [ ] T031 [P] [US3] Case: a fragment reached through two delegation hops carries a two-hop breadcrumb, outermost first (Acceptance Scenario 4, FR-012b) — `tests/corpus/cases/validate-delegation/two-hop-breadcrumb/`

### Implementation for User Story 3

- [ ] T032 [US3] Fix whatever T028-T031 finds in T009-T012's breadcrumb wiring

**Checkpoint**: Every fragment-sourced diagnostic explains how the fragment was reached.

---

## Phase 6: User Story 4 — A web-published schema cannot make the machine read what it should not (Priority: P4)

### Conformance cases (write first)

- [x] T033 [P] [US4] Case: a delegated `..` escape is refused (Acceptance Scenario 1, FR-022) — `tests/corpus/cases/validate-delegation/sandbox-escape/`
- [x] T034 [P] [US4] Case: an absolute delegated path is refused (Acceptance Scenario 2, FR-023) — `tests/corpus/cases/validate-delegation/absolute-path/`
- [x] T035 [P] [US4] Case: a remote delegation target with no opt-in is refused, naming the user's own opt-in as what's missing (Acceptance Scenario 3, FR-024) — `tests/unit/delegation-remote.test.ts` (moved from a JSON corpus fixture: needs a `RecordedTransport`/`cacheDir`, which `resolve-case.ts`'s descriptor format has no field for — the exact precedent `remote-fetch.test.ts` already set for User Story 3's own remote cases in v0.2)
- [x] T036 [P] [US4] Case: the same with opt-in succeeds under v0.2's remote rules — `tests/unit/delegation-remote.test.ts` (recorded transport, no network — constitution). Written behaviourally per SPEC.md Article VI (Sec16): "the host answered, or the host refused" — a third case in the same file confirms a host refusal (a recorded connection failure) is an ordinary diagnostic, never a thrown exception, with opt-in granted
- [ ] T037 [P] [US4] Case: a delegated path resolves relative to the delegating config's own directory, not the schema's (Acceptance Scenario 5, FR-021) — `tests/corpus/cases/validate-delegation/relative-to-config/`
- [x] T038 [P] [US4] Case: a delegation cycle (including a fragment naming itself, and a two-fragment cycle) is refused (Acceptance Scenario 6, FR-015) — `tests/corpus/cases/validate-delegation/delegation-cycle/`

### Implementation for User Story 4

- [ ] T039 [US4] Fix whatever T033-T038 finds in T006-T008's security wiring

**Checkpoint**: No delegated reference reaches outside what the operator explicitly permitted.

---

## Phase 7: Property Tests & Polish

- [ ] T040 [P] Property test: inline-vs-split identity (FR-014, SC-001) — random configs, randomly split at random granted positions, merged trees compared structurally — `tests/unit/delegation-monotonicity.test.ts`
- [ ] T041 [P] Property test: sandbox confinement (SC-004) — random delegated paths, some escaping, confirm exactly the escaping ones refused
- [ ] T042 Publish `contracts/delegation-resolution.md`'s rules and the new diagnostic codes in `README.md`
- [x] T043 Confirm all 532 pre-v0.6 tests still pass unchanged
- [ ] T044 Run every quickstart.md scenario end to end
- [ ] T045 Verify the six constitution gates, gate 5 (the breadcrumb, Principle III's last phased field) in particular
- [x] T046 **The depth-limit case, verified genuinely reachable (D5)**: a generated chain of `MAX_DELEGATION_DEPTH + 1` fragment files, each delegating to the next, via real `resolve()` — `tests/corpus/cases/validate-delegation/depth-limit/` (generated) — confirm `depth-limit-exceeded`, not a stack overflow, and confirm (unlike v0.5's own depth guard) this is reachable through the public pipeline
- [x] T047 **Sabotage**: make delegation fire on any string that looks like a path, ignoring the grant — confirm every granted case stays green; only T015 (the razor) catches it
- [x] T048 **Sabotage**: drop the per-graft breadcrumb, sharing one `Origin`/provenance record across both grafts of one fragment (FR-013a) — confirm only a diamond case (the same fragment grafted twice) catches it — `tests/corpus/cases/validate-delegation/diamond-fragment/` (new case if T021-T038 didn't already need one)

---

## Incomplete — reported, not silently dropped

T035/T036 (remote delegation) and the README staleness are done as of this correction, per the
coordinator's own priority order. Still not reached: T022, T023, T025, T026, T029, T030, T031, T037,
T040, T041, T042, T044, T045. See the milestone report for why each was deprioritized.

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
