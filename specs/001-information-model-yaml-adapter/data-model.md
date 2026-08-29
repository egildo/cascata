# Data Model: Information Model & YAML Adapter

**Date**: 2026-08-29 | **Plan**: [plan.md](./plan.md) | **Implements**: `SPEC.md` §4.1, §4.2

Entities below are the format-blind core. Nothing here knows YAML exists — that is the Principle IV
boundary, and it is what lets the JSON and TOML adapters arrive later as siblings.

## SourceSpan

Where a piece of text sits. Never absent (§4.1: "NON-OPTIONAL").

| Field | Meaning |
|---|---|
| `origin` | Which document produced this — see Origin below |
| `start` | Byte offset of the first byte, 0-based |
| `end` | Byte offset one past the last byte |
| `line` | 1-based line of `start` |
| `column` | 1-based column of `start`, counted in code points |

**Invariants**: `start <= end`; both within the document's byte length; `line`/`column` agree with
`start`. A zero-width span (`start === end`) is legal and meaningful — it is what an empty value has,
and it is how "the position where something is missing" is expressed.

**Note on units**: offsets are bytes so they compose with hashing and slicing later; column is code
points so it matches what an editor shows. Mixing the two is deliberate, and the corpus asserts both.

## Origin

Which document a node came from. In this milestone every node in one read shares one origin; the type
exists now because Principle III forbids making it optional and requiring it later.

| Field | Meaning |
|---|---|
| `id` | Stable identity of the document — the caller supplies it |
| `label` | Human-readable name for diagnostics (a path, a URL, `<stdin>`) |

Once the cascade exists, this is the anchor for layer provenance; nothing about its shape needs to
change for that.

## Node

Three shapes, per §4.1. Every node carries a `span`.

- **Scalar** — carries `kind` (`string` | `int` | `float` | `bool` | `null`) and a value whose type
  follows `kind`. Integers are exact at any magnitude. `kind` is decided **lexically**: `2` is an
  `int`, `2.0` is a `float`, and a quoted `"2"` is a `string` (§4.2).
- **Mapping** — entries keyed by string, stored in **canonical order**: sorted by code point (§4.2).
  Authored order is discarded, so iteration order and equality agree. An unsorted mapping is as
  unconstructible as an unpositioned node — the factory sorts, and there is no other way in.
- **Sequence** — ordered items; order is significant.

**Construction invariant (Principle III)**: nodes are constructible only through factories that
require a span. There is no optional span field, no setter, and no path by which an unpositioned node
can exist. This is the adapter conformance bar restated as a type: *"parse to positioned nodes"* is
enforced by making the alternative unrepresentable rather than by review.

**Immutability (FR-026)**: trees are deeply frozen before being returned.

## Equality

Defined exactly once, over the model (§4.2), and used by every comparison in the system — the corpus
asserts against it today; merge and diamond dedup will inherit it unchanged.

- Scalars: equal when `kind` **and** value are equal. `int 2` ≠ `float 2.0` — different kinds.
- Mappings: equal when they have the same key set and equal values per key. Order does not enter the
  comparison — and since mappings are stored canonically, two equal mappings also enumerate alike.
- Sequences: equal when the same length and equal items **in order**.
- Spans and origins take **no part** in equality — two documents that say the same thing are equal
  even though they say it in different places.

Strings compare by code point sequence, with no Unicode normalization (§4.2, a decision made against
UAX #15 rather than an omission).

## Diagnostic

One refusal. Per §10, positions are the point.

| Field | Meaning |
|---|---|
| `code` | Stable, machine-readable — see [contracts/diagnostics.md](./contracts/diagnostics.md) |
| `message` | One human sentence |
| `primary` | The span the problem is at |
| `related` | Zero or more additional labelled spans |

`related` is what lets a duplicate key report **both** occurrences (FR-018). Research established
that the underlying library reports only the second, and that the first is recoverable by scanning
key positions — so this field is load-bearing, not decorative.

Diagnostics are returned ordered by position, so a config author reads them in the order the problems
appear in their file.

## ConformanceCase

A case is data (FR-021, FR-024). The runner is generic; `format` selects the adapter, which is what
makes the corpus outlive this adapter.

| Field | Meaning |
|---|---|
| `name` | Stable identifier, used in failure output |
| `cites` | The `SPEC.md` section this case is the oracle for (Principle I) |
| `format` | Which adapter reads the input |
| `input` | The document text |
| `expect` | Either `tree` (the expected model) or `diagnostics` (codes **with** positions) |

Full shape in [contracts/conformance-case.md](./contracts/conformance-case.md).

## Relationships

```
Origin 1 ──< SourceSpan >── 1 Node          every node has exactly one span
                  │
                  └──< Diagnostic           primary + related spans

ConformanceCase ──> expects ──> Node tree | Diagnostic[]
```

## State transitions

A read is a single transition with two terminal outcomes and no third:

```
text + origin
   │
   ├── size cap exceeded ─────────────────> Diagnostics   (refused before parsing)
   │
   └── parse ──> walk ──> floor checks ──┬─> Tree          (no violation found)
                                         └─> Diagnostics   (one or more, all of them)
```

There is no partial-tree outcome (research D5): everything above the floor may assume that a tree it
holds is on the floor.
