# Report: Writing a Value Back (v1.10)

Tests 2269 before, 2493 after (173 write cases, 21 property tests, and the existing sweeps now cover the
new files). `pnpm typecheck` and `pnpm test` green at every commit; no SABOTAGE residue. `SPEC.md` not
edited, version not bumped, nothing pushed. Plan, decisions and the FR-008 probe: `plan.md`.

## Commits

1. `2cb63aa` feat(018): locate and setValue — a value's bytes, and the edit that changes only them
   (steps 1-3, plus the string code that lives in the same function; the A and B cases)
2. `5cf2e19` test(018): strings — the probe gate, FR-008's cases, and the property test (step 4)
3. `457f652` docs(018): the reference section for locate and setValue; a merge override is editable (step 5)
4. (this report)

Steps 1-4 were not four commits: `setValue` is one function and the string spelling is two helpers beside
it. The step plan's "red" is also not literally true: the cases were written first and by hand, but there was
nothing to run them red against, and the first run was green (every hand-counted range matched; see below).
Sabotage is what showed them able to fail.

## What was built

- `src/adapters/edit.ts`: `locate`, `setValue`, the result types, the kind rule (FR-006), number spelling,
  the nothing-changed law, and a read-back of every edit before it is returned.
- `src/adapters/yaml/write.ts`: walks the pointer through the `yaml` document the reader parsed.
  `parseYamlBytes`/`parseYaml` gained an optional `onDocument` hook that hands over the document (ranges
  already in stored indices, v1.9) and the reader's own span functions. FR-008 lives here.
- `src/adapters/json/write.ts`: the scanner's own spans; `JSON.stringify` for strings.
- `EDIT_CODES` in `src/diagnostics/codes.ts`: `edit-target-absent`, `edit-target-shared`, `edit-unsupported`,
  `edit-unrepresentable`. Exports from `src/index.ts`. `docs/reference.md` section. The layering test needed
  no change: it already forbids every downstream directory from importing `adapters/`.
- Corpus: `tests/corpus/write-case.ts`, `write-runner.ts`, `write-corpus.test.ts`, `write-cases/`. Its own
  loader, citing `v1.10 FR-nnn` (no existing `CITES_PATTERN` needed touching). The runner's second witness
  applies the edit, parses it with `parse`/`parseJsonBytes`, and checks L2 (kind per FR-006, restated in the
  runner, not imported), L3 (the range is the reader's span; every other leaf of the tree unchanged).
- `tests/unit/write-value.test.ts`: ~95 non-ASCII/boundary/adversarial strings through nine YAML contexts and
  JSON, a 1 MiB string, 14 numbers in five contexts, the programmer-error throws, pointer escapes.

## The 18-row table

All 18 rows pass with the numbers the spec gives; the two named-span cells, derived by hand before the case
was written: `absent` is `/walls` = **9-50** (the block mapping starts at `W1`, offset 9, and ends after the
last `3.2` at 49), `container` is `/walls/W1` = **17-28**. No row of the table was wrong.

## Sabotage (backed up to /tmp, marked SABOTAGE, restored; the tree was diffed against the backup after)

| Sabotage | Went red |
|---|---|
| Ints over floats (spec) | `kind-kept-float`, `exponent`, `negative-zero`, `unchanged-whole-float`, `json-exponent`, `json-whole-float`, 2 property tests |
| Never quote (spec) | `needs-quotes`, `norway`, and 82 more (every quoted-word, indicator, escape and flow case; 8 property tests) |
| Drop the single-quote doubling (spec) | `single-quoted-kept`, the single-quoted property test |
| Follow aliases (spec) | `alias`, `locate-alias`, `merge-key`, `locate-merge-key` |
| Range in UTF-16 units (spec) | `non-ascii`, `byte-order-mark`, `prefix-marks` |
| Widen the range to the line (spec) | `comment-after`, `comment-after-string`, `empty-value-before-comment`, `crlf`, `lone-cr`, `flow` and the flow cases (15) |
| Ignore anchor sharing | `anchor-owner-is-shared`, `anchor-ancestor-is-shared` |
| Ignore merge sources | `merge-key`, `locate-merge-key` |
| No read-back | `explicit-tag-conflict` (only that one) |
| No padding at an empty range | `empty-value`, `empty-value-before-comment`, `float-whole-over-null` |
| JSON spells Infinity | the three `json-unrepresentable*` |
| Flow rule dropped | the six flow-quoted cases, 2 property tests |
| Nothing-changed law off | `json-unchanged-string`, `unchanged-bool`, `unchanged-null-tilde`, `unchanged-spelling-kept` |
| Escapes without DEL/C1 | `escaped-del`, `escaped-nel` |

## Where Article IX, the spec or its table were silent, contradictory or wrong

1. **FR-008 and Article IX contradict the table about when a quoted scalar stays quoted.** The text says
   "written plain only if the plain form reads back ... Otherwise the style of the replaced scalar is kept",
   which reads as "plain whenever plain is safe". The table's `double-quoted-kept` (`"y"` set to `z` is `"z"`)
   and `single-quoted-kept` (`it's` is plain-safe, expected `'it''s'`) say a quoted scalar *stays* quoted. I
   followed the table: a scalar that was quoted stays in its quote style whenever that style can hold the
   value; only a non-quoted scalar is written plain. The prose needs the one-sentence fix.
2. **The article's anchor hole.** "Reached through an alias or merge key" does not cover the owner of the
   anchor: `base: &h 3.2⏎W1: *h`, setting `/base`, moves `/W1` too. The corpus's round trip (the second witness)
   found it on the first run, as `some other value changed`; byte-level L3 holds, semantic L3 does not. I refuse
   it as `edit-target-shared`, positioned at the first alias, when the value **or any container above it** is
   anchored and an alias resolves to it (`/base/h` under `base: &b` with `<<: *b` elsewhere). An anchor nothing
   uses is editable; a key that overrides a merged one is a direct pair and editable. The spec says nothing
   about any of this, and its "primary: the alias" is the only guidance for where to position it.
3. **`locate` and the refusals.** FR-001 says `locate` answers a range and kind or "diagnostics" without saying
   which; FR-009 lists refusals without saying which verb. I made `locate` succeed on a container (`mapping`/
   `sequence`) and a block scalar (`string`, 6-20 in the table's row) and refuse only absent and shared; `setValue`
   additionally refuses containers and block scalars. A container's `kind` is not in §4.1's scalar list; I used
   the node type.
4. **"Each is a diagnostic at the target's span"** (Article IX) disagrees with FR-009 for `edit-target-shared`
   (the alias) and `edit-target-absent` (the ancestor). FR-009 wins in the code.
5. **No code for "could not be written and read back".** An explicit tag (`a: !!str 3` set to `4`) is the
   case. The writer's own read-back refuses it as `edit-unsupported`. The article's list of refusals does not
   anticipate any such case; the safety net is my addition (decision 3 in `plan.md`) and it will fire on cases I
   did not think of.
6. **`edit-unrepresentable` and lone surrogates.** FR-007 names only JSON's non-finite numbers. A string with an
   unpaired surrogate has no UTF-8 spelling in either format; refused under the same code.
7. **FR-006 on a `number` over a non-numeric scalar** ("any other type ... writes its own kind") does not say
   what a number's own kind is. I took `Number.isInteger`: `5` over a string is the int `5`, `1e21` over a string
   is the int `1000000000000000000000`, `-0` over an int is `0` (and `0 === -0` in the model).
8. **L1 with `NaN`.** §4.2's equality makes `.nan` unequal to itself, so setting `NaN` over `.nan` would rewrite
   the bytes. I made `NaN` equal `NaN` for the nothing-changed law.
9. **A null with no bytes** (`a:⏎`, `a: # c`) has an empty span that touches the colon or the comment. Setting it
   at the empty range needs a space before and, before a comment, after; they are part of the edit's bytes.
   The spec did not anticipate a zero-width value.
10. **FR-008's "YAML 1.1" clause is open-ended.** The list names the Norway words and a few others. I added
    numbers with `_`, `:` or a `0b`/`0o`/`0x` prefix, dates and timestamps, `<<` and `=`, and `1.2.3`-shaped
    strings, all conservatively (a false positive costs a pair of quotes). `1.2.3` quoted is the one a user may
    notice.
11. **The probe found the reader accepting more than YAML does** in two places the writer must not lean on: a raw
    NUL and raw U+0085/U+2028 inside a plain scalar read back unchanged. They are quoted and escaped anyway.
12. **The step plan** (red cases, one step at a time) does not fit a task whose first working implementation is
    already the whole function; see above. And "extend `CITES_PATTERN`" is moot when the new corpus kind has its
    own loader.
13. **`parse` is quadratic in the number of aliases** (found while checking `setValue`'s cost, not caused by it):
    500 / 1000 / 2000 aliases to distinct anchors parse in 183 / 679 / 2599 ms. `setValue` is two parses (the
    document and the read-back), so it is about double that. It comes from `yaml`'s `Alias#resolve` walking the
    document per alias. Not fixed; the totality tests do not reach it. Worth a spec of its own.
14. **Pointer segments** `01` and `+1` for a sequence index: the writer accepts `^\d+$`, as `resolvePointer`
    does; RFC 6901 forbids leading zeros. Consistent with the reader, not with the RFC.
15. **Not done, by scope:** nothing writes a file, applies an edit, or checks a sandbox; a pinned or remote
    document is the caller's to refuse (the article says so; `locate` and `setValue` take bytes and cannot know).
