# Feature Specification: A Document's Cost Is Bounded by Its Size

**Feature Branch**: `019-bounded-cost` (committed on `main`)

**Created**: 2026-10-08

**Status**: Draft

**Input**: two findings from 018. Its implementer measured that reading a YAML document is quadratic
in its aliases; probing that, the owner's session found that alias expansion is unbounded ("billion
laughs"). Decided by the owner: fix the first at its cause, and refuse the second now, as a
correction, with a strict budget.

**Implements**: `SPEC.md` §4.2 (the hygiene bullet), §11, and §15's entry "A document's cost is
bounded by its size" (v1.10). All already written. **Do not edit `SPEC.md`.** Ships in the same
release as 018 (v1.10).

## The two defects, measured

- **Quadratic aliases.** Each alias asks `yaml`'s `Alias#resolve`, which walks the document to find
  the nearest preceding anchor of that name. With 4,000 anchors and 4,000 aliases (142 KB),
  `parseDocument` takes 0.3 s and resolving every alias 9.6 s. Callers: `src/adapters/yaml/expand.ts`
  (`resolveAlias`, `mergeSources`) and `src/adapters/yaml/write.ts` (four sites).
- **Unbounded expansion.** Cascata copies every alias's target into the tree (§4.2: the model never
  contains references). Ten aliases per level, nested: 180 bytes at three levels read in 0.02 s,
  230 bytes at four in 0.12 s, 280 bytes at five in 1.2 s. Eight levels, under 400 bytes, would run
  for hours and exhaust memory. The 8 MiB cap measures bytes and never sees it.

## Requirements

- **FR-001** **One pass.** Every alias in a document is resolved from a table of anchors built in one
  walk in document order: at each node with an anchor, the table's entry for that name becomes that
  node; at each alias, its target is the table's entry at that moment, or none (a dangling alias,
  refused as today). That is `yaml`'s own rule — the nearest preceding anchor of that name —
  computed once. Both the reader and the writer use it. **No module under `src/` calls
  `Alias#resolve`**; a sweep in `tests/unit/layering.test.ts`'s style enforces it.
- **FR-002** **The same answers.** For every alias in the conformance corpus and in a generated set —
  redefined anchors, an alias before its anchor, aliases inside anchored nodes, merge keys with one
  alias and with a list — the table's target is the node `Alias#resolve` returns. `yaml` is the
  oracle here, run in the test only.
- **FR-003** **The budget.** Let *W* be the number of model nodes (§4.1: scalars, mappings,
  sequences, the root included; keys are not nodes) the document writes, counting each alias as one
  node and each merge key's value as one. Let *E* be the number of model nodes in the expanded tree.
  A document is refused when *E* > 10 × *W* + 10,000. The count is kept as the expansion proceeds,
  so a bomb stops at the alias that crosses the budget, never after building the tree.
- **FR-004** **The refusal.** `expansion-limit-exceeded`, a resource-limit code beside
  `depth-limit-exceeded` and `size-limit-exceeded` (`src/diagnostics/codes.ts`), `level: "error"`,
  primary at the alias being expanded when the budget is crossed, message naming *E*, *W* and the
  budget. One diagnostic, then the read stops, as the other resource limits do.
- **FR-005** **Overridable.** `ParseLimits` gains `expansionRatio` (default 10) and
  `expansionAllowance` (default 10,000); the budget is `expansionRatio × W + expansionAllowance`.
  Overriding them works wherever `maxDepth` and `maxBytes` do. The defaults are named in
  `docs/reference.md` beside the other two.
- **FR-006** **JSON is unaffected**: it has no aliases. Its parse path neither counts nor refuses.
- **FR-007** **No other behavior moves.** Every existing test is unchanged. A document within the
  budget reads to the identical tree, spans and diagnostics as before.

## Conformance

Counts derived by hand; never from a run.

**The bomb at three levels** (180 bytes):
`l0: &l0 [x,x,x,x,x,x,x,x,x,x]⏎`, then `l1: &l1 [*l0, … ten times]⏎`, and the same for `l2` (aliasing
`*l1`) and `l3` (aliasing `*l2`). *W* = 1 (root) + 11 (`l0`'s sequence and ten scalars) + 3 × 11
(three sequences of ten aliases) = 45. *E* = 1 + 11 + 111 + 1,111 + 11,111 = 12,345. Budget =
10 × 45 + 10,000 = 10,450. Expanding in document order, the running count after `l2` is 1,234;
`l3`'s sequence makes 1,235, and each of its aliases adds 1,111, so the ninth alias (`/l3/8`)
crosses: 1,235 + 9 × 1,111 = 11,234 > 10,450. Expect `expansion-limit-exceeded` at that alias's
`*l2`: bytes 171–174 (line 4, column 42), counted by hand: lines of 30, 50, 50 bytes, `l3`'s first
alias at 139, each alias four bytes on.

**Sharing that passes.** A profile anchor of 20 nodes (a mapping of 19 scalars) and *N* walls, each
`{id: …, profile: *p, h: 3}`. *W* = 22 + 4*N*, *E* = 22 + 23*N*; within budget for every *N*. Test
*N* = 1,000: loads, identical tree to the same document written without aliases.

**Sharing that is refused — the strictness, named.** A 100-node anchor and a sequence of 1,000 bare
aliases to it. *W* = 1,102, *E* = 100,102, budget 21,020: refused. The same document with
`expansionRatio: 100` loads. This case documents what "strict" costs.

**Linear time.** One structural test (FR-001's sweep) and one coarse timing test: 8,000 aliases read
in under twice the time of 4,000 plus a fixed allowance, rerun-tolerant like the existing ratio
tests. The structural test is the guarantee; the timing test is the witness.

**Probe gate**: before FR-003's count is written down, check against `yaml` that a merge key's
expansion and an alias inside an anchored node are counted as the formula says — non-ASCII anchor
names, an anchor redefined between two aliases, and the five-level bomb.

**Sabotage**, each watched red and restored (back up to `/tmp`, mark `SABOTAGE`, grep before every
commit): call `Alias#resolve` again in one site (the sweep red); build the table without
redefinition (the redefined-anchor oracle case red); count after expansion instead of during (the
bomb test red on time, or on the diagnostic's position); ratio 100 by default (the strictness case
red); count keys as nodes (the three-level bomb's position red).

## Out of scope

Sharing nodes instead of copying them (it would defer the blowup to merge and validation, which walk
the tree); a cap on alias count alone; JSON.

## Plan and tasks

One plan file. Commit each step the moment `pnpm typecheck && pnpm test` is green:

1. **The table** — FR-001, FR-002; the sweep and the oracle cases.
2. **The budget** — FR-003 to FR-006; the three counted cases, the timing witness.
3. **Docs and report** — `docs/reference.md`'s limits, the code's contract row,
   `specs/019-bounded-cost/report.md`.

Do not bump the version. Check every sentence of §4.2, §11 and the §15 entry against the code, and
report each disagreement unsoftened.
