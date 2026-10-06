# Data Model: The JSON Format Adapter

The adapter introduces **no new persistent shape**. Its output is `src/model/node.ts`'s `Node`, and
its refusals are `src/diagnostics/diagnostic.ts`'s `Diagnostic`, both unchanged. What follows is the
mapping from RFC 8259's grammar to that model, and the two internal types the parser needs.

## RFC 8259 → the information model

| JSON production | model | notes |
|---|---|---|
| `object` | `Mapping` | built through `createMapping`, so keys land in canonical (code-point) order and `__proto__` is an ordinary key (§4.2, Article VII) |
| `member` name | the entry's key, a `string` | JSON guarantees a string key; `non-string-key` is unreachable from this grammar |
| `array` | `Sequence` | item order preserved (§4.2) |
| `string` | `Scalar` `kind: "string"` | escapes resolved; the model holds the resolved text, never the source spelling (§4.3, lossy by design) |
| `number` with no `frac` and no `exp` | `Scalar` `kind: "int"`, `bigint` | exact at any magnitude |
| `number` with a `frac` or an `exp` | `Scalar` `kind: "float"`, `number` | lexical kind wins: `1e2` is a float (§4.2) |
| `true` / `false` | `Scalar` `kind: "bool"` | |
| `null` | `Scalar` `kind: "null"` | a *present* key whose value is null — distinct from absence (§4.2) |

### Spans

Every node's span covers its own source extent, in **bytes**, with `line` 1-based and `column` a
1-based count of **code points** from the line start.

| node | `start` | `end` |
|---|---|---|
| object | the `{` | one past the `}` |
| array | the `[` | one past the `]` |
| string | the opening `"` | one past the closing `"` |
| number | the `-` or first digit | one past the last digit |
| `true`/`false`/`null` | the first byte of the literal | one past the last |

A key's own span — needed for `duplicate-key`'s two positions — is the key string's extent,
including its quotes, and is not stored on any node: it exists only for the diagnostic.

## Internal types

### `Scanner` (`src/adapters/json/scan.ts`)

The one place a position is computed. Mutable by design; nothing else in the adapter touches
`offset`, `line` or `column`.

```
bytes:   Uint8Array   the document, after any BOM was removed
offset:  number       byte offset of the next unread byte
line:    number       1-based, incremented on every 0x0A consumed
column:  number       1-based, in code points: incremented on every consumed byte that is not a UTF-8 continuation byte
```

*Amended by v1.9, `specs/017-stored-bytes/`: `bytes` is the document as stored, a leading mark included
(scanning starts past it); `offset` counts it; `line` is incremented on LF, and on a CR no LF follows;
`column` does not count a U+FEFF. The lines above are history.*

Invariant: `offset`, `line` and `column` always describe the same point, because the only way to
move is `advance()`, which updates all three. A parser that recomputed a line number by scanning
backwards would be quadratic and would drift; this one cannot.

### `ParseOutcome`

Structurally identical to the YAML adapter's, and to `AdapterParseOutcome` in the registry:
`{ ok: true, tree } | { ok: false, diagnostics }`. Never both (§16's "one call ... or a set of
errors, never both", and the YAML adapter's research D5).

## Diagnostic codes used

All five are existing codes, reused because the hazard is identical, not renamed:

| code | when | primary span | related |
|---|---|---|---|
| `duplicate-key` | one object names a key twice | the later key, quotes included | the first occurrence, labelled `first occurrence` |
| `invalid-encoding` | ill-formed UTF-8 in the bytes; a `\uXXXX` escape naming an unpaired surrogate | the offending byte / the offending escape | — |
| `depth-limit-exceeded` | a value sits deeper than `maxDepth` | that value's own first byte | — |
| `size-limit-exceeded` | the raw input exceeds `maxBytes` | zero-width at offset 0 (nothing was parsed) | — |
| `malformed-document` | any violation of RFC 8259's grammar; trailing content; an empty document | the offending byte, zero-width at end-of-input where the input simply stopped | — |

**No new code is added.** The plan anticipated that a JSON-only refusal might appear and asked for it
to be reported if it did. None did: every way a JSON document can be wrong is either one of the five
above or a grammar violation, and a grammar violation is what `malformed-document` is for. The two
JSON-specific refusals that felt like candidates — an unpaired surrogate escape, and content after
the first value — are respectively the *same* hazard `invalid-encoding` already names (text that
cannot be UTF-8) and the *same* hazard `malformed-document` already names (the byte stream does not
match the grammar), so a new code would have said less, not more.

## Unreachable floor rules, recorded

`non-string-key`, `unsupported-tag`, `multiple-documents` and `alias-cycle` cannot be produced by
this adapter. The grammar has no non-string key, no tag syntax, no document separator, and no
aliases. They are listed here so that a reader looking for them finds an answer rather than a
silence, and the corpus carries an accepting case for the nearest legal document in each direction
(a string key that *looks* numeric, `{"1": true}`; a document containing the text `---`; a document
containing `&a` and `*a` as ordinary string content).
