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

import { isAlias, isMap, isNode, isScalar, isSeq } from "yaml";
import type { Document, Node as YamlNode } from "yaml";
import type { Diagnostic } from "../../diagnostics/diagnostic.js";
import type { Node } from "../../model/node.js";
import { pointersInDocument, resolvePointer, unescapePointerSegment } from "../../model/pointer.js";
import type { Origin, SourceSpan } from "../../model/span.js";
import { editDiagnostic, type FindResult, type Found, type ScalarStyle, type SharedEdits } from "../edit.js";
import type { ParseLimits } from "../limits.js";
import type { AnchorTable } from "./anchors.js";
import { parseYamlBytes, type YamlSpans } from "./parse.js";

// --- finding a value ------------------------------------------------------

interface Reach {
  readonly node: YamlNode;
  /** The first alias (or merge key's alias) the path went through. */
  readonly via: SourceSpan | undefined;
  readonly inFlow: boolean;
}

/** `yaml` types a pair's key and value `unknown`; this narrows them with the library's own guard instead of a cast. */
function asNode(value: unknown): YamlNode | null {
  return isNode(value) ? value : null;
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

/** `segment` in `map`: a direct pair, else through a merge key (earlier sources win), remembering the alias it came through. */
function lookup(map: YamlNode, segment: string, anchors: AnchorTable, spans: YamlSpans, via: SourceSpan | undefined): { value: YamlNode | null; via: SourceSpan | undefined } | undefined {
  if (!isMap(map)) return undefined;
  for (const pair of map.items) {
    if (!isMergeKey(pair.key) && keyText(asNode(pair.key), anchors) === segment) {
      return { value: asNode(pair.value), via };
    }
  }
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

/** Each node's parent in the AST (a pair is skipped: a key's and a value's parent is the mapping). One walk. */
function parentsOf(doc: Document): Map<YamlNode, YamlNode> {
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

/**
 * Every alias whose expansion holds `holder` (v1.12 FR-005, `"warn"`): an alias to it or to any
 * container above it — a merge key's alias among them — and, since such an alias is itself a
 * place in the document, every alias to a container above that alias, and so on. Document order.
 */
function aliasesHolding(holder: YamlNode, doc: Document, anchors: AnchorTable, spans: YamlSpans): SourceSpan[] {
  const parents = parentsOf(doc);
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

/**
 * The value at `pointer`, as the reader measured it. Under `sharedEdits: "refuse"` a value reached
 * through an alias or merge key is refused here (`edit-target-shared`, at the alias); under `"warn"`
 * and `"allow"` (v1.12 FR-007) the walk goes through the alias and answers the bytes that hold the
 * value — the anchored node's — with `sharedBy` set, so `setValue` knows the edit changes more than
 * one place.
 */
export function findYaml(bytes: Uint8Array, origin: Origin, limits: Partial<ParseLimits> | undefined, pointer: string, sharedEdits: SharedEdits): FindResult {
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
  const segments = pointer === "" ? [] : pointer.slice(1).split("/").map(unescapePointerSegment);
  const rootSpan = outcome.tree.span;
  const absent = (ancestor: SourceSpan): FindResult => ({
    ok: false,
    diagnostics: [editDiagnostic("edit-target-absent", `No value at '${pointer}'; the nearest existing ancestor is shown`, ancestor)],
  });

  // An empty document is a null scalar the reader invented, with nothing in the AST to walk.
  if (doc.contents === null) {
    return segments.length > 0 ? absent(rootSpan) : { ok: true, found: { start: rootSpan.start, end: rootSpan.end, node: outcome.tree, span: rootSpan, style: "plain", inFlow: false } };
  }

  // A value is shared not only when reached through an alias but when it, or
  // any container above it, is anchored and an alias points there: writing it
  // would change the alias's copy too (the round trip in the corpus caught this).
  let sharedBy: SourceSpan | undefined = firstAliasTo(doc.contents, anchors, spans);
  let reach: Reach = { node: doc.contents, via: undefined, inFlow: false };
  let ancestor = spanOfNode(doc.contents, spans) ?? rootSpan;
  for (const segment of segments) {
    let { node, via, inFlow } = reach;
    if (isAlias(node)) {
      const target = anchors.targetOf(node);
      if (target === undefined) return absent(ancestor);
      via ??= node.range != null ? spans.spanOf(node.range) : undefined;
      node = target;
    }
    let next: { value: YamlNode | null; via: SourceSpan | undefined } | undefined;
    if (isMap(node)) {
      next = lookup(node, segment, anchors, spans, via);
      inFlow ||= node.flow === true;
    } else if (isSeq(node)) {
      const item = /^\d+$/.test(segment) ? node.items[Number(segment)] : undefined;
      next = item === undefined ? undefined : { value: asNode(item), via };
      inFlow ||= node.flow === true;
    }
    ancestor = spanOfNode(node, spans) ?? ancestor;
    if (next === undefined) return absent(ancestor);
    if (next.value === null) {
      // A pair with no value node at all (`? a`): the reader's null scalar is the value, and it has no bytes.
      const modelNode = resolvePointer(outcome.tree, pointer);
      if (modelNode === undefined) return absent(ancestor);
      return { ok: true, found: { start: modelNode.span.start, end: modelNode.span.end, node: modelNode, span: modelNode.span, style: "plain", inFlow } };
    }
    sharedBy ??= firstAliasTo(next.value, anchors, spans);
    reach = { node: next.value, via: next.via, inFlow };
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
  const sharedWith = sharedBy !== undefined && sharedEdits === "warn" ? aliasesHolding(node, doc, anchors, spans) : undefined;
  // Every node the reader says holds this value's bytes — the value, its alias and merge-key copies, by the model's
  // span rather than the walk's, so a walk that stopped short of the bytes is caught — for the read-back to check each.
  const copies = sharedBy !== undefined ? pointersInDocument(outcome.tree, modelNode.span) : undefined;
  return {
    ok: true,
    found: {
      start: span.start,
      end: span.end,
      node: modelNode,
      span,
      style: styleOf(node),
      inFlow: reach.inFlow,
      ...(sharedBy !== undefined ? { sharedBy } : {}),
      ...(sharedWith !== undefined ? { sharedWith } : {}),
      ...(copies !== undefined ? { copies } : {}),
    },
  };
}

/** Parse bytes the way the reader does, for the read-back; `undefined` if they do not parse. */
export function parseBack(bytes: Uint8Array, origin: Origin, limits: Partial<ParseLimits> | undefined): Node | undefined {
  const outcome = parseYamlBytes(bytes, origin, limits);
  return outcome.ok ? outcome.tree : undefined;
}

// --- spelling -------------------------------------------------------------

/** YAML spells the three non-finite floats `.nan`, `.inf`, `-.inf`. */
export function yamlNonFinite(value: number): string {
  return Number.isNaN(value) ? ".nan" : value > 0 ? ".inf" : "-.inf";
}

/**
 * A value that has no bytes yet (`a:` followed by a line break, `a: # c`) is
 * replaced at an empty range, so the text needs the space the colon wanted
 * before it, and the space a comment needs after it. Both are inside the
 * edit; no byte outside it moves.
 */
export function yamlPadding(bytes: Uint8Array, at: number, text: string): string {
  const before = bytes[at - 1];
  const after = bytes[at];
  const needsBefore = before !== undefined && before !== 0x20 && before !== 0x09 && before !== 0x0a && before !== 0x0d;
  return `${needsBefore ? " " : ""}${text}${after === 0x23 ? " " : ""}`;
}

/** Controls (tab excepted), DEL, C1, the line and paragraph separators, the byte-order mark, and the two noncharacters: never raw in a quoted scalar we write. */
const NEEDS_ESCAPE = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F\u2028\u2029\uFEFF\uFFFE\uFFFF]/;

/** Forms a reader may take for something other than a string: YAML 1.2's core schema and 1.1's (booleans, numbers with `_`, `:` or a base prefix, timestamps, `<<`, `=`). Conservative: a false positive costs a pair of quotes. */
const NOT_A_PLAIN_STRING: readonly RegExp[] = [
  /^(y|n|yes|no|on|off|true|false|null|~)$/i,
  /^[-+]?(\.inf|\.nan)$/i,
  /^[-+]?(\.|\d)[\d_.:,eExXoObBa-fA-F+-]*$/,
  /^\d{4}-\d\d?-\d\d?/,
  /^(<<|=)$/,
];

/** FR-008: may `text` be written plain, here? */
function plainSafe(text: string, inFlow: boolean): boolean {
  if (text === "" || /^\s|\s$/.test(text) || NEEDS_ESCAPE.test(text)) return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(text) || text.startsWith("...")) return false;
  if (/:(\s|$)/.test(text) || /[ \t]#/.test(text)) return false;
  if (inFlow && /[,[\]{}]/.test(text)) return false;
  return !NOT_A_PLAIN_STRING.some((pattern) => pattern.test(text));
}

function doubleQuote(text: string): string {
  let out = '"';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (character === '"') out += '\\"';
    else if (character === "\\") out += "\\\\";
    else if (character === "\n") out += "\\n";
    else if (character === "\r") out += "\\r";
    else if (character === "\t") out += "\\t";
    else if (code === 0x2028 || code === 0x2029 || code === 0xfeff || code === 0xfffe || code === 0xffff) out += `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) out += `\\x${code.toString(16).toUpperCase().padStart(2, "0")}`;
    else out += character;
  }
  return `${out}"`;
}

/** Single quotes hold anything printable on one line; an embedded `'` is doubled. */
function singleQuote(text: string): string | undefined {
  return NEEDS_ESCAPE.test(text) ? undefined : `'${text.replace(/'/g, "''")}'`;
}

export function renderYamlString(text: string, found: Found): string {
  if (found.style === "single") return singleQuote(text) ?? doubleQuote(text);
  if (found.style === "double") return doubleQuote(text);
  return plainSafe(text, found.inFlow) ? text : doubleQuote(text);
}

