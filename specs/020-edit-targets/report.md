# Report: Edit Targets, and Writers (v1.11, specs/020-edit-targets)

Tests 2577 -> 2979 (+402: `why-pointer` 15, `edit-target` 27, `writers` 340, and 20 more
from existing per-code and per-source-file sweeps picking up the two new codes and two new modules). `pnpm typecheck` clean. `SPEC.md` untouched, nothing pushed, no version
bump, no existing test changed. One existing test (`validate-totality`, the timing ratio) failed once in the
baseline run, concurrent with typecheck, and passed in every later run: the known flake.

## Commits

| Hash | Subject |
|---|---|
| fba7140 | feat(020): why() entries carry pointer, the value's place inside its own document |
| 933c69b | feat(020): editTarget — which document and pointer hold the winning value |
| 64077a7 | feat(020): yamlWriter and jsonWriter, from @egildo/cascata/writers |
| (step 4) | docs(020): reference.md, the report, the sabotage table |

## What was built

- `src/model/pointer.ts` `pointerInDocument(root, span, hint?)`: an iterative walk of a layer's own tree for the
  node whose span (origin id, start, end) is the given span; the pointer restarts at a delegated fragment's root.
- `src/merge/provenance.ts`: `why()` attaches `pointer` at answer time (like `delegatedFrom`); new exported type
  `WhyEntry = ProvenanceEntry & { pointer }`. The stored record is untouched.
- `src/edit-target.ts` `editTarget` (outside the policed directories, because it needs the adapter registry for
  the format). `src/diagnostics/codes.ts` `EDIT_TARGET_CODES`. `src/writers.ts` and the `./writers`,
  `./writers.js` exports. `docs/reference.md` section "v1.11".
- Tests: `tests/unit/{edit-target-fixture.ts,why-pointer,edit-target,writers}.test.ts`. No new corpus kind: the
  spec's table is in the unit tests, and the writer equivalence reuses the 175 v1.10 write cases.

## Hand derivation against the spec's table

Every row of the spec's table matched my hand-derived answer on the first run, including the spans I derived
independently (project.yaml W1 mapping 88-99, height 96-99; override.yaml walls 27-46, height 43-46; root.yaml
provided `3.0` at 92-95, `house.css` at 276-285; fragment `0` at 17-18). **My own wrong count**: I wrote the alias
fixture's `1` in `a: &x 1` as bytes 7-8; it is 6-7 (`a` 0, `:` 1, space 2, `&` 3, `x` 4, space 5). The run caught
it; the spec was not involved. I also first counted override.yaml's `W2` mapping from `W2` (27) rather than from its
first key (35); caught before the run, when I re-counted for the absent row.

## Sabotage

Each: back up `src`+`tests` to `/tmp/sab-backup`, one `SABOTAGE` replacement, run the named files, restore,
`diff -r`, `grep -rn SABOTAGE src tests` (empty before every commit). "Red" lists what went red; everything else in
the named files stayed green.

| # | Sabotage | Red |
|---|---|---|
| spec 1 | derive the in-document pointer from the merged pointer: in `why()` | 8 of 14 in `why-pointer` (delegated fragment, JSON fragment, schema `provide` x2, accumulated list x2, overridden chain, ...). `edit-target` untouched (it does not use `why()`'s field) |
| spec 1 | same, in `editTarget` | 4 of 23: the YAML and JSON delegated rows and items 1-3 of the accumulated list; every other row green |
| spec 2 | schema layers are targets | 3: `/defaults/height`, `/styles/0`, and the remote-schema row |
| spec 3 | drop the remote check | 2: the remote fragment, the remote override; the rest green |
| spec 4 | `jsonWriter` also claims `.yaml` | 2 of 340: the json-claims case and the no-two-writers case; all 338 equivalence cases green |
| mine | no tie-break by the merged pointer (`why()` / `editTarget`) | 1 / 1: the alias row in each |
| mine | no same-last-segment tie-break | 2: the alias-in-a-fragment rows |
| mine | pointer does not restart at a fragment root | 5: all fragment rows |
| mine | absent positioned at the root | 1 |
| mine | fragment location is its graft id | 2 |
| mine | remote checked before inherited | 1 (the remote-schema row: pins my precedence choice) |
| mine | no escaping in the document pointer | 1 |
| mine | containers are targets | 4 |
| mine | sequence index off by one | 3 |
| mine | `why()` contributors get the merged pointer | 1 |
| mine | writer `locate` reason a constant / `write` reason a constant / `locate` ignores the path | 11 / 16 / 172 |

Cases added **after** the code, as probes of the laws, and green on first run (so their value is the sabotage, not a
red phase): the wrapped-scalar item, the fragment an override delegated to, the remote override, the
alias-in-a-fragment rows (the last was added with the code for the same-key tie-break, and watched red under its
sabotage).

## Where the documents were silent, contradictory or wrong (unsoftened)

1. **FR-002 "its `origin.id`" is wrong for a delegated fragment.** A fragment's `origin.id` is
   `<location> #graft=N` (`src/index.ts`, `performGraft`: one id per graft so two grafts of one file share no
   provenance); the file's location is `origin.label`. The spec's own table row ("the delegating key's
   `/L1/elevation` -> `levels.yaml`") cannot be met with `origin.id`. I return `origin.label` for an origin that is
   a key of `delegationBreadcrumbs`, `origin.id` otherwise. Neither Article IX nor §15 says which; both say
   "document". Corollary: the "document" of `why()`'s `pointer` is the fragment, not the layer, and a fragment is
   not a layer (`entry.layer` is the delegating config).
2. **FR-001 "the node whose span is the entry's span" is not a function.** An alias or merge key expands to a copy
   that keeps the anchor's span (§4.2), so several nodes of one document share a span (`a: &x 1` / `b: *x`: both
   6-7). A first-found walk answers `/a` for `/b`. I invented the rule: among equal spans, the node whose pointer is
   the merged pointer asked about, else the first whose last key is the merged pointer's, else the first in walk
   order. The second clause exists because the merged pointer of a fragment value is not the fragment's. This is
   selection among tree-derived candidates, not derivation by string arithmetic, but it is a heuristic, and I
   believe the spec should say so. The consequence is harmless today: a value in any such copy is shared, so the
   writer refuses it either way (`edit-target-shared`), but `editTarget` still answers `ok: true` for it with a
   possibly wrong pointer in exotic cases (an alias inside a fragment whose key differs from the merged key and no
   exact match). Nothing in the spec says `editTarget` should refuse a shared value, and it cannot know.
3. **§19 "`why()`'s entries carry the same in-document pointer" cannot hold for list items.** `why()` of
   `/styles/2` answers the list's entries (items have no history of their own), so `pointer` is the list's
   (`/styles`), where `editTarget` answers the item's (`/styles/0`). FR-001 ("the entry's value") is consistent and
   Article IX's "the same" is not. A tool that wants an item's address must use `editTarget`.
4. **Typing is unspecified.** FR-001 says entries "gain `pointer`". Making it required on `ProvenanceEntry` breaks
   the stored `ProvenanceRecord` (the fold builds entries without it); optional makes every consumer handle
   `undefined`. I added `WhyEntry = ProvenanceEntry & { pointer }` and typed `WhyResult` with it: a narrowing of
   the return type, compatible with every existing consumer.
5. **Primary spans of three refusals are unspecified.** FR-003 gives inherited ("that value's span") but not
   absent or container. Absent: the nearest existing ancestor in the merged tree, as `locate` does (the root at
   worst). Container: the merged node's span (for a synthesized mapping that is the nearest layer's mapping span,
   which may be a document other than the one that supplied most of it).
6. **Inherited versus remote when both apply** (a remote schema's `provide`) is unspecified. I report inherited
   (named schema, more useful). It is a one-clause swap and is pinned by a test.
7. **"A document read over https:// is never a target" is, in practice, about fragments and overrides.** The
   config layer of the entry is never remote, so the spec's "recorded transport" row needs
   `allowRemoteDelegation: true` and a remote *fragment* (or a remote override, which also works). A host that
   answers `locate` with a location that is remote underneath is not detected: the test is the location string.
8. **`editTarget` cannot predict the writer's refusals** (`edit-target-shared`, block scalar, read-back failure).
   It answers `ok: true` for a scalar in a block style or under an alias. Article IX says nothing about whether it
   should; reading bytes is out of its contract (FR-002 "It reads no file").
9. **Writers: what throws.** FR-005 says "add no behaviour", so a pointer without a leading `/` or a non-scalar
   value throws (`requireArguments`/`TypeError` in the verbs), though the shape elsewhere answers
   `{ ok: false, reason }`. A source-graph library's editing stage may not expect a throw. Left as the verbs have
   it. Also unspecified: `claims` of a remote URL ending `.yaml` is `true` (the rule is by extension); of
   `x.yaml?rev=1` is `false`.
10. **Plan ordering.** The spec puts `package.json` exports and codes in step 4, but step 3's tests need the export
    and step 2's code needs the codes; I did each with its feature. Docs and report were step 4.
11. **`edit-target-absent` is a v1.10 code**, which the spec's "two new codes" rightly counts; I mention it only
    because §15 (v1.11) and FR-006 would be misread as three. No dispute.
12. **A branch I could not test.** `editTarget` refuses `edit-unsupported` when the document's extension maps to no
    writer format, or when no layer holds the value. Both are unreachable today (two formats; the fold carries
    nodes by reference) and are defensive.

Sentence-by-sentence check of Article IX's two new laws: every sentence is implemented and has a test, except as
noted in 1, 3, 6, 7 and 8. "Naming the schema that supplied it" is met in the message (the schema's location),
the spec's three phrasings ("layer", "schema", "schema's location") agree.

## The handoff note

It was useful and accurate in the parts I touched: the `Found`/read-back extension points, the list of flakes (the
single baseline failure was exactly the one it named), the sabotage protocol, and "edit targets that live in a
*merged* value need `why()` to report the pointer inside the supplying document" -- which pointed straight at the
work. What it lacked, and what I had to find: that a **fragment's `origin.id` is not its location** (the single
biggest trap here); that **layer trees already contain the grafted fragment nodes**, with their own origin, so a
pointer must restart at a graft root; that **alias copies share spans**, which makes "find the node by span"
ambiguous; and that `InMemoryHost` plus `RecordedTransport` is enough to test remote fragments and overrides with
no cache directory. `tests/unit/overrides.test.ts` was the best template for in-memory cascades.
