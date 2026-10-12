/**
 * Replacing, adding and removing in a YAML document -- SPEC.md Article IX (v1.15); specs/025-open-insert-delete.
 *
 * Everything here answers a **plan**: bytes to put in a range of the document as opened. The range is measured
 * from the `yaml` AST the reader already holds (ranges rewritten to stored indices, `facts.ts`) and from `yaml`'s own
 * CST tokens for the characters no AST range covers: a block sequence's `-`, a mapping's `:` and `?`, an anchor or
 * a tag. Style is copied from the nearest sibling, then from the document (`render.ts` spells the value):
 * block or flow, indentation, the blanks after `:` and `,`, a sequence's dash.
 *
 * Where a block entry ends (FR-023's probe, specs/025-open-insert-delete/report.md): `yaml`'s range for a value ends
 * at the value for a scalar, an alias or a flow collection -- a trailing comment and the line break are not in it --
 * and after the line break for a block scalar and a block collection. `entryLineEnd` (text.ts) turns either into
 * "the first byte after the line the entry ends on".
 */

import { isMap, isPair, isSeq } from "yaml";
import type { Node as YamlNode, Pair } from "yaml";
import { isContainerData, isEmptyData, kindOfNew, type EditData } from "../edit-data.js";
import type { Found } from "../edit.js";
import { flowAdd, flowRemove, type FlowBox, type FlowEntry } from "../flow.js";
import { edit, refusal, type Plan } from "../plan.js";
import { attachedCommentsStart, breakLengthBefore, entryLineEnd, isBreak, lineContentEnd, lineStartOf, nextLineStart, skipBlanksBackward, skipBlanksForward, startsItsLine } from "../text.js";
import { asNode, byteAt, columnOf, firstAtOrAbove, indicatorsIn, lastBelow, lineBreakOf, parentsIn, rangeBytes, siteOf, styleOf, type Facts, type Indicators, type Site } from "./facts.js";
import { blockLines, entryAt, flowText, inlineText, isInline, itemAt, keySpelling, scalarSpelling, Unrepresentable, type YamlStyle } from "./render.js";
import { yamlPadding } from "./spell.js";

const decoder = new TextDecoder();
const text = (bytes: Uint8Array, from: number, to: number): string => decoder.decode(bytes.subarray(from, to));
const spaces = (count: number): string => " ".repeat(count);

/** The blanks that precede `at` on its line, or as many spaces as there are bytes when something else does (`- `, `? `). */
function columnString(bytes: Uint8Array, at: number): string {
  const start = lineStartOf(bytes, at);
  return startsItsLine(bytes, at) ? text(bytes, start, at) : spaces(at - start);
}

// --- entries -----------------------------------------------------------------------

/** One entry of a collection: a pair of a mapping, an item of a sequence. */
interface Extent {
  /** The first byte of the entry: its `?`, its key (with the properties before it), its `-`. */
  readonly start: number;
  /** Where its value starts (the byte after the key, for a pair with no value node). */
  readonly valueStart: number;
  /** Where its value ends, as `yaml` measures it. */
  readonly valueEnd: number;
  /** For a pair: where its key starts and ends. */
  readonly keyStart?: number;
  readonly keyEnd?: number;
}

/** The property token (`&anchor`, `!tag`) that ends at `at`, ignoring blanks, if any. */
function propertyEndingAt(indicators: Indicators, bytes: Uint8Array, at: number): { start: number; end: number } | undefined {
  const target = skipBlanksBackward(bytes, at);
  let low = 0;
  let high = indicators.properties.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const property = indicators.properties[mid];
    if (property === undefined) return undefined;
    if (property.end === target) return property;
    if (property.end < target) low = mid + 1;
    else high = mid - 1;
  }
  return undefined;
}

function withProperties(facts: Facts, at: number): number {
  const indicators = indicatorsIn(facts);
  let start = at;
  for (let property = propertyEndingAt(indicators, facts.bytes, start); property !== undefined; property = propertyEndingAt(indicators, facts.bytes, start)) start = property.start;
  return start;
}

/**
 * Where the last thing a node holds ends, in bytes. A block collection's own `range` end is not that: when its last value is
 * empty (`name: # one`) the comment lines that follow, and the next line's indentation, are part of the empty value's range and
 * so of the collection's (probed: v1.15 report, FR-023). The end of an entry is the end of its last leaf.
 */
function contentEnd(facts: Facts, node: YamlNode): number {
  let at: YamlNode = node;
  for (;;) {
    if ((isMap(at) || isSeq(at)) && at.flow !== true && at.items.length > 0) {
      const last = at.items[at.items.length - 1];
      if (isPair(last)) {
        const value = asNode(last.value);
        if (value === null) {
          const key = asNode(last.key);
          return key?.range == null ? byteAt(facts, at.range?.[1] ?? 0) : byteAt(facts, key.range[1]);
        }
        at = value;
      } else {
        const item = asNode(last);
        if (item === null) return byteAt(facts, at.range?.[1] ?? 0);
        at = item;
      }
    } else {
      return rangeBytes(facts, at)?.valueEnd ?? 0;
    }
  }
}

function pairExtent(facts: Facts, pair: Pair): Extent | undefined {
  const key = asNode(pair.key);
  if (key === null || key.range == null) return undefined;
  const { bytes } = facts;
  const keyStart = byteAt(facts, key.range[0]);
  const keyEnd = byteAt(facts, key.range[1]);
  let start = withProperties(facts, keyStart);
  const indicators = indicatorsIn(facts);
  const question = lastBelow(indicators.questionMarks, start);
  const mark = question < 0 ? undefined : indicators.questionMarks[question];
  if (mark !== undefined && skipBlanksForward(bytes, mark + 1) >= start) start = mark;
  const value = asNode(pair.value);
  const range = value === null ? undefined : rangeBytes(facts, value);
  return { start, valueStart: range?.start ?? keyEnd, valueEnd: value === null ? keyEnd : contentEnd(facts, value), keyStart, keyEnd };
}

/** An item of a block sequence (its dash is found) or of a flow one (its first byte is its own). */
function itemExtent(facts: Facts, item: unknown, block: boolean): Extent | undefined {
  if (isPair(item)) return pairExtent(facts, item);
  const node = asNode(item);
  if (node === null || node.range == null) return undefined;
  const range = rangeBytes(facts, node);
  if (range === undefined) return undefined;
  if (!block) return { start: withProperties(facts, range.start), valueStart: range.start, valueEnd: range.valueEnd };
  const dashes = indicatorsIn(facts).dashes;
  const dash = dashes[lastBelow(dashes, range.start)];
  if (dash === undefined) return undefined;
  return { start: dash, valueStart: range.start, valueEnd: contentEnd(facts, node) };
}

function extentsOf(facts: Facts, collection: YamlNode): (Extent | undefined)[] {
  if (isMap(collection)) return collection.items.map((pair) => pairExtent(facts, pair));
  if (isSeq(collection)) return collection.items.map((item) => itemExtent(facts, item, collection.flow !== true));
  return [];
}

// --- where a value sits ------------------------------------------------------------

type Where = "root" | "pair" | "item" | "flow";

function whereOf(site: Site): Where {
  if (site.parent === undefined) return "root";
  if (site.inFlow) return "flow";
  return isMap(site.parent) ? "pair" : "item";
}

/** The byte just after the `:` or `-` that introduces a value, and the properties (`&anchor`) between it and the value. */
function headEnd(facts: Facts, site: Site, valueStart: number): number | undefined {
  const indicators = indicatorsIn(facts);
  let after: number;
  if (site.pair !== undefined) {
    const key = asNode(site.pair.key);
    if (key === null || key.range == null) return undefined;
    const colon = indicators.colons[firstAtOrAbove(indicators.colons, byteAt(facts, key.range[1]))];
    if (colon === undefined) return undefined;
    after = colon + 1;
  } else {
    const dash = indicators.dashes[lastBelow(indicators.dashes, valueStart)];
    if (dash === undefined) return undefined;
    after = dash + 1;
  }
  let end = after;
  for (const property of indicators.properties) {
    if (property.start >= after && property.end <= valueStart && property.end > end) end = property.end;
  }
  return end;
}

/** The first byte of the pair or item holding the value at `site`. */
function entryStartOf(facts: Facts, site: Site): number | undefined {
  if (site.parent === undefined) return undefined;
  if (site.pair !== undefined) return pairExtent(facts, site.pair)?.start;
  const items = isSeq(site.parent) ? site.parent.items : [];
  return itemExtent(facts, items[site.index], true)?.start;
}

// --- style, copied from the neighbours ---------------------------------------------

function* byDistance(count: number, index: number): Generator<number> {
  for (let distance = 1; distance < count; distance += 1) {
    if (index - distance >= 0) yield index - distance;
    if (index + distance < count) yield index + distance;
  }
}

/** The blanks between a pair's `:` and its value when the value is on the same line, else `undefined`. */
function colonSpacing(facts: Facts, pair: Pair): string | undefined {
  const extent = pairExtent(facts, pair);
  const value = asNode(pair.value);
  if (extent === undefined || value === null || extent.keyEnd === undefined) return undefined;
  const range = rangeBytes(facts, value);
  if (range === undefined || range.start === range.valueEnd) return undefined;
  const colons = indicatorsIn(facts).colons;
  const colon = colons[firstAtOrAbove(colons, extent.keyEnd)];
  if (colon === undefined || colon >= range.start) return undefined;
  const between = text(facts.bytes, colon + 1, range.start);
  return /^[ \t]+$/.test(between) ? between : undefined;
}

/**
 * The style a new value takes at a place whose entries are `parent`'s, near the entry at `index`: the nearest sibling with
 * a same-line scalar gives the blanks after `:`, the nearest with a block mapping the step, the nearest with a block
 * sequence the dash, the nearest with a container its flow-or-block; the document's own habits fill the rest.
 */
function styleNear(facts: Facts, parent: YamlNode | undefined, index: number): YamlStyle {
  const document = styleOf(facts);
  let colon: string | undefined;
  let step: number | undefined;
  let dashIndented: boolean | undefined;
  let flow: boolean | undefined;
  if (parent !== undefined && isMap(parent)) {
    for (const j of byDistance(parent.items.length, index)) {
      const pair = parent.items[j];
      if (pair === undefined) continue;
      const value = asNode(pair.value);
      const extent = pairExtent(facts, pair);
      colon ??= colonSpacing(facts, pair);
      if (value !== null && extent?.keyStart !== undefined && (isMap(value) || isSeq(value))) {
        flow ??= value.flow === true;
        const at = value.range == null ? undefined : byteAt(facts, value.range[0]);
        if (at !== undefined && value.flow !== true) {
          const offset = columnOf(facts.bytes, at) - columnOf(facts.bytes, extent.start);
          if (isMap(value)) step ??= offset > 0 ? offset : undefined;
          else dashIndented ??= offset > 0;
        }
      }
      if (colon !== undefined && step !== undefined && dashIndented !== undefined && flow !== undefined) break;
    }
  }
  return { eol: lineBreakOf(facts), step: step ?? document.step, colon: colon ?? " ", dashIndented: dashIndented ?? document.dashIndented, flow: flow ?? false };
}

function unrepresentable(error: unknown): Plan {
  if (error instanceof Unrepresentable) return refusal("edit-unrepresentable", error.message);
  throw error;
}

function kindOfData(data: EditData): string {
  return Array.isArray(data) ? "sequence" : data instanceof Map ? "mapping" : kindOfNew(data as Parameters<typeof kindOfNew>[0]);
}

// --- replacing a value -------------------------------------------------------------

/**
 * The plan that makes the value at `found` equal `data` where either is a container (v1.15 FR-008): a scalar replaced by a
 * container, a container by either. `forceBlock` writes a new container as lines even where the neighbours or the replaced
 * value are flow (`add` into an empty `{}`, FR-011).
 */
export function planYamlReplace(facts: Facts, found: Found, data: EditData, forceBlock = false): Plan {
  try {
    return replaceValue(facts, found, data, forceBlock);
  } catch (error) {
    return unrepresentable(error);
  }
}

function replaceValue(facts: Facts, found: Found, data: EditData, forceBlock: boolean): Plan {
  const { bytes } = facts;
  const site = siteOf(found);
  const where = whereOf(site);
  const node = site.node;
  const eol = lineBreakOf(facts);
  const oldContainer = node !== null && (isMap(node) || isSeq(node));
  const oldBlock = oldContainer && node.flow !== true;
  const oldStart = found.start;
  // A block collection's span can run on over comment lines that follow an empty last value; the replaced bytes end with its last line.
  const oldEnd = oldBlock && node !== null ? Math.min(found.end, lineContentEnd(bytes, contentEnd(facts, node))) : found.end;

  // A tag that cannot hold the new value is dropped from a scalar (v1.12 FR-011) and refuses a container, which it would contradict.
  let start = oldStart;
  let carried = "";
  const newKind = kindOfData(data);
  if (found.tag !== undefined && found.tag.holds !== newKind) {
    if (oldContainer) return refusal("edit-read-back", `The ${found.node.type} at this place is tagged, and the tag cannot hold a ${newKind}; it is not rewritten`);
    const drop = found.tag.drop();
    if (drop === undefined) throw new Error("Internal error: setValue(): the value has an explicit tag, and the parser's tokens show none");
    start = drop.start;
    carried = text(bytes, drop.kept, oldStart);
  }

  let style: YamlStyle = styleNear(facts, site.parent, site.index);
  if (where === "flow" || found.bareKey !== undefined) style = { ...style, flow: true };
  else if (forceBlock) style = { ...style, flow: false };
  else if (oldContainer) style = { ...style, flow: node.flow === true };

  const entryStart = entryStartOf(facts, site);

  // --- written inline: after the colon, the dash, or in place
  if (isInline(data, style)) {
    const inline = where === "flow" && !isContainerData(data) ? scalarSpelling(data, true) : inlineText(data);
    if (found.bareKey !== undefined) {
      if (found.bareKey.indicator === undefined) return refusal("edit-bare-key-in-flow", "A key with no value inside a flow collection is not written; only a key that has a value, or a block mapping's `? key`, can take one");
      return edit(oldStart, oldEnd, found.bareKey.indicator + yamlPadding(bytes, oldStart, inline).trimStart());
    }
    if (oldBlock && (where === "pair" || where === "item")) {
      const head = headEnd(facts, site, oldStart);
      if (head === undefined) return refusal("edit-read-back", "The place of this value could not be found in the document's tokens");
      if (head >= oldStart || !hasBreak(bytes, head, oldStart)) return edit(head, oldEnd, ` ${inline}`);
      // The container is below its key, the way a block collection is: its lines go, the key's line and break stay.
      const lineEnd = entryLineEnd(bytes, oldEnd);
      const headBreakEnd = nextLineStart(bytes, head);
      const keep = lineEnd >= bytes.length && !isBreak(bytes[lineEnd - 1]) ? text(bytes, head, lineContentEnd(bytes, head)) : text(bytes, head, headBreakEnd);
      return edit(head, lineEnd, ` ${inline}${keep}`);
    }
    if (oldStart === oldEnd && start === oldStart && oldContainer === false) return edit(oldStart, oldEnd, yamlPadding(bytes, oldStart, inline));
    return edit(start, oldEnd, carried + inline);
  }

  // --- written as lines
  const container = data as readonly EditData[] | ReadonlyMap<string, EditData>;
  const isSeqData = Array.isArray(container);
  if (where === "root") {
    const indent = oldBlock ? columnString(bytes, oldStart) : "";
    const lines = blockLines(data, indent, style);
    const first = (lines[0] ?? "").slice(indent.length);
    const body = [first, ...lines.slice(1)].join(eol);
    if (!oldContainer && oldStart === oldEnd && site.node === null) {
      // An empty document: the lines go where its null is, and a comment after them keeps its own line.
      return edit(oldStart, oldEnd, bytes[oldStart] === undefined || isBreak(bytes[oldStart]) ? body : body + eol);
    }
    return edit(start, oldEnd, carried + body);
  }

  if (where === "pair") {
    if (entryStart === undefined) return refusal("edit-read-back", "The place of this value could not be found in the document");
    const pairIndent = columnString(bytes, entryStart);
    const childIndent = oldBlock && node !== null && isMap(node) === !isSeqData ? columnString(bytes, oldStart) : pairIndent + spaces(isSeqData ? (style.dashIndented ? style.step : 0) : style.step);
    const lines = blockLines(data, childIndent, style);
    if (oldBlock) return replaceLines(bytes, oldStart, oldEnd, childIndent, lines, eol);
    if (oldStart === oldEnd && start === oldStart) {
      // Nothing is written after the key (`a:`, or `a: # c`): the lines follow the key's line, comment and all.
      const at = lineContentEnd(bytes, oldStart);
      return edit(at, at, eol + lines.join(eol));
    }
    // What follows the old value on its line (a comment) stays on that line, ahead of the new lines.
    const lineEnd = lineContentEnd(bytes, oldEnd);
    const carriedText = carried.replace(/\s+$/, "");
    return edit(carriedText === "" ? skipBlanksBackward(bytes, start) : start, lineEnd, carriedText + text(bytes, oldEnd, lineEnd) + eol + lines.join(eol));
  }

  // where === "item"
  if (entryStart === undefined) return refusal("edit-read-back", "The place of this value could not be found in the document");
  const dashIndent = columnString(bytes, entryStart);
  if (oldBlock) {
    const head = headEnd(facts, site, oldStart);
    const compact = head === undefined || !hasBreak(bytes, head, oldStart);
    const indent = compact ? `${dashIndent}  ` : columnString(bytes, oldStart);
    const lines = blockLines(data, indent, style);
    if (compact) return edit(oldStart, oldEnd, [(lines[0] ?? "").slice(indent.length), ...lines.slice(1)].join(eol));
    return replaceLines(bytes, oldStart, oldEnd, indent, lines, eol);
  }
  const indent = `${dashIndent}  `;
  const lines = blockLines(data, indent, style);
  const head = headEnd(facts, site, oldStart);
  const bare = head !== undefined && skipBlanksForward(bytes, head) >= (start === oldStart ? oldStart : start) && carried === "";
  if (bare) {
    const body = [(lines[0] ?? "").slice(indent.length), ...lines.slice(1)].join(eol);
    return oldStart === oldEnd ? edit(oldStart, oldEnd, yamlPadding(bytes, oldStart, body)) : edit(start, oldEnd, body);
  }
  const carriedText = carried.replace(/\s+$/, "");
  return edit(carriedText === "" ? skipBlanksBackward(bytes, start) : start, oldEnd, carriedText + eol + lines.join(eol));
}

const hasBreak = (bytes: Uint8Array, from: number, to: number): boolean => {
  for (let i = from; i < to; i += 1) if (isBreak(bytes[i])) return true;
  return false;
};

/** Replace the lines of a block collection with new lines at `indent`: from its first entry's key where that is where the new ones start, else from the line's start. */
function replaceLines(bytes: Uint8Array, oldStart: number, oldEnd: number, indent: string, lines: string[], eol: string): Plan {
  const lineStart = lineStartOf(bytes, oldStart);
  if (text(bytes, lineStart, oldStart) === indent) return edit(oldStart, oldEnd, [(lines[0] ?? "").slice(indent.length), ...lines.slice(1)].join(eol));
  return edit(lineStart, oldEnd, lines.join(eol));
}

// --- adding an entry ---------------------------------------------------------------

export type AddAt = { readonly key: string } | { readonly index: number };

/** The plan that adds `data` at `at` to the container at `container` (v1.15 FR-012). */
export function planYamlAdd(facts: Facts, container: Found, at: AddAt, data: EditData): Plan {
  try {
    return addEntry(facts, container, at, data);
  } catch (error) {
    return unrepresentable(error);
  }
}

function addEntry(facts: Facts, container: Found, at: AddAt, data: EditData): Plan {
  const { bytes } = facts;
  const site = siteOf(container);
  const node = site.node;
  if (node === null || !(isMap(node) || isSeq(node))) throw new Error("Internal error: add() was given a container that is not a collection");
  const eol = lineBreakOf(facts);
  const mapping = isMap(node);
  const count = node.items.length;
  const index = "index" in at ? at.index : count;
  const where = whereOf(site);
  const key = "key" in at ? at.key : "";

  if (count === 0) {
    if (node.flow === true && where !== "flow") {
      // An empty `{}` or `[]` whose own entry is block-style is written block-style when it gains its first entry (FR-011).
      return planYamlReplace(facts, container, mapping ? new Map([[key, data]]) : [data], true);
    }
    // Inside a flow collection it stays flow: the new entry goes between the brackets.
    const range = rangeBytes(facts, node);
    if (range === undefined) throw new Error("Internal error: an empty collection has no range");
    const entry = mapping ? `${keySpelling(key, true)}: ${flowText(data)}` : flowText(data);
    // The brackets are rewritten, not just filled: two adds into one empty container overlap, as FR-015 says, and cannot be applied together.
    return edit(range.start, range.valueEnd, `${mapping ? "{" : "["}${entry}${mapping ? "}" : "]"}`);
  }

  const block = node.flow !== true;
  const extents = extentsOf(facts, node);
  const last = extents[count - 1];
  if (last === undefined) return refusal("edit-read-back", "The entries of this collection could not be found in the document");

  if (!block) {
    const range = rangeBytes(facts, node);
    if (range === undefined) throw new Error("Internal error: a flow collection has no range");
    const entries: FlowEntry[] = [];
    for (const extent of extents) {
      if (extent === undefined) return refusal("edit-read-back", "The entries of this flow collection could not be found in the document");
      entries.push({ start: extent.start, end: extent.valueEnd });
    }
    const box: FlowBox = { open: range.start, close: range.valueEnd - 1, entries };
    const colon = mapping ? flowColon(facts, node) : ": ";
    const entry = mapping ? `${keySpelling(key, true)}${colon}${flowText(data)}` : flowText(data);
    const planned = flowAdd(bytes, box, index, entry, eol, ", ");
    return edit(planned.start, planned.end, planned.text);
  }

  // A block collection: new lines in the style of the entry nearest to where they go.
  const near = Math.min(index, count - 1);
  const style = styleNear(facts, node, near);
  const nearExtent = extents[near] ?? last;
  const indent = columnString(bytes, nearExtent.start);
  const lines = mapping ? entryAt(key, data, indent, style) : itemAt(data, indent, style);

  if (index >= count) {
    const lineEnd = entryLineEnd(bytes, last.valueEnd);
    const atEof = lineEnd >= bytes.length && !isBreak(bytes[lineEnd - 1]);
    const body = lines.join(eol);
    return atEof ? edit(lineEnd, lineEnd, eol + body) : edit(lineEnd, lineEnd, body + eol);
  }

  // Before the entry at `index`, and before the comments directly above it, which belong to it.
  const target = extents[index];
  if (target === undefined) return refusal("edit-read-back", "The entries of this collection could not be found in the document");
  if (!startsItsLine(bytes, target.start)) {
    // The first item of a nested sequence rides on its parent's dash (`- - a`): the new item goes first on that line.
    const body = [(lines[0] ?? "").slice(indent.length), ...lines.slice(1)].join(eol);
    return edit(target.start, target.start, body + eol + indent);
  }
  const lineStart = lineStartOf(bytes, target.start);
  const previous = extents[index - 1];
  const floor = previous === undefined ? firstLineAfterHead(facts, site, node) : entryLineEnd(bytes, previous.valueEnd);
  const from = attachedCommentsStart(bytes, lineStart, floor);
  return edit(from, from, lines.join(eol) + eol);
}

/** The blanks after `:` the pairs of a flow mapping already use, else `: `. */
function flowColon(facts: Facts, map: YamlNode): string {
  if (!isMap(map)) return ": ";
  for (const pair of map.items) {
    const extent = pairExtent(facts, pair);
    const value = asNode(pair.value);
    if (extent?.keyEnd === undefined || value === null) continue;
    const range = rangeBytes(facts, value);
    if (range === undefined) continue;
    const between = text(facts.bytes, extent.keyEnd, range.start);
    if (/^[ \t]*:[ \t]*$/.test(between)) return between.replace(/^[ \t]*/, "");
  }
  return ": ";
}

/** The first byte of the line after the one that introduces the collection (where its first comment can start). */
function firstLineAfterHead(facts: Facts, site: Site, node: YamlNode): number {
  if (site.parent === undefined) return 0;
  const range = rangeBytes(facts, node);
  const head = range === undefined ? undefined : headEnd(facts, site, range.start);
  return head === undefined ? 0 : nextLineStart(facts.bytes, head);
}

// --- removing an entry --------------------------------------------------------------

/** The plan that removes the entry `target` is, with the comments attached to it (v1.15 FR-016, FR-017). */
export function planYamlRemove(facts: Facts, target: Found): Plan {
  const { bytes } = facts;
  const site = siteOf(target);
  const parent = site.parent;
  if (parent === undefined || !(isMap(parent) || isSeq(parent))) throw new Error("Internal error: remove() was given the root");
  const extents = extentsOf(facts, parent);
  const count = parent.items.length;
  const entry = extents[site.index];
  if (entry === undefined) return refusal("edit-read-back", "The entries of this collection could not be found in the document");

  if (parent.flow === true) {
    const range = rangeBytes(facts, parent);
    if (range === undefined) throw new Error("Internal error: a flow collection has no range");
    const entries: FlowEntry[] = [];
    for (const extent of extents) {
      if (extent === undefined) return refusal("edit-read-back", "The entries of this flow collection could not be found in the document");
      entries.push({ start: extent.start, end: extent.valueEnd });
    }
    const planned = flowRemove(bytes, { open: range.start, close: range.valueEnd - 1, entries }, site.index);
    return edit(planned.start, planned.end, planned.text);
  }

  const lineEnd = entryLineEnd(bytes, entry.valueEnd);
  const atEof = lineEnd >= bytes.length && !isBreak(bytes[lineEnd - 1]);
  const wholeLine = startsItsLine(bytes, entry.start);
  // The site of the collection itself, one step up the path the pointer took -- or, where the path went through an alias to reach it,
  // found from the AST (a walk of the whole document, once, the lazily built parents).
  const outer = site.up !== undefined && site.up.node === parent ? site.up : enclosingSite(facts, parent);
  const root = outer !== undefined && outer.parent === undefined;
  if (outer === undefined) return refusal("edit-read-back", "The place of this collection could not be found in the document");

  if (count > 1) {
    if (wholeLine) {
      const lineStart = lineStartOf(bytes, entry.start);
      const previous = extents[site.index - 1];
      const floor = previous !== undefined ? entryLineEnd(bytes, previous.valueEnd) : root ? 0 : firstLineAfterHead(facts, outer, parent);
      let from = attachedCommentsStart(bytes, lineStart, floor);
      if (atEof && from > 0) from -= breakLengthBefore(bytes, from);
      return edit(from, lineEnd, "");
    }
    // The first entry of a collection that begins on its parent's line (`- a: 1`): where only its own indentation separates it
    // from the next entry, the next is pulled up to where it was; where a comment or a blank line comes between, the entry's
    // own lines go and the rest stays (`- # about b` and the entries below it are the same item).
    const next = extents[site.index + 1];
    if (next === undefined || site.index !== 0) return refusal("edit-read-back", "This entry could not be removed in the document's layout");
    if (startsItsLine(bytes, next.start) && text(bytes, lineEnd, next.start).trim() === "") return edit(entry.start, next.start, "");
    return edit(entry.start, lineEnd, "");
  }

  // The only entry: the collection keeps its kind and is written where it was, on its parent's line.
  const empty = isMap(parent) ? "{}" : "[]";
  const brk = atEof ? "" : text(bytes, lineEnd - breakLengthBefore(bytes, lineEnd), lineEnd);
  if (root) {
    if (!wholeLine) return refusal("edit-read-back", "This entry could not be removed in the document's layout");
    return edit(lineStartOf(bytes, entry.start), lineEnd, empty + brk);
  }
  const range = rangeBytes(facts, parent);
  const head = range === undefined ? undefined : headEnd(facts, outer, range.start);
  if (head === undefined) return refusal("edit-read-back", "The place of this collection could not be found in the document");
  if (!wholeLine || !hasBreak(bytes, head, entry.start)) return edit(head, lineEnd, ` ${empty}${brk}`);
  const from = attachedCommentsStart(bytes, lineStartOf(bytes, entry.start), nextLineStart(bytes, head));
  let keep = text(bytes, head, from);
  if (atEof && keep.length > 0) keep = keep.slice(0, keep.length - (keep.endsWith("\r\n") ? 2 : 1));
  return edit(head, lineEnd, ` ${empty}${keep}`);
}

/** Where a collection sits in its own parent, from the AST: the site `Found` made no record of when the pointer reached it through an alias. */
function enclosingSite(facts: Facts, collection: YamlNode): Site | undefined {
  if (asNode(facts.doc.contents) === collection) return { node: collection, parent: undefined, pair: undefined, index: 0, inFlow: false };
  const parent = parentsIn(facts).get(collection);
  if (parent === undefined) return undefined;
  if (isMap(parent)) {
    const index = parent.items.findIndex((pair) => asNode(pair.value) === collection);
    const pair = parent.items[index];
    return pair === undefined ? undefined : { node: collection, parent, pair, index, inFlow: parent.flow === true };
  }
  if (isSeq(parent)) {
    const index = parent.items.findIndex((item) => asNode(item) === collection);
    return index < 0 ? undefined : { node: collection, parent, pair: undefined, index, inFlow: parent.flow === true };
  }
  return undefined;
}
