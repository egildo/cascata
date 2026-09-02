# Contract: the emitted type — `generate()` and `generateTypes()`

**Milestone**: v1.1. Implements `SPEC.md` **Article VIII (§18)**, laws five through nine; §17; §5.5;
§7's qualifier. **Every row of §1 is a compatibility promise under §15's freeze rule from the release
that ships it.** §2 (JSDoc) is not.

## 1. The mapping

| # | accumulated demand | emitted TypeScript | FR |
|---|---|---|---|
| 1 | `string`, `url`, `path` | `string` | FR-017 |
| 2 | `numeric` admits `float` | `number` | FR-016 |
| 3 | `numeric` admits `int`, not `float` | `bigint` | FR-016 |
| 4 | `bool` / `null` | `boolean` / `null` | FR-017 |
| 5 | a union of alternatives | `A \| B`, parenthesized inside `[]` | FR-017, FR-013 |
| 6 | depth `n` | `readonly` nested `n` times: `readonly (readonly T[])[]` | FR-013 |
| 7 | `items: D` | `readonly D[]` | FR-013 |
| 8 | `keys` | `{ readonly k: T; … }`, keys in §4.2 code-point order | FR-009 |
| 9 | key `required` or `provided` | non-optional; else `k?: T` | FR-010 |
| 10 | `values: D` | `readonly [key: string]: D` beside the properties, its type widened with every declared sibling's type and with `undefined` where any sibling is optional — TypeScript requires an index signature to subsume its siblings (TS2411), so `D | undefined` in the ordinary case (Phase 9 T048; a correction to this row and to FR-018 as first written) | FR-011 |
| 11 | `keys` and `values` both naming `k` | `k`'s type is the intersection position (§1 of the other contract), not `T & D` | FR-011 |
| 12 | `seal: open`, no `values` | `readonly [key: string]: unknown` | FR-012 |
| 13 | `seal: closed`, keys declared | no index signature (enforced by TypeScript at object literals only — §4) | FR-012 |
| 14 | `seal: closed`, **no** keys | `{ readonly [key: string]: never }` — `{}` admits everything (research F-4) | FR-012 |
| 15 | a position with `type` undefined | `unknown` | FR-021 |
| 16 | key provided, undemanded | `readonly k: unknown` (non-optional) | FR-021 |
| 17 | key neither demanded nor provided | absent; row 12 covers it | FR-021 |
| 18 | `type: "empty"` | `never` | FR-022 |
| 19 | `enum`, all scalars | literal union in `enum` order after dedupe; `bigint` as `<digits>n` where row 3 applies, plain digits where row 2 applies, strings as double-quoted JSON, `true`/`false`/`null` | FR-019 |
| 20 | `enum` with a non-scalar member | the accumulated type; members in JSDoc | FR-019 |
| 21 | `constant` (final + scalar provide) | the literal type of the constant, spelled as row 19 | FR-020 |
| 22 | a `ref` to one declaration | its emitted alias name | FR-024 |
| 23 | a `ref` to several declarations | the intersected body, inline, with JSDoc naming each; a synthesized alias `<a>_and_<b>` only where recursion re-enters the set | FR-025 |
| 23a | a `ref` at a position that also declares `keys`, `values`, `items` or `seal` **of its own** | the intersected body of the declaration set **and the position's own structural demands**, inline, with JSDoc naming the declaration — never the bare alias, which says only half of what §5.1 composes. `checkDemand` runs every keyword of one demand beside a resolved `type:`, so both apply and the type must be at least as tight. Cases: `tests/unit/generate-types.test.ts` ("a reference beside the position's own structural demands is the INLINE intersection of the two") and `tests/unit/generate-oracle.test.ts` ("a position that names a type AND declares structure of its own"), the latter asserting the validator's own verdict first. Where a recursion re-enters a set already being inlined, the reference stays an alias — row 23's own escape. Article VIII is silent on this shape (research W-7) | FR-024, FR-025 |
| 24 | a declaration whose name the chain declares once | `export type <name> = …` | FR-024 |
| 25 | a name declared by several layers | every declaration as `export type <qualifier>_<name>`; same qualifier twice: `<qualifier>_<rank>_<name>` | FR-025 |
| 26 | a guarded recursive declaration | a self-referencing alias | FR-027 |
| 27 | `accept` narrowing alternatives with distinct emissions | the narrowed union; otherwise JSDoc only | FR-028 |
| 28 | the root | `export type <rootName> = …`; `rootName` = option, else leaf `$id` qualifier (escaped), else `Configuration` | FR-031 |

## 2. JSDoc — output, not contract

Emitted per property, in this order, one line each, and never part of the promise: `@demand <keyword>:
<value>` per constraint with `(<layer label>:<line>)`; for row 23, `@intersects <alias>, <alias>`;
for row 20, `@enum <members>`; for row 27, `@accept <names>`. Presence and wording may change without
a version bump.

## 3. Identifiers (research D-6)

| # | obligation | FR |
|---|---|---|
| 1 | Property name bare iff it matches `[A-Za-z_$][A-Za-z0-9_$]*`; otherwise a double-quoted TypeScript string literal, verbatim — `"città"`, `"🍝"`, `"10"`, `"__proto__"`, `"constructor"`. | FR-015 |
| 2 | Alias name bare iff it matches the same pattern and is not a predefined type name or ECMAScript reserved word (fixed list in `src/generate/identifiers.ts`); otherwise `$` + name with every character outside `[A-Za-z0-9_]` replaced by `_`. | FR-026 |
| 3 | Two aliases escaping to one identifier: `emit-identifier-collision` (`error`), the emission refused. | FR-026 |
| 4 | The emitter references no global type name (`Readonly`, `Record`, `Array`, `Object`…), so a schema type named like one shadows harmlessly. | FR-026 |

## 4. Named limits

- **Closedness is checked by TypeScript at object literals only.** A value with extra keys reaching a
  closed type through a variable is accepted structurally. The generated type is exact; the compiler's
  enforcement is partial, and this is the host type system's limit, not the generator's (research
  F-3, W-3).
- **Ranges, lengths, patterns** have no type. Row 2 of the JSDoc section is the whole story.
- **`url`/`path`** are `string`. The selector survives in JSDoc.

## 5. `generateTypes(schemaLocation, options)`

| # | obligation | FR |
|---|---|---|
| 1 | Resolves `schemaLocation` as the entry through the host; the entry is the leaf **schema** layer, the pedigree its ancestors. | FR-030 |
| 2 | Runs the schema-vocabulary pass over every layer; any problem ⇒ `ok: false` with those diagnostics. | FR-030 |
| 3 | `ok: true` ⇒ `{ source, tree, diagnostics }`, the diagnostics being `info` lints only. | FR-030 |
| 4 | Never throws for a fact about the world; throws for a missing `host` or `sandboxRoot` (programmer error), as `load()` does. | FR-030 |
| 5 | Performs no I/O of its own; writes nothing. | Article VI |
| 6 | Exported from the package root beside `load()`; `accumulate`/`generate` also from `cascata/generate`. | FR-032 |

## 6. Edge cases, each with a case

| input | emitted |
|---|---|
| `keys: {}`, open | `{ readonly [key: string]: unknown }` |
| `keys: {}`, closed | `{ readonly [key: string]: never }` |
| key `my-key` | `readonly "my-key": …` |
| key `città`, key `🍝` | quoted |
| key `__proto__` | `readonly "__proto__": …`, and the oracle literal `{ "__proto__": … }` typechecks |
| type named `default` | `export type $default = …` |
| type named `my-type` | `export type $my_type = …` |
| types `a-b` and `a_b` | **no** collision — `a_b` is bare, `a-b` escapes to `$a_b`, and `$` never begins a §9.1 identifier (the reason `$` was chosen); the case asserts they coexist |
| types `a-b` and `a b` | `emit-identifier-collision` — two *escaped* names meeting at `$a_b` |
| type named `Object` | `export type Object = …`, bare |
| `enum: [1, 2.5]` under `int \| float` | `1 \| 2.5` |
| `enum: [1, 1.0]` under `int \| float` | `1` (the two members project to one literal; JSDoc lists both) |
| `enum: [1]` under `int` | `1n` |
| `enum` with `2n**64n` | `18446744073709551616n` |
| `final: true`, `provide: "x"` | `readonly k: "x"` |
| `final: true`, `provide: {…}` | the accumulated type |
| 64-deep `keys` | 64 nested object types; typechecks |
| root `resource[]` + house `resource[]`, two declarations | `readonly (…inline intersected body…)[]` with `@intersects core_resource, house_resource` |
| leaf `$id: site-builder/core` | `export type core = …` |
| leaf without `$id` | `export type Configuration = …` |
