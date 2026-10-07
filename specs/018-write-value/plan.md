# Implementation Plan: Writing a Value Back

**Spec**: [spec.md](./spec.md) · **Implements**: `SPEC.md` Article IX (§19), §4.3, §15 "Writing a value back" (v1.10)

**Complexity Tracking note**: one plan file on the 012-017 precedent, not `/speckit-plan` +
`/speckit-tasks`. Two exports, four codes, one new corpus kind; no data model beyond the three result
types, and the contracts are `docs/reference.md` rows.

## Approach

| FR | Where | How |
|---|---|---|
| FR-001, FR-009 | `src/adapters/edit.ts` (`locate`), `yaml/write.ts`, `json/write.ts` | The format's own reader measures the position. YAML: `parseYamlBytes` gained an `onDocument` hook that hands over the `yaml` document (ranges already in stored indices, v1.9) and the reader's span functions; `findYaml` walks the pointer through that AST, because the model has forgotten aliases, merge keys, anchors and styles. JSON: the tree's span. |
| FR-002, FR-003 | `edit.ts` (`setValue`) | Equal to the value there (kind per FR-006, §4.2 equality) writes the bytes already there. |
| FR-004 | `edit.ts` | Every edit is applied to a copy and read back by the reader; one that does not read back as the value set is refused (`edit-unsupported`), not returned. |
| FR-005 | `findYaml` | The edit range is the reader's span for the scalar: quotes in, comment out. |
| FR-006, FR-007 | `edit.ts` (`kindForValue`, `floatText`), `yaml/write.ts` (`yamlNonFinite`) | |
| FR-008 | `yaml/write.ts` (`plainSafe`, `doubleQuote`, `singleQuote`), `json/write.ts` | See the probe below. |
| FR-010 | `src/index.ts`, `src/diagnostics/codes.ts` (`EDIT_CODES`), `docs/reference.md` | The layering test already forbids every downstream directory from importing `adapters/`. |
| FR-011 | | Nothing is named after, or imported from, the caller that owns the session. |

## Decisions the spec left open

1. **`locate` succeeds on a container and on a block scalar** (it reports their span and kind,
   `mapping`/`sequence`/`string`); only `setValue` refuses them. A refusal on `locate` would make "where
   is this mapping" unanswerable, and the article's refusals are all about *setting*. A value reached
   through an alias or merge key *is* refused by `locate` too: it has no bytes of its own.
2. **A value is shared when it, or any container above it, is anchored and an alias points there**,
   not only when reached through an alias. Writing `/base` in `base: &h 3.2⏎W1: *h` changes `/W1`; the
   corpus's round trip (the second witness) found this on the first run. `edit-target-shared`, positioned
   at the first alias. An anchor nothing uses is editable.
3. **`edit-unsupported` also covers "could not be written here and read back"** (an explicit `!!str` tag
   over a number). The spec has no code for it; the other candidates were worse.
4. **`edit-unrepresentable` also covers a lone surrogate in a string**, in both formats (no UTF-8 spelling).
5. **A null with no bytes** (`a:⏎`, `a: # c`) is replaced at an empty range, and the edit's own bytes
   carry the space before and after it needs. No byte outside the range moves.
6. **`NaN` equals `NaN`** for the nothing-changed law (the model's `===` would make setting `.NaN` over
   `.nan` rewrite it).
7. **`1.2.3`, dates, `0b101`, `1_000`, `1:30` are quoted** though Cascata reads them as strings: they are
   not strings to every YAML 1.1 reader (FR-008's "would under YAML 1.1"). Conservative on purpose.
8. **A number over a non-numeric scalar is an int if `Number.isInteger`, else a float** ("its own kind").

## Research: the probe gate for FR-008

`yaml` 2.9.0 under Cascata's reader (`parseText`), each string as `k: ⟨s⟩⏎` ("block") and `[⟨s⟩]⏎` ("flow").
Non-ASCII, boundary and adversarial inputs all run. `same` = reads back as that string.

| String | Block | Flow |
|---|---|---|
| `ü`, `é`, `日本`, `😀x` | same | same |
| `` (empty), ` ` | null | (none) |
| 1 MiB of `x` | same, 31 ms | |
| `- x`, `*a`, `!t`, `%`, `%x`, `key: v #c`, `@x`, `` `x ``, `'x`, `"x`, `[x`, `{x`, `|x`, `>x`, `-`, `- ` | **refused** (`malformed-document`, `unsupported-tag` for `!t`) | refused |
| `a\rb`, `a\nb` | refused | read as `a b` (folded) |
| `yes`, `No`, `ON`, `off`, `y`, `N` | same (string to Cascata, bool to YAML 1.1) | same |
| `true`, `True`, `null`, `Null`, `~`, `3`, `3.2`, `1e3`, `.inf`, `.nan`, `0x1F`, `0o7`, `0755`, `+1`, `-1`, `1.`, `.5` | **not a string** | |
| `1_000`, `1:30`, `2001-12-14`, `<<`, `=`, `0b101`, `inf`, `nan`, `5e` | same (but 1.1 reads some as numbers, dates, merge) | same |
| `a: b`, `x:`, `a:  b` | refused | **read as a mapping** |
| `a #b` | read as `a` | refused |
| `a, b`, `a]`, `a[` | same | `a, b` read as `a`; the others refused |
| `a#b`, `x'`, `:x`, `a:b`, `---`, `...`, `-x`, `?x`, `tab⇥here`, `a  b` | same | same |
| `#c`, `&a` | **null** | refused / null |
| `x `, ` x` | read as `x` (trimmed) | |
| U+FEFF inside, U+0085, U+2028 | `﻿` refused (v1.9); NEL, LS read back raw | |
| NUL raw | read back raw (not YAML) | |

Double-quote escapes checked through the reader: `\x00`, `\x7F`, `\x85`, ` `, `\L`, `\P`, `\N`,
`﻿`, `\t`, `\r`, `\n`, `\\`, `\"`, `\e`, `\_` all decode to the character named.

An empty scalar's span (`a:⏎` is 2-2, `a: # c` is 3-3, `{a: , b: 1}` is 4-4) is zero-width and *touches* its
neighbours, which is why the padding of decision 5 exists.

Conclusion: the reader accepts too much in one direction (NUL, NEL, LS read back raw) and a hostile
string can turn into a mapping, a comment, a null or a refusal in the other. The rule therefore leads with
conservatism (quote anything with a control, a leading indicator, `: `, ` #`, edge whitespace, a
1.1-or-1.2 non-string form) and the writer **reads every edit back** as the net under it.
`tests/unit/write-value.test.ts` runs ~90 such strings through nine contexts (block plain, single,
double; flow sequence and mapping; root; sequence item; after a comment; over a number) and JSON.

## Steps (each committed when green)

1. Corpus kind, loader and runner (`CITES_PATTERN` admits `v1.10` from the start, in its own loader).
2. `locate` and the refusals.
3. `setValue` for numbers, booleans, null.
4. Strings, after the probe.
5. Exports, codes, reference docs, `report.md`.

Steps 1-3 and the string code landed in one commit: `edit.ts` is one function that cannot be split
usefully, and the cases (written first, by hand, and run red against no implementation at all) were
added in the same sweep. The step-4 commit adds the string cases and the property test.

## Tasks

- [x] T001 write-case loader, runner, test
- [x] T002 locate cases and implementation
- [x] T003 setValue cases (numbers, booleans, null, refusals) and implementation
- [x] T004 string cases, probe, property test
- [ ] T005 reference.md, README, report
