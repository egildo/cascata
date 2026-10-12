/**
 * What one parse of a YAML document leaves for its writer -- v1.15 FR-004, specs/025-open-insert-delete.
 *
 * `Facts` is the reader's tree, the `yaml` AST it was built from and the functions that measured it. The
 * things a writer needs that cost a walk over the whole document -- every node's parent, `yaml`'s CST tokens,
 * where each block indicator (`-`, `:`, `?`) and property (`&anchor`, `!tag`) sits, the document's line
 * ending and indentation step -- are built the first time something asks and kept: at most once per
 * document, however many pointers are asked about. `parse-count.ts` counts the walks for the tests.
 */
import { isMap, isNode, isSeq, Parser } from "yaml";
import { countParentWalk, countTokenize } from "../parse-count.js";
import { documentLineBreak } from "../text.js";
export function newFacts(bytes, doc, spans, anchors, tree) {
    return { bytes, doc, spans, anchors, tree, parents: undefined, tokens: undefined, indicators: undefined, eol: undefined, style: undefined };
}
/** `yaml` types a pair's key and value `unknown`; this narrows them with the library's own guard instead of a cast. */
export function asNode(value) {
    return isNode(value) ? value : null;
}
/** The stored byte offset of the stored UTF-16 index `index` that `yaml`'s ranges (rewritten by the reader) hold. */
export function byteAt(facts, index) {
    return facts.spans.spanOf([index, index, index]).start;
}
/** A node's range as bytes: where it starts, where its value ends and where the node (a trailing comment included) ends. */
export function rangeBytes(facts, node) {
    if (node.range == null)
        return undefined;
    return { start: byteAt(facts, node.range[0]), valueEnd: byteAt(facts, node.range[1]), end: byteAt(facts, node.range[2]) };
}
// --- every node's parent -------------------------------------------------------
function parentsOf(doc) {
    countParentWalk();
    const parents = new Map();
    const stack = doc.contents !== null && isNode(doc.contents) ? [doc.contents] : [];
    for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
        const children = [];
        if (isMap(node)) {
            for (const pair of node.items) {
                const key = asNode(pair.key);
                const value = asNode(pair.value);
                if (key !== null)
                    children.push(key);
                if (value !== null)
                    children.push(value);
            }
        }
        else if (isSeq(node)) {
            for (const item of node.items) {
                const child = asNode(item);
                if (child !== null)
                    children.push(child);
            }
        }
        for (const child of children) {
            parents.set(child, node);
            stack.push(child);
        }
    }
    return parents;
}
/** Each node's parent in the AST (a pair is skipped: a key's and a value's parent is the mapping). Built once per document. */
export function parentsIn(facts) {
    facts.parents ??= parentsOf(facts.doc);
    return facts.parents;
}
// --- yaml's CST tokens -----------------------------------------------------------
/** Every token `yaml`'s CST holds, in the parser's text, in document order. Iterative: a document may nest deeply. */
function sourceTokens(text) {
    countTokenize();
    const found = [];
    const work = [];
    for (const token of new Parser().parse(text))
        work.push(token);
    while (work.length > 0) {
        const at = work.pop();
        if (Array.isArray(at)) {
            for (const item of at)
                work.push(item);
        }
        else if (typeof at === "object" && at !== null) {
            const fields = { ...at };
            const { type, offset, source } = fields;
            if (typeof type === "string" && typeof offset === "number" && typeof source === "string")
                found.push({ type, offset, end: offset + source.length });
            for (const value of Object.values(fields))
                if (typeof value === "object" && value !== null)
                    work.push(value);
        }
    }
    return found.sort((a, b) => a.offset - b.offset);
}
/** The CST tokens, built once per document. */
export function tokensIn(facts) {
    facts.tokens ??= sourceTokens(facts.spans.parserText);
    return facts.tokens;
}
/** Where each block indicator and property is, in bytes, from the same tokens (built once per document). */
export function indicatorsIn(facts) {
    if (facts.indicators !== undefined)
        return facts.indicators;
    const dashes = [];
    const colons = [];
    const questionMarks = [];
    const properties = [];
    const byteOfParser = (parserIndex) => byteAt(facts, facts.spans.toStored(parserIndex));
    for (const token of tokensIn(facts)) {
        if (token.type === "seq-item-ind")
            dashes.push(byteOfParser(token.offset));
        else if (token.type === "map-value-ind")
            colons.push(byteOfParser(token.offset));
        else if (token.type === "explicit-key-ind")
            questionMarks.push(byteOfParser(token.offset));
        else if (token.type === "anchor" || token.type === "tag")
            properties.push({ start: byteOfParser(token.offset), end: byteOfParser(token.end) });
    }
    facts.indicators = { dashes, colons, questionMarks, properties };
    return facts.indicators;
}
/** The index of the last entry of `sorted` that is below `bound`, or -1. */
export function lastBelow(sorted, bound) {
    let low = 0;
    let high = sorted.length - 1;
    let found = -1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if ((sorted[mid] ?? 0) < bound) {
            found = mid;
            low = mid + 1;
        }
        else
            high = mid - 1;
    }
    return found;
}
/** The index of the first entry of `sorted` that is at or above `bound`, or `sorted.length`. */
export function firstAtOrAbove(sorted, bound) {
    return lastBelow(sorted, bound) + 1;
}
// --- the document's own style ------------------------------------------------------
export function lineBreakOf(facts) {
    facts.eol ??= documentLineBreak(facts.bytes);
    return facts.eol;
}
export function columnOf(bytes, at) {
    let i = at;
    while (i > 0 && bytes[i - 1] !== 0x0a && bytes[i - 1] !== 0x0d)
        i -= 1;
    return at - i;
}
/**
 * The document's indentation step and dash habit: the first block mapping nested in a block mapping, or the first block
 * sequence under a key, in document order. Found by one walk, which stops as soon as it has both.
 */
export function styleOf(facts) {
    if (facts.style !== undefined)
        return facts.style;
    const { bytes } = facts;
    const startOf = (node) => (node.range == null ? undefined : byteAt(facts, node.range[0]));
    let step;
    let dashIndented;
    const stack = facts.doc.contents !== null && isNode(facts.doc.contents) ? [facts.doc.contents] : [];
    for (let node = stack.pop(); node !== undefined && (step === undefined || dashIndented === undefined); node = stack.pop()) {
        const children = [];
        if (isMap(node)) {
            const first = asNode(node.items[0]?.key);
            const firstAt = first === null ? undefined : startOf(first);
            for (const pair of node.items) {
                const value = asNode(pair.value);
                if (value === null)
                    continue;
                children.push(value);
                const at = startOf(value);
                if (node.flow === true || firstAt === undefined || at === undefined || !isBlockCollection(value))
                    continue;
                const offset = columnOf(bytes, at) - columnOf(bytes, firstAt);
                if (isMap(value) && step === undefined && offset > 0)
                    step = offset;
                if (isSeq(value)) {
                    dashIndented ??= offset > 0;
                    if (offset > 0)
                        step ??= offset;
                }
            }
        }
        else if (isSeq(node)) {
            for (const item of node.items) {
                const child = asNode(item);
                if (child !== null)
                    children.push(child);
            }
        }
        for (let i = children.length - 1; i >= 0; i -= 1) {
            const child = children[i];
            if (child !== undefined)
                stack.push(child);
        }
    }
    facts.style = { step: step ?? 2, dashIndented: dashIndented ?? true };
    return facts.style;
}
const sites = new WeakMap();
/** Remember where a `Found` value sits, for the operations that edit around it (`insert.ts`). */
export function recordSite(found, site) {
    sites.set(found, site);
}
export function siteOf(found) {
    const site = sites.get(found);
    if (site === undefined)
        throw new Error("Internal error: a Found value the YAML writer did not make");
    return site;
}
export function isBlockCollection(node) {
    return node !== null && (isMap(node) || isSeq(node)) && node.flow !== true;
}
//# sourceMappingURL=facts.js.map