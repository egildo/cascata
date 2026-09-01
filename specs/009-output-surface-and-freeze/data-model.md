# Data Model: The Output Surface, and the Freeze

**Milestone**: v1.0 (`specs/009-output-surface-and-freeze`)

Additive only. No existing entity loses a field, and no existing field changes meaning — which at
this milestone is not a style note but §15's freeze rule applied to the code.

## `ConfigValue` — the value view

```ts
/** A configuration as ordinary JS data (SPEC.md Article VII). */
export type ConfigValue =
  | string
  | bigint
  | number
  | boolean
  | null
  | readonly ConfigValue[]
  | { readonly [key: string]: ConfigValue };
```

| node | projects to |
|---|---|
| `Mapping` | a **null-prototype** object, keys inserted in §4.2 canonical order, frozen |
| `Sequence` | a frozen array |
| `Scalar` `string` | `string` |
| `Scalar` `bool` | `boolean` |
| `Scalar` `null` | `null` — a *present* key whose value is null; an absent key is an absent property |
| `Scalar` `float` | `number` |
| `Scalar` `int` | `bigint`, or `number` where the accumulated demand admits `float` — see below |

The object case is typed `{ readonly [key: string]: ConfigValue }` rather than a nominal type: a
null-prototype object has no observable type of its own, and giving it one would be a promise about
`instanceof` that nothing can keep.

**No `Map` survives the projection.** `SPEC.md` Article VII mentions "the `Map`-shaped hazard
`src/model/freeze.ts` exists to close"; a mapping becomes an object, so the hazard cannot arise here.
Asserted rather than assumed (a case walks the projection and finds no `Map`).

## `ProjectionResult<T>`

```ts
export interface ProjectionResult<T = unknown> {
  /** The value view. `T` is the caller's claim and is never checked (Article VII). */
  readonly value: T;
  /** `info`-level lints the projection itself produced — today, only `precision-narrowed`. */
  readonly diagnostics: readonly Diagnostic[];
}

export function project<T = unknown>(configuration: MergedConfiguration): ProjectionResult<T>;
```

`project()` never returns `ok: false` and has no failure mode: it is total (FR-014), pure (FR-013),
and consumes only the previous stage's output (Principle IV). A configuration that could not be
projected is a configuration that could not be merged, and that refusal already happened.

## `LoadResult<T>` — additive

```ts
export type LoadResult<T = unknown> =
  | { readonly ok: true;
      readonly configuration: MergedConfiguration;   // unchanged — the tree, spans, provenance, pedigree
      readonly value: T;                              // NEW
      readonly diagnostics: readonly Diagnostic[] }   // now also carries the projection's lints
  | { readonly ok: false; readonly diagnostics: Diagnostic[] };
```

`T` defaults to `unknown`, so every existing call site and every existing reference to the bare name
`LoadResult` is unchanged. `configuration` stays exactly where it was: Article VII's "the value view
is a projection, never a replacement" is that field surviving, and `why()` still answers against it
by RFC 6901 pointer.

Diagnostic order on a successful `load()` is `resolve()`'s lints, then `validate()`'s, then
`project()`'s — the order the staged calls produce them, which is the ordering rule §16 already
states.

## `NumericClass` — the accumulated numeric demand at one pointer

```ts
/** What SPEC.md §17's table decides, per merged-configuration pointer. */
export type NumericClass = "bigint" | "number";

export function collectNumericDemands(
  configuration: MergedConfiguration,
): ReadonlyMap<string, NumericClass>;
```

Two values, not three. A pointer **absent from the map** is the table's fourth row — "no numeric
demand", projected faithfully by lexical kind — and giving that its own enum member would invite a
call site to forget one of three cases. Absence is the honest spelling of "nothing was promised".

Derivation, per pointer P (research D-4):

```text
admission(P) = ⋂ over every demand applying at P ( ⋃ over that demand's depth-0 alternatives )
```

resolved through named types in the declaring layer's own scope, bounded by `MAX_DEMAND_DEPTH`
structurally and by `typeHops` across type expressions — the identical accounting `check.ts` uses,
because it is the identical walk.

| `admission(P)` | entry |
|---|---|
| contains `float` | `"number"` |
| contains `int`, not `float` | `"bigint"` |
| contains neither | **no entry** |

## New diagnostic codes

| code | level | when |
|---|---|---|
| `malformed-section` | `error` | a top-level `types:`/`keys:`/`directives:`/`authority:` in a **schema** layer whose value is not a mapping (FR-001) |
| `precision-narrowed` | `info` | an `int`-kind scalar projected to `number` under an accumulated demand admitting `float`, where the conversion is **not exact** (FR-019) |

`malformed-section` is a fourth closed-vocabulary code beside `unknown-demand-keyword`,
`unknown-type-entry-keyword`, and `unknown-directive-key` — four categories, four codes, each naming
which one was violated (Principle VI's own posture). It is not `malformed-demand-value`: a section is
not a demand and has no demand pointer.

`precision-narrowed` is the milestone's only `info`. It is anchored at the **offending value's** own
span and carries that value's own RFC 6901 pointer — Principle III's never-phasing obligation ("the
position must be the offending construct's own"), and the reason it is not anchored at the demand
that caused the narrowing. Its message names the key and both values, exactly as Article VII requires:
the `bigint` that was read and the `number` that will be seen.

## Unchanged, and deliberately

- `Node`, `Scalar`, `Mapping`, `Sequence`, `SourceSpan`, `Origin` — the model does not move.
- `MergedConfiguration` gains **no** field. The value view is computed on demand, not stashed: a
  consumer stepping through the stages by hand gets the same value from `project()` that `load()`
  puts on its result, and there is exactly one implementation.
- `Diagnostic` — unchanged; `level` has existed since v0.7 and is what makes the lint expressible.
