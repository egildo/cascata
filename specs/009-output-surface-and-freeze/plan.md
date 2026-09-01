# Implementation Plan: The Output Surface, and the Freeze

**Branch**: `009-output-surface-and-freeze` (spec directory only, no separate git branch) | **Date**:
2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-output-surface-and-freeze/spec.md`

## Summary

Six user stories in dependency order. US1 and US2 are the two holes v0.7 recorded rather than fixed —
small, independent, and each one closes a *silence*: a malformed top-level section that is ignored,
and a legal document whose validation cost is exponential. US3 is the milestone: `project()`, the
value view. US4 puts Article VII's sharpest rule inside it — the accumulated demand, never the
document's punctuation, decides `bigint` versus `number`. US5 is `load<T>()`. US6 certifies the rest
and sweeps the derived artifacts against `SPEC.md` as frozen.

**The plan's three substantive findings, all made before any code was written** (`research.md`):

1. **`Number.isSafeInteger` is the wrong exactness test** for the precision lint and would fire on
   2^53, 3·2^52 and 2^60 — every one of them exactly representable. The round trip
   `Number.isFinite(n) && BigInt(n) === v` is the correct predicate, and its `isFinite` guard is
   load-bearing: `Number(2n ** 1024n)` is `Infinity` and `BigInt(Infinity)` **throws**, which under
   Article VI would be a legal document making `load()` throw (F-3).
2. **A plain object cannot enumerate in canonical order.** ECMA-262 hoists array-index keys
   (`[0, 2^32−2]`) ahead of everything else, in numeric order. Article VII says keys are *inserted*
   canonically, which is satisfiable; this milestone's FR-009 says they *enumerate* canonically,
   which is not. Implemented as insertion, with the exception tested and reported (F-1, W-2).
3. **The exponential v0.7 recorded is real, and the test recording it stopped exhibiting it.** That
   test writes the pre-correction `values: {demand: …}` spelling, under which `values` recurses into
   nothing; the blow-up is reachable only through the spelling §9 now mandates. Measured at 920 ms at
   depth 18 with the correct spelling and 0.2 ms with the recorded one (F-5).

## Technical Context

**Language/Version**: TypeScript 5.x, `strict` + `noUncheckedIndexedAccess`, Node LTS

**Primary Dependencies**: none added. `yaml` remains the only runtime dependency.

**Testing**: Vitest. New unit suites for sections, the bound, the value view, the numeric rule, and
`load<T>()`; new corpus families under `tests/corpus/cases/sections/` and
`tests/corpus/cases/numeric/`.

**Scale/Scope**: 28 FRs. New files: `src/project/value.ts`, `src/validate/numeric.ts`,
`tests/unit/{sections,composition-bound,value-view,numeric-projection,load-typed}.test.ts`. Changed:
`src/validate/vocabulary.ts` (the one section rule), `src/validate/check.ts` (the memo; the shared
memo type exported for `numeric.ts`), `src/diagnostics/codes.ts` (two new codes), `src/index.ts`
(`project`, `load<T>`), `tests/unit/{layering,metaschema-corpus,recursion-termination}.test.ts`,
`README.md`, `CLAUDE.md`, `package.json`.

## Constitution Check

*GATE: must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **`tsc` clean, no `any`, no assertion casts on the node model** — planned: yes. One unchecked
   cast exists and is `value as T` in `project<T>()`, on plain JS data, never on a `Node`; it is
   Article VII's own specified behaviour ("the library never checks it") and is documented at the
   site. Re-checked post-design: still one.
2. **Conformance corpus green for every standard touched** — new `sections/` and `numeric/`
   families; every existing family unchanged. The value view's own cases are unit suites, since a
   projection has no *document* to add to the corpus that its merged tree does not already have.
3. **Monotonicity property tests** — **no new construct.** `project()` adds no keyword, no demand,
   and no row to §5.2's table; it reads demands the table already governs. FR-021's "accumulated,
   never the nearest layer's" is the monotonicity-shaped obligation here and is discharged as its own
   case (two layers, the narrower one *earlier* in the chain as well as later, so the property is
   order-independence and not a coincidence).
4. **No new runtime dependency** — holds. `yaml` remains the only one.
5. **Every new diagnostic carries `level`** plus a span whose origin names its document, an RFC 6901
   pointer, and a pedigree position. Two new codes: `malformed-section` (`error`) and
   `precision-narrowed` (`info`). The `info` is held to the same fields as an `error` — Principle
   III's own rule, and the reason the lint is anchored at the offending *value*'s span rather than at
   the demand's.
6. **No import crosses the format-blindness boundary** — `src/project/` joins the policed set before
   it has any code in it, the precedent v0.2/v0.3/v0.4 each set for `resolve/`, `merge/`, `validate/`.
7. **No import crosses the host boundary** — `src/project/` performs no I/O; it is the most
   world-blind stage there is, consuming a `MergedConfiguration` that is already entirely in hand.
   The existing total sweep over `src/` covers it automatically.

**PASS**, before and after design.

## Project Structure

```text
specs/009-output-surface-and-freeze/
├── plan.md              # this file
├── spec.md
├── research.md          # written before implementation; F-1..F-5, D-1..D-7, W-1..W-6
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── value-view.md
│   └── numeric-projection.md
└── tasks.md
```

```text
src/
├── project/
│   └── value.ts         # NEW — the value view (US3, US4)
├── validate/
│   ├── numeric.ts       # NEW — accumulated numeric demands, per merged pointer (US4)
│   ├── vocabulary.ts    # + the one top-level-section rule (US1)
│   └── check.ts         # + the named-type memo (US2), exported for numeric.ts
├── diagnostics/codes.ts # + malformed-section, precision-narrowed
└── index.ts             # + project(); load<T>()
```

## Design decisions taken in this plan

### P-1. US1 is one loop in one function, and no reader changes

Seven independent readers across five modules implement "a section that is not a mapping is nothing
to read". None of them changes. The refusal is raised once, in `vocabularyProblemsForLayer`, over
all four sections — `authority`, `directives`, `keys`, `types` — because a reader that refused would
make the diagnostic depend on read order, and because the next section added would otherwise inherit
the silence. Full list and argument: research D-2.

### P-2. US2 memoizes `checkNamedType`, which is the join point and the only one

Both arms of a `keys`+`values` composition rewrite their demand pointer to `["types", <name>,
"demand"]` and their usage layer to `decl.layer` the instant they resolve the shared type — so they
arrive at the type's body with identical arguments and diverge nowhere below it. Memoizing
`checkDemand` instead would key on the demand pointer, which is exactly what still differs. Key,
component by component, with what breaks if each is dropped: research D-1.

Measured: 920 ms → 0.4 ms at depth 18, flat to depth 24. **The assertion is a ratio across depths**,
never a wall-clock threshold (FR-004) — scaling is a fact about the algorithm; milliseconds are a
fact about the machine.

**The memo bounds the walk and not the output, which is FR-004a's half** (added post-implementation,
after this plan reported the gap): each arm returns the same violation and the list doubles per
level, so a 296-byte configuration at depth 24 produced 2^24 copies and exhausted memory. `SPEC.md`
§10 now legislates the multiplicity it had been silent on, as a **correction** — every copy was
identical in every readable field. The collapse is applied **inside `checkNamedType`, before the memo
caches**, because a final pass arrives after the memory is gone; research D-8 records what the
sabotage revealed about that claim, and why the depth-40 case rather than the depth-24 one is what
actually pins the placement.

### P-3. The numeric decision is a second, deliberately small walk

`src/validate/numeric.ts` collects `pointer → NumericClass` by walking demands against the merged
tree. It does **not** ride along on the violation walk, because that walk has boolean-only fast paths
that visit alternatives which do not apply to the value, and a collector on them would record an
`int` demand at a pointer holding a string. The cost — two walks that can drift — is paid down by
sharing every reader and by reusing US2's memo, since this walk has the identical blow-up.

### P-4. Union within an expression, intersection across demands

`accumulated(P) = ⋂ over applying demands ( ⋃ over that demand's alternatives )`, and the projection
asks it one question: *does the accumulated admission contain `float`?* Yes → `number`; no, but it
contains `int` → `bigint`; neither → faithful, which for an `int`-kind scalar is also `bigint`. Every
row of Article VII's table falls out; research D-4 checks them one at a time.

### P-5. `int | string` projects `bigint`, and the gap is reported not papered over

The rule that actually generalizes is "did the schema declare a float acceptable here", not "which of
these three strings did the author write". A non-numeric alternative says nothing about floats, so it
must not change what happens to integers. Both alternative readings are worse and are named in
research D-5. Reported as a gap in Article VII; under §15's freeze rule the fix is an **addition**,
which stays permitted — but only if it is named before v1.0, which is what this does.

### P-6. `load<T>()` is additive; `configuration` does not move

`LoadResult<T = unknown>` gains a `value: T` beside the existing `configuration`. Every existing call
site infers `unknown` and every existing use of the bare type name still resolves. "A projection,
never a replacement" is literally the `configuration` field surviving, with `why()` still answering
against it.

## Complexity Tracking

| Deviation | Why | Alternative rejected |
|---|---|---|
| **US1/US2 run before US3**, ahead of the milestone's headline feature | Both are debts v0.7 recorded rather than fixed, both are independent of the value view, and both close a silence that the freeze would make permanent. They also exercise the existing validation core before this milestone adds a stage on top of it. | Doing the value view first — would leave two known silences to fix under time pressure at the end, at the release where a silence becomes permanent. |
| **`value as T`**, an unchecked cast in the library | Article VII: "`load<T>()`'s `T` is the caller's claim, and the library never checks it." There is no checked alternative that does not become the v1.x type generator. | Validating `T` at runtime — that is the generator's job (§14), explicitly deferred, and would need a reflection surface the language does not have. |
| **A second demand walk** (`numeric.ts`) beside `check.ts`'s | Research D-3: the violation walk's boolean fast paths visit alternatives that do not apply, so a collector riding on it would record demands the value never matched. | Threading a collector through `checkDemand` — wrong answers at exactly the mixed-union positions US4 exists to get right. |
| **FR-009 is implemented as insertion order, not enumeration order** | ECMA-262 hoists array-index keys; no object can do otherwise. Article VII's own wording says *inserted*, which is met exactly. | A `Map`-shaped projection, which would satisfy enumeration order and violate FR-008's null-prototype objects — and hand the consumer back the walk Article VII exists to remove. |
| **`tests/unit/recursion-termination.test.ts` is changed** | Its "RECORDED FINDING" case uses the pre-correction `values` spelling and, at HEAD, exhibits nothing. Correcting it to the mandated spelling is a strengthening, and it becomes the before/after subject of US2's bound. | Leaving it and adding a second case — would leave a test in the suite whose doc comment is provably false. |
