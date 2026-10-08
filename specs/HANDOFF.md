# Handoff — what the specs and reports do not say

Written at the end of milestones 017 to 019 by their implementer, for whoever takes 020. Assumes you have
read `CLAUDE.md` and nothing else. Per-milestone detail is in `specs/NNN-*/report.md`; this is only what
is not there, or is where nobody would look.

## Where things live (and what a change must keep)

**Positions (017).** `src/adapters/yaml/parse.ts` owns every YAML span. `ctx.text` is the *stored* text
(mark and CRs included); `yamlText` is what `yaml` reads. Anything that changes a length before `yaml`
sees the text must be mapped back. Two substitutions exist: a lone CR becomes LF (same length, no map), and
every document-prefix byte-order mark is *removed* (`src/adapters/yaml/marks.ts`: `documentPrefixMarks`,
`removePrefixMarks`, `storedIndexer`). After `parseDocument`, `parse.ts` rewrites every node `range` and
every `error.pos` in place to stored indices, and builds the `LineCounter` itself over the stored text
(`lineCounter.addNewLine(0)` first, or line comes back 0). Everything after that speaks stored indices.
Columns: only a mark at stored index 0 is never a column. JSON: `Scanner(bytes, start)` begins past a
leading mark over the whole stored bytes; `locateByteOffset` in `src/adapters/encoding.ts` is the third path.

**The reader's `onDocument` hook (018).** `parseYaml`/`parseYamlBytes` take an optional fourth argument,
called after the document is mapped and before the tree walk, with `(doc, {spanOf, tightSpanOf}, anchors)`.
It is how the writer sees aliases, anchors and scalar styles that the model has forgotten, **using the
reader's own span functions**. Never give the writer a second way to measure a byte. Collections use
`tightSpanOf` (trailing line break trimmed); scalars and aliases use `spanOf`. Block scalars include their
trailing break (`note: |` is 6-20 in the table).

**Writers (018).** `src/adapters/edit.ts` is format-blind: `locate`, `setValue`, FR-006's kind rule,
number spelling, the nothing-changed law, and a **read-back** of every edit (apply to a copy, reparse,
compare). `yaml/write.ts` walks the pointer through the `yaml` AST (aliases, merge keys, anchors, styles, flow
context) and owns string spelling (`plainSafe`, `doubleQuote`, `singleQuote`). `json/write.ts` is tiny.
Invariants: the edit range is exactly the reader's span; nothing outside it moves; a value is *shared*
(`edit-target-shared`) when reached through an alias/merge key **or when it or any container above it is
anchored and aliased**; a quoted scalar keeps its quote style whenever that style can hold the value.
The read-back is the net under all of it: do not remove it to fix a case, fix the case.

**Anchors and the budget (019).** `yaml/anchors.ts`: one iterative walk in `visit`'s order builds
name -> node and alias -> target; `targetOf`, `firstAliasTo`. `Alias#resolve` is called nowhere under `src/`
(a sweep enforces it; it is the oracle in `tests/unit/anchor-table.test.ts`). `yaml/budget.ts` counts W;
`parse.ts` counts E as `walkAnchoredTarget` builds nodes and throws a private sentinel at the first node past
`expansionRatio x W + expansionAllowance`. The diagnostic points at the **outermost** alias being expanded
(`expandingAt`). `expand.ts` keeps the one documented cast on `yaml`'s own AST types. `parseDocument` runs with
`uniqueKeys: false`: Cascata's own `firstOccurrence` map is the only duplicate check (`yaml`'s is quadratic).

**Corpus kinds.** Parse cases `tests/corpus/cases/` (`case.ts`, optional `text` on spans and diagnostics =
the slice property: the stored bytes at the span decode to exactly that text). Write cases
`tests/corpus/write-cases/` (`write-case.ts`, `write-runner.ts`, own `v1.10 FR-nnn` cite pattern, tagged
values `{"number": "NaN"}`, verbs `locate`/`setValue`). The write runner round-trips every edit through the
reader as a second witness and restates FR-006 itself rather than importing the writer's rule: keep it independent.

## Traps not in CLAUDE.md

- **No `push(...items)` / call-site spread on anything that can be big.** `tests/unit/validate-totality.test.ts` has an Article VI sweep
  ("no call-site spread survives under src/", use `src/extend.ts`) and a 200,000-entry totality case. I broke
  both with `stack.push(...item.items)`. Use a loop.
- **`timeout` does not exist on this macOS.** `timeout 100 npx ...` fails silently and prints nothing; I lost
  several runs believing a test was hanging. `sed -i` needs `-i ''`. zsh does not word-split `$VAR` lists.
- **Heredocs through the tool can turn ` `, `﻿` into raw characters** in source; regexes then break
  (`Unterminated regular expression`). Write such lines with Python and escaped text, then `grep -nP` for raw ones.
- **`Alias#resolve` per alias is quadratic**; so is `parseDocument`'s default `uniqueKeys` per mapping. Both
  looked like "yaml is slow on anchors" until measured separately. Measure the library alone before blaming it.
- **`yaml` ranges for empty values touch their neighbours** (`a:` is 2-2, `a: # c` is 3-3): a write there needs
  a space before and, before a comment, after (`yamlPadding`).
- **A value is not a model node** the way a key is not: keys, a merge key's own pair, and `!!omap` pairs are never
  counted. W counts an alias as 1; E counts nodes built (post-order), not kept.
- **Round-trip oracles find semantic bugs byte-level laws miss**: the anchor-owner hole (`base: &h 3.2` /
  `W1: *h`, set `/base`) passed L3 byte-wise and changed `/W1`.
- **Existing quoted-style expectations beat the spec's prose**: Article IX once said "plain whenever safe" while
  the table said `"y"` stays quoted. When prose and a hand-counted table disagree, report it, follow the table.

## Fragile or slow tests, and flake vs failure

- `tests/unit/validate-totality.test.ts` ("doubling the alternatives does not quadruple the work") and the
  `metaschema`/`totality` ratio tests flake under load. **Rerun that file alone**: a flake passes alone, a real
  failure does not (it prints `20,000: 25 ms, 80,000: 240 ms`-style numbers; a real regression is ~16x).
- `tests/unit/anchor-table.test.ts` takes ~20 s (400 random documents through the oracle, plus two timed reads).
  `tests/unit/duplicate-keys.test.ts` times 32,000-key reads. Both compare against `yaml` with `uniqueKeys:
  false` on the same machine, so they are relative, not absolute. The 16,000-key duplicate witness is a thin
  red when the default is restored; the 32,000 one (~100x) is the decisive one.
- Red-phase runs of the timing tests take minutes (the quadratic code is the point). Run them in the background.
- The write-case suite is ~175 tiny cases; a failing one names its range and bytes. A *sabotage* that makes dozens
  red is normal (never-quote reddens ~85); read the first message, not the count.

## How I verified (reusable)

- **By hand first, then a run.** For every position: count bytes with the input written out (`a: 1` is a0 :1 sp2
  1(3)); a quoted scalar's span includes its quotes; a block mapping's span is tight (ends after the last
  character, not its newline); a BOM is 3, a CR is 1, `é` is 2. Four of my own hand counts were wrong and the
  runs caught them; every table row in the specs was right except where a report says otherwise.
- **Oracles.** `yaml`'s `Alias#resolve` (tests only) for the anchor table; `parseDocument(...).toJS({maxAliasCount:
  -1})` node counts for E; the read-back for every edit; `parse` on the applied edit for the write cases.
- **Probe scripts worth re-running** (throwaway `tests/unit/_probe.test.ts`, delete after): every string through
  `k: <s>` and `[<s>]` and the reader (see `plan.md` 018 for the table); the 26-document duplicate-key battery
  (snapshot diagnostics before/after a change to the parse call); per-shape timing at N and 4N.
- **Sabotage by script**: back up `src` and `tests` to `/tmp`, replace one string with a `SABOTAGE` comment, run
  the named tests, `cp` the backup file back, `diff -r` the tree, `grep -rn SABOTAGE src tests`. I kept a small
  `sab.sh` that did exactly that; it is worth writing again. A sabotage that stays green is a finding (three times,
  I had to add a case: a mark in a JSON string's column, a key before its value in the table, `&k a: *k`).

## Open edges (noticed, not fixed)

- **Pointer segments `01` and `+1`** are accepted as sequence indices (`^\d+$` in `yaml/write.ts` and
  `resolvePointer`); RFC 6901 forbids leading zeros.
- **A later document's prefix mark** (`...` then a mark before `---`) is reported as misplaced besides
  `multiple-documents` (`marks.ts` scans only the first prefix).
- **Zero-width values** are edited at an empty range with padding in the edit's own bytes; a flow `[ , ]` or
  an `? a` pair with no value node falls back to the model's span (`findYaml`, "null value" branch), untested.
- **Explicit tags** (`a: !!str 3`): refused only because the read-back fails (`edit-unsupported`); no dedicated case
  beyond `explicit-tag-conflict`.
- **`edit-unsupported` is overloaded** (container, block scalar, read-back failure); callers cannot tell them apart
  except by message.
- **Merge key diagnostics** for a list point at the whole list, not the one alias (`mergeSources` returns one span).
- **JSON has no expansion budget and `locate` of a container** reports the model node type as `kind`
  (`mapping`/`sequence`), outside §4.1's scalar list.
- ~~§15 (v1.10) still blames `yaml`'s composer for anchors~~ — fixed by the coordinator in f98adc1: §15 names `uniqueKeys` as the third cost correction.
- 020 will want: edit targets that live in a *merged* value (needs `why()` to report the pointer inside the
  supplying document, not only its span), and inserting/deleting (needs a format-preserving tree; `yaml`'s
  Document mode is the door §4.3 names). The writer's read-back and `Found` shape are the extension points.

## The owner and the reviewer

- Egildo decides; the coordinator drafts the spec and verifies. **Your report is the artifact they weigh most**:
  list every place a document was silent, contradictory or wrong, unsoftened, including your own wrong counts
  and the places you invented a rule. Every round, the spec/§ text was corrected from my list.
- Briefs give hand-derived tables: derive yours independently, treat a disagreement as a finding, say which
  side was wrong. A passing suite from a relaxed assertion is worse than a failing one; "existing tests must
  not change" is checked, and a red existing test means **stop and report** (or fix your code).
- They check: sabotage tables (each named sabotage red, the ones that should stay green green), commit hygiene
  (explicit paths, trailer, no amend), that `SPEC.md` is untouched, that nothing is pushed, test counts before
  and after, and that the report names the commits. They spot-check awkward inputs themselves.
- Governance: refusing what the mandated standard (§12) itself refuses is a correction; refusing what it accepts
  needs v2.0 (§15). Check any new refusal against that before writing it.
- Commits happen the moment `pnpm typecheck && pnpm test` is green, small enough for the 600 s watchdog.

## 2026-10-08 — added by the 020 implementer (edit targets and writers)

- **A delegated fragment's `origin.id` is `<location> #graft=N`, not a location.** The location is `origin.label`;
  `configuration.delegationBreadcrumbs.has(origin.id)` tells the two apart. A fragment is not a `Layer`: its nodes sit
  inside the delegating layer's `tree`, with their own origin, and a pointer inside the fragment restarts at the graft root.
- **Several nodes can share one span** (alias and merge-key copies keep the anchor's span). `pointerInDocument`
  (`src/model/pointer.ts`) breaks the tie by the merged pointer, then by last key. Any new "find the node for this span" code needs the same care.
- **The merged tree holds the original nodes by reference**, so a merged scalar still carries its own document's span:
  `editTarget` needs no counting for a list item under `append`, and a scalar wrapped by v1.8 is the document's `/styles`, not `/styles/0`.
- **Template for an in-memory cascade**: `tests/unit/edit-target-fixture.ts` (`build`, `cascade`, `files`) with `InMemoryHost`;
  a remote fragment or override needs only `RecordedTransport` plus `allowRemoteDelegation: true`, no cache directory.
- **`/tmp/sab.py`-style sabotage driver**: a list of (file, old, new, tests), run each, restore, `diff -r` against the backup. Pass stderr too (`stderr=STDOUT`) or the `FAIL` lines are missing.
- Open edges: `editTarget` answers `ok: true` for a value the writer will refuse (shared, block scalar); a writer throws on a malformed pointer; inserting and deleting are still unbuilt.

## 2026-10-08 (round 2) — wall-clock tests are their own project

- **`pnpm test` is now two runs**: `vitest run` (everything except `tests/timing/`, in parallel) and then
  `vitest run --config vitest.timing.config.ts` (`pnpm test:timing`: `tests/timing/**`, one file at a time, single fork,
  nothing alongside). `pnpm test:main` runs the first alone. A timing failure is now a real failure to investigate:
  the parallel load that made the old ratio tests flake is gone. The "rerun that file alone" advice above no longer applies
  to the ratio tests; it still applies to a main-suite test you suspect of load-sensitivity (none known).
- **A new test that asserts on elapsed time or a ratio of elapsed times goes in `tests/timing/`** (`*.timing.test.ts`),
  never in `tests/unit/`. Where the work can be counted (nodes built, calls made) count it in the main suite instead, as
  `bounded-cost` does for the eight-level bomb (W = 100, budget 11,000, stopped at 11,001); keep the clock only for what
  cannot be counted. `generate-oracle`'s FR-038 reads the clock but asserts nothing about it (`> 0`), so it stays.
- The moved tests keep their assertions and their `describe`/`it` names; each timing file says which file it came from.
