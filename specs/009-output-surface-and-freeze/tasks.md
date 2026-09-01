---
description: "Task list for v1.0 — The Output Surface, and the Freeze"
---

# Tasks: The Output Surface, and the Freeze

**Input**: Design documents from `/specs/009-output-surface-and-freeze/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/value-view.md](./contracts/value-view.md),
[contracts/numeric-projection.md](./contracts/numeric-projection.md)

**Tests**: Included and mandatory (Principle V — conformance cases before the code that judges them).

**Order**: US1 → US2 → US3 → US4 → US5 → US6, per spec.md's own priority ordering. US1 and US2 are
v0.7's recorded debts and are independent of everything else; US4 sits on US3, US5 on US4, US6
certifies all of them. Deviation from §14's bare ordering is recorded in plan.md's Complexity
Tracking.

**This milestone ends with a freeze.** Every task below is one where "we can fix it later" stops
being true for anything that changes an existing meaning.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Verify the baseline: **901 tests / 68 files**, `pnpm typecheck` clean, tree clean,
      `grep -rn SABOTAGE src/ tests/` empty. Stop and report if any of it differs
- [x] T002 Probes before design (Principle V's probe gate — non-ASCII, boundary, adversarial input
      each): object key enumeration order on a null-prototype object; `__proto__` assignment both
      ways; `bigint → number` exactness against `isSafeInteger`; `JSON.stringify` on a `bigint`; the
      measured `keys`+`values` scaling under both `values` spellings. Recorded in research.md
      F-1..F-5
- [x] T003 `mkdir -p tests/corpus/cases/sections tests/corpus/cases/numeric src/project`

---

## Phase 2: User Story 1 — a malformed top-level section is refused (Priority: P1)

**Goal**: `types: oops` and `keys: not-a-mapping` stop being silently ignored.

**Independent Test**: a schema whose `types:` is a scalar; refusal at that node's own position.

- [x] T004 [US1] Conformance cases **first**, expected values derived by hand from research D-2,
      never from output: `tests/corpus/cases/sections/{types-scalar,keys-sequence,directives-scalar,
      authority-scalar,all-four-at-once,omitted-sections-legal,config-layer-sections-inert}/`
- [x] T005 [US1] `src/diagnostics/codes.ts`: `malformed-section`, `level: "error"`, its own
      catalogue group with the argument for a fourth code rather than reusing
      `malformed-demand-value`
- [x] T006 [US1] `src/validate/vocabulary.ts`: `topLevelSectionProblems` — one loop over
      `["authority","directives","keys","types"]`, refusing a present-but-non-mapping section at its
      own span. Schema layers only; a config's own inert sections stay legal (FR-002)
- [x] T007 [US1] `src/validate/vocabulary.ts`: `vocabularyProblemsForLayer` calls it. **No section
      reader changes** — research D-2 lists all seven and why they stay lenient
- [x] T008 [US1] `tests/unit/sections.test.ts` — the seven scenarios end to end, including
      "all four at once produces four diagnostics, one per section, in canonical section order"
- [x] T009 [US1] `tests/unit/metaschema-corpus.test.ts`: the two `pipeline: "ACCEPT"` rows become
      `"REFUSE"`; the divergence assertion says **zero**, by count (FR-003). Both directions still
      asserted, so neither a new divergence nor a vanished one can rot silently
- [x] T010 [US1] **Sabotage**: make `topLevelSectionProblems` skip `authority` alone; confirm
      `authority-scalar` and `all-four-at-once` go red and nothing else does. Back up to `/tmp`
      first; mark `SABOTAGE`; `grep -rn SABOTAGE src/ tests/` before trusting anything
- [x] T011 [US1] `pnpm typecheck && pnpm test` green; commit `feat(validate): refuse a non-mapping
      top-level section`

**Checkpoint**: four sections, one rule, zero divergences.

---

## Phase 3: User Story 2 — `keys` + `values` composition is bounded (Priority: P2)

**Goal**: a legal document stops costing 2^depth.

**Independent Test**: the depth-18 case completes in a small constant multiple of the depth-10 case.

- [x] T012 [US2] `tests/unit/recursion-termination.test.ts`: correct the "RECORDED FINDING" case to
      the **mandated** `values` spelling (a bare demand). At HEAD it writes the pre-correction
      key-declaration form, under which `values` recurses into nothing and the case is 0.2 ms flat —
      it was guarding nothing (research F-5). A **changed existing test**; reported
- [x] T013 [US2] `tests/unit/composition-bound.test.ts` **before the fix**: the ratio test
      (FR-004), the diagnostic-identity test against a kept copy of the unbounded walk (FR-005), the
      mis-keyed-cache test (FR-006), and the depth-cap test (FR-007). Written and watched to fail /
      to be slow first
- [x] T014 [US2] `src/validate/check.ts`: the memo on `checkNamedType`, keyed per research D-1
      (`decl` → `value` → `mergedPointer` ∥ `depth` ∥ `typeHops` ∥ `usageAccept`), one cache per
      `checkConfiguration` call, threaded on `WalkContext` rather than module-level
- [x] T015 [US2] FR-005: the diagnostics are identical in **set and order** to the unbounded walk's,
      established by keeping the unbounded walk available to the test and diffing the two
- [x] T016 [US2] FR-006: **prove a mis-keyed cache fails.** Drop `mergedPointer` from the key and
      confirm a dedicated case catches it — two structurally identical subtrees at different
      pointers must not be confused
- [x] T017 [US2] **Sabotage**: drop `ctx.depth` from the key; confirm the depth-cap case goes red.
      Same protocol
- [x] T018 [US2] `pnpm typecheck && pnpm test` green; commit `perf(validate): bound the keys+values
      composition`

**Checkpoint**: polynomial, identical diagnostics, a key that has been shown to be necessary.

---

## Phase 4: User Story 3 — a consumer reads a configuration as ordinary data (Priority: P3)

**Goal**: `config.server.host`.

**Independent Test**: `Object.getPrototypeOf` is `null`, keys enumerate canonically, a sequence is an
array.

- [ ] T019 [US3] `tests/unit/value-view.test.ts` **first**, from contracts/value-view.md §1 and §4:
      null prototype, arrays, scalars, canonical insertion order, the array-index limit named and
      asserted, `__proto__`, `constructor`/`toString`/`hasOwnProperty`, deep freeze at depth, the
      tree still present, purity, an empty mapping and an empty sequence, a scalar root, `null` vs
      absence, and no `Map` anywhere in the projection
- [ ] T020 [US3] `src/project/value.ts`: the projection. `Object.create(null)`; canonical insertion;
      `Object.freeze` at every level; no call-site spread (`src/extend.ts`); iterative or bounded
      recursion so FR-014 holds for a deep document
- [ ] T021 [US3] `src/index.ts`: export `project()`, `ProjectionResult`, `ConfigValue`
- [ ] T022 [US3] `tests/unit/layering.test.ts`: `src/project/` joins the adapter- and
      resolve-boundary sets, and `src/validate/` is asserted **not** to import `src/project/` — the
      new stage's direction, policed mechanically. Additive; nothing existing is weakened
- [ ] T023 [US3] FR-014 totality: a 200,000-element sequence and a 5,000-level nesting both project
      without throwing
- [ ] T024 [US3] **Sabotage**: replace `Object.create(null)` with `{}`; confirm the `__proto__` case
      goes red and the others do not. Same protocol
- [ ] T025 [US3] `pnpm typecheck && pnpm test` green; commit `feat(project): the value view`

**Checkpoint**: §1's seven-milestone-old promise is kept.

---

## Phase 5: User Story 4 — the schema decides the numeric type (Priority: P4)

**Goal**: a config author's punctuation cannot reach the consuming application's type system.

**Independent Test**: one schema, two configs differing only in `30` vs `30.0` under `int | float`;
the same JS type.

- [ ] T026 [US4] `tests/corpus/cases/numeric/` + `tests/unit/numeric-projection.test.ts` **first**,
      from contracts/numeric-projection.md, expected values derived by hand: the four table rows,
      the discriminating `30`/`30.0` pair, accumulation across layers in **both** orders, the
      inexact lint, **the absence of the lint where exact** (FR-020), `int | string` (research D-5),
      arrays, named types, and nested `keys`
- [ ] T027 [US4] `src/diagnostics/codes.ts`: `precision-narrowed`, `level: "info"`
- [ ] T028 [US4] `src/validate/numeric.ts`: `collectNumericDemands` — the second walk (research
      D-3), sharing every reader with `check.ts` and reusing US2's memo
- [ ] T029 [US4] `src/project/value.ts`: consume the map; `int` → `bigint` unless the admission
      contains `float`; the round-trip exactness test with its `isFinite` guard (research F-3);
      the lint at the **value's** own span and pointer
- [ ] T030 [US4] FR-021: decided from the accumulated demand, order-independently
- [ ] T031 [US4] **Sabotage**: swap the exactness test for `Number.isSafeInteger`; confirm the
      **absence** case (FR-020, a 2^60 value under `int | float`) goes red and the firing case does
      not. This is the sabotage that proves FR-020 earns its place. Same protocol
- [ ] T032 [US4] `pnpm typecheck && pnpm test` green; commit `feat(project): the numeric rule`

**Checkpoint**: the demand decides; the lint is narrow and has been shown to be narrow.

---

## Phase 6: User Story 5 — one call, one type (Priority: P5)

- [ ] T033 [US5] `tests/unit/load-typed.test.ts` first: `T` defaults to `unknown`; a supplied `T` is
      returned untouched and unchecked; the node tree and `why()` survive on the same result; the
      projection's lints ride along on a successful `load()`; `project()` reachable without `load()`
- [ ] T034 [US5] `src/index.ts`: `LoadResult<T = unknown>` gains `value`; `load<T = unknown>()`
      threads it. Additive — every existing call site and every bare `LoadResult` still compiles
- [ ] T035 [US5] `pnpm typecheck && pnpm test` green; commit `feat(index): load<T>()`

---

## Phase 7: User Story 6 — the freeze holds (Priority: P6)

- [ ] T036 [US6] `README.md`: sweep. The opening still describes the library as v0.1–v0.3 with
      "constraint checking and validation still ahead"; the `why()` section claims no CLI ships
      "before v1.0's typed output surface"; `metaValidate`'s "a v1.0 question" is now answerable
      (research D-7). Add the v1.0 surface: `project()`, `load<T>()`, the two new codes, the
      `JSON.stringify` note, and the array-index limit
- [ ] T037 [US6] `CLAUDE.md`: the traps list gains the two this milestone earned — array-index key
      hoisting, and `Number.isSafeInteger` being the wrong exactness test
- [ ] T038 [US6] Sweep every `specs/**/contracts/*.md` for a claim `SPEC.md` as frozen contradicts;
      correct in place, citing the milestone
- [ ] T039 [US6] `package.json`: version `1.0.0` (FR-025)
- [ ] T040 [US6] `npx vitest run tests/unit/doc-examples.test.ts` — every YAML example in every
      document parses, this milestone's own included (FR-021a's standing sweep)
- [ ] T041 [US6] `pnpm typecheck && pnpm test` green; commit `docs(freeze): v1.0 — sweep the derived
      artifacts`

---

## Phase 8: Work the plan did not foresee (added during implementation)

Each of these was found by running something, not by reading — recorded here rather than folded
silently into an earlier phase.

- [ ] T042 `src/project/value.ts`: the projection must be **iterative for sequences and mappings
      alike**, not merely bounded — a 5,000-level nesting overflows a naive recursive projection,
      and §11 caps parse depth at 64 only for *parsed* documents. `validate()`'s own
      `recursion-termination` suite builds 400-level trees by hand and `merge()` will fold them, so
      a hand-built configuration reaching `project()` is a reachable path, not a hypothetical
- [ ] T043 `tests/unit/composition-bound.test.ts`: the mis-keyed-cache probe had to vary the
      **code** and hold the probe fixed (drop one key component, re-run the same case) rather than
      vary the probe — otherwise the experiment has two variables and proves nothing about the key

---

## Phase 9: Close-out

- [ ] T044 `grep -rn SABOTAGE src/ tests/` empty
- [ ] T045 `pnpm typecheck && pnpm test` green; tree clean; all seven constitution gates
- [ ] T046 The report: every gap in Article VII, every ambiguity, every invention, every sabotage
      and what it revealed, every changed test, and a plain answer to whether the specification is
      safe to freeze
