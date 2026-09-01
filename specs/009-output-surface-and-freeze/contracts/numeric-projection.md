# Contract: the numeric rule and the precision lint

**Milestone**: v1.0. Implements `SPEC.md` **Article VII (§17)**'s numeric table and its normalization
lint, §4.2's lexical-kind law, §10's diagnostic levels.

> **The demand decides the numeric type, not the document.** `kind` is lexical — `30` is an int and
> `30.0` is a float — so a *faithful* projection would let a config author's punctuation decide
> whether the consuming application sees `bigint` or `number`, under an unchanged schema. That is
> backwards. — §17

## 1. The rule

For every merged-configuration pointer P, the **accumulated** admission is

```text
admission(P) = ⋂ over every demand applying at P ( ⋃ over that demand's depth-0 alternatives )
```

Within one `type:` expression the alternatives are alternatives, so they **union**. Across demands —
two schema layers, or a `keys` entry and a `values` entry covering the same key — demands compose by
**intersection** (§5.1), which is why no precedence rule has to be invented and why the answer does
not depend on the order the layers are read in.

| `admission(P)` | value for an `int`-kind scalar | §17 row |
|---|---|---|
| contains `float` | `number` | `float`; `int \| float` |
| contains `int`, not `float` | `bigint` | `int` |
| contains neither | `bigint` (faithful to the lexical kind) | no numeric demand |

A `float`-kind scalar is always `number`: there is no demand under which an IEEE-754 double becomes
exact, and a `float` value under `type: int` is a *validation* refusal that never reaches a
successful projection.

Named types resolve, in the **declaring layer's** own scope, exactly as `check.ts` resolves them
(§7). Array depth descends into sequences alternative by alternative, exactly as
`checkSingleAlternative` does. `MAX_DEMAND_DEPTH` bounds structural nesting and `typeHops` bounds
type-expression hops — the same two counters, counting the same two things, for §7's guarded-
recursion reason.

## 2. The gap Article VII does not cover, and how it is read

**`int | string`, and every other mixed numeric/non-numeric union, is not in §17's table.**

Read by §1's rule with no special case: it admits `{int}`, does not admit `float`, and therefore
projects an `int`-kind scalar as **`bigint`**. A string value under the same demand is a string, and
nothing about it changes.

The generalization §17 actually states is *"the schema declared a float acceptable here"*. A
non-numeric alternative says nothing whatever about floats, so it must not change what happens to
integers — a schema author who wrote `int`, then added `| string`, must not silently lose exactness.

**This is a gap in the article and is reported as one.** Under §15's freeze rule the fix is an
**addition** — one row saying the question is "does the accumulated demand admit `float`?", not
"which of these three spellings did the author use?" — and additions stay permitted after v1.0. It is
named now so that it can be.

## 3. The precision lint — `precision-narrowed`

Fires when, and only when, all three hold:

1. the value's lexical `kind` is `int`;
2. `admission(P)` contains `float` (so §1 projects it to `number`); **and**
3. the conversion is **not exact**.

Exactness is the round trip, not a magnitude heuristic:

```ts
const n = Number(v);
const exact = Number.isFinite(n) && BigInt(n) === v;
```

**`Number.isSafeInteger` is wrong here and was rejected by probe** (research F-3): 2^53, 3·2^52 and
2^60 are all exactly representable and all fail `isSafeInteger`, so the lint would fire on values
that lose nothing — "a lint that cried on the shape rather than the value would be ignored within a
week", one layer down from where §17 says it. The `isFinite` guard is equally load-bearing:
`Number(2n ** 1024n)` is `Infinity` and `BigInt(Infinity)` **throws**, which under Article VI would
be a legal document making `load()` throw.

| property | value |
|---|---|
| `level` | `info` — the result stays successful (§10, FR-019) |
| `code` | `precision-narrowed` |
| `primary` span | the **offending value's** own span, in the document that wrote it |
| `pointer` | that value's own RFC 6901 pointer in the merged configuration |
| `pedigreePosition` | the value's own layer rank |
| message | names the key and **both** values — the exact `bigint` read, and the `number` a consumer will see |

**FR-020 requires the absence case.** A `2n` under `int | float` emits **nothing**. Without a case
asserting that absence, the firing case proves only that the code can produce a diagnostic, not that
it is narrow.

## 4. The obligations

| id | obligation |
|---|---|
| FR-015 | accumulated `int` → `bigint`, at every magnitude, exactly |
| FR-016 | accumulated `float` → `number` |
| FR-017 | accumulated `int \| float` → `number`, whichever lexical form the author wrote — **two configs differing only in `30` vs `30.0` project the same JS type** |
| FR-018 | no numeric demand → faithful by lexical kind, typed `unknown` |
| FR-019 | inexact normalization → one `info` naming the key and both values; result still `ok: true` |
| FR-020 | exact normalization → **nothing**, asserted as an absence |
| FR-021 | decided from the **accumulated** demand, never the nearest layer's — and order-independently, since intersection is commutative |
