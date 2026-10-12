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
import type { Document, Node as YamlNode, Pair } from "yaml";
import type { Node } from "../../model/node.js";
import type { Found } from "../edit.js";
import { countParentWalk, countTokenize } from "../parse-count.js";
import { documentLineBreak } from "../text.js";
import type { YamlSpans } from "./parse.js";
import type { AnchorTable } from "./anchors.js";

export interface RawToken {
  readonly type: string;
  readonly offset: number;
  readonly end: number;
}

/** The block indicators and properties of a document, as byte offsets, each list sorted. */
export interface Indicators {
  readonly dashes: readonly number[];
  readonly colons: readonly number[];
  readonly questionMarks: readonly number[];
  /** `&anchor` and `!tag` tokens: byte start and end. */
  readonly properties: readonly { readonly start: number; readonly end: number }[];
}

export interface Facts {
  readonly bytes: Uint8Array;
  readonly doc: Document;
  readonly spans: YamlSpans;
  readonly anchors: AnchorTable;
  readonly tree: Node;
  parents: Map<YamlNode, YamlNode> | undefined;
  tokens: RawToken[] | undefined;
  indicators: Indicators | undefined;
  eol: string | undefined;
  style: DocumentStyle | undefined;
}

export function newFacts(bytes: Uint8Array, doc: Document, spans: YamlSpans, anchors: AnchorTable, tree: Node): Facts {
  return { bytes, doc, spans, anchors, tree, parents: undefined, tokens: undefined, indicators: undefined, eol: undefined, style: undefined };
}

/** `yaml` types a pair's key and value `unknown`; this narrows them with the library's own guard instead of a cast. */
export function asNode(value: unknown): YamlNode | null {
  return isNode(value) ? value : null;
}

/** The stored byte offset of the stored UTF-16 index `index` that `yaml`'s ranges (rewritten by the reader) hold. */
export function byteAt(facts: Facts, index: number): number {
  return facts.spans.spanOf([index, index, index]).start;
}

/** A node's range as bytes: where it starts, where its value ends and where the node (a trailing comment included) ends. */
export function rangeBytes(facts: Facts, node: YamlNode): { readonly start: number; readonly valueEnd: number; readonly end: number } | undefined {
  if (node.range == null) return undefined;
  return { start: byteAt(facts, node.range[0]), valueEnd: byteAt(facts, node.range[1]), end: byteAt(facts, node.range[2]) };
}

// --- every node's parent -------------------------------------------------------

function parentsOf(doc: Document): Map<YamlNode, YamlNode> {
  countParentWalk();
  const parents = new Map<YamlNode, YamlNode>();
  const stack: YamlNode[] = doc.contents !== null && isNode(doc.contents) ? [doc.contents] : [];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    const children: YamlNode[] = [];
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = asNode(pair.key);
        const value = asNode(pair.value);
        if (key !== null) children.push(key);
        if (value !== null) children.push(value);
      }
    } else if (isSeq(node)) {
      for (const item of node.items) {
        const child = asNode(item);
        if (child !== null) children.push(child);
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
export function parentsIn(facts: Facts): Map<YamlNode, YamlNode> {
  facts.parents ??= parentsOf(facts.doc);
  return facts.parents;
}

// --- yaml's CST tokens -----------------------------------------------------------

/** Every token `yaml`'s CST holds, in the parser's text, in document order. Iterative: a document may nest deeply. */
function sourceTokens(text: string): RawToken[] {
  countTokenize();
  const found: { type: string; offset: number; end: number }[] = [];
  const work: unknown[] = [];
  for (const token of new Parser().parse(text)) work.push(token);
  while (work.length > 0) {
    const at = work.pop();
    if (Array.isArray(at)) {
      for (const item of at) work.push(item);
    } else if (typeof at === "object" && at !== null) {
      const fields: Record<string, unknown> = { ...at };
      const { type, offset, source } = fields;
      if (typeof type === "string" && typeof offset === "number" && typeof source === "string") found.push({ type, offset, end: offset + source.length });
      for (const value of Object.values(fields)) if (typeof value === "object" && value !== null) work.push(value);
    }
  }
  return found.sort((a, b) => a.offset - b.offset);
}

/** The CST tokens, built once per document. */
export function tokensIn(facts: Facts): RawToken[] {
  facts.tokens ??= sourceTokens(facts.spans.parserText);
  return facts.tokens;
}

/** Where each block indicator and property is, in bytes, from the same tokens (built once per document). */
export function indicatorsIn(facts: Facts): Indicators {
  if (facts.indicators !== undefined) return facts.indicators;
  const dashes: number[] = [];
  const colons: number[] = [];
  const questionMarks: number[] = [];
  const properties: { start: number; end: number }[] = [];
  const byteOfParser = (parserIndex: number): number => byteAt(facts, facts.spans.toStored(parserIndex));
  for (const token of tokensIn(facts)) {
    if (token.type === "seq-item-ind") dashes.push(byteOfParser(token.offset));
    else if (token.type === "map-value-ind") colons.push(byteOfParser(token.offset));
    else if (token.type === "explicit-key-ind") questionMarks.push(byteOfParser(token.offset));
    else if (token.type === "anchor" || token.type === "tag") properties.push({ start: byteOfParser(token.offset), end: byteOfParser(token.end) });
  }
  facts.indicators = { dashes, colons, questionMarks, properties };
  return facts.indicators;
}

/** The index of the last entry of `sorted` that is below `bound`, or -1. */
export function lastBelow(sorted: readonly number[], bound: number): number {
  let low = 0;
  let high = sorted.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((sorted[mid] ?? 0) < bound) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/** The index of the first entry of `sorted` that is at or above `bound`, or `sorted.length`. */
export function firstAtOrAbove(sorted: readonly number[], bound: number): number {
  return lastBelow(sorted, bound) + 1;
}

// --- the document's own style ------------------------------------------------------

export function lineBreakOf(facts: Facts): string {
  facts.eol ??= documentLineBreak(facts.bytes);
  return facts.eol;
}

export function columnOf(bytes: Uint8Array, at: number): number {
  let i = at;
  while (i > 0 && bytes[i - 1] !== 0x0a && bytes[i - 1] !== 0x0d) i -= 1;
  return at - i;
}

/** The indentation habits of a document, from its first use of each (v1.15 FR-009). */
export interface DocumentStyle {
  /** Spaces per level: the first increase of indentation the document uses, else two. */
  readonly step: number;
  /** Whether a block sequence under a mapping's key is indented (`key:\n  - a`) rather than flush (`key:\n- a`); indented when the document has none to copy. */
  readonly dashIndented: boolean;
}

/**
 * The document's indentation step and dash habit: the first block mapping nested in a block mapping, or the first block
 * sequence under a key, in document order. Found by one walk, which stops as soon as it has both.
 */
export function styleOf(facts: Facts): DocumentStyle {
  if (facts.style !== undefined) return facts.style;
  const { bytes } = facts;
  const startOf = (node: YamlNode): number | undefined => (node.range == null ? undefined : byteAt(facts, node.range[0]));
  let step: number | undefined;
  let dashIndented: boolean | undefined;
  const stack: YamlNode[] = facts.doc.contents !== null && isNode(facts.doc.contents) ? [facts.doc.contents] : [];
  for (let node = stack.pop(); node !== undefined && (step === undefined || dashIndented === undefined); node = stack.pop()) {
    const children: YamlNode[] = [];
    if (isMap(node)) {
      const first = asNode(node.items[0]?.key);
      const firstAt = first === null ? undefined : startOf(first);
      for (const pair of node.items) {
        const value = asNode(pair.value);
        if (value === null) continue;
        children.push(value);
        const at = startOf(value);
        if (node.flow === true || firstAt === undefined || at === undefined || !isBlockCollection(value)) continue;
        const offset = columnOf(bytes, at) - columnOf(bytes, firstAt);
        if (isMap(value) && step === undefined && offset > 0) step = offset;
        if (isSeq(value)) {
          dashIndented ??= offset > 0;
          if (offset > 0) step ??= offset;
        }
      }
    } else if (isSeq(node)) {
      for (const item of node.items) {
        const child = asNode(item);
        if (child !== null) children.push(child);
      }
    }
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (child !== undefined) stack.push(child);
    }
  }
  facts.style = { step: step ?? 2, dashIndented: dashIndented ?? true };
  return facts.style;
}

// --- where a found value sits -----------------------------------------------------

/**
 * Where a value found by the writer sits in the AST: the collection that holds it and the pair or index it is, whether
 * a flow collection is on the path (a block one cannot sit inside it). `node` is the value's AST node -- the anchored
 * one, where the walk went through an alias the policy lets it pass -- or `null` for a pair that has no value node.
 */
export interface Site {
  readonly node: YamlNode | null;
  /** The map or sequence holding the value; `undefined` for the document's root. */
  readonly parent: YamlNode | undefined;
  readonly pair: Pair | undefined;
  readonly index: number;
  readonly inFlow: boolean;
  /** The site of the collection that holds this value (the one before it on the path from the root); `undefined` at the root. */
  readonly up?: Site;
}

const sites = new WeakMap<Found, Site>();

/** Remember where a `Found` value sits, for the operations that edit around it (`insert.ts`). */
export function recordSite(found: Found, site: Site): void {
  sites.set(found, site);
}

export function siteOf(found: Found): Site {
  const site = sites.get(found);
  if (site === undefined) throw new Error("Internal error: a Found value the YAML writer did not make");
  return site;
}

export function isBlockCollection(node: YamlNode | null): boolean {
  return node !== null && (isMap(node) || isSeq(node)) && node.flow !== true;
}

