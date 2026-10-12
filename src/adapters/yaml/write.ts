/**
 * The YAML half of writing a value back — SPEC.md Article IX (§19, v1.10);
 * specs/018-write-value.
 *
 * `findYaml` walks the pointer through the `yaml` document the reader parsed
 * (`parseYamlBytes`' `onDocument` hook: ranges already in stored indices,
 * v1.9) rather than through Cascata's model, because the model has forgotten
 * what a writer needs: that a value arrived through an alias or a merge key,
 * what style the scalar was written in, and whether it sits in a flow
 * collection. Spans still come from the reader's own `toSourceSpan`, so a
 * located range is exactly the span `parse` reports.
 *
 * `renderYamlString` is FR-008. A plain scalar is the nicest spelling and the
 * easiest to get wrong, so the rule is conservative on purpose: **plain only
 * if it reads back as the same string under Cascata's reader and under YAML
 * 1.1's** (`yes`, `no`, `on`, `off`, `y`, `n` are strings to Cascata and
 * booleans to a reader that has not heard of YAML 1.2). Whatever is not
 * plainly safe is quoted — in the style the replaced scalar used where that
 * style can hold the text, double-quoted with YAML escapes where it cannot.
 * The probe behind each clause is in `specs/018-write-value/plan.md`.
 */

import { isAlias, isMap, isScalar, isSeq } from "yaml";
import type { Document, Node as YamlNode, Pair } from "yaml";
import type { Diagnostic } from "../../diagnostics/diagnostic.js";
import type { Node } from "../../model/node.js";
import { ARRAY_INDEX, pointersInDocument, resolvePointer, unescapePointerSegment } from "../../model/pointer.js";
import type { Origin, SourceSpan } from "../../model/span.js";
import { editDiagnostic, type FindResult, type Found, type FormatOpened, type LocatedKind, type ScalarStyle, type SharedEdits } from "../edit.js";
import type { ParseLimits } from "../limits.js";
import type { AnchorTable } from "./anchors.js";
import { asNode, newFacts, parentsIn, recordSite, siteOf, tokensIn, type Facts, type Site } from "./facts.js";
import { planYamlAdd, planYamlRemove, planYamlReplace } from "./insert.js";
import { parseYamlBytes, type YamlSpans } from "./parse.js";

// --- finding a value ------------------------------------------------------

interface Reach {
  readonly node: YamlNode;
  /** The first alias (or merge key's alias) the path went through. */
  readonly via: SourceSpan | undefined;
  readonly inFlow: boolean;
}

function isMergeKey(key: unknown): boolean {
  return isScalar(key) && typeof key.value === "symbol";
}

function keyText(key: YamlNode | null, anchors: AnchorTable): string | undefined {
  if (key === null) return undefined;
  if (isScalar(key)) return typeof key.value === "string" ? key.value : undefined;
  if (isAlias(key)) {
    const target = anchors.targetOf(key);
    return target !== undefined && isScalar(target) && typeof target.value === "string" ? target.value : undefined;
  }
  return undefined;
}

/** What `lookup` found: the value, the alias it came through, and the pair and the map that holds the pair (a merge source, when found through a merge key). */
interface Looked {
  readonly value: YamlNode | null;
  readonly via: SourceSpan | undefined;
  readonly pair: Pair;
  readonly owner: YamlNode;
  readonly index: number;
}

/** `segment` in `map`: a direct pair, else through a merge key (earlier sources win), remembering the alias it came through. */
function lookup(map: YamlNode, segment: string, anchors: AnchorTable, spans: YamlSpans, via: SourceSpan | undefined): Looked | undefined {
  if (!isMap(map)) return undefined;
  for (const [index, pair] of map.items.entries()) {
    if (!isMergeKey(pair.key) && keyText(asNode(pair.key), anchors) === segment) {
      return { value: asNode(pair.value), via, pair, owner: map, index };
    }
  }
  return lookupMerged(map, segment, anchors, spans, via);
}

/** `segment` in the sources of `map`'s merge keys only. */
function lookupMerged(map: YamlNode, segment: string, anchors: AnchorTable, spans: YamlSpans, via: SourceSpan | undefined): Looked | undefined {
  if (!isMap(map)) return undefined;
  for (const pair of map.items) {
    const value = asNode(pair.value);
    if (!isMergeKey(pair.key) || value === null) continue;
    for (const candidate of isSeq(value) ? value.items.map(asNode) : [value]) {
      if (candidate === null) continue;
      const source = isAlias(candidate) ? anchors.targetOf(candidate) : candidate;
      if (source === undefined) continue;
      const aliasSpan = isAlias(candidate) && candidate.range != null ? spans.spanOf(candidate.range) : undefined;
      const found = lookup(source, segment, anchors, spans, via ?? aliasSpan);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** The span of the key `key` of the mapping `container` is, whether the pair is its own or a merge key supplies it (v1.15 FR-013). */
export function yamlKeySpan(facts: Facts, container: Found, key: string): SourceSpan | undefined {
  const node = siteOf(container).node;
  if (node === null || !isMap(node)) return undefined;
  const looked = lookup(node, key, facts.anchors, facts.spans, undefined);
  const keyNode = looked === undefined ? null : asNode(looked.pair.key);
  return keyNode?.range == null ? undefined : facts.spans.spanOf(keyNode.range);
}

/**
 * Whether the pair `target` is, in a mapping whose merge keys supply the same key, overrides a merged value (v1.15 FR-018):
 * removing it would let the merged value show through. Answers the key's span and the merged value's.
 */
export function yamlMergedUnder(facts: Facts, target: Found): { readonly key: SourceSpan; readonly merged: SourceSpan } | undefined {
  const site = siteOf(target);
  const owner = site.parent;
  if (owner === undefined || !isMap(owner) || site.pair === undefined) return undefined;
  const keyNode = asNode(site.pair.key);
  const name = keyText(keyNode, facts.anchors);
  if (keyNode?.range == null || name === undefined) return undefined;
  const supplied = lookupMerged(owner, name, facts.anchors, facts.spans, undefined);
  const mergedNode = supplied === undefined ? null : supplied.value;
  if (supplied === undefined || mergedNode === null) return undefined;
  const merged = spanOfNode(mergedNode, facts.spans);
  return merged === undefined ? undefined : { key: facts.spans.spanOf(keyNode.range), merged };
}

function spanOfNode(node: YamlNode, spans: YamlSpans): SourceSpan | undefined {
  if (node.range == null) return undefined;
  return isMap(node) || isSeq(node) ? spans.tightSpanOf(node.range) : spans.spanOf(node.range);
}

function styleOf(node: YamlNode): ScalarStyle {
  if (!isScalar(node)) return "plain";
  switch (node.type) {
    case "QUOTE_SINGLE":
      return "single";
    case "QUOTE_DOUBLE":
      return "double";
    case "BLOCK_LITERAL":
    case "BLOCK_FOLDED":
      return "block";
    default:
      return "plain";
  }
}

/** The first alias (in document order) that refers to `node`, if anyone uses it — the table knows, from the one walk that built it. */
function firstAliasTo(node: YamlNode, anchors: AnchorTable, spans: YamlSpans): SourceSpan | undefined {
  const alias = anchors.firstAliasTo(node);
  return alias?.range != null ? spans.spanOf(alias.range) : undefined;
}

/**
 * Every alias whose expansion holds `holder` (v1.12 FR-005, `"warn"`): an alias to it or to any
 * container above it — a merge key's alias among them — and, since such an alias is itself a
 * place in the document, every alias to a container above that alias, and so on. Document order.
 */
function aliasesHolding(holder: YamlNode, facts: Facts): SourceSpan[] {
  const { anchors, spans } = facts;
  const parents = parentsIn(facts);
  const seen = new Set<YamlNode>();
  const found: SourceSpan[] = [];
  const work: YamlNode[] = [holder];
  for (let place = work.pop(); place !== undefined; place = work.pop()) {
    for (let at: YamlNode | undefined = place; at !== undefined; at = parents.get(at)) {
      for (const alias of anchors.aliasesTo(at)) {
        if (seen.has(alias)) continue;
        seen.add(alias);
        if (alias.range != null) found.push(spans.spanOf(alias.range));
        work.push(alias);
      }
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

type OpenOutcome<T> = { readonly ok: true; readonly opened: T } | { readonly ok: false; readonly diagnostics: Diagnostic[] };

/** Every document is parsed once (v1.15 FR-004); what the writer keeps of the parse is in `facts.ts`. */
export function openYaml(bytes: Uint8Array, origin: Origin, limits: Partial<ParseLimits> | undefined): OpenOutcome<FormatOpened> {
  const captured: { doc?: Document; spans?: YamlSpans; anchors?: AnchorTable } = {};
  const outcome = parseYamlBytes(bytes, origin, limits, (doc, spans, anchors) => {
    captured.doc = doc;
    captured.anchors = anchors;
    captured.spans = spans;
  });
  if (!outcome.ok) {
    return outcome;
  }
  const { doc, spans, anchors } = captured;
  if (doc === undefined || spans === undefined || anchors === undefined) {
    throw new Error("Internal error: the YAML reader parsed a document without handing it over");
  }
  const facts = newFacts(bytes, doc, spans, anchors, outcome.tree);
  return {
    ok: true,
    opened: {
      tree: outcome.tree,
      find: (pointer, sharedEdits) => findIn(facts, pointer, sharedEdits),
      replace: (found, _pointer, data) => planYamlReplace(facts, found, data),
      add: (container, at, data) => planYamlAdd(facts, container, at, data),
      remove: (target) => planYamlRemove(facts, target),
      keySpan: (container, key) => yamlKeySpan(facts, container, key),
      mergedUnder: (target) => yamlMergedUnder(facts, target),
    },
  };
}

/**
 * The value at `pointer`, as the reader measured it, in a document already parsed. Under `sharedEdits: "refuse"` a value reached
 * through an alias or merge key is refused here (`edit-target-shared`, at the alias); under `"warn"`
 * and `"allow"` (v1.12 FR-007) the walk goes through the alias and answers the bytes that hold the
 * value — the anchored node's — with `sharedBy` set, so `setValue` knows the edit changes more than
 * one place.
 */
function findIn(facts: Facts, pointer: string, sharedEdits: SharedEdits): FindResult {
  const { bytes, doc, spans, anchors } = facts;
  const outcome = { tree: facts.tree };
  const segments = pointer === "" ? [] : pointer.slice(1).split("/").map(unescapePointerSegment);
  const rootSpan = outcome.tree.span;
  const absent = (ancestor: SourceSpan): FindResult => ({
    ok: false,
    diagnostics: [editDiagnostic("edit-target-absent", `No value at '${pointer}'; the nearest existing ancestor is shown`, ancestor)],
  });

  // An empty document is a null scalar the reader invented, with nothing in the AST to walk.
  if (doc.contents === null) {
    if (segments.length > 0) return absent(rootSpan);
    const empty: Found = { start: rootSpan.start, end: rootSpan.end, node: outcome.tree, span: rootSpan, style: "plain", inFlow: false };
    recordSite(empty, { node: null, parent: undefined, pair: undefined, index: 0, inFlow: false });
    return { ok: true, found: empty };
  }

  // A value is shared not only when reached through an alias but when it, or
  // any container above it, is anchored and an alias points there: writing it
  // would change the alias's copy too (the round trip in the corpus caught this).
  let sharedBy: SourceSpan | undefined = firstAliasTo(doc.contents, anchors, spans);
  let reach: Reach = { node: doc.contents, via: undefined, inFlow: false };
  let ancestor = spanOfNode(doc.contents, spans) ?? rootSpan;
  let holder: { readonly parent: YamlNode; readonly pair: Pair | undefined; readonly index: number } | undefined;
  // The sites on the way down, each knowing the one above it (`Site.up`).
  let up: Site = { node: doc.contents, parent: undefined, pair: undefined, index: 0, inFlow: false };
  for (const segment of segments) {
    let { node, via, inFlow } = reach;
    if (isAlias(node)) {
      const target = anchors.targetOf(node);
      if (target === undefined) return absent(ancestor);
      via ??= node.range != null ? spans.spanOf(node.range) : undefined;
      node = target;
    }
    let next: { value: YamlNode | null; via: SourceSpan | undefined } | undefined;
    let nextHolder: typeof holder;
    if (isMap(node)) {
      const looked = lookup(node, segment, anchors, spans, via);
      next = looked;
      nextHolder = looked === undefined ? undefined : { parent: looked.owner, pair: looked.pair, index: looked.index };
      inFlow ||= node.flow === true;
    } else if (isSeq(node)) {
      const item = ARRAY_INDEX.test(segment) ? node.items[Number(segment)] : undefined;
      next = item === undefined ? undefined : { value: asNode(item), via };
      nextHolder = item === undefined ? undefined : { parent: node, pair: undefined, index: Number(segment) };
      inFlow ||= node.flow === true;
    }
    ancestor = spanOfNode(node, spans) ?? ancestor;
    if (next === undefined) return absent(ancestor);
    if (next.value === null) {
      // A pair with no value node at all (`? a`, or `{a}` in flow): the reader's null scalar is the value, spanning zero
      // width at the end of the key (v1.12 FR-010). In a block mapping a value goes on the next line, under the `?`.
      const modelNode = resolvePointer(outcome.tree, pointer);
      if (modelNode === undefined) return absent(ancestor);
      const mapSpan = spanOfNode(node, spans);
      const indicator = inFlow || mapSpan === undefined ? undefined : `\n${" ".repeat(mapSpan.column - 1)}: `;
      const shared = next.via ?? sharedBy;
      const bare: Found = { start: modelNode.span.start, end: modelNode.span.end, node: modelNode, span: modelNode.span, style: "plain", inFlow, bareKey: { indicator }, ...(shared !== undefined ? { sharedBy: shared } : {}) };
      recordSite(bare, { node: null, parent: nextHolder?.parent, pair: nextHolder?.pair, index: nextHolder?.index ?? 0, inFlow, up });
      return { ok: true, found: bare };
    }
    sharedBy ??= firstAliasTo(next.value, anchors, spans);
    reach = { node: next.value, via: next.via, inFlow };
    holder = nextHolder;
    up = { node: next.value, parent: nextHolder?.parent, pair: nextHolder?.pair, index: nextHolder?.index ?? 0, inFlow, up };
  }

  let { node, via } = reach;
  if (isAlias(node)) {
    const aliasSpan = node.range != null ? spans.spanOf(node.range) : undefined;
    via ??= aliasSpan;
    const target = anchors.targetOf(node);
    if (target !== undefined && sharedEdits !== "refuse") node = target;
  }
  if (via !== undefined && sharedEdits === "refuse") {
    const diagnostic: Diagnostic = editDiagnostic("edit-target-shared", `The value at '${pointer}' is reached through an alias or merge key; writing it would change every place that shares it`, via);
    return { ok: false, diagnostics: [diagnostic] };
  }
  sharedBy = via ?? sharedBy;
  const span = spanOfNode(node, spans);
  const modelNode: Node | undefined = resolvePointer(outcome.tree, pointer);
  if (span === undefined || modelNode === undefined) {
    throw new Error("Internal error: the YAML reader and the AST walk disagree about where a value is");
  }
  const valueAt = !isAlias(node) && node.range != null ? node.range[0] : undefined;
  // The tag's bytes are found in `yaml`'s tokens the first time an edit needs to drop it (v1.15 FR-004), not when it is merely located.
  const tag = valueAt !== undefined && typeof node.tag === "string" ? { holds: TAG_HOLDS.get(node.tag), drop: () => tagDrop(facts, valueAt) } : undefined;
  const sharedWith = sharedBy !== undefined && sharedEdits === "warn" ? aliasesHolding(node, facts) : undefined;
  // Every node the reader says holds this value's bytes — the value, its alias and merge-key copies, by the model's
  // span rather than the walk's, so a walk that stopped short of the bytes is caught — for the read-back to check each.
  const copies = sharedBy !== undefined ? pointersInDocument(outcome.tree, modelNode.span) : undefined;
  const found: Found = {
    start: span.start,
    end: span.end,
    node: modelNode,
    span,
    style: styleOf(node),
    inFlow: reach.inFlow,
    ...(sharedBy !== undefined ? { sharedBy } : {}),
    ...(sharedWith !== undefined ? { sharedWith } : {}),
    ...(copies !== undefined ? { copies } : {}),
    ...(tag !== undefined ? { tag } : {}),
  };
  recordSite(found, { node, parent: holder?.parent, pair: holder?.pair, index: holder?.index ?? 0, inFlow: reach.inFlow, ...(segments.length > 0 ? { up: up.up } : {}) });
  return { ok: true, found };
}

/** The kind each core-schema scalar tag holds (v1.12 FR-011). */
const TAG_HOLDS: ReadonlyMap<string, LocatedKind> = new Map<string, LocatedKind>([
  ["tag:yaml.org,2002:map", "mapping"],
  ["tag:yaml.org,2002:seq", "sequence"],
  ["tag:yaml.org,2002:str", "string"],
  ["tag:yaml.org,2002:int", "int"],
  ["tag:yaml.org,2002:float", "float"],
  ["tag:yaml.org,2002:bool", "bool"],
  ["tag:yaml.org,2002:null", "null"],
]);

const isBlank = (byte: number | undefined): boolean => byte === 0x20 || byte === 0x09;

/**
 * Where the explicit tag of the value starting at stored index `valueAt` is, and where the bytes kept after it
 * begin (v1.12 FR-011; v1.12.1). The tag is read from `yaml`'s own tokens, not scanned for: going back from the
 * value over blanks, line breaks, comments and an anchor, the first other token is the tag or there is none. So
 * a tag on an earlier line, and one under a `%TAG` handle, are found as one on the value's line is. The tag and
 * the blanks after it go; if a line break follows them, so do the blanks before it (`a:` keeps no trailing space).
 * Everything else between the tag and the value — a line break, a comment, an anchor — is carried again.
 */
function tagDrop(facts: Facts, valueAt: number): { start: number; kept: number } | undefined {
  const { bytes, spans } = facts;
  const tokens = tokensIn(facts);
  let index = tokens.length - 1;
  while (index >= 0 && spans.toStored(tokens[index]?.offset ?? 0) >= valueAt) index -= 1;
  for (; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token === undefined || token.type === "tag") break;
    if (token.type !== "space" && token.type !== "newline" && token.type !== "comment" && token.type !== "anchor") return undefined;
  }
  const tag = tokens[index];
  if (tag === undefined) return undefined;
  const byteAt = (parserIndex: number): number => {
    const stored = spans.toStored(parserIndex);
    return spans.spanOf([stored, stored, stored]).start;
  };
  let start = byteAt(tag.offset);
  let kept = byteAt(tag.end);
  while (isBlank(bytes[kept])) kept += 1;
  if (bytes[kept] === 0x0a || bytes[kept] === 0x0d) {
    while (isBlank(bytes[start - 1])) start -= 1;
  }
  return { start, kept };
}

/** Parse bytes the way the reader does, for the read-back; `undefined` if they do not parse. */
export function parseBack(bytes: Uint8Array, origin: Origin, limits: Partial<ParseLimits> | undefined): Node | undefined {
  const outcome = parseYamlBytes(bytes, origin, limits);
  return outcome.ok ? outcome.tree : undefined;
}

export { renderYamlString, yamlNonFinite, yamlPadding } from "./spell.js";
