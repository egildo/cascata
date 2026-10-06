# Implementation Plan: Spans Count Stored Bytes

**Spec**: [spec.md](./spec.md) · **Implements**: `SPEC.md` §4.2 (amended), §15 "Spans count stored bytes" (v1.9)

**Complexity Tracking note**: one plan file on the 012–016 precedent, not `/speckit-plan` +
`/speckit-tasks`. The change touches two adapters, one shared locator and the corpus harness; it has no
new entity, no new public surface and no new diagnostic code, so a data model and contracts directory
would restate the spec.

## Approach

| FR | Change |
|---|---|
| FR-008 | `ExpectedSpan` and `ExpectedDiagnostic` gain optional `text`; runner slices the case's bytes (`TextEncoder` of `input`, or `inputBytes`) at the matched span and compares against a *fatal, BOM-preserving* decode. |
| FR-001 | YAML: stop stripping the mark; `text` keeps it, the byte table is built over it, `documentLength` is the raw length. JSON: scanner starts at offset 3 when a mark leads; `documentLength` is the full byte length. |
| FR-002 | `column` never counts a mark at byte 0; any other U+FEFF counts (round 2; round 1 skipped every U+FEFF — see Round 2). YAML `codePointColumn`, JSON `Scanner.advance`, `locateByteOffset`. |
| FR-003 | `Scanner.advance` and `locateByteOffset` end a line at a CR no LF follows. YAML via FR-004. |
| FR-004 | `parseYaml` builds `yamlText` from the raw text: each lone CR becomes LF (same length). `yamlText` goes to `parseDocument` only; spans, byte table, columns and the surrogate scan use the original. |
| FR-005 | Pre-scan of the raw text for U+FEFF; each is *prefix* (accepted), *inside a quoted scalar* (accepted, found by visiting the parsed AST), or refused as `malformed-document`. Prefix marks are blanked (round 1) / removed with an index map (round 2, see below) in `yamlText`. |
| FR-006 | Confirmed, not newly built: identity/pins hash the bytes read; one unit assertion if it is one line. |
| FR-007 | Doc sweep at step 4. |

## Decisions the spec left open

1. **(Superseded in round 2 — see the end.) `column` and U+FEFF — every U+FEFF is skipped, not only a leading mark.** FR-002 says "a
   byte-order mark is never counted"; FR-005 says a mark in a quoted scalar "is content". Both cannot be
   read as "a mark in a quoted scalar is counted". The byte-path locator runs before any format is
   known and cannot tell a prefix mark from content, so the only rule all three paths can share is "a
   U+FEFF is never in a column". Reported in the report as an invented detail.
2. **Zero-width document with a mark.** `BOM` alone or `BOM # c` reads as the null scalar at
   `0..0, 1:1` as before (the contract says offset 0); only `documentLength` grows.
3. **`text` is not carried on `invalid-encoding` diagnostics** — the slice is the invalid byte, which is
   not text. The spec's "every span it lists" cannot hold there.

## Research: the probe gate for FR-005

`yaml` 2.9.0, `parseDocument` on each placement (script in the session scratchpad; `⌁` = U+FEFF).

| Placement | `yaml` as it stands |
|---|---|
| `⌁a: 1` | `{a: 1}`, no error (lexer `parseStream` eats one mark per line while in the *stream* state) |
| `⌁⌁a: 1` | `{"⌁a": 1}` — the second mark lands in the plain key. **FR-005's repeated-prefix is not free.** |
| `⌁# c⏎⌁a: 1` | `{a: 1}` — the stream state eats it |
| `a: 1⏎⌁b: 2` | `{a:1, "⌁b":2}`, **no error** — the reported defect |
| `---⏎⌁a: 1` | `{"⌁a":1}`, no error — same defect, after an explicit `---` |
| `--- ⌁a: 1` | `MISSING_CHAR` at the mark |
| `a: 1 # ⌁` / `# x⏎⌁# y⏎a: 1` | accepted silently (comment text is dropped) |
| `a: "⌁x"`, `a: '⌁x'` | `{a: "⌁x"}` — content, correct |
| `a: \|⏎  x⌁y` | `{a: "x⌁y⏎"}`, no error — must be refused |
| `a: \|⏎⌁  xy` | `MISSING_CHAR` 5–10 plus a bogus key |
| `a: x⌁y`, `x⌁y: 1`, `[a, ⌁b]`, `a:⏎  ⌁b: 1`, ` ⌁a: 1` | accepted silently, mark in the scalar |
| `a: 1⏎...⏎⌁---⏎b: 2` | `MULTIPLE_DOCS` (Cascata refuses this anyway) |
| `a: 1⏎⌁` | `MISSING_CHAR` at the mark and a null key |
| `a: "x\⌁"` | `BAD_DQ_ESCAPE` |

Conclusion: `yaml` accepts a mark in a plain/block scalar or a comment silently, handles exactly one mark
per line in the document prefix, and mishandles a repeated one. So the refusal is Cascata's own scan
and cannot lean on `yaml`'s errors; where `yaml` also errors at the mark (`--- ⌁a`, a trailing mark) its
error is dropped in favour of Cascata's so the mark is not reported twice.

yaml-test-suite: no copy is available offline, and two attempts to enumerate it over the web found no
case named for a byte-order mark. **Not cross-checked**; the prefix cases rest on YAML 1.2.2's
`l-document-prefix` as the spec says.

## Steps (each committed when green)

1. **Slice property and the mark** — `text` in `case.ts`/`runner.ts` (+ `harness.test.ts`), the changed
   and new mark cases, `parseText`/`parse` parity unit test. Then FR-001, FR-002 mark half.
2. **Lines and the lone CR** — FR-003, FR-004; lone-CR/mixed cases (YAML, JSON, byte path).
3. **The misplaced mark** — FR-005; its cases.
4. **Docs and report** — FR-007; `report.md`.

## Tasks

- [x] T001 `text` field in the corpus format and runner, with harness tests
- [x] T002 Step 1 cases written and red: `byte-order-mark`, `byte-order-mark-in-quoted-scalar`, JSON `byte-order-mark-counted`, `invalid-byte-after-byte-order-mark`, `text` on `crlf-line-endings`/`lf-baseline`; unit parity test
- [x] T003 FR-001/FR-002 mark half in both adapters and the locator; sabotage; commit
- [x] T004 Step 2 cases written and red
- [x] T005 FR-003/FR-004; sabotage; commit
- [x] T006 Step 3 cases written and red
- [x] T007 FR-005; sabotage; commit
- [x] T008 FR-007 doc sweep, `report.md`; commit

## Round 2 (owner decisions on the round-1 report)

**Mechanism for repeated prefix marks: removal plus an index map, not blanking.** Blanking the second
mark of `⌁⌁---` gave ` ---`, which is not a document marker, so valid YAML 1.2.2 was refused. Every prefix
mark (not only the repeats) is now removed from the text `yaml` reads, so nothing in a prefix can change
what follows it. `storedIndexer` maps a parser index back to a stored one by binary search over the removed
marks (`parserPos_i = m_i - i`; stored = parser + marks removed at or before it) — the Rust compiler's
`NormalizedPos` precedent, which also keeps offsets honest. Choices: (a) ranges and error positions are
rewritten **in place after the parse** (`visit` over nodes, then `doc.errors`/`doc.warnings`) so every
consumer after that speaks stored indices and nothing downstream knows the mapping exists; (b) lines are
counted by Cascata over the stored text (`LineCounter.addNewLine` per LF / lone CR) instead of by `yaml`'s
lexer, which saw the mark-less text; (c) a boundary index (a node beginning exactly where marks were
removed) maps to *after* them. Rejected: keeping the first mark of each line for `yaml` to eat (two code
paths, and the blanked-extra problem returns); a translation table consulted at each span construction (many
call sites).

**Column rule (SPEC.md §4.2, 52c284e).** Only a mark at stored index 0 is never a column; any other U+FEFF
counts, on all three paths. YAML `codePointColumn` skips index 0 only; the JSON scanner loses its special
case entirely (it starts past the leading mark); `locateByteOffset` discounts a mark only when the line
starts at byte 0.
