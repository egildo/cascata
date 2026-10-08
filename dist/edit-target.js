/**
 * Which document an edit belongs in — SPEC.md Article IX (§19, v1.11); specs/020-edit-targets.
 *
 * `editTarget` takes a merged configuration and a pointer into it and answers the document, and
 * the pointer inside that document, where the winning value is written — so a tool that edits its
 * model never has to know the cascade. It reads no file; the caller hands the document's bytes and
 * the answer's pointer to a writer (`./writers.ts`).
 *
 * Lives beside `index.ts` rather than under `src/merge/` because it needs the adapter registry
 * for a document's format, which the format-blind stages may not import.
 *
 * **The winning value is the merged node itself.** The fold carries every node through by
 * reference, so the scalar at a merged pointer still holds the span of the document that wrote
 * it. That is why a single item of an accumulated list (FR-004) needs no counting: the item
 * knows its own document, and the document's own tree knows the item's index in it.
 */
import { formatForLocation } from "./adapters/registry.js";
import { createDiagnostic } from "./diagnostics/diagnostic.js";
import { pointersInDocument, resolvePointer } from "./model/pointer.js";
function refuse(code, message, primary) {
    return { ok: false, diagnostics: [createDiagnostic({ level: "error", code, message, primary })] };
}
export function editTarget(configuration, pointer) {
    const node = resolvePointer(configuration.tree, pointer);
    if (node === undefined) {
        // Positioned at the nearest ancestor that exists, as `locate` does; the root always does.
        let ancestor = pointer;
        let found = node;
        while (found === undefined) {
            ancestor = ancestor.slice(0, ancestor.lastIndexOf("/"));
            found = resolvePointer(configuration.tree, ancestor);
        }
        return refuse("edit-target-absent", `There is no value at '${pointer}' in the merged configuration`, found.span);
    }
    if (node.type !== "scalar") {
        return refuse("edit-unsupported", `The value at '${pointer}' is a ${node.type}; setting a container is an insertion, which is not written yet, so only a scalar has an edit target`, node.span);
    }
    const origin = node.span.origin;
    // A fragment's origin id is `<location> #graft=N`, unique per graft; its label is the location.
    const location = configuration.delegationBreadcrumbs.has(origin.id) ? origin.label : origin.id;
    for (let index = configuration.layers.length - 1; index >= 0; index--) {
        const layer = configuration.layers[index];
        // Two is enough to know: more than one node with this span means copies (an alias, a merge key).
        const inDocument = layer === undefined ? [] : pointersInDocument(layer.tree, node.span, 2);
        if (layer === undefined || inDocument.length === 0) {
            continue;
        }
        if (layer.role === "schema") {
            return refuse("edit-target-inherited", `The value at '${pointer}' is supplied by the 'provide' of the schema ${location}; editing it there would change a default every document under that schema shares`, node.span);
        }
        if (/^https:\/\//i.test(location)) {
            return refuse("edit-target-remote", `The value at '${pointer}' is in ${location}, a document read over https; a remote document is never an edit target`, node.span);
        }
        const format = formatForLocation(location);
        if (format !== "yaml" && format !== "json") {
            return refuse("edit-unsupported", `The value at '${pointer}' is in ${location}, a format with no writer`, node.span);
        }
        const [only, copy] = inDocument;
        if (only === undefined || copy !== undefined) {
            // Writing one of several nodes that share a span would change the others. The writer refuses the same
            // values (`edit-target-shared`); refusing here is not a guess about which of them the caller meant.
            return refuse("edit-target-shared", `The value at '${pointer}' is one of several nodes of ${location} that share one position (an anchor and its aliases, or a merge key's copies); writing it would change every place that shares it`, node.span);
        }
        return { ok: true, location, pointer: only, format };
    }
    return refuse("edit-unsupported", `The value at '${pointer}' could not be placed in any document of the configuration`, node.span);
}
//# sourceMappingURL=edit-target.js.map