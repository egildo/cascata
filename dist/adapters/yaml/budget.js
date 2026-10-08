/**
 * W, the number of model nodes a YAML document writes — the base of the
 * expansion budget (SPEC.md §4.2, §11, §15; specs/019-bounded-cost FR-003).
 *
 * A *model node* is what §4.1 builds: a scalar, a mapping, a sequence. The
 * root is one. A mapping's keys are not nodes; its values are. An alias is
 * written as **one** node (its expansion is what the budget is about), and a
 * merge key's value is counted like any other value: `<<: *a` is one alias,
 * `<<: [*a, *b]` a sequence and two aliases, `<<: {x: 1}` a mapping and a
 * scalar. (Counting a merge value as one node whatever it holds would let a
 * large inline merge mapping, which expands nothing, exceed its own budget.)
 * An empty document is the null scalar the model invents: one.
 *
 * The count is iterative for the reason `anchors.ts` is: the AST is as deep
 * as the parser managed to make it, and the depth cap is applied later.
 */
import { isAlias, isMap, isNode, isPair, isSeq } from "yaml";
export function countWritten(doc) {
    if (doc.contents === null)
        return 1;
    let written = 0;
    const stack = [doc.contents];
    while (stack.length > 0) {
        const item = stack.pop();
        if (isPair(item)) {
            stack.push(item.value); // the key is not a node, and nothing in it is either
            continue;
        }
        if (!isNode(item))
            continue; // a missing value (`? a`), or an `!!omap`'s bare pair is refused elsewhere
        written += 1;
        if (isAlias(item))
            continue;
        // Not `push(...items)`: a call-site spread of a 200,000-entry array overflows the stack (Article VI, src/extend.ts).
        if (isMap(item) || isSeq(item)) {
            for (const child of item.items)
                stack.push(child);
        }
    }
    return written;
}
//# sourceMappingURL=budget.js.map