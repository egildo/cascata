/**
 * The validate-conformance case format — v0.4 (specs/004-constraint-checker/
 * tasks.md T013 onward).
 *
 * Mirrors `tests/corpus/merge-case.ts`'s design exactly, for the same
 * reason that file gives for not retrofitting v0.1's `case.ts`: a validate
 * case is genuinely a three-stage pipeline (`resolve()` → `merge()` →
 * `validate()`), and its expected outcome is either a certified
 * configuration (no diagnostics) or a set of `Violation`-rendered
 * diagnostics carrying v0.4's fuller contract (a merged-configuration
 * pointer, the violated demand's own pointer+position, and a pedigree
 * position) — none of which `merge-case.ts`'s `ExpectedMergeDiagnostic`
 * has room for. Fixture `.yaml` documents live under
 * `tests/corpus/cases/validate-` prefixed directories; JSON descriptors
 * live in the sibling `tests/corpus/validate-cases/` directory this
 * file's loader reads.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DiagnosticCode } from "../../src/diagnostics/codes.js";
import { isDiagnosticCode } from "../../src/diagnostics/codes.js";
import { parseExpectedNode, type ExpectedNode } from "./case.js";

/** One expected diagnostic from a failed validate() — v0.4's fuller contract, beyond merge-case.ts's ExpectedMergeDiagnostic. */
export interface ExpectedValidateDiagnostic {
  readonly code: DiagnosticCode;
  /** The offending value's own document (relative to the case's fixture directory) — `Diagnostic.primary.origin`. Always asserted. */
  readonly document: string;
  /**
   * `line`/`column` are optional, mirroring `case.ts`'s "spans are asserted
   * selectively" convention — some positions (e.g. the merged tree's own
   * root span, anchoring an absent top-level `required` key with no
   * shallower ancestor to point at) are governed by v0.1's adapter
   * conventions this milestone does not re-derive, so a case naming only
   * the document is a complete, honest assertion rather than a guess at a
   * byte position this file's own logic does not own.
   */
  readonly line?: number;
  readonly column?: number;
  readonly start?: number;
  readonly end?: number;
  /** RFC 6901 pointer into the **merged** configuration (`Diagnostic.pointer`, FR-024). Asserted only when supplied — a vocabulary-only diagnostic has none. */
  readonly pointer?: string;
  /** The violated demand's own position — `Diagnostic.demand` (FR-022). */
  readonly demand?: {
    readonly pointer: string;
    readonly document: string;
    readonly line: number;
    readonly column: number;
  };
  /** The declaring layer's rank in precedence order, 0 = root schema (`Diagnostic.pedigreePosition`). */
  readonly pedigreePosition?: number;
}

export type ValidateExpect = { readonly ok: true; readonly tree?: ExpectedNode } | { readonly ok: false; readonly diagnostics: readonly ExpectedValidateDiagnostic[] };

/** One validate-conformance case. */
export interface ValidateCase {
  readonly name: string;
  /** The `spec.md` FR this case is the oracle for, e.g. `"v0.4 FR-013"`. */
  readonly cites: string;
  readonly fixtureDir: string;
  readonly entry: string;
  readonly sandboxRoot: string;
  readonly expect: ValidateExpect;
}

function fail(source: string, reason: string): never {
  throw new Error(`Validate conformance case at '${source}' cannot be interpreted: ${reason}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(raw: Record<string, unknown>, field: string, source: string, at: string): string {
  const value = raw[field];
  if (typeof value !== "string") {
    fail(source, `'${at}' needs a string '${field}', got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireNumber(raw: Record<string, unknown>, field: string, source: string, at: string): number {
  const value = raw[field];
  if (typeof value !== "number") {
    fail(source, `'${at}' needs a numeric '${field}', got ${JSON.stringify(value)}`);
  }
  return value;
}

function parseOptionalOffset(raw: Record<string, unknown>, field: string, source: string, at: string): number | undefined {
  const value = raw[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(source, `'${at}.${field}' must be a non-negative integer if present, got ${JSON.stringify(value)}`);
  }
  return value;
}

function parseExpectedDemand(raw: unknown, source: string, at: string): ExpectedValidateDiagnostic["demand"] {
  if (!isPlainObject(raw)) {
    fail(source, `'${at}' must be an object`);
  }
  const pointer = requireString(raw, "pointer", source, at);
  const document = requireString(raw, "document", source, at);
  const line = requireNumber(raw, "line", source, at);
  const column = requireNumber(raw, "column", source, at);
  return { pointer, document, line, column };
}

function parseOptionalNumber(raw: Record<string, unknown>, field: string, source: string, at: string): number | undefined {
  const value = raw[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    fail(source, `'${at}.${field}' must be a number if present, got ${JSON.stringify(value)}`);
  }
  return value;
}

function parseValidateDiagnostic(raw: unknown, source: string, at: string): ExpectedValidateDiagnostic {
  if (!isPlainObject(raw)) {
    fail(source, `'${at}' must be an object`);
  }
  const codeRaw = raw["code"];
  if (typeof codeRaw !== "string" || !isDiagnosticCode(codeRaw)) {
    fail(source, `'${at}.code' must be a known DiagnosticCode, got ${JSON.stringify(codeRaw)}`);
  }
  const document = requireString(raw, "document", source, at);
  const line = parseOptionalNumber(raw, "line", source, at);
  const column = parseOptionalNumber(raw, "column", source, at);
  const start = parseOptionalOffset(raw, "start", source, at);
  const end = parseOptionalOffset(raw, "end", source, at);
  const pointerRaw = raw["pointer"];
  const pointer = pointerRaw === undefined ? undefined : typeof pointerRaw === "string" ? pointerRaw : fail(source, `'${at}.pointer' must be a string if present`);
  const demandRaw = raw["demand"];
  const demand = demandRaw === undefined ? undefined : parseExpectedDemand(demandRaw, source, `${at}.demand`);
  const pedigreePositionRaw = raw["pedigreePosition"];
  const pedigreePosition = pedigreePositionRaw === undefined ? undefined : typeof pedigreePositionRaw === "number" ? pedigreePositionRaw : fail(source, `'${at}.pedigreePosition' must be a number if present`);
  return {
    code: codeRaw,
    document,
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
    ...(pointer !== undefined ? { pointer } : {}),
    ...(demand !== undefined ? { demand } : {}),
    ...(pedigreePosition !== undefined ? { pedigreePosition } : {}),
  };
}

function parseExpect(raw: unknown, source: string): ValidateExpect {
  if (!isPlainObject(raw)) {
    fail(source, "'expect' must be an object");
  }
  const ok = raw["ok"];
  if (ok === true) {
    const treeRaw = raw["tree"];
    const tree = treeRaw === undefined ? undefined : parseExpectedNode(treeRaw, source, "");
    return { ok: true, ...(tree !== undefined ? { tree } : {}) };
  }
  if (ok === false) {
    const diagnosticsRaw = raw["diagnostics"];
    if (!Array.isArray(diagnosticsRaw) || diagnosticsRaw.length === 0) {
      fail(source, "'expect.diagnostics' must be a non-empty array when ok is false");
    }
    return { ok: false, diagnostics: diagnosticsRaw.map((item, index) => parseValidateDiagnostic(item, source, `expect.diagnostics[${index}]`)) };
  }
  fail(source, "'expect.ok' must be true or false");
}

const CITES_PATTERN = /^v0\.[45] FR-\d+[a-z]?$/;

/** Load and validate one validate-conformance case from `file`. `fixtureDir` resolves relative to `file`'s directory, mirroring `merge-case.ts`. */
export function loadValidateCase(file: string): ValidateCase {
  const raw: unknown = JSON.parse(readFileSync(file, "utf-8"));
  if (!isPlainObject(raw)) {
    fail(file, "top level must be an object");
  }
  const name = requireString(raw, "name", file, "$");
  const cites = requireString(raw, "cites", file, "$");
  if (!CITES_PATTERN.test(cites)) {
    fail(file, `'cites' must look like "v0.4 FR-013", got ${JSON.stringify(cites)}`);
  }
  const fixtureDirField = requireString(raw, "fixtureDir", file, "$");
  const entry = requireString(raw, "entry", file, "$");
  const sandboxRoot = requireString(raw, "sandboxRoot", file, "$");
  const expect = parseExpect(raw["expect"], file);
  const fixtureDir = join(dirname(file), "..", "cases", fixtureDirField);
  return { name, cites, fixtureDir, entry, sandboxRoot, expect };
}
