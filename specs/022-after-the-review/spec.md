# Feature Specification: After the Review — Cost, Shared Edits, and Three Slips

**Feature Branch**: `022-after-the-review` (committed on `main`)

**Created**: 2026-10-08

**Status**: Approved by the owner, 2026-10-08

**Input**: issues #9 to #13, raised by 0km, a consumer still at the design stage, from one review of
v1.11.1. Each was reproduced by the reporter and its named cause confirmed in the code before this
was written. The owner decided on 2026-10-08 to take all five in one round, and chose the shape of
the one new piece of API, `sharedEdits`.

**Ships as v1.12.** Two corrections of cost alone (Part A), one addition that also closes a hole
(Part B), three corrections at edges (Part C), and a documentation sweep (Part D). **Implements** the v1.12
amendments to `SPEC.md`: Article IX's shared-value and spelling laws, the v1.10 entry's correction note,
the v1.12 entry of §15, and §14 item 14 — all written, in the same commit as this file. **Do not edit
`SPEC.md`**; report every place the code disagrees with it.

**Citations are milestone-local**: `v1.12 FR-nnn`. Extend `CITES_PATTERN` in
`tests/corpus/write-case.ts` to admit `v1.12` in the first commit that adds a case (CLAUDE.md,
"Each corpus loader gates `cites` by version").

---

## Part A — Two memoizations (corrections of cost alone; #9, #10)

Both cache something that never changes once built, so neither needs invalidation.

- **FR-001** **Columns are two lookups.** `src/adapters/yaml/parse.ts` builds, in the same pass that
  builds `byteOffsetTable`, a second `Uint32Array` over the stored text: for each UTF-16 index, the
  number of code points before it. `codePointColumn` becomes the difference of two entries plus one,
  less one when the line starts at stored index 0 with a byte-order mark (the existing rule: only a
  mark at stored index 0 is never a column; a mark anywhere else is a character). No node counts
  anything. The incremental alternative the issue also offers (remember the last position per line)
  is rejected: an alias copy re-measures its anchor out of document order, which is exactly where an
  order-dependent memo breaks.
- **FR-002** **Probe gate before FR-001's table is trusted.** Against the current `codePointColumn`,
  on a hand-derived table: astral characters (two units, one column), a combining sequence (each code
  point a column), a mark at stored index 0, a mark mid-line (a column), CRLF and a lone CR, an empty
  line, a last line without a line break. Record what each answers. Every existing span and column
  case is unchanged.
- **FR-003** **The pointer index.** `pointersInDocument` (`src/model/pointer.ts`) keeps its
  signature and its answers — the same pointers, in the same walk order, with the same `limit` —
  but reads them from an index built once per tree on first use and kept in a module-level
  `WeakMap` keyed by the root node. Trees are frozen, so the index is never stale; it is freed with
  the tree. `why()` and `editTarget()` change nothing and `MergedConfiguration` gains no field. The
  index maps (origin id, start, end) to the pointers in walk order; it must also be able to answer
  **by location** across graft origins (Part B, FR-006), so record, per origin id, its label.
- **FR-004** **Witnesses.** In the main suite: the table of FR-001 equals the hand-derived one for
  FR-002's inputs; the index of FR-003 lists, for a hand-built tree with an anchor and two aliases,
  exactly the hand-derived pointers in document order, and asking twice builds once (count builds,
  not time). In `tests/timing/`: one line of N flow items and one of 4N read in less than 8× the
  time, not 16× (`yaml` alone, with `uniqueKeys: false`, is the same-machine reference, as the
  existing timing cases do); the same with N aliases to one anchor on one line; `why()` and
  `editTarget()` on every key of N and 4N keys grow by less than 8×. Red against the current code
  before the fix: run red-phase timing in the background, they take minutes.

## Part B — Shared edits: one rule, and a policy (#11; an addition)

Today a value is **shared** when it is reached through an alias or merge key, or when it or a
container above it is anchored and aliased (Article IX). A file delegated to at two places is the
same hazard — one write changes both merged values — and is not seen, because each graft has its
own origin id and the copy check looks within one origin.

- **FR-005** **`sharedEdits`**, a policy with three values, default the current behaviour:

  ```ts
  export type SharedEdits = "refuse" | "warn" | "allow";
  ```

  `"refuse"`: as today, `edit-target-shared`, `level: "error"`. `"warn"`: the edit is answered, and
  the result carries one `edit-target-shared` diagnostic at `level: "info"` (§10's precedent is
  `append-scalar-wrapped`: "rather than silently"), primary at the value, `related` naming every other
  place the write changes. `"allow"`: the edit is answered and nothing is said. It is passed where a
  run's objects are made, never held in a global — Cascata has none:
  - `EditOptions.sharedEdits?` for `setValue` (and accepted, ignored, by `locate`);
  - a third, optional argument of `editTarget(configuration, pointer, options?: { sharedEdits? })`;
  - `yamlWriter(options?)` and `jsonWriter(options?)` taking `{ sharedEdits? }` — JSON has no
    sharing; it accepts the option so a consumer can hand both writers one object.

  The `ok` results of `setValue`, `editTarget` and a writer's `write` gain
  `diagnostics: readonly Diagnostic[]` (precedent: `MergeResult`'s `ok` branch), empty under
  `"allow"` and `"refuse"`. Nothing else moves to the policy: `edit-target-inherited`,
  `edit-target-remote`, block scalars, containers and absent values are refused as before.
- **FR-006** **A file grafted twice is shared.** `editTarget` counts copies across every graft of the
  same location, not only within one origin id: a value whose document is grafted at more than one
  place is shared, and the message and `related` name each grafting place (the delegating key's
  value in the delegating document). A file grafted once, and two different files grafted at two
  places, are each editable. `setValue` sees one document and cannot know this; it is `editTarget`'s
  alone.
- **FR-007** **Under `"warn"` and `"allow"`, the edit lands on the bytes that hold the value.** For an
  alias or merge-key copy, that is the anchored node's range, whichever pointer reached it; the
  writer walks through the alias instead of stopping at it. `editTarget` answers the in-document
  pointer as `pointerInDocument`'s tie-break already chooses it. The read-back still judges every
  edit: *what you set is what you read* must hold at the pointer asked about, and now also at every
  place named in `related`.
- **FR-008** **Exports and codes.** `SharedEdits` from `@egildo/cascata` and `@egildo/cascata/writers`;
  `docs/reference.md` gains the option on each of the four entry points and the `info` reading of
  `edit-target-shared` in its contract row.

## Part C — Three slips at the edges (#12; corrections)

- **FR-009** **An empty document is located after its marks.** The null root of a document with no
  content (`doc.contents === null`) spans zero width at the end of the document's prefix marks
  (`documentPrefixMarks`), not at stored offset 0. Hand-counted: a document of one mark alone
  (`EF BB BF`) locates `3..3`; a mark and `# c\n` locates `3..3`; no mark, as today, `0..0`. `setValue`
  on `""` of each writes the value there, with the padding the writer already applies before a
  comment (`yamlPadding`), and reads back.
- **FR-010** **A bare `? a` key is a null.** `walkMapping` gives a pair with no value node a null
  scalar spanning zero width at the end of the key, as `a:` already gets; `? a` reads `{a: null}`,
  three states stay distinguishable (§4.2). The writer's "null value" branch in
  `src/adapters/yaml/write.ts` then becomes reachable and stays. **The written bytes must add the
  indicator the document lacks**: on `? a\n` (bytes `?` `␠` `a` `⏎`, null at `3..3`), `setValue("/a", 1)`
  replaces `3..3` with `⏎: 1`, giving `? a\n: 1\n`, which reads `{a: 1}`; nested, the inserted line
  carries the key's indentation. A `? a` inside a flow mapping may be refused `edit-unsupported`
  rather than spelled. Derive each expected byte by hand, never from the writer.
- **FR-011** **A tag is kept where it can hold the value, and dropped where it cannot** — the mate of
  the quoting law ("a scalar that was quoted stays quoted, in its own style, wherever that style can
  hold the value"). The tag holds the value when it names the kind the value is written as, after the
  kind law: `!!int` an integer, `!!float` a decimal, `!!str` a string, `!!bool` a boolean, `!!null` a
  null; the long form `!<tag:yaml.org,2002:int>` likewise. Otherwise the edit range widens to cover
  the tag and the space after it. Hand-counted on `a: !!int 1\n` (value `9..10`, tag `3..8`
  including its space): set `"x"` gives the edit `3..10` → `x`, so `a: x\n`; set `2` gives `9..10` →
  `2`, so `a: !!int 2\n`; `a: !!str 3\n` set `"4"` keeps the tag; set `4` drops it; `a: !!float 1.5\n`
  set `2` is written `2.0` (kind law) under its kept tag. `locate` answers the value's range as
  today. The read-back witnesses each: no document written here reads differently under any YAML
  1.2 core-schema reader.

## Part D — Documents and dead code (#13; the sweep)

- **FR-012** **The named items.** `specs/HANDOFF.md`'s open-edges line ("`editTarget` answers
  `ok: true` for a value the writer will refuse (shared, block scalar)") is rewritten to what holds
  after Part B (block scalars only). The bounded-cost claim: report the `SPEC.md` §15 sentence that
  needs the line-length correction (below). `docs/reference.md`'s "never throws for a bad document"
  for `locate`/`setValue` gains: throws only on an internal inconsistency, which is a bug to report.
  Dead code: remove the `unescapePointerSegment` re-export in `src/adapters/json/write.ts`; keep
  `outcomeRootSpan` and `withPointer`'s fallback as guards, each with a comment saying it is a guard
  and why it is unreachable; the "null value" branch is live after FR-010.
- **FR-013** **The whole sweep.** Every sentence that states a behaviour in `README.md`,
  `docs/reference.md`, `specs/HANDOFF.md`, `src/diagnostics/codes.ts`'s contract comments, and the
  Known-traps section of `CLAUDE.md`, checked against the code and the tests: a table in the report
  — claim, where, the test that proves it or none — with each stale sentence fixed in the same commit
  and each `SPEC.md` sentence found stale reported, not edited. Staleness lands in derived
  artifacts before it lands in the spec; sweep them first.

---

## Conformance

**Write cases** (`tests/corpus/write-cases/`, cite `v1.12 FR-nnn`, bytes counted by hand):
FR-009's three documents under `locate` and `setValue`; FR-010's `? a`, nested `? a`, and the flow
case; FR-011's six tagged edits; an alias copy under `"refuse"` (unchanged), `"warn"` (the edit at the
anchor, one `info`) and `"allow"` (the edit, nothing said) — the runner gains a `sharedEdits` field on a
case, default `"refuse"`.

**The graft fixture** (in memory, as 020's): a config delegating `levels: ./levels.yaml` and
`other: ./levels.yaml`, plus `third: ./third.yaml`. By hand:

| Pointer | `"refuse"` | `"warn"` |
|---|---|---|
| `/levels/L1/elevation` | `edit-target-shared`, `related` names `other`'s delegating value | `ok`, `levels.yaml`, `/L1/elevation`, one `info` |
| `/other/L1/elevation` | the same, naming `levels`'s | the same |
| `/third/T1/x` | `ok`, `third.yaml`, `/T1/x`, no diagnostic | the same |

Plus the 020 fixture unchanged under every policy, and a `yamlWriter({ sharedEdits: "allow" })`
writing an alias copy where `yamlWriter()` refuses it.

**Sabotage**, each watched red and restored, backed up to `/tmp` first, marked `SABOTAGE`:
revert `codePointColumn` to counting (the 4N timing case red, not the main suite — say so); key the
index by origin id only (the graft rows red); make `"allow"` stop at the alias (the alias `"allow"`
case red on read-back); put the null root back at 0 (FR-009's mark cases red); drop the inserted
`: ` of FR-010 (its case red on read-back); keep the tag always (`!!int` set `"x"` red on read-back —
and note that only the read-back catches it, which is why the corpus must name the bytes).
`grep -rn SABOTAGE src/ tests/` before trusting any run and before every commit.

## Plan

One commit per step, `pnpm typecheck && pnpm test` green at each (the timing project runs
serially after the main suite; check for `×`, not only the count line):

1. Probe (FR-002), the two memos (FR-001, FR-003), their witnesses (FR-004).
2. `sharedEdits` and the graft rule (FR-005 to FR-008).
3. The three slips (FR-009 to FR-011).
4. The sweep (FR-012, FR-013), `specs/022-after-the-review/report.md`, a rewritten
   `specs/HANDOFF.md`.

Do not bump the version. The report lists every ambiguity unsoftened: each place this file, Article
IX, or the issues were silent, contradictory or wrong, and every detail invented.

---

## The `SPEC.md` amendments, as applied (for reference; `SPEC.md` is the normative text)

**Article IX (§19), the shared-value law**, after "which breaks the third law in meaning even where
every byte outside the range is untouched":

> A value is also shared when its document is delegated to at more than one place: one edit to the
> file changes every graft of it. *(v1.12, from the consumer's finding.)* **Whether a shared value is
> refused is the embedder's policy**, `sharedEdits`, set where its writers and edit targets are made
> and never global: `refuse` (the default, and everything above), `warn` (the edit is answered and the
> other places it changes are named, as an `info` diagnostic), or `allow` (answered, and nothing
> said). Under `warn` and `allow` the edit lands on the bytes that hold the value, through the alias;
> the third law is then broken in meaning on purpose, by a caller who said so. *(v1.12, an addition:
> the default is what the law was.)*

**Article IX, the spelling law**, after "one that was plain and can no longer be is double-quoted":

> A tagged scalar keeps its tag wherever the tag can hold the value, and is written without it where
> it cannot: `!!int 1` set to a string is written plain, not `!!int x`, which Cascata alone would
> read as a string. *(v1.12, a correction: the writer emitted a tag that contradicted its value.)*

**§15, the v1.10 entry "A document's cost is bounded by its size"**, a sentence at its end:

> *(Corrected in v1.12: the claim did not hold for line length. Every node's column was counted
> from the start of its line, so one line of 40,000 items took sixty times longer than the same items
> on 40,000 lines; columns are now one table, built with the byte table. And asking `why()` or
> `editTarget()` of a value walked its whole document, so asking about every value was quadratic;
> the pointers of a document are now indexed once, on first use.)*

**§15, a new entry, v1.12**: the four parts above in the log's own voice, naming the one bounded
change of behaviour: none — every document reads as it did, a bare `? a` key excepted, which now
reads as the null the information model always said it was.
