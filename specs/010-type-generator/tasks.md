---
description: "Task list for v1.1 — The Accumulated Demand, and the TypeScript Type Generator"
---

# Tasks: The Accumulated Demand, and the TypeScript Type Generator

**Input**: Design documents from `/specs/010-type-generator/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/accumulated-demand.md](./contracts/accumulated-demand.md),
[contracts/emitted-type.md](./contracts/emitted-type.md),
[contracts/soundness-oracle.md](./contracts/soundness-oracle.md)

**Tests**: Included and mandatory (Principle V — conformance cases before the code that judges them).
The expected values of every case below are derived from the contracts and from `SPEC.md` Article
VIII by hand, or — for US6 — from the validator through the compiler. **Never from the generator's
own output.**

**Order**: US1 → US2 → US3 → US4 → US5 → US6 → US7, per spec.md's priorities. US1 is the artifact and
everything sits on it; US2–US4 are one printer split by what it prints and could be built in any
order, but shapes first gives the leaves something to live in; US5 wires the surface; US6 is the
proof and needs US5's `generateTypes()`; US7 certifies.

**This is the first milestone under the freeze.** `SPEC.md` Article VIII was added as an addition.
Where the article and the code disagree — and research.md already records two places where the probes
showed the article's table needs a correction (W-1, W-3) — **report, do not quietly pick.** The
report at the end is worth more than the diff.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Verify the baseline: **1039 tests / 73 files**, `pnpm typecheck` clean, tree clean,
      `grep -rn SABOTAGE src/ tests/` empty, `git log --oneline -1` is at or after `7e568f9`. Stop and
      report if any of it differs
- [x] T002 Re-run the probes research.md F-2..F-5 record, under the harness you will build for US6
      (`ts.createProgram` over an in-memory file, `strict`, `lib.es2022.d.ts`): `number & bigint`,
      open-index-signature `&` closed, `{}` accepting `{ a: 1 }`, `{ readonly [k: string]: never }`
      rejecting it, module-scope `type Object`, `type default`, `type my-type`, a quoted `"__proto__"`
      property in type and literal, a `2^1024` bigint literal type, a 64-deep object type. Every one
      must reproduce F-2..F-5's result; **if one does not, stop and report before designing around
      it** — the plan's rules D-4 and D-6 rest on them
- [x] T003 `mkdir -p src/generate`; `tests/unit/layering.test.ts`: add `src/generate` to
      `NO_ADAPTER_IMPORT_DIRS` and `NO_RESOLVE_IMPORT_DIRS`, and add the direction rule
      `src/validate/ does not import src/generate/` beside the existing `project` one — **before the
      directory has code**, the precedent every stage has followed; confirm the "no files yet"
      explicit-vacuous case runs and is green

---

## Phase 2: User Story 1 — the accumulated demand is a stage of its own (Priority: P1)

**Goal**: every schema layer's demands, intersected per position, resolved per layer, with no
document in hand.

**Independent Test**: root `type: string | string[]`, house `type: string[]`; the position carries
exactly `string[]`.

- [x] T004 [US1] `tests/unit/accumulate.test.ts` **first**, from contracts/accumulated-demand.md §1
      rows 1–17 and §3's twelve edge cases, each row its own `it()`, expected values written by hand
      from the contract. Include: the §7 case (house narrows `resource` **without** restating the key
      ⇒ root's `resource` at the key; **with** restating ⇒ a `ref` with both declarations); reordering
      declarations within a layer yields a byte-identical tree (FR-007); a `config` layer throws
      (programmer error); the unguarded cycle is refused by `unresolvable-type-cycle` **before**
      `accumulate()` runs (FR-005); root `int | float` + house `int` ⇒ `numeric { int: true, float:
      false }`; root `string` + house `int` ⇒ `type: "empty"` and exactly one `demand-unsatisfiable`
      carrying both demands' pointers, spans, layers (contract §2)
- [x] T005 [US1] `tests/unit/accumulate.test.ts`: the ratio test for FR-006 — `keys` and `values`
      both recursing into one shared type at depths 10/15/18/24; assert the ratio across depths, never
      milliseconds. Same shape as `tests/unit/composition-bound.test.ts`
- [x] T006 [US1] `src/validate/vocabulary.ts`: `ParsedDemand`, `ParsedNestedKey`, and
      `parseDemand(raw: RawDemand, pointer, span): ParsedDemand` per data-model.md — **additive**;
      every existing reader keeps its signature; `refuseMalformedShapes`'s switch is the
      specification, and a shape it refuses is a programmer error here
- [x] T007 [US1] `src/validate/numeric.ts`: export `Admission`, `union`, `intersect`,
      `admissionOfDemand`, `admissionOfName` (research D-3). No behaviour change; `pnpm test` green
      before continuing
- [x] T008 [US1] `src/diagnostics/codes.ts`: `demand-unsatisfiable` (`info`) and
      `emit-identifier-collision` (`error`), each in its own catalogue group with the argument for a
      new code
- [x] T009 [US1] `src/generate/accumulate.ts`: the tree per data-model.md — a value-free descent over
      every schema layer's top-level `keys:` and `seal`, intersection per keyword per contract §1,
      `resolveTypeName` at the **using** layer's rank, `Admission` via T007's exports, the memo keyed
      on `(declaration set, depth, typeHops)` (research D-1), `ref` for recursion, `"empty"` + the
      lint for an empty intersection, `constant` for `final` + scalar `provide`, `provided` from
      `readKeysVocabulary`. Throws on a `config` layer
- [x] T010 [US1] **Sabotage**: back up `src/generate/accumulate.ts` to `/tmp`, mark with a
      `SABOTAGE` comment, and (a) resolve names at the *leaf's* rank instead of the using layer's —
      the §7 no-restatement case must go red and nothing else; (b) OR the `seal` instead of
      "closed if any" — the weaken-closed case must go red; (c) drop the declaration set from the memo
      key — the ratio test or the two-declarations case must go red. Restore; `grep -rn SABOTAGE`
      empty; record each result for the report
- [x] T011 [US1] `pnpm typecheck && pnpm test` green; commit `feat(generate): the accumulated demand
      — v1.1 US1`

**Checkpoint**: the tree exists, is tested without any emitter, and the meta-schema accumulates to
six declarations with `demand`/`nestedKeyDecl` as mutually recursive `ref`s.

---

## Phase 3: User Story 2 — shapes emit as object types (Priority: P2)

**Goal**: `keys`, `values`, `items`, `seal`, optionality, quoted keys — contracts/emitted-type.md §1
rows 6–17 and §3 row 1.

**Independent Test**: a required key, a provided key, a plain key ⇒ non-optional, non-optional,
optional.

- [x] T012 [US2] `tests/unit/generate-shapes.test.ts` **first**: one `it()` per contract row 6–17,
      plus §6's `keys: {}` open/closed, `my-key`, `città`, `🍝`, `10`, `__proto__`, `constructor`,
      64-deep `keys`, `values` of `values`, top-level `seal`. Expected text written by hand from the
      contract. Every emitted text is also **compiled** by the US6 harness (build
      `tests/unit/generate-literal.ts`'s compile helper now, T013) so a hand-written expectation that
      is not valid TypeScript fails loudly
- [x] T013 [US2] `tests/unit/generate-literal.ts`: `compileInMemory(source: string): Diagnostic[]`
      (the `ts.createProgram` harness from research D-7, sharing one `CompilerHost` and its parsed lib
      across calls) and `toLiteral(value: ConfigValue): string` per contracts/soundness-oracle.md §2;
      its own hand-written pair test in `tests/unit/generate-oracle.test.ts` (stub the file now,
      US6 fills it)
- [x] T014 [US2] `src/generate/identifiers.ts`: `propertyName(key)` (bare iff
      `[A-Za-z_$][A-Za-z0-9_$]*`, else a double-quoted TS string literal) and the reserved list for
      aliases (used in US4); research D-6
- [x] T015 [US2] `src/generate/emit.ts`: the printer for positions — object types with `readonly`
      properties in code-point order, `?` iff neither `required` nor `provided`, the index signature
      (`D` / `unknown` / absent / `never` per rows 10–14), `readonly D[]` with parenthesized unions,
      `unknown` for an undemanded position, JSDoc per contract §2 in fixed order. Leaves print
      `unknown` until US3
- [x] T016 [US2] **Sabotage** (same protocol): (a) emit `{}` for the closed-empty case — the row-14
      test and its compiled negative must go red (this is F-4, and the sabotage proves the test
      guards it); (b) drop `provided` from optionality — the provided-key case goes red, the required
      one does not. Restore; record
- [x] T017 [US2] `pnpm typecheck && pnpm test` green; commit `feat(generate): shapes — v1.1 US2`

**Checkpoint**: every shape row of the contract emits, compiles, and is guarded by a case that has
been watched going red.

---

## Phase 4: User Story 3 — leaves emit as the types §17 promised (Priority: P3)

**Goal**: the numeric rule, unions, `null`, `enum` literals, the pinned constant, `never` —
contract rows 1–5, 15–21.

**Independent Test**: root `int | float`, house `int` ⇒ `bigint`.

- [x] T018 [US3] `tests/unit/generate-leaves.test.ts` **first**: rows 1–5, 15–21 and §6's `enum`
      cases (`[1, 2.5]` under `int | float` ⇒ `1 | 2.5`; `[1, 1.0]` ⇒ `1`; `[1]` under `int` ⇒ `1n`;
      `2n**64n`; a mapping member ⇒ accumulated type + JSDoc), `final` scalar ⇒ literal, `final`
      mapping ⇒ accumulated type, `string` carries no `| null`/`| undefined`, `"empty"` ⇒ `never`,
      the SC-001 case with the narrower layer **both** earlier and later in the chain. Each emitted
      text compiled
- [x] T019 [US3] `src/generate/emit.ts`: leaves — §17's question over `numeric`, built-ins, unions,
      literal spelling per row 19 (bigint `<digits>n` only where row 3 applies), constants, `never`
- [x] T020 [US3] **Sabotage** (same protocol): swap `bigint` for `number` where the class is
      `bigint` — the SC-001 case and the `[1]`-under-`int` case go red; the `int | float` cases do not.
      Record — this is also FR-037's sabotage, repeated under the oracle in US6
- [x] T021 [US3] `pnpm typecheck && pnpm test` green; commit `feat(generate): leaves — v1.1 US3`

**Checkpoint**: `generate(accumulate(layers))` on a chain with numeric, enum, and constant demands
emits text the compiler accepts and the cases pin.

---

## Phase 5: User Story 4 — named types emit as named aliases (Priority: P4)

**Goal**: aliases, qualifiers, escapes, collisions, recursion, `accept` — contract rows 22–27, §3
rows 2–4.

**Independent Test**: the meta-schema's six types; `demand` is a recursive alias TypeScript accepts.

- [x] T022 [US4] `tests/unit/generate-types.test.ts` **first**: one declaration ⇒ bare alias; two
      layers ⇒ `core_resource` and `house_resource`, each usage pointing where §7 resolves it; same
      qualifier twice ⇒ `<q>_<rank>_<name>`; `default` ⇒ `$default`; `my-type` ⇒ `$my_type`;
      `a-b` + `a_b` ⇒ `emit-identifier-collision` and no source; `Object` ⇒ bare `Object` and the
      text compiles (F-5); a two-declaration `ref` ⇒ inline body with `@intersects`; recursion
      re-entering a two-declaration set ⇒ the synthesized `_and_` alias; `accept` narrowing `url|path`
      ⇒ `string` + JSDoc; the meta-schema ⇒ six aliases, compiled. Each compiled
- [x] T023 [US4] `src/generate/identifiers.ts`: `aliasName(name)` and the `$`-escape; the fixed
      reserved list (predefined type names + ECMAScript reserved words); `qualifiedAlias(decl,
      declarationsOfName)`. Never reference a global type anywhere in `emit.ts` — grep the emitter
      for `Readonly<`, `Record<`, `Array<` and assert none in a test
- [x] T024 [US4] `src/generate/emit.ts`: declarations in emission order, `ref` spelling per rows
      22–23, the synthesized alias for recursive multi-declaration sets, collision detection ⇒
      diagnostic and no source
- [x] T025 [US4] **Sabotage** (same protocol): (a) emit `A & B` for a two-declaration `ref` — the
      case whose bodies have distinct numeric classes must fail to compile (`never`); (b) drop the
      `$` from the escape — the `a-b`/`a_b` collision is no longer detected against a bare `a_b`, and
      that case goes red. Restore; record
- [x] T026 [US4] `pnpm typecheck && pnpm test` green; commit `feat(generate): named types — v1.1 US4`

**Checkpoint**: the meta-schema's generated type is six aliases, `demand` self-referencing, compiled.

---

## Phase 6: User Story 5 — one stage, one call (Priority: P5)

**Goal**: `generate()`, `generateTypes()`, `cascata/generate`, `load<T>()` untouched.

**Independent Test**: `generateTypes("./schema.yaml", { host, sandboxRoot })` returns compiled source.

- [x] T027 [US5] `tests/unit/generate-surface.test.ts` **first**: `generate()` performs no I/O and
      returns `{ source, diagnostics }`; `generateTypes()` over a three-layer local chain returns
      `ok: true` with `source`, `tree`, `info`-only diagnostics; a schema with an unknown demand
      keyword ⇒ `ok: false` with the validator's own diagnostic; a missing `host` throws; a document
      the host declines ⇒ `document-unreachable`, no throw; `rootName` option, `$id` default, and
      `Configuration` fallback; the entry document's own `keys:` govern the root (it is the leaf
      schema, D-5); `tests/unit/load-typed.test.ts` unchanged and green
- [x] T028 [US5] `src/validate/check.ts`: export one function running the existing per-layer
      schema-vocabulary pass (unknown keywords, malformed shapes/sections, type resolution and
      cycles) over `readonly Layer[]` with no configuration — **additive**; find the functions
      `validate()` already calls before any value check and expose them, do not duplicate them
- [x] T029 [US5] `src/generate/index.ts`: exports `accumulate`, `generate`, and every type
      data-model.md names. `package.json`: `"./generate"` and `"./generate.js"` entries pointing at
      `dist/generate/index.*`, mirroring `./host/node`
- [x] T030 [US5] `src/index.ts`: `generateTypes()` beside `load()` — resolve the schema as entry,
      build layers from the pedigree plus the entry as the leaf schema layer (rank = pedigree length),
      run T028's pass, `accumulate`, `generate`; re-export `accumulate`, `generate`, the types
- [x] T031 [US5] **Sabotage** (same protocol): skip T028's pass — the unknown-keyword case emits
      source instead of refusing and goes red. Restore; record
- [x] T032 [US5] `pnpm typecheck && pnpm test` green; `tests/unit/layering.test.ts` green with
      `src/generate` populated; commit `feat(generate): generate(), generateTypes(), the entry point —
      v1.1 US5`

**Checkpoint**: quickstart.md's consumer snippet runs against a real schema through the Node host.

---

## Phase 7: User Story 6 — soundness is the conformance rule (Priority: P6)

**Goal**: every configuration the validator accepts inhabits its generated type; every purely
type-shaped refusal does not; the meta-schema round trip.

**Independent Test**: one `ok: true` corpus case, generated, projected, compiled.

- [ ] T033 [US6] `tests/unit/generate-oracle.test.ts` **first** (the expectations are the
      validator's, so "first" means the harness runs against a stub emitter and *fails* for the right
      reason before US2–US5 make it pass — record that it did): iterate every descriptor in
      `tests/corpus/validate-cases/` through the corpus runner's own resolution; positive cases
      compile, their count asserted (**38** at HEAD); negative cases whose every expected code is in
      `{type-mismatch, required-violated, seal-violation, enum-violated}` fail to compile, count
      asserted; mixed cases listed by name with reason; the literal-writer pair (contract §1 row 8)
- [ ] T034 [US6] `tests/unit/generate-oracle.test.ts`: the meta-schema — `generateTypes()` from
      `meta/cascata.meta.yaml`; the meta-schema loaded as a configuration of itself the way
      `metaValidate()` builds it, projected, compiled against the generated root
- [ ] T035 [US6] Whatever US2–US5 got wrong, the oracle now says so. Fix in `src/generate/`, never in
      the oracle; every fix gets a hand-written case in the story's suite it belongs to, and the
      report lists each
- [ ] T036 [US6] **Sabotage** (FR-037, same protocol): swap `bigint` for `number` in the emitter;
      record exactly which corpus cases and whether the meta-schema case went red (at least one must);
      then swap `never` for `unknown` on closed-empty and confirm at least one `seal-violation`
      negative stops failing. Restore; record
- [ ] T037 [US6] Measure the oracle's wall-clock with the shared `CompilerHost` and without it; keep
      the shared one; record both numbers in the report (a fact about the machine, not asserted)
- [ ] T038 [US6] `pnpm typecheck && pnpm test` green; commit `test(generate): the soundness oracle —
      v1.1 US6`

**Checkpoint**: 38 positives compile, every purely type-shaped negative fails, the meta-schema round
trip compiles, and the sabotage was watched going red.

---

## Phase 8: User Story 7 — documentation is executed (Priority: P7)

**Goal**: the `ts` lane, the README, `CLAUDE.md`, the version.

- [ ] T039 [US7] `tests/unit/doc-examples.test.ts`: the `ts generated` lane per
      contracts/soundness-oracle.md §3 — pair detection, `accumulate`+`generate` on the YAML as a
      single-layer schema, trimmed equality, count floor of 1, a synthetic-mismatch meta-test; the
      YAML lane untouched
- [ ] T040 [US7] `README.md`: v1.1 row in the milestone table; a `generate` section with one
      `yaml` block and its `ts generated` pair (write the `ts` by hand from the contract, then let
      the lane confirm); `generateTypes()` under the public surface; the two new codes in the
      catalogue; the named limits (closedness at literals; ranges as JSDoc); the freeze note extended
      to the emitted mapping
- [ ] T041 [US7] `CLAUDE.md`: the layering line gains `src/generate/` (may import `validate/`,
      `merge/`, `model/`, `diagnostics/`; not adapters, `resolve/`, `graph/`, `host/`; `validate/`
      may not import it). The traps list gains: `{}` admits everything; excess-property checks apply
      to literals only; `number & bigint` is `never`
- [ ] T042 [US7] Sweep `specs/**/contracts/*.md` and `specs/009/*.md` for "the generator" as future
      tense; correct in place citing v1.1
- [ ] T043 [US7] `package.json`: version `1.1.0`
- [ ] T044 [US7] `pnpm typecheck && pnpm test` green; commit `docs(generate): v1.1 — the README pair,
      CLAUDE.md, version 1.1.0 — US7`

---

## Phase 9: Work the plan did not foresee (added during implementation)

Each entry here was found by running something, not by reading — recorded rather than folded
silently into an earlier phase. Empty at planning time, by definition.

---

## Phase 10: Close-out

- [ ] T045 `grep -rn SABOTAGE src/ tests/` empty
- [ ] T046 `pnpm typecheck && pnpm test` green; tree clean; all seven constitution gates; `git diff
      --stat 7e568f9 -- tests/` shows **no pre-existing test file modified** except
      `layering.test.ts` and `doc-examples.test.ts`, both by addition
- [ ] T047 The report: every place Article VIII, the contracts, or the spec was silent, contradictory,
      or wrong (research W-1..W-6 confirmed or overturned, plus anything new); every invention; every
      sabotage and what it revealed; every mixed oracle case and why; the oracle's timings; whether
      the emitted mapping is safe to ship as a permanent promise — and if not, which row
