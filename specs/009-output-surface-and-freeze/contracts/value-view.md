# Contract: the value view — `project()` and `load<T>()`

**Milestone**: v1.0. Implements `SPEC.md` **Article VII (§17)**, §3's last pipeline stage, §16's
"one call".

## 1. `project(configuration)`

```ts
project<T = unknown>(configuration: MergedConfiguration): ProjectionResult<T>
```

| # | obligation | FR |
|---|---|---|
| 1 | A `Mapping` becomes an object with `Object.getPrototypeOf(o) === null`. | FR-008 |
| 2 | A `Sequence` becomes an `Array`. | FR-008 |
| 3 | Scalars become their JS equivalents; `int` is governed by [numeric-projection.md](./numeric-projection.md). | FR-008 |
| 4 | Keys are **inserted** in §4.2's canonical (code-point) order. | FR-009 |
| 5 | A key named `__proto__` is an ordinary own property; nothing is polluted. Likewise `constructor`, `toString`, `hasOwnProperty`. | FR-010 |
| 6 | Every object and array is frozen, at every depth. | FR-011 |
| 7 | The tree the projection read is **unchanged** — no node, no `Map`, no span is touched. | FR-013 |
| 8 | It never throws for any legal document, at any depth or width. No call-site spread (`src/extend.ts`). | FR-014 |
| 9 | It performs no I/O and consults nothing outside `configuration`. | Principle IV, §16 |
| 10 | Called twice on one configuration, it returns equal values and the same diagnostics in the same order. | FR-005's determinism posture |

### The one limit, named

**Obligation 4 is insertion order, and JavaScript does not let it be enumeration order.** ECMA-262's
`OrdinaryOwnPropertyKeys` returns every **array-index** key — a canonical numeric string in
`[0, 2^32−2]` — first, in ascending numeric order, ahead of every other key, which then follow in
insertion order. A mapping with keys `10`, `2`, `b`, `a` therefore enumerates `2, 10, a, b`, not the
canonical `10, 2, a, b`.

This is a property of the object model, not of Cascata, and no object can avoid it. Article VII says
keys are *inserted* in canonical order, which is met exactly. It is tested in both directions — a
case asserting canonical enumeration for non-index keys, including one above the BMP, and a case
asserting and documenting the index hoist — so that the limit is a decision on the record rather than
a surprise in someone's config.

## 2. `load<T>()`

```ts
load<T = unknown>(entryPath: string, options: LoadOptions): Promise<LoadResult<T>>
```

| # | obligation | FR |
|---|---|---|
| 1 | `T` defaults to `unknown`. | FR-022 |
| 2 | The library performs **no** check of `T`. Validation enforces the schema; it cannot enforce the caller's belief about the schema. | FR-022 |
| 3 | `ok: true` carries `configuration` **and** `value`. The node tree is not replaced. | FR-012 |
| 4 | `why(result.configuration, pointer)` answers exactly as before. | FR-012 |
| 5 | `ok: true`'s `diagnostics` is `resolve()`'s lints, then `validate()`'s, then `project()`'s. | §16 |
| 6 | `ok: false` carries errors and no configuration and no value — §16's "never both", which has always been about errors and not about lints. | §16, §10 |
| 7 | The staged functions stay public and `project()` is reachable without `load()`. | FR-023 |

## 3. What a consumer must know, and is told

- **`JSON.stringify` throws on a `bigint`.** `TypeError: Do not know how to serialize a BigInt`. This
  is the consumer's problem and is not hidden: converting would silently reintroduce exactly the
  precision loss §4.2 and §6.1 exist to prevent — the argument that withdrew RFC 8785 from `$pin`,
  one layer up. Two workarounds, both one line: a `replacer`
  (`JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x)`), or a schema that demands
  `float` where a JSON round trip matters.
- **A `T` that disagrees with its schema is a caller bug the library cannot catch.** Article VII says
  so and names the v1.x generator as the fix, **which shipped at v1.1** (specs/010-type-generator).
  Until v1.1 it was a real cost, stated rather than
  discovered.
- **`null` is a value; absence is not.** A key the documents set to `null` is a present property whose
  value is `null`. A key nobody set is absent from the object entirely. §4.2's three-way distinction
  survives the projection intact; `required` (present **and** non-null) is what refuses the first.

## 4. Edge cases, each with a case

| input | value |
|---|---|
| empty mapping | `{}` with a `null` prototype, frozen |
| empty sequence | `[]`, frozen |
| a scalar at the configuration root | that scalar's JS equivalent — the root need not be a mapping |
| a key literally named `__proto__` | an ordinary own property; `Object.getPrototypeOf` still `null` |
| keys `constructor`, `toString`, `hasOwnProperty` | ordinary own properties; nothing is shadowed, because nothing is inherited |
| a `null` value | `null` |
| a key that is absent | absent from the object |
| an array-index key (`"0"`, `"42"`) | present and correct; enumerated ahead of the others, per §1's named limit |
