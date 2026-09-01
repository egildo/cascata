# Data Model: The Accumulated Demand, and the TypeScript Type Generator

**Milestone**: v1.1 (`specs/010-type-generator`)

Additive only, as §15's freeze rule requires of the language and this project requires of the code:
no existing entity loses a field, no existing field changes meaning. Everything below is new, or an
export of something that already existed privately.

## `ParsedDemand` — one demand, typed (new export of `src/validate/vocabulary.ts`)

```ts
/** One `demand:` mapping read once, every keyword typed. Shapes already refused by
 *  refuseMalformedShapes() cannot reach here; this is the record that switch specifies. */
export interface ParsedDemand {
  readonly type?: TypeExpression;                 // canonical alternatives (typeexpr.ts)
  readonly items?: ParsedDemand;
  readonly keys?: ReadonlyMap<string, ParsedNestedKey>;
  readonly values?: ParsedDemand;
  readonly required?: boolean;
  readonly min?: Scalar; readonly max?: Scalar;   // numeric scalars, kind preserved
  readonly minLength?: bigint; readonly maxLength?: bigint;
  readonly pattern?: string;                       // source; compiles, or never got here
  readonly enum?: readonly Node[];
  readonly accept?: readonly string[];
  readonly seal?: "open" | "closed";
  readonly span: SourceSpan;                       // the demand mapping's own position
  readonly pointer: string;                        // RFC 6901, in its own layer
}
export interface ParsedNestedKey { readonly demand?: ParsedDemand; readonly delegate?: "allow"; readonly span: SourceSpan; }
```

Existing readers keep their signatures and behaviour; `check.ts` and `numeric.ts` are not migrated
to this record in this milestone (research D-1).

## The accumulated demand tree (`src/generate/accumulate.ts`)

```ts
/** The intersection of every layer's demands at one position of the shape — value-free. */
export interface AccumulatedPosition {
  /** `undefined`: no `type` demanded anywhere. `"empty"`: demands admit no value (FR-004, FR-022). */
  readonly type: AccumulatedType | "empty" | undefined;
  readonly keys: ReadonlyMap<string, AccumulatedKey>;   // union of names across layers
  readonly values?: AccumulatedPosition;
  readonly items?: AccumulatedPosition;
  readonly required: boolean;                            // OR across layers
  readonly enum?: readonly Node[];                       // set intersection; undefined = no enum anywhere
  readonly seal: "open" | "closed";                      // closed if any layer closes here
  readonly numeric?: Admission;                          // numeric.ts's lattice, where a number is mentioned
  readonly constraints: readonly AccumulatedConstraint[]; // min/max/lengths/pattern/accept, with provenance
  readonly sources: readonly DemandSource[];             // every demand that contributed, for JSDoc and lints
}

/** One alternative set after intersection. A `ref` names a declaration set; the emitter decides the spelling. */
export type AccumulatedType =
  | { readonly kind: "builtin"; readonly name: BuiltinTypeName; readonly depth: number }
  | { readonly kind: "ref"; readonly declarations: readonly TypeDeclaration[]; readonly depth: number }  // ≥1; >1 = intersection of bodies
  | { readonly kind: "union"; readonly alternatives: readonly AccumulatedType[] };

export interface AccumulatedKey {
  readonly position: AccumulatedPosition;
  readonly provided: boolean;                     // some layer provides it (feeds optionality only)
  readonly constant?: Scalar;                     // `final: true` + scalar `provide`: the pinned constant
}

export interface AccumulatedConstraint {
  readonly keyword: "min" | "max" | "minLength" | "maxLength" | "pattern" | "accept";
  readonly value: string;                         // rendered for JSDoc
  readonly layer: Layer; readonly pointer: string; readonly span: SourceSpan;
}
export interface DemandSource { readonly layer: Layer; readonly pointer: string; readonly span: SourceSpan; }

export interface AccumulatedTree {
  readonly root: AccumulatedPosition;             // the config's top level: leaf keys: ∪ …, top-level seal
  readonly declarations: readonly AccumulatedDeclaration[];  // every named type, in emission order
  readonly rootName: string;                      // FR-031
}
export interface AccumulatedDeclaration {
  readonly declaration: TypeDeclaration;          // types.ts — name, layer, rank, span
  readonly qualifier: string;                     // §7's, from the declaring document's $id
  readonly body: AccumulatedPosition;
  readonly emittedName: string;                   // after D-6's rules
}

export interface AccumulateResult { readonly tree: AccumulatedTree; readonly diagnostics: readonly Diagnostic[]; }  // info lints only
export function accumulate(layers: readonly Layer[], options?: { readonly rootName?: string }): AccumulateResult;
```

Invariants, each with a case:

- Every `Layer` passed has `role: "schema"`; a `config` layer is a programmer error and throws.
- `keys` at any position is the union of names; a name's `position` is the intersection of every
  demand naming it plus `values` where present (FR-011).
- A `ref` with more than one declaration is a narrowing chain's intersection; the same declaration
  never appears twice.
- `numeric` is present iff the accumulated `type` mentions `int` or `float` at depth 0, and equals what
  `collectNumericDemands` would record for a value at that position (FR-016; the oracle proves it).
- The tree is deterministic across the order of declarations within a layer (FR-007).

## The emitted type (`src/generate/emit.ts`)

```ts
export interface GenerateResult { readonly source: string; readonly diagnostics: readonly Diagnostic[]; }
export function generate(tree: AccumulatedTree): GenerateResult;
```

`source` is a TypeScript module: a header comment naming the leaf schema's identity, then one
`export type` per `AccumulatedDeclaration` in emission order, then `export type <rootName> = …`. The
mapping is `contracts/emitted-type.md`, row by row.

## The one call (`src/index.ts`, beside `load()`)

```ts
export interface GenerateTypesOptions extends ResolveOptions { readonly rootName?: string; }
export type GenerateTypesResult =
  | { readonly ok: true; readonly source: string; readonly tree: AccumulatedTree; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };
export async function generateTypes(schemaLocation: string, options: GenerateTypesOptions): Promise<GenerateTypesResult>;
```

`ok: false` carries `resolve()`'s diagnostics, or the schema-vocabulary problems of any layer
(research D-5). `ok: true` carries the tree beside the source, the way `load()` carries the
configuration beside the value: a projection, never a replacement.

## New diagnostic codes (`src/diagnostics/codes.ts`)

| code | level | raised when | position |
|---|---|---|---|
| `demand-unsatisfiable` | `info` | two demands at one position admit no common value (FR-004) | primary: the nearer demand's span; `demand`: the farther demand's pointer and span; `related`: the nearer demand's, labelled |
| `emit-identifier-collision` | `error` | two names escape to one identifier (FR-026) | primary: the second declaration's span; `related`: the first's |

Both carry `level`, a span whose origin names its document, an RFC 6901 pointer **into the declaring
layer**, and `pedigreePosition` — constitution gate 5, an `info` held to the same fields as an `error`.

## Unchanged, and deliberately

- `LoadResult<T>`, `load<T>()`, `project()`, `ProjectionResult<T>`, `ConfigValue` — untouched; `T`
  stays the caller's claim (FR-033).
- `RawDemand` and every existing reader — untouched; `ParsedDemand` is a second reader beside them.
- `Host` — no write method; the caller writes the file (Article VIII, Article VI).
- `Diagnostic` — no new fields; the two new codes use the fields v0.4 and v0.7 added.
