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
import { isAlias, isMap, isNode, isPair, isSeq } from "yaml";
function anchorOf(node) {
    if (isAlias(node))
        return undefined;
    return typeof node.anchor === "string" && node.anchor !== "" ? node.anchor : undefined;
}
export function buildAnchorTable(doc) {
    const holders = new Map();
    const targets = new Map();
    const firstAlias = new Map();
    // A stack of nodes and pairs, popped in document order: children are pushed in reverse.
    const stack = [doc.contents];
    while (stack.length > 0) {
        const item = stack.pop();
        if (isPair(item)) {
            stack.push(item.value, item.key); // the key is popped first
            continue;
        }
        if (!isNode(item))
            continue;
        if (isAlias(item)) {
            const target = holders.get(item.source);
            targets.set(item, target);
            if (target !== undefined && !firstAlias.has(target))
                firstAlias.set(target, item);
            continue;
        }
        const anchor = anchorOf(item);
        if (anchor !== undefined)
            holders.set(anchor, item);
        if (isMap(item)) {
            for (let index = item.items.length - 1; index >= 0; index -= 1)
                stack.push(item.items[index]);
        }
        else if (isSeq(item)) {
            for (let index = item.items.length - 1; index >= 0; index -= 1)
                stack.push(item.items[index]);
        }
    }
    return {
        targetOf: (alias) => targets.get(alias),
        firstAliasTo: (node) => firstAlias.get(node),
    };
}
//# sourceMappingURL=anchors.js.map