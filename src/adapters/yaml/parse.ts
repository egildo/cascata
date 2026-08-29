/**
 * The YAML adapter's conversion layer — SPEC.md §4.1, §4.2; plan.md's D1
 * ("a strict conversion layer over `yaml`'s AST, not a parser").
 *
 * `src/adapters/yaml/` is the one format-aware directory in the codebase
 * (Principle IV) — this file is where `yaml` (eemeli's) is imported.
 * Everything below turns its AST into Cascata's format-blind model,
 * computing every span itself rather than trusting the library's ranges
 * verbatim: two empirical findings (recorded in the Phase 3 report) meant
 * `research.md`'s probe table was not quite right about what `yaml` hands
 * back:
 *
 *   1. `range`/`.pos` offsets are **UTF-16 code-unit indices** into the JS
 *      string, not UTF-8 byte offsets, despite research.md's probe table
 *      calling them "byte offsets". They diverge for any character above
 *      U+007F. `SourceSpan.start`/`.end` are contractually bytes
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
 * A leading byte-order mark is stripped before any of this runs, so it
 * contributes zero bytes/columns rather than shifting every position by
 * one — `yaml` does not do this itself (verified empirically: a BOM
 * occupies index 0 and is counted like any other character).
 */

import { LineCounter, isAlias, isMap, isScalar, isSeq, parseDocument } from "yaml";
import type { Alias, Document, ParsedNode, Range, Scalar, YAMLMap, YAMLSeq } from "yaml";
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
import { AliasCycleError, DanglingAliasError, InvalidMergeSourceError, isMergeKeyPair, mergeSources, resolveAlias } from "./expand.js";

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

const BYTE_ORDER_MARK = "﻿";

/** Strip a single leading BOM, if present, so it never enters span math (SPEC.md edge cases). */
function stripByteOrderMark(text: string): string {
  return text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;
}

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

/** Count actual Unicode code points (not UTF-16 units) from `lineStart` up to `target`, 1-based. */
function codePointColumn(text: string, lineStart: number, target: number): number {
  let count = 0;
  let index = lineStart;
  while (index < target) {
    const codePoint = text.codePointAt(index);
    index += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    count += 1;
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

/** Convert a `yaml` `[start, valueEnd, nodeEnd]` range into a `SourceSpan`. `valueEnd` (not `nodeEnd`) is used as the tight upper bound — see research D1/probe notes above for why `nodeEnd` over-includes trailing content for scalars. */
function toSourceSpan(range: Range, ctx: SpanContext): SourceSpan {
  const [startIndex, valueEndIndex] = range;
  return createSourceSpan({
    origin: ctx.origin,
    start: byteOffsetAt(ctx, startIndex),
    end: byteOffsetAt(ctx, valueEndIndex),
    line: ctx.lineCounter.linePos(startIndex).line,
    column: codePointColumn(ctx.text, lineStartIndex(ctx, startIndex), startIndex),
    documentLength: ctx.documentByteLength,
  });
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

/** Thrown when a scalar resolves to a value outside the five model kinds (e.g. `!!binary`'s Buffer). See the module doc and the Phase 3 report: tag validation is Phase 4 (T043) work; this is a defensive fallback so parse() stays total in the meantime. */
class UnsupportedScalarValueError extends Error {
  constructor(value: unknown) {
    super(`Scalar value of type '${typeof value}' is outside the portability floor's five kinds`);
    this.name = "UnsupportedScalarValueError";
  }
}

/** Thrown when a mapping key does not resolve to text. Non-string-key rejection with its own diagnostic is Phase 4 (T042); see the module doc. */
class UnsupportedKeyError extends Error {
  constructor() {
    super("A mapping key must be text (non-string keys are a portability-floor violation)");
    this.name = "UnsupportedKeyError";
  }
}

interface WalkContext extends SpanContext {
  readonly doc: Document;
  /** AST node references currently on the active expansion path (research D3). */
  readonly activePath: Set<object>;
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

/** Convert a scalar AST node's already-resolved JS value into a Cascata Scalar. Kind is decided by the JS type `yaml` already resolved the lexical source to under the core schema — see the module doc's discussion of quoting and tags. */
function convertScalar(scalarAst: ScalarNode, ctx: SpanContext): Node {
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
  throw new UnsupportedScalarValueError(value);
}

function deriveMappingKey(keyAst: ParsedNode): string {
  if (isScalar(keyAst) && typeof keyAst.value === "string") {
    return keyAst.value;
  }
  throw new UnsupportedKeyError();
}

/**
 * Fold one merge source's own entries into `target`, applying "only if
 * absent" precedence (research/FR-009: explicit keys beat merged ones; on
 * conflict between two merge sources, the earlier-listed one wins since it
 * is folded first). Recurses through the source's own merge keys, if it
 * has any, and tracks the source itself on the active expansion path so a
 * cycle reachable only through chained merge keys is still caught (see
 * expand.ts's module doc).
 */
function foldMergeSource(source: MapNode, target: Map<string, Node>, ctx: WalkContext): void {
  const anchor = anchorNameOf(source);
  if (anchor !== undefined) {
    ctx.activePath.add(source);
  }
  try {
    for (const [key, node] of buildMappingEntries(source, ctx)) {
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

function buildMappingEntries(mapAst: MapNode, ctx: WalkContext): Map<string, Node> {
  const entries = new Map<string, Node>();
  for (const pair of mapAst.items) {
    const keyAst: ParsedNode = pair.key;
    if (isMergeKeyPair(keyAst)) {
      for (const source of mergeSources(pair.value, ctx.doc, ctx.activePath)) {
        foldMergeSource(source, entries, ctx);
      }
      continue;
    }
    const key = deriveMappingKey(keyAst);
    if (pair.value === null) {
      throw new Error("Internal error: a mapping pair was parsed with no value node at all");
    }
    // Explicit pairs always overwrite, regardless of what a prior merge
    // fold already placed at this key — that IS "explicit beats merged"
    // (FR-009). A literal duplicate explicit key never reaches this code:
    // `yaml` itself reports DUPLICATE_KEY in `doc.errors`, which parseYaml
    // checks and bails out on before any walk begins (T034); teaching this
    // function to detect duplicates itself is Phase 4's job (T044), not a
    // gap in this one.
    entries.set(key, walkNode(pair.value, ctx));
  }
  return entries;
}

function convertMapping(mapAst: MapNode, ctx: WalkContext): Node {
  const span = toSourceSpan(requireRange(mapAst), ctx);
  return createMapping(buildMappingEntries(mapAst, ctx), span);
}

function convertSequence(seqAst: SeqNode, ctx: WalkContext): Node {
  const span = toSourceSpan(requireRange(seqAst), ctx);
  const items = seqAst.items.map((item) => walkNode(item, ctx));
  return createSequence(items, span);
}

/**
 * Walk one AST node, expanding it if it is an alias (research D4: the
 * resulting Node's position is the anchor's own content, which falls out
 * naturally here — the target is walked with its own range, not the
 * alias's).
 */
function walkNode(astNode: ParsedNode, ctx: WalkContext): Node {
  if (isAlias(astNode)) {
    const target = resolveAlias(astNode, ctx.doc, ctx.activePath);
    return walkAnchoredTarget(target, ctx);
  }
  return walkAnchoredTarget(astNode, ctx);
}

function walkAnchoredTarget(astNode: ScalarNode | MapNode | SeqNode, ctx: WalkContext): Node {
  const anchor = anchorNameOf(astNode);
  if (anchor !== undefined) {
    ctx.activePath.add(astNode);
  }
  try {
    if (isScalar(astNode)) {
      return convertScalar(astNode, ctx);
    }
    if (isMap(astNode)) {
      return convertMapping(astNode, ctx);
    }
    if (isSeq(astNode)) {
      return convertSequence(astNode, ctx);
    }
    throw new Error("Internal error: encountered an AST node of an unrecognized shape during the walk");
  } finally {
    if (anchor !== undefined) {
      ctx.activePath.delete(astNode);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Map any internal expansion/robustness signal thrown during the walk to
 * a `malformed-document` diagnostic. Several of these (alias cycles,
 * non-string keys, unsupported tags) get their own dedicated code and
 * exact position in Phase 4 (T042, T043, T047) — see each error class's
 * own doc comment. This is Phase 3's honest, generic fallback so `parse()`
 * stays total (contracts/parse-api.md) in the meantime; a zero-width span
 * at offset 0 is used since, unlike a `yaml`-reported syntax error, these
 * signals do not always carry a precise position of their own (e.g. a
 * dangling alias's own position could be attached in a future pass, but
 * isn't wired through as a diagnostic today because Phase 3's own corpus
 * never exercises this path).
 */
function toInternalMalformedDiagnostic(error: unknown, ctx: SpanContext): Diagnostic {
  let primary: SourceSpan;
  if (error instanceof AliasCycleError || error instanceof DanglingAliasError) {
    primary = toSourceSpan(requireRange(error.alias), ctx);
  } else {
    primary = createSourceSpan({ origin: ctx.origin, start: 0, end: 0, line: 1, column: 1, documentLength: ctx.documentByteLength });
  }
  return createDiagnostic({ code: "malformed-document", message: messageOf(error), primary });
}

/**
 * Map one of `yaml`'s own parse errors (`doc.errors`) to a
 * `malformed-document` diagnostic (T034). Phase 4 (T045) refines this into
 * a full per-code mapping table (`DUPLICATE_KEY` -> `duplicate-key`,
 * `MULTIPLE_DOCS` -> `multiple-documents`, ...); Phase 3 does not
 * distinguish, since none of its own corpus cases produce a `yaml` error
 * in the first place (they are all well-formed documents) — every case
 * exercising this path belongs to Phase 4.
 */
function toReaderErrorDiagnostic(error: { message: string; pos: [number, number] }, ctx: SpanContext): Diagnostic {
  const [start, end] = error.pos;
  const primary = toSourceSpan([start, end, end], ctx);
  return createDiagnostic({ code: "malformed-document", message: error.message, primary });
}

/**
 * Parse YAML text into a Cascata tree or a list of diagnostics. Does not
 * freeze the returned tree — that is `src/index.ts`'s job (T033), so the
 * adapter itself stays reusable by anything that wants the raw walk
 * (e.g. a future `floor.ts`).
 */
export function parseYaml(rawText: string, origin: Origin): ParseOutcome {
  const text = stripByteOrderMark(rawText);
  const documentByteLength = Buffer.byteLength(text, "utf-8");
  const byteOffsetTable = buildByteOffsetTable(text);
  const lineCounter = new LineCounter();
  const spanContext: SpanContext = { origin, text, lineCounter, byteOffsetTable, documentByteLength };

  const doc = parseDocument(text, { intAsBigInt: true, merge: true, lineCounter });

  if (doc.errors.length > 0) {
    return {
      ok: false,
      diagnostics: doc.errors.map((error) => toReaderErrorDiagnostic(error, spanContext)),
    };
  }

  if (doc.contents === null) {
    // Empty, comment-only, or whitespace-only input: valid, a null scalar
    // spanning zero width at offset 0 (contracts/parse-api.md).
    const span = createSourceSpan({ origin, start: 0, end: 0, line: 1, column: 1, documentLength: documentByteLength });
    return { ok: true, tree: createNullScalar(span) };
  }

  const ctx: WalkContext = { ...spanContext, doc, activePath: new Set() };
  try {
    return { ok: true, tree: walkNode(doc.contents, ctx) };
  } catch (error) {
    return { ok: false, diagnostics: [toInternalMalformedDiagnostic(error, spanContext)] };
  }
}
