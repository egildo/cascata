# Quickstart: the JSON adapter

## Reading a JSON document

Nothing new to call. `load()` and `resolve()` select an adapter by extension, and `.json` now
selects this one.

```ts
import { load } from "cascata";
import { createNodeHost } from "cascata/host/node.js";

const result = await load("./settings.json", { host: createNodeHost(), sandboxRoot: "." });
```

A cascade may mix formats freely: a `.json` document may `$adopts` a `.yaml` one and the other way
round. That was always the promise of §3's format-blindness; until this milestone there was only one
format to be blind about.

## What the model looks like

```json
{
  "port": 8080,
  "ratio": 0.5,
  "big": 99999999999999999999999999999999,
  "name": "café",
  "flags": [true, false],
  "absent": null,
  "nothing": {}
}
```

- `port` is `int 8080n` — a `bigint`, because it has no fraction and no exponent.
- `ratio` is `float 0.5`.
- `big` is `int` and **exact**: 32 digits, no rounding. This is why `JSON.parse` is not used.
- `flags` is a sequence of two bool scalars.
- `absent` is a **present** key whose value is the null scalar, which is not the same as the key
  being missing and not the same as `nothing`, which is a present, empty mapping (§4.2).
- Entries iterate in canonical order — `absent, big, flags, name, nothing, port, ratio` — not in the
  order they were written.

`8080` is a `bigint` in the node tree. What the *value view* gives a consumer is decided by the
accumulated demand, never by the document (§17): a key demanded `float` or `int | float` projects to
a `number`. The adapter's job ends at the lexical kind.

## Numbers, in one line each

| written | kind | value |
|---|---|---|
| `2` | int | `2n` |
| `2.0` | float | `2` |
| `1e2` | float | `100` |
| `-0` | int | `0n` |
| `-0.0` | float | `-0` |
| `01` | — | refused, `malformed-document` |

## Diagnostics

Every refusal carries a position, in bytes and in 1-based line/code-point column.

```
duplicate-key at 3:3 — The same key appears more than once in this mapping
  first occurrence at 2:3
```

The five codes this adapter can produce are `malformed-document`, `duplicate-key`,
`invalid-encoding`, `depth-limit-exceeded` and `size-limit-exceeded`. There is no JSON-only code:
each of the five names a hazard that already had a name.

## What it will not do

- **An empty file is not a document.** JSON's grammar has no production for "no value", so an empty
  or whitespace-only `.json` file is `malformed-document`. An empty `.yaml` file is still a `null`
  document, because YAML says it is.
- **A trailing second value is not a document.** `{"a":1} {"b":2}` is refused at the second `{`.
- **A duplicate key is never last-wins.** RFC 8259 permits duplicates; Cascata refuses them, with
  both positions.
- **A number too large for a double becomes `Infinity`.** `1e400` parses as `float Infinity`, the
  same answer the YAML adapter gives for `1e400` and for `.inf`. An *integer* of any size stays
  exact, so this is reachable only by writing an exponent.
