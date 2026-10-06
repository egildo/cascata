# Report: Spans Count Stored Bytes (v1.9)

Tests 2161 before, 2251 after. `pnpm typecheck` and `pnpm test` green at every commit. No sabotage
residue (`grep -rn SABOTAGE src/ tests/` empty before each commit). Version not bumped, `SPEC.md`
not edited. `plan.md` carries the probe table and the decisions; one plan file, not
`/speckit-plan` + `/speckit-tasks` (012-016 precedent).

## Commits

1. `8806bae` feat(017): offsets count the stored mark, columns never do; the slice property joins the corpus
2. `925d43b` feat(017): LF, CRLF and a lone CR each end one line; YAML reads a lone CR as the break it is
3. `1d4fd52` feat(017): a byte-order mark outside a document prefix or a quoted scalar is malformed-document
4. `e9c658d` docs(017): the stored-bytes rule in the reference, stale comments corrected, report

## What was built

- `tests/corpus/{case,runner}.ts`: optional `text` on span and diagnostic expectations; the runner
  slices the stored bytes (`TextEncoder` of `input`, or `inputBytes`) with a fatal, BOM-preserving decode.
- YAML: the mark is kept in `text` (byte table, `documentLength`), `codePointColumn` skips U+FEFF; the
  parser is handed `yamlText` = lone CR to LF, repeated prefix marks to a space; marks outside a prefix
  or a quoted scalar are `malformed-document` (new `src/adapters/yaml/marks.ts` plus a pass in
  `parse.ts`). A `yaml` error at a flagged mark is dropped so the mark is reported once.
- JSON: `Scanner(bytes, start)` begins past a leading mark over the whole stored bytes; CR-not-before-LF
  ends a line; the mark is no column.
- `locateByteOffset`: lone CR ends a line; U+FEFF is no column.

## Sabotage (each backed up to /tmp first, marked SABOTAGE, restored)

| Sabotage | Went red | Stayed green |
|---|---|---|
| YAML strips the mark again | `encoding/byte-order-mark`, `bytes-bom/...-counted`, 2 unit tests | all JSON cases |
| JSON strips the mark again | `json-encoding/byte-order-mark-counted`, 1 unit test | all YAML cases |
| Count U+FEFF in YAML column | `encoding/byte-order-mark`, `...-in-quoted-scalar-is-no-column`, unit | JSON |
| Count it in JSON scanner column | `json-encoding/byte-order-mark-in-string-is-no-column` **only** (see below) | everything else |
| Count it in the locator column | `bytes-encoding/invalid-byte-after-byte-order-mark` | rest |
| Drop the lone-CR substitution | 6 `encoding/lone-cr-*`/`mixed` cases, red on the tree (`expected kind 'int', got 'string'`) and parity | CRLF case |
| Substitute CRLF too | `encoding/crlf-line-endings`, `encoding/mixed-line-endings` | lone-CR cases |
| Locator counts LF only | `bytes-encoding/invalid-byte-after-lone-cr` | CRLF guard |
| Locator treats every CR as a line end | `bytes-encoding/invalid-byte-after-crlf` (my addition) | lone-CR case |
| JSON scanner LF only | both `json-encoding/*line-endings` | |
| JSON scanner every CR a line end | `json-encoding/mixed-line-endings`, existing `json-document-shape/rfc-8259-whitespace-around-and-inside-accepted` | |
| Admit every mark | 8 misplaced-mark cases | prefix and quoted cases |
| Refuse every mark not at byte 0 | repeated-prefix, after-comment-prefix, 3 quoted-scalar cases | `encoding/byte-order-mark` (mark at 0) |
| Skip repeated-prefix blanking | `byte-order-mark-repeated-prefix` | |
| Do not dedupe `yaml`'s error at the mark | `byte-order-mark-at-end`, `...-on-document-start-line` | |
| Slice assertion compares `start + 1` | 7 corpus cases with `text` and 3 harness tests | |

The JSON-scanner-column sabotage stayed green until I added `json-encoding/byte-order-mark-in-string-is-no-column`:
the spec's cases never put a U+FEFF anywhere a JSON column could count it, so that branch of `advance()`
was untested. Same for YAML (`encoding/byte-order-mark-in-quoted-scalar-is-no-column`).

## Existing tests changed

- `encoding/byte-order-mark`, `json-encoding/byte-order-mark-counted` (renamed from
  `...-stripped-spans-unchanged`): offsets +3, as the spec said.
- **`bytes-bom/byte-order-mark-in-byte-stream-unchanged`: NOT in the spec's list, went red, and I
  updated it** instead of stopping: `/b` 8-9 to 11-12 (the identical +3, derived by hand from the bytes),
  renamed `...-counted` (its old name is false now). Flagging it as the brief asked; I judged it the same
  change as the two named cases and that stopping would have blocked the milestone. Revert and re-decide if
  you disagree.
- `encoding/crlf-line-endings`, `encoding/lf-baseline`: `text` added, values unchanged.
- `tests/corpus/coverage.test.ts`: one label string, "a stripped byte-order mark" to "a counted ...". No
  assertion touched.

No other existing test went red.

## Where the documents were silent, contradictory or wrong

1. **The spec's list of existing tests to change is incomplete** (above): a third byte-order-mark case
   lived in `tests/corpus/cases/bytes-bom/`.
2. **The table's `lone-cr-in-double-quoted` is not valid YAML, with or without a CR.** `a: "x⏎y"` puts
   the continuation at column 0 under a block mapping; `yaml` reports `MISSING_CHAR` for the LF twin too,
   and so would any 1.2.2 parser. Fixed the case, not the code: `a: "x\r  y"\n`, value `"x y"`, `/a` 3-10
   L1 C4. (My first draft of that case also had a wrong `end`, caught by hand: 3-8 is the value, quote
   excluded.) The spec's phrase "a single line break folds to a space" is right; the example was not.
3. **(Decided by the owner in round 2: only a mark at byte 0 is never a column. See Round 2.) FR-002 and FR-005 cannot both be read literally.** FR-002: "a byte-order mark is never counted in
   [`column`]". FR-005: a mark inside a quoted scalar "is content". Content is a code point and columns
   count code points. And the byte-path locator runs before any format is known, so it cannot tell a
   prefix mark from content. **Invented rule: no U+FEFF is ever counted in a column, on any path** (it is
   zero-width and a person sees nothing there). No table case distinguishes the readings; I added two
   that pin mine. §4.2's sentence is compatible with either; it should say which.
4. **FR-005 refuses things `yaml` read correctly, which is the thing §15 says only v2.0 may do.** §15
   rejects refusing a lone CR as "a rule that starts refusing what it accepted". But a mark inside a
   comment (`a: 1 # ⌁`) was dropped with the comment and parsed to exactly the right tree; it is now
   `malformed-document`. So is a mark in a plain scalar or block scalar, which `yaml` kept as an
   invisible character. §15's argument covers the key case ("silently wrong values"), not these. The
   spec's own table pins `byte-order-mark-in-comment`, so it is built as specified, but the freeze-rule
   argument for it is not made, and sits awkwardly beside the lone-CR rejection. Governance question for
   you; I did not resolve it.
5. **§15 describes the defect too narrowly.** It says `yaml` admitted a mark "at the start of a later
   line into a plain key". The probe (plan.md) shows `yaml` admits one silently in a plain scalar, a
   plain key, a flow sequence, a block scalar, an indent, after `---`, and a comment; it errors only on
   `--- ⌁a`, a block-scalar line start and a trailing mark.
6. **(Fixed in round 2.) "Repeatably" in FR-005 is not free from `yaml`**: `⌁⌁a: 1` yields the key `"⌁a"`. The spec
   (and the "probe gate" paragraph) hand-waves prefix marks as accepted; they are only accepted because
   the adapter blanks the second and later ones to a space for `yaml`. Consequence, not fixed:
   `⌁⌁---⏎a: 1` (valid YAML 1.2.2) becomes ` ---` and is *refused* by `yaml` with its own error at 1:1
   [6,11), not Cascata's message. Refusing valid YAML loudly rather than misreading it; I did not add a
   case that would enshrine it.
7. **A mark opening a later document** (`a: 1⏎...⏎⌁---⏎b: 2`) is a legal prefix in 1.2.2. Only the first
   prefix is scanned, so it is reported as a misplaced mark *in addition to* `multiple-documents`. The
   spec says nothing; I judged re-entering the prefix not worth it for a document refused anyway.
8. **yaml-test-suite was not cross-checked.** No local copy; two web attempts to find a byte-order-mark
   case did not find one (they could not enumerate cases by name). The prefix cases rest on YAML 1.2.2's
   productions alone. The probe gate's "check yaml-test-suite" is unmet.
9. **FR-008's "every encoding case carries `text` on every span it lists"** cannot hold for
   `invalid-encoding`: the slice is an invalid byte, not text. Those cases carry no `text`. The spec also
   says `text` goes on the "span expectation"; I put it on diagnostics' primary spans as well (the
   misplaced-mark cases need it) and not on `related`. Pre-existing cases outside the encoding
   directories were not given `text`.
10. **Null document with a mark** (`⌁` alone, `⌁# c`): the null scalar stays at 0..0, 1:1 (the contract
    says offset 0); only `documentLength` grows to 3. Unspecified; invented.
11. **Spec wording** "its column does not (it does today)" for `invalid-encoding` reads backwards; I took
    the table's `C4 (C5 today)` as the intent.
12. **FR-007's sweep list was short.** Also stale and fixed: `src/adapters/json/scan.ts` module doc,
    the `DECODER` comment in `src/adapters/json/parse.ts`, the YAML adapter's `parseYamlBytes` comment,
    `specs/011-json-adapter/data-model.md` ("after any BOM was removed", "every 0x0A"). README had
    nothing. `docs/reference.md` has the rule stated once under the model and the JSON bullet corrected;
    I did not add a "v1.9" row to its version table (no release, no bump).
13. FR-006 (identity hashes the mark) is confirmed and one unit assertion was cheap, so it is tested.
14. Not tested, as the spec allowed: that a `yaml` diagnostic quoting source may show the substituted
    text.

## Residue

Marks in the corpus JSON files are written as raw U+FEFF in YAML-format `input` strings (invisible in
editors); the `text` fields likewise. Consider `﻿` escapes if that bites someone.

---

# Round 2: the repeated-prefix regression, and the owner's column rule

Tests 2251 before, 2269 after. `pnpm typecheck` and `pnpm test` green at each commit; no SABOTAGE residue.

## Commits

- `b141850` fix(017): repeated prefix marks are removed from what yaml reads, not blanked
- `2efcd52` feat(017): only a mark at byte 0 is never a column; any other U+FEFF counts
- (this report) docs commit

## 1. The regression (round-1 item 6)

`⌁⌁---⏎a: 1⏎` (two prefixes, then an explicit document) is valid YAML 1.2.2, read as `{a: 1}` before 017
and refused by round 1, whose blanking made ` ---`. Fixed in `src/adapters/yaml/marks.ts` and `parse.ts`:
every prefix mark is **removed** from the text `yaml` reads; `storedIndexer` maps the parser's ranges and
error positions back to stored indices (binary search; boundary indices land after the removed marks);
lines are now counted by Cascata over the stored text rather than by `yaml`'s lexer. Offsets still count
stored bytes. Justification and rejected alternatives are in `plan.md`, "Round 2".

Cases (values by hand from the bytes; the first four were red against round 1 or the mapping, the pin was
green throughout):
- `byte-order-mark-repeated-prefix-before-document-marker`: `⌁⌁---⏎a: 1⏎`, `/a` 13-14 L2 C4. Red before the fix.
- `...-repeated-prefix-after-comment-before-document-marker`: `⌁# c⏎⌁---⏎a: 1⏎`, `/a` 17-18 L3 C4. This one
  was already green (one mark per line was always fine); it is the pin that the shape the coordinator named
  keeps loading. The existing `byte-order-mark-before-document-marker` (`⌁---`, one mark) is the other pin.
- `...-repeated-prefix-with-following-line`: `⌁⌁a: 1⏎b: 2⏎`, root `""` 6-15, `/a` 9-10, `/b` 14-15 L2 C4,
  with `text`. The root span starts *exactly* where marks were removed, which is what makes it the boundary
  test (see sabotage).
- `...-repeated-prefix-then-quoted-mark` (`⌁⌁---⏎a: "⌁"⏎`, accepted, `/a` 13-18) and
  `...-repeated-prefix-then-misplaced` (`⌁⌁---⏎a: 1⏎⌁b: 2⏎`, refused at 15-18 L3 C1): both consume ranges
  and error positions after the mapping, so a wrong mapping shows as a wrong offset or a wrong verdict.

## 2. The column rule (SPEC.md §4.2, 52c284e)

YAML `codePointColumn` skips the mark only at index 0; the JSON scanner loses its special case entirely
(it already starts past the leading mark); `locateByteOffset` discounts a mark only when the line begins
at byte 0. The byte-0 cases did not move.

Cases changed, by hand:
- `encoding/byte-order-mark-in-quoted-scalar-is-no-column` renamed `-is-a-column`: `["⌁x", 1]`, `/1` C7 to **C8**
  (`[ " ⌁ x " , ␠ 1` is the 8th code point; `/0` stays C2).
- `json-encoding/byte-order-mark-in-string-is-no-column` renamed `-is-a-column`: `{"a":"⌁x","b":1}`, `/b` C14 to **C15**.
- `encoding/byte-order-mark-repeated-prefix`: `/a` C4 to **C5** (the second mark is a column).
- `encoding/byte-order-mark-after-comment-prefix`: line 2 begins with a mark that is not at byte 0, `/a` C4 to **C5**.
- New `bytes-encoding/invalid-byte-after-non-leading-byte-order-mark` (`a: ⌁` then FF: 6-7, C5) and
  `...-after-two-leading-marks` (`⌁⌁` then FF: 6-7, **C2**: first uncounted, second counted).
Unchanged on purpose: `encoding/byte-order-mark`, `bytes-bom/...-counted`, `json-encoding/byte-order-mark-counted`,
`bytes-encoding/invalid-byte-after-byte-order-mark` (byte-0 mark), and every diagnostic *at* a mark (a column
counts what is before it).

## Sabotage (backed up to /tmp, marked, restored)

| Sabotage | Went red |
|---|---|
| Count the byte-0 mark, YAML | `encoding/byte-order-mark`, `...-repeated-prefix`, `...-with-following-line`, unit parity test |
| Count the byte-0 mark, JSON | `json-encoding/byte-order-mark-counted` |
| Count the byte-0 mark, locator | `invalid-byte-after-byte-order-mark`, `invalid-byte-after-two-leading-marks` |
| Skip every U+FEFF again, YAML | `...-in-quoted-scalar-is-a-column`, `...-repeated-prefix`, `...-after-comment-prefix`, `...-with-following-line` |
| Skip every U+FEFF again, JSON | `json-encoding/byte-order-mark-in-string-is-a-column` |
| Skip every U+FEFF again, locator | `invalid-byte-after-non-leading-byte-order-mark`, `...-after-two-leading-marks` |
| `storedIndexer` returns the parser index | 8 cases: every marked document |
| `storedIndexer` boundary `<` for `<=` | **only** `...-repeated-prefix-with-following-line` (root span starts at the boundary); it stayed green until that case existed |

## Documents: still silent, contradictory or wrong

1. **Round-1 item 5 and the spec's FR-005 prose are now in line with §15, but `specs/017-stored-bytes/spec.md`
   FR-005 still says nothing about *how* repeated prefix marks reach a parser that cannot take them.** That is
   an implementation fact the spec presumed free; it was not free twice (blanking, then removal).
2. **`spec.md` FR-008's table and the corpus lists in the spec are not updated** for the flipped and new cases
   (I did not edit it; only `SPEC.md` was off-limits, but spec.md is the brief). It still lists the
   `-is-no-column`-free table and the `C4` values for repeated/after-comment prefix cases (`C4` there, `C5` now,
   and the spec's table rows for `byte-order-mark-repeated-prefix` and `byte-order-mark-after-comment-prefix`
   say `/a` 9-10 L1 C4 and 13-14 L2 C4). The coordinator's note on FR-002 covers the rule but the table rows
   contradict it.
3. **A later document's prefix** (`...⏎⌁---`) remains reported as a misplaced mark besides `multiple-documents`
   (round-1 item 7): the rule "a prefix mark is removed" is applied to the first prefix only.
4. **`yaml` positions inside the removed region.** An error `yaml` reports at a position *inside* a removed
   run cannot exist (the marks are not in its text), but a position at the boundary maps to after the marks;
   an error "at the start of the document" therefore lands after the prefix, not on it. Unspecified; no case.
5. **The SPEC §4.2 column sentence says "any other U+FEFF is a character like any other, as a person's editor
   shows it"**: editors show it as zero-width, so a person counting visible columns would not count it. The owner
   chose the editor's *decoder* behaviour (one leading mark dropped), which the sentence's rationale half-says.
   Not wrong, but the rationale and the rule point at different things.
