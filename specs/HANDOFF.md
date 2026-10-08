# Handoff — what the specs and reports do not say

Rewritten at the end of milestone 022 (v1.12, "after the review") for whoever takes 023. Assumes you have read
`CLAUDE.md` and nothing else. Per-milestone detail is in `specs/NNN-*/report.md`; this is only what is not there,
or is where nobody would look. Earlier handoffs (017 to 020) are folded in where they still hold.

## Where things live (and what a change must keep)

**Positions (017, 022).** `src/adapters/yaml/parse.ts` owns every YAML span. `ctx.text` is the *stored* text
(marks and CRs included); `yamlText` is what `yaml` reads. Two substitutions: a lone CR becomes LF (same length),
and every document-prefix byte-order mark is *removed* (`marks.ts`: `documentPrefixMarks`, `removePrefixMarks`,
`storedIndexer`, which maps a parser index past the prefix, never into it). After `parseDocument`, every node
`range` and `error.pos` is rewritten in place to stored indices. `buildOffsetTables` builds two `Uint32Array`s in
one pass: stored index → byte offset, and stored index → columns before it (the mark at index 0 is never a
column, any other mark is). A column is `columns[target] - columns[lineStart] + 1`: never count from a line's
start again (issue #9 was exactly that, N² on one long line). The empty document's null sits after the last
prefix mark (`at`, in `parseYaml`), not at 0.

**The reader's `onDocument` hook (018).** `parseYaml`/`parseYamlBytes` take an optional fourth argument, called
after the document is mapped and before the tree walk, with `(doc, {spanOf, tightSpanOf}, anchors)`. It is how
the writer sees aliases, anchors, styles and tags the model has forgotten, measured by the reader's own span
functions. Never give the writer a second way to measure a byte.

**A pair with no value node (022).** `nullAfterKey` gives `? a` and `{a}` a null at the end of the key, counted
and depth-checked like a built value. The writer's "null value" branch in `findYaml` is live because of it: it
answers `bareKey.indicator` (`"\n" + indentation + ": "`, the indentation being the mapping's own column, i.e.
the `?`), or `undefined` in flow, which `setValue` refuses.

**Writers (018, 022).** `src/adapters/edit.ts` is format-blind: `locate`, `setValue`, the kind rule, number
spelling, the nothing-changed law, the shared policy, the tag drop, and the **read-back** (apply to a copy,
reparse, compare at the pointer *and* at every pointer that held the value's bytes before the edit, `Found.copies`).
`yaml/write.ts` walks the pointer through the `yaml` AST and owns string spelling, `aliasesHolding` (the
transitive set of aliases a "warn" names) and `tagOnLine` (the tag found by scanning back along the value's line;
`yaml` exposes no tag range). Invariants: the edit range is exactly the reader's span, except that a dropped tag
widens it leftwards over the tag and its blanks; nothing outside it moves; a quoted scalar keeps its quote style
where it can hold the value; a kept tag does not relax quoting (`!!str "4"`).

**Shared values (022).** `findYaml(…, sharedEdits)`: under `"refuse"` a path through an alias or merge key is
refused at the alias, as since 018; under `"warn"`/`"allow"` the walk resolves the final alias too and answers the
anchored node's bytes. `locate` always calls it with `"refuse"` (FR-005: accepted and ignored). `editTarget`
(`src/edit-target.ts`) counts copies in the document *and* every other origin whose location is the same file —
a graft (`delegationBreadcrumbs.has(id)` → its label is the location) or a layer read from that file — via
`originsInTree` and `pointersAt` in `src/model/pointer.ts`.

**The pointer index (022).** `src/model/pointer.ts` keeps one index per tree root in a module-level `WeakMap`,
built on first use by one iterative walk (pointer restarts at a node whose origin differs from its parent's).
`pointerIndexBuilds()` is the counted witness; there is no other observable state. Trees are frozen, so the
index is never stale. Anything new that needs "the node(s) at this span" must read the index, not walk.

**Anchors and the budget (019).** `yaml/anchors.ts`: one iterative walk in `visit`'s order builds name → node and
alias → target, plus (022) `aliasesTo(node)` in document order. `Alias#resolve` is called nowhere under `src/`
(a sweep enforces it; it is the oracle in `tests/unit/anchor-table.test.ts`). `parseDocument` runs with
`uniqueKeys: false`; Cascata's `firstOccurrence` map is the only duplicate check.

**Corpus kinds.** Parse cases `tests/corpus/cases/`; write cases `tests/corpus/write-cases/` (`write-case.ts`,
`write-runner.ts`, cites `v1.10 FR-nnn` or `v1.12 FR-nnn`, optional `sharedEdits`, default `"refuse"`). The write
runner has three witnesses for an edit: the hand-counted bytes, Cascata's reader (L2/L3, every copy under
warn/allow), and `yaml`'s own `parseDocument` (no `TAG_RESOLVE_FAILED`). It restates FR-006 itself rather than
importing the writer's rule: keep it independent. `tests/unit/writers.test.ts` re-runs every write case through
the writers under the case's own policy.

## Traps not in CLAUDE.md

- **The Write tool and heredocs turn `\uFEFF`, `\u0301` and friends into raw characters** in source. Write such
  lines with Python and escaped text, then `grep -nP '[\x{FEFF}\x{0301}]'`. Also: a code fence tagged `yaml` in any
  `specs/**/*.md` is *executed* by `tests/unit/doc-examples.test.ts`.
- **No `push(...items)` / call-site spread on anything that can be big** (`validate-totality` sweeps `src/`).
- **`timeout` does not exist on this macOS**; `sed -i` needs `-i ''`; zsh does not word-split `$VAR` lists.
- **`yaml` ranges start at the value, after its properties** (`&a !!int 1` → the `1`). Any rule about a tag or
  an anchor's own bytes has to find them in the text.
- **Copies of a value are one AST node.** A check that compares copies *after* an edit can never fail; compare
  the places that held the value *before* it (the 022 read-back was vacuous until sabotage showed it).
- **A ratio timing test on a few milliseconds is noise.** Make each side tens of milliseconds and pay for the
  index or table inside the timed region (fresh configuration per attempt), or the "linear" ratio drifts to 8×.
- **`yaml`'s `{a}` and `? a` are the same shape** (a pair with a null value). A change for one changes both.
- **`toEqual` on an `ok` result breaks when a field is added** — 022 had to add `diagnostics: []` to 17 existing rows.
  Prefer `toMatchObject` only where a field is genuinely not under test.

## Fragile or slow tests

- Timing tests are in `tests/timing/` and run serially (`pnpm test:timing`); a failure there is real. The 022
  file `after-the-review.timing.test.ts` has margins of about 2-3× (lines) and 5× (keys) under its 8× bound.
- Red-phase timing runs take minutes (the A1 sabotage: 23 s at 40,000 items on one line). Run them in the
  background and never under a foreground 600 s command; `/tmp/cascata-022/sab.py` (a JSON list of file, old, new,
  command) is the driver used this round and is worth recreating.
- `anchor-table.test.ts` (~20 s) and `duplicate-keys.test.ts` are the slow main-suite files.

## How I verified (reusable)

- Hand counts first, written beside the expectation (`a0 :1 sp2 …`). Two of mine were wrong this round and the
  runs caught them; the spec's hand counts were right except one label (FR-011's "3..8 including its space").
- Sabotage every claim, including ones you expect to stay green; three stayed green and one of them exposed a
  real defect (the vacuous copies read-back).

## Open edges (noticed, not fixed)

- **`locate` ignores `sharedEdits`**, so a writer's `locate` refuses an alias copy its `write` writes under `"allow"`.
- **Pointer segments with a leading zero (`01`)** are accepted as sequence indices (`^\d+$` in `yaml/write.ts` and
  `resolvePointer`); RFC 6901 forbids them. (`+1` is rejected; the 020 handoff said otherwise.)
- **A later document's prefix mark** is reported as misplaced beside `multiple-documents`.
- **Explicit tags under a `%TAG` handle**, or on an earlier line than the value, cannot be dropped: refused.
- **`edit-unsupported` is overloaded** (container, block scalar, read-back failure, flow bare key, tag elsewhere, bare key in a shared
  mapping; from `editTarget`, a format with no writer);
  callers tell them apart only by message.
- **Merge-key diagnostics** for a list point at the whole list, not the one alias.
- **Untested though true**: `unknown-type-entry-keyword`; a malformed `seal:`; `edit-unsupported` from a
  read-back failure, a bare key in a shared mapping, `editTarget`'s no-writer format, a `%TAG` tag; a later
  document's prefix mark.
- **JSON has no expansion budget**, and `locate` of a container reports `mapping`/`sequence` as `kind`.
- **A bare key inside a shared mapping** is refused under `"warn"`/`"allow"` (invented in 022, not specified).
- Inserting and deleting entries are still unbuilt (§4.3's format-preserving tree).
- **Parked (v1.12.1): parse once, ask many.** Every `locate`/`setValue` parses the whole document, so checking N
  values of one document costs N parses. The cure is a writer that opens bytes once and answers many pointers;
  wait for a consumer that needs it.

## The owner and the reviewer

- Egildo decides; the coordinator drafts the spec and verifies. **Your report is the artifact they weigh most**:
  every place a document was silent, contradictory or wrong, unsoftened, including your own wrong counts and the
  rules you invented. They check sabotage tables, commit hygiene (explicit paths, trailer, no amend), that
  `SPEC.md` is untouched, test counts before and after, and they spot-check awkward inputs themselves.
- Governance: refusing what the mandated standard (§12) itself refuses is a correction; refusing what it accepts
  needs v2.0 (§15). A reading change, even a correction, must be named in §15 — 022's `{a}` was not.
- Commit the moment `pnpm typecheck && pnpm test` is green, small enough for the 600 s watchdog.
