/**
 * The read-back's comparison -- v1.15 FR-014, FR-019: the edited document's tree is the original tree with the operation
 * applied at the pointer, **whole**: every sibling, every ancestor, every key survives, not just the place that was
 * edited. Format-blind. The operation is a list of `Op`s -- one per place that held the bytes (a value and its alias and
 * merge-key copies, v1.12 FR-007) -- and the original tree is never rebuilt: a path nothing touches is compared with
 * §4.2's one definition of equality, and the places the operations touch are compared with what they should hold.
 */
import { nodesEqual } from "../model/equality.js";
import { dataEqualsNode } from "./edit-data.js";
const newTrie = () => ({ children: new Map(), replace: undefined, adds: [], removes: [], tolerated: new Set() });
function walk(root, path) {
    let at = root;
    for (const segment of path) {
        let next = at.children.get(segment);
        if (next === undefined) {
            next = newTrie();
            at.children.set(segment, next);
        }
        at = next;
    }
    return at;
}
function matches(original, after, trie) {
    if (trie === undefined)
        return nodesEqual(original, after);
    if (trie.replace !== undefined)
        return dataEqualsNode(trie.replace.data, after);
    if (original.type === "scalar")
        return false;
    if (original.type === "mapping") {
        if (after.type !== "mapping")
            return false;
        if (trie.tolerated.size > 0) {
            // A merging mapping: its other keys are as they were, and it has no key it did not have, bar the tolerated ones.
            for (const [key, child] of original.entries) {
                if (trie.tolerated.has(key))
                    continue;
                const counterpart = after.entries.get(key);
                if (counterpart === undefined || !matches(child, counterpart, trie.children.get(key)))
                    return false;
            }
            for (const key of after.entries.keys())
                if (!original.entries.has(key) && !trie.tolerated.has(key))
                    return false;
            return true;
        }
        const removed = new Set();
        for (const at of trie.removes)
            if ("key" in at)
                removed.add(at.key);
        const added = new Map();
        for (const { at, data } of trie.adds)
            if ("key" in at)
                added.set(at.key, data);
        let expected = original.entries.size;
        for (const key of removed)
            if (original.entries.has(key))
                expected -= 1;
        for (const key of added.keys())
            if (!original.entries.has(key) || removed.has(key))
                expected += 1;
        if (after.entries.size !== expected)
            return false;
        for (const [key, child] of original.entries) {
            if (removed.has(key)) {
                if (after.entries.has(key) && !added.has(key))
                    return false;
                continue;
            }
            const counterpart = after.entries.get(key);
            if (counterpart === undefined || !matches(child, counterpart, trie.children.get(key)))
                return false;
        }
        for (const [key, data] of added) {
            const counterpart = after.entries.get(key);
            if (counterpart === undefined || !dataEqualsNode(data, counterpart))
                return false;
        }
        return true;
    }
    if (after.type !== "sequence")
        return false;
    let slots = original.items.map((_, original) => ({ original }));
    for (const at of trie.removes)
        if ("index" in at)
            slots = slots.filter((_, position) => position !== at.index);
    for (const { at, data } of trie.adds)
        if ("index" in at)
            slots.splice(at.index, 0, { data });
    if (after.items.length !== slots.length)
        return false;
    return slots.every((slot, position) => {
        const counterpart = after.items[position];
        if (counterpart === undefined)
            return false;
        if ("data" in slot)
            return dataEqualsNode(slot.data, counterpart);
        const child = original.items[slot.original];
        return child !== undefined && matches(child, counterpart, trie.children.get(String(slot.original)));
    });
}
/** Whether `after` is `original` with every operation applied. */
export function treeMatches(original, after, ops) {
    const root = newTrie();
    for (const op of ops) {
        if (op.kind === "replace") {
            const at = walk(root, op.path);
            at.replace = { data: op.data };
        }
        else {
            const at = walk(root, op.parent);
            if (op.tolerant === true) {
                if ("key" in op.at)
                    at.tolerated.add(op.at.key);
            }
            else if (op.kind === "add")
                at.adds.push({ at: op.at, data: op.data });
            else
                at.removes.push(op.at);
        }
    }
    return matches(original, after, root);
}
//# sourceMappingURL=readback.js.map