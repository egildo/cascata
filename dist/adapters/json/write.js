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
import { parseJsonBytes } from "./parse.js";
export function findJson(bytes, origin, limits, pointer) {
    const outcome = parseJsonBytes(bytes, origin, limits);
    if (!outcome.ok) {
        return outcome;
    }
    const node = resolvePointer(outcome.tree, pointer);
    if (node === undefined) {
        // The nearest existing ancestor: the longest prefix of the pointer that names something.
        const segments = pointer.slice(1).split("/");
        let ancestor = outcome.tree.span;
        for (let length = segments.length - 1; length >= 0; length -= 1) {
            const prefix = length === 0 ? "" : `/${segments.slice(0, length).join("/")}`;
            const found = resolvePointer(outcome.tree, prefix);
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
export function renderJsonString(text) {
    return JSON.stringify(text);
}
//# sourceMappingURL=write.js.map