---
description: "Task list for v0.3 — Merge Engine & Provenance"
---

# Tasks: Merge Engine & Provenance

**Input**: Design documents from `/specs/003-merge-engine/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **Included and mandatory.** Principle V requires conformance cases before the code claiming
to conform. Principle II additionally requires **property tests** — the first milestone where it
binds, because merge touches provisions.

**Organization**: Grouped by user story so each is independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no incomplete dependency
- **[Story]**: US1–US4, mapping to spec.md's user stories
- Exact file paths in every task

## What is different about this milestone

- **Principle II binds.** Property tests are a deliverable, not an extra. They are discharged per
  row: `cascade: append` fully, the `Defaults (provide)` row as far as the vocabulary allows, and the
  demand-satisfaction clause **declared deferred rather than stubbed** (research D5).
- **Schema vocabulary is read for the first time** — `keys`, `provide`, `cascade`. Everything else in
  §9's vocabulary (`demand`, `seal`, `final`, `delegate`) must be **ignored**, not guessed at.
- **A module is promoted, not written.** `src/model/pointer.ts` comes from `tests/corpus/runner.ts`.
  Copying it instead would repeat the defect commit `f9aa900` undid.
- **Every pre-existing test stays green.** The count grows each slice — 300 when this list was written, 358 after User Story 1 — so check the current figure rather than a number written here. v0.1's invariants apply to merged trees too: merge does not get
  an exemption for being downstream.

---

## Phase 1: Setup

- [x] T001 Create the `src/merge/` directory skeleton per plan.md's Structure Decision
- [x] T002 [P] Create the corpus case directories tests/corpus/cases/merge-fold/, merge-append/, merge-provenance/, and merge-policy/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pointer module, the schema-vocabulary reader, and the entities every story needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T003 Promote RFC 6901 escape, unescape, and resolution from tests/corpus/runner.ts into src/model/pointer.ts, and make the runner import it rather than keep a copy — depends on T001
- [x] T004 Add pointer **generation** — a node path to its RFC 6901 pointer — in src/model/pointer.ts, since provenance is keyed by pointer and only resolution existed before — depends on T003
- [x] T005 [P] Unit-test pointer round-trips on adversarial keys — `~0`, `~1`, `a~1b`, `a//b`, the empty key, and an astral key — in tests/unit/pointer.test.ts, asserting the unescape ordering that makes `~01` decode to `~1` rather than `/` — depends on T004
- [x] T006 [P] Add the v0.3 diagnostic codes from contracts/diagnostics.md to src/diagnostics/codes.ts, leaving v0.1's and v0.2's untouched
- [x] T007 [P] Define `Layer`, `ProvenanceEntry`, `ProvenanceRecord`, and `MergedConfiguration` in src/merge/provenance.ts per data-model.md
- [x] T008 Read `keys.<name>.provide` and `keys.<name>.cascade` from a schema tree in src/merge/strategy.ts, ignoring `demand`, `seal`, `final`, and `delegate` entirely (FR-001, FR-002) — depends on T006
- [x] T009 Treat an absent, empty, or non-mapping `keys:` section as contributing nothing rather than as an error, in src/merge/strategy.ts (FR-003) — depends on T008
- [x] T010 Derive the ranked `Layer` list from a resolved pedigree — root schema lowest, config highest — in src/merge/fold.ts (FR-005) — depends on T007
- [x] T011 Extend the policed set in tests/unit/layering.test.ts: `src/merge/` may import `model/`, `diagnostics/`, and `graph/`, and may import neither `adapters/` nor `resolve/` — depends on T001

**Checkpoint**: Pointers, vocabulary, entities, and ranking exist. Story work can begin.

---

## Phase 3: User Story 1 — The chain folds into one configuration (Priority: P1) 🎯 MVP

**Goal**: A pedigree plus a config becomes one tree, with provides filling silence and mappings
merging deeply.

**Independent Test**: Fold a two-layer chain — a schema providing two keys, a config overriding one —
and confirm each key holds what contracts/precedence.md predicts.

### Conformance cases for User Story 1 (write first)

- [x] T012 [P] [US1] Cases for a provide filling a silent key, and a config value beating a provide, in tests/corpus/cases/merge-fold/
- [x] T013 [P] [US1] Cases for deep mapping merge — keys present in one layer surviving, keys in both taking the nearer layer's value — in tests/corpus/cases/merge-fold/deep/
- [x] T014 [P] [US1] Cases asserting **non**-mapping pairings replace wholesale: sequence over sequence, scalar over mapping, mapping over scalar, in tests/corpus/cases/merge-fold/replace/
- [x] T015 [P] [US1] Case asserting an explicit null replaces a provided value rather than yielding to it (FR-008), in tests/corpus/cases/merge-fold/nullability/
- [x] T016 [P] [US1] Case asserting a config with no schema folds to its own tree unchanged (FR-009), in tests/corpus/cases/merge-fold/identity/
- [x] T017 [P] [US1] Cases asserting a schema declaring `demand`, `seal`, `final`, or `delegate` merges normally with those keywords inert (FR-002), and that an absent or empty `keys:` section contributes nothing (FR-003), in tests/corpus/cases/merge-fold/inert-vocabulary/

### Implementation for User Story 1

- [x] T018 [US1] Implement the fold over ranked layers, applying contracts/precedence.md's numbered list in order, in src/merge/fold.ts (FR-004, FR-005) — depends on T010
- [x] T019 [US1] Deep-merge mappings and replace every other pairing, recursing only where both sides are mappings, in src/merge/fold.ts (FR-006) — depends on T018
- [x] T020 [US1] Inject `provide` values where the merged result is silent, losing to any nearer layer's value, in src/merge/fold.ts (FR-007) — depends on T018, T008
- [x] T021 [US1] Treat an explicit null as a replacing value rather than an absence, in src/merge/fold.ts (FR-008) — depends on T019
- [x] T022 [US1] Give each merged node the span of the nearest layer contributing it, per research D4, in src/merge/fold.ts — depends on T019
- [x] T023 [US1] Freeze the merged tree and assert v0.1's invariants hold of it — positioned, canonically ordered, deeply frozen — in src/merge/fold.ts (FR-010) — depends on T019
- [x] T024 [US1] Add `merge()` to src/index.ts returning a configuration or diagnostics, never both — depends on T023

**Checkpoint**: A cascade becomes a configuration. MVP complete.

---

## Phase 4: User Story 2 — `cascade: append` accumulates (Priority: P2)

**Goal**: Sequences under `append` accumulate root-first across layers and never lose a contribution.

**Independent Test**: Three layers contributing to an `append` key, one contributing an empty
sequence; every item present, root-first, nothing removed.

### Conformance cases for User Story 2 (write first)

- [x] T025 [P] [US2] Cases for append across three layers asserting root-first order and every item present, in tests/corpus/cases/merge-append/
- [x] T026 [P] [US2] Case asserting an empty contribution removes nothing (FR-012), in tests/corpus/cases/merge-append/empty/
- [x] T027 [P] [US2] Case asserting a key with no declared strategy behaves as `replace` (FR-011), in tests/corpus/cases/merge-append/default/
- [x] T028 [P] [US2] Cases for strategy mutation — a descendant weakening `append` to `replace` asserting `cascade-strategy-weakened`, and a descendant tightening `replace` to `append` asserting it is permitted — in tests/corpus/cases/merge-append/strategy-mutation/ (v0.3 FR-016)
- [x] T029 [P] [US2] Case for the discriminating scenario a v0.3 implementer surfaced — root provides `[a]` with no strategy, a middle layer `[b]`, a leaf declares `append` and provides `[c]` — asserting `[b, c]`, in tests/corpus/cases/merge-append/late-declaration/ (v0.3 FR-026)

### Implementation for User Story 2

- [x] T030 [US2] Implement `append` accumulation root-first in src/merge/strategy.ts (FR-012) — depends on T018, T008
- [x] T031 [US2] Default every undeclared key to `replace` in src/merge/strategy.ts (FR-011) — depends on T008
- [x] T032 [US2] Resolve disagreeing strategy declarations deterministically in src/merge/strategy.ts (v0.3 FR-016) — a descendant may tighten `replace` to `append`, which removes nothing; weakening the other way is T033's refusal. **Superseded wording:** this task said "the nearer layer governing" until `SPEC.md` §5.2 gained its cascade-strategy row; that rule would have let a descendant discard every ancestor's contribution — depends on T030
- [x] T033 [US2] Refuse a strategy weakened away from accumulation, per `SPEC.md` §5.2's cascade-strategy row, in src/merge/strategy.ts (v0.3 FR-016) — depends on T030
- [x] T034 [US2] Apply a strategy from its declaring layer downward rather than uniformly across the key, in src/merge/strategy.ts and src/merge/fold.ts (v0.3 FR-026) — the first implementation read `SPEC.md` §5.2's "once a key accumulates" as governing the whole stack, which let a leaf reach back over an ancestor's settled `replace`; §5.2 now says downward — depends on T030
- [x] T035 [US2] Confine `cascade` and `provide` to top-level keys, with no nested-key syntax invented, in src/merge/strategy.ts (v0.3 FR-027) — an implementer inferred this correctly from §9's worked chain when nothing stated it; now stated

### Property tests for User Story 2 (Principle II — the first milestone it binds)

- [x] T036 [US2] Encode the §5.2 `cascade: append` row as a property test in tests/unit/monotonicity.test.ts: over randomly generated layer stacks, no ancestor's contribution is ever absent from the result, appending never removes an inherited item, and no stack in which a strategy weakens from `append` to `replace` is ever accepted (FR-023, FR-016) — depends on T030
- [x] T037 [US2] Encode the constructible half of the `Defaults (provide)` row in tests/unit/monotonicity.test.ts — a nearer layer may replace a provided value — and record in that file's own doc comment that the demand-satisfaction clause is **deferred to v0.4, not stubbed**, per research D5 (FR-024) — depends on T020

**Checkpoint**: The one §5.2 row this vocabulary can construct is discharged executably.

---

## Phase 5: User Story 3 — Every value can say where it came from (Priority: P3)

**Goal**: A pointer-keyed provenance record built during the fold, and `why` to query it.

**Independent Test**: Three layers all providing one key; `why` returns three entries, winner first,
each with a position in a real document.

### Conformance cases for User Story 3 (write first)

- [x] T038 [P] [US3] Cases asserting a three-layer chain yields a chain of three entries, winner first, each carrying a span (FR-018, FR-019), in tests/corpus/cases/merge-provenance/
- [x] T039 [P] [US3] Case asserting the chain records **overridden** contributions that appear nowhere in the merged tree (FR-022), in tests/corpus/cases/merge-provenance/overridden/
- [x] T040 [P] [US3] Case asserting an `append` key's chain names every contributor as accumulated with no nominated winner (FR-020), in tests/corpus/cases/merge-provenance/append/
- [x] T041 [P] [US3] Cases asserting `why` distinguishes all three outcomes — a chain, `synthesized`, and `unknown-pointer` (v0.3 FR-021) — in tests/corpus/cases/merge-provenance/negatives/
- [x] T042 [P] [US3] Case asserting `why` answers *synthesized* with its contributors for a mapping no layer wrote, distinct from a chain for one a layer did write, in tests/corpus/cases/merge-provenance/synthesized/ (v0.3 FR-021)
- [x] T043 [P] [US3] Case asserting two layers providing byte-identical values both appear in the chain — agreement is not silence, in tests/corpus/cases/merge-provenance/agreement/

### Implementation for User Story 3

- [x] T044 [US3] Build the pointer-keyed provenance record **during** the fold, recording overridden contributions as they lose, in src/merge/provenance.ts (FR-017, FR-022) — depends on T018, T004
- [x] T045 [US3] Carry a span into each entry's own layer document so an author can open the file (FR-018), in src/merge/provenance.ts — depends on T044
- [x] T046 [US3] Mark every contributor to an `append` key as accumulated, nominating no winner (FR-020), in src/merge/provenance.ts — depends on T044, T030
- [x] T047 [US3] Implement `why()` returning a chain, `synthesized` with its contributors, or `unknown-pointer` in src/merge/provenance.ts (v0.3 FR-021) — depends on T044
- [x] T048 [US3] Assert the two structures agree — every pointer resolving in the tree has a chain and every chain's pointer resolves — in tests/unit/provenance-consistency.test.ts, since keeping provenance beside the tree is what makes this failure possible — depends on T044
- [x] T049 [US3] Export `why()` from src/index.ts — depends on T047

**Checkpoint**: Every value accounts for itself, including the values that lost.

---

## Phase 6: User Story 4 — Malformed merge policy is refused (Priority: P4)

**Goal**: Bad policy is refused at the position where it was written; a config cannot set policy.

**Independent Test**: One fixture per failure, each asserting the code and the offending position.

### Conformance cases for User Story 4 (write first)

- [x] T050 [P] [US4] Cases for an unknown `cascade` value and a non-string `cascade` value, asserting `unknown-cascade-strategy` at the value's position, in tests/corpus/cases/merge-policy/unknown/
- [x] T051 [P] [US4] Case for `cascade: merge-by-key` asserting `unimplemented-cascade-strategy` — **not** `unknown` — since §5.3 reserves the name and the author is early rather than wrong, in tests/corpus/cases/merge-policy/reserved/
- [x] T052 [P] [US4] Case for `append` over a scalar and over a mapping, asserting `append-over-non-sequence` in the layer that supplied the offending value, in tests/corpus/cases/merge-policy/append-misuse/
- [x] T053 [P] [US4] Case asserting a **config** declaring `cascade` is ignored and the fold proceeds as though it were not written (FR-015), in tests/corpus/cases/merge-policy/config-policy/
- [x] T054 [P] [US4] Case with **two independent** policy failures in different keys, asserting both are reported from one merge, in tests/corpus/cases/merge-policy/multiple-failures/ (v0.3 FR-025). **Added by the implementer**: the collect-all requirement had an implementation task and no case, and the four named fixtures are all single-failure — each stays green against a fold that returns after the first diagnostic

### Implementation for User Story 4

- [x] T055 [US4] Refuse an unknown or non-string `cascade` value, naming the supported strategies, in src/merge/strategy.ts (FR-014) — depends on T008, T006
- [x] T056 [US4] Refuse `merge-by-key` distinctly as unimplemented rather than unknown, in src/merge/strategy.ts (FR-014) — depends on T055
- [x] T057 [US4] Refuse `append` over a non-sequence at the offending value's position, in src/merge/strategy.ts (FR-013) — depends on T030
- [x] T058 [US4] Confirm a config's `cascade` declaration is ignored so policy comes from schemas only, in src/merge/strategy.ts (v0.3 FR-015). **Required no new code** — User Story 2's strategy reader already skipped non-schema layers; the implementer verified it by sabotage rather than inventing code to satisfy the task's wording — depends on T008
- [x] T059 [US4] Report every policy failure the fold can determine independently rather than only the first, in src/merge/fold.ts — depends on T055, T057

**Checkpoint**: Merge policy belongs to the contract, and the boundary is enforced.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T060 [P] Publish contracts/precedence.md's numbered list in README.md alongside the merge surface and the v0.3 diagnostic codes (SC-008)
- [x] T061 [P] Restore the byte-precise `end` assertion dropped from the T014 replace-wholesale case: an independently derived offset disagreed with the adapter by one on a block mapping's trailing newline, and the implementer kept `start`/`line`/`column` rather than copy the implementation's number — settle which is right, in tests/corpus/merge-cases/ (research.md's open block-collection extent question)
- [x] T062 [P] Confirm merging is deterministic — same pedigree and config give a byte-identical tree and identical chains in identical order — in tests/unit/merge-determinism.test.ts (SC-005)
- [x] T063 [P] Confirm a merged tree satisfies every v0.1 invariant, using v0.1's own assertions applied to a merged result, in tests/unit/merged-invariants.test.ts (SC-006)
- [x] T064 Confirm every pre-existing test still passes unchanged — the baseline is whatever the previous slice left green, not a fixed number; it was 300 when this list was written and 358 by the end of User Story 1, so nothing in specs/001-information-model-yaml-adapter/ or specs/002-resolver-dag-builder/ regressed
- [ ] T065 Run every validation scenario in specs/003-merge-engine/quickstart.md end to end, reporting any scenario that no longer matches reality and which of the two is wrong
- [ ] T066 Verify the six merge gates in .specify/memory/constitution.md — noting that gate 3, Monotonicity, is **applicable for the first time** and discharged by T036 and T037 rather than declared not-applicable

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks all stories**
- **US1 (Phase 3)**: depends on Foundational
- **US2 (Phase 4)**: depends on US1's fold
- **US3 (Phase 5)**: depends on US1's fold; provenance is built during it, not after
- **US4 (Phase 6)**: depends on US2's strategy reader
- **Polish (Phase 7)**: depends on all stories

### Story independence — stated honestly

US1 is a genuine standalone deliverable. US2, US3, and US4 all extend the fold US1 builds: append is a
strategy applied during it, provenance is recorded during it, policy refusal happens while reading the
vocabulary that drives it. This is inherent — a merge engine is one traversal, not four — and each
story still has its own checkpoint and separately testable value.

### Within each story

- Conformance cases before the code they judge (Principle V)
- Pointer and vocabulary before the fold; the fold before the strategies and provenance built on it

### Parallel opportunities

- T002 in Setup; T005, T006, T007 in Foundational
- **All of T012–T017** (US1 cases), **T025–T027** (US2), **T038–T043** (US3), **T050–T053** (US4) —
  each group is separate directories with no shared state
- T060, T062, T063 in Polish

---

## Parallel Example: User Story 1 conformance cases

```bash
# Six independent directories, authorable simultaneously:
Task: "Provide-and-override cases in tests/corpus/cases/merge-fold/"
Task: "Deep mapping merge cases in tests/corpus/cases/merge-fold/deep/"
Task: "Replace-wholesale cases in tests/corpus/cases/merge-fold/replace/"
Task: "Null-as-value case in tests/corpus/cases/merge-fold/nullability/"
Task: "Identity fold case in tests/corpus/cases/merge-fold/identity/"
Task: "Inert-vocabulary cases in tests/corpus/cases/merge-fold/inert-vocabulary/"
```

---

## Implementation Strategy

### MVP (User Story 1 only)

Setup → Foundational → US1. Stop and validate: a pedigree and a config become one configuration. That
is the first result in three milestones a consuming application could actually use, and it is worth
landing before append, provenance, or policy refusal.

### Incremental delivery

1. Setup + Foundational → pointers, vocabulary, entities, ranking
2. US1 → the fold → validate
3. US2 → accumulation, and the first property tests → validate
4. US3 → provenance and `why` → validate
5. US4 → policy refusal → validate

---

## Notes

**Four tasks carry most of the risk. Each has a failure mode that passes a naive test:**

- **T019 (deep merge is mappings only)** — merging sequences element-wise looks plausible and passes
  every mapping test. T014's replace-wholesale cases are the only guard, and `cascade: append` exists
  precisely so element-wise merging is never needed.
- **T044 (provenance built during the fold)** — a record assembled by inspecting the merged result
  passes every test about winners and fails only on overridden contributions, which are gone by then.
  T039 is the guard, and §10 calls this the part that cannot be retrofitted.
- **T036 (the append property test)** — a property test that generates only well-behaved stacks
  asserts nothing. It must generate stacks that would break a naive implementation: empty
  contributions, single-layer stacks, layers contributing in orders that tempt a sort.
- **T022 (merged node spans)** — every node must carry a position that means something. A synthetic
  or borrowed span passes every structural assertion and quietly breaks "open the file and see the
  line", which is the whole point of Principle III.

**Also**: 300 existing tests stay green (T064), and v0.1's invariants apply to merged trees — merge
does not get an exemption for being downstream (T023, T063).
