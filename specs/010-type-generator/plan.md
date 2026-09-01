# Implementation Plan: The Accumulated Demand, and the TypeScript Type Generator

**Branch**: `010-type-generator` (spec directory only, no separate git branch) | **Date**: 2026-09-02 |
**Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-type-generator/spec.md`

## Summary

Seven user stories in dependency order. US1 builds the artifact: a value-free walk that intersects
every schema layer's demands per position, with named types resolved in their declaring layer — the
tree Article VIII names, of which §17's numeric rule had been reading one slice since v1.0. US2–US4
are the TypeScript emitter, split by what it emits: shapes, leaves, named types. US5 is the surface —
`generate()`, `generateTypes()`, the `cascata/generate` entry point. US6 is the oracle: every
configuration the validator accepts inhabits the generated type, proven by the compiler, over the
whole validate corpus and the meta-schema. US7 executes the documentation and sweeps the derived
artifacts.

**The plan's findings, all made before any code was written and all by running the compiler**
(`research.md`):

1. **Per-layer emission joined by `&` is unsound twice** — `number & bigint` is `never`, and an open
   layer's index signature survives intersection with a closed layer's object type. This is the
   rejected alternative in Complexity Tracking, confirmed rather than argued (F-2).
2. **A closed mapping with no declared keys cannot be `{}`**, which admits every non-nullish value.
   It must be `{ readonly [key: string]: never }`. Article VIII's row says "no index signature"; the
   probe gate caught the exception before it shipped (F-4, W-1).
3. **Global-named aliases need no escape** — a module-scope `type Object = …` shadows harmlessly, and
   the emitter references no global — while `default`, `my-type`, and the predefined type names do.
   The spec's Assumption was written before the probe and is withdrawn (F-5, W-2).
4. **Closedness is enforced by TypeScript at object literals only.** The oracle writes literals and is
   therefore exact; a consumer's variable is not. A named limit, not a defect (F-3, W-3).

## Technical Context

**Language/Version**: TypeScript 5.9, `strict` + `noUncheckedIndexedAccess`, Node ≥ 20

**Primary Dependencies**: none added at runtime. `yaml` remains the only one. `typescript` (already a
devDependency) is invoked in memory by tests only.

**Testing**: Vitest. New unit suites `accumulate`, `generate-shapes`, `generate-leaves`,
`generate-types`, `generate-oracle`; the doc-examples sweep gains a lane; the layering test gains a
directory. No new corpus family: the oracle *reuses* the entire validate corpus as its expected
values, which is the point.

**Scale/Scope**: 44 FRs. New files: `src/generate/{accumulate,emit,identifiers,index}.ts`,
`tests/unit/{accumulate,generate-shapes,generate-leaves,generate-types,generate-oracle}.test.ts`,
`tests/unit/generate-literal.ts` (the harness's literal writer). Changed: `src/validate/vocabulary.ts`
(+ `ParsedDemand` reader), `src/validate/numeric.ts` (+ exports of the lattice),
`src/validate/check.ts` (+ one exported schema-vocabulary pass), `src/diagnostics/codes.ts` (+ two
codes), `src/index.ts` (+ `generateTypes`, re-exports), `package.json` (`./generate`, `1.1.0`),
`tests/unit/{layering,doc-examples}.test.ts`, `README.md`, `CLAUDE.md`.

## Constitution Check

*GATE: must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **`tsc` clean, no `any`, no assertion casts on the node model** — planned: yes. The emitter
   produces text; the oracle's compiler calls live under `tests/`. `value as T` in `project<T>()`
   remains the one unchecked cast and is untouched (FR-033). Re-checked post-design: still one.
2. **Conformance corpus green for every standard touched** — TypeScript is not a §12 standard; the
   "standard" here is Article VIII's own mapping table, and its corpus is the **validate corpus
   reused as an oracle** (D-7): every accepting case is an expected value derived independently of the
   generator. No existing family changes. JSON Schema, which *is* in §12, is v1.2 and gets its
   corpus there.
3. **Monotonicity property tests** — **no new construct** in the language. `accumulate()` adds no
   keyword and no row to §5.2; it reads demands the table already governs. Its monotonicity-shaped
   obligation is that intersection across layers is commutative (FR-007) and that a narrowing
   downstream never widens a position — both discharged as cases, with the narrower layer placed
   both earlier and later in the chain.
4. **No new runtime dependency** — holds. `typescript` stays a devDependency; the emitter is a
   printer.
5. **Every new diagnostic carries `level`**, a span whose origin names its document, an RFC 6901
   pointer into the declaring layer, and `pedigreePosition`. Two codes: `demand-unsatisfiable`
   (`info`), `emit-identifier-collision` (`error`). The `info` carries both demands (research D-9).
6. **No import crosses the format-blindness boundary** — `src/generate/` joins both policed sets
   (no adapters, no `resolve/`) before it has code, as `project/` did at 009 T022; and `validate/`
   may not import `generate/`, the same direction rule 009 set for `project/`.
7. **No import crosses the host boundary** — `src/generate/` performs no I/O; `generateTypes()`
   asks the host through `resolve()` exactly as `load()` does; the emitted text is returned, never
   written. The existing total sweep over `src/` covers the new directory automatically.

**PASS**, before and after design.

## Project Structure

```text
specs/010-type-generator/
├── plan.md                    # this file
├── spec.md
├── research.md                # F-1..F-6, D-1..D-9, W-1..W-6 — written before implementation
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── accumulated-demand.md  # accumulate(): obligations, the lint, edge cases
│   ├── emitted-type.md        # the mapping table row by row, identifiers, named limits, generateTypes()
│   └── soundness-oracle.md    # the oracle, the literal writer, the ts doc lane
└── tasks.md
```

```text
src/
├── generate/
│   ├── accumulate.ts          # NEW — the tree (US1)
│   ├── emit.ts                # NEW — the printer (US2–US4)
│   ├── identifiers.ts         # NEW — D-6's rules and the reserved list (US2, US4)
│   └── index.ts               # NEW — the cascata/generate entry point: accumulate, generate (US5)
├── validate/
│   ├── vocabulary.ts          # + ParsedDemand and its reader (additive)
│   ├── numeric.ts             # + exports: Admission, union, intersect, admissionOfDemand, admissionOfName
│   └── check.ts               # + one exported schema-vocabulary pass over layers (D-5)
├── diagnostics/codes.ts       # + demand-unsatisfiable, emit-identifier-collision
└── index.ts                   # + generateTypes(); re-exports accumulate/generate and their types
tests/unit/
├── accumulate.test.ts         # NEW
├── generate-shapes.test.ts    # NEW
├── generate-leaves.test.ts    # NEW
├── generate-types.test.ts     # NEW
├── generate-oracle.test.ts    # NEW — the corpus + meta-schema oracle
├── generate-literal.ts        # NEW — harness: ConfigValue → TypeScript literal text
├── layering.test.ts           # + src/generate in both policed sets; validate ↛ generate
└── doc-examples.test.ts       # + the ts lane
```

## Design decisions taken in this plan

### P-1. One accumulated-demand tree, semantic intersection, no `&` between layers

Decided by Egildo before this plan (the brief's Decision 1) and confirmed by F-2. The tree is the
artifact; the emitter is a printer over it. A future JSON Schema exporter (v1.2) is a second printer
and touches nothing in `accumulate.ts` — which is the test of whether this decision was cut right.

### P-2. A third walk, not a migration

`accumulate.ts` is a value-free descent that reuses every reader, the type-expression parser, the
per-layer resolver, and the numeric lattice, and introduces `ParsedDemand`. `check.ts` and
`numeric.ts` are **not** migrated onto `ParsedDemand` in this milestone: the first release after the
freeze is the wrong moment to touch every validation path for no behavioural change. The duplication
is named in Complexity Tracking and the migration recorded as follow-up. Research D-1.

### P-3. The numeric class is the same function `project()` runs

`numeric.ts`'s lattice is exported, not reimplemented (D-3). FR-016's "must agree with `project()`"
is then a property of construction, and the oracle proves it rather than establishes it.

### P-4. Two different declarations of one name intersect by body and emit inline

Never `A & B`: F-2 shows an alias intersection can be `never` where the semantic intersection is a
type. Inline emission with `@intersects` JSDoc; a synthesized alias only where recursion re-enters a
multi-declaration set. Research D-2.

### P-5. Identifier rules are ASCII and fixed, and the emitter references no global

Quoting anything outside `[A-Za-z_$][A-Za-z0-9_$]*` needs no Unicode table and cannot drift with the
compiler; `$`-prefixed escapes cannot collide with §9.1 identifiers; global names shadow harmlessly
because nothing in the emitted text names a global. Research D-6, F-5.

### P-6. The oracle reuses the validate corpus and derives its expectations from the validator

No expected TypeScript text is written by hand except the README pair. Every accepting corpus case
is a positive expectation, every purely type-shaped refusal a negative one, both counts asserted, the
mixed cases listed rather than skipped. The meta-schema round trip is the one case that exercises
recursion, `values`, `seal: closed`, qualifiers and the numeric rule at once. Research D-7.

### P-7. `generateTypes()` sits beside `load()`; the pure stage is its own entry point

`generateTypes()` needs `resolve()` and so lives in `src/index.ts`; `accumulate()` and `generate()`
are pure and live in `src/generate/`, exported from the root **and** from `cascata/generate` (FR-032).
The entry document of a `generateTypes()` resolution is the leaf schema layer, not a config (D-5).

## Complexity Tracking

| Deviation | Why | Alternative rejected |
|---|---|---|
| **A third demand walk** (`accumulate.ts`) beside `check.ts`'s and `numeric.ts`'s | F-1: the value walk is fused with judgment and gated on runtime types; the numeric walk is per pointer of a concrete document. Neither can describe a position no document reaches. | Threading a value-free mode through `checkDemand` — every descent there is conditioned on the value in hand; a "no value" mode would be a second function wearing the first's name. |
| **`ParsedDemand` introduced but existing readers not migrated** | The first post-freeze milestone must not touch every validation path for zero behavioural gain. | Migrating `check.ts`/`numeric.ts` now — a large diff with no test that could go red for the right reason. Recorded as follow-up. |
| **Per-layer types joined by `&`** — *rejected* | F-2: unsound at the numeric rule and at `seal`. | This row records the rejection so it is not re-proposed. |
| **`typescript` invoked in tests** | The oracle needs a type checker; the one installed is the one consumers use. Dev-only; gate 4 untouched. | Hand-written expected `.d.ts` text per case — expectations copied from the implementation, which Principle V forbids. |
| **`$`-prefix escape for alias names** | Deterministic, collision-free against §9.1 identifiers, and the collision it cannot rule out is a refusal. | Hashing or numbering suffixes — unreadable in a hover, and no more collision-free. |
| **JSDoc emitted but non-contractual** | Egildo's Decision 2: the hover should say what the schema says; freezing comment wording would make every constraint a promise. | Emitting no JSDoc — a consumer learns nothing from the type about ranges or patterns. |
