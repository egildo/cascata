# Contract: the accumulated demand — `accumulate()`

**Milestone**: v1.1. Implements `SPEC.md` **Article VIII (§18)**, laws one through four; §5.1; §7.

## 1. `accumulate(layers, options?)`

```ts
accumulate(layers: readonly Layer[], options?: { rootName?: string }): AccumulateResult
```

| # | obligation | FR |
|---|---|---|
| 1 | Takes schema layers root to leaf; consults no configuration; throws on a `config` layer (programmer error). | FR-001 |
| 2 | Returns a tree keyed by structural position: `keys` by name, `values`, `items` — never a pointer with a wildcard. | FR-001 |
| 3 | A named type in a layer's demand resolves to the nearest declaration at or above **that layer** (`resolveTypeName`), never a descendant's. | FR-002 |
| 4 | `type`: alternatives intersect pairwise at equal depth; `A[] ∩ B[]` = `(A ∩ B)[]`; a built-in intersects only with itself, the numeric class decided by `numeric.ts`'s `Admission` lattice. | FR-003 |
| 5 | Two references to one declaration are that declaration; two different declarations intersect by body and are recorded as a `ref` with both. | FR-003 |
| 6 | `keys`: union of names; per name, intersection of every demand naming it, and of `values` where present. | FR-003, FR-011 |
| 7 | `values`, `items`: intersection. | FR-003 |
| 8 | `required`: OR. `provided`: OR, recorded on the key separately from `required`. | FR-003, FR-010 |
| 9 | `enum`: set intersection under `nodesEqual`; an `enum` anywhere yields an `enum` at the position. | FR-003 |
| 10 | `min`/`minLength`: largest; `max`/`maxLength`: smallest; `pattern`: all, in layer order; `accept`: set intersection. Each carries its declaring layer, pointer and span. | FR-003, FR-023 |
| 11 | `seal`: `closed` if any layer closes the position, at any nesting and at the schema top level. | FR-003, FR-012, FR-014 |
| 12 | An empty intersection is recorded as `type: "empty"` and raises `demand-unsatisfiable` (`info`) naming both demands. | FR-004, FR-022 |
| 13 | Guarded recursion yields a `ref`, never an unrolled body; an unguarded cycle is refused **before** this stage by v0.5's `unresolvable-type-cycle`, with a case proving the order. | FR-005 |
| 14 | Work is polynomial in depth where `keys` and `values` both recurse into one shared type — a ratio test across depths, never a wall-clock threshold. | FR-006 |
| 15 | Deterministic: the same layers yield a byte-identical emission; reordering declarations within a layer changes nothing. | FR-007 |
| 16 | Reachable and tested without any emitter. | FR-008 |
| 17 | `final: true` with a scalar `provide` records the constant on the key; a non-scalar `provide` records `provided` only. | FR-020 |
| 18 | No I/O; no import of adapters, `resolve/`, `graph/`, `host/`. | FR-032, gates 6–7 |

## 2. Diagnostics

| code | level | fields |
|---|---|---|
| `demand-unsatisfiable` | `info` | `primary`: the nearer demand's span; `demand`: `{ pointer, span }` of the farther; `related[0]`: the nearer, labelled `"and this demand"`; `pedigreePosition`: the farther's layer rank; `pointer`: the farther demand's pointer in its layer |

## 3. Edge cases, each with a case

| input | tree |
|---|---|
| one layer | that layer's demands, no intersection performed |
| leaf schema declaring nothing | the ancestors' demands; `rootName` from the leaf's `$id` |
| `keys: {}` | a position with no keys, `seal` as declared |
| `seal: closed`, no `keys` | closed, no keys |
| `values` whose demand is `values` | nested `values` positions |
| `provide` with no demand | key present, `type` undefined, `provided: true` |
| `required: true` with no `type` | `required: true`, `type` undefined |
| root `int \| float`, house `int` | `numeric: { int: true, float: false }` |
| root `string`, house `int` | `type: "empty"`, one `demand-unsatisfiable` |
| root `resource[]`, house narrows `resource` without restating the key | the root's `resource` at the key (§7) |
| root and house both restate the key with their own `resource` | `ref` with both declarations |
| meta-schema | six declarations, `demand` and `nestedKeyDecl` as mutually recursive `ref`s |
