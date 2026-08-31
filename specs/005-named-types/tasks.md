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

- [x] T029 [P] [US3] Case: a usage's `accept` subset rejects a declared-but-unselected alternative (Acceptance Scenario 1) — `tests/corpus/cases/validate-types/accept-narrow/`
- [x] T030 [P] [US3] Case: a usage's `accept` naming an undeclared alternative is refused (Acceptance Scenario 2, FR-013) — `tests/corpus/cases/validate-types/accept-widened/`
- [x] T031 [P] [US3] Case: selecting every declared alternative behaves as no selector (Acceptance Scenario 3, FR-015) — `tests/corpus/cases/validate-types/accept-full/`

### Implementation for User Story 3

- [x] T032 [US3] `src/validate/vocabulary.ts`: shape-check a type entry's own `accept` (a sequence of strings) and a usage's `accept` (same shape) — depends on T017
- [x] T033 [US3] `src/validate/constraints.ts`/`check.ts`: implement `accept` as a real leaf check — narrows a type's declared alternatives, refuses widening (`type-accept-widened`), composes with the type's own `demand` by AND (research.md D3) — depends on T018, T032

**Checkpoint**: `accept` selects; types cascade in the one mechanism this milestone builds for it.

---

## Phase 6: User Story 4 — A descendant narrows an inherited type (Priority: P4)

**Goal (rewritten, `SPEC.md` §15 / spec.md commit 9c6c0d7)**: originally "Names collide loudly" —
Phase 2's collision machinery, implemented as unconditional, made every redeclaration an error and
therefore made narrowing (FR-027) unimplementable. `SPEC.md` §15 settled a real contradiction §7
shipped with (its cascade law and its namespace law prescribed opposite responses to one syntactic
act) in favour of narrowing. See `src/validate/types.ts`'s header comment and
`specs/005-named-types/research.md`'s D1/D2 settled-notes for the full history — an implementer must
not re-litigate this here, only build to it.

### Conformance cases for User Story 4, reworked in place rather than deleted quietly

- [x] T034 [P] [US4] **Reworked**: a descendant redeclaring an inherited type name is NOT an error — it is a narrowing (Acceptance Scenario 1, FR-016a). Previously asserted the pre-amendment `type-name-collision` behaviour this exact redeclaration used to trigger — `tests/corpus/cases/validate-types/narrowing-not-error/`
- [x] T035 [P] [US4] Unchanged: a layer redeclaring a *built-in* name — `builtin-type-redeclared` (Acceptance Scenario 7 — renumbered, not reworded; FR-018 was never part of the contradiction) — `tests/corpus/cases/validate-types/builtin-collision/`
- [x] T036 [P] [US4] **Reworked**: a qualified name still resolves to exactly one declaration per usage layer, now with no collision diagnostic riding along — redeclaring under two different qualifiers is ordinary narrowing (Acceptance Scenario 6) — `tests/corpus/cases/validate-types/qualified/`
- [x] T037 [P] [US4] Unchanged: one layer declaring, a descendant using unqualified — resolves (FR-020) — `tests/corpus/cases/validate-types/inherited-use/`
- [x] T038 [P] [US4] Unchanged, still the FR-008 sabotage target: an ancestor's own usage cannot resolve a name only a descendant declares (research.md D2) — `tests/corpus/cases/validate-types/ancestor-cannot-see-descendant/`
- [x] T039 [P] [US4] **Reworked**: two documents sharing both an `$id` qualifier and a local type name is a narrowing chain restated in the qualified namespace — `shared/resource` resolves to the *nearest*, and the coordinator's own flagged consequence (derived from FR-016, not cited from §7) holds: the same qualified reference resolves differently depending on which layer asks — `tests/corpus/cases/validate-types/qualified-narrows-nearest/`
- [x] T049 [P] [US4] New: a narrowing that **restates** the key it governs tightens that usage — a value the root's wider `resource` would admit and the house's narrower one would not is rejected (Acceptance Scenario 2, `SPEC.md` §7's worked narrowing, first half) — `tests/corpus/cases/validate-types/narrows-with-restated-key/`
- [x] T050 [P] [US4] New, **the case that matters most**: a narrowing that does **not** restate the key it governs leaves an ancestor's usage untightened — the same value T049 rejects is accepted here, because the root's own usage keeps resolving the root's own (wider) declaration (Acceptance Scenario 3, the counter-intuitive half someone would later "fix" into a bug without this case pinning it) — `tests/corpus/cases/validate-types/narrows-without-restated-key/`
- [x] T051 [P] [US4] New: a descendant widening a type more permissively is inert where it would do harm — the root's own demand keeps resolving the root's own (narrower) declaration regardless (Acceptance Scenario 4, FR-028) — `tests/corpus/cases/validate-types/widens-inert/`

### Implementation — the correction itself

- [x] T052 `src/validate/types.ts`: `resolveTypeName` — remove the `collidingNames` bail; both the unqualified and qualified branches resolve **nearest-wins** (greatest reachable `layerRank`) via a shared `nearestReachable` helper, never `.length === 1 ? ... : undefined` — depends on nothing (Phase 2's own foundation, corrected)
- [x] T053 `src/validate/types.ts`: `collisionDiagnostics` (FR-016b) rewritten to detect only *unrelated* declarations — returns `[]` unconditionally, documented in its own doc comment as structurally unreachable in v1 (single-parent chain, §6.1), not left to look like live protection (the depth-limit guard's own lesson, restated)
- [x] T054 `src/validate/types.ts`: `qualifierCollisionDiagnostics` (FR-019a) — same treatment, extended by the implementer's own inference (flagged in the milestone report, not asserted as literally cited): a shared qualifier is exactly as unreachable-in-v1 as a shared unqualified name, for the identical structural reason
- [x] T055 `tests/unit/validate-type-monotonicity.test.ts`: replace the "collision is unconditional" property (asserting the exact behaviour §15 overturned) with a nearest-wins property — 300 random trials, independent oracle, grouped by usage-key pointer rather than `pedigreePosition` (a real bug this rewrite's own first run caught: `pedigreePosition` names the *declaring* layer for a value violation, not the usage's)
- [x] T056 `README.md`, `specs/005-named-types/research.md`: realign the "Named types" section and D1/D2 (settled-notes appended, not rewritten, matching the earlier v0.4 governance-settlement precedent) to narrowing-wins
- [x] T057 **Sabotage**: resolve to the *ancestor's* declaration instead of the nearest — confirmed: every single-declaring-layer case (T034, T035, T037, T038, T050, T051 — the latter two have 2 declarations but only ONE usage, at root's own rank, so they see only root's own candidate either way) stays green; only the genuinely multi-candidate-*reachable*-from-one-usage cases (T039, T049) plus the nearest-wins property go red
- [x] T058 **Sabotage**: an ancestor's demand resolves the *leaf-most* declaration instead of its own (2+ candidates anywhere → pick the greatest rank regardless of reachability; a single-declarer name keeps ordinary reachability, isolating this from T046/T057's own already-run sabotages) — **the coordinator's own prediction ("only T050 goes red") did not hold**: T039, T049, T050, *and* T051 all go red together, while T034/T035/T037/T038 and the reachability property stay green. Flagged in the milestone report — T050 and T051 are structurally symmetric (2 candidates, one usage, at the ancestor's own rank; they differ only in whether the descendant's redeclaration is narrower or wider), so no "leaf-most" bug can catch one without the other: they are the same resolution guarantee (an ancestor's usage always resolves the ancestor's own declaration) viewed from its two directions, not two independently-breakable properties.

**Checkpoint**: A descendant can narrow an inherited type; an ancestor's own usage is never reached by
a narrowing that does not restate it; a widening is inert where it would do harm; qualification still
pins one specific declaration. No collision resolves by silent shadowing (the FR-016b/FR-019a
mechanism remains implemented, correctly generalized, and honestly documented as unreachable at v1).

---

## Phase 6d: Correction — `glob` dropped as a built-in type (`SPEC.md` §15, commit 4fbb2b1)

**Goal**: `resource` is singular — `url`/`path` denote one thing, `glob` denotes a set, and an
unexpanded glob is a string nothing interprets (computation/Principle VI, non-deterministic, a
security surface, per the amendment). `glob` leaves the built-in set and `picomatch` leaves with it
(its only call site anywhere in the codebase — confirmed by trace before removing, not assumed).

- [x] T059 Confirm `picomatch`'s only call site is `src/validate/check.ts`'s `isValidGlob` (the coordinator's own claim) — traced via `grep -rn picomatch src tests package.json`, one import + one call site found, nothing else
- [x] T060 `src/validate/typeexpr.ts`: remove `"glob"` from `BUILTIN_TYPE_NAMES` — nine names remain
- [x] T061 `src/validate/check.ts`: remove the `picomatch` import, `isValidGlob`, and the `"glob"` case in `matchesBuiltinLeaf`
- [x] T062 `package.json`: remove `picomatch` and `@types/picomatch`; `pnpm install` to regenerate `pnpm-lock.yaml` (picomatch remains in the lockfile only as `vite`/`vitest`'s own transitive devDependency via `fdir`/`tinyglobby` — confirmed via `pnpm why picomatch` — never Cascata's own dependency, so this is not a partial removal)
- [x] T063 `CLAUDE.md`: correct the non-negotiables list back to "`yaml` is the only runtime dependency" — the second time this line has needed correcting for the same dependency
- [x] T064 [P] Case: `tests/unit/typeexpr.test.ts` — remove `glob` from "every FR-011 name resolves"; add a dedicated negative case, `'glob' does not resolve`
- [x] T065 [P] Case: `type: glob` on its own is an ordinary `unknown-type-name`, not a distinct code — `tests/corpus/cases/validate-types/glob-is-unknown/` (new; no §7 keyword is left for it to be early about)
- [x] T066 [P] Every existing v0.5 fixture whose `types.*.accept` list included `glob` (`accept-narrow`, `accept-full`, `accept-widened`, `widens-inert`, `qualified-narrows-nearest`, `narrows-with-restated-key`, `narrowing-not-error`, `narrows-without-restated-key`) — `glob` removed as a line, line-shift positions re-verified per file (only `accept-widened`'s `T030` needed a position update, line 13 → 12; every other fixture's asserted positions sat before the removed line or asserted no position at all)
- [x] T067 README.md, `specs/005-named-types/{data-model.md,quickstart.md,plan.md}`: realign to nine built-in names and no `picomatch`. `research.md` D3's stale example citation gets a settled-note (not a rewrite) — its own AND-composition decision is unaffected, only the illustrative `accept: [url, path, glob]` quote is stale
- [x] T068 Confirm every pre-existing test still passes unchanged, or with an honestly-changed expectation, never a reshaped fixture forced to keep passing (see the milestone report: no case's pass/fail *outcome* changed at all — `glob` was never the sole reason any existing value passed, `path`'s own permissiveness already covered every value used)

**Checkpoint**: `glob` is gone from the runtime, the vocabulary, and the dependency graph together;
nothing pretends it is still there, and nothing was reshaped to hide that it is gone.

---

## Phase 7: Property Tests & Polish

- [x] T040 [P] Property test: the **Types (named)** §5.2 row — random pedigrees, an ancestor's own usage never resolves a descendant-only name; a colliding pedigree never validates — `tests/unit/validate-type-monotonicity.test.ts` (FR-029)
- [x] T041 Record **Struct openness** as still deferred (v0.7) in that same file's doc comment — third time, per FR-029
- [x] T042 [P] Publish contracts/type-resolution.md and contracts/nested-demands.md's rules, and v0.5's diagnostic codes, in `README.md`
- [x] T043 Confirm every pre-existing test still passes unchanged — baseline 498 at this milestone's start
- [x] T044 Run every quickstart.md scenario end to end
- [x] T045 Verify the six constitution gates, gate 5 in particular
- [x] T046 **Sabotage**: resolve type names against a single pedigree-wide merged graph instead of per-layer scope — confirm T038 (and only genuinely cross-layer cases) go red; single-schema cases stay green
- [x] T047 **Sabotage**: re-cap nested recursion at one level — confirm only T021 (three-deep) goes red
- [x] T048 **Sabotage**: make collision detection skip a name that would otherwise collide (silently accept the second declaration) — confirm T034 goes red, Principle VI's deny-by-default failing exactly where it should hold

---

## Notes

- Conformance cases before the code that judges them (Principle V), every expected value derived by
  hand against `spec.md`/the contracts above, never by copying implementation output.
- Every citation in code/tests: "v0.5 FR-nnn".
- `pnpm typecheck && pnpm test` green, tree clean, at every checkpoint.
