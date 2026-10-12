/**
 * The JSON half of writing a value back — SPEC.md Article IX (§19, v1.10);
 * specs/018-write-value.
 *
 * JSON has no aliases, no styles and no flow/block split, so a located value
 * is just the node the scanner built at the pointer, with the span it
 * measured. A string is a JSON string (RFC 8259 §7) — escapes where it
 * demands them, every other character, non-ASCII included, as itself.
 */

import type { Diagnostic } from "../../diagnostics/diagnostic.js";
import { editDiagnostic, type FindResult, type SharedEdits } from "../edit.js";
import type { ParseLimits } from "../limits.js";
import type { Node } from "../../model/node.js";
import { resolvePointer } from "../../model/pointer.js";
import type { Origin, SourceSpan } from "../../model/span.js";
import { parseJsonBytes } from "./parse.js";

/** A JSON document parsed once (v1.15 FR-004): its tree, which `find` answers any number of pointers from. */
export interface JsonOpened {
  readonly tree: Node;
  find(pointer: string, sharedEdits?: SharedEdits): FindResult;
}

export function openJson(bytes: Uint8Array, origin: Origin, limits: Partial<ParseLimits> | undefined): { readonly ok: true; readonly opened: JsonOpened } | { readonly ok: false; readonly diagnostics: Diagnostic[] } {
  const outcome = parseJsonBytes(bytes, origin, limits);
  if (!outcome.ok) {
    return outcome;
  }
  const { tree } = outcome;
  return { ok: true, opened: { tree, find: (pointer) => findIn(tree, pointer) } };
}

function findIn(tree: Node, pointer: string): FindResult {
  const node = resolvePointer(tree, pointer);
  if (node === undefined) {
    // The nearest existing ancestor: the longest prefix of the pointer that names something.
    const segments = pointer.slice(1).split("/");
    let ancestor: SourceSpan = tree.span;
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

export function parseBack(bytes: Uint8Array, origin: Origin, limits: Partial<ParseLimits> | undefined): Node | undefined {
  const outcome = parseJsonBytes(bytes, origin, limits);
  return outcome.ok ? outcome.tree : undefined;
}

export function renderJsonString(text: string): string {
  return JSON.stringify(text);
}
