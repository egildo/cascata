/**
 * Replacing, adding and removing in a JSON document -- SPEC.md Article IX (v1.15); specs/025-open-insert-delete FR-010.
 *
 * JSON has no styles to speak of beyond layout, so a writer's style is whitespace: whether a container is on one line or
 * one member per line, the indentation (spaces or tabs, how many), the blanks after `:` and `,`. They are copied from the
 * nearest sibling, then from the document: its first indentation increase is its step, and a document in which no
 * container spans a line break stays on one line. Member positions are scanned from the bytes (the model's mappings
 * are sorted by key, so their order says nothing about the document's); the model supplies where each value ends.
 */

import type { Node } from "../../model/node.js";
import { ARRAY_INDEX } from "../../model/pointer.js";
import type { SourceSpan } from "../../model/span.js";
import { hasLoneSurrogate, isContainerData, isEmptyData, kindOfNew, plainScalarText, type EditData, type EditValue } from "../edit-data.js";
import type { Found } from "../edit.js";
import { flowAdd, flowRemove, type FlowBox, type FlowEntry } from "../flow.js";
import { edit, refusal, type Plan } from "../plan.js";
import { documentLineBreak, indentationOf, isBlank, isBreak, lineStartOf, skipBlanksForward, startsItsLine } from "../text.js";
import { renderJsonString } from "./spell.js";

/** What one parse of a JSON document leaves for its writer, and what is worked out about it once. */
export interface JsonFacts {
  readonly bytes: Uint8Array;
  readonly tree: Node;
  multiline: boolean | undefined;
  unit: string | undefined;
  eol: string | undefined;
}

export function newJsonFacts(bytes: Uint8Array, tree: Node): JsonFacts {
  return { bytes, tree, multiline: undefined, unit: undefined, eol: undefined };
}

export type AddAt = { readonly key: string } | { readonly index: number };

const decoder = new TextDecoder();
const text = (bytes: Uint8Array, from: number, to: number): string => decoder.decode(bytes.subarray(from, to));

class Unspellable extends Error {}

// --- members --------------------------------------------------------------------

interface Member {
  readonly start: number;
  readonly end: number;
  readonly key?: string;
  readonly keyStart?: number;
  readonly keyEnd?: number;
  readonly valueStart: number;
  readonly node: Node;
}

const skipWhitespace = (bytes: Uint8Array, from: number): number => {
  let i = from;
  while (i < bytes.length && (isBlank(bytes[i]) || isBreak(bytes[i]))) i += 1;
  return i;
};

/** The byte after the string that begins at the quote `from`. */
function skipString(bytes: Uint8Array, from: number): number {
  let i = from + 1;
  while (i < bytes.length && bytes[i] !== 0x22) i += bytes[i] === 0x5c ? 2 : 1;
  return i + 1;
}

/** The members of the object or array `node`, in the order the bytes hold them. */
function membersOf(bytes: Uint8Array, node: Node): Member[] {
  const members: Member[] = [];
  if (node.type === "scalar") return members;
  let i = skipWhitespace(bytes, node.span.start + 1);
  if (node.type === "sequence") {
    for (const item of node.items) {
      members.push({ start: item.span.start, end: item.span.end, valueStart: item.span.start, node: item });
      i = skipWhitespace(bytes, item.span.end);
      if (bytes[i] === 0x2c) i = skipWhitespace(bytes, i + 1);
    }
    return members;
  }
  while (i < node.span.end - 1 && bytes[i] === 0x22) {
    const keyStart = i;
    const keyEnd = skipString(bytes, keyStart);
    const key: unknown = JSON.parse(text(bytes, keyStart, keyEnd));
    const child = typeof key === "string" ? node.entries.get(key) : undefined;
    if (typeof key !== "string" || child === undefined) throw new Error("Internal error: the JSON scanner and the reader disagree about a key");
    members.push({ start: keyStart, end: child.span.end, key, keyStart, keyEnd, valueStart: child.span.start, node: child });
    i = skipWhitespace(bytes, child.span.end);
    if (bytes[i] === 0x2c) i = skipWhitespace(bytes, i + 1);
  }
  return members;
}

const hasBreak = (bytes: Uint8Array, from: number, to: number): boolean => {
  for (let i = from; i < to; i += 1) if (isBreak(bytes[i])) return true;
  return false;
};

// --- layout ---------------------------------------------------------------------------

function lineBreakOf(facts: JsonFacts): string {
  facts.eol ??= documentLineBreak(facts.bytes);
  return facts.eol;
}

/** Whether any container in the document spans a line break (a document in which none does stays on one line). */
function isMultilineDocument(facts: JsonFacts): boolean {
  facts.multiline ??= facts.tree.type !== "scalar" && hasBreak(facts.bytes, facts.tree.span.start, facts.tree.span.end);
  return facts.multiline;
}

/** One level of indentation: the whitespace that first deepens a line, else two spaces. */
function documentUnit(facts: JsonFacts): string {
  if (facts.unit !== undefined) return facts.unit;
  const { bytes } = facts;
  let previous = "";
  let unit = "  ";
  for (let start = 0; start < bytes.length; ) {
    const content = skipBlanksForward(bytes, start);
    let end = content;
    while (end < bytes.length && !isBreak(bytes[end])) end += 1;
    if (content < end) {
      const indent = text(bytes, start, content);
      if (indent.length > previous.length && indent.startsWith(previous)) {
        unit = indent.slice(previous.length);
        break;
      }
      previous = indent;
    }
    start = end;
    while (start < bytes.length && isBreak(bytes[start])) start += 1;
  }
  facts.unit = unit;
  return unit;
}

/** How a new value is laid out: line endings, one level of indentation, the text between a key and its value, between items. */
interface Layout {
  readonly eol: string;
  readonly unit: string;
  readonly colon: string;
  readonly comma: string;
}

function renderScalar(value: EditValue): string {
  const kind = kindOfNew(value);
  if (kind === "string") {
    if (hasLoneSurrogate(value as string)) throw new Unspellable("A string with an unpaired UTF-16 surrogate cannot be encoded as UTF-8");
    return renderJsonString(value as string);
  }
  const spelled = plainScalarText(value, kind, undefined);
  if (spelled === undefined) throw new Unspellable("JSON has no spelling for this value");
  return spelled;
}

function renderKey(key: string): string {
  if (hasLoneSurrogate(key)) throw new Unspellable("A key with an unpaired UTF-16 surrogate cannot be encoded as UTF-8");
  return renderJsonString(key);
}

/** `data` spelled at `indent` -- the indentation of the line it begins on -- one line or one member per line. */
function render(data: EditData, indent: string, multiline: boolean, layout: Layout): string {
  if (!isContainerData(data)) return renderScalar(data);
  const array = Array.isArray(data);
  if (isEmptyData(data)) return array ? "[]" : "{}";
  const parts = array ? (data as readonly EditData[]).map((item) => render(item, `${indent}${layout.unit}`, multiline, layout)) : [...(data as ReadonlyMap<string, EditData>)].map(([key, value]) => `${renderKey(key)}${layout.colon}${render(value, `${indent}${layout.unit}`, multiline, layout)}`);
  const [open, close] = array ? ["[", "]"] : ["{", "}"];
  if (!multiline) return `${open}${parts.join(layout.comma)}${close}`;
  const inner = `${indent}${layout.unit}`;
  return `${open}${layout.eol}${parts.map((part) => `${inner}${part}`).join(`,${layout.eol}`)}${layout.eol}${indent}${close}`;
}

function layoutNear(facts: JsonFacts, members: readonly Member[], near: number, comma: string): Layout {
  let colon = ": ";
  for (let distance = 0; distance < members.length; distance += 1) {
    for (const j of distance === 0 ? [near] : [near - distance, near + distance]) {
      const member = members[j];
      if (member?.keyEnd !== undefined && colon === ": ") {
        const between = text(facts.bytes, member.keyEnd, member.valueStart);
        if (/^[ \t]*:[ \t]*$/.test(between)) {
          colon = between.replace(/^[ \t]*/, "");
          return { eol: lineBreakOf(facts), unit: documentUnit(facts), colon, comma };
        }
      }
    }
  }
  return { eol: lineBreakOf(facts), unit: documentUnit(facts), colon, comma };
}

/** The comma spacing of one-line containers: that of the first gap the document has, else `, `. */
function commaOf(facts: JsonFacts, members: readonly Member[]): string {
  for (let j = 0; j + 1 < members.length; j += 1) {
    const left = members[j];
    const right = members[j + 1];
    if (left === undefined || right === undefined) continue;
    const gap = text(facts.bytes, left.end, right.start);
    if (/^[ \t]*,[ \t]*$/.test(gap)) return gap.replace(/^[ \t]*/, "");
  }
  const only = members[0];
  if (only?.keyEnd !== undefined && !/\s/.test(text(facts.bytes, only.keyEnd, only.valueStart).replace(/:/, ""))) {
    // `{"a":1}`: no blank after the colon, none after the comma either.
    return text(facts.bytes, only.keyEnd, only.valueStart) === ":" ? "," : ", ";
  }
  return ", ";
}

/** Whether the value of the nearest sibling that is a container spans a line break; `undefined` when no sibling is one. */
function donorMultiline(facts: JsonFacts, members: readonly Member[], near: number): boolean | undefined {
  for (let distance = 0; distance < members.length; distance += 1) {
    for (const j of distance === 0 ? [near] : [near - distance, near + distance]) {
      const member = members[j];
      if (member !== undefined && member.node.type !== "scalar") return hasBreak(facts.bytes, member.node.span.start, member.node.span.end);
    }
  }
  return undefined;
}

// --- the plans -----------------------------------------------------------------------

function parentPointer(pointer: string): { readonly parent: string; readonly last: string } {
  const at = pointer.lastIndexOf("/");
  return { parent: pointer.slice(0, at), last: pointer.slice(at + 1).replace(/~1/g, "/").replace(/~0/g, "~") };
}

function spellable(run: () => Plan): Plan {
  try {
    return run();
  } catch (error) {
    if (error instanceof Unspellable) return refusal("edit-unrepresentable", error.message);
    throw error;
  }
}

/** The plan that makes the value at `found` (pointer `pointer`) equal `data` where either is a container (v1.15 FR-008). */
export function planJsonReplace(facts: JsonFacts, found: Found, pointer: string, data: EditData, parent: Found | undefined): Plan {
  return spellable(() => {
    const { bytes } = facts;
    const old = found.node;
    const members = parent === undefined ? [] : membersOf(bytes, parent.node);
    const index = members.findIndex((member) => member.valueStart === found.start);
    const comma = commaOf(facts, members);
    const layout = layoutNear(facts, members, Math.max(index, 0), comma);
    const indent = indentationOf(bytes, found.start);
    // A container written over a container keeps its layout; otherwise the nearest sibling's, then the parent's, then the document's.
    const multiline =
      old.type !== "scalar" ? hasBreak(bytes, old.span.start, old.span.end) : (donorMultiline(facts, members, Math.max(index, 0)) ?? (parent !== undefined ? hasBreak(bytes, parent.node.span.start, parent.node.span.end) : false));
    void pointer;
    // The layout's step: the replaced container's own, where it spans lines; else the document's.
    return edit(found.start, found.end, render(data, indent, multiline && isContainerData(data), localLayout(facts, old, layout)));
  });
}

/** The step inside a multi-line container being replaced is its own first member's indentation over its own line's. */
function localLayout(facts: JsonFacts, old: Node, layout: Layout): Layout {
  if (old.type === "scalar") return layout;
  const { bytes } = facts;
  const first = membersOf(bytes, old)[0];
  if (first === undefined || !startsItsLine(bytes, first.start)) return layout;
  const own = indentationOf(bytes, old.span.start);
  const inner = indentationOf(bytes, first.start);
  return inner.length > own.length && inner.startsWith(own) ? { ...layout, unit: inner.slice(own.length) } : layout;
}

/** The plan that adds `data` at `at` to the container at `container` (v1.15 FR-012). */
export function planJsonAdd(facts: JsonFacts, container: Found, at: AddAt, data: EditData): Plan {
  return spellable(() => {
    const { bytes } = facts;
    const node = container.node;
    const mapping = node.type === "mapping";
    const members = membersOf(bytes, node);
    const open = node.span.start;
    const close = node.span.end - 1;
    const eol = lineBreakOf(facts);
    const index = "index" in at ? at.index : members.length;
    const comma = commaOf(facts, members);
    const near = Math.min(index, members.length - 1);
    const layout = layoutNear(facts, members, Math.max(near, 0), comma);

    if (members.length === 0) {
      // The first member: on its own indented line if the document has any container that spans lines, else beside the brackets.
      const multiline = isMultilineDocument(facts);
      const indent = indentationOf(bytes, open);
      const inner = `${indent}${layout.unit}`;
      const entry = (mapping ? `${renderKey("key" in at ? at.key : "")}${layout.colon}` : "") + render(data, inner, multiline, layout);
      // The brackets are rewritten, not just filled: two adds into one empty container overlap, as FR-015 says.
      const [left, right] = mapping ? ["{", "}"] : ["[", "]"];
      return edit(open, close + 1, `${left}${multiline ? `${eol}${inner}${entry}${eol}${indent}` : entry}${right}`);
    }

    const anchor = members[Math.max(near, 0)];
    const multiline = anchor !== undefined && startsItsLine(bytes, anchor.start);
    const memberIndent = anchor === undefined ? "" : multiline ? indentationOf(bytes, anchor.start) : "";
    // A new container takes the layout of the nearest sibling container, else that of the container it joins.
    const containerMultiline = donorMultiline(facts, members, Math.max(near, 0)) ?? multiline;
    const entry = (mapping ? `${renderKey("key" in at ? at.key : "")}${layout.colon}` : "") + render(data, memberIndent, containerMultiline, layout);
    const box: FlowBox = { open, close, entries: members.map((member): FlowEntry => ({ start: member.start, end: member.end })) };
    const planned = flowAdd(bytes, box, index, entry, eol, comma);
    return edit(planned.start, planned.end, planned.text);
  });
}

/** The plan that removes the member `at` names, with one comma (v1.15 FR-016, FR-017). */
export function planJsonRemove(facts: JsonFacts, container: Found, at: AddAt): Plan {
  const { bytes } = facts;
  const node = container.node;
  const members = membersOf(bytes, node);
  const index = "key" in at ? members.findIndex((member) => member.key === at.key) : at.index;
  if (index < 0 || members[index] === undefined) return refusal("edit-target-absent", "No such member in this container");
  const box: FlowBox = { open: node.span.start, close: node.span.end - 1, entries: members.map((member): FlowEntry => ({ start: member.start, end: member.end })) };
  const planned = flowRemove(bytes, box, index);
  return edit(planned.start, planned.end, planned.text);
}

/** The span of the key `key` of the object `container` (v1.15 FR-013): for a diagnostic, so it needs the reader's line and column. */
export function jsonKeyRange(facts: JsonFacts, container: Found, key: string): { readonly start: number; readonly end: number } | undefined {
  const member = membersOf(facts.bytes, container.node).find((candidate) => candidate.key === key);
  return member?.keyStart === undefined || member.keyEnd === undefined ? undefined : { start: member.keyStart, end: member.keyEnd };
}

export function isIndex(segment: string): boolean {
  return ARRAY_INDEX.test(segment);
}

void lineStartOf;
export type { SourceSpan };
