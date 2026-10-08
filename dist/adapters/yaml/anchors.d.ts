/**
 * The anchor table — one walk resolves every alias (SPEC.md §15 "A
 * document's cost is bounded by its size", v1.10; specs/019-bounded-cost
 * FR-001).
 *
 * `yaml`'s `Alias#resolve` finds an alias's anchor by walking the whole
 * document, so resolving every alias cost documents-times-aliases: 4,000
 * aliases in 142 KB took ten seconds. Its rule is simple, though: **the
 * nearest preceding anchor of that name**, where "preceding" is the order
 * `visit` walks — a pair's key before its value, a node before its children,
 * so an alias inside an anchored node sees that node. This module computes
 * that rule once: a single walk in the same order, a map from name to the
 * node that currently holds it, and at each alias a lookup. The answers are
 * `yaml`'s own, which `tests/unit/anchor-table.test.ts` checks with
 * `Alias#resolve` as the oracle — in the test only; nothing under `src/`
 * calls it (`tests/unit/layering.test.ts`).
 *
 * The walk is iterative, not recursive: a document may nest as deep as the
 * parser managed to build, and the depth cap (§11) is applied by the
 * converter, after this runs.
 */
import type { Alias, Document, Node as YamlNode } from "yaml";
export interface AnchorTable {
    /** The node `alias` refers to — the nearest preceding anchor of its name — or `undefined` if there is none (a dangling alias). */
    targetOf(alias: Alias): YamlNode | undefined;
    /** The first alias, in document order, that refers to `node` (the node is shared if there is one). */
    firstAliasTo(node: YamlNode): Alias | undefined;
}
export declare function buildAnchorTable(doc: Document): AnchorTable;
//# sourceMappingURL=anchors.d.ts.map