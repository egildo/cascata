# Feature Specification: The Opened Document — Parse Once, Then Set, Add and Remove

**Feature Branch**: `025-open-insert-delete` (committed on `main`)

**Created**: 2026-10-12

**Status**: Approved by the owner, 2026-10-12 (implementer: Sonnet)

**Input**: two items parked in `specs/HANDOFF.md` and Article IX's "what is not in this article":
**parse once, ask many** (every `locate` and `setValue` parses the whole document, so Provenance's
rebase, which calls `locate` then `write` per staged edit, pays about three parses per edit — two for
`write`, which reads its edit back) and **inserting and deleting entries** (§4.3's format-preserving
sibling, still unbuilt; Provenance's `docs/write-back.md` names *insert this child* and *delete this
node* as parked intents, "back with the first consumer that adds a wall"). The owner ruled the shape
on 2026-10-12, one decision at a time:

1. **An explicit opened document.** `openDocument(bytes, options)` parses once; the document then
   answers `locate`, `setValue`, `add` and `remove` as often as asked. The one-shot `locate` and
   `setValue` stay, as open-then-ask. Writers gain `open`. Not an invisible cache.
2. **Every answer is against the bytes as opened.** The opened document never changes. Its edits are
   independent, each against the original bytes, applied together by the caller, non-overlapping — the
   Language Server Protocol's rule for a batch of `TextEdit`s, and Provenance's staged-against-a-base
   model. To build on an edit, the caller applies it and opens the result.
3. **Scalars and containers.** `add` and `setValue` take nested mappings and sequences of scalars. A
   mapping is passed as a `Map` (a plain object reorders array-index keys and swallows `__proto__`;
   CLAUDE.md, Known traps). `setValue`'s `edit-container` refusal is lifted.
4. **Style is copied from the nearest sibling, then from the document** (`toml_edit`'s decor, PostCSS's
   raws, Roslyn's trivia). Line endings are the file's. Placement: a mapping entry goes after the last
   entry; a sequence item at the index the pointer names, `-` meaning the end (RFC 6902).
5. **`add` on an existing mapping key is refused**, not replaced (a departure from RFC 6902): `add`
   only creates, `setValue` only changes. A key a merge key already supplies counts as existing.
6. **`remove` takes the entry, its same-line comment, and the comment lines directly above it with no
   blank line between** (Prettier's and Recast's attachment; Roslyn's leading trivia). Two consequences
   with one right answer, written in by the coordinator: a container that empties keeps its kind
   (`walls: {}`, never `walls:`), and in flow collections and JSON the entry takes one comma with it.
   Removing the whole document is refused.
7. **One shared-value policy for all three verbs**: `sharedEdits` (v1.12) decides whatever the verb.
   Two named refusals: removing a key that overrides a merged one (the merged value would show through),
   and adding a key a merge supplies (ruling 5).
8. **Which document an entry belongs in across the cascade stays parked** (the view-update question).
   `add` and `remove` work on one document the caller names. `editTarget` is unchanged.
9. **The read-back stays on every edit**, `add` and `remove` included. Each answered edit costs one
   parse of the edited bytes; `locate` costs nothing after the opening. A batch read-back (many edits,
   one parse) is parked by name.

**Ships as v1.15.** `SPEC.md` is a living document; the amendments this round implements are in Part G,
written by the coordinator in the same commit as this file. **Do not edit `SPEC.md`**; report every place
the code disagrees with it.

**Citations are milestone-local**: `v1.15 FR-nnn`. Extend `CITES_PATTERN` in `tests/corpus/write-case.ts`
in the first commit that adds a case.

---

## Part A — The opened document

- **FR-001** `openDocument(bytes, options)`, exported from the package root beside `locate` and
  `setValue`, takes what they take minus the pointer (`format`, `origin`, `limits`, `sharedEdits`) and
  answers `{ ok: true, document } | { ok: false, diagnostics }`. A document that does not parse gives the
  parse's own diagnostics, as `locate` does today. Programmer error throws, as today.
- **FR-002** The document **copies the bytes** it is given. A caller that mutates its array afterwards
  changes nothing the document answers.
- **FR-003** The document answers `locate(pointer)`, `setValue(pointer, value)`, `add(pointer, value)`
  and `remove(pointer)`. Each answer is what the corresponding call on the original bytes answers: an
  edit's range is a range of the bytes as opened (ruling 2). Nothing the document answers changes the
  document.
- **FR-004** **One parse, counted.** Opening parses once. `locate` parses nothing more. `setValue`,
  `add` and `remove` each parse once more, to read their edit back (ruling 9), and only when they answer
  an edit to check. Facts the YAML writer computes per call today over the whole document (the parent
  map, the aliases that hold a node, the CST tokens `tagDrop` reads) are computed at most once per
  document, lazily. Witnessed by **counting parser invocations**, never by timing (CLAUDE.md:
  count the work where it can be counted); how the count is taken is the implementer's, with no public
  API for it.
- **FR-005** The one-shot `locate` and `setValue` become open-then-ask, with every answer they gave
  before unchanged: the whole existing write corpus and `tests/unit` pass untouched.
- **FR-006** **Writers gain `open(bytes)`** (`src/writers.ts`), answering `{ ok: true, document } |
  { ok: false, reason }` where the document has `locate(path)`, `write(path, value)`, `add(path, value)`
  and `remove(path)` with the result shapes `locate` and `write` already have. `claims`, `locate` and
  `write` stay as they are. Provenance adopts `open` in its rebase in its own round; nothing here
  imports or names it.

## Part B — Writing a container

- **FR-007** **The value type.** `EditData = EditValue | readonly EditData[] | ReadonlyMap<string,
  EditData>`. `setValue` and `add` take `EditData`. A plain object, a `Map` with a non-string key, a
  cycle, a sparse array, or anything else not in the type is programmer error and throws, naming what
  it found. Depth and size are bounded by the document's `limits` (the same caps a read of the written
  bytes would meet; a value past them is refused as `edit-read-back` would be, or earlier with the same
  code — report which).
- **FR-008** **`setValue` on a container** replaces it, and a container may replace a scalar and the
  reverse: the kind is the value's (Article IX, kind rule). `edit-container` is retired from the
  writer; `editTarget` still refuses containers (ruling 8) and keeps the code for that. Setting a
  container to an equal value (§4.2 equality — `src/model/equality.ts`; a mapping's key order is not
  part of its value) writes the bytes already there (L1).
- **FR-009** **Style, YAML** (ruling 4). Copied from the nearest sibling where there is one:
  block or flow; the sibling's indentation; the spacing after `:` and `,`; a sequence's dash
  indentation (`key:\n- a` and `key:\n  - a` are both seen in the wild; copy which this one uses).
  With no sibling (an empty container, or a level nested inside the new value), the document's own step:
  the first indentation increase the document uses, else two spaces. The line ending is the document's
  first line break (CRLF or LF; LF in a document with none). Nothing adds a byte-order mark. Strings
  follow Article IX's spelling rule (plain only where Cascata *and* YAML 1.1 read it back as that string;
  a multi-line string is double-quoted, never a block scalar). **Keys** follow the same rule as strings
  (so a key `"1"` or `"yes"` is quoted). Nothing writes an anchor, a tag or an alias.
- **FR-010** **Style, JSON.** Copied from the nearest sibling: one line or one member per line; the
  indentation (spaces or tabs, and how many); the spacing after `:` and `,`. With no sibling, the
  document's step (its first indentation increase, else two spaces); a document with no line break at
  all stays on one line.
- **FR-011** **An empty container** (coordinator's rule, report if a case makes it look wrong): in YAML,
  an empty `{}` or `[]` whose own entry is block-style is rewritten block-style when something is added
  to it (`walls: {}` gains `W1` as `walls:\n  W1: …`), so that delete-then-add reads as the author's file
  again; inside a flow collection it stays flow. In JSON, an empty `{}` or `[]` gains its first member
  on its own indented line if the document has any multi-line container, on the same line otherwise.

## Part B′ — The owner's ruling after the implementer's report (2026-10-12)

- **FR-027** **A new number's kind.** Where there is no number whose kind to keep — a new entry, a number inside a
  written container, a number over a string, a boolean or null — a `number` is a decimal and a `bigint` an integer, the
  value view's convention. `3` there is written `3.0`. Over an integer a whole `number` stays an integer, over a decimal a
  decimal (unchanged). The implementer found that `height: 3.0` in a new wall could not be written. The change of
  behaviour is named in §15. Applied by the coordinator: style cases that used a whole `number` for an integer now pass a
  `bigint`, their bytes unchanged; the v1.10 and v1.12 cases whose number landed over a non-number expect `.0`, recounted
  by hand.

## Part C — `add`

- **FR-012** **Placement.** A mapping entry goes after the last entry: after its last line and that
  line's same-line comment, before any comment or blank lines that follow it. A sequence item goes
  before the item at the pointer's index; an index equal to the length, or `-`, appends. Inserting into
  a flow collection and into JSON inserts before the closing bracket or before the item, with one comma.
- **FR-013** **Refusals**, each a diagnostic, never a throw:
  - the parent is absent → `edit-target-absent`, at the nearest existing ancestor (as today);
  - the parent is a scalar → **`edit-parent-scalar`** (new), at the scalar;
  - a mapping key already present, **including one a merge key supplies** → **`edit-target-exists`**
    (new), at the existing key (ruling 5; RFC 6902 would replace);
  - a sequence index past the length, or not an index → `edit-target-absent`;
  - the parent is shared → `sharedEdits` (ruling 7, Part E);
  - the edit does not read back → `edit-read-back`.
- **FR-014** **Read-back** (ruling 9). The edited bytes are parsed once; the edit is answered only if
  the edited document's tree equals the original tree with the operation applied at the pointer — and,
  under `warn`/`allow`, at every place that held the parent's bytes (v1.12 FR-007's copies). Whole-tree
  equality, not just the pointer: it is what proves every sibling survived.
- **FR-015** **Insertions at the end compose.** Any set of `add`s answered by one opened document that
  append to the same **non-empty** container, applied together in the order given, read back as all of
  them added in that order. (Each is an empty range at the same offset; LSP applies such edits in array
  order.) An add into an *empty* container is not empty-ranged (FR-011 rewrites the `{}`), so two of them
  overlap and the caller must reopen between them: say so in the result's documentation, and witness it.

## Part D — `remove`

- **FR-016** **What leaves** (ruling 6). A block mapping entry or block sequence item: its whole lines
  (from the start of its first line to the start of the line after its last), its same-line comment,
  and every comment line directly above it with no blank line between, up to its parent's own line. A
  blank line ends the attachment. A flow entry or a JSON member: the entry and exactly one comma with
  its spacing — the following comma, or the preceding one for the last entry.
- **FR-017** **An emptied container keeps its kind.** Removing the only entry writes `{}` (or `[]`)
  where the container was, on the parent's line (`walls: {}`); a root that empties becomes `{}` (or
  `[]`), with the comments before it kept.
- **FR-018** **Refusals**: the empty pointer → **`edit-remove-document`** (new); an absent target or `-`
  → `edit-target-absent`; a shared target → `sharedEdits` (Part E); **removing a key that overrides a
  merged one** → **`edit-reveals-merged`** (new), at the key, with the merged value's span as related
  (ruling 7); not read back → `edit-read-back`.
- **FR-019** **Read-back**: as FR-014, with the operation being the removal.

## Part E — Shared values

- **FR-020** **One policy** (ruling 7). Whether `add` and `remove` write into shared bytes — a container
  reached through an alias or merge key, or anchored and aliased elsewhere — is `sharedEdits`, exactly
  as for `setValue`: `refuse` gives `edit-target-shared` at the alias, `warn` answers with the `info`
  naming the other places, `allow` answers silently. Under `warn` and `allow` the edit lands in the
  anchored bytes, and the read-back checks every copy (FR-014).
- **FR-021** The YAML merge-key edges are refused by their own codes whatever the policy, because they
  are not about sharing: `edit-target-exists` (FR-013) and `edit-reveals-merged` (FR-018). A key that
  overrides a merged one is the document's own (Article IX): `setValue` on it is unchanged.

## Part F — Witnesses

- **FR-022** **Cases before code.** Write cases (`tests/corpus/write-cases/`, `call` gaining `"add"` and
  `"remove"`, `value` gaining tagged containers) for every rule in Parts B to E, **offsets and bytes
  counted by hand**, the round trip through `parse` a second witness. At least, in both formats where
  the format has the construct: a new wall added whole to a block mapping (the consumer's case); a
  sequence item inserted at 0, in the middle, and with `-`; a four-space YAML file and a tab-indented
  JSON file keeping their indentation; a CRLF file whose added lines end in CRLF; a byte-order-mark
  file; a key that must be quoted; a multi-line string value; add into `{}` (YAML block parent, YAML
  flow parent, one-line JSON, multi-line JSON); delete with an attached comment, with a comment
  separated by a blank line (kept), with a same-line comment; delete the only entry (block, flow, root);
  delete the first, middle and last of a flow collection and a JSON array; each new code; a shared
  parent under each policy; both merge-key edges.
- **FR-023** **The probe gate** (Principle V) before trusting `yaml`'s tokens for any of FR-012 and
  FR-016: where a block entry's last line ends when it holds a nested block, a trailing comment, a
  non-ASCII scalar, a CRLF line break, and a document end marker (`...`); record it in the report.
- **FR-024** **Property witness** for FR-015 and the laws: for a generated set of small documents in
  both formats (the existing round-trip oracle's style; a fixed seed), every answered `add` and
  `remove` reads back as specified and leaves every byte outside its range untouched (L3).
- **FR-025** **Counted, not timed** (FR-004): N `locate`s on one opened document parse once; N answered
  `setValue`s parse N + 1 times; the one-shot verbs' counts are unchanged from today.
- **FR-026** **Sabotage** (CLAUDE.md's protocol): the byte copy of FR-002; the parse memo of FR-004; the
  comment attachment of FR-016 (blank line ends it); FR-017; each new refusal; the whole-tree read-back
  (restrict it to the pointer and watch a sibling-loss case go red — write that case first); FR-015's
  composition.

## Part G — `SPEC.md` amendments this round implements

Written by the coordinator, in the same commit as this file:

- **Article IX** — the opened document and its rule (against the bytes as opened); `add` and `remove`
  with their laws, placement, style, attachment and refusals; containers written; the shared policy
  over all three verbs; the "what is not in this article" paragraph updated (inserting and deleting
  leave it; the view-update question and the batch read-back stay).
- **§4.3** — the format-preserving sibling is no longer unbuilt: insertion and deletion are its second
  use.
- **§14** — the roadmap gains v1.15.
- **§15** — the round's entry, naming each change of behaviour in one sentence: `setValue` on a container,
  refused before, is now written.

---

## Ambiguities the implementer should expect

- **Where a block entry ends** is the hard part of FR-012 and FR-016. `yaml`'s node `range` gives a
  value's end, not the line's; a trailing comment belongs to the line. Probe (FR-023) before building.
- **Comment attachment at the first entry of a block mapping**: the comment lines between the parent's
  `walls:` line and the first entry attach to it under FR-016's rule. If a case makes that look wrong,
  report it; don't invent a different rule.
- **A JSON document's "step"** when its first indentation increase is inside a string-bearing line
  that is not a container (it cannot be, in strict JSON; say if Cascata's JSON admits anything that
  breaks the rule).
- **`EditData` and the YAML 1.1 quoting rule for keys**: the existing string rule was written for
  values; check it holds for a key followed by `:` (a plain key may not contain `: ` or end with `:`).
- **Removing every entry one at a time from one opened document** and applying the edits together
  empties a block mapping into `walls:` (null): each edit alone was right, and together they break the
  kind law. That is ruling 2's price; the parked batch read-back is the cure. Witness it as a documented
  limit, and say so in the `remove` documentation.
- **Commit per Part** (the 600-second watchdog): A, then B, then C, then D, then E, each green.
