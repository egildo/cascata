# Data Model: Constraint Checker & Whole-Chain Validation

**Date**: 2026-08-31 | **Plan**: [plan.md](./plan.md) | **Implements**: `SPEC.md` §5.1, §5.2, §5.4,
§5.5, §7, §9, §9.1, §10

New entities for v0.4. v0.1's `Node`/`SourceSpan`/`Origin`, v0.2's `Reference`/`DocumentIdentity`/
`Graph`/`Pedigree`, and v0.3's `Layer`/`ProvenanceEntry`/`ProvenanceRecord` are unchanged. Two
existing types gain **additive, optional** fields — `Diagnostic` and `MergedConfiguration` — so every
pre-v0.4 construction site of either stays valid with no edits.

## Demand

One constraint declared on one key by one schema layer, read from `keys.<name>.demand`.

| Field | Meaning |
|---|---|
| `keyword` | One of §9's closed `demand` keywords — `type`, `items`, `required`, `min`, `max`, `minLength`, `maxLength`, `pattern`, `enum`, `format`, `accept` |
| `value` | The raw declared `Node` — a `type` expression is a string scalar at this stage, not yet parsed |
| `layer` | Which schema layer declared it (`src/merge/provenance.ts`'s `Layer`) |
| `pointer` | RFC 6901 pointer into **that layer's own document**, e.g. `/keys/styles/demand` |
| `span` | Where in that document — FR-022 |

**Composition**: demands on the same key from different layers compose by **intersection only**
(§5.1) — this milestone does not build one intersected `Demand`; it checks the merged value against
every layer's own `Demand` independently and lets whole-chain validation (FR-014) achieve the same
effect as intersection would, which is exactly FR-033's corrected reading (a property of the
validation *outcome*, not a refusal at declaration time).

**`format` and `accept`**: both are closed vocabulary (§9 lists them) but this milestone refuses both
as **unimplemented** rather than reading a meaning into either — `accept` because named types don't
exist until v0.5 (FR-011b), `format` because D2 in research.md leaves its relationship to `type:
url/path/glob` an open `SPEC.md` question this implementer does not have standing to settle
(Principle I).

## Type Expression

The parsed form of a `type` value — §9.1's leaf DSL, `TypeExpr := Union`.

| Field | Meaning |
|---|---|
| `alternatives` | A **set** (order-insignificant) of `Alternative` — flattened, deduped |

`Alternative` is a name (one of FR-011's resolved set: `string`, `int`, `float`, `bool`, `null`,
`mapping`, `sequence`, `url`, `path`, `glob`) at some **array depth** (`string` is depth 0,
`string[]` is depth 1, `string[][]` is depth 2). Two alternatives are equal iff their name and depth
both match — this is exactly what makes union canonical form a set comparison rather than a string
comparison (FR-010).

**Invariant**: every `Alternative`'s name resolves against the closed FR-011 set. An unresolvable name
(a typo, a not-yet-existent named type) is refused at the `type` expression's own span (FR-012) —
never treated as "matches anything", which would silently disable the very demand it was written to
enforce.

## Violation

The pairing of one violated `Demand` with the value that broke it, at one pointer into the merged
configuration. The unit §10's canonical sentence renders.

| Field | Meaning |
|---|---|
| `demand` | The `Demand` that was violated |
| `mergedPointer` | RFC 6901 pointer into the **merged** tree where the violation occurred (FR-024) — distinct from `demand.pointer`, which is into the *schema's own* document |
| `valueSpan` | The offending value's own span — `value.span`, taken directly off the merged tree's node, never synthesized (FR-023) |
| `valueLayer` | The layer that wrote the offending value, determined from `valueSpan.origin.id` matched against the layer stack's `identity.location` (FR-023; see research.md D-notes and plan.md's "What tracing the existing code turned up" §3) — **not** looked up via the provenance record |
| `reason` | Which sub-check failed and why, in enough structured detail to render §10's sentence without string-assembling anything at the call site (FR-025) — e.g., for `enum`, the permitted set; for `min`/`max`, the bound and the actual value |

**Two violations with the same `demand.pointer`, same `mergedPointer`, and the same `valueSpan`** are
the *same* violation (FR-015's restatement-is-vacuous rule, applied at the outcome level): if two
layers declare byte-identical demands and a value fails both, whole-chain validation still produces
**two** `Violation`s — one per declaring layer (FR-016) — because each names a different `demand`
(different `layer`, different `pointer`/`span` even if the *value* they wrote is textually identical).
Restatement-is-vacuous is about a value that **passes** being checked once per layer with no
diagnostic at all, not about deduplicating diagnostics for a value that fails several layers' demands.

## Validation Result

Either a certified configuration or a non-empty list of violations — never both, on the `MergeResult`/
`FoldOutcome` precedent.

```
{ ok: true; certified: MergedConfiguration } | { ok: false; diagnostics: Diagnostic[] }
```

## `Diagnostic` — additive fields (Principle III, gate 5 at full strength)

`src/diagnostics/diagnostic.ts`'s existing `code`/`message`/`primary`/`related` are unchanged. Three
new **optional** fields, populated by every `src/validate/`-produced diagnostic and absent from every
pre-v0.4 one:

| Field | Type | Meaning |
|---|---|---|
| `pointer?` | `string` | RFC 6901 pointer into the merged configuration (FR-024) |
| `demand?` | `{ pointer: string; span: SourceSpan }` | The violated demand's own pointer (into its declaring document) and span (FR-022) — typed in primitives, never in `Layer`, since `src/diagnostics/` may not import `src/merge/` |
| `pedigreePosition?` | `number` | The declaring layer's rank in precedence order (0 = root schema), so a diagnostic is traceable to *where in the chain* the demand came from without a caller re-deriving it |

## `MergedConfiguration` — additive field

| Field | Meaning |
|---|---|
| `layers` | `readonly Layer[]`, root-to-leaf, exactly what `foldConfiguration` already computes internally via `deriveLayers(graph)` (`src/merge/fold.ts`) — stashed onto the result rather than recomputed, so `validate()` consumes only the previous stage's output (Principle IV) with no `Graph` passed alongside |

## Relationships

```
MergedConfiguration.layers[] (root → leaf)
   │
   ├── each schema layer's own tree ──read keys.<name>.demand──> Demand[]
   │                                                                 │
   │                                          parse `type` values ──┤
   │                                                                 ▼
   │                                                          Type Expression
   │
   └── resolvePointer(merged tree, demand's key pointer) ──> candidate value Node
                                                                 │
                                                    run every Demand's checks
                                                                 │
                                                     satisfied ──┴── violated
                                                                        │
                                                                        ▼
                                                                    Violation ──render──> Diagnostic
```

## State transitions

Validation is total: it produces a certified configuration or a non-empty diagnostic list, never
both, and never a partial result — the same rule every earlier stage sets.

```
MergedConfiguration (tree + layers)
   │
   ├── malformed demand vocabulary ─────────────> Diagnostics
   │     (unknown keyword, unimplemented keyword, wrong-shape value,
   │      unparseable `type` expression — FR-005/FR-006/FR-007/FR-009)
   │
   └── root → leaf walk, every layer's demand against the merged tree
         │
         ├── every demand satisfied ──> { ok: true, certified: MergedConfiguration }
         │
         └── one or more violated ────> { ok: false, diagnostics: Diagnostic[] }
               (collect-all — FR-017 — never stop at the first)
```
