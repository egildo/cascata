# Handoff — what the specs and reports do not say

Rewritten at the end of milestone 023 (v1.13, "graph identity") for whoever takes 024. Assumes you have read
`CLAUDE.md` and nothing else. Per-milestone detail is in `specs/NNN-*/report.md`; this is only what is not there,
or is where nobody would look. Earlier handoffs (017 to 022) are folded in where they still hold.

## Graph identity (023): where it lives and what a change must keep

**Two paths per document.** `DocumentIdentity.physical` (required) and `Origin.physical` (optional, present only when it
differs from the label) beside the logical `location`/`id`/`label`. `id`, `label` and every message stay logical. A
hand-built `DocumentIdentity` literal in a test needs `physical` (23 old test files got it in 023). `createOrigin(id, label,
physical?)` drops an equal physical and throws on an empty one.

**`PhysicalPaths` (`src/resolve/location.ts`) is the only thing that calls `host.canonicalize`.** One per `resolve()` call; it
memoizes every question, ancestors included, which is what `graph-identity-paths.test.ts` counts (FR-003). The sandbox
(`isWithinSandbox`/`isSandboxEscape`/`isDelegationSandboxEscape`) takes it, not the host. A new caller that asks the host
directly breaks the count and lets the sandbox and the graph disagree about where a path is.

**`GraphBuilder` (`src/graph/build.ts`)**: `beginVisit(location, incoming, physical = location)`, then the recursion,
then `finishVisit(location, document)`. **There is no content-hash dedup** (FR-006, revised by the owner): identity is the
physical path alone and two documents with identical bytes are two documents; do not reintroduce `registerContent` or a hash
map (it dropped a real document on a legal chain, and handed `buildPedigree` the entry). The hash is for `$pin` and
`DocumentIdentity.hash` only. A **remote** visit starts under its URL and settles with `learnPhysical(location, finalUrl)` after the
fetch. The cycle test is `physical OR logical location` on purpose (a remote physical URL is unknown until fetched).
`DelegationCycleTracker.enter(location, physical)` is the same idea for fragments; grafts are never deduplicated.

**Where a relative reference starts** is `referenceBases(referrer)` (file: logical; remote: physical URL). Anything new that
resolves a reference must take a `Referrer {location, physical}` and, if relative, call `linkNotice` (info, never a refusal;
collected in a per-call `notices` array, returned first in `ok:true`'s `diagnostics`; dropped on `ok:false` like every info).
`resource()` cannot raise it (no host); it carries `otherLocation` instead.

**Remote**: `classifyReferenceLocation` normalizes with `new URL(..).href`; an `https` URL with a fragment is the `fragment` location
kind and is refused as `reference-fragment` at all three sites that follow references (chain, overrides, delegation; FR-020), a
redirect `Location`'s fragment is dropped (`fetch.ts`), a local `#` is a filename character; `fetchDocument`'s `finalUrl` flows through
`resolveRemoteDocument` and is stored in the cache meta (`StoredMeta.finalUrl`; absent in a v1.12 entry, which answers its own
URL). `.href` keeps userinfo and a trailing-dot host (report, Ambiguities 7): not folded.

**Testing it.** `tests/unit/graph-identity-helpers.ts`: `vhost(files, canonical, canonicalizeIsIdentity)` and `resolveAt`. In
the in-memory host `files` is keyed by the **logical** path (that is what `read` is given) and `canonical` answers the
physical one; to model a link that a map cannot (a directory linked to itself) subclass `InMemoryHost` and override `read` and
`canonicalize` (see case "4b" in `graph-identity-cycles.test.ts`). A cycle case should assert
`host.reads` so it discriminates the path rule (the refusal comes before the read). Real-disk tests make their venue under `os.tmpdir()` **without** canonicalizing it
(on macOS `/var` is a link, so FR-013's naming fires on purpose); take expectations from `realpathSync.native`, not the library.
The corpus runner does not assert an `ok:true` result's diagnostics, so `link-changes-reference` cases are unit tests.

## Where things live (and what a change must keep) — 017 to 022, unchanged

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
transitive set of aliases a "warn" names) and `tagDrop` (the tag found in `yaml`'s CST tokens, v1.12.1; `yaml`'s AST exposes no tag range). Invariants: the edit range is exactly the reader's span, except that a dropped tag
widens it leftwards over the tag and its blanks (and the blanks before it when a line break follows, v1.12.1); nothing outside it moves; a quoted scalar keeps its quote style
where it can hold the value; a kept tag does not relax quoting (`!!str "4"`).

**Shared values (022).** `findYaml(…, sharedEdits)`: under `"refuse"` a path through an alias or merge key is
refused at the alias, as since 018; under `"warn"`/`"allow"` the walk resolves the final alias too and answers the
anchored node's bytes. `locate` calls it with the writer's own policy (v1.12.1; it had always passed `"refuse"`). `editTarget`
(`src/edit-target.ts`) counts copies in the document *and* every other origin whose **physical** path is the same file (023; it was the location text before) —
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

- **Load makes the serial timing suite fail.** Three timing tests failed at a load average of 70 to 96 (other processes on
  the machine), one of them over code 023 did not touch; they passed at 12 to 16. Check `uptime` before believing a timing
  failure either way, and rerun when it is quiet; never loosen a bound.

## How I verified (reusable)

- Hand counts first, written beside the expectation (`a0 :1 sp2 …`). In 023 every position is counted from the text
  (`$adopts: ` is nine bytes, so a value starts at 9); one expectation was wrong (the order of `why()`'s chain: winner
  first) and the run caught it.
- **Sabotage driver.** `/tmp/cascata-023/sab.py` (one sabotage: file, old, new, tests; backs up, appends a `/* SABOTAGE */`
  marker, prints the red tests, restores from the backup) and `batch.py` (a list of 28) are worth recreating; run the batch in
  the background, and do not touch `src/` or `tests/` while it runs. **A trap of mine:** `open(p,"w").write(open(p).read())`
  truncates the file before it reads it. It emptied `src/graph/build.ts` once; `git checkout --` saved it only because nothing
  else in it was uncommitted. Never write a file back in the same expression that reads it.
- A new test that "is red before" is also worth running against the previous milestone's source in a `git worktree` of the
  old commit (symlink `node_modules`, copy the tests in); in 023 that showed 55 of 74 failing, and that the probe gate and
  the controls pass on the old code, as they should.
- Sabotage every claim, including ones you expect to stay green; three stayed green and one of them exposed a
  real defect (the vacuous copies read-back).

## Open edges (noticed, not fixed)

- **Leftovers after v1.13.0 (pinned by the owner, 2026-10-11, for later):**
  - Close issue #8 on GitHub with a comment pointing to v1.13.0 (fixed there; still open).
  - `README.md`'s status paragraph still says "v1.12.1"; the release drill in `CLAUDE.md` bumps only its install line.
    Fix the sentence and add it to the drill.
  - `README.md` and the older `specs/*/contracts/` still show a two-field `DocumentIdentity` (no `physical`).
- **023, as built:** `resource()` carries `otherLocation` instead of a notice (ruled); the remote notice compares URL
  strings and can over-report where two URLs redirect to one file; `GraphBuilder.learnPhysical`'s "duplicate" outcome
  is reachable only in a unit test (a chain is linear).

- **Unreachable safety net:** `edit-read-back` (an edit that would not read back), kept as a refusal so a writer
  bug reaches a live editor as a refusal rather than a crash; no known input reaches it.
- **Settled, not defects (v1.12.1):** JSON has no expansion budget because it has no aliases; `locate`'s `kind`
  is a scalar's kind or a container's type (`mapping`/`sequence`), as the type and reference say; renaming it gains nothing.
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
