# v1.15 (specs/025-open-insert-delete) — implementer's report

*Written by the implementer (Sonnet) and saved by the coordinator: the implementer's Write tool refused
to create this file. The text is the implementer's, unedited except for this note and the coordinator's
section at the end.*

## Summary

Commits (all with the Co-Authored-By trailer, none amended):

| Hash | Subject |
|---|---|
| 61ac34f | Part A: the opened document, parse once (FR-001 to FR-006, FR-025) |
| eba1e99 | Part B: writing a container (FR-007 to FR-011) |
| fdd97ef | Part C: add (FR-012 to FR-015, FR-023, FR-024) |
| 73398c5 | Part D: remove (FR-016 to FR-019) |
| 48d2d0f | Part E: one shared-value policy (FR-020, FR-021) |
| e19935b | fix: the adversarial sweep over the repository's own documents, and what it found |
| fc992f0 | docs: the handoff |

Tests: main 3677 -> 4667 (122 -> 129 files); timing 14 -> 14 (no wall-clock test added; the claims are counted). `pnpm typecheck` and `pnpm build` clean; timing suite passed on rerun (one unrelated `validate-totality` timing test failed once at load average 30, passed quiet).

One departure from "commit per Part, cases first": Part B's commit carries the engine for add/remove (shared plumbing: plans, `finish`, the four new codes). Each Part's commit adds its own cases, tests and sabotage; C's and D's hand-counted cases were written before their paths were first run.

## What was built, per FR

**A — opened document.** FR-001 `openDocument(bytes, options)` exported from the root (with `OpenedDocument`, `OpenResult`, `EditData`); parse diagnostics as `locate` gives; programmer error throws. FR-002 bytes and options copied (also an L1 edit's bytes). FR-003 immutable, every answer against the bytes as opened. FR-004 `src/adapters/parse-count.ts` (no public API) counts parses, CST tokenizations, parent walks; `yaml/facts.ts` builds parents, tokens, indicator positions (`-` `:` `?` `&` `!`), line ending and style lazily, once per document; `Found.tag.drop` is now a function so merely locating a tagged scalar no longer tokenizes. FR-005 one-shot verbs are open-then-ask. FR-006 `Writer.open(bytes)` -> document with `locate`, `write`, `add`, `remove`. FR-025 counted: open 1; N locates 1; N answered setValue/add/remove N+1; refusal and L1 +0; one-shot locate 1 / setValue 2 (unchanged); tokenization once per document; parent walk once.

**B — containers.** FR-007 `EditData = EditValue | readonly EditData[] | ReadonlyMap<string, EditData>`; an iterative walk throws `TypeError` naming what and where for plain object, non-string Map key, cycle, sparse array, undefined, symbol, function, Set, Date. Limits: data deeper than `maxDepth` alone is refused before spelling, as `edit-read-back` (100,000 levels refused, no stack overflow); node count > `maxBytes` refused the same way (a 40-level DAG of `[x, x]` in milliseconds); document > `maxBytes` refused before parsing; data that fits alone but not where it goes is refused by the read-back itself, same code. FR-008 container replaces scalar and reverse, `edit-container` retired from the writer (editTarget keeps it), equal container (key order ignored) writes the bytes already there. FR-009 YAML style: nearest sibling's indentation, colon blanks, nested step (else document's first increase, else 2), dash flush/indented, flow/block, document line ending, strings and keys by the v1.10 rule, no BOM/anchor/tag/alias. FR-010 JSON: one-line vs one-member-per-line, tabs/spaces, `:`/`,` blanks. FR-011 empty `{}`/`[]` block-style when its entry is block (same-line comment stays on the parent's line); flow stays flow; JSON first member on its own line iff any container spans a line.

**C — add.** Placement per FR-012 (after last entry's line and same-line comment; sequence item before the item and before the comments above it; `-` appends; flow/JSON one comma, neighbours' gap copied). Refusals FR-013 incl. new `edit-parent-scalar`, `edit-target-exists` (at the existing key; a merge-supplied key counts, span is the key in the merge source). FR-014 whole-tree read-back at the pointer and every copy of the parent. FR-015 appends compose (block map/seq, flow, JSON, LF/CRLF/no trailing newline, witnessed); an add into an empty container rewrites the brackets so two overlap (documented on `OpenedDocument`).

**D — remove.** FR-016 whole lines + same-line comment + comment lines directly above with no blank between (never above the previous entry's last line, so a block scalar's comment-looking text is not taken); flow/JSON exactly one comma. FR-017 emptied container keeps its kind on the parent's line (`walls: {}`); root becomes `{}`/`[]`, comments before kept. FR-018 `edit-remove-document`, `edit-target-absent` (absent or `-`), `edit-reveals-merged` (at the key, merged value related), shared. FR-019 as FR-014.

**E — shared.** `sharedEdits` decides set/add/remove with one `sharing()`; under warn/allow the edit lands in the anchored bytes, read-back checks every copy; merge-key edges keep their codes under every policy; `setValue` on a key that overrides a merged one unchanged.

**F — witnesses.** ~150 new hand-counted write-corpus cases (YAML + JSON), `tests/unit/{opened-document,write-containers,add,remove,shared-verbs}.test.ts`, the property witness (`write-property.test.ts`: 600 generated YAML + 600 JSON docs x 4 ops per run, plus a shared-values generator under allow; 4,000 trials/format on 5 more seeds passed), and `write-sweep.test.ts` (every valid doc of the parse and write corpora, 239 distinct, asked for every add/remove/container write: ~4,600 answered under refuse, ~5,000 under allow).

## FR-023 probe, and what it missed

Run before trusting `yaml`'s ranges (each result is now a case). A pair value's `range` = `[start, valueEnd, nodeEnd]`; for a scalar `valueEnd` excludes trailing comment and break (`a: héllo # c\n` -> `[3,8,13]` in UTF-16 units; the reader converts, cases count bytes: `add-after-non-ascii-comment` 57, `add-after-emoji-and-comment` 18). Block scalar range ends after its last break (`|+` includes the blank lines). Flow range ends one past the bracket. Block collection `range[1]` = end of its last entry's line incl. break; CRLF in `nodeEnd`; `...` outside the root range; a deeper trailing comment outside the nested `range[1]` but in `range[2]`. **Missed by the hand probe, found by generated documents:** when a collection's last value is *empty* with a comment after it (`name: # one\n  # emoji\n  other: 2`) the empty scalar absorbs the comment lines and the next line's indentation and the collection's `range[1]` follows (67 where the line ends at 55): a removal ate the next sibling. Fix: an entry ends at its **last leaf** (`contentEnd`); case `remove-entry-whose-last-value-is-empty-keeps-the-next-comment`. The probe lacked an "empty last value then comment" input. The sweep found a second class the probe lacked: a byte-order mark opening a later line (after a prefix comment); `lineStartOf` now skips marks that open a line.

## Sabotage (FR-026)

Driver `/tmp/cascata-025/sab.py` (backs up to /tmp, replaces, runs named vitest files with the json reporter, restores byte-for-byte; every mutant carries `/* SABOTAGE */`; `grep -rn SABOTAGE src/ tests/` empty after every batch and before every commit). Red = number of failing tests.

| Id | Broken | Red |
|---|---|---|
| A1 | byte copy | 1 (FR-002 overwrite test) |
| A2 | parse memo (find re-parses) | 6 (counts) |
| A3 | CST token memo | 1 |
| A4 | parent-walk memo | 1 |
| A5 | JSON locate re-parses | 3 |
| A6 | read-back parses twice | 5 |
| A7 | an answer mutates held bytes | 10 |
| B1 | read-back restricted to the pointer. **first form survived** (the mapping-size check also caught the tamper); faithful form (compare only the value at the pointer) | 2 (tamper tests, YAML+JSON) |
| B2 | L1 for containers | 3 |
| B3 | tagged container not refused | 1 |
| B4 | keys follow the string rule | 4 |
| B5 | line ending hard-wired LF | 5 |
| B6 | BOM counted as indentation | 3 |
| B7 | JSON unit hard-wired 2 spaces | 1 (tab case) |
| B8 | early depth bound | 1 (100k levels) |
| B9 | node budget | hang, killed at 60 s |
| B10 | Map key check | 2 |
| B11 | cycle detection | 2 |
| B12 | whole number in a container is int | 97 |
| B13 | flow copied from sibling | 1 |
| B14 | dash habit copied | 1 |
| B15 | JSON container copies nearest sibling's layout (first form = equivalent mutant: the replaced node is its own donor) | 1 |
| C1 | append at value end not line end | 23 |
| C2 | blank line does not end attachment (insert) | 3 |
| C3 | edit-target-exists | 6 |
| C4 | edit-parent-scalar | 5 |
| C5 | existing key's span | 4 |
| C6 | EOF rule | 34 |
| C7 | append not empty-ranged | 6 |
| C8 | `{}` not rewritten block | 5 |
| C9 | same-line comment moves | 1 |
| C10 | add read-back not whole-tree | 3 |
| C11 | add checks parent only, not copies | 4 |
| C12 | JSON separator not the nearest gap (**first form survived**; case `json-add-item-copies-the-nearest-gap` added) | 1 |
| C13 | YAML step hard-wired | 1 |
| C14 | first item of nested seq | 1 |
| D1 | attached comments left | 1 |
| D2 | blank line does not end attachment (remove) | 3 |
| D3 | emptied container no braces | 19 |
| D4 | emptied root loses comments | 1 |
| D5 | last flow entry takes following comma | 7 |
| D6 | edit-remove-document | 5 |
| D7 | edit-reveals-merged | 3 |
| D8 | comments reach above previous entry | 1 |
| D9 | entry end from collection range | 1 |
| D10 | EOF no-newline remove | 1 |
| D11 | remove read-back not whole-tree | 1 |
| D12 | remove checks owner only, not copies | 4 |
| D13 | compact first entry pull-up | 2 |
| D14 | compact first entry before comment | 1 |
| D15 | collection reached via alias | 5 |
| D16 | only flow entry takes interior | 3 |
| D17 | emptied container's parent comment | 2 |
| E1 | merging mappings not tolerated | 9 |
| E2 | tolerance covers every key (**first batch survived**; a plan that damages only the merging mapping added) | 1 |
| E3 | alias entry treated as shared | 2 |
| E4 | container via alias goes to alias's pair (**first batch survived**; case `set-scalar-through-an-alias-warned-over-the-anchored-container` added) | 1 |
| E5 | reveals-merged only under refuse | 3 |
| E6 | dependents not transitive | 1 |
| E7 | merge list not read | 1 |
| E8 | no info under warn | 10 |
| E9 | owner of merged-key entry | 3 |

Five mutants survived their first form (B1, B15, C12, E2, E4); each was a missing case or equivalent mutant.

## Parse counts measured

Open 1; locate xN 1 total; answered set/add/remove xN: N+1; refusal/L1 +0; one-shot locate 1, setValue 2 (unchanged); writer open + 2 writes 3; tokenizations 0 unless a tag must be dropped, then 1/document; parent walks <= 1/document. Provenance's rebase (about 3 parses per staged edit) pays 1 per edit + 1 per document. At 20,000 top-level keys an `add` is ~400 ms, the read-back parse dominating (open ~230 ms); style-donor scans capped at 32 siblings, entries measured lazily.

## Existing tests changed, and why (none weakened)

- `write-cases/container.json`, `container-json.json`: expected `edit-container` for a scalar set over a container; FR-008 lifts it; now expect the edit (hand-counted 12-29 `" 1\n"`; 6-12 `"1"`), cites `v1.15 FR-008`.
- `tests/unit/writers.test.ts`: "exactly claims, locate and write" now includes `open` (FR-006); the refusal example used a container, now a block scalar.
- `tests/unit/write-value.test.ts`: thrown message for a non-scalar matched `/scalar/`, now `/plain object/` (still throws).
- `write-case.ts` (CITES admits v1.15; `add`/`remove`; `seq`/`map` values; `dependents`), `write-runner.ts` (add/remove/container oracle restated, scalar assertions moved unchanged into `runScalarSetValue`).

## Ambiguities, silences, contradictions (unsoftened)

**SPEC.md (not edited):**
1. Article IX's first Laws bullet still says "Two verbs, on one document ... Neither verb" — four verbs now, values may be containers. Stale.
2. The `editTarget` bullet says "A container is refused as in the laws above"; the laws above no longer refuse containers.
3. FR-016 (comments directly above attach) vs FR-017 (a root that empties keeps the comments before it) contradict for the root's first entry; I followed FR-017; a nested emptied container takes its attached comments.
4. FR-015 says an add into an empty container "is not empty-ranged (FR-011 rewrites the `{}`)" but FR-011 says nothing of rewriting for JSON/YAML flow. Written literally two JSON adds into `{}` neither overlap nor compose (no comma). I rewrite the brackets for every empty container so FR-015 is true.
5. FR-010 "a document with no line break at all stays on one line": a one-line doc with a trailing newline has a break; I used "no container spans a line break".
6. Ruling 7 names removing a key that *overrides* a merged one; silent on removing a key a merge key alone supplies. It is a shared value; under warn/allow it is removed from the merge source and every mapping that merges it loses it.
7. `add` at the empty pointer -> `edit-target-exists`; `remove` of `-` -> absent; `add` of `-` into a mapping is a key named `-` (all invented).
8. FR-007 "report which" for limits: both — data alone early, data-in-place by the read-back; one code `edit-read-back`.
9. A sequence item is inserted above the comments directly above the item at the index (not in the spec).
10. FR-013's refusals are a list, not an order: shared first, then parent-scalar, exists, index.

**Inventions:**
- **A float with a whole value inside a container (`3.0`) cannot be written**: `EditData` has no float marker, so it is `3` and reads back an int. A real limit for a consumer writing `height: 3.0` in a new wall.
- Container tags: replacing a `!!map` container by a value its tag cannot hold is refused as `edit-read-back` (yaml only warns, so the read-back would not catch it; explicit refusal). Scalar tags are dropped as in v1.12.
- Container writes discard comments *inside* the replaced range; the key line's same-line comment stays on that line (`walls: {} # none`).
- First entry of a collection that begins on its parent's line (`- a: 1`, `- - a`): next entry pulled up when only indentation separates them; with a comment/blank between, only the entry's own lines go, leaving `-   # about b` then the entries (same item).
- Last entry of a file without trailing newline: remove also takes the break before it; add writes `eol + entry`. Line ending = the file's first break literally (a lone-CR file gets CR; spec said CRLF or LF).
- An entry whose value is an alias (`d: *b`) shares nothing: removable under refuse (`Found.valueIsAlias`).
- Mappings that merge the edited one (`<<: *base`, merge lists, transitively) gain/lose the key; read-back tolerates that one key on them and compares every other key. An entry reached through a merge key lives in the merge source (`owner`). Without this, warn/allow on any anchored source with a merging mapping refused as `edit-read-back`.
- Removing an anchored value an alias points at under allow leaves a dangling alias; refused as `edit-read-back`, not `edit-target-shared`.
- `openDocumentUsing(bytes, options, wrap)` exported from `edit.ts` (not the package) as the test seam for wrong plans; `FormatOpened`, `Plan`, `Op` internal.
- No one-shot `add`/`remove` (spec keeps only `locate`/`setValue`).
- Style donors: 32 nearest siblings by index distance; dash default indented (`yaml`'s own default); nested step nearest block-map sibling's else document's first.

**My wrong counts (discount them):** `"y"` as a key/value in three cases (YAML 1.1 boolean, so quoted — the code was right); alias span 26-28 not 25-27; the documented-limit test's edit ranges (7-15, 15-23); `nest(2)` for the depth boundary. Every other hand-counted offset matched on first run.

Test knobs `PROP_TRIALS`, `PROP_SEED`, `PROP_STATS`, `PROP_ALLOW`, `PROP_SHOW` in the property and sweep tests (defaults run in ~2 s).

## Things the coordinator should look at

- Docs sweep done: `docs/reference.md` gains a v1.15 section and loses the stale container refusal; `README.md`'s version table/status paragraph NOT touched (release drill's job).
- Known documented refusals that are not defects: container tag conflict; dangling alias after removing an anchor; replacing a merge source by a scalar under allow; compact first entry removal is the only layout where a comment can end up as `-   # ...`.
- Three composition limits (documented, not fixed): adds into an empty container overlap; removing every entry of a mapping one at a time then applying together leaves `walls:` null; (both witnessed in tests). The batch read-back is the parked cure.

---

## Coordinator's verification (2026-10-12)

- Tree clean after the implementer's commits; `grep -rn SABOTAGE src/ tests/` empty; `pnpm typecheck` clean;
  `pnpm test` 4,667 main and 14 timing, all passed.
- An independent probe, outside the suite: the consumer's case (a new wall added whole, with a
  quoted `"yes"`, a quoted `"a: b"` and a non-ASCII item), removal with an attached comment and with a
  blank line before it, a container set, a four-space YAML file, CRLF with a multi-line string, a
  tab-indented JSON file, the last JSON member, insertion at index 0 with a flush dash, both merge-key
  refusals, the only entry, the root's only entry under a header comment, a key `"1"`. All as specified.
- One style observation, not a defect of the rules as written: in a tab-indented JSON file whose
  sibling array is on one line (`"a": [1, 2]`), a new nested array is written one item per line,
  because a level nested inside the new value has no sibling and takes the document's step.
- SPEC.md items 1 and 2 above were fixed by the coordinator (the "Verbs on one document" bullet; the
  `editTarget` sentence now says why it still refuses containers). Item 3 (a root's header comment
  survives emptying) is kept as built: FR-017 is the more specific rule.
- The whole-number float limit goes to the owner as a ruling.
