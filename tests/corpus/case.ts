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
 */
export type ExpectedNode =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "int"; readonly value: string }
  | { readonly kind: "float"; readonly value: number }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "null" }
  | { readonly mapping: Readonly<Record<string, ExpectedNode>> }
  | { readonly sequence: readonly ExpectedNode[] };

/** A selective span assertion: the node at `pointer` must have this position. */
export interface ExpectedSpan {
  /** An RFC 6901 JSON Pointer into the tree, e.g. `""` for the root or `"/a/b/0"`. */
  readonly pointer: string;
  readonly line: number;
  readonly column: number;
}

/** One expected diagnostic, compared by code and position (SC-004). */
export interface ExpectedDiagnostic {
  readonly code: DiagnosticCode;
  readonly line: number;
  readonly column: number;
}

export type Expect =
  | { readonly tree: ExpectedNode; readonly spans?: readonly ExpectedSpan[] }
  | { readonly diagnostics: readonly ExpectedDiagnostic[] };

/** One conformance case (contracts/conformance-case.md "Fields"). */
export interface ConformanceCase {
  /** Stable identifier, printed on failure. */
  readonly name: string;
  /** The `SPEC.md` section this case is the oracle for. */
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
    if (!isPlainObject(mapping)) {
      fail(source, `mapping node at '${at}' needs an object 'mapping'`);
    }
    const entries: Record<string, ExpectedNode> = {};
    for (const [key, value] of Object.entries(mapping)) {
      entries[key] = parseExpectedNode(value, source, `${at}/${escapePointerSegment(key)}`);
    }
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
  return { pointer, line, column };
}

function parseExpectedDiagnostic(raw: unknown, source: string, index: number): ExpectedDiagnostic {
  if (!isPlainObject(raw)) {
    fail(source, `diagnostics[${index}] must be an object`);
  }
  const { code, line, column } = raw;
  if (typeof code !== "string" || !isDiagnosticCode(code)) {
    fail(source, `diagnostics[${index}].code must be one of the stable diagnostic codes, got ${JSON.stringify(code)}`);
  }
  if (typeof line !== "number" || typeof column !== "number") {
    fail(source, `diagnostics[${index}] must have numeric 'line' and 'column'`);
  }
  return { code, line, column };
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
  if (typeof cites !== "string" || cites.length === 0) {
    fail(source, "'cites' must be a non-empty string naming a SPEC.md section");
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
