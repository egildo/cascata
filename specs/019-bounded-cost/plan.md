# Implementation Plan: A Document's Cost Is Bounded by Its Size

**Spec**: [spec.md](./spec.md) · **Implements**: `SPEC.md` §4.2 (hygiene), §11, §15 "A document's cost is bounded by its size" (v1.10)

**Complexity Tracking note**: one plan file on the 012-018 precedent. No new public function; one new
code, two new `ParseLimits` fields, one new module for each half.

## Approach

| FR | Where | How |
|---|---|---|
| FR-001 | `src/adapters/yaml/anchors.ts` | `buildAnchorTable(doc)`: one iterative walk in `visit`'s order (a pair's key before its value, a node before its children), a map from name to the node that holds it *now*, and at each alias a lookup. The reader (`parse.ts` → `expand.ts`) and the 018 writer (`write.ts`, through the `onDocument` hook) both use it. `expand.ts` keeps the one documented cast on `yaml`'s own AST types. |
| FR-002 | `tests/unit/anchor-table.test.ts` | `Alias#resolve` is the oracle, in the test only: 16 hand cases, every YAML document and fixture of the corpus, and 400 seeded random documents. |
| FR-001 sweep | same file | No file under `src/adapters/` contains `.resolve(`; none under `src/` calls it with a document. |
| FR-003 | `src/adapters/yaml/budget.ts` (`countWritten`, W), `parse.ts` (E) | W is counted from the AST before the walk; E is counted as the walk builds each model node (`walkAnchoredTarget`), including those an alias or a merge key causes. Past `ratio × W + allowance`, the walk throws a private sentinel caught once in `parseYaml`. |
| FR-004 | `limits.ts` (`expansionLimitDiagnostic`), `codes.ts` | One diagnostic at the **outermost** alias being expanded (for a merge key, its value). |
| FR-005 | `limits.ts` | `expansionRatio: 10`, `expansionAllowance: 10_000`. |
| FR-006 | | `parseJsonBytes` ignores the new fields. |

## Decisions the spec left open

1. **The diagnostic points at the outermost alias**, the one the author wrote at the top of the expansion.
   The spec's counted position (bytes 171-174, the ninth `*l2` of `l3`) is that; the crossing itself happens
   inside the expansion of `*l2`, at a nested `*l1` written on line 3, which is not where the author can act.
2. **Nodes are counted in post-order, as they are built**, so the root is counted last and a container
   after its children. The spec's hand count (`l3`'s sequence is 1,235th) is pre-order; the two differ by a
   few nodes and give the same alias, which is all the diagnostic names. The message gives the count it
   stopped at (the first node past the budget), not the full E the expansion would have reached.
3. **A merge key's value is counted like any other value** (an alias is one, a sequence of aliases is one
   plus its aliases, an inline mapping its nodes). The spec's "each merge key's value as one" read literally
   would count `<<: {…20,000 entries…}` as one node and refuse a document that expands nothing.
4. **E counts nodes built, not nodes kept**: a merged entry that an explicit key overrides is built and then
   discarded, and it still costs the time the budget exists to bound.
5. **The timing witness is relative to `yaml`'s own `parseDocument`**, not absolute and not 4,000-vs-8,000
   of the whole read, because `yaml`'s composer is itself superlinear in anchors (see Research).

## Research: the probe gate for FR-003

W by hand, E checked against `yaml`: the expanded `toJS({maxAliasCount: -1})` of each document counted
node by node (objects, arrays and scalars) against the hand count. Merge keys flatten into the receiving
object, so `toJS` and "nodes in the model's tree" agree.

| Document | W (hand) | E (hand) | E (`yaml` `toJS`) |
|---|---|---|---|
| `base: &b {x: 1, y: 2}`, `w: {<<: *b, z: 3}` (merge key) | 7 | 8 | 8 |
| `a: &a [1, 2]`, `b: &b [*a, *a]`, `c: *b` (alias inside an anchored node) | 8 | 18 | 18 |
| `a: &x [1,2,3]`, `b: *x`, `c: &x 9`, `d: *x` (anchor redefined between two aliases) | 8 | 11 | 11 |
| `é: &日本 [1, 2]`, `b: *日本` (non-ASCII name) | 5 | 7 | 7 |
| `a: &a {x: 1}`, `b: &b {y: 2}`, `w: {<<: [*a, *b]}` (merge list) | 9 | 8 | 8 |
| the bomb at levels 1-5 (80, 130, 180, 230, 280 bytes) | 1+11+11L | 123, 1,234, 12,345, 123,456, 1,234,567 | same |

The three-level bomb's position, counted by hand and re-checked with the `text` slice of the corpus case:
lines of 30, 50, 50 and 50 bytes (`,` with no space), `l3` starts at 130, its first alias at 139, each alias 4
bytes on: the ninth (index 8) is at 139 + 32 = 171..174, `*l2`, line 4 column 42. The tests pin W and E
from both sides through the budget itself: with `expansionRatio: 0`, an allowance of E - 1 refuses and E loads;
with ratio 1 and allowance 0 the budget is W. A document at exactly the default budget (an anchor of 38 nodes
and 370 aliases: W = 410, E = 14,100 = 10 x 410 + 10,000) loads and 371 aliases does not.

Also found, not caused here: `parseDocument` alone is superlinear in anchors (2,000 anchors+aliases 108 ms,
4,000 413 ms, 8,000 1.7 s; with no aliases at all, 135 ms to 470 ms from 4,000 to 8,000). That is the
composer's, upstream of every line of this library.

## Steps (each committed when green)

1. The table (FR-001, FR-002), the sweep, the oracle cases.
2. The budget (FR-003 to FR-006), the counted cases.
3. Docs and report.

## Tasks

- [x] T001 anchor table, writer and reader migrated, sweep and oracle tests
- [x] T002 `ParseLimits`, the code, the budget, the counted cases
- [x] T003 reference.md, report
