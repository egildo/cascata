# Contract: The `demand` Vocabulary (v0.4)

**Implements**: `SPEC.md` §9, §9.1 | **Stability**: written before v1.0, when no compatibility promise was made; from v1.0 the surface follows `SPEC.md` §15's freeze rule (a correction always, an addition while no meaning changes, a changed meaning only at v2.0)

Published as its own contract, on the same reasoning `precedence.md` gave in v0.3: a vocabulary that
exists only as scattered `if` branches in `constraints.ts` is one nobody can predict from reading
`SPEC.md` alone, and predicting it is the entire value of a closed, declarative vocabulary
(Principle VI).

## The closed list (FR-005)

Exactly these eleven keywords are legal inside `keys.<name>.demand`. Anything else is
`unknown-demand-keyword`.

| Keyword | Built this milestone | Value shape |
|---|---|---|
| `type` | yes | a string scalar, parsed as §9.1's leaf DSL |
| `items` | yes | a nested mapping, itself containing any of this same list except `type`/`items` — see "Nested demand under `items`" below |
| `required` | yes | a bool scalar |
| `min` | yes | an int or float scalar |
| `max` | yes | an int or float scalar |
| `minLength` | yes | an int scalar |
| `maxLength` | yes | an int scalar |
| `pattern` | yes | a string scalar, ECMA-262 regex source |
| `enum` | yes | a sequence of any `Node` shape |
| `accept` | **no** — `unimplemented-demand-keyword`, naming v0.5 (FR-011b) | n/a |
| `keys` | **no** — `unimplemented-demand-keyword`, naming v0.5 (SPEC.md §9, amended; same posture `accept` holds) | n/a |

A value of the wrong shape for its keyword (`min: "ten"`, `required: "yes"`, `enum: 3` where a
sequence was expected) is `malformed-demand-value`, naming the expected shape (FR-007).

## `type` — the leaf DSL (§9.1, FR-008–FR-012)

```ebnf
TypeExpr := Union
Union    := Array ( "|" Array )*
Array    := Primary "[]"*
Primary  := Name | "(" Union ")"
Name     := Ident ( "/" Ident )?          (* qualified: core/resource — no named types until v0.5 *)
Ident    := [A-Za-z_] [A-Za-z0-9_-]*
```

- `[]` binds tighter than `|` — `string | string[]` is "string, or an array of strings";
  `(string | int)[]` needs the parens to mean "an array whose items are each string or int".
- Whitespace is insignificant between tokens.
- Canonical form is a flattened, deduped **set** of `(name, arrayDepth)` pairs — `string | string`
  and `string` are the same expression; `string[] | string[]` and `string[]` are the same expression;
  order in the source text carries no meaning (FR-010).
- Names resolve **only** against FR-011's closed set this milestone: `string`, `int`, `float`, `bool`,
  `null`, `mapping`, `sequence`, `url`, `path`, `glob`. A qualified name (`core/resource`) parses
  under the grammar (the `Name` production allows it) but cannot resolve to anything until v0.5's
  named types exist — it is `unknown-type-name`, the same as a plain typo, not a distinct
  "not yet supported" code: this milestone's closed set has no notion of a namespace to be early
  about, unlike `accept`/`keys`/`types:`, which are keywords §7/§9 already name.
- A `type` value that fails to parse at all (unbalanced parens, a `|` with nothing after it, a bare
  `[]` with no preceding name) is `malformed-type-expression` (FR-009).

## Leaf checks — semantics (FR-013)

| Keyword | Checks | Reuses |
|---|---|---|
| `type` | The value's own kind (or, through `[]`, each item's kind for a `Sequence`) matches some alternative | — |
| `required` | The key is present in the merged tree and its value's `kind` is not `"null"` (§4.2, §5.5) | — |
| `min` / `max` | For an `int`/`float` value, the raw `bigint`/`number` compares `>=`/`<=` the bound directly — no cast either direction (research.md D5) | — |
| `minLength` / `maxLength` | For a `string` value, `[...value].length` (code points, no normalization — research.md probe) | — |
| `pattern` | `new RegExp(source, "u")` against a `string` value's raw JS string (the model's strings are always valid UTF-16 per v0.1 FR-016, so `"u"` mode is always safe to apply) | — |
| `enum` | The value is `nodesEqual` to at least one member of the declared sequence | `src/model/equality.ts`'s `nodesEqual` |
| `items` | Every item of a `Sequence` value satisfies the nested demand (below); a non-`Sequence` value under `items` is simply not checked by this keyword — `type` is what refuses a non-sequence, `items` only ever constrains a sequence's own items | recurses into this same table |

`min`/`max`/`minLength`/`maxLength`/`pattern` applied to a value of the wrong kind (`pattern` against
an `int`, `min` against a `mapping`) produce no violation from that keyword directly — `type` is the
keyword responsible for kind mismatches; a schema combining `type: string` with `pattern: ...` gets
both checks, and a schema declaring `pattern` with **no** `type` demand at all applies `pattern` only
to values that happen to be strings, silently skipping a non-string value for that one keyword. This
mirrors JSON Schema's own "unapplicable keywords are no-ops" convention (§12's selective vampirism —
names, not composition semantics) and avoids inventing an implicit `type: string` a schema author
never wrote.

## Nested demand under `items`

`items`'s own value is a mapping using this **same** closed vocabulary (`type`, `required`, `min`,
… — anything except `items`/`keys` themselves). This milestone's own implementation does not recurse
more than one level into a nested demand — **not** for want of a citation any more: `SPEC.md` §9 was
amended, after this milestone shipped, to state explicitly that `keys` and `items` both nest to
arbitrary depth. Generalizing `items` past one level, and implementing `keys` at all (shipped here
only as `unimplemented-demand-keyword`), are both v0.5 work (§14); this milestone's one-level cap is a
scope decision now, not a citation gap. Each item of a `Sequence` value is checked against this nested
demand independently, at merged pointer `<sequencePointer>/<index>` — which is exactly the pointer
FR-024 already requires and exactly why a `type: string[]` violation on one item names *that item*,
not the sequence as a whole (spec.md's Acceptance Scenario 6).

## `enum` membership uses model equality, not JS equality

`enum: [1, "1", 1.0]` has **three** distinct members under `nodesEqual` (`int 1`, `string "1"`,
`float 1.0` — kind is part of equality, §4.2), even though a naive `JSON.stringify`-based comparison
would collapse `1` and `1.0`. This is exactly why `src/model/equality.ts`'s single definition is
reused rather than a second, looser one being written for this one call site.
