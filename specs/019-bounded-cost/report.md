# Report: A Document's Cost Is Bounded by Its Size (v1.10)

Tests 2493 before, 2564 after (23 in `anchor-table.test.ts`, 26 in `bounded-cost.test.ts`, one corpus case,
and the sweeps that now see the new files). `pnpm typecheck` and `pnpm test` green at each commit; no
SABOTAGE residue. `SPEC.md` not edited, version not bumped, nothing pushed. **No existing test changed**
(FR-007): the only edit to existing test files is `tests/corpus/case.ts` learning two more `limits` fields.
Two existing tests went red on my first draft of step 2 (the Article VI call-site-spread sweep and a
200,000-entry totality case) for a real reason of mine, `stack.push(...items)` in `budget.ts`; I fixed the
code, not the tests.

## Commits

1. `2e29e96` fix(019): every alias is resolved from one table, not by walking the document
2. `5c2ecd3` feat(019): a document that expands more than tenfold beyond ten thousand nodes is refused
3. (docs and this report)

## What was built

- `src/adapters/yaml/anchors.ts`: `buildAnchorTable(doc)`, one iterative walk in `visit`'s order, answering
  `targetOf(alias)` and `firstAliasTo(node)`. `expand.ts`'s `resolveAlias`/`mergeSources` and all four sites in
  018's `write.ts` use it; `Alias#resolve` is called nowhere under `src/`. The 018 writer's `onDocument` hook
  now hands over the table with the document, so the writer and the reader share one.
- `src/adapters/yaml/budget.ts`: `countWritten(doc)` (W). `parse.ts` counts E as the walk builds nodes and
  throws a private sentinel at the first node past the budget, caught once, turned into the one diagnostic.
- `ParseLimits.expansionRatio` (10) and `expansionAllowance` (10,000); `expansion-limit-exceeded` in
  `RESOURCE_LIMIT_CODES`; `docs/reference.md` names the defaults beside the other two limits and carries the
  code's row. JSON is untouched.
- Tests: `tests/unit/anchor-table.test.ts` (oracle + sweep + timing witness), `tests/unit/bounded-cost.test.ts`
  (the counted cases), `tests/corpus/cases/limits/expansion-bomb-three-levels.json` (with a `text` slice).

## The three counted cases, by hand

- **The bomb at three levels**: lines of 30, 50, 50 and 50 bytes = 180; W = 45; E = 12,345; budget 10,450;
  the crossing is inside the ninth alias of `l3`, bytes **171-174** (`*l2`), line 4, column **42**. Matches the
  spec's count exactly, and the corpus case's `text` slice confirms the bytes are `*l2`.
- **Sharing that passes**: a 20-node profile and 1,000 walls, W = 22 + 4N, E = 22 + 23N: loads, and its tree is
  `nodesEqual` to the same document written out without aliases.
- **Sharing that is refused**: a 100-node anchor and 1,000 bare aliases, W = 1,102, E = 100,102, budget 21,020:
  refused; `expansionRatio: 100` (budget 120,220) loads.
- **Mine**: W and E of five documents pinned from both sides through the budget (`expansionRatio: 0` and an
  allowance of E - 1 refuses, E loads; ratio 1 allowance 0 gives W), the default budget at its exact edge
  (anchor of 38 nodes, 370 aliases: E = 14,100 = 10 x 410 + 10,000 loads; 371 does not), and a merge key's
  expansion (65 mappings load, the 66th is refused at its merge value, line 67, column 11).

## Sabotage (backed up to /tmp, marked, restored, tree diffed after)

| Sabotage | Went red |
|---|---|
| `Alias#resolve` in one site (the writer) | both sweeps |
| `Alias#resolve` behind the table | both sweeps and the timing witness (4,000 aliases: 10,634 ms against yaml's 379) |
| Table without redefinition (spec) | the redefined-anchor, merge-redefined, nested-redefinition and the generated oracle cases |
| Table walks a pair's value before its key | `&k a: *k` (added for this: none of the others reached it) |
| Count after the expansion, not during (spec) | the corpus bomb and the unit bomb, on position (175-178, not 171-174); the 8-level bomb also ran the worker out of memory before step 2 existed |
| Ratio 100 by default (spec) | the bomb (corpus and unit), the default-edge case, the strictness case, the merge case |
| Allowance 20,000 by default | the same four |
| Keys counted as nodes (spec) | the W pins (four), the merge case — **not the bomb's position** (see below) |
| Innermost alias reported, not outermost | the bomb's position in both (75-78, line 2) |
| Merge expansion not a site | the merge case (position 1:1) |
| Aliases counted as 0 in W | six W/E pins |

## Where the spec, §4.2, §11 and the §15 entry were silent, contradictory or wrong

1. **The sabotage "count keys as nodes (the three-level bomb's position red)" does not do that.** Keys are only
   in the root mapping (4); W goes 45 to 49, the budget 10,450 to 10,490, and the crossing stays inside the same
   alias. The W pins catch it; the bomb's *message* (it names W) goes red, its position does not.
2. **"Eight levels, under 400 bytes" is 430 bytes** in the shape the spec describes (30 for `l0`, 50 a level).
   Immaterial, but a number a test would pin.
3. **§4.2's last hygiene sentence is not true as written**: "Reading a document costs time and memory in
   proportion to its size, so the caps bound the work." `yaml`'s own composer is superlinear in anchors with
   no Cascata code involved: `parseDocument` of N anchors plus N aliases takes 108 ms at 2,000, 413 ms at 4,000,
   1.7 s at 8,000; with anchors alone, 135 ms at 4,000 and 470 ms at 8,000. So the 8 MiB cap does not bound the
   work: ~1M short anchors fit in it. It is upstream's, not fixed, and not covered by the expansion budget (the
   tree is small; the cost is in the parse). It needs either a sentence softened or a cap on anchors (out of scope
   by the spec's own list: "a cap on alias count alone").
4. **The spec's timing test cannot be written as stated** ("8,000 aliases in under twice the time of 4,000 plus
   a fixed allowance") for the reason in 3: even with a perfect table the whole read is ~4x from 4,000 to 8,000.
   The witness is relative to `yaml`'s own `parseDocument` of the same text (a small multiple, not 32x and
   growing). An absolute-overhead version I tried first (read minus parse) was noisy enough to flake; the ratio
   form is not.
5. **"Each merge key's value as one" cannot be read literally**: it would count `<<: {…20,000 entries…}` as one
   node and refuse a document that expands nothing. I count a merge key's value like any value (an alias one, a
   sequence of aliases a sequence plus its aliases, an inline mapping its nodes). The two readings differ only
   for a merge value that is not a bare alias.
6. **Where the diagnostic points is under-specified**: "the alias being expanded when the budget is crossed" has
   an innermost and an outermost reading, and they are different bytes (the crossing is inside `*l2`'s own
   expansion, at a nested `*l1` on line 3). The spec's counted position (171-174) is the outermost; I report
   that, and for a merge key the key's value (a list of aliases is reported as the whole list, not the one alias).
7. **"E" in the message**: the spec says the message names E, but a stopped read never learns the E the document
   would have reached. The message names the count at which it stopped, always budget + 1, and says so.
8. **Pre-order vs post-order counts**: the spec's "1,235 after `l3`'s sequence" is a pre-order count; the walk
   builds containers after their children. Same alias, different running numbers. Not observable in a position.
9. **E counts nodes built, not kept**: a merged entry that an explicit key overrides is built, then discarded,
   and is counted. The spec says "model nodes in the expanded tree"; the cost is what is bounded.
10. **"Then the read stops, as the other resource limits do"**: `depth-limit-exceeded` does not stop the read
    (it skips the node and keeps walking siblings); only `size-limit-exceeded` is before the parse. The
    expansion refusal stops the walk, keeps the diagnostics already collected, and adds its own: "one
    diagnostic" is true of this code, not of the whole result.
11. **§15 cites Go's and Java's limits** (a ratio "more generous for small documents"; SnakeYAML's 50 aliases
    per collection). I did not check either; they are not mine to vouch for.
12. **Nothing bounds the 018 writer's read-back separately**: it is two reads, each under the budget.

---

# Round 2: `yaml`'s own duplicate-key check

Tests 2564 before, 2577 after (13 in `tests/unit/duplicate-keys.test.ts`). Commit `a7132b4`, and the report/comment
commit after it. No existing test changed; the one edit to an existing test file is the comment and baseline of
round 1's own timing witness in `tests/unit/anchor-table.test.ts` (below).

## The cause, and the fix

`yaml`'s `parseDocument` compares each new pair with every pair already in the mapping (`uniqueKeys`, on by
default). Round 1 mistook that for the composer being superlinear in anchors: a mapping with no anchors at all
is just as slow. The reader now passes `uniqueKeys: false`. It is the only `parseDocument` call in `src/`; the
writer reads through the reader, so locate (one read) and setValue (two) get it too.

Measured here, one flat mapping of N keys (`key<i>: <i>`), milliseconds:

| N | `yaml` default, the read, before | `yaml` with `uniqueKeys: false` | the read, after | `locate` after | `setValue` after |
|---|---|---|---|---|---|
| 8,000 | ~0.35 s (yours) | 60 | 98 | 85 | 187 |
| 16,000 | 3,206 | 86 | 161 | 168 | 334 |
| 32,000 | 18,054 (`locate` 19,455) | 165 | 321 | 338 | 652 |

The read is about twice `yaml`'s own parse and doubles when N does. Other shapes at 8,000 and 32,000 are all
linear now (32,000 anchors alone 381 ms; anchors-and-aliases 412; 32,000 aliases in a sequence 202; 4,000
nested mappings 318): the "composer superlinear in anchors" of round 1 was this and nothing else.

## Nothing observable changes

- `yaml`'s `DUPLICATE_KEY` was already discarded: `readerErrorDiagnostic` returns `undefined` for it, so no
  path ever mapped it to `malformed-document`. Its position only fed the misplaced-byte-order-mark de-duplication
  (`misplacedAt`), which looks for errors at a mark, and a `DUPLICATE_KEY` is at a key's start.
- The AST is identical with the check on and off, for all 26 documents of the battery: every node's type, range,
  value and anchor, every pair, and the warnings (checked by a probe, kept out of the tree).
- Cascata's diagnostics (code, level, message, primary, related) for those 26 documents are byte-identical
  before and after: a snapshot taken against the code as it stood, compared with a snapshot after.
- The battery: plain; `a` and `"a"` and `'a'` and `"a"`; flow mappings; three occurrences; a key written
  twice around a merge key and one beside a merged key; a duplicate inside an anchored mapping reached by a merge;
  non-ASCII (`é`, `日本`, and NFC against NFD, which are different keys to both); an empty key spelled two ways;
  `~` against `null`; `&k a` against `*k`; `? a` against `a`; a key with a trailing space; a mark-prefixed key.
- Kept as tests: hand-counted positions for the duplicate cases (the later key's span, the first occurrence as
  `related`, in bytes), and a coverage property: **every pair `yaml` flags is a Cascata `duplicate-key` (or a key
  Cascata refuses outright as `non-string-key`) at the same byte.** The probe also showed the other direction:
  `&k a: 1` / `*k : 2` is a duplicate Cascata catches and `yaml`'s check never did.
- Cascata's check was already linear: `buildMappingEntries` keeps `firstOccurrence` in a `Map`, and merge folding
  tests `target.has`. Nothing to fix.

## Sabotage

| Sabotage | Went red |
|---|---|
| `uniqueKeys` back to the default | the 16,000-key witness (1,515 ms against yaml's 97, over its 1,085 bound); at 32,000 it is ~100x |
| Cascata's duplicate check removed | six hand-counted cases, and in the corpus `duplicate-keys/literal-duplicate-refused`, `duplicate-keys/quoted-vs-plain-collision`, `multi-violation/three-violations-far-apart-all-reported` — Cascata's check, not the parser's, is the guard |

## Still wrong

1. **Round 1's report says `yaml`'s composer is superlinear in anchors and §4.2's sentence was corrected on that
   basis.** It was `uniqueKeys`. The sentence "reading a document costs time and memory in proportion to its
   size" is now true for the shapes measured, but the §15 entry's description of the cause is not; `SPEC.md` was
   not mine to edit.
2. **Round 1's timing witness had the same blind spot**: it compared against `parseDocument` with the default
   `uniqueKeys`, which is superlinear on a flat mapping of 8,000 keys, so the bound 3x was loose for the wrong
   reason. It now compares against `uniqueKeys: false`; the comment is corrected; it still passes.
3. **The 16,000-key witness is a thin red** (a bound of ~1.1 s against 1.5 s with the check back on, on this machine
   under load); the 32,000-key one is the decisive witness (about 100x). It is rerun-tolerant, and not weakened.
4. **Not done, not asked:** a mapping with 32,000 *merge keys*, deep nesting at the depth cap, and a sequence of
   mappings each with many keys were not separately timed.
