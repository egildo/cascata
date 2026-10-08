/**
 * The YAML adapter's conversion layer — SPEC.md §4.1, §4.2; plan.md's D1
 * ("a strict conversion layer over `yaml`'s AST, not a parser").
 *
 * `src/adapters/yaml/` is the one format-aware directory in the codebase
 * (Principle IV) — this file is where `yaml` (eemeli's) is imported.
 * Everything below turns its AST into Cascata's format-blind model,
 * computing every span itself rather than trusting the library's ranges
 * verbatim: two empirical findings (recorded in the Phase 3 report, and
 * confirmed independently by re-probing before Phase 4 began) meant
 * `research.md`'s probe table was not quite right about what `yaml` hands
 * back:
 *
 *   1. `range`/`.pos` offsets are **UTF-16 code-unit indices** into the JS
 *      string, not UTF-8 byte offsets, despite research.md's original probe
 *      table calling them "byte offsets". They diverge for any character
 *      above U+007F. `SourceSpan.start`/`.end` are contractually bytes
 *      (data-model.md), so this file converts, via a single-pass byte
 *      offset table built once per document (`buildByteOffsetTable`) —
 *      not by re-encoding a growing prefix per node, which would be
 *      quadratic in document size.
 *   2. `LineCounter#linePos().col` is also UTF-16-code-unit-based, not
 *      code-point-based, so it disagrees with data-model.md's "column is
 *      code points" for any line containing an astral character (one
 *      requiring a UTF-16 surrogate pair) before the position in
 *      question. `LineCounter` is trusted for the *line* number only
 *      (newlines are never surrogate halves, so line-counting is
 *      unaffected); column is recomputed by counting actual Unicode code
 *      points from that line's start.
 *
 * A leading byte-order mark is **kept** (v1.9, SPEC.md §4.2): it is three
 * stored bytes, so `byteOffsetTable` counts it in every offset after it,
 * and a mark at the very start of the stored bytes is never a column
 * (`codePointColumn`; any other U+FEFF is a character). Prefix marks are
 * removed from the text `yaml` reads and its indices mapped back (`marks.ts`).
 *
 * Revised for User Story 2 (Phase 4): FR-019 requires one read to report
 * every floor violation it can detect, not the first. Every conversion
 * function below now returns `Node | undefined` and *records* a
 * diagnostic rather than throwing one, so a violation anywhere does not
 * stop the walk from finding others elsewhere in the document (SC-003).
 * The only two checks that still short-circuit the whole read are the
 * size cap (checked before parsing at all, per contracts/parse-api.md —
 * "nothing was parsed") and an internal-consistency guard that should
 * never fire on real input.
 */

import { LineCounter, isAlias, isMap, isScalar, isSeq, parseDocument, visit } from "yaml";
import type { Alias, Document, ParsedNode, Range, Scalar, YAMLMap, YAMLSeq } from "yaml";
import { DiagnosticCollector } from "../../diagnostics/collector.js";
import { createDiagnostic, type Diagnostic } from "../../diagnostics/diagnostic.js";
import {
  createBoolScalar,
  createFloatScalar,
  createIntScalar,
  createMapping,
  createNullScalar,
  createSequence,
  createStringScalar,
  type Node,
} from "../../model/node.js";
import { createSourceSpan, type Origin, type SourceSpan } from "../../model/span.js";
import { resolveAlias, isMergeKeyPair, mergeSources } from "./expand.js";
import { duplicateKeyDiagnostic, isUnsupportedTag, nonStringKeyDiagnostic, unsupportedTagDiagnostic } from "./floor.js";
import { checkDepthLimit, checkSizeLimit, expansionLimitDiagnostic, resolveLimits, type ParseLimits } from "../limits.js";
import { buildAnchorTable, type AnchorTable } from "./anchors.js";
import { countWritten } from "./budget.js";
import { allMarks, documentPrefixMarks, removePrefixMarks, storedIndexer } from "./marks.js";
import { findFirstInvalidUtf8ByteOffset, locateByteOffset, utf8ByteLength } from "../encoding.js";

// `yaml` merges each of these classes with a `.Parsed` namespace member
// carrying the concrete post-parse shape (a definite `range`, and — for
// collections — `ParsedNode`-typed keys/items rather than the classes'
// own generic defaults of `unknown`). Using the `.Parsed` alias
// consistently, rather than the bare class, is what lets `isMap`/`isSeq`/
// `isScalar` narrow a `ParsedNode`-typed value into something whose
// children are themselves properly typed as `ParsedNode` instead of
// `unknown` — verified against `yaml`'s own `.d.ts` files.
type ScalarNode = Scalar.Parsed;
type MapNode = YAMLMap.Parsed;
type SeqNode = YAMLSeq.Parsed;

/** Mirrors contracts/parse-api.md's `ParseResult` shape; re-exported (as `ParseResult`) from `src/index.ts`. */
export type ParseOutcome = { ok: true; tree: Node } | { ok: false; diagnostics: Diagnostic[] };

const BYTE_ORDER_MARK_UNIT = 0xfeff;

/** A CR that no LF follows (SPEC.md §4.2, v1.9). */
const LONE_CARRIAGE_RETURN = /\r(?!\n)/g;

function utf8ByteLengthOfCodePoint(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/**
 * Build a UTF-16-code-unit-index -> UTF-8-byte-offset table in one pass
 * over the text, indexed 0..text.length inclusive. A surrogate pair's
 * second unit is never itself a valid query point for `yaml`'s ranges (they
 * always land on code-point boundaries), but it is filled in defensively
 * with the byte offset of the code point it belongs to.
 */
function buildByteOffsetTable(text: string): Uint32Array {
  const table = new Uint32Array(text.length + 1);
  let byteOffset = 0;
  let index = 0;
  while (index < text.length) {
    table[index] = byteOffset;
    const codePoint = text.codePointAt(index) ?? 0;
    const isAstral = codePoint > 0xffff;
    if (isAstral) {
      table[index + 1] = byteOffset;
    }
    byteOffset += utf8ByteLengthOfCodePoint(codePoint);
    index += isAstral ? 2 : 1;
  }
  table[text.length] = byteOffset;
  return table;
}

/**
 * Count actual Unicode code points (not UTF-16 units) from `lineStart` up to
 * `target`, 1-based. The one U+FEFF never counted is a byte-order mark at the
 * very start of the stored bytes, index 0 (SPEC.md §4.2, v1.9: it is what an
 * editor's decoder drops); any other — a second mark in a prefix, one inside
 * a quoted scalar — is a character like any other. Every mark is still a
 * byte, which `byteOffsetTable` counts.
 */
function codePointColumn(text: string, lineStart: number, target: number): number {
  let count = 0;
  let index = lineStart;
  while (index < target) {
    const codePoint = text.codePointAt(index);
    if (!(index === 0 && codePoint === BYTE_ORDER_MARK_UNIT)) {
      count += 1;
    }
    index += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
  }
  return count + 1;
}

interface SpanContext {
  readonly origin: Origin;
  readonly text: string;
  readonly lineCounter: LineCounter;
  readonly byteOffsetTable: Uint32Array;
  readonly documentByteLength: number;
}

function lineStartIndex(ctx: SpanContext, utf16Index: number): number {
  const line = ctx.lineCounter.linePos(utf16Index).line;
  return ctx.lineCounter.lineStarts[line - 1] ?? 0;
}

function byteOffsetAt(ctx: SpanContext, utf16Index: number): number {
  return ctx.byteOffsetTable[utf16Index] ?? ctx.documentByteLength;
}

function buildSourceSpan(ctx: SpanContext, startIndex: number, endIndex: number): SourceSpan {
  return createSourceSpan({
    origin: ctx.origin,
    start: byteOffsetAt(ctx, startIndex),
    end: byteOffsetAt(ctx, endIndex),
    line: ctx.lineCounter.linePos(startIndex).line,
    column: codePointColumn(ctx.text, lineStartIndex(ctx, startIndex), startIndex),
    documentLength: ctx.documentByteLength,
  });
}

/** Convert a `yaml` `[start, valueEnd, nodeEnd]` range into a `SourceSpan`. `valueEnd` (not `nodeEnd`) is used as the tight upper bound — see research D1/probe notes above for why `nodeEnd` over-includes trailing content for scalars. */
function toSourceSpan(range: Range, ctx: SpanContext): SourceSpan {
  const [startIndex, valueEndIndex] = range;
  return buildSourceSpan(ctx, startIndex, valueEndIndex);
}

/**
 * Walk `index` left from `endIndex` (never past `startIndex`) while the
 * preceding UTF-16 code unit is ASCII space, tab, CR, or LF.
 */
function trimTrailingWhitespaceIndex(text: string, startIndex: number, endIndex: number): number {
  let index = endIndex;
  while (index > startIndex) {
    const unit = text.charCodeAt(index - 1);
    if (unit === 0x20 || unit === 0x09 || unit === 0x0d || unit === 0x0a) {
      index -= 1;
    } else {
      break;
    }
  }
  return index;
}

/**
 * Convert a **block mapping or sequence's own** range into a `SourceSpan`
 * with a genuinely tight `end` — unlike `toSourceSpan`, which is correct
 * for scalars and flow collections but not for these.
 *
 * `data-model.md` defines `SourceSpan.end` as "one past the last byte";
 * for a scalar and a flow collection (`{}`/`[]`), `yaml`'s own `valueEnd`
 * already lands there (verified: the code unit immediately before it is
 * always real content — a closing `}`/`]`, never whitespace). For a
 * *block* mapping or sequence, `valueEnd` coincides with `nodeEnd` and
 * additionally swallows the line terminator (and any trailing spaces
 * before it) ending the block's final line — `research.md`'s "Open
 * question: block-collection range extents" (v0.1), left unresolved
 * there. That swallowed whitespace is not a byte belonging to the
 * collection; it separates the collection from whatever follows, or from
 * EOF. Trimmed here by walking the raw text backward from the reported
 * end while the preceding unit is ASCII space/tab/CR/LF, which is a
 * no-op for scalars and flow collections and the fix for block ones.
 *
 * Deliberately **not** applied to `toSourceSpan` in general: a `keep`
 * (`|+`) block scalar's trailing newlines are part of its *value*, not
 * separator whitespace (verified empirically — `yaml` reports them
 * inside `Scalar.value` and `valueEnd` accordingly), and trimming those
 * would silently corrupt a span this adapter already gets right.
 */
function toTightCollectionSpan(range: Range, ctx: SpanContext): SourceSpan {
  const [startIndex, valueEndIndex] = range;
  return buildSourceSpan(ctx, startIndex, trimTrailingWhitespaceIndex(ctx.text, startIndex, valueEndIndex));
}

function requireRange(node: { range?: Range | null }): Range {
  if (node.range == null) {
    // Only nodes yaml itself parsed reach this walk, and parseDocument
    // always sets range on those; this is an internal-consistency guard,
    // not a document-shape check.
    throw new Error("Internal error: encountered an AST node with no range during the walk");
  }
  return node.range;
}

interface WalkContext extends SpanContext {
  /** Every alias's target, from one walk (v1.10 FR-001): `Alias#resolve` is never called. */
  readonly anchors: AnchorTable;
  /** AST node references currently on the active expansion path (research D3). */
  readonly activePath: Set<object>;
  /** Accumulates every floor violation found during the walk (FR-019). */
  readonly diagnostics: DiagnosticCollector;
  readonly limits: ParseLimits;
  /** The expansion budget (v1.10 FR-003): nodes built so far against what the document may expand to. */
  readonly expansion: ExpansionState;
}

/** Where to point if the budget is crossed with no alias in sight — unreachable (without an alias, nodes built never exceed nodes written), but a diagnostic must have a span. */
function outcomeRootSpan(ctx: SpanContext, doc: Document): SourceSpan {
  return toSourceSpan(doc.contents?.range ?? [0, 0, 0], ctx);
}

/** Thrown by the walk the moment the budget is crossed; caught once, in `parseYaml`, and turned into the one diagnostic. */
class ExpansionLimitCrossed extends Error {}

interface ExpansionState {
  built: number;
  readonly written: number;
  readonly budget: number;
  /** How many aliases (or merge sources) the walk is currently inside. */
  depth: number;
  /** The outermost alias being expanded — the one the diagnostic points at, as the author wrote it. */
  site: SourceSpan | undefined;
}

/** Count one model node built; past the budget, stop the whole walk. */
function countBuilt(ctx: WalkContext): void {
  ctx.expansion.built += 1;
  if (ctx.expansion.built > ctx.expansion.budget) {
    throw new ExpansionLimitCrossed();
  }
}

/** Run `expand` as the expansion of the alias at `site`: the outermost such site is the one reported. */
function expandingAt<T>(site: SourceSpan, ctx: WalkContext, expand: () => T): T {
  if (ctx.expansion.depth === 0) {
    ctx.expansion.site = site;
  }
  ctx.expansion.depth += 1;
  try {
    return expand();
  } finally {
    ctx.expansion.depth -= 1;
  }
}

function hasAnchor(node: unknown): node is { anchor?: string } {
  return typeof node === "object" && node !== null && "anchor" in node;
}

function anchorNameOf(node: unknown): string | undefined {
  if (!hasAnchor(node)) {
    return undefined;
  }
  const anchor = node.anchor;
  return typeof anchor === "string" && anchor.length > 0 ? anchor : undefined;
}

/**
 * If `node`'s tag is outside the core-schema allowlist, record an
 * `unsupported-tag` diagnostic and report `true`. Applies uniformly to
 * scalars, mappings, and sequences — `!!set`/`!!omap` tag a *collection*,
 * not a scalar.
 */
function reportTagIfUnsupported(node: { tag?: string; range?: Range | null }, ctx: WalkContext): boolean {
  const tag = node.tag;
  if (!isUnsupportedTag(tag)) {
    return false;
  }
  ctx.diagnostics.add(unsupportedTagDiagnostic(tag, toSourceSpan(requireRange(node), ctx)));
  return true;
}

/**
 * Convert a scalar AST node's already-resolved JS value into a Cascata
 * Scalar. Kind is decided by the JS type `yaml` already resolved the
 * lexical source to under the core schema — see the module doc's
 * discussion of quoting and tags. Returns `undefined` (with a diagnostic
 * recorded) if the tag is unsupported, or — defensively, should the tag
 * check above ever miss something — if the resolved value still isn't one
 * of the five model kinds.
 */
function convertScalar(scalarAst: ScalarNode, ctx: WalkContext): Node | undefined {
  if (reportTagIfUnsupported(scalarAst, ctx)) {
    return undefined;
  }
  const span = toSourceSpan(requireRange(scalarAst), ctx);
  const value: unknown = scalarAst.value;
  if (typeof value === "string") {
    return createStringScalar(value, span);
  }
  if (typeof value === "bigint") {
    return createIntScalar(value, span);
  }
  if (typeof value === "number") {
    return createFloatScalar(value, span);
  }
  if (typeof value === "boolean") {
    return createBoolScalar(value, span);
  }
  if (value === null) {
    return createNullScalar(span);
  }
  // Defensive: every tag that resolves to a non-core-five JS value (a
  // Buffer for !!binary, a Date for !!timestamp, ...) is, as far as this
  // adapter's own corpus has verified, already caught by the tag check
  // above. Kept so parse() stays total even if that invariant is ever
  // wrong for some tag this corpus does not cover.
  ctx.diagnostics.add(
    createDiagnostic({ level: "error",
      code: "malformed-document",
      message: `Scalar value of type '${typeof value}' is outside the portability floor's five kinds`,
      primary: span,
    }),
  );
  return undefined;
}

/**
 * Resolve a mapping key to its string text, expanding an alias key first
 * if present. Records `non-string-key` (FR-012) and returns `undefined`
 * for anything that isn't text — a complex (collection) key, a non-text
 * scalar key, or an alias that fails to resolve to text — without
 * throwing, so the rest of the mapping keeps being walked.
 */
function deriveMappingKey(keyAst: ParsedNode, ctx: WalkContext): { key: string; span: SourceSpan } | undefined {
  const keySpan = toSourceSpan(requireRange(keyAst), ctx);
  if (isAlias(keyAst)) {
    const resolution = resolveAlias(keyAst, ctx.anchors, ctx.activePath, keySpan);
    if (!resolution.ok) {
      ctx.diagnostics.add(resolution.diagnostic);
      return undefined;
    }
    if (isScalar(resolution.target) && typeof resolution.target.value === "string") {
      return { key: resolution.target.value, span: keySpan };
    }
    ctx.diagnostics.add(nonStringKeyDiagnostic(keySpan));
    return undefined;
  }
  if (isScalar(keyAst) && typeof keyAst.value === "string") {
    return { key: keyAst.value, span: keySpan };
  }
  ctx.diagnostics.add(nonStringKeyDiagnostic(keySpan));
  return undefined;
}

/**
 * Fold one merge source's own entries into `target`, applying "only if
 * absent" precedence (research/FR-009: explicit keys beat merged ones; on
 * conflict between two merge sources, the earlier-listed one wins since it
 * is folded first). Recurses through the source's own merge keys, if it
 * has any, and tracks the source itself on the active expansion path so a
 * cycle reachable only through chained merge keys is still caught (see
 * expand.ts's module doc). `depth` is the *enclosing* mapping's own depth:
 * a merge source's entries are folded in as if written directly at this
 * mapping's level, not at whatever depth the anchor happens to be defined.
 *
 * Known imprecision, not exercised by any corpus case: if the same source
 * mapping is both walked in place elsewhere *and* merged in here, an
 * internal duplicate key within that source is detected — and reported —
 * once per site it is folded from, since duplicate tracking is local to
 * each `buildMappingEntries` call. Harmless (the diagnostic is correct,
 * just potentially repeated), not fixed given how narrow the scenario is.
 */
function foldMergeSource(source: MapNode, target: Map<string, Node>, ctx: WalkContext, depth: number): void {
  const anchor = anchorNameOf(source);
  if (anchor !== undefined) {
    ctx.activePath.add(source);
  }
  try {
    for (const [key, node] of buildMappingEntries(source, ctx, depth)) {
      if (!target.has(key)) {
        target.set(key, node);
      }
    }
  } finally {
    if (anchor !== undefined) {
      ctx.activePath.delete(source);
    }
  }
}

function buildMappingEntries(mapAst: MapNode, ctx: WalkContext, depth: number): Map<string, Node> {
  const entries = new Map<string, Node>();
  const firstOccurrence = new Map<string, SourceSpan>();

  for (const pair of mapAst.items) {
    const keyAst: ParsedNode = pair.key;

    if (isMergeKeyPair(keyAst)) {
      const mergeValueSpan = pair.value !== null ? toSourceSpan(requireRange(pair.value), ctx) : toSourceSpan(requireRange(keyAst), ctx);
      const sources = mergeSources(pair.value, ctx.anchors, ctx.activePath, mergeValueSpan, (diagnostic) => ctx.diagnostics.add(diagnostic));
      expandingAt(mergeValueSpan, ctx, () => {
        for (const source of sources) {
          foldMergeSource(source, entries, ctx, depth);
        }
      });
      continue;
    }

    const keyResult = deriveMappingKey(keyAst, ctx);
    // Even when the key itself is invalid, the value may still contain
    // further, independent violations (FR-019) — keep walking it, just
    // never add it under a key we refused.
    const valueNode = pair.value !== null ? walkNode(pair.value, ctx, depth + 1) : undefined;

    if (keyResult === undefined) {
      continue;
    }

    const priorSpan = firstOccurrence.get(keyResult.key);
    if (priorSpan !== undefined) {
      ctx.diagnostics.add(duplicateKeyDiagnostic(keyResult.span, priorSpan));
      continue; // first occurrence's value (already in `entries`) is left alone
    }
    firstOccurrence.set(keyResult.key, keyResult.span);

    if (valueNode !== undefined) {
      entries.set(keyResult.key, valueNode);
    }
  }
  return entries;
}

function convertMapping(mapAst: MapNode, ctx: WalkContext, depth: number): Node | undefined {
  const tagUnsupported = reportTagIfUnsupported(mapAst, ctx);
  const entries = buildMappingEntries(mapAst, ctx, depth);
  if (tagUnsupported) {
    return undefined;
  }
  const span = toTightCollectionSpan(requireRange(mapAst), ctx);
  return createMapping(entries, span);
}

function convertSequence(seqAst: SeqNode, ctx: WalkContext, depth: number): Node | undefined {
  const tagUnsupported = reportTagIfUnsupported(seqAst, ctx);
  const items: Node[] = [];
  for (const itemAst of seqAst.items) {
    // Defensive: `YAMLSeq.Parsed.items` is typed as `ParsedNode[]`, but
    // `!!omap` composes to `YAMLOMap` (a `YAMLSeq` subclass) whose actual
    // runtime items are bare `Pair` objects, not nodes at all (verified
    // empirically) — a library-typing gap in the same spirit as
    // `Alias#resolve`'s (see expand.ts). Since `!!omap` is already refused
    // by the tag check above regardless, there is nothing useful to gain
    // by walking a shape this adapter does not model; skip rather than
    // crash.
    if (!isScalar(itemAst) && !isMap(itemAst) && !isSeq(itemAst) && !isAlias(itemAst)) {
      continue;
    }
    const item = walkNode(itemAst, ctx, depth + 1);
    if (item !== undefined) {
      items.push(item);
    }
  }
  if (tagUnsupported) {
    return undefined;
  }
  const span = toTightCollectionSpan(requireRange(seqAst), ctx);
  return createSequence(items, span);
}

/**
 * Walk one AST node, expanding it if it is an alias (research D4: the
 * resulting Node's position is the anchor's own content, which falls out
 * naturally here — the target is walked with its own range, not the
 * alias's). `depth` is this node's own nesting depth; the root is depth 0.
 */
function walkNode(astNode: ParsedNode, ctx: WalkContext, depth: number): Node | undefined {
  if (isAlias(astNode)) {
    const aliasSpan = toSourceSpan(requireRange(astNode), ctx);
    const resolution = resolveAlias(astNode, ctx.anchors, ctx.activePath, aliasSpan);
    if (!resolution.ok) {
      ctx.diagnostics.add(resolution.diagnostic);
      return undefined;
    }
    return expandingAt(aliasSpan, ctx, () => walkAnchoredTarget(resolution.target, ctx, depth));
  }
  return walkAnchoredTarget(astNode, ctx, depth);
}

function walkAnchoredTarget(astNode: ScalarNode | MapNode | SeqNode, ctx: WalkContext, depth: number): Node | undefined {
  const span = toSourceSpan(requireRange(astNode), ctx);
  const depthDiagnostic = checkDepthLimit(depth, ctx.limits, span);
  if (depthDiagnostic !== undefined) {
    ctx.diagnostics.add(depthDiagnostic);
    return undefined;
  }

  const anchor = anchorNameOf(astNode);
  if (anchor !== undefined) {
    ctx.activePath.add(astNode);
  }
  try {
    // Every model node is counted as it is built (v1.10 FR-003), the
    // expansion of an alias or a merge key included — which is where a tree
    // grows past what the document writes.
    if (isScalar(astNode)) {
      const built = convertScalar(astNode, ctx);
      if (built !== undefined) countBuilt(ctx);
      return built;
    }
    if (isMap(astNode)) {
      const built = convertMapping(astNode, ctx, depth);
      if (built !== undefined) countBuilt(ctx);
      return built;
    }
    if (isSeq(astNode)) {
      const built = convertSequence(astNode, ctx, depth);
      if (built !== undefined) countBuilt(ctx);
      return built;
    }
    throw new Error("Internal error: encountered an AST node of an unrecognized shape during the walk");
  } finally {
    if (anchor !== undefined) {
      ctx.activePath.delete(astNode);
    }
  }
}

/**
 * Find every unpaired UTF-16 surrogate in `text` (FR-016). A JS string can
 * only fail to correspond to well-formed Unicode text this way — `parse()`
 * takes already-decoded text, so this is the one place "not valid UTF-8"
 * is actually checkable at this layer. `yaml` itself does not reject these
 * (verified empirically: a lone surrogate embedded in otherwise-plain text
 * parses with zero errors or warnings), so this is entirely Cascata's own
 * scan, run once up front — not "before parsing" the way the size cap is
 * (contracts does not require that here, and `yaml` tolerates the input
 * fine), so any other floor violations in the same document are still
 * found.
 */
function findLoneSurrogateOffsets(text: string): number[] {
  const offsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < text.length ? text.charCodeAt(index + 1) : Number.NaN;
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1; // valid surrogate pair; skip its low half
        continue;
      }
      offsets.push(index);
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      offsets.push(index); // lone low surrogate
    }
  }
  return offsets;
}

/**
 * Every U+FEFF in `text` that is neither in the document prefix (`prefixMarks`)
 * nor the content of a quoted scalar of `doc` — SPEC.md §4.2, v1.9. Ascending.
 */
function findMisplacedMarks(text: string, prefixMarks: readonly number[], doc: Document): number[] {
  const inPrefix = new Set(prefixMarks);
  const candidates = allMarks(text).filter((index) => !inPrefix.has(index));
  if (candidates.length === 0) {
    return [];
  }
  // Quoted scalars cannot nest and `visit` walks in document order, so the
  // ranges ascend and one forward pass over the (ascending) marks suffices.
  const quoted: Range[] = [];
  visit(doc, {
    Scalar(_key, node) {
      if ((node.type === "QUOTE_DOUBLE" || node.type === "QUOTE_SINGLE") && node.range != null) {
        quoted.push(node.range);
      }
    },
  });
  const misplaced: number[] = [];
  let next = 0;
  for (const index of candidates) {
    while (quoted[next] !== undefined && (quoted[next]?.[1] ?? 0) <= index) {
      next += 1;
    }
    const range = quoted[next];
    if (range === undefined || index <= range[0]) {
      misplaced.push(index);
    }
  }
  return misplaced;
}

interface YamlReaderError {
  readonly code: string;
  readonly message: string;
  readonly pos: readonly [number, number];
}

/**
 * Map one of `yaml`'s own parse errors (`doc.errors`) to a Cascata
 * diagnostic (T045, research D6). `DUPLICATE_KEY` is deliberately
 * excluded: floor.ts's own walk-time detection (`buildMappingEntries`)
 * reports it with the `related` first-occurrence span contracts/
 * diagnostics.md requires, which `yaml`'s own error (only the second
 * occurrence's position) cannot supply on its own. `MULTIPLE_DOCS` is
 * narrowed to the 3-character marker itself (contracts: "the second
 * document marker"), not `yaml`'s own wider span, which covers everything
 * after the first document. Everything else becomes `malformed-document`,
 * using the reader's own reported position as-is.
 *
 * `doc.warnings` (`TAG_RESOLVE_FAILED`, the only warning this adapter's
 * probing ever produced) is deliberately not consumed here: floor.ts's own
 * tag-allowlist check already catches a genuinely unknown tag the same way
 * it catches a known non-core one — by exact-URI mismatch — so mapping the
 * warning too would just report the same violation twice.
 */
function readerErrorDiagnostic(error: YamlReaderError, ctx: SpanContext): Diagnostic | undefined {
  if (error.code === "DUPLICATE_KEY") {
    return undefined;
  }
  const [start, end] = error.pos;
  if (error.code === "MULTIPLE_DOCS") {
    const markerSpan = toSourceSpan([start, start + 3, start + 3], ctx);
    return createDiagnostic({ level: "error", code: "multiple-documents", message: error.message, primary: markerSpan });
  }
  return createDiagnostic({ level: "error", code: "malformed-document", message: error.message, primary: toSourceSpan([start, end, end], ctx) });
}

/**
 * Parse YAML text into a Cascata tree or a non-empty, position-ordered
 * list of diagnostics — never both (research D5). Does not freeze the
 * returned tree — that is `src/index.ts`'s job, so the adapter itself
 * stays reusable by anything that wants the raw walk.
 */
/**
 * What the writer needs of the parse (v1.10, specs/018-write-value): the
 * `yaml` document with every range already in stored UTF-16 indices (v1.9),
 * and the one function that turns such a range into a span in stored bytes.
 * Handed over after the document is parsed and before the tree is walked;
 * the writer reads positions from the same place the reader measured them,
 * which is the whole point of Article IX ("one parser per format").
 */
export interface YamlSpans {
  /** A scalar's, an alias's or a flow collection's span. */
  readonly spanOf: (range: Range) => SourceSpan;
  /** A block mapping's or sequence's span, with the trailing line break trimmed (`toTightCollectionSpan`). */
  readonly tightSpanOf: (range: Range) => SourceSpan;
}

export type YamlDocumentHook = (doc: Document, spans: YamlSpans, anchors: AnchorTable) => void;

export function parseYaml(rawText: string, origin: Origin, limitOverrides?: Partial<ParseLimits>, onDocument?: YamlDocumentHook): ParseOutcome {
  const limits = resolveLimits(limitOverrides);

  // Checked before anything else is touched, on the raw input exactly as
  // received — "refused without being parsed at all" (contracts/parse-api.md).
  const rawByteLength = utf8ByteLength(rawText);
  const sizeDiagnostic = checkSizeLimit(rawByteLength, limits, origin);
  if (sizeDiagnostic !== undefined) {
    return { ok: false, diagnostics: [sizeDiagnostic] };
  }

  // v1.9: the mark is kept — every offset counts the stored bytes (SPEC.md §4.2).
  const text = rawText;
  const documentByteLength = rawByteLength;
  const byteOffsetTable = buildByteOffsetTable(text);
  const lineCounter = new LineCounter();
  const spanContext: SpanContext = { origin, text, lineCounter, byteOffsetTable, documentByteLength };
  const diagnostics = new DiagnosticCollector();

  // v1.9 FR-005: every prefix mark is removed from what `yaml` reads (see
  // `removePrefixMarks`), and FR-004's lone-CR substitution applied; the
  // parser's ranges and error positions are then mapped back below, so
  // everything past this point speaks stored indices.
  const prefixMarks = documentPrefixMarks(text);
  const yamlText = removePrefixMarks(text.replace(LONE_CARRIAGE_RETURN, "\n"), prefixMarks);
  // `uniqueKeys: false` (v1.10, specs/019 round 2): `yaml`'s own duplicate check
  // compares every new pair with every pair already in the mapping, so one flat
  // mapping of 32,000 keys took 18 s to parse and 0.18 s without it. Cascata
  // never used that error (`readerErrorDiagnostic` drops it: `duplicateKeyDiagnostic`
  // names the first occurrence, which `yaml`'s does not) and the AST is the same
  // either way, so `buildMappingEntries`' own map-based check is the only one.
  const doc = parseDocument(yamlText, { intAsBigInt: true, merge: true, uniqueKeys: false });
  if (prefixMarks.length > 0) {
    const toStored = storedIndexer(prefixMarks);
    visit(doc, {
      Node(_key, node) {
        if (node.range != null) {
          node.range = [toStored(node.range[0]), toStored(node.range[1]), toStored(node.range[2])];
        }
      },
    });
    for (const error of [...doc.errors, ...doc.warnings]) {
      error.pos = [toStored(error.pos[0]), toStored(error.pos[1])];
    }
  }
  // Lines are counted over the stored text: LF, CRLF, and a lone CR each end one.
  lineCounter.addNewLine(0);
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit === 0x0a || (unit === 0x0d && text.charCodeAt(index + 1) !== 0x0a)) {
      lineCounter.addNewLine(index + 1);
    }
  }

  for (const offset of findLoneSurrogateOffsets(text)) {
    const span = toSourceSpan([offset, offset + 1, offset + 1], spanContext);
    diagnostics.add(
      createDiagnostic({ level: "error",
        code: "invalid-encoding",
        message: "Input contains an unpaired UTF-16 surrogate, which cannot correspond to valid UTF-8",
        primary: span,
      }),
    );
  }

  const anchors = buildAnchorTable(doc);
  onDocument?.(doc, { spanOf: (range) => toSourceSpan(range, spanContext), tightSpanOf: (range) => toTightCollectionSpan(range, spanContext) }, anchors);

  // A mark outside a document prefix and a quoted scalar is not YAML 1.2.2
  // (`yaml` admits most of them silently). Where `yaml` also errored at the
  // mark, Cascata's diagnostic stands in for it rather than doubling it.
  const misplacedMarks = findMisplacedMarks(text, prefixMarks, doc);
  const misplacedAt = new Set(misplacedMarks);
  for (const offset of misplacedMarks) {
    diagnostics.add(
      createDiagnostic({
        level: "error",
        code: "malformed-document",
        message: "A byte-order mark (U+FEFF) is allowed only at the start of the document or inside a quoted string",
        primary: toSourceSpan([offset, offset + 1, offset + 1], spanContext),
      }),
    );
  }

  for (const error of doc.errors) {
    if (misplacedAt.has(error.pos[0])) {
      continue;
    }
    const diagnostic = readerErrorDiagnostic(error, spanContext);
    if (diagnostic !== undefined) {
      diagnostics.add(diagnostic);
    }
  }

  let tree: Node | undefined;
  if (doc.contents === null) {
    // Empty, comment-only, or whitespace-only input: valid, a null scalar
    // spanning zero width at offset 0 (contracts/parse-api.md).
    tree = createNullScalar(createSourceSpan({ origin, start: 0, end: 0, line: 1, column: 1, documentLength: documentByteLength }));
  } else {
    const written = countWritten(doc);
    const expansion: ExpansionState = { built: 0, written, budget: limits.expansionRatio * written + limits.expansionAllowance, depth: 0, site: undefined };
    const ctx: WalkContext = { ...spanContext, anchors, activePath: new Set(), diagnostics, limits, expansion };
    try {
      tree = walkNode(doc.contents, ctx, 0);
    } catch (error) {
      if (!(error instanceof ExpansionLimitCrossed)) {
        throw error;
      }
      // The walk stopped at the node that crossed the budget, inside the
      // expansion of `site`. One diagnostic; the read goes no further.
      diagnostics.add(expansionLimitDiagnostic(expansion.built, written, limits, expansion.site ?? outcomeRootSpan(spanContext, doc)));
    }
  }

  if (!diagnostics.isEmpty) {
    return { ok: false, diagnostics: diagnostics.all() };
  }
  if (tree === undefined) {
    // Every `return undefined` path above records a diagnostic first; if
    // the collector is empty, the walk must have produced a real tree.
    throw new Error("Internal error: the walk produced no tree despite recording no diagnostics");
  }
  return { ok: true, tree };
}

// --- Bytes entry point (v0.2, User Story 1) ---------------------------
//
// FR-001/FR-002 (specs/002-resolver-dag-builder/spec.md): the primary
// entry point takes bytes, and invalid UTF-8 (RFC 3629) must be refused
// at the offending *byte* offset, never repaired into replacement
// characters. This is the property v0.1 could not enforce (research D8):
// `parseYaml` above receives already-decoded text, and by the time a
// caller has a JS string, invalid bytes have already become U+FFFD —
// verified empirically, not assumed (constitution v1.1.0's probe gate).
//
// The validator and the byte-offset locator this entry point needs live
// in `src/adapters/encoding.ts` (v1.2, 011 T001), shared with the JSON
// adapter — see that module's own doc for why they are written as they
// are. Nothing about them changed when they moved.

/**
 * Parse YAML bytes into a Cascata tree or a non-empty diagnostic list.
 * The primary v0.2 entry point (contracts/resolve-api.md): validates
 * UTF-8 on the bytes themselves, then decodes and delegates to
 * `parseYaml`, so a valid document produces byte-for-byte the same tree
 * (spans included) `parseYaml` would from the equivalent text (FR-004) —
 * they are, after this point, literally the same function call.
 *
 * `TextDecoder`'s `ignoreBOM` option is set to `true` here — the
 * WHATWG-spec-confusing name means "do not silently strip a leading BOM
 * yourself": `ignoreBOM: false` (the default) makes the decoder strip it,
 * which would hide the mark from every offset after it. Since v1.9 the mark
 * is stored bytes and must reach `parseYaml` intact (sabotage-testing the
 * v0.2 form of this function is what first exposed the double negative).
 */
export function parseYamlBytes(bytes: Uint8Array, origin: Origin, limitOverrides?: Partial<ParseLimits>, onDocument?: YamlDocumentHook): ParseOutcome {
  const limits = resolveLimits(limitOverrides);

  // Checked on the raw byte length before anything else, same as the text
  // path checks utf8ByteLength first — "refused without being parsed
  // at all" (contracts/parse-api.md).
  const sizeDiagnostic = checkSizeLimit(bytes.length, limits, origin);
  if (sizeDiagnostic !== undefined) {
    return { ok: false, diagnostics: [sizeDiagnostic] };
  }

  const invalidOffset = findFirstInvalidUtf8ByteOffset(bytes);
  if (invalidOffset !== undefined) {
    const location = locateByteOffset(bytes, invalidOffset);
    const span = createSourceSpan({
      origin,
      start: invalidOffset,
      end: invalidOffset + 1,
      line: location.line,
      column: location.column,
      documentLength: bytes.length,
    });
    const diagnostic = createDiagnostic({ level: "error",
      code: "invalid-encoding",
      message: `Byte ${invalidOffset} begins a sequence that is not well-formed UTF-8 (RFC 3629)`,
      primary: span,
    });
    return { ok: false, diagnostics: [diagnostic] };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    // Should be unreachable: findFirstInvalidUtf8ByteOffset found nothing
    // wrong. Thrown rather than silently falling back to a repairing
    // decode, which is exactly the bug FR-002 exists to forbid.
    throw new Error(`Internal error: UTF-8 validation found no invalid byte, but strict decoding still failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return parseYaml(text, origin, limitOverrides, onDocument);
}
