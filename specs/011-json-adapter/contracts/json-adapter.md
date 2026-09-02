# Contract: the JSON adapter

## Surface

```ts
parseJsonBytes(bytes: Uint8Array, origin: Origin, limits?: Partial<ParseLimits>): ParseOutcome
parseJsonText(text: string, origin: Origin, limits?: Partial<ParseLimits>): ParseOutcome
```

`parseJsonBytes` is what `src/adapters/registry.ts` registers and what `resolve()`/`load()` reach.
`parseJsonText` exists for symmetry with the YAML adapter and for tests; it encodes to UTF-8 and
delegates, so the two agree by construction rather than by discipline.

Neither is exported from `src/index.ts` in this milestone. The public `parse()`/`parseText()` stay
hard-wired to YAML (spec.md, Out of Scope): adding a `format` option to them is a surface addition
with its own §15 entry, and the motivating consumer reaches the adapter through `load()`.

## Guarantees

1. **Total.** Every input produces one of the two outcomes. No input throws. An `Error` thrown from
   this module is a bug in it, never a fact about the document — the same posture `parseYamlBytes`
   holds, and asserted the same way (`tests/unit/totality.test.ts`).
2. **Positioned.** Every node carries a span; there is no path by which one does not, because
   `src/model/node.ts`'s factories require one.
3. **Never both.** A successful parse carries no diagnostics; a refusal carries at least one and no
   tree.
4. **Ordered.** Diagnostics come back sorted by the byte offset of their primary span
   (`DiagnosticCollector.all()`).
5. **Deterministic.** The same bytes give the same tree and the same diagnostics, in the same order,
   every time.
6. **Byte-faithful.** `parseJsonBytes(utf8(text))` and `parseJsonText(text)` produce identical trees,
   spans included, for every text that is valid UTF-8 (`tests/unit/entry-parity.test.ts`, extended to
   dispatch on format).

## Refusals, in the order the parser can meet them

| order | condition | code |
|---|---|---|
| 1 | raw byte length > `maxBytes` | `size-limit-exceeded` (checked before parsing at all) |
| 2 | the bytes are not well-formed UTF-8 | `invalid-encoding`, at the first ill-formed byte |
| 3 | the document is empty or only whitespace | `malformed-document`, zero-width at offset 0 |
| 4 | any grammar violation | `malformed-document`, at the offending byte — **parsing stops** |
| 4a | a value deeper than `maxDepth` | `depth-limit-exceeded` — the value is skipped, parsing continues |
| 4b | a repeated key in one object | `duplicate-key` — parsing continues |
| 4c | a `\uXXXX` escape naming an unpaired surrogate | `invalid-encoding` at the escape — parsing stops (the string's text is not recoverable) |
| 5 | non-whitespace after the first complete value | `malformed-document`, at its first byte |

Rows 4a and 4b are the only two that accumulate. Everything else ends the parse, because JSON has no
resynchronization point: after a grammar violation there is no honest way to say where the next
value begins, and a guess would produce diagnostics whose positions mean nothing.

## The number grammar, verbatim from RFC 8259 §6

```
number = [ "-" ] int [ frac ] [ exp ]
int    = "0" / ( digit1-9 *DIGIT )
frac   = "." 1*DIGIT
exp    = ("e" / "E") [ "-" / "+" ] 1*DIGIT
```

Accepted and their kinds: `0` int · `-0` int (value `0n`) · `12` int · `-12` int ·
`0.0` float · `-0.0` float (value `-0`) · `1e2` float · `1E2` float · `1e+2` float · `1e-2` float ·
`0e0` float · a 40-digit integer, int, exact.

Refused: `01` · `+1` · `.5` · `1.` · `1.e2` · `1e` · `1e+` · `--1` · `Infinity` · `-Infinity` ·
`NaN` · `0x10` · `1_000`.

**The check is the parser's own scan, never `BigInt()` or `Number()`** — `BigInt("0007")` is `7n`
(research P-3), so delegating would accept a leading zero. Both primitives are called only on a
substring the scan has already proved to match the grammar above.

A literal whose magnitude exceeds the double range converts to `Infinity`/`-Infinity`, which is what
the YAML adapter already does with `1e400` and with `.inf` (research P-4). Recorded as a limit, not
as a refusal.

## The string grammar

Between the quotes: any byte ≥ 0x20 except `"` and `\`, or an escape. The escapes are exactly
`\" \\ \/ \b \f \n \r \t \uXXXX`, `X` a hexadecimal digit in either case. Anything else after a
backslash is `malformed-document`. An unescaped byte below 0x20 — including a real newline or tab
inside a string — is `malformed-document` at that byte.

`\uXXXX` in `D800`–`DBFF` must be followed immediately by `\uXXXX` in `DC00`–`DFFF`, and the pair
becomes the one code point they encode. A high surrogate not so followed, and a bare low surrogate,
are `invalid-encoding`: an unpaired surrogate is not a character and has no UTF-8 encoding, which is
the identical hazard v0.1 named for a lone surrogate reaching the YAML adapter through a JS string.

## Whitespace

RFC 8259 §2's four bytes only: space (0x20), horizontal tab (0x09), line feed (0x0A), carriage
return (0x0D). No other byte is whitespace — a vertical tab or a form feed between tokens is
`malformed-document`, and a U+00A0 is not whitespace either.

## Byte-order mark

RFC 8259 §8.1 forbids one and says a parser may ignore it. Cascata ignores it, exactly as the YAML
adapter does: a single leading `EF BB BF` is removed before parsing and contributes **zero** bytes
and zero columns, so every span in a document with a BOM equals the span in the same document
without one. A BOM anywhere else is an ordinary U+FEFF: inside a string it is content, and between
tokens it is `malformed-document`, because it is not one of §2's four whitespace bytes.

## Limits

`maxBytes` (default 8 MiB) is checked on the raw input before anything else. `maxDepth` (default 64)
counts collections: the root value is depth 0, each collection's members are one deeper. `{"a": 1}`
puts the scalar `1` at depth 1; `{"a": {"b": 1}}` puts it at depth 2. The check runs *before*
descending, so recursion is bounded by `maxDepth` and never by the input.
