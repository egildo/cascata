# Research: The JSON Format Adapter

Everything below was measured on this machine on 2026-09-02, against the repository at `49e9eda`,
before any adapter code was written. Node v25.6.1, pnpm, vitest 3.2.4. Nothing here is inferred from
documentation.

## The probe gate (Principle V)

The gate exists for research that concludes a dependency handles something "for free". This
milestone adds **no dependency** — the parser is hand-written, which is itself the finding of D-1
below. The gate still applies, because the parser leans on three host-language primitives (`BigInt`,
`Number`, `TextDecoder`) and on the *existing* YAML adapter's conventions, and a wrong assumption
about any of them corrupts every span or every number. Each is probed here against one **non-ASCII**,
one **boundary**, and one **adversarial** input.

| probe | input | result | consequence |
|---|---|---|---|
| **non-ASCII** | `{"café":1}` | 11 bytes; `"café"` is 4 code points and 4 UTF-16 units, but 5 **bytes** | a UTF-16 index is not a byte offset; the parser must count bytes, and does so by scanning bytes rather than a decoded string |
| **non-ASCII, astral** | `{"a":"😀"}` | `😀` is 1 code point, 2 UTF-16 units, 4 bytes | column must count code points, not UTF-16 units — the v0.1 trap, reproduced here rather than assumed to have been fixed once and for all |
| **boundary** | `1.7976931348623157e308` | `Number(...)` = `1.7976931348623157e+308`, finite | the largest finite double survives the round trip |
| **boundary** | `99999999999999999999999999999999` | `BigInt(...)` exact, 32 digits | integers are exact at any magnitude with no special casing |
| **adversarial** | `0007` | **`BigInt("0007")` returns `7n`** | `BigInt` accepts leading zeros, which RFC 8259 §6 forbids. The grammar check MUST be the parser's own; delegating it to `BigInt` would silently accept `01` |
| **adversarial** | `1e2` | `BigInt("1e2")` **throws** `SyntaxError` | a `bigint` conversion is only ever attempted on a literal the parser has already classified as an int; the throw is unreachable, and is not relied on as a check |
| **adversarial** | `1e400` | `Number(...)` = `Infinity` | out-of-range literals become `Infinity`; see D-5 |
| **adversarial** | invalid UTF-8 (`C3` with no continuation) | caught by the existing byte validator at the offending offset | see D-2 |

## Findings

### P-1: the position triple must be computed from bytes, not from a decoded string

The YAML adapter receives positions from `yaml` as UTF-16 code-unit indices and converts them
through a per-document offset table, because it has no choice: the library reports what it reports.
A hand-written parser has a choice, and scanning the **byte array directly** removes the conversion
and the whole class of bug it exists to fix. Line is a count of `0x0A` bytes; column is a count of
non-continuation bytes (`(b & 0xC0) !== 0x80`) since the line start, which is exactly a count of code
points. Both are maintained incrementally as the cursor advances, so the whole scan is linear.

Verified against the two non-ASCII probes above: `{"café":1}` is 11 bytes and puts `1` at byte 9,
where the UTF-16 index is 8; `{"a":"😀"}` is 12 bytes but 10 UTF-16 units and 9 code points, and puts
the closing `}` at byte 11, column 9 — a UTF-16 column would say 10.

### P-2: the UTF-8 validator already exists and must not be written twice

`findFirstInvalidUtf8ByteOffset` and `locateByteOffset` live in `src/adapters/yaml/parse.ts` as
module-private functions. They implement Unicode Table 3-7 exactly — overlongs, encoded surrogates
and past-U+10FFFF all excluded — and they are the sort of code that is wrong the second time it is
written. **Decision:** extract both, unchanged, into `src/adapters/encoding.ts`, and have both
adapters import them. This moves code without changing a line of its logic; the existing
`bytes-encoding` corpus cases are the regression test for the move, and they are asserted to still
pass before anything else is built on top.

An alternative was considered and rejected: exporting them from `yaml/parse.ts` and importing them
into `json/parse.ts`. That makes the JSON adapter depend on the YAML adapter, which is a dependency
between two siblings that share nothing but a byte-level concern — the shared concern deserves its
own module.

### P-3: the number grammar must be the parser's own

RFC 8259 §6: `number = [ minus ] int [ frac ] [ exp ]`, `int = zero / ( digit1-9 *DIGIT )`. The
adversarial probe above shows `BigInt("0007") === 7n`: the host primitive is more permissive than the
standard in exactly the place the standard is deliberately strict. `Number()` is worse — it accepts
`Infinity`, `0x10`, `""` (as 0), and leading/trailing whitespace. Neither may be used as a validator;
both are used only as *converters*, on a substring the parser's own scan has already proved to match
the grammar.

Classification is lexical and is decided by the scan, not by the value: the presence of a `frac` or
an `exp` makes the literal a float. `1e2` is a float whose value is 100; `100` is an int.

### P-4: what the YAML adapter already does with the awkward numbers

Measured through the shipped surface (`parse()` on `dist/index.js`), so that the JSON adapter's
choices could be made *consistent with an existing decision* rather than invented:

| document | kind | value |
|---|---|---|
| `a: -0` | `int` | `0n` |
| `a: -0.0` | `float` | `-0` |
| `a: 1e400` | `float` | `Infinity` |
| `a: .inf` | `float` | `Infinity` |
| `a: .nan` | `float` | `NaN` |

So `-0` → `int 0n` and `1e400` → `float Infinity` are not new positions this milestone invents; they
are the positions the codebase already holds, reached from a second grammar. JSON has no spelling for
`.inf` or `.nan`, so `Infinity` is reachable in JSON only by overflow.

### P-5: the conformance-case format cannot express a non-finite float

`tests/corpus/case.ts` says so in its own comment: `float` is a JSON number in the case file, and
there is no representation for `.nan`/`.inf`. `1e400` therefore cannot have a corpus case, and gets a
unit test instead. Recorded rather than quietly skipped — the case format is what would need changing,
and changing it for one input is a worse trade than one honest unit test.

### P-6: three whole-corpus tests feed every case to the YAML adapter

`tests/unit/totality.test.ts`, `tests/unit/hermetic.test.ts` and `tests/unit/entry-parity.test.ts`
each call `loadCases(CASES_DIR)` and then `parseYamlInput`/`parseText` on **every** case, ignoring
the case's own `format` field. Adding JSON cases to the same directory therefore feeds JSON text to
the YAML parser. For `totality` and `hermetic` that is harmless but meaningless (they assert only
"does not throw"); for `entry-parity` it is a real failure risk, since it asserts the parse
*succeeds*.

**Decision:** make all three dispatch on `testCase.format`, through one shared
`tests/corpus/adapters.ts`. This is a strengthening, not a weakening: each test's property — totality,
hermeticity, bytes/text parity — now holds for **both** adapters instead of for one adapter and one
misdirected pile of documents. Recorded here because CLAUDE.md requires any change to an existing
test to be justified in the report.

### P-7: `src/index.ts` hard-codes `"yaml"` at both parse-at-location sites

`parseAtLocation` (line ~270) and the delegation graft (line ~798) each read
`formatForLocation(location)` and then compare the result to the literal `"yaml"`, calling
`parseYamlBytes` directly. The registry's own module comment says it exists so that "the JSON and
TOML adapters join with **no** change to `resolve/` or `graph/`" — which is true, and neither is
touched — but the orchestrator itself never learned to use it. Both sites become
`adapterForFormat(format)?.parseBytes(...)`. The refusal for an unrecognized extension keeps its
existing shape and code (`document-unreachable`), unchanged, so nothing an existing test asserts
moves.

### P-8: the motivating consumer's real document, measured

`exiftool -json -struct -G1` on `~/Privata/test-archive/pristine/master/2022/2022-10/20221030_203857_1265d2.heic`:

| fact | value |
|---|---|
| bytes | 8716 |
| lines | 204 |
| top level | a **JSON array holding exactly one object** |
| keys in that object | 167 |
| nesting depth | 5 in Cascata's convention (root array 0, object 1, `RegionInfo` 2, `RegionList` 3, a region 4, `Area` 5) |
| number tokens | 32 `int`, 18 `float` |
| largest integer | 196908840269750 — below 2^53, so nothing here would have caught a lossy integer path |
| non-ASCII bytes | **0** |
| escapes used | `\"` only |
| duplicate keys | none |

Two consequences, both recorded in the plan's amendments and confirmed here. The fixture supplies
**neither** a non-ASCII probe nor a big-integer probe, so both must be synthetic corpus cases — a
milestone that verified itself only against this packet would have shipped a broken span converter
and never known. And the expected tree for the verification is the subtree at
`/0/XMP-mwg-rs:RegionInfo`, because the array wrapper is real and the adapter does not remove it.

*(The plan's amendment said "10 float values". Measured: 18 float tokens and 32 int tokens. The
lower count comes from counting number-looking runs inside string values — exiftool writes
`"0.512153, 0.276124, 0.0421627, 0.0727513"` as a **string** for `XMP-MP:RegionInfoMP`. Corrected
here rather than carried forward; nothing depends on the number.)*

## Decisions

- **D-1: hand-written recursive-descent parser over the byte array.** No dependency (FR-018), byte
  offsets by construction (P-1), exact integers by construction (P-3). About 400 lines.
- **D-2: shared encoding module** (P-2).
- **D-3: syntax errors abort; floor violations accumulate.** A JSON syntax error has no
  resynchronization point — after `{"a": ,` there is no honest way to say where the next value
  begins — so the first `malformed-document` ends the parse. `duplicate-key` and
  `depth-limit-exceeded` do not: both are found at a point where the scan knows exactly how to
  continue, so both accumulate and a document with two duplicate keys reports two. This matches the
  YAML adapter's split, where reader errors come from `doc.errors` and floor violations come from the
  walk.
- **D-4: a value refused for depth is skipped iteratively.** The recursion is bounded by `maxDepth`
  and never by the input, so the adversarial "10,000 open brackets" document is a diagnostic rather
  than a `RangeError`. Asserted directly in the totality test.
- **D-5: an out-of-range number is `Infinity`, not a refusal.** RFC 8259 §6 leaves range to the
  implementation, and P-4 shows the codebase's existing answer. A named limit in the README.
- **D-6: empty input is `malformed-document`, unlike YAML's `null`.** JSON's `text = ws value ws`
  admits no empty document; YAML's does. The two adapters differ about *their own grammars*, which is
  not what §16's determinism law forbids — that law is about two **hosts** disagreeing about one
  document.
