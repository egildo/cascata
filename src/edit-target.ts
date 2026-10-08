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
import type { EditFormat, SharedEdits } from "./adapters/edit.js";
import { createDiagnostic, type Diagnostic, type RelatedSpan } from "./diagnostics/diagnostic.js";
import type { DiagnosticCode } from "./diagnostics/codes.js";
import type { MergedConfiguration } from "./merge/provenance.js";
import type { Node } from "./model/node.js";
import { originsInTree, pointerInDocument, pointersAt, resolvePointer } from "./model/pointer.js";
import type { SourceSpan } from "./model/span.js";

/** The document and in-document pointer where the value at a merged pointer is written, or why there is none. */
export type EditTargetResult =
  | {
      readonly ok: true;
      /** The document's location (`origin.id`; for a delegated fragment, the fragment's own location). */
      readonly location: string;
      /** The value's RFC 6901 pointer inside that document. */
      readonly pointer: string;
      readonly format: EditFormat;
      /** v1.12: empty, or under `sharedEdits: "warn"` the one `info` naming every other place the edit changes. */
      readonly diagnostics: readonly Diagnostic[];
    }
  | { readonly ok: false; readonly diagnostics: Diagnostic[] };

/** v1.12 FR-005: whether a shared value is a target. `"refuse"` when absent. */
export interface EditTargetOptions {
  readonly sharedEdits?: SharedEdits;
}

function refuse(code: DiagnosticCode, message: string, primary: SourceSpan): EditTargetResult {
  return { ok: false, diagnostics: [createDiagnostic({ level: "error", code, message, primary })] };
}

function where(span: SourceSpan): string {
  return `${span.origin.label}:${span.line}:${span.column}`;
}

/**
 * Every other place a write to `node`'s bytes changes (v1.12 FR-006): the other nodes of its own
 * document that share its span (an anchor and its aliases, a merge key's copies), and every other
 * graft of its location — or a layer read from the same file. A fragment's origin id is unique per
 * graft and its label is the location; a graft is named by the place that grafted it, the delegating
 * key's value. Also answers every place the location is read, its own included, for the message.
 */
function otherPlaces(configuration: MergedConfiguration, node: Node, location: string, inDocument: readonly string[], chosen: string): { readonly related: RelatedSpan[]; readonly places: string[] } {
  const related: RelatedSpan[] = inDocument.filter((p) => p !== chosen).map((p) => ({ label: `the same value at '${p}' in ${location}`, span: node.span }));
  const places: string[] = [];
  const seen = new Set<string>();
  for (const layer of configuration.layers) {
    for (const [id, label] of originsInTree(layer.tree)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const hops = configuration.delegationBreadcrumbs.get(id);
      if ((hops !== undefined ? label : id) !== location) continue;
      const grafted = hops?.[hops.length - 1]?.span;
      places.push(grafted !== undefined ? `delegated to at ${where(grafted)}` : "read as a layer");
      if (id === node.span.origin.id) continue;
      for (const p of pointersAt(layer.tree, id, node.span.start, node.span.end)) {
        const copy = hops === undefined ? resolvePointer(layer.tree, p) : undefined;
        const span = grafted ?? copy?.span;
        if (span !== undefined) related.push({ label: grafted !== undefined ? `the same value through the graft at ${where(grafted)}` : `the same value at '${p}' in ${location}, read again as another layer`, span });
      }
    }
  }
  return { related, places };
}

export function editTarget(configuration: MergedConfiguration, pointer: string, options: EditTargetOptions = {}): EditTargetResult {
  const sharedEdits = options.sharedEdits ?? "refuse";
  if (sharedEdits !== "refuse" && sharedEdits !== "warn" && sharedEdits !== "allow") {
    throw new Error(`editTarget(): sharedEdits must be "refuse", "warn" or "allow", got ${JSON.stringify(sharedEdits)}`);
  }
  const node = resolvePointer(configuration.tree, pointer);
  if (node === undefined) {
    // Positioned at the nearest ancestor that exists, as `locate` does; the root always does.
    let ancestor = pointer;
    let found: Node | undefined = node;
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
    // More than one node with this span means copies (an alias, a merge key).
    const inDocument = layer === undefined ? [] : pointersAt(layer.tree, origin.id, node.span.start, node.span.end);
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
    // Among copies the answer is a convention (v1.12 FR-007): the merged pointer's, else the same last segment, else the first.
    const chosen = pointerInDocument(layer.tree, node.span, pointer) ?? inDocument[0] ?? "";
    const { related, places } = otherPlaces(configuration, node, location, inDocument, chosen);
    if (related.length === 0) {
      return { ok: true, location, pointer: chosen, format, diagnostics: [] };
    }
    const why =
      inDocument.length > 1
        ? `is one of several nodes of ${location} that share one position (an anchor and its aliases, or a merge key's copies)`
        : `is in ${location}, which the configuration reads at ${places.length} places (${places.join("; ")})`;
    if (sharedEdits === "refuse") {
      // Writing one of several places that share these bytes would change the others. The writer refuses the alias copies too
      // (`edit-target-shared`); refusing here is not a guess about which of them the caller meant.
      return { ok: false, diagnostics: [createDiagnostic({ level: "error", code: "edit-target-shared", message: `The value at '${pointer}' ${why}; writing it would change every place that shares it`, primary: node.span, related })] };
    }
    const diagnostics = sharedEdits === "warn" ? [createDiagnostic({ level: "info", code: "edit-target-shared", message: `The value at '${pointer}' ${why}; the edit also changes every place named here`, primary: node.span, related })] : [];
    return { ok: true, location, pointer: chosen, format, diagnostics };
  }
  return refuse("edit-unsupported", `The value at '${pointer}' could not be placed in any document of the configuration`, node.span);
}
