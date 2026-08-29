/**
 * The conformance case format — contracts/conformance-case.md,
 * data-model.md "ConformanceCase", FR-021–FR-024.
 *
 * A case is **data**: this module defines its shape and loads/validates one
 * from a JSON file. Adding a case is adding a file, never editing code
 * (FR-024) — which is exactly why cases live as JSON rather than as
 * hand-written TypeScript test bodies.
 *
 * Node paths in a span assertion are RFC 6901 JSON Pointers (e.g.
 * `"/a/b/0"`), never a bespoke path syntax — the constitution reserves
 * RFC 6901 as the one path notation used anywhere in this codebase.
 *
 * Revised after a mid-flight review of the Phase 2 format found it did not
 * survive contact with real cases (see git history for
 * tests/corpus/case.ts and tests/corpus/runner.ts around the Phase 3
 * commits): mappings are now order-faithful `[key, node]` pairs rather than
 * a JSON object (a JS object silently reorders integer-like keys and can
 * never assert order at all); span assertions can carry byte `start`/`end`
 * in addition to `line`/`column`; and diagnostics can assert `related`
 * spans (needed for duplicate-key, which reports two positions).
 */

import { readFileSync } from "node:fs";
import type { DiagnosticCode } from "../../src/diagnostics/codes.js";
import { isDiagnosticCode } from "../../src/diagnostics/codes.js";

/**
 * The expected shape of a Node, written as data rather than as an actual
 * `Node` — an expected tree has no spans of its own (contracts/
 * conformance-case.md: "Spans are asserted selectively"), so it cannot be
 * a `Node` and must not be forced into one with a placeholder span.
 *
 * `int` is a decimal string, not a JSON number, so exact big-integer cases
 * survive round-tripping through JSON without precision loss.
 *
 * `mapping` is an array of `[key, node]` pairs, not a JSON object: entry
 * order is a legislated §4.2 decision (FR-003) that a case must be able to
 * assert, and a JSON object cannot express it faithfully even if a case
 * didn't care — JS object key iteration puts integer-like string keys
 * first in ascending numeric order regardless of insertion order, so a
 * case naming keys like `"1"`/`"2"` would silently test the wrong thing.
 * An array is order-faithful and immune to that reordering.
 *
 * There is no representation for `.nan`/`.inf`/`-.inf` (the YAML 1.2 core
 * schema's non-finite floats): `SPEC.md` never mentions them, and JSON
 * numbers cannot carry them. Deliberately out of scope for this format —
 * recorded here rather than discovered later — until a case genuinely
 * needs one, at which point `float` will need the same string-encoding
 * treatment `int` already has.
 */
export type ExpectedNode =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "int"; readonly value: string }
  | { readonly kind: "float"; readonly value: number }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "null" }
  | { readonly mapping: readonly (readonly [key: string, node: ExpectedNode])[] }
  | { readonly sequence: readonly ExpectedNode[] };

/**
 * A selective span assertion: the node at `pointer` must have this
 * position. `start`/`end` (byte offsets) are optional — a case can assert
 * only the start point (`line`/`column`) or the full extent, per
 * contracts/conformance-case.md's "assert selectively" intent — but SC-004
 * ("verified character for character") is only actually checked when a
 * case supplies both.
 */
export interface ExpectedSpan {
  /** An RFC 6901 JSON Pointer into the tree, e.g. `""` for the root or `"/a/b/0"`. */
  readonly pointer: string;
  readonly line: number;
  readonly column: number;
  readonly start?: number;
  readonly end?: number;
}

/** One expected related span on a diagnostic, e.g. a duplicate key's first occurrence. */
export interface ExpectedRelatedSpan {
  readonly label?: string;
  readonly line: number;
  readonly column: number;
  readonly start?: number;
  readonly end?: number;
}

/** One expected diagnostic, compared by code and position (SC-004), plus any related spans (FR-018). */
export interface ExpectedDiagnostic {
  readonly code: DiagnosticCode;
  readonly line: number;
  readonly column: number;
  readonly start?: number;
  readonly end?: number;
  readonly related?: readonly ExpectedRelatedSpan[];
}

export type Expect =
  | { readonly tree: ExpectedNode; readonly spans?: readonly ExpectedSpan[] }
  | { readonly diagnostics: readonly ExpectedDiagnostic[] };

/**
 * A canonical `SPEC.md` section reference: `§` followed by a dot-separated
 * numeric path, e.g. `§4.2`. Deliberately narrow — T057's coverage
 * obligation (FR-023) counts cases per §4.2 decision, and "§4.2", "4.2",
 * and "SPEC.md §4.2" would all appear as free text and none would match
 * each other. One canonical shape, rejected otherwise, keeps that count
 * meaningful from the first case rather than after a cleanup pass.
 */
const CITES_PATTERN = /^§\d+(?:\.\d+)*$/;

/** One conformance case (contracts/conformance-case.md "Fields"). */
export interface ConformanceCase {
  /** Stable identifier, printed on failure. */
  readonly name: string;
  /** The `SPEC.md` section this case is the oracle for, e.g. `"§4.2"`. */
  readonly cites: string;
  /** Which adapter reads `input`. */
  readonly format: string;
  /** The document text. */
  readonly input: string;
  readonly expect: Expect;
}

function fail(source: string, reason: string): never {
  throw new Error(`Conformance case at '${source}' cannot be interpreted: ${reason}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseExpectedNode(raw: unknown, source: string, at: string): ExpectedNode {
  if (!isPlainObject(raw)) {
    fail(source, `expected an object describing a node at '${at}', got ${JSON.stringify(raw)}`);
  }

  if ("kind" in raw) {
    const kind = raw["kind"];
    switch (kind) {
      case "string": {
        const value = raw["value"];
        if (typeof value !== "string") {
          fail(source, `string node at '${at}' needs a string 'value'`);
        }
        return { kind: "string", value };
      }
      case "int": {
        const value = raw["value"];
        if (typeof value !== "string" || !/^-?\d+$/.test(value)) {
          fail(source, `int node at '${at}' needs 'value' as a decimal-digit string, got ${JSON.stringify(value)}`);
        }
        return { kind: "int", value };
      }
      case "float": {
        const value = raw["value"];
        if (typeof value !== "number") {
          fail(source, `float node at '${at}' needs a numeric 'value'`);
        }
        return { kind: "float", value };
      }
      case "bool": {
        const value = raw["value"];
        if (typeof value !== "boolean") {
          fail(source, `bool node at '${at}' needs a boolean 'value'`);
        }
        return { kind: "bool", value };
      }
      case "null":
        return { kind: "null" };
      default:
        fail(source, `unknown scalar kind '${String(kind)}' at '${at}'`);
    }
  }

  if ("mapping" in raw) {
    const mapping = raw["mapping"];
    if (!Array.isArray(mapping)) {
      fail(source, `mapping node at '${at}' needs an array of [key, node] pairs, not an object`);
    }
    const entries: [string, ExpectedNode][] = mapping.map((pairRaw, index) => {
      if (!Array.isArray(pairRaw) || pairRaw.length !== 2) {
        fail(source, `mapping node at '${at}' entry ${index} must be a 2-element [key, node] array`);
      }
      const [key, valueRaw] = pairRaw;
      if (typeof key !== "string") {
        fail(source, `mapping node at '${at}' entry ${index} key must be a string`);
      }
      return [key, parseExpectedNode(valueRaw, source, `${at}/${escapePointerSegment(key)}`)];
    });
    return { mapping: entries };
  }

  if ("sequence" in raw) {
    const sequence = raw["sequence"];
    if (!Array.isArray(sequence)) {
      fail(source, `sequence node at '${at}' needs an array 'sequence'`);
    }
    return {
      sequence: sequence.map((item, index) => parseExpectedNode(item, source, `${at}/${index}`)),
    };
  }

  fail(source, `node at '${at}' has none of 'kind', 'mapping', or 'sequence'`);
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function parseOptionalOffset(raw: Record<string, unknown>, field: string, source: string, at: string): number | undefined {
  const value = raw[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(source, `${at}.${field} must be a non-negative integer when present, got ${JSON.stringify(value)}`);
  }
  return value;
}

function parseExpectedSpan(raw: unknown, source: string, index: number): ExpectedSpan {
  if (!isPlainObject(raw)) {
    fail(source, `spans[${index}] must be an object`);
  }
  const { pointer, line, column } = raw;
  if (typeof pointer !== "string") {
    fail(source, `spans[${index}].pointer must be a string`);
  }
  if (typeof line !== "number" || typeof column !== "number") {
    fail(source, `spans[${index}] must have numeric 'line' and 'column'`);
  }
  const at = `spans[${index}]`;
  const start = parseOptionalOffset(raw, "start", source, at);
  const end = parseOptionalOffset(raw, "end", source, at);
  return { pointer, line, column, ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}) };
}

function parseExpectedRelatedSpan(raw: unknown, source: string, at: string, index: number): ExpectedRelatedSpan {
  if (!isPlainObject(raw)) {
    fail(source, `${at}[${index}] must be an object`);
  }
  const { label, line, column } = raw;
  if (label !== undefined && typeof label !== "string") {
    fail(source, `${at}[${index}].label must be a string when present`);
  }
  if (typeof line !== "number" || typeof column !== "number") {
    fail(source, `${at}[${index}] must have numeric 'line' and 'column'`);
  }
  const itemAt = `${at}[${index}]`;
  const start = parseOptionalOffset(raw, "start", source, itemAt);
  const end = parseOptionalOffset(raw, "end", source, itemAt);
  return {
    ...(label !== undefined ? { label } : {}),
    line,
    column,
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
  };
}

function parseExpectedDiagnostic(raw: unknown, source: string, index: number): ExpectedDiagnostic {
  if (!isPlainObject(raw)) {
    fail(source, `diagnostics[${index}] must be an object`);
  }
  const { code, line, column, related } = raw;
  if (typeof code !== "string" || !isDiagnosticCode(code)) {
    fail(source, `diagnostics[${index}].code must be one of the stable diagnostic codes, got ${JSON.stringify(code)}`);
  }
  if (typeof line !== "number" || typeof column !== "number") {
    fail(source, `diagnostics[${index}] must have numeric 'line' and 'column'`);
  }
  const at = `diagnostics[${index}]`;
  const start = parseOptionalOffset(raw, "start", source, at);
  const end = parseOptionalOffset(raw, "end", source, at);
  let parsedRelated: ExpectedRelatedSpan[] | undefined;
  if (related !== undefined) {
    if (!Array.isArray(related)) {
      fail(source, `${at}.related must be an array when present`);
    }
    parsedRelated = related.map((item, relatedIndex) => parseExpectedRelatedSpan(item, source, `${at}.related`, relatedIndex));
  }
  return {
    code,
    line,
    column,
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
    ...(parsedRelated !== undefined ? { related: parsedRelated } : {}),
  };
}

function parseExpect(raw: unknown, source: string): Expect {
  if (!isPlainObject(raw)) {
    fail(source, "'expect' must be an object");
  }
  const hasTree = "tree" in raw;
  const hasDiagnostics = "diagnostics" in raw;
  if (hasTree === hasDiagnostics) {
    fail(source, "'expect' must have exactly one of 'tree' or 'diagnostics'");
  }
  if (hasTree) {
    const tree = parseExpectedNode(raw["tree"], source, "");
    const rawSpans = raw["spans"];
    if (rawSpans === undefined) {
      return { tree };
    }
    if (!Array.isArray(rawSpans)) {
      fail(source, "'expect.spans' must be an array when present");
    }
    return { tree, spans: rawSpans.map((span, index) => parseExpectedSpan(span, source, index)) };
  }
  const rawDiagnostics = raw["diagnostics"];
  if (!Array.isArray(rawDiagnostics)) {
    fail(source, "'expect.diagnostics' must be an array");
  }
  return {
    diagnostics: rawDiagnostics.map((diagnostic, index) => parseExpectedDiagnostic(diagnostic, source, index)),
  };
}

/**
 * Validate a case already parsed from JSON (or built in memory by a test).
 * Throws — loudly, per the runner contract's point 5 — on anything that
 * does not match contracts/conformance-case.md, rather than skipping it.
 */
export function parseCase(raw: unknown, source: string): ConformanceCase {
  if (!isPlainObject(raw)) {
    fail(source, "a case must be a JSON object");
  }
  const { name, cites, format, input, expect } = raw;
  if (typeof name !== "string" || name.length === 0) {
    fail(source, "'name' must be a non-empty string");
  }
  if (typeof cites !== "string" || !CITES_PATTERN.test(cites)) {
    fail(source, `'cites' must be a canonical section reference like '§4.2', got ${JSON.stringify(cites)}`);
  }
  if (typeof format !== "string" || format.length === 0) {
    fail(source, "'format' must be a non-empty string");
  }
  if (typeof input !== "string") {
    fail(source, "'input' must be a string");
  }
  return { name, cites, format, input, expect: parseExpect(expect, source) };
}

/** Read and validate one case from a JSON file. */
export function loadCase(filePath: string): ConformanceCase {
  const text = readFileSync(filePath, "utf-8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    fail(filePath, `invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseCase(raw, filePath);
}
