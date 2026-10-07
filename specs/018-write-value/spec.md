# Feature Specification: Writing a Value Back

**Feature Branch**: `018-write-value` (committed on `main`)

**Created**: 2026-10-08

**Status**: Draft

**Input**: GitHub issue #7, "Write-back, Cascata's half", opened by the owner from a design agreed
across both libraries: Provenance's `docs/write-back.md` (the edit record, the laws, cases drafted on
paper), egildo/provenance#4 (the editing stage) and #5 (one format plug-in per format, shared by
shape).

**Implements**: `SPEC.md` Article IX (§19), new; §4.3's forward pointer; §14 item 12; §15 entry
"Writing a value back" (v1.10). All already written. **Do not edit `SPEC.md`.**

**This is an addition under §15's freeze rule.** Nothing read changes; nothing accepted is refused.
Two new exports and a handful of new diagnostic codes.

**Scope, narrowed from issue #7 on purpose.** The issue also asked for the refusal of an edit to a
value that exists only in the merged configuration (a schema default), naming its layer. That needs
`why()` to report the pointer *inside* the supplying document, not just its span, so that a session
can rebase the edit later. It is the next milestone, together with Provenance's session. This one
is document-level only.

## User Scenarios & Testing

The user is **the tool** that edited a value in its model and now needs the bytes to write, and,
through it, **the author** whose file must come back untouched except for that one value.

- **A number moves.** `walls.yaml`, `/walls/W2/height` from 3.2 to 3.4: an edit replacing bytes
  47–50 with `3.4`. Applied, the file differs in those bytes only. (L2, L3)
- **Nothing moves.** Set `/walls/W1/height` to 3.2 where it is 3.2: the edit's bytes equal the
  bytes already there. (L1)
- **Kind is kept.** Set `/walls/W1/height` to `3` where the file has `3.2`: written `3.0`. (L2)
- **Quoting is the format's.** A string that would read as something else unquoted is quoted.
  (L2)
- **The file's other bytes survive.** CRLF, a byte-order mark, a trailing comment on the same line,
  non-ASCII elsewhere. (L3)
- **Refused, not guessed.** An absent pointer, a value reached through an alias, a block scalar, a
  container: each a diagnostic at a span, never a throw.

## Requirements

- **FR-001** `locate(bytes, options, pointer)` answers `{ ok: true, start, end, kind }` — the stored
  byte range and the model kind (§4.1) of the value at `pointer` (RFC 6901) — or `{ ok: false,
  diagnostics }`. `options` carries `format` (`"yaml"` | `"json"`) and `origin`, as `parse` does. A
  document that does not parse gives the parse's own diagnostics.
- **FR-002** `setValue(bytes, options, pointer, value)` answers `{ ok: true, edit: { start, end,
  bytes } }`, where `bytes` is a `Uint8Array` to put in place of `[start, end)`, or `{ ok: false,
  diagnostics }`. `value` is a scalar: `string`, `number`, `bigint`, `boolean` or `null`. Neither
  function reads or writes a file, and neither throws for a document or a value — only for
  programmer error, as `parse` does.
- **FR-003** **L1, nothing changed, nothing written**: if `value` equals (§4.2's equality) the value
  at `pointer`, `edit.bytes` equals the bytes already in `[start, end)`.
- **FR-004** **L2, what you set is what you read**: parsing the input with the edit applied gives,
  at `pointer`, a value equal to `value`, of the kind FR-006 names.
- **FR-005** **L3, only the value moves**: the edit's range is exactly the value's span (§4.2); every
  byte outside it is the caller's to keep, and the writer never asks to change one.
- **FR-006** **Kind.** A `number` written over a `float` is a float; over an `int`, an int if
  `Number.isInteger`, otherwise a float. A `bigint` is an int. A float is spelled in JavaScript's
  shortest round-trip form with a decimal point or exponent guaranteed (`3` → `3.0`, `1e21` →
  `1e+21`, `-0` → `-0.0`). Any other type over any kind writes its own kind. No precision rule:
  `0.1 + 0.2` is written `0.30000000000000004`.
- **FR-007** **Values a format cannot spell are refused.** JSON: `NaN`, `Infinity`, `-Infinity`.
  YAML spells them `.nan`, `.inf`, `-.inf`. Code: `edit-unrepresentable`.
- **FR-008** **Strings in YAML.** Written plain only if the plain form reads back as the same
  string under Cascata's rules *and* would under YAML 1.1 — so the Norway words (`yes`, `no`, `on`,
  `off`, `y`, `n`, any case) are quoted, as are `true`, `null`, `~`, numbers, `.inf`, anything with
  `: ` or ` #`, a leading indicator (`-`, `?`, `:`, `,`, `[`, `]`, `{`, `}`, `#`, `&`, `*`, `!`,
  `|`, `>`, `'`, `"`, `%`, `@`, `` ` ``), leading or trailing whitespace, a line break, or the empty
  string. Otherwise the style of the replaced scalar is kept where it can hold the value (single
  quotes double an embedded `'`); where it cannot, double quotes with YAML escapes. A string replaced
  in a flow collection must also avoid `,`, `[`, `]`, `{`, `}` when plain. **Strings in JSON** are
  JSON strings, escaped by RFC 8259 §7, non-ASCII written as itself.
- **FR-009** **Refused targets**, each a diagnostic, `level: "error"`, primary at the span named:
  - `edit-target-absent` — no value at `pointer` (primary: the nearest existing ancestor's span);
  - `edit-target-shared` — the value is reached through a YAML alias or merge key (primary: the
    alias); writing it would change every place that shares it;
  - `edit-unsupported` — the value is a block scalar (`|`, `>`), or a mapping or sequence (primary:
    the value). Setting a container is an insertion, not written yet.
- **FR-010** **Exports.** `locate` and `setValue` from `@egildo/cascata`, their result types, and
  the new codes in `src/diagnostics/codes.ts` with their contract row in `docs/reference.md`. The
  layering test keeps holding: the writers live under `src/adapters/`, and nothing in `src/model/`,
  `src/resolve/`, `src/merge/`, `src/validate/`, `src/project/` or `src/generate/` imports them.
- **FR-011** **The plug-in contract, by shape.** The two functions are Cascata's side of
  egildo/provenance#5 (read, locate, write). Name nothing after Provenance and import nothing from it.

## Conformance

A new corpus kind, **write cases**: input bytes, format, pointer, value, and either the expected edit
(`start`, `end`, `bytes` as text) or the expected diagnostic (code, span). Its loader gates `cites`
by version (`v1.10 FR-NNN`), as the others do — extend the pattern in the first commit that adds a
case. **Every expected value below was derived by hand from the bytes**; never copy one from a run.
Where a run disagrees, re-derive by hand and report which side was wrong.

The running file `walls.yaml`, 51 bytes: `walls:⏎  W1:⏎    height: 3.2⏎  W2:⏎    height: 3.2⏎`.

| Case | Input | Pointer, value | Expect |
|---|---|---|---|
| `number` | `walls.yaml` | `/walls/W2/height`, 3.4 | 47–50 → `3.4` |
| `unchanged` | `walls.yaml` | `/walls/W1/height`, 3.2 | 25–28 → `3.2` |
| `kind-kept-float` | `walls.yaml` | `/walls/W1/height`, 3 | 25–28 → `3.0` |
| `crlf` | `walls.yaml` with CRLF | `/walls/W1/height`, 3.4 | 27–30 → `3.4` |
| `byte-order-mark` | `walls.yaml` after `EF BB BF` | `/walls/W1/height`, 3.4 | 28–31 → `3.4` |
| `comment-after` | `h: 3.2 # metres⏎` | `/h`, 3.5 | 3–6 → `3.5` |
| `needs-quotes` | `walls.yaml` with `    note: north side⏎` added under W1 | `/walls/W1/note`, `north: side` | 39–49 → `"north: side"` |
| `norway` | `c: 7⏎` | `/c`, `"no"` | 3–4 → `"no"` |
| `single-quoted-kept` | `a: 'x'⏎` | `/a`, `it's` | 3–6 → `'it''s'` |
| `double-quoted-kept` | `b: "y"⏎` | `/b`, `z` | 3–6 → `"z"` |
| `non-ascii` | `d: é⏎` | `/d`, `ü` | 3–5 → `ü` |
| `flow` | `walls:⏎  W1: {height: 3}⏎` | `/walls/W1/height`, 4 | 22–23 → `4` |
| `json-number` | `{"walls": {"W1": {"height": 3.2}}}` | `/walls/W1/height`, 3.4 | 28–31 → `3.4` |
| `json-unrepresentable` | the same | `/walls/W1/height`, `Infinity` | `edit-unrepresentable` at 28–31 |
| `absent` | `walls.yaml` | `/walls/W3/height` | `edit-target-absent` at `/walls`'s span |
| `alias` | `base: &h 3.2⏎W1: *h⏎` | `/W1`, 3.4 | `edit-target-shared` at 17–19 |
| `block-scalar` | `note: \|⏎  one⏎  two⏎` | `/note`, `x` | `edit-unsupported` at 6–20 |
| `container` | `walls.yaml` | `/walls/W1`, 1 | `edit-unsupported` at `/walls/W1`'s span |

Ranges are 0-based and end-exclusive, in stored bytes (§4.2), counted by hand. Two cells name a span
rather than giving numbers (`absent`, `container`): derive those from §4.2 by hand too, before
writing the case.

**The round trip, as a second oracle.** For every `ok` case, the runner also applies the edit,
parses the result with `parse`, and checks L2 (the value at the pointer) and L3 (the bytes outside
the range unchanged). That checks the writer against the reader, which is a second witness, never the
first: the hand-written expected bytes stay the authority.

**The probe gate (Principle V)** applies to FR-008 before it is written down: run its quoting rule
against at least one non-ASCII, one boundary (the empty string, a single space, a 1 MiB string) and
one adversarial input (`- x`, `*a`, `!t`, `%`, `key: v #c`, a lone CR) through `yaml` and Cascata's
reader, and record which plain forms read back unchanged.

**Sabotage**, each watched red and restored (back up to `/tmp`, mark `SABOTAGE`, grep before every
commit): write ints over floats (`kind-kept-float` red); never quote (`needs-quotes` and `norway`
red); drop the single-quote doubling (`single-quoted-kept` red); follow aliases (`alias` red); count
the range in UTF-16 units (`non-ascii` and `byte-order-mark` red); widen the range to the line
(`comment-after` red).

## Out of scope

Inserting and deleting; block scalars and containers (refused); which document an edit to a merged
value belongs in, and `why()` reporting an in-document pointer (the next milestone); a precision
rule; TOML; applying or committing an edit (the caller's, and Provenance's session).

## Plan and tasks

One plan file on the 012–017 precedent, or `/speckit-plan` and `/speckit-tasks` — say which. Commit
each step the moment `pnpm typecheck && pnpm test` is green; the 600-second watchdog has killed
implementers before:

1. **The write-case corpus kind and its cases**, with `CITES_PATTERN` admitting `v1.10`; red.
2. **`locate`** and the refusals (FR-001, FR-009).
3. **`setValue`** for numbers, booleans, null (FR-002 to FR-007).
4. **Strings** (FR-008), after the probe.
5. **Exports, codes, reference docs, report** (FR-010, FR-011; `specs/018-write-value/report.md`).

Do not bump the version. Check every sentence of Article IX against what the code turned out to do,
and report each disagreement unsoftened.
