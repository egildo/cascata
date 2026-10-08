# Report: After the Review (v1.12, specs/022-after-the-review)

Tests: main 2981 → 3116 (101 → 105 files), timing 10 → 14 (7 → 8 files). `pnpm typecheck` clean.
`SPEC.md` untouched, nothing pushed, no version bump. Existing tests changed: listed under "Tests changed, and why".

## Commits

| Hash | Subject |
|---|---|
| 40f9545 | perf(022): columns are two lookups, and a tree's pointers are indexed once (FR-001 to FR-004) |
| ba465df | feat(022): sharedEdits, and a file grafted twice is shared (FR-005 to FR-008) |
| 699c9d0 | fix(022): the shared read-back checks every copy the reader saw before the edit (FR-007, found by sabotage) |
| a26d139 | fix(022): three slips — an empty document after its marks, a bare `? a`, a tag that cannot hold its value (FR-009 to FR-011) |
| (step 4) | docs(022): the sweep, the report, the handoff (FR-012, FR-013) |

## What was built, per FR

- **FR-001.** `src/adapters/yaml/parse.ts` `buildOffsetTables(text)` builds the byte table and a column table in
  one pass; `codePointColumn(columnTable, lineStart, target)` is `columns[target] − columns[lineStart] + 1`. The
  mark at stored index 0 is left out of the column table itself rather than subtracted afterwards (ambiguity 1).
  `buildColumnTable` is exported for its witness only.
- **FR-002.** The probe table (below), run against the counting `codePointColumn` before it was replaced; it is
  now the permanent witness `tests/unit/columns.test.ts`.
- **FR-003.** `src/model/pointer.ts`: one index per tree root in a module-level `WeakMap`, built on first use by
  one iterative walk; per origin id its label, and per `start:end` the pointers in walk order.
  `pointersInDocument` keeps its signature, answers and `limit`; `pointersAt(root, originId, start, end)` and
  `originsInTree(root)` are the by-location door FR-006 needs; `pointerIndexBuilds()` is the counted witness.
  `why()` and `editTarget()` changed no code for it; `MergedConfiguration` gained nothing.
- **FR-004.** Main suite: `columns.test.ts` (the FR-002 table, and the column table itself for
  `"\uFEFFa😀\u0301\uFEFFb"` and `"a\nbc"`, counted by hand) and `pointer-index.test.ts` (an anchor and two
  aliases → `/a`, `/b`, `/c`; `limit`; the unchanged tie-break; one build for many questions; one build per layer
  for `why()` and `editTarget()` on 200 keys). Timing: `tests/timing/after-the-review.timing.test.ts` — one line
  of 10,000 flow items vs 40,000, 10,000 aliases to one anchor on one line vs 40,000, `why()` and `editTarget()` on
  every key of 6,000 vs 24,000 keys; each 4N run under 8× its N run. Measured green: lines ~2-3×, keys ~5×.
- **FR-005.** `SharedEdits = "refuse" | "warn" | "allow"` (`src/adapters/edit.ts`); `EditOptions.sharedEdits`
  (`setValue`; `locate` accepts it and calls the finder with `"refuse"`); `editTarget(configuration, pointer,
  { sharedEdits })` (`EditTargetOptions`); `yamlWriter(options?)`/`jsonWriter(options?)` (`WriterOptions`). Every
  `ok` result of `setValue`, `editTarget` and a writer's `write` carries `diagnostics`: empty under `"refuse"` and
  `"allow"`; under `"warn"` one `edit-target-shared` at `level: "info"`, primary at the value, `related` naming
  every alias whose expansion holds it (writer) or every other copy and graft (editTarget). An unknown policy
  throws (ambiguity 15).
- **FR-006.** `editTarget` counts copies in the value's own document and in every other origin whose location is
  the same file, across all layers: a graft (`delegationBreadcrumbs` has its id; its label is the location) or a
  layer read from that file (ambiguity 7). Under `"refuse"`: `edit-target-shared`, primary at the value, `related`
  naming each other graft's delegating value, the message naming every place the file is read.
- **FR-007.** Under `"warn"`/`"allow"`, `findYaml` resolves the final alias too and answers the anchored node's
  range; `editTarget` answers `pointerInDocument`'s tie-break. The read-back checks the pointer asked about and
  every pointer that held the value's bytes in the reader's model *before* the edit (`Found.copies`) — see
  sabotage B2/B5 for why "before".
- **FR-008.** `SharedEdits`, `EditTargetOptions` from `@egildo/cascata`; `SharedEdits`, `WriterOptions` from
  `@egildo/cascata/writers`; `docs/reference.md` "v1.12 — shared edits" and the `info` reading in both code tables;
  `src/diagnostics/codes.ts`'s contract comment.
- **FR-009.** The empty document's null sits after the last prefix mark (`EF BB BF` → `3..3`; mark + `# c\n` →
  `3..3`; no mark → `0..0`). `yamlPadding` adds no space after a mark.
- **FR-010.** `nullAfterKey` in `parse.ts`: a pair with no value node reads as a null at the end of its key,
  counted and depth-checked like a built value. The writer's "null value" branch answers
  `bareKey.indicator = "\n" + " ".repeat(mapColumn − 1) + ": "`, or `undefined` in flow (refused).
- **FR-011.** `Found.tag = { holds, drop? }`; `tagOnLine` scans back along the value's line over at most two
  properties (`!tag`, `&anchor`, either order) and accepts the token only if it spells the tag `yaml` resolved
  (`!!x` or `!<uri>`). Where the tag cannot hold the kind written, the edit starts at the tag and its bytes are
  whatever sat between the tag's blanks and the value (an anchor) followed by the new text.
- **FR-012.** HANDOFF's open-edges line rewritten (block scalars, a flow bare key, an off-line tag; no longer
  shared values); `docs/reference.md`'s `locate`/`setValue` and `parse` contracts now say they throw on an internal
  inconsistency, which is a bug to report; the `unescapePointerSegment` re-export in `src/adapters/json/write.ts`
  is gone; `outcomeRootSpan` and `withPointer`'s `?? mergedPointer` are kept, each commented as a guard with the
  reason it is unreachable (a probe over the 020 fixture never reached the fallback; that is evidence, not proof);
  the "null value" branch is live. The bounded-cost rows are in the stale-spec list below.
- **FR-013.** The sweep table below.

## The probe gate (FR-002)

Run against the counting `codePointColumn` at 1522598, before FR-001 was written. Every row was derived by hand
first; every row matched on the first run.

| Input | Pointer | Hand-derived [start, end, line, column] | Counting code answered |
|---|---|---|---|
| `a: [😀, x]\n` (astral) | `/a/0` | 4, 8, 1, 5 | 4, 8, 1, 5 |
| same | `/a/1` | 10, 11, 1, 8 | 10, 11, 1, 8 |
| `a: [e\u0301, x]\n` (combining) | `/a/1` | 9, 10, 1, 9 | 9, 10, 1, 9 |
| `\uFEFFa: [b, c]\n` (mark at 0) | `""` | 3, 12, 1, 1 | 3, 12, 1, 1 |
| same | `/a/1` | 10, 11, 1, 8 | 10, 11, 1, 8 |
| `a: ["\uFEFF", x]\n` (mark mid-line) | `/a/1` | 11, 12, 1, 10 | 11, 12, 1, 10 |
| `\uFEFF\uFEFFa: 1\n` (second prefix mark) | `/a` | 9, 10, 1, 5 | 9, 10, 1, 5 |
| `a: 1\r\nb: [x, y]\r\n` (CRLF) | `/b/1` | 13, 14, 2, 8 | 13, 14, 2, 8 |
| same | `/b` | 9, 15, 2, 4 | 9, 15, 2, 4 |
| `a: 1\rb: [x, y]\r` (lone CR) | `/b/1` | 12, 13, 2, 8 | 12, 13, 2, 8 |
| `a: 1\n\nb: [x, y]\n` (empty line) | `/b/1` | 13, 14, 3, 8 | 13, 14, 3, 8 |
| `a: 1\nb: [x, y]` (no final break) | `/b/1` | 12, 13, 2, 8 | 12, 13, 2, 8 |

My one wrong hand count here: the root mapping's end, first written 13; it is 12 (`[b, c]` is bytes 6-11). Caught
before the run, on recount.

## Sabotage

Each run: `src` and `tests` backed up to `/tmp/cascata-022/backup`, one replacement marked `SABOTAGE`, the named
tests run, the file restored, `diff -r` clean and `grep -rn SABOTAGE src/ tests/` empty after every run (driver
`/tmp/cascata-022/sab.py`, logs `partA.log`, `partB.log`, `partB2.log`, `partC.log`, `partC2.log`).

| # | Sabotage | Result |
|---|---|---|
| A1 (spec) | `codePointColumn` counts from the line's start again | Main suite **green** (columns, stored-bytes, the whole corpus: 583), as the spec says. Timing **red**: 10,000 items 1,383 ms vs 40,000 items 23,470 ms (17.0×; `yaml` 39 vs 147 ms), aliases 436 vs 6,394 ms (14.7×) |
| A3 (mine) | the pointer index is never cached | Main: `pointer-index` red ("one build" 4 ≠ 1, "one per layer" 400 ≠ 1); `why-pointer`, `edit-target` green. Timing: `why()` on every key **red**, 6,000 keys 8,177 ms vs 24,000 keys 210,206 ms (25.7×). The run took 694 s: the test's 300 s timeout cannot interrupt a synchronous loop, so a red-phase run of this file must be backgrounded, not trusted to time out |
| B1 (spec, "key the index by origin id only") | `editTarget` compares origin ids instead of locations when looking for other places | 3 red: both refuse rows and the warn row of the graft table |
| B2 (spec) | under `"allow"` the writer stops at the alias | First run: red only on the corpus's hand-counted range (17-19 vs 9-12) and the unit test — **the read-back passed**. That exposed B5. After 699c9d0: red **on the read-back** (`edit-unsupported` at 17-19), as the spec predicts, 4 tests |
| B3 (mine) | `"warn"` produces no `info` | 5 red (3 corpus warn cases, 2 unit) |
| B4 (mine) | `aliasesHolding` not transitive | 1 red (the container-alias case: `[[25,27]]` vs `[[19,21],[25,27]]`) |
| B5 (mine) | the read-back checks only the pointer asked about | **Green**, before and after the fix. A net with nothing to catch while the writer is right; its value was shown by B2 |
| B6 (mine) | `editTarget` refuses shared values under every policy | 4 red |
| B7 (mine) | `editTarget` names no in-document copy | 4 red, including three existing v1.11 shared rows (the copies then count as unshared) |
| C1 (spec) | the empty document's null back at 0 | 2 unit + 4 corpus red (the mark cases; `set` red on the read-back, `edit-unsupported` at 0-0) |
| C2 (spec) | drop the inserted `: ` | 3 red, on the read-back |
| C3 (spec) | keep the tag always | 7 red. `!!int` set `"x"` (and the long form, and both anchor cases) red **only on the named bytes** among the old witnesses — Cascata's read-back reads `!!int x` as the string `x`. The kind-changing cases (`!!int` set 2.5, `!!str` set 4) red on the read-back. The off-line-tag refusal case red (answered). I added a third witness to the runner (`yaml` raises no `TAG_RESOLVE_FAILED`); with the bytes out of the way (C9b) it reports "the edited document carries a tag that cannot hold its value" for `!!int x` |
| C4 (mine) | the reader drops a bare key again | 10 red |
| C5 (mine) | a space after the mark, as before | 2 red (`expected "1", got " 1"`). My first attempt at this sabotage disabled all leading padding instead and reddened two unrelated v1.10 cases; redone |
| C6 (mine) | bare-key indentation always zero | 2 red (nested and in-sequence), on the read-back |
| C7 (mine) | the tag drop does not carry an anchor after the tag | **Green** — the variable it sabotaged was redundant (the anchor always starts where the tag's blanks end). Removed it |
| C8 (mine) | a flow bare key is spelled instead of refused | **Green** — the read-back refuses the spelled edit with the same code. The explicit refusal only gives a better message |

## Tests changed, and why

- `tests/unit/edit-target.test.ts`: 15 `toEqual` expectations of an `ok` result gain `diagnostics: []`. FR-005
  adds the field to every `ok` result; the assertion is otherwise unchanged and is no weaker.
- `tests/unit/writers.test.ts`: the two shape rows gain `diagnostics: []` (same reason). The equivalence loop over
  every write case now makes the writer and the direct call under the case's own `sharedEdits`, and compares
  `diagnostics` with origins stripped, since the writer's origin is synthetic. Stronger than before (the shared
  cases are now compared under their policy).
- `tests/corpus/write-cases/explicit-tag-conflict.json`: was `v1.10 FR-004`, `!!str 3` set 4 refused
  `edit-unsupported` at 9-10. FR-011 mandates the opposite (`set 4 drops it`), so it now expects the edit 3..10 →
  `4` and cites `v1.12 FR-011`. This is a change of an existing expectation forced by the spec; flagged.
- `tests/corpus/write-case.ts`: `CITES_PATTERN` admits `v1.12`; a case may carry `sharedEdits`.
- `tests/corpus/write-runner.ts`: checks the policy's diagnostics; under `"warn"`/`"allow"` excludes the copies of
  the value from L3's "nothing else changed" and requires each to read the value; under `"refuse"` an answered
  edit of a value with copies is a failure; L3's range check accepts an edit widened leftwards over exactly a tag
  and its blanks (with an anchor carried); and a third witness, `yaml`'s `TAG_RESOLVE_FAILED`. The only loosening
  is the tag widening, which FR-011 requires.
- `tests/corpus/write-corpus.test.ts`: the `describe` name says "(v1.10, v1.12)".

## The sweep (FR-013)

Five read-only passes (README + CLAUDE.md Known traps; `docs/reference.md` 1-520, 520-1020, 1020-end; `codes.ts`
contract comments + `specs/HANDOFF.md`), each claim checked against `src/` and `tests/`, doubtful ones probed in
scratch scripts outside the repo. The table lists **every stale or unverifiable claim in full**; claims that hold
are grouped by section, each group with the tests that prove it (a row per sentence would be some 250 rows of
"holds"). "Action" is what this commit did.

### Stale claims

| Claim | Where (before this commit) | Proving test, or none | Action |
|---|---|---|---|
| `demand` keywords listed without `minLength`/`maxLength`/`accept` | README.md:116 | `src/validate/vocabulary.ts` `DEMAND_KEYWORDS`; validate-cases T015a, T029 | fixed |
| Exports omit `@egildo/cascata/writers` (stale since v1.11) | README.md:180 | `writers.test.ts` › "package.json exports ./writers and ./writers.js, as paths has" | fixed |
| "Not in v1: editing configuration files" (stale since v1.10) | README.md:204 | write corpus; `write-value.test.ts`; `edit-target.test.ts` | fixed: "rewriting whole configuration files (one value at a time is Article IX)" |
| `pnpm test` = corpus + unit suite (omits the timing project) | README.md:210 | package.json `test` | fixed |
| "Each corpus loader gates `cites` by version (`{resolve,merge,validate}-case.ts`)" — omits `write-case.ts`; `case.ts` gates by `§` | CLAUDE.md:139-141 | `tests/corpus/write-case.ts:47` | **reported, not edited**: CLAUDE.md is project instructions; changing it is the owner's call. Suggested: "`tests/corpus/{resolve,merge,validate,write}-case.ts` by version; `case.ts` by `§`" |
| Examples import from `"cascata"`, `"cascata/host/node"`, `cascata/generate`, `cascata/paths` (the package is `@egildo/cascata` since v1.8.1) | reference.md 18 sites, :45, :1087, :1103, :1164 | none | fixed, every site |
| "Full detail lives in specs/001 through specs/016" | reference.md:53 | — | fixed (022) |
| Diagnostic shape omits `level` (v0.7) and `delegatedFrom` (v0.6) | reference.md:191 | `diagnostic-levels.test.ts` | fixed |
| References are local paths or `https://` (omits `Host.locate` schemes, v1.4) | reference.md:228 | `host-identity.test.ts`; resolve-cases host-identity-adopts | fixed |
| `resolve(…, { sandboxRoot })` examples with no `host` (throws "requires 'host'") | reference.md:238, :424, :606 | `host-in-memory.test.ts` › "throws synchronously before any host method is ever called" | fixed (`host: createNodeHost()`) |
| `options.cacheDir` on `resolve()` (moved to `createNodeHost({ cacheDir })` in v0.7) | reference.md:265-268 | none (`src/index.ts:212` comment records the move) | fixed: `options.host` documented instead |
| `options.transport`: "omit it for the real network" (no default since v0.7; throws) | reference.md:269-271 | none (probe: "requires 'transport'") | fixed |
| `ResolveResult` ok = `{graph, pedigree}` (also `delegationBreadcrumbs`, `paths`, `diagnostics`) | reference.md:279 | none (type in `src/index.ts:323`) | fixed |
| resolve contract 1: throws for missing `sandboxRoot` or `cacheDir` | reference.md:285-287 | `host-in-memory.test.ts` › "throws for a malformed host…" | fixed (host, transport) |
| `Reference.kind` omits `"override"` (v1.6) | reference.md:301 | `src/model/reference.ts:23` | fixed |
| `PedigreeEntry` omits `finalAgainstForking` (v0.7) | reference.md:311-315 | `src/graph/pedigree.ts:38` | fixed |
| `document-unreachable` includes "timed out" (a remote timeout falls back to cache or is `document-not-cached`) | reference.md:328 | `remote-offline.test.ts` | fixed |
| `unsupported-scheme` for any non-HTTPS scheme (not when `Host.locate` claims it) | reference.md:332 | `host-identity.test.ts` | fixed |
| "Local delegation reads still go through `node:fs` directly" (through `host.read` since v0.7) | reference.md:383-384 | `layering.test.ts` (no `node:fs` outside the Node host) | fixed |
| `MergeResult` ok omits `diagnostics` (v1.8); `ok: false` only for merge policy (also `final-key-redeclared`, v0.7) | reference.md:438-440 | `append-scalar.test.ts`; `final.test.ts` | fixed |
| "`editTarget` refuses such a value instead" (only under the default policy, v1.12) | reference.md:523 | `shared-edits.test.ts` | fixed |
| `MergedConfiguration` omits `delegationBreadcrumbs`, `finalState`, `paths?` | reference.md:549-554 | none (type in `src/merge/provenance.ts`) | fixed |
| `ValidateResult` ok omits `diagnostics` (v0.7 FR-002) | reference.md:624 | `load.test.ts` (required-vacuous lint) | fixed |
| Type-collision path "implemented, correctly generalized" (both functions return `[]` unconditionally) | reference.md:723-727 | none | fixed. The same words in the `src/validate/types.ts:25` comment are stale too: **reported, not edited** (outside the sweep's list) |
| "The generator has no expected outputs written by hand" (unit tests pin rows by hand) | reference.md:1174 | `generate-shapes.test.ts` | fixed |
| `setValue`/writer/`editTarget` example results without `diagnostics` (v1.12) | reference.md:1338, 1346, 1399-1404, 1441 | `shared-edits.test.ts`, `edit-target.test.ts` | fixed |
| `locate`/`setValue` throw only for origin, format, pointer, non-scalar (also a bad `sharedEdits`, and the internal-error guards) | reference.md:1347-1349 | `write-value.test.ts`; `shared-edits.test.ts` › "a policy that is none of the three…" | fixed (FR-012 wording) |
| `parse` "never throws… exceptions reserved for a missing origin" (the reader keeps `Internal error` guards) | reference.md:132-133 | `totality.test.ts` | fixed (FR-012 wording) |
| Law 3: the range is exactly the value's span (a dropped tag widens it, v1.12) | reference.md:1357 | write-cases `tag-int-to-string-dropped` | fixed |
| "An explicit `!!str` tag over a number… is refused" | reference.md:1374 | write-case `explicit-tag-conflict` (now an edit) | fixed |
| `edit-unsupported` row omits the flow bare key and the off-line tag | reference.md:1385 | write-cases `flow-key-without-value-refused`, `tag-on-another-line-refused` | fixed |
| `editTarget` "throws only for a malformed pointer" (also a bad `sharedEdits`) | reference.md:1411 | `shared-edits.test.ts` | fixed |
| "(the writer refuses the same alias copies)" — only under refuse | reference.md:1425 | write-case `shared-alias-allow` | fixed |
| "the default is what the law was" / "refuse: v1.11's behaviour" — v1.11 answered a twice-grafted value; the default now refuses it | reference.md:1453, 1474 (my own v1.12 text) | `shared-edits.test.ts` › "/levels/L1/elevation under refuse…" | fixed. **The same sentence is in SPEC.md Article IX**: see stale SPEC rows |
| `edit-unsupported` contract: "(an explicit tag that disagrees with the value)" | codes.ts:293-296 | write-case `explicit-tag-conflict` | fixed |
| `editTarget`'s other refusals are "`edit-target-absent` and `edit-unsupported`" (also `edit-target-shared` since v1.11 round 2) | codes.ts:310-311 | `edit-target.test.ts` shared rows | fixed |
| `edit-target-shared` contract: alias or merge key only, at the alias | codes.ts:290-292 | `shared-edits.test.ts`; write-cases `anchor-owner-is-shared` | fixed (step 2) |
| HANDOFF: "`editTarget` answers ok for a value the writer will refuse (shared, block scalar)" | specs/HANDOFF.md (020 addendum) | `edit-target.test.ts` shared rows; `shared-edits.test.ts` | fixed (HANDOFF rewritten; open edges now: block scalar, flow bare key, off-line tag) |
| HANDOFF: the "null value" branch of `findYaml` untested/unreachable | specs/HANDOFF.md open edges | write-cases `explicit-key-*` | fixed (now live and tested) |
| HANDOFF: the `onDocument` hook, writer and anchor descriptions predating v1.12 (`sharedBy` refusal only, no `aliasesTo`, no column table) | specs/HANDOFF.md | — | fixed (rewritten) |
| `unimplemented-demand-keyword`/`-types-section`: "`accept`, `format`, `types:` arrive in v0.5" (both unreachable since v0.5; `format` dropped) | codes.ts:78-82 | `vocabulary.ts:95` (empty set); validate-case T042 (`format` is unknown) | fixed |
| `type-name-collision`: "collision is unconditional, including a redeclaration that looks like narrowing" (a redeclaration is a narrowing; neither code is emitted) | codes.ts:118-122 | validate-case T034 (expects `ok: true`) | fixed |
| `emit-identifier-collision` example `a-b` and `a_b` (they do not collide; the test uses `a-b` and `a b`) | codes.ts:255 | `generate-types.test.ts` › "row 3 — two names escaping to one identifier are an ERROR…" | fixed |
| Orphan doc comment "Every stable diagnostic code… v0.6 only appends" above the overrides block | codes.ts:266 | — | fixed: moved onto `DIAGNOSTIC_CODES` |
| Edit codes "all `error`, only from `locate` and `setValue`" (`info` under warn; `editTarget` raises three of them) | codes.ts:285-286 | `shared-edits.test.ts`; `edit-target.test.ts` | fixed |
| `edit-target-shared` from `editTarget`: "grafted at more than one place" (also a layer that is also grafted) | codes.ts:291-293 (my step-2 text) | `shared-edits.test.ts` › "a file read as an override and also delegated to (by itself)…" | fixed |
| `edit-unsupported` list omits a bare key in a shared mapping and `editTarget`'s no-writer format | codes.ts:298-303 | none for either | fixed (and listed as untested in HANDOFF) |
| HANDOFF: "pointer segments `01` and `+1` are accepted" (`+1` is rejected by `^\d+$`) | specs/HANDOFF.md (020 text, carried over) | none | fixed |
| HANDOFF (my draft): "`diagnostics: []` added to 15 rows" (17 existing rows) | specs/HANDOFF.md | `git show ba465df` | fixed |
| Comments outside the sweep's list: `src/validate/types.ts` "correctly generalized"; `src/adapters/yaml/anchors.ts` names `layering.test.ts` for the `Alias#resolve` sweep (it is `anchor-table.test.ts`); `src/model/pointer.ts` "a caller that writes must not use this" (`editTarget` now does, by FR-007); the remote-delegation throw in `src/index.ts` says "requires 'cacheDir'" | those files | — | **reported, not edited** (recorded in HANDOFF's open edges) |

### Unverifiable (design statements; no test can hold them)

| Claim | Where | Note |
|---|---|---|
| Subsumption between schemas is decidable; schemas compare without running anything | README.md:112, 123 | design rationale |
| "Every empirical claim is sabotage-tested" | README.md:215 | process |
| The fold visits each node once per layer; the precedence rules are total, with no ties | reference.md:446, :473 | no counted witness |
| A declaration-set memo is needed or the two-layer case does not terminate | reference.md:1091 | counterfactual half; the terminating half is `accumulate.test.ts` |

### Claims that hold, by section, with their tests

| Section | Proving tests |
|---|---|
| README: one dependency, no I/O, monotone, provenance, self-hosting, types, format-blind, the "Sixty seconds" example (value, `why`, the two diagnostics — run end to end by a probe), host boundary, pins, HTTPS, RFC 9111, sandbox roots, remote delegation opt-in | `layering.test.ts`, `monotonicity.test.ts`, `why-pointer.test.ts`, `metaschema.test.ts`, `generate-oracle.test.ts`, `json-yaml-parity.test.ts`, validate-case T028, `remote-pin`/`remote-fetch`/`remote-redirect`/`remote-cache-revalidation`, `sandbox-roots`, `delegation-remote` |
| CLAUDE.md Known traps (17 of 18) | `columns.test.ts`, `freeze.test.ts`, `stored-bytes.test.ts`, corpus `non-string-keys/*`, `tags/*`, `alias-cycles/*`, `encoding/*`, `anchor-table.test.ts`, `duplicate-keys.test.ts`, `bounded-cost.test.ts`, `value-view.test.ts`, `numeric-projection.test.ts`, `generate-shapes/leaves/types/oracle`; language facts by probe |
| reference.md `parse` (limits, depth, budget, contract 2-6), the model, positions, v0.1 codes, `parseText` | `totality`, `determinism`, `freeze`, `bounded-cost`, `entry-parity`, `stored-bytes`, `columns`, corpus `limits/*`, `encoding/*`, `duplicate-keys/*`, `multi-violation/*` |
| reference.md `resolve` (sandbox, pins, chain limit, fetch limits, determinism, offline), v0.2 codes, delegation and v0.6 codes | `sandbox-roots`, `sandbox-escape`, `remote-*`, `resolve-determinism`, resolve-cases `fail-*`, validate-cases T014-T038, `delegation-*` |
| reference.md merge, `why()` (incl. the v1.11 `pointer`, now from the index), v0.3 codes, append-scalar | `fold`, `merge-determinism`, `merged-invariants`, merge-cases T012-T053, `append-scalar`, `why-pointer`, `pointer-index` |
| reference.md validate, demand vocabulary, named types, seal/final/authority, host, launching schema, overrides, paths, locate, sandbox roots, load, values, recursion, directives, meta-schema, project | validate-cases T003-T055, `typeexpr`, `validate-*`, `seal`, `final`, `authority`, `host-in-memory`, `launching-schema`, `overrides`, `paths`, `host-identity`, `load`, `guarded-recursion`, `directives`, `metaschema*`, `value-view`, `numeric-projection` |
| reference.md precision lint, load<T>, sections, composition bound, accumulate/generate, JSON adapter | `numeric-projection`, `load-typed`, `sections`, `composition-bound`, `accumulate`, `generate-*`, `doc-examples`, `json-adapter`, corpus `json-*`, `coverage` |
| codes.ts contract comments (merge, append-scalar, vocabulary, delegation, sealing, sections, precision, generator, overrides, edit and edit-target codes as corrected) | merge-cases T051, T052b; `append-scalar`; validate-cases T011c, T017, T034-T055, T100-T104; `delegate-lint`; `final`; `seal`; `sections`; `numeric-projection`; `accumulate`; `generate-*`; `overrides`; `edit-target`; `shared-edits`; the write corpus |
| specs/HANDOFF.md (as rewritten): positions, the hook, bare keys, writers, shared values, the index, anchors, corpus kinds, traps, open edges | `stored-bytes`, `columns`, `edges`, `pointer-index`, `anchor-table`, `duplicate-keys`, `shared-edits`, `writers`, the write corpus, `validate-totality`, `doc-examples` |
| reference.md v1.10/v1.11/v1.12 writing (laws 1-2, kind, spelling, quoting, codes, editTarget rows, writers, sharedEdits) | the write corpus (205 cases), `writers.test.ts`, `edit-target.test.ts`, `shared-edits.test.ts`, `edges.test.ts` |

Untested though true by probe: a merge-folded mapping's depth (reference.md:120); the missing-`origin` throw
(:133); `type: url` has no scheme restriction; `load()` runs no meta-validation; `certified` is the input itself;
`Host`/`HostReadResult` exported from the root; a launching schema's `~/` expansion.

### Stale `SPEC.md` sentences (reported, not edited)

| Sentence | Where | Why stale |
|---|---|---|
| "(v1.12, an addition: the default is what the law was.)" | §19 Article IX, the shared-value law | Under the default, `editTarget` now refuses a value whose file is delegated to at two places, which v1.11 answered `ok`. It refuses something it accepted. Defensible as a correction (the law already called such a value shared, and the hazard is the alias one), but it is not "what the law was". The governance call is the owner's |
| §15's v1.12 entry: "**The one bounded change of behavior**, named: `? a` now reads as a mapping with `a: null`" | §15, v1.12 | `{a}` in a flow mapping changes the same way (the same AST shape); it reads `{a: null}` where it read `{}` |
| §15's v1.10 correction: "one line of 40,000 items took sixty times longer than the same items on 40,000 lines" | §15, v1.10 entry | The issue's own numbers are 6.27 s / 0.16 s ≈ 39×. Not re-measured here on 40,000 lines |
| `specs/019-bounded-cost/spec.md`: the bounded-cost claim | past milestone's spec | Did not hold for line length or for asking `why()`/`editTarget()` of every value (issues #9, #10). FR-012 names only §15, which now carries the correction; the 019 spec is a historical record, so it is left as written |

## Ambiguities, unsoftened

1. FR-001's formula ("less one when the line starts at 0 with a mark") gives column 0 when the target is index 0. I left the index-0 mark out of the table instead. The two agree wherever a span can start; such a target never occurs (`storedIndexer` maps every parser index past the prefix).
2. FR-004 asks for pointers "in document order", but FR-003 requires the old walk order, which sorts keys. I test walk order (`b, a, c` in the document answers `/a, /b, /c`).
3. The FR-004 timing shape is invented. I assert 4N under 8× N, and print `yaml`'s time beside it without asserting on it. `why()`/`editTarget()` needed 6,000 and 24,000 keys, each attempt on a fresh configuration: at 2,000 keys noise made it about 8× once. The margin is about 5×.
4. "`locate` accepts and ignores `sharedEdits`" means a writer's `locate` refuses an alias copy that its `write` will write under "allow".
5. Copies of a value share one span, so `editTarget`'s `related` spans for in-document copies are identical to the primary. I label each with its pointer.
6. FR-006 says "the message and related name each grafting place", while the table names only the other graft. I put only the other places in `related` and every place in the message.
7. I extended "grafted twice" to a file that is both a layer and a graft (reachable when an override delegates to itself). Nested grafts are untested.
8. FR-007's read-back "at every related place" was vacuous as I first built it, because copies are one AST node. It now uses the model's copies from before the edit.
9. FR-010 also changes `{a}` in flow, which now reads `{a: null}`. §15's v1.12 entry names only `? a` as the one bounded change of behaviour, so it undercounts.
10. Invented for FR-010: a bare key inside a shared mapping is refused `edit-unsupported` under "warn"/"allow"; the indentation is the `?` column; `- ? a` gets two spaces.
11. FR-011 says the tag is "3..8 including its space", but 3..8 excludes the space at 8; with it, it is 3..9. The edit 3..10 is right.
12. Invented for FR-011: the tag is found by scanning back along the value's own line, because `yaml` gives no tag range. A tag on an earlier line, or a `%TAG` handle, makes the edit `edit-unsupported` when the tag must be dropped. A kept `!!str` does not relax quoting (`!!str "4"`).
13. The spec's sabotage note says "only the read-back catches it", but Cascata's read-back does not catch `!!int x`. That is why I added the `yaml` witness.
14. FR-009 copies the comment padding, but `yamlPadding` would also add a space after the mark. I excluded the mark.
15. An unknown `sharedEdits` value throws; this is invented. `WriterWriteResult` takes its diagnostics type through `Extract<SetValueResult, …>` so that `writers.ts`'s import-list test stays unchanged.
16. Issue #13 also asks for the 019 spec's bounded-cost claim to be fixed. FR-012 names only §15, so specs/019 is untouched.
17. §15's v1.10 correction says "sixty times"; the issue's own table gives 6.27 s against 0.16 s, about 39×.
18. My own wrong hand counts: a root mapping end (13, should be 12) and `./more.yaml` (28..39, should be 27..38). The runs caught both.
19. **Found by the sweep, about `SPEC.md` itself.** Article IX's v1.12 note says "an addition: the default is what the law was." It is not: under the default `"refuse"`, `editTarget` now refuses a value whose file is delegated to at two places, and v1.11.1 answered that value `ok`. That is a rule refusing what it accepted, which §15's freeze reading calls v2.0 unless it is a correction. I believe it is a correction (Article IX already called such a value shared in substance; the hazard is the alias one). But the article labels it an addition with an unchanged default, and the owner should rule. The same goes for the layer-and-graft case I added (ambiguity 7).
20. "Nothing else moves to the policy" (FR-005) is not quite true of what I built. A bare key inside a shared mapping is answered or refused depending on the policy: under `"refuse"` it is `edit-target-shared`; under `"warn"`/`"allow"` it is `edit-unsupported` (ambiguity 10).
21. The sweep found much more staleness than the three items FR-012 named, and most of it predates 022. In `docs/reference.md`: the bare `cascata` package specifier (renamed `@egildo/cascata` in v1.8.1), `resolve()` examples with no `host` (required since v0.7), `options.cacheDir` (moved to the host in v0.7), the `transport` default, and the result shapes of `resolve`/`merge`/`validate`, which have carried `diagnostics` since v0.7/v1.8. The rest: the README's demand list and exports; four contract comments in `codes.ts`; one HANDOFF line carried over from 020. All are fixed in this commit, so the derived artifacts had been drifting for six releases. One stale sentence is in `CLAUDE.md`'s Known traps (the corpus-loader list omits `write-case.ts`). I have **not** edited `CLAUDE.md`: it is the owner's instructions file, and changing it is not an implementer's call. The suggested wording is in the sweep table.
22. FR-013 asks for every sentence that states a behaviour. The table lists every stale and unverifiable claim in full, and groups the claims that hold by section with their proving tests (about 250 rows otherwise). The five per-section passes were done by read-only subagents and checked by me where I acted on them; every "fixed" row I verified against the code before editing.
23. Four stale code comments are outside FR-013's list (`src/validate/types.ts`, `src/adapters/yaml/anchors.ts`, `src/model/pointer.ts`, and a throw message in `src/index.ts` that still says `cacheDir`). I reported them in HANDOFF and did not fix them: they are outside the named sweep and one is a runtime message.
24. The sweep also listed true-but-untested claims (see the sweep section). None is a v1.12 law except the bare key in a shared mapping and the `%TAG` tag; neither has a test.
