---
description: "Task list for v0.5 — Named Types & Nested Demands"
---

# Tasks: Named Types & Nested Demands

**Input**: Design documents from `/specs/005-named-types/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Included and mandatory (Principle V). Property tests for the Types (named) §5.2 row
(Principle II).

## Format: `[ID] [P?] [Story] Description`

## What is different about this milestone

- **The demand vocabulary becomes fully closed *and* fully implemented.** `accept` and `keys` leave
  `UNIMPLEMENTED_DEMAND_KEYWORDS` — nothing remains unimplemented in v0.9's ten-keyword closed list
  (`format` stays outside it entirely, per v0.4's own §15 amendment).
- **`check.ts`'s walk generalizes from one level to recursive.** The v0.4 one-level `items` handling
  is subsumed, not kept alongside a new recursive path.
- **research.md D1 is load-bearing for every task below**: collision is unconditional; a descendant
  cannot redeclare an inherited type's name without colliding. Tasks that name "narrowing" mean
  usage-level `accept`, never type-entry redeclaration.

---

## Phase 1: Setup

- [x] T001 Create `tests/corpus/cases/validate-types/` and `tests/corpus/cases/validate-nested/` directories

---

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T002 [P] Add v0.5's six new diagnostic codes to `src/diagnostics/codes.ts` (contracts/diagnostics.md)
- [x] T003 Create `src/validate/types.ts`: read one schema layer's `types:` section into raw `TypeDeclaration`s (name, raw `demand`, raw `accept` list, layer, pointer, span) — mirrors `vocabulary.ts`'s `readDemandVocabulary` reading style (absent/empty/non-mapping contributes nothing)
- [x] T004 [P] In `src/validate/types.ts`, implement `$id` qualifier extraction (research.md D5) — last non-empty `/`-segment, `undefined` if none
- [x] T005 `src/validate/types.ts`: implement unconditional unqualified-name collision detection across the whole pedigree (research.md D1) — `type-name-collision`, primary at the later-ranked declaration, `related` naming the first (v0.1 duplicate-key precedent) — depends on T003
- [x] T006 [P] `src/validate/types.ts`: implement built-in redeclaration refusal — `builtin-type-redeclared` — depends on T003
- [x] T007 [P] `src/validate/types.ts`: implement qualifier collision detection — `type-qualifier-collision` — depends on T004
- [x] T008 `src/validate/types.ts`: implement per-layer scope resolution (research.md D2) — a name resolves against declarations from layers `0..L` plus built-ins; a colliding name resolves to nothing — depends on T005, T006
- [x] T009 `src/validate/types.ts`: implement cycle detection over the resolved type graph — `unresolvable-type-cycle` (FR-009) — depends on T008

**Checkpoint**: Types can be read, collided, qualified, and resolved (not yet checked against values).

---

## Phase 3: User Story 1 — A constraint bundle is named once and demanded by name (Priority: P1) 🎯 MVP

**Goal**: `type: resource` resolves to a declared type's own demand and enforces it at every usage.

### Conformance cases for User Story 1 (write first)

- [x] T010 [P] [US1] Cases: a conforming value passes, a violating value is reported naming the type declaration's own position (spec.md Acceptance Scenarios 1–2) — `tests/corpus/cases/validate-types/basic/`
- [x] T011 [P] [US1] Case: a shared type, only one of two usages violates (Acceptance Scenario 3) — `tests/corpus/cases/validate-types/shared/`
- [x] T012 [P] [US1] Case: a type name in array/union position (`resource[]`, `resource | null`) resolves like a built-in (Acceptance Scenario 4) — `tests/corpus/cases/validate-types/array-union/`
- [x] T013 [P] [US1] Case: an unresolvable name is refused, not permissive (Acceptance Scenario 5, FR-006) — `tests/corpus/cases/validate-types/unresolvable/`
- [x] T014 [P] [US1] Cases: absent/empty/non-mapping `types:` contributes nothing (Acceptance Scenario 6, FR-003) — `tests/corpus/cases/validate-types/empty-section/`
- [x] T015 [P] [US1] Case: a self-referential and a two-type cycle are both refused, not hung (Acceptance Scenario 7, FR-009) — `tests/corpus/cases/validate-types/cycle/`
- [x] T016 [P] [US1] Case: a config's own `types:` section is ignored (Acceptance Scenario 8, FR-004) — `tests/corpus/cases/validate-types/config-ignored/`

### Implementation for User Story 1

- [x] T017 [US1] `src/validate/vocabulary.ts`: read+refuse a type entry's own closed vocabulary (`demand`, `accept` only) — `unknown-type-entry-keyword` (FR-002) — depends on T003
- [x] T018 [US1] `src/validate/constraints.ts`: generalize `matchesLeaf`/`matchesAlternative`/`checkType` to accept a resolution context; a name that resolves to a `TypeDeclaration` recursively checks the type's own `demand` against the value, attributing violations to the type's own declaring position (FR-007) — depends on T008
- [x] T019 [US1] `src/validate/check.ts`: thread the usage layer's resolution scope through the walk; wire `types.ts`'s collision/qualifier/cycle diagnostics into the vocabulary pass — depends on T009, T018

**Checkpoint**: A type is named once and enforced everywhere it is used. MVP complete.

---

## Phase 4: User Story 2 — Demands nest to whatever depth the data does (Priority: P2)

**Goal**: `keys`/`items` recurse to arbitrary depth, bounded, with `required` constructible at depth.

### Conformance cases for User Story 2 (write first)

- [x] T020 [P] [US2] Case: a `keys` demand on a mapping, a violating child reported at its own position (Acceptance Scenario 1) — `tests/corpus/cases/validate-nested/keys-child/`
- [x] T021 [P] [US2] Case: `keys` inside `keys` inside `items`, three levels down, violated at depth (Acceptance Scenario 2, SC-004) — `tests/corpus/cases/validate-nested/three-deep/`
- [x] T022 [P] [US2] Case: `keys` against a non-mapping value contributes no violation of its own (Acceptance Scenario 3, FR-024) — `tests/corpus/cases/validate-nested/keys-non-mapping/`
- [x] T023 [P] [US2] Case: `keys` naming an absent, non-required child produces nothing (Acceptance Scenario 4) — `tests/corpus/cases/validate-nested/absent-optional-child/`
- [x] T024 [P] [US2] Case: `required` inside a nested `keys`, the child absent (Acceptance Scenario 5 — v0.4's own recorded-unconstructible scenario) — `tests/corpus/cases/validate-nested/required-nested/`
- [x] T025 [P] [US2] Case: recursion past the depth limit is refused, not a stack overflow (Acceptance Scenario 6, FR-025) — **not** a `tests/corpus/` fixture: `resolve()` parses every document with v0.1's own `ParseLimits.maxDepth` (also 64, but counting raw YAML nesting, ~1-3x coarser than semantic `keys`/`items` depth) with no public option to raise it, so a real document deep enough to trip `MAX_DEMAND_DEPTH` always trips the *parser's* identical-valued cap first — confirmed by direct trial, not assumption. Written instead as `tests/unit/validate-depth-limit.test.ts`, hand-building a `MergedConfiguration` (the established `validate-monotonicity.test.ts` precedent) to bypass `resolve()`/parse entirely. Flagged in full in the milestone report.

### Implementation for User Story 2

- [x] T026 [US2] `src/validate/vocabulary.ts`: remove `keys` from `UNIMPLEMENTED_DEMAND_KEYWORDS`; add its shape check (mapping) to `refuseMalformedShapes` — depends on T017
- [x] T027 [US2] `src/validate/check.ts`: generalize the one-level `items` walk into a recursive `checkDemand` handling `keys`/`items` at arbitrary depth, threading a depth counter — `depth-limit-exceeded` once crossed (FR-025) — depends on T019, T026
- [x] T028 [US2] `src/validate/check.ts`: generalize `required`'s absent-anchor from "document root" to "nearest enclosing mapping's own merged pointer" at any nesting level — depends on T027

**Checkpoint**: Nesting reaches arbitrary depth, bounded.

---

## Phase 5: User Story 3 — A usage narrows the type it names (Priority: P3)

**Goal**: `accept` at a usage selects a subset of a type's declared alternatives.

### Conformance cases for User Story 3 (write first)

- [ ] T029 [P] [US3] Case: a usage's `accept` subset rejects a declared-but-unselected alternative (Acceptance Scenario 1) — `tests/corpus/cases/validate-types/accept-narrow/`
- [ ] T030 [P] [US3] Case: a usage's `accept` naming an undeclared alternative is refused (Acceptance Scenario 2, FR-013) — `tests/corpus/cases/validate-types/accept-widened/`
- [ ] T031 [P] [US3] Case: selecting every declared alternative behaves as no selector (Acceptance Scenario 3, FR-015) — `tests/corpus/cases/validate-types/accept-full/`

### Implementation for User Story 3

- [ ] T032 [US3] `src/validate/vocabulary.ts`: shape-check a type entry's own `accept` (a sequence of strings) and a usage's `accept` (same shape) — depends on T017
- [ ] T033 [US3] `src/validate/constraints.ts`/`check.ts`: implement `accept` as a real leaf check — narrows a type's declared alternatives, refuses widening (`type-accept-widened`), composes with the type's own `demand` by AND (research.md D3) — depends on T018, T032

**Checkpoint**: `accept` selects; types cascade in the one mechanism this milestone builds for it.

---

## Phase 6: User Story 4 — Names collide loudly (Priority: P4)

**Goal**: Confirm, with conformance cases, the collision/qualification machinery Phase 2 already built.

### Conformance cases for User Story 4 (write first)

- [ ] T034 [P] [US4] Case: two layers declaring the same type name — `type-name-collision`, both positions (Acceptance Scenario 1, SC-005) — `tests/corpus/cases/validate-types/collision/`
- [ ] T035 [P] [US4] Case: a layer redeclaring a built-in name — `builtin-type-redeclared` (Acceptance Scenario 2) — `tests/corpus/cases/validate-types/builtin-collision/`
- [ ] T036 [P] [US4] Case: a qualified name resolves unambiguously across layers (Acceptance Scenario 3) — `tests/corpus/cases/validate-types/qualified/`
- [ ] T037 [P] [US4] Case: one layer declaring, a descendant using unqualified — resolves, not a collision (Acceptance Scenario 4, FR-020) — `tests/corpus/cases/validate-types/inherited-use/`
- [ ] T038 [P] [US4] Case: **the mandated sabotage target** — an ancestor's own usage cannot resolve a name only a descendant declares (research.md D2, replacing the coordinating brief's unconstructible "descendant redefines a type" wording) — `tests/corpus/cases/validate-types/ancestor-cannot-see-descendant/`
- [ ] T039 [P] [US4] Case: two documents whose `$id`s share a last segment — `type-qualifier-collision` (FR-019a) — `tests/corpus/cases/validate-types/qualifier-collision/`

**Checkpoint**: No collision resolves by silent shadowing; qualification is a real escape hatch.

---

## Phase 7: Property Tests & Polish

- [ ] T040 [P] Property test: the **Types (named)** §5.2 row — random pedigrees, an ancestor's own usage never resolves a descendant-only name; a colliding pedigree never validates — `tests/unit/validate-type-monotonicity.test.ts` (FR-029)
- [ ] T041 Record **Struct openness** as still deferred (v0.7) in that same file's doc comment — third time, per FR-029
- [ ] T042 [P] Publish contracts/type-resolution.md and contracts/nested-demands.md's rules, and v0.5's diagnostic codes, in `README.md`
- [ ] T043 Confirm every pre-existing test still passes unchanged — baseline 498 at this milestone's start
- [ ] T044 Run every quickstart.md scenario end to end
- [ ] T045 Verify the six constitution gates, gate 5 in particular
- [ ] T046 **Sabotage**: resolve type names against a single pedigree-wide merged graph instead of per-layer scope — confirm T038 (and only genuinely cross-layer cases) go red; single-schema cases stay green
- [ ] T047 **Sabotage**: re-cap nested recursion at one level — confirm only T021 (three-deep) goes red
- [ ] T048 **Sabotage**: make collision detection skip a name that would otherwise collide (silently accept the second declaration) — confirm T034 goes red, Principle VI's deny-by-default failing exactly where it should hold

---

## Notes

- Conformance cases before the code that judges them (Principle V), every expected value derived by
  hand against `spec.md`/the contracts above, never by copying implementation output.
- Every citation in code/tests: "v0.5 FR-nnn".
- `pnpm typecheck && pnpm test` green, tree clean, at every checkpoint.
