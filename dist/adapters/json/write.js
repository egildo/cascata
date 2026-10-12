/**
 * The JSON half of writing a value back — SPEC.md Article IX (§19, v1.10);
 * specs/018-write-value.
 *
 * JSON has no aliases, no styles and no flow/block split, so a located value
 * is just the node the scanner built at the pointer, with the span it
 * measured. A string is a JSON string (RFC 8259 §7) — escapes where it
 * demands them, every other character, non-ASCII included, as itself.
 */
import { editDiagnostic } from "../edit.js";
import { resolvePointer } from "../../model/pointer.js";
import { createSourceSpan } from "../../model/span.js";
import { locateByteOffset } from "../encoding.js";
import { jsonKeyRange, newJsonFacts, planJsonAdd, planJsonRemove, planJsonReplace } from "./insert.js";
import { parseJsonBytes } from "./parse.js";
/** A JSON document parsed once (v1.15 FR-004): its tree, which `find` answers any number of pointers from. */
export function openJson(bytes, origin, limits) {
    const outcome = parseJsonBytes(bytes, origin, limits);
    if (!outcome.ok) {
        return outcome;
    }
    const { tree } = outcome;
    const facts = newJsonFacts(bytes, tree);
    const spanOf = (start, end) => {
        const { line, column } = locateByteOffset(bytes, start);
        return createSourceSpan({ origin, start, end, line, column, documentLength: bytes.length });
    };
    return {
        ok: true,
        opened: {
            tree,
            find: (pointer) => findIn(tree, pointer),
            replace: (found, pointer, data) => {
                const parent = pointer === "" ? undefined : findIn(tree, pointer.slice(0, pointer.lastIndexOf("/")));
                return planJsonReplace(facts, found, pointer, data, parent?.ok === true ? parent.found : undefined);
            },
            add: (container, at, data) => planJsonAdd(facts, container, at, data),
            remove: (_target, container, at) => planJsonRemove(facts, container, at),
            keySpan: (container, key) => {
                const range = jsonKeyRange(facts, container, key);
                return range === undefined ? undefined : spanOf(range.start, range.end);
            },
            owner: (_target, container) => container,
            dependents: () => [],
            mergedUnder: () => undefined,
        },
    };
}
function findIn(tree, pointer) {
    const node = resolvePointer(tree, pointer);
    if (node === undefined) {
        // The nearest existing ancestor: the longest prefix of the pointer that names something.
        const segments = pointer.slice(1).split("/");
        let ancestor = tree.span;
        for (let length = segments.length - 1; length >= 0; length -= 1) {
            const prefix = length === 0 ? "" : `/${segments.slice(0, length).join("/")}`;
            const found = resolvePointer(tree, prefix);
            if (found !== undefined) {
                ancestor = found.span;
                break;
            }
        }
        return { ok: false, diagnostics: [editDiagnostic("edit-target-absent", `No value at '${pointer}'; the nearest existing ancestor is shown`, ancestor)] };
    }
    return { ok: true, found: { start: node.span.start, end: node.span.end, node, span: node.span, style: "json", inFlow: false } };
}
export function parseBack(bytes, origin, limits) {
    const outcome = parseJsonBytes(bytes, origin, limits);
    return outcome.ok ? outcome.tree : undefined;
}
export { renderJsonString } from "./spell.js";
//# sourceMappingURL=write.js.map