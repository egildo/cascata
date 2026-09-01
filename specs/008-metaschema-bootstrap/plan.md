# Implementation Plan: The Meta-Schema Bootstrap (Self-Hosting)

**Branch**: `008-metaschema-bootstrap` (spec directory only, no separate git branch) | **Date**:
2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-metaschema-bootstrap/spec.md`

## Summary

Five user stories, in dependency order. US1 (`values`) and US2 (guarded recursion) are the two
vocabulary additions the meta-schema cannot be written without; US3 (`directives:`) is the third.
US4 writes the meta-schema and runs it against itself and the corpus. US5 loads it through the host
seam.

**The plan's one substantial finding, made before any code was written** (a probe, `A`, recorded in
`research.md`'s spirit and reproduced in the report): **a named type's own `demand.keys` is never
recursed into.** `src/validate/check.ts`'s `checkNamedType` checks a type's `demand.type`, its
simple leaf keywords, its `seal`, and its `accept` — and nothing else. `keys`, `items`, `values`
and `required` inside a named type are silently unchecked. The comment at that site records it as a
deliberate v0.5 scope decision ("no worked example exercises it"), which was true then and is fatal
now: the meta-schema's central construct is the recursive named type `demand`, whose entire content
is a `keys:` mapping. Without this fix the meta-schema would parse, validate, and check **nothing**
— a green fixed point that proves nothing at all. Fixing it is US2's real work, and it is also what
turns guarded recursion from a rule that is vacuously satisfied into one that runs.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict` + `noUncheckedIndexedAccess`, Node LTS

**Primary Dependencies**: none added. `yaml` remains the only runtime dependency.

**Testing**: Vitest. New corpus families under `tests/corpus/cases/values/`,
`tests/corpus/cases/recursion/`, `tests/corpus/cases/directives/`; new unit suites for the
meta-schema fixed point, the corpus sweep, termination (property test), and the documented-examples
sweep (FR-021a).

**Scale/Scope**: 26 FRs. New files: `src/validate/directives.ts`, `meta/cascata.meta.yaml`,
`tests/unit/{values,guarded-recursion,directives,metaschema,doc-examples}.test.ts`. Changed:
`src/validate/vocabulary.ts` (`values` joins `DEMAND_KEYWORDS`; the recursive walk descends into it),
`src/validate/check.ts` (`checkNamedType` delegates to `checkDemand`; `values` walk; directives pass),
`src/validate/violation.ts` (`renderViolation` gains an optional "omit the merged pointer" mode),
`src/validate/types.ts` (documentation only — the guarded-recursion rule is what the existing walk
already implements, and saying so is the change), `src/merge/fold.ts` (export
`RESERVED_DOCUMENT_KEYS`), `src/index.ts` (`metaValidate`), `src/host/node.ts`
(`nodeMetaSchemaLocation`), `src/diagnostics/codes.ts` (one new code), `package.json` (`files`).

## Constitution Check

*GATE: must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **`tsc` clean, no `any`, no assertion casts on the node model** — planned: yes. The one
   invasive change (`checkNamedType` → `checkDemand`) removes code rather than adding types.
2. **Conformance corpus green for every standard touched** — planned: new `values`, `recursion`,
   and `directives` case families; every existing family stays green and unmodified.
3. **Monotonicity property tests** — §5.2's new `values` row. Discharged the way v0.4 FR-033 and
   v0.7's `seal` row already are: **dynamically**, as a property of the validation *outcome* under
   whole-chain validation, never by refusing a weakening declaration. See Complexity Tracking —
   this is a documented reading of FR-005, not a silent one.
4. **No new runtime dependency** — holds.
5. **Every new diagnostic carries `level`** plus pointer/demand/pedigreePosition — planned; the one
   new code (`unknown-directive-key`) is `level: "error"`, and directive *violations* deliberately
   carry no `Diagnostic.pointer` (a directive has no position in the merged configuration).
6. **No import crosses the format-blindness boundary** — unaffected.
7. **No import crosses the host boundary** — the meta-schema's *location* is resolved in
   `src/host/node.ts`, the one exempt file; the library proper takes a location string and asks its
   host, exactly as it does for any other document (FR-019).

**PASS.**

## Project Structure

```text
specs/008-metaschema-bootstrap/
├── plan.md              # this file
├── spec.md
├── research.md          # written before implementation; D-1..D-4, W-1..W-6
├── draft-meta-schema.yaml  # the ORACLE — hand-derived from SPEC.md §9, never from the code
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── values-and-directives.md
│   └── meta-schema.md
└── tasks.md
```

```text
meta/
└── cascata.meta.yaml    # the shipped meta-schema — a document, read through the host seam

src/
├── validate/
│   ├── vocabulary.ts    # + values
│   ├── check.ts         # + values walk; checkNamedType unified with checkDemand; + directives pass
│   ├── directives.ts    # NEW — the directives: section
│   ├── types.ts         # documentation: the existing walk IS §7's guarded-recursion rule
│   └── violation.ts     # renderViolation(v, {omitMergedPointer})
├── host/node.ts         # + nodeMetaSchemaLocation()
└── index.ts             # + metaValidate()
```

## Design decisions taken in this plan

### P-1. `values`' value is a **key declaration**, not a bare demand mapping

`items: { type: string }` takes a demand mapping directly. `values` does **not**: its value is
`{ demand: {...} }` — the same shape one entry of a nested `keys:` takes.

This follows `draft-meta-schema.yaml` (the oracle: `values: { demand: { type: nestedKeyDecl } }`).
`SPEC.md` §9's "`values` is to a mapping what `items` is to a sequence" reads the other way and is
the ambiguity; the argument for the draft's reading is that `values` is precisely the *un-named*
form of a `keys` entry — `keys: {a: X, b: X}` versus `values: X` — which keeps `keys` and `values`
composable by intersection with no reshaping, and keeps `delegate:` reachable for a mapping whose
keys the schema cannot enumerate. Reported as an ambiguity in `SPEC.md` §9 regardless of which way
it was resolved; see the report.

### P-2. `checkNamedType` delegates to `checkDemand`

Rather than teaching `checkNamedType` a second copy of the `keys`/`items`/`values`/`required`
walk, it calls `checkDemand` with the *type's own* declaring context (`layer`, `rank`,
`["types", <name>, "demand"]`). Every keyword works inside a named type for free, attribution stays
at the type's own declaration (v0.5 FR-007), and resolution stays in the type's own layer scope
(v0.5 FR-008). The type-expression path changes from producing `RawSite[]` to producing
`Violation[]`; `mergedPointer` replaces `pointerSuffix` accumulation, which is the identical value
computed one step earlier.

**Depth accounting**: a named-type hop costs 1 (unchanged); a structural level *inside* a named type
now costs 2 (the hop plus the nesting). Deliberately conservative; `MAX_DEMAND_DEPTH` is 64 and the
meta-schema's worst case is measured in a test, not assumed (`guards-that-dont-guard`).

### P-3. Guarded recursion needs no new refusal logic

`src/validate/types.ts`'s `cycleDiagnostics` walks a declaration's `demand.type` and `accept` — the
two *unguarded* routes — and does not descend into `keys`/`items`/`values`. That is exactly §7's
amended rule. The v0.5 comment calls it a scope decision; v0.7 makes it the law, and the change is
to say so and to test both directions, including FR-009's guarded-at-one-point cycle. **No
behavioural change here.** What makes the rule non-vacuous is P-2.

### P-4. `directives:` constrains the **config layer's own raw tree**

A schema layer's `directives:` section checks the reserved keys of the document being validated —
the config layer — read off `layer.tree` (the parsed document), never `configuration.tree` (the
merged configuration, from which reserved keys are already, correctly, stripped). Nothing in the
fold changes, which is what makes FR-013 true by construction rather than by care.

A directive violation carries **no** `Diagnostic.pointer`: it has no position in the merged
configuration. This is `vocabulary.ts`'s existing posture for schema-authoring problems, applied
for the same reason.

### P-5. Meta-validation is a separate, exported call — never `load()`'s default path

`metaValidate({ host, subject, metaSchema })` reads both documents **through the host**, builds a
two-layer `MergedConfiguration` (meta-schema as the schema layer, subject as the config layer) via
the real `fold()`, and calls the real `validate()`. It is not wired into `load()` (research.md D-2).

## Complexity Tracking

| Deviation | Why | Alternative rejected |
|---|---|---|
| FR-005 (`values` monotonicity) discharged **dynamically**, not as a static refusal | v0.4 FR-033's corrected reading and `SPEC.md` §5.4: whole-chain validation makes an ancestor's `values` keep firing regardless of what a descendant declares, so a loosening is *inert*, which is the same "a widening needs no refusal" precedent §15 established for named types and v0.7 established for `seal`. A static refusal is subsumption checking (§5.4 item 2, v1.x). | A dedicated `values-weakened` diagnostic — would be the second retired-before-shipping code of its kind (`seal-weakened`), for the identical reason. |
| `checkNamedType`'s unification touches the type-checking path used by every v0.5 test | The gap it closes is not optional for this milestone, and a second copy of the walk would diverge | Teaching `checkNamedType` its own `keys`/`values` recursion — duplicates ~70 lines and two depth-accounting rules |
| `delegate:` under `values` grants nothing | `src/resolve/delegate.ts` scopes grants to `keys` only (v0.6 research.md D2, `items` excluded for the same reason); no FR here asks for it | Extending grant collection to `values` — new security surface, no requirement, out of scope. **Reported**: the meta-schema types `values` as `nestedKeyDecl`, which admits `delegate`, so the meta-schema over-accepts here. |
