# Feature Specification: The JSON Format Adapter

**Feature Branch**: `011-json-adapter`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "v1.x — the JSON adapter. A second format adapter, hand-written, parsing
RFC 8259 into the same positioned information model the YAML adapter produces, registered under
`json` and selected for `.json` by `formatForLocation`. Motivated by a real consumer: a photo
archive whose host answers a virtual `.packet.json` location with `exiftool -json -struct -G1`
bytes."

**Implements**: `SPEC.md` **§14 item 11** (the v1.x JSON adapter); §3's Parse stage; §4.1's
positioned model and §4.2's portability floor, unchanged; §12's conformance map, whose JSON row
names **RFC 8259** as the oracle; §11's resource caps; Article VI (§16) for the one export
correction this milestone makes.

**This is an addition under §15's freeze rule.** No existing meaning changes: a document that was a
YAML document before this milestone is the same YAML document after it, means the same thing, and is
read by the same code. A `.json` location that was previously unreadable becomes readable, which
adds a capability and retracts none. Nothing in §4.2, §5, §7, §9, §17 or §18 is touched. The
milestone's one *correction* is `Host`/`HostReadResult` being exported from the public surface — see
FR-017 and §15's entry.

**Taken ahead of its roadmap position, deliberately.** §14 lists the JSON adapter in item 11 (v1.x)
after item 10's JSON Schema exporter (v1.2). Taking it earlier is permitted — an addition changes no
meaning, and the exporter and the adapter are independent — and the reason is a consumer that exists
now: an archive tool whose host renders a photograph's metadata as JSON bytes and cannot be built
until Cascata can read them. The constitution's Sequencing gate asks that a reorder state why in
Complexity Tracking; [plan.md](./plan.md) does.

## User Scenarios & Testing *(mandatory)*

The user is **the embedder** — Article VI's host author. They already hand Cascata bytes for a
location; today those bytes must be YAML or the document is unreachable. The two documents they
actually hold are a hand-written configuration (YAML, comfortable to write) and a machine rendering
(JSON, which is what tools emit). They want both to arrive in the same cascade, the same model, and
the same diagnostics, and they want to be told when the machine rendering is wrong in the same terms
they are told when their own YAML is.

### User Story 1 - A JSON document parses to the same model a YAML one does (Priority: P1)

The one property that makes a second adapter worth having: format-blindness stops being a claim
about the architecture and becomes an observed fact about two live adapters.

**Why this priority**: everything else in the milestone is a refusal, and a refusal only means
something once acceptance does. It is also the property the motivating consumer needs first.

**Independent Test**: `{"a": 1, "b": [true, null]}` and the equivalent YAML both parse; the two
trees are `nodesEqual`.

**Acceptance Scenarios**:

1. **Given** a well-formed JSON document, **When** parsed, **Then** the result is a positioned
   `Node` tree, every node carrying a span whose offsets are **bytes**, whose line is 1-based and
   whose column is counted in **code points**.
2. **Given** a JSON object and the YAML mapping with the same entries, **When** both are parsed,
   **Then** the trees are model-equal under the one definition of equality (`nodesEqual`, §4.2).
3. **Given** a JSON document at a `.json` location, **When** `resolve()`/`load()` reads it, **Then**
   the format registry selects the JSON adapter with no change to `src/resolve/` or `src/graph/` —
   the seam `src/adapters/registry.ts` was written for in v0.2.
4. **Given** an object whose keys are not in sorted order, **When** parsed, **Then** the mapping
   iterates in canonical (code-point) order, exactly as a YAML mapping does (§4.2).
5. **Given** `{}` and `[]`, **When** parsed, **Then** they are an empty mapping and an empty
   sequence — present, empty, and distinct from `null` and from absence (§4.2's three-way rule).

### User Story 2 - Numbers keep their lexical kind, and integers stay exact (Priority: P1)

**Why this priority**: §4.2's numeric rule is the portability-floor decision most easily lost by
reaching for the host language's parser, and the consumer's documents are full of numbers.

**Independent Test**: `{"i": 2, "f": 2.0, "e": 1e2, "big": 99999999999999999999999999999999}` yields
`int 2n`, `float 2`, `float 100`, `int 99999999999999999999999999999999n`.

**Acceptance Scenarios**:

1. **Given** a number literal with **neither** a fraction nor an exponent, **When** parsed, **Then**
   its kind is `int` and its value is a `bigint`, exact at any magnitude.
2. **Given** a number literal with a fraction **or** an exponent (`2.0`, `1e2`, `1E2`, `1e+2`),
   **When** parsed, **Then** its kind is `float`, whatever the mathematical value is — `1e2` is a
   float, not an int that happens to be whole.
3. **Given** `-0`, **When** parsed, **Then** it is `int 0n`; given `-0.0`, `float -0`. Both match
   what the YAML adapter already does with the same spellings (measured, research P-4).
4. **Given** a literal RFC 8259 forbids — a leading zero (`01`), a leading `+`, a bare `.5`, a
   trailing `1.`, `Infinity`, `NaN`, `0x10` — **When** parsed, **Then** the document is refused with
   `malformed-document` at the offending byte.

### User Story 3 - The portability floor is enforced, with positions (Priority: P1)

**Why this priority**: Principle V's own words — an assertion that a standard is honored without a
case citing it is an unbacked claim. Every §4.2 refusal the YAML adapter makes that JSON can even
express must be made here too, with a span, and the ones JSON cannot express must be *recorded* as
unreachable rather than silently omitted.

**Independent Test**: `{"a": 1, "a": 2}` is refused with `duplicate-key`, primary at the second
`"a"`, related at the first.

**Acceptance Scenarios**:

1. **Given** an object with the same key twice, **When** parsed, **Then** `duplicate-key`, primary
   the later key's own span, `related` carrying the first occurrence — the same two-span shape the
   YAML adapter produces (v0.1 FR-018). RFC 8259 §4 permits duplicates; Cascata does not.
2. **Given** bytes that are not well-formed UTF-8, **When** parsed, **Then** `invalid-encoding` at
   the **byte offset** where well-formedness stops, with nothing repaired into U+FFFD.
3. **Given** a `\uD800` escape with no low surrogate following, **When** parsed, **Then**
   `invalid-encoding` at the escape — a lone surrogate is not text and cannot be UTF-8 (v0.1 FR-016
   applied to JSON's own escape syntax, not to a JS string's internals).
4. **Given** a document nested one level past `maxDepth`, **When** parsed, **Then**
   `depth-limit-exceeded` at the node that crossed the cap; at exactly `maxDepth`, accepted.
5. **Given** input one byte past `maxBytes`, **When** parsed, **Then** `size-limit-exceeded`,
   refused before parsing at all.
6. **Given** a JSON document, **Then** `non-string-key`, `unsupported-tag`, `multiple-documents` and
   `alias-cycle` are **unreachable**: the grammar has no non-string key, no tag, no document marker
   and no alias. This is recorded, with a case for the nearest legal document, not omitted.

### User Story 4 - More than one value, or none, is not a document (Priority: P2)

**Independent Test**: `{"a": 1} {"b": 2}` is refused; `` (empty) is refused; `  ` is refused.

**Acceptance Scenarios**:

1. **Given** a document with content after the first complete value, **When** parsed, **Then**
   `malformed-document` at the first byte of the trailing content.
2. **Given** empty or whitespace-only input, **When** parsed, **Then** `malformed-document` at
   offset 0. **This differs from the YAML adapter**, which reads an empty document as a `null`
   scalar — correctly, because YAML says so and RFC 8259 does not: JSON's `text = ws value ws` has
   no production for no value at all. Two adapters disagreeing about *what their own grammar
   admits* is not two hosts disagreeing about what one configuration means (§16).
3. **Given** a document that is a single scalar or a single array at top level, **When** parsed,
   **Then** it is accepted — RFC 8259 §2 admits any value as the text, and Cascata already accepts a
   sequence or a scalar at the document root.

### User Story 5 - The motivating consumer's real document (Priority: P2)

**Independent Test**: the 8716-byte packet `exiftool -json -struct -G1` renders for one HEIC
photograph parses with **no diagnostics**, and the subtree at `/0/XMP-mwg-rs:RegionInfo` equals a
tree written by hand from the rendered text.

**Acceptance Scenarios**:

1. **Given** a real exiftool rendering, **When** parsed, **Then** no diagnostics, and the tree's
   shape matches a hand-derived expectation for a named subtree — not a snapshot of the parser's own
   output.
2. **Given** the same bytes, **When** parsed twice, **Then** identical trees, spans included.

### Edge Cases

- **A key that is `__proto__`.** Mappings are `Map`s built by `createMapping`, so an author-supplied
  `__proto__` is an ordinary key and reaches no prototype. Covered by a case, because the trap is
  real (CLAUDE.md) even where this code is structurally immune to it.
- **A number outside the double range** (`1e400`). Accepted as `float Infinity`, which is exactly
  what the YAML adapter already does with `1e400` and with `.inf` (measured, research P-4). RFC 8259
  §6 leaves range implementation-defined. Recorded as a named limit; the conformance-case format has
  no way to spell a non-finite float (`tests/corpus/case.ts` says so), so this one is asserted in a
  unit test rather than in the corpus.
- **An empty key** (`{"": 1}`). Legal JSON, legal in the model, one case.
- **Deeply nested input designed to exhaust the stack.** The depth cap is checked *before* descending
  into a value, and a value refused for depth is skipped **iteratively**, so the recursion never goes
  deeper than `maxDepth` regardless of the input.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The adapter MUST expose `parseJsonBytes(bytes, origin, limits?)` producing the same
  `{ok: true, tree} | {ok: false, diagnostics}` outcome shape `src/adapters/registry.ts` declares.
- **FR-002**: RFC 8259 MUST be the oracle. The parser MUST be hand-written. `JSON.parse` MUST NOT be
  used to parse a document: it yields neither byte spans nor exact integers, and both are contractual
  (§4.1, §4.2).
- **FR-003**: UTF-8 MUST be validated on the **bytes**, before decoding, refusing with
  `invalid-encoding` at the first ill-formed byte offset. No repair to U+FFFD, ever.
- **FR-004**: A single leading byte-order mark MUST be stripped before parsing and MUST contribute
  zero bytes and zero columns to every span, exactly as the YAML adapter does.
- **FR-005**: The document MUST be exactly one JSON value, optionally surrounded by RFC 8259
  whitespace. Trailing content MUST be `malformed-document` at its first byte.
- **FR-006**: Empty or whitespace-only input MUST be `malformed-document` at offset 0.
- **FR-007**: A duplicate key MUST be refused with `duplicate-key`, primary at the later key, one
  `related` span labelled `first occurrence` at the first.
- **FR-008**: A number literal MUST take its kind lexically: a `frac` or an `exp` makes it `float`
  (a JS `number`); otherwise `int`, stored as `bigint` and exact at any magnitude.
- **FR-009**: The number grammar MUST be RFC 8259's exactly. Leading zeros, a leading `+`, a missing
  integer part, a missing fraction digit, and the JavaScript-only spellings (`Infinity`, `NaN`, hex,
  underscores) MUST all be `malformed-document`. The implementation MUST NOT delegate this check to
  `BigInt()` or `Number()`, both of which accept spellings RFC 8259 forbids (measured, research P-3).
- **FR-010**: Strings MUST follow RFC 8259 §7: an unescaped byte below 0x20 is refused; the escapes
  `\" \\ \/ \b \f \n \r \t` and `\uXXXX` are honored and nothing else is; a `\uXXXX` naming a high
  surrogate MUST be followed by a `\uXXXX` naming a low surrogate, and an unpaired surrogate MUST be
  `invalid-encoding`.
- **FR-011**: `true`, `false` and `null` MUST be accepted only in lower case, and MUST produce
  `bool`/`null` scalars.
- **FR-012**: Every span MUST carry byte offsets, a 1-based line, and a **code-point** column.
- **FR-013**: `maxBytes` MUST be checked on the raw byte length before parsing; `maxDepth` MUST be
  checked on each value before descending, the root being depth 0 — the same convention the YAML
  adapter uses (v0.1 §11).
- **FR-014**: Mappings MUST be built through `createMapping`, so canonical key order and the
  `__proto__` immunity are inherited rather than reimplemented.
- **FR-015**: `REGISTRY` MUST gain a `json` entry, and `formatForLocation` MUST return `"json"` for a
  location whose lower-cased form ends in `.json`.
- **FR-016**: `src/index.ts`'s two parse-at-location sites MUST dispatch through
  `adapterForFormat(format)` instead of comparing the format to the literal `"yaml"`. This is what
  makes FR-015 reach `resolve()`/`load()` at all.
- **FR-017**: `src/index.ts` MUST `export type { Host, HostReadResult }`. Article VI makes the host
  seam the embedder's obligation, and a consumer implementing it cannot name the interface it must
  implement: `deno check` against the published surface reports "declares 'Host' locally, but it is
  not exported" (measured). A correction under §15, not an addition — the type already exists and
  already appears in `LoadOptions`; only its name was unreachable.
- **FR-018**: No new runtime dependency. `yaml` remains the only one.
- **FR-019**: `tests/unit/layering.test.ts` MUST keep passing **untouched**. `src/adapters/json/`
  is a format-aware directory like `src/adapters/yaml/`; nothing outside `src/adapters/` and
  `src/index.ts` may reach it.
- **FR-020**: Every conformance case MUST be committed **before** the parser, with expected values
  derived by hand from RFC 8259 and from the document's own bytes, never from the implementation's
  output.
- **FR-021**: An adapter-parity test MUST assert, over at least three documents, that a `.json`
  entry document and the equivalent `.yaml` one resolve through `resolve()` to model-equal trees.
- **FR-022**: A fixture test MUST parse a real `exiftool -json -struct -G1` rendering, assert no
  diagnostics, and compare the `/0/XMP-mwg-rs:RegionInfo` subtree against a hand-written expected
  tree. It MUST read the rendering from a **recorded** file in the repository, never by running
  exiftool: tests do no I/O beyond their own fixtures and no process spawning.
- **FR-023**: The documentation sweep (`tests/unit/doc-examples.test.ts`) MUST gain a `json` lane, so
  a ```json``` block in `README.md`, `SPEC.md` or any `specs/**/*.md` is executed by this adapter
  rather than merely read.
- **FR-024**: The corpus coverage obligation (`tests/corpus/coverage.test.ts`) MUST gain a JSON
  section naming, per refusal, the directory that must hold a refusing case and an accepting one.

### Key Entities

- **`JsonScanner`** — the byte cursor. Owns the position triple (byte offset, line, code-point
  column) and advances it; nothing else in the adapter computes a position.
- **`parseJsonBytes` / `parseJsonText`** — the two entry points, mirroring the YAML adapter's pair.
  The text one exists for symmetry and for tests; the bytes one is what the registry calls.

## Success Criteria *(mandatory)*

- **SC-001**: Every new corpus case passes, and `pnpm test` is green with no existing test weakened.
- **SC-002**: Each JSON refusal named in FR-024 has both a refusing and an accepting case.
- **SC-003**: Three documents resolve identically through `.json` and `.yaml` (FR-021).
- **SC-004**: The recorded exiftool packet parses with zero diagnostics and matches the hand-written
  subtree (FR-022).
- **SC-005**: `pnpm typecheck` clean; no `any`; no assertion cast on the node model.
- **SC-006**: `pnpm build` produces a `dist/` carrying `adapters/json/parse.js` and exporting `Host`.

## Assumptions

- The consumer's virtual location ends in `.packet.json`, which ends in `.json`; no special case is
  needed for it and none is added. The registry's extension rule stays the "simplest thing that
  could work" v0.2 called it.
- The host, not the adapter, decides what a packet *means* — including exiftool's one-element array
  wrapper. The adapter parses what RFC 8259 allows and nothing more (§16: the host supplies bytes,
  never meaning).

## Out of Scope

- A native XMP adapter. A TOML adapter. Any change to the location grammar, to `Host`'s methods, or
  to the CLI (there is none).
- Adding a `format` option to the public `parse()`/`parseText()`. Those two are hard-wired to YAML
  today; only `resolve()`/`load()` consult the registry, and the motivating consumer uses `load()`.
  Changing them would be a **surface addition** needing its own §15 entry; it is deliberately not
  made here. Recorded so the next implementer finds it by reading rather than by discovering.
