---
description: "Task list for v0.4 — Constraint Checker & Whole-Chain Validation"
---

# Tasks: Constraint Checker & Whole-Chain Validation

**Input**: Design documents from `/specs/004-constraint-checker/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **Included and mandatory.** Principle V requires conformance cases before the code claiming
to conform. Principle II binds again — `demand` makes four more §5.2 rows constructible (Types,
Enums/unions, Ranges/predicates, `required`); each needs its own property test.

**Organization**: Grouped by user story so each is independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no incomplete dependency
- **[Story]**: US1–US4, mapping to spec.md's user stories
- Exact file paths in every task

## What is different about this milestone

- **Gate 5 is satisfied at full strength for the first time.** Every diagnostic this milestone
  produces carries pointer + violated demand + pedigree position, not merely code + sentence + span.
- **A new runtime dependency is added** — `picomatch`, on the constitution's own allow-list, needed
  because §7 names it by name as `glob`'s implementation. Already added and probed during Phase 0
  research (research.md D4) — see T001.
- **This milestone reads `demand`; `seal`/`final`/`delegate` stay ignored**, unchanged from v0.3
  FR-002's posture, now for the fourth consecutive milestone.
- **Whole-chain validation is the point, not an optimization.** A validator that only checks the
  nearest layer passes every single-schema case and fails silently the moment a chain has two —
  see the Notes section's sabotage guidance.
- **Every pre-existing test stays green.** The count grows each slice — 424 when this list was
  written — so check the current figure rather than a number written here.

---

## Phase 1: Setup

- [x] T001 Add `picomatch` (runtime) and `@types/picomatch` (dev) to `package.json` — already done and probed during Phase 0 research (research.md D4); this task records it as a Setup step rather than a silent side effect of research
- [x] T002 Create the `src/validate/` directory skeleton per plan.md's Structure Decision
- [x] T003 [P] Create the corpus case directories `tests/corpus/cases/validate-single-layer/`, `validate-whole-chain/`, `validate-required/`, `validate-vocabulary/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The vocabulary reader, the type-expression grammar, the additive `Diagnostic`/
`MergedConfiguration` fields, and the policed boundary — everything every story needs before any of
them can check a single value.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 [P] Add v0.4's vocabulary and violation diagnostic codes from `contracts/diagnostics.md` to `src/diagnostics/codes.ts`, leaving v0.1's–v0.3's untouched
- [x] T005 [P] Add the three additive optional fields (`pointer`, `demand`, `pedigreePosition`) to `Diagnostic` and `createDiagnostic`'s parameter in `src/diagnostics/diagnostic.ts`, typed in primitives (`SourceSpan`, never `Layer`) per data-model.md — confirm every pre-v0.4 call site still compiles with no edits
- [x] T006 [P] Add the additive `layers: readonly Layer[]` field to `MergedConfiguration` in `src/merge/provenance.ts` — depends on T004 not required, independent file
- [x] T007 Populate `layers` in `foldConfiguration`'s `ok: true` result in `src/merge/fold.ts`, from the `deriveLayers(graph)` call it already makes internally — no new computation, only carrying forward what already exists (plan.md finding 2) — depends on T006
- [x] T008 Extend the policed sets in `tests/unit/layering.test.ts`: add `"src/validate"` to `NO_ADAPTER_IMPORT_DIRS` and to the resolve-boundary check, before any file exists under it, per the v0.2/v0.3 precedent — depends on T002
- [x] T009 Read `keys.<name>.demand` from a schema tree into a raw `{keyword: Node}` map per key in `src/validate/vocabulary.ts`, mirroring `src/merge/strategy.ts`'s `readKeysVocabulary` reading style (absent/empty/non-mapping `keys:` contributes nothing, v0.3 FR-003's rule) but for the field that function ignores (FR-001, FR-004) — no shape or closed-vocabulary checking yet, that is US4's job (T009 only extracts what is there) — depends on T002
- [x] T010 [P] Implement §9.1's leaf DSL grammar — parse, canonical set form (flatten + dedupe, `[]` binds tighter than `\|`), name resolution against FR-011's closed built-in set — in `src/validate/typeexpr.ts`. Return a structured parse failure (not yet wired to a diagnostic) for input that does not parse or names an unresolvable type — FR-008, FR-009, FR-010, FR-011, FR-012 read together; wiring the failure to `malformed-type-expression`/`unknown-type-name` diagnostics is US4's job — depends on T002
- [x] T011 [P] Define `Demand`, `Violation`, and `ValidationResult` per data-model.md in `src/validate/violation.ts` — types and construction helpers only, no checking logic yet — depends on T002
- [x] T012 Add a `validate()` stub to `src/index.ts` that takes a `MergedConfiguration` and returns `{ok: true, certified: configuration}` unconditionally, wiring the pipeline shape (FR-019) before any story fills it in — depends on T007, T011

**Checkpoint**: Vocabulary reading, the type grammar, the additive fields, and the policed boundary
all exist. Story work can begin.

---

## Phase 3: User Story 1 — A configuration is judged against its schema's demands (Priority: P1) 🎯 MVP

**Goal**: A single schema layer's `type`, `min`/`max`, `minLength`/`maxLength`, `pattern`, `enum`, and
`items` demands are checked against a merged tree, each violation carrying both a demand position and
a value position.

**Independent Test**: Validate a merged two-layer configuration against a schema demanding a type and
a range on one key; confirm a conforming value passes and a violating value is reported with the
demand's own position and the value's own position.

### Conformance cases for User Story 1 (write first)

- [x] T013 [P] [US1] Cases for `type` — a matching scalar, a mismatched scalar, a matching `T[]` sequence, and a sequence with one mismatched item pointing at that item specifically (spec.md Acceptance Scenario 6) — in `tests/corpus/cases/validate-single-layer/type/`
- [x] T014 [P] [US1] Cases for `min`/`max` — a value inside the range, one at each boundary (inclusive), one outside each direction, and one mixing an `int` value against a `float` bound (research.md D5) — in `tests/corpus/cases/validate-single-layer/range/`
- [x] T015 [P] [US1] Cases for `minLength`/`maxLength` — a boundary-exact string, a string one code point over/under, and a non-ASCII case (an astral-plane emoji, and a combining-character sequence) asserting code-point counting per research.md's probe — in `tests/corpus/cases/validate-single-layer/length/`
- [x] T016 [P] [US1] Cases for `pattern` — a matching string, a non-matching string, naming ECMA-262 as the dialect (§7) — in `tests/corpus/cases/validate-single-layer/pattern/`
- [x] T017 [P] [US1] Cases for `enum` — a member value, a non-member value, and a case distinguishing `int 1`/`float 1.0`/`string "1"` as three distinct members via `nodesEqual` (contracts/demand-vocabulary.md) — in `tests/corpus/cases/validate-single-layer/enum/`
- [x] T018 [P] [US1] Case for `items` — a nested demand under `items:` applied to each element of a sequence, one element violating it, pointed at by index — in `tests/corpus/cases/validate-single-layer/items/`
- [x] T019 [P] [US1] Case asserting a key no demand mentions accepts any value (FR-021) — in `tests/corpus/cases/validate-single-layer/silence/`
- [x] T020 [P] [US1] Case asserting a schema's own `provide` is checked exactly like a config-written value, at the `provide`'s own position (FR-020, spec.md Acceptance Scenario 8) — in `tests/corpus/cases/validate-single-layer/provide-not-exempt/`

### Implementation for User Story 1

- [x] T021 [US1] Implement the leaf checks — `type`, `min`, `max`, `minLength`, `maxLength`, `pattern`, `enum` — as pure `(demand value, target Node) -> Violation | undefined` functions in `src/validate/constraints.ts`, per contracts/demand-vocabulary.md's semantics table (FR-013) — depends on T010, T011
- [x] T022 [US1] Implement `items`, recursing into the same leaf-check table for each `Sequence` item, pointing at `<sequencePointer>/<index>` (contracts/demand-vocabulary.md's "Nested demand under `items`") — depends on T021
- [x] T023 [US1] Implement the single-layer walk: for each demanded key, `resolvePointer` the merged tree, run every declared demand's check, collect violations — in `src/validate/check.ts` (FR-013) — depends on T021, T022, T009. **Turned out to iterate every layer in `configuration.layers` from this first version, not a deliberately leaf-only pass** — `configuration.layers` is already root-to-leaf, and checking fewer of them would have been the *extra* code, not less. T031 (US2) therefore adds no loop-structure change, only the conformance/property/sabotage cases that prove the whole-chain property holds — see the milestone report
- [x] T024 [US1] Implement `Violation`'s rendering into a `Diagnostic` — `pointer`, `demand` (pointer+span into the declaring document), `pedigreePosition`, and §10's canonical sentence built from structured fields alone — in `src/validate/violation.ts` (FR-022, FR-023, FR-024, FR-025) — depends on T011, T005
- [x] T025 [US1] Wire `check.ts`'s walk into `validate()` in `src/index.ts`, replacing the T012 stub for the single-layer case — depends on T023, T024, T012

**Checkpoint**: A configuration can be judged against one schema's demands. MVP complete.

---

## Phase 4: User Story 2 — Every layer judges, not just the nearest (Priority: P2)

**Goal**: Every schema layer's demands are checked against the merged tree, root to leaf — not the
nearest layer alone — with restated-and-satisfied demands costing nothing extra and independently
violated layers each producing their own diagnostic.

**Independent Test**: A three-layer chain whose root demands more than its descendant does; confirm a
value satisfying the descendant but violating the root is rejected, and that the diagnostic cites the
root's document and position, not the descendant's.

### Conformance cases for User Story 2 (write first)

- [x] T026 [P] [US2] Case for a root demanding a constraint a nearer layer restates identically, on a conforming value — asserting **zero** diagnostics, not a suppressed one (FR-015, spec.md Acceptance Scenario 1) — in `tests/corpus/cases/validate-whole-chain/restated/`
- [x] T027 [P] [US2] Case for a root demanding a constraint no descendant restates, violated by a value the nearest layer would have accepted — asserting the diagnostic names the **root** (FR-016, spec.md Acceptance Scenario 2) — in `tests/corpus/cases/validate-whole-chain/root-only/`
- [x] T028 [P] [US2] Case for a value violating demands in two different layers — asserting **two** diagnostics, each layer-precise (FR-016, spec.md Acceptance Scenario 3) — in `tests/corpus/cases/validate-whole-chain/two-violations/`
- [x] T029 [P] [US2] Case for demands in several layers all satisfied — asserting a valid result (spec.md Acceptance Scenario 4) — in `tests/corpus/cases/validate-whole-chain/all-satisfied/`
- [x] T030 [P] [US2] Case asserting identical inputs (configuration + pedigree) validated twice produce identical diagnostics in identical order (FR-018, spec.md Acceptance Scenario 5) — in `tests/corpus/cases/validate-whole-chain/determinism/`

### Implementation for User Story 2

- [x] T031 [US2] Extend `check.ts`'s walk to iterate every layer in `configuration.layers`, root to leaf, checking each layer's own demands against the same merged tree (FR-014, §5.4) — depends on T023
- [x] T032 [US2] Order diagnostics deterministically — by pedigree position, then by the demand's own pointer, then by the merged pointer (contracts/validate-api.md's ordering rule, FR-018) — depends on T031
- [x] T033 [US2] Confirm restating an ancestor's demand produces no duplicate diagnostic for a conforming value — this needs no special-case code beyond T031's own per-layer independence (each layer's check either finds a violation or does not; nothing suppresses a second identical pass because there is nothing to suppress) — verify by test, not by new logic (FR-015) — depends on T031

**Checkpoint**: The chain is judged whole, not just the leaf. §5.4's belt and suspenders is real.

---

## Phase 5: User Story 3 — `required` is checked after the merge, and `provide` may satisfy it (Priority: P3)

**Goal**: `required` is checked against the post-merge tree; a schema's own `provide` can satisfy it
with zero diagnostics; an explicit `null` cannot; an absent parent produces one diagnostic, not a
cascade.

**Independent Test**: A schema declaring both `required: true` and a `provide` on one key; confirm an
omitting config validates, a config supplying its own value validates, and a config writing an
explicit null is rejected.

### Conformance cases for User Story 3 (write first)

- [ ] T034 [P] [US3] Case for `required` with no `provide` and no value anywhere in the chain — asserting the key is reported missing, at a position naming the demanding layer (FR-027, spec.md Acceptance Scenario 1) — in `tests/corpus/cases/validate-required/missing/`
- [ ] T035 [P] [US3] Case for `required` + `provide`, config omitting the key — asserting a **valid** result with **zero diagnostics of any level** (FR-029, spec.md Acceptance Scenario 2) — in `tests/corpus/cases/validate-required/guaranteed-key/`
- [ ] T036 [P] [US3] Case for `required` + `provide`, config supplying its own value — asserting valid (FR-027) — in `tests/corpus/cases/validate-required/own-value/`
- [ ] T037 [P] [US3] Case for `required` + `provide`, config writing an explicit `null` — asserting rejection even though a `provide` exists (FR-030, spec.md Acceptance Scenario 3) — in `tests/corpus/cases/validate-required/explicit-null/`
- [ ] T038 [P] [US3] Case for `required` keys nested inside a mapping the config omits entirely — asserting **one** violation at the mapping's own pointer, not one per nested required key (FR-031, spec.md Acceptance Scenario 4) — in `tests/corpus/cases/validate-required/absent-parent/`

### Implementation for User Story 3

- [ ] T039 [US3] Implement the `required` check against the merged (post-merge) tree — present and `kind !== "null"` (§4.2, §5.5) — in `src/validate/constraints.ts` (FR-027, FR-028) — depends on T021
- [ ] T040 [US3] Confirm a `provide`-filled `required` key produces no diagnostic — this needs no new code beyond T039 (the merged tree already has the provided value in place by the time `validate()` runs; T039 only checks presence-and-non-null, which the fold already guaranteed) — verify by test, not by new logic (FR-029) — depends on T039
- [ ] T041 [US3] Stop the walk at the first missing ancestor pointer for a `required` demand, rather than resolving every nested required key against a tree position that does not exist, in `src/validate/check.ts` (FR-031) — depends on T031, T039

**Checkpoint**: The guaranteed-key pattern works; nulling-out is refused; no diagnostic cascade.

---

## Phase 6: User Story 4 — Malformed and unrecognized demand vocabulary is refused (Priority: P4)

**Goal**: An unknown or unimplemented `demand` keyword, a wrong-shape constraint value, or an
unparseable `type` expression is refused at its own position — never ignored, never silently accepted
— and every independent vocabulary failure is reported together.

**Independent Test**: A schema with an unrecognized key inside `demand`; confirm validation refuses
it, at that key's own position, and does not proceed as though the schema were sound.

### Conformance cases for User Story 4 (write first)

- [ ] T042 [P] [US4] Case for a `demand` keyword outside §9's closed list — asserting `unknown-demand-keyword` at the keyword's own position (FR-005, spec.md Acceptance Scenario 1) — in `tests/corpus/cases/validate-vocabulary/unknown-keyword/`
- [ ] T043 [P] [US4] Cases for `accept`, `format`, and a top-level `types:` section — asserting `unimplemented-demand-keyword`/`unimplemented-types-section`, naming v0.5, distinct from unknown (FR-006, FR-011a, FR-011b, spec.md Acceptance Scenario 2) — in `tests/corpus/cases/validate-vocabulary/unimplemented/`
- [ ] T044 [P] [US4] Cases for wrong-shape constraint values — `min: "ten"`, `enum: 3`, `required: "yes"` — asserting `malformed-demand-value`, naming the expected shape (FR-007, spec.md Acceptance Scenario 3) — in `tests/corpus/cases/validate-vocabulary/malformed-value/`
- [ ] T045 [P] [US4] Cases for a `type` expression that does not parse (unbalanced parens, a dangling `\|`) and one naming an unresolvable type name — asserting `malformed-type-expression`/`unknown-type-name` at the expression's position (FR-009, FR-012, spec.md Acceptance Scenario 4) — in `tests/corpus/cases/validate-vocabulary/type-expression/`
- [ ] T046 [P] [US4] Case with several independent vocabulary failures across one schema (an unknown keyword on one key, a malformed value on another, an unresolvable type on a third) — asserting **all** are reported from one `validate()` call, not merely the first or the first category (FR-017, spec.md Acceptance Scenario 5) — in `tests/corpus/cases/validate-vocabulary/collect-all/`
- [ ] T047 [P] [US4] Case for a schema declaring `demand`, `seal`, `final`, and `delegate` together — asserting `demand` is enforced and the other three have no effect (spec.md Acceptance Scenario 6, v0.3 FR-002's rule carried forward) — in `tests/corpus/cases/validate-vocabulary/inert-vocabulary/`

### Implementation for User Story 4

- [ ] T048 [US4] Refuse a `demand` keyword outside §9's closed ten-keyword list as `unknown-demand-keyword`, at its own key node's span, in `src/validate/vocabulary.ts` (FR-005) — depends on T009, T004
- [ ] T049 [US4] Refuse `accept` and `format` as `unimplemented-demand-keyword`, and a top-level `types:` section as `unimplemented-types-section`, both naming v0.5, in `src/validate/vocabulary.ts` (FR-006, FR-011a, FR-011b) — depends on T048
- [ ] T050 [US4] Refuse a constraint value of the wrong shape as `malformed-demand-value`, naming the expected shape, in `src/validate/vocabulary.ts` (FR-007) — depends on T048
- [ ] T051 [US4] Wire `typeexpr.ts`'s parse/resolution failures (T010) to `malformed-type-expression`/`unknown-type-name` diagnostics, in `src/validate/vocabulary.ts` (FR-009, FR-012) — depends on T010, T048
- [ ] T052 [US4] Confirm `seal`, `final`, and `delegate` remain unread by `src/validate/vocabulary.ts` — requires no new code, `readKeysVocabulary`'s v0.3 precedent already establishes "ignored" means "no code path touches it"; verify by test (spec.md Acceptance Scenario 6) — depends on T009
- [ ] T053 [US4] Report every independent vocabulary failure from one `validate()` call, never stopping at the first, mirroring v0.3 FR-028's collect-all discipline for merge — in `src/validate/check.ts` (FR-017) — depends on T048, T049, T050, T051, T031

**Checkpoint**: Closed vocabulary, deny by default. A misspelled or premature keyword teaches the
author, rather than silently doing nothing.

---

## Phase 7: Property Tests & Polish

**Purpose**: Discharge the §5.2 rows `demand` newly makes constructible, confirm the six constitution
gates, and close out documentation.

- [ ] T054 [P] Encode the **Types** row (§5.2: narrow by intersection legal, widen never) as a property test over randomly generated multi-layer chains and values, in `tests/unit/validate-monotonicity.test.ts`, following `tests/unit/monotonicity.test.ts`'s hand-rolled-PRNG pattern — no property-testing dependency introduced (FR-032, FR-033) — depends on T031
- [ ] T055 [P] Encode the **Enums/unions** row (shrink legal, add members never) as a property test in the same file — depends on T031
- [ ] T056 [P] Encode the **Ranges/predicates** row (tighten/conjunction legal, loosen/remove never) as a property test in the same file — depends on T031
- [ ] T057 [P] Encode the **`required`** row (add legal, remove never) as a property test in the same file, exercising the guaranteed-key interaction with a randomly present/absent `provide` — depends on T031, T039
- [ ] T058 Record **Struct openness** (`seal`) as explicitly deferred to v0.7 in `tests/unit/validate-monotonicity.test.ts`'s own doc comment, per FR-032 — named, not silently absent — depends on T054
- [ ] T059 [P] Publish contracts/demand-vocabulary.md's closed list and contracts/diagnostics.md's new codes in README.md, alongside the merge surface v0.3 already documented there (SC-006, SC-009)
- [ ] T060 [P] Confirm validation is deterministic under `tests/unit/validate-determinism.test.ts` — same configuration and pedigree, byte-identical diagnostics in identical order, on every run (SC-005) — depends on T032
- [ ] T061 Confirm every pre-existing test still passes unchanged — the baseline is whatever the previous slice left green (424 when this list was written)
- [ ] T062 Run every validation scenario in `specs/004-constraint-checker/quickstart.md` end to end, reporting any scenario that no longer matches reality and which of the two is wrong
- [ ] T063 Verify the six constitution gates in `.specify/memory/constitution.md`, **gate 5 in particular** — every diagnostic `src/validate/` produces carries pointer + violated demand + pedigree position, checked literally against the `Diagnostic` type, not merely code + sentence + span
- [ ] T064 Sabotage-test the whole-chain walk: make it check the nearest/merged layer only (T031's own loop), confirm only genuine multi-layer cases (T027, T028) go red — if a single-layer case also goes red, User Story 2 is not actually isolating what it claims to test; back up first, mark with `SABOTAGE`, `grep -rn SABOTAGE src/ tests/` before trusting the result, then restore
- [ ] T065 Sabotage-test the collect-all discipline (T053): return on the first vocabulary failure instead of continuing; confirm T046's multi-failure case goes red and no single-failure case does; same backup/mark/grep/restore protocol
- [ ] T066 Sabotage-test `required`'s post-merge timing (T039): check the pre-merge tree, or ignore `provide`'s fill; confirm T035's guaranteed-key case goes red; same protocol

**Checkpoint**: Every §5.2 row this vocabulary makes constructible is discharged executably or named
deferred; every sabotage claim has actually been watched failing.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks all stories**
- **US1 (Phase 3)**: depends on Foundational
- **US2 (Phase 4)**: depends on US1's single-layer walk (extends it to every layer)
- **US3 (Phase 5)**: depends on US2's walk (required is checked within the same walk, post-merge)
- **US4 (Phase 6)**: depends on US1's vocabulary reader and US2's walk (refusal collection reuses collect-all)
- **Property Tests & Polish (Phase 7)**: depends on all four stories

### Story independence — stated honestly

US1 is a genuine standalone deliverable: single-layer checking against real demands. US2, US3, and
US4 all extend the same `check.ts` walk US1 builds — whole-chain iteration, `required`'s post-merge
timing, and vocabulary refusal are all facets of one traversal, not four independent ones. This
mirrors v0.3's own honest accounting for the fold. Each story still has its own checkpoint and
separately testable acceptance scenarios.

### Within each story

- Conformance cases before the code they judge (Principle V)
- Vocabulary reading and the type grammar (Foundational) before any check that consumes them

### Parallel opportunities

- T003 in Setup; T004, T005, T006, T010, T011 in Foundational
- **All of T013–T020** (US1 cases), **T026–T030** (US2), **T034–T038** (US3), **T042–T047** (US4) —
  each group is a separate directory with no shared state
- T054–T057, T059, T060 in Property Tests & Polish

---

## Parallel Example: User Story 1 conformance cases

```bash
# Eight independent directories, authorable simultaneously:
Task: "type cases in tests/corpus/cases/validate-single-layer/type/"
Task: "min/max cases in tests/corpus/cases/validate-single-layer/range/"
Task: "minLength/maxLength cases in tests/corpus/cases/validate-single-layer/length/"
Task: "pattern cases in tests/corpus/cases/validate-single-layer/pattern/"
Task: "enum cases in tests/corpus/cases/validate-single-layer/enum/"
Task: "items cases in tests/corpus/cases/validate-single-layer/items/"
Task: "silence-is-permission case in tests/corpus/cases/validate-single-layer/silence/"
Task: "provide-not-exempt case in tests/corpus/cases/validate-single-layer/provide-not-exempt/"
```

---

## Implementation Strategy

### MVP (User Story 1 only)

Setup → Foundational → US1. Stop and validate: a configuration can be judged against one schema's
demands, with both sides of every violation named. This is the first result in four milestones that
can say *no*.

### Incremental delivery

1. Setup + Foundational → vocabulary reading, the type grammar, the additive fields, the boundary
2. US1 → single-layer checking → validate
3. US2 → whole-chain checking, the belt-and-suspenders property → validate
4. US3 → the guaranteed-key pattern → validate
5. US4 → closed-vocabulary refusal → validate
6. Property Tests & Polish → the §5.2 rows discharged, sabotage confirmed, gates verified

---

## Notes

**Three tasks carry most of the risk. Each has a failure mode that passes a naive test:**

- **T031 (whole-chain, not leaf-only)** — a validator that checks only the nearest layer, or the
  merged tree against one flattened intersected demand, passes every single-schema case. Only T027
  and T028's genuine multi-layer cases catch it, which is why T064's sabotage specifically targets
  this task — see the plan's own Verification section for why this is "the sabotage that matters
  most."
- **T023/T053 (collect-all)** — a walk that returns on the first violation or the first vocabulary
  failure passes every single-failure case and fails only T028 and T046, which is why both exist and
  why T065 sabotages this specifically. v0.3 shipped exactly this gap once (v0.3 FR-028) before a
  conformance case caught it; this milestone starts with the case already written.
- **T039/T041 (required's post-merge timing)** — checking `required` against a pre-merge tree, or
  failing to recognize a `provide`-filled key as present, passes every case *except* T035's
  guaranteed-key one, which is why T066 sabotages exactly this timing.

**Also**: 424 existing tests stay green (T061), and every new diagnostic satisfies gate 5 at full
strength (T063) — this is not merely a target, it is the milestone at which the constitution's phased
Principle III stops phasing.
