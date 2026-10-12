/**
 * An operation inside a staged value (v1.16, specs/026-shift-and-amend FR-002; SPEC.md Article IX).
 *
 * A caller that stages edits against a base cannot say "change the height of the wall I am inserting":
 * the wall is not in the base. It amends the staged value instead, and the path language that says
 * where is the format's, so the format answers it. For Cascata's formats that language is RFC 6901,
 * and the operation is RFC 6902's on the staged `EditData`, with Cascata's meanings: `add` only
 * creates, `set` only changes. Pure: no bytes, no parse; the staged value is never changed.
 */

import { ARRAY_INDEX, unescapePointerSegment } from "../model/pointer.js";
import type { EditData } from "./edit-data.js";

/** An operation at `path`: `value` for `set` and `add`, none for `remove`. */
export type AmendOperation =
  | { readonly op: "set" | "add"; readonly path: string; readonly value: EditData }
  | { readonly op: "remove"; readonly path: string };

/** Not inside the staged path (at it, beside it, or above it); or inside, and the amended value or why not. */
export type AmendResult =
  | { readonly inside: false }
  | { readonly inside: true; readonly ok: true; readonly value: EditData }
  | { readonly inside: true; readonly ok: false; readonly reason: string };

type Step = { readonly ok: true; readonly value: EditData } | { readonly ok: false; readonly reason: string };

/** Whether `path` is strictly below `within`: an RFC 6901 prefix followed by `/` (`/walls/W30` is not inside `/walls/W3`). */
export function isInside(path: string, within: string): boolean {
  return path.startsWith(`${within}/`);
}

export function amendValue(staged: { readonly path: string; readonly value: EditData }, operation: AmendOperation): AmendResult {
  if (!isInside(operation.path, staged.path)) return { inside: false };
  const segments = operation.path.slice(staged.path.length + 1).split("/").map(unescapePointerSegment);
  const where = (depth: number) => `'${operation.path.split("/").slice(0, staged.path.split("/").length + depth + 1).join("/")}'`;

  // Rebuild every container along the path, so the staged value is never changed.
  const visit = (node: EditData, depth: number): Step => {
    const segment = segments[depth] as string;
    if (depth === segments.length - 1) return apply(node, segment, depth);
    const child = node instanceof Map ? node.get(segment) : Array.isArray(node) && ARRAY_INDEX.test(segment) ? (node as readonly EditData[])[Number(segment)] : undefined;
    if (child === undefined) return { ok: false, reason: `There is no value at ${where(depth)} inside the staged value` };
    const next = visit(child, depth + 1);
    if (!next.ok) return next;
    if (node instanceof Map) return { ok: true, value: new Map(node).set(segment, next.value) };
    const copy = [...(node as readonly EditData[])];
    copy[Number(segment)] = next.value;
    return { ok: true, value: copy };
  };
  const apply = (parent: EditData, segment: string, depth: number): Step => {
    if (parent instanceof Map) {
      const has = parent.has(segment);
      if (operation.op === "add" && has) return { ok: false, reason: `A value already exists at ${where(depth)} inside the staged value; add creates, set changes` };
      if (operation.op !== "add" && !has) return { ok: false, reason: `There is no value at ${where(depth)} inside the staged value` };
      const copy = new Map(parent);
      if (operation.op === "remove") copy.delete(segment);
      else copy.set(segment, operation.value);
      return { ok: true, value: copy };
    }
    if (Array.isArray(parent)) {
      const items = parent as readonly EditData[];
      // RFC 6901: `-` is the position past the end, so only `add` can use it; an index has no leading zero.
      const index = segment === "-" ? (operation.op === "add" ? items.length : undefined) : ARRAY_INDEX.test(segment) ? Number(segment) : undefined;
      const limit = operation.op === "add" ? items.length : items.length - 1;
      if (index === undefined || index > limit) return { ok: false, reason: `There is no item at ${where(depth)} inside the staged value` };
      const copy = [...items];
      if (operation.op === "remove") copy.splice(index, 1);
      else if (operation.op === "add") copy.splice(index, 0, operation.value);
      else copy[index] = operation.value;
      return { ok: true, value: copy };
    }
    return { ok: false, reason: `The value above ${where(depth)} inside the staged value is a scalar, which has no entries` };
  };
  const result = visit(staged.value, 0);
  return result.ok ? { inside: true, ok: true, value: result.value } : { inside: true, ok: false, reason: result.reason };
}
