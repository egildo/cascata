# Feature Specification: Spans Count Stored Bytes

**Feature Branch**: `017-stored-bytes` (committed on `main`, as 016 was)

**Created**: 2026-10-06

**Status**: Draft

**Input**: GitHub issue #6 (Egildo, 2026-10-06), raised by 0km — a consumer still at the design stage —
against v1.8.1. Two disagreements about what a span counts: `SPEC.md` §4.2 said line endings are
"normalized for span math" while the corpus counts the carriage return, and Cascata strips a leading
byte-order mark from its offsets while Provenance, the source-graph library, counts it. Probing for
this milestone found two more defects the issue did not report: the `yaml` package does not treat a
lone CR as a line break, so `a: 1⏎` reads as the string `"1\r"`; and it admits a byte-order mark at
the start of a later line into a plain key.

**Implements**: `SPEC.md` §4.2 ("Positions count two things, for two readers"), amended; §15 entry
"Spans count stored bytes" (v1.9). Supersedes by forward pointer v0.1 FR-010 and the v0.1 edge case
on the mark (`specs/001-information-model-yaml-adapter/spec.md`) and v1.2 FR-004
(`specs/011-json-adapter/spec.md`); those pointers are already written.

**Every change here is a correction under §15's freeze rule**, and §15's entry carries the argument
for each: offsets because §4.1 says *byte offset*; the lone CR and the misplaced mark because §12
mandates YAML 1.2.2 and the adapter disobeyed it; lines in JSON because no document's meaning moves.
**Refusing a lone CR was considered and rejected** — it is "a rule that starts refusing what it
accepted", which only v2.0 may make. Do not implement a refusal.

**The rule, in one line**: offsets (`start`, `end`) count the document's stored bytes; `line` and
`column` count what a person sees.

## User Scenarios & Testing

The user is **the embedder** who slices a file's bytes with a span Cascata reported — Provenance, or
0km through it — and **the author** whose file was saved on Windows, by an old Mac tool, or by an
editor that writes a byte-order mark.

- **Marked file.** A YAML or JSON document beginning with `EF BB BF`. Every offset counts the three
  bytes; no line or column moves. Slicing the input's bytes at any node's span gives exactly that
  node's text. (corpus; FR-001, FR-002, FR-008)
- **Text input.** `parseText` handed a string that begins with U+FEFF counts it as three bytes, the
  way `parse` does for the same document's bytes. (unit; FR-001)
- **Lone CR in YAML.** `a: 1⏎b: 2⏎` reads as two integers on two lines; the value at `/b` is on
  line 2. A lone CR inside a quoted scalar folds as YAML 1.2.2 folds a line break; inside a block
  scalar it is a line feed. (corpus; FR-003, FR-004)
- **Lone CR in JSON.** The value after a lone CR is reported on the next line; the tree is
  unchanged. (corpus; FR-003)
- **Misplaced mark.** `a: 1⏎﻿b: 2` (a mark at the start of line 2, ⏎ a newline) is
  `malformed-document` at the mark's offset. A mark inside a quoted scalar is content; marks before
  the content are a document prefix and are accepted. (corpus; FR-005)
- **Invalid UTF-8 in a marked file.** The `invalid-encoding` diagnostic's offset counts the mark
  (it already does); its column does not (it does today). (corpus; FR-002)
- **Nothing else moves.** A document with no mark and no lone CR reads exactly as before: same
  tree, same spans. (the existing suite)

## Requirements

- **FR-001** Every offset Cascata reports — node spans, every diagnostic's `primary` and `related`
  spans, on both adapters, through `parse`, `parseText` and the JSON entry points — counts the
  document's stored bytes. A leading byte-order mark contributes three bytes to every offset after
  it. For `parseText` and the JSON text entry point, the stored bytes are the UTF-8 encoding of the
  string given.
- **FR-002** `column` counts code points from the start of its line, and a byte-order mark is never
  counted in it, on every path, including `invalid-encoding`'s byte locator
  (`src/adapters/encoding.ts`, `locateByteOffset`), which counts it today.
- **FR-003** LF, CRLF and a lone CR (one no LF follows) each end exactly one line, on every path:
  the YAML adapter (after FR-004), the JSON adapter, and `locateByteOffset`. Nothing else ends a
  line — not U+2028, U+2029 or U+0085.
- **FR-004** The YAML adapter hands the parser an LF in place of each lone CR. The substitution is
  one code unit for one code unit, so no offset moves, and YAML 1.2.2 normalizes line breaks inside
  scalar content to LF, so the values are exactly the standard's. A CRLF pair is untouched. The
  original bytes — not the substituted text — remain what document identity and pins hash, and what
  every offset counts. Diagnostic messages that quote the source may show the substituted text.
- **FR-005** In YAML, a byte-order mark is admitted only (a) in a document prefix — before the
  document's content, repeatably, each optionally followed by comment lines (YAML 1.2.2
  `l-yaml-stream`, `l-document-prefix`) — and (b) inside a quoted scalar, single or double, where it
  is content. A mark anywhere else, a comment included (`nb-char` excludes it), is
  `malformed-document`, `level: "error"`, primary at the mark's three bytes, with a message saying
  a byte-order mark is allowed only at the start of the document or inside a quoted string. No new
  diagnostic code. The JSON adapter's behavior is unchanged: a mark at its first byte is the BOM,
  inside a string it is content, anywhere else it is already `malformed-document`.
- **FR-006** Document identity, pins and the remote cache are unchanged: they already hash the exact
  bytes. To be confirmed in the report, not newly tested, unless a test is one line.
- **FR-007** Comments and docs that state the old rule are corrected: the module docs of
  `src/adapters/yaml/parse.ts` and `src/adapters/json/parse.ts` ("contributes zero bytes"),
  `docs/reference.md` ("A BOM is ignored"), and the byte-order-mark section of
  `specs/011-json-adapter/contracts/json-adapter.md` (forward pointer, text kept as history). Grep
  `README.md`, `docs/` and `specs/*/contracts/` for `BOM`, `byte-order`, `CRLF` and `line ending`
  before claiming the sweep is done.
- **FR-008** **The slice property**, stated once: for every node span Cascata reports,
  `bytes.subarray(start, end)` decodes to exactly the text that produced the node, delimited as the
  adapter delimits it today on a document without a mark (quotes included for a quoted scalar; a
  block scalar's indicator and trailing line break included). The corpus span expectation gains an
  optional `text`, written by hand; the runner asserts the slice equals it. Every encoding case
  carries `text` on every span it lists.

## Conformance

**Corpus.** Expected values below are derived by hand from the bytes, byte by byte, and are the
authority; do not copy any value from a run. Where a run disagrees, re-derive by hand and report
which side was wrong. `line`/`column` are 1-based; `end` is exclusive.

YAML (`tests/corpus/cases/encoding/`):

| Case | Input | Expect |
|---|---|---|
| `byte-order-mark` (changed) | `﻿a: 1\nb: 2\n` | `/a` 6–7 L1 C4 `"1"`; `/b` 11–12 L2 C4 `"2"` |
| `crlf-line-endings` (add `text`) | `a: 1\r\nb: 2\r\n` | `/b` 9–10 L2 C4 `"2"` |
| `lf-baseline` (add `text`) | `a: 1\nb: 2\n` | `/b` 8–9 L2 C4 `"2"` |
| `lone-cr-line-endings` | `a: 1\rb: 2\r` | `{a: 1, b: 2}` ints; `/a` 3–4 L1 C4; `/b` 8–9 L2 C4 |
| `mixed-line-endings` | `a: 1\r\nb: 2\rc: 3\nd: 4\n` | `/b` 9–10 L2 C4; `/c` 14–15 L3 C4; `/d` 19–20 L4 C4 |
| `lone-cr-sequence` | `- x\r- y\r` | `["x", "y"]`; `/1` 6–7 L2 C3 |
| `lone-cr-final` | `a: 1\r` | `{a: 1}`, an int |
| `lone-cr-in-double-quoted` | `a: "x\ry"\n` | `{a: "x y"}` (a single line break folds to a space) |
| `lone-cr-in-literal-block` | `a: \|\r  one\r  two\r` | `{a: "one\ntwo\n"}` |
| `byte-order-mark-in-quoted-scalar` | `a: "﻿x"\n` | `{a: "\u{FEFF}x"}`, accepted |
| `byte-order-mark-repeated-prefix` | `﻿﻿a: 1\n` | `/a` 9–10 L1 C4 |
| `byte-order-mark-after-comment-prefix` | `﻿# c\n﻿a: 1\n` | `/a` 13–14 L2 C4 |
| `byte-order-mark-misplaced` | `a: 1\n﻿b: 2\n` | `malformed-document` 5–8 L2 C1 |
| `byte-order-mark-in-comment` | `a: 1 # ﻿\n` | `malformed-document` 7–10 L1 C8 |

JSON (`tests/corpus/cases/json-encoding/`):

| Case | Input | Expect |
|---|---|---|
| `byte-order-mark-counted` (renamed from `byte-order-mark-stripped-spans-unchanged`) | `EF BB BF` + `{"a":1,"b":2}` | `/a` 8–9 L1 C6 `"1"`; `/b` 14–15 L1 C12 `"2"` |
| `lone-cr-line-endings` | `{"a":1,\r"b":2}` | `/b` 12–13 L2 C5 |
| `mixed-line-endings` | `{"a":1,\r\n"b":2,\r"c":3\n}` | `/b` 13–14 L2 C5; `/c` 20–21 L3 C5 |

Byte path (`tests/corpus/cases/bytes-encoding/`):

| Case | Bytes | Expect |
|---|---|---|
| `invalid-byte-after-byte-order-mark` | `EF BB BF 61 3A 20 FF 0A` | `invalid-encoding` 6–7 L1 C4 (C5 today) |
| `invalid-byte-after-lone-cr` | `61 3A 20 31 0D FF` | `invalid-encoding` 5–6 L2 C1 |

The two `byte-order-mark-*-prefix` cases are derived from YAML 1.2.2's productions, not from a
parser. **The probe gate applies**: before deciding how FR-005 is implemented, run each placement
in the table — and a mark after an explicit `---`, and one inside a block scalar — through `yaml`
as it stands, and write down what it does. If yaml-test-suite has byte-order-mark cases, cross-check
against them and cite them.

**Unit.** `parseText` on a marked string equals `parse` on its bytes, span for span (FR-001). A JSON
document read through the text entry point counts the mark the same way. Identity of a marked
document hashes all its bytes, mark included (FR-006, one line if it is one line).

**Sabotage**, each watched red and restored, backed up to `/tmp` first, marked `SABOTAGE`:
- Strip the mark again in the YAML adapter only — the YAML mark cases must go red, the JSON ones
  must not; then the same for JSON.
- Count the mark in `column` — the mark cases go red on column, not on offset.
- Drop the lone-CR substitution — the lone-CR YAML cases go red on the tree, not only on lines.
- Substitute CRLF too (to LF LF) — `crlf-line-endings` goes red.
- Count only LF in `locateByteOffset` — `invalid-byte-after-lone-cr` goes red.
- Admit every mark — the two misplaced-mark cases go red; refuse every mark not at byte 0 — the
  quoted-scalar and prefix cases go red.
- Break the slice assertion (compare against `start + 1`) — every case with `text` goes red.

`grep -rn SABOTAGE src/ tests/` before every commit.

**Existing tests that change**, to be named in the report with the reason: the two byte-order-mark
cases (offsets move by three; the JSON one is renamed, its old name now being false). Any other
existing test that goes red is a finding, not something to update — stop and report it.

## Out of scope

- **Refusing a lone CR.** Rejected above; it needs v2.0.
- **Encodings other than UTF-8.** §4.2 still mandates UTF-8. The rule "offsets count stored bytes"
  is chosen partly because it would survive UTF-16 unchanged; nothing here reads UTF-16.
- **Provenance.** Its offset fixes are its own milestone, in its own repository.
- **TOML.** Not built. When it is, TOML 1.0 forbids a lone CR, and the line rule is unaffected.

## Plan and tasks

Run `/speckit-plan` and `/speckit-tasks`, or one plan file on the 012–016 precedent; say which in
the Complexity Tracking note. Commit each step the moment it is green — the 600-second watchdog has
killed an implementer twice:

1. **The slice property and the mark** — FR-008's `text` field and assertion first, then FR-001,
   FR-002 (mark half), FR-006; the changed and new mark cases. Tests first, red against the
   current code.
2. **Lines and the lone CR** — FR-003, FR-004; the lone-CR and mixed cases, both adapters and the
   byte path.
3. **The misplaced mark** — FR-005, after the probe; its cases.
4. **Docs and report** — FR-007; `specs/017-stored-bytes/report.md`.

Do not bump the version. `SPEC.md` is already amended (§4.2, §15) and the forward pointers are
written. **Do not edit `SPEC.md`.** Check every sentence of the amendment and of this spec against
what the code turned out to do, and report each disagreement unsoftened.
