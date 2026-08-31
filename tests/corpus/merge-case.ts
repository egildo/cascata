/**
 * The merge-conformance case format — User Story 1 (tasks.md T012-T017) and
 * beyond.
 *
 * Mirrors `tests/corpus/resolve-case.ts`'s design exactly, for the same
 * reason that file gives for not retrofitting v0.1's `case.ts`: a merge
 * case spans several files on disk (a pedigree of schemas plus a config),
 * needs a `sandboxRoot` to `resolve()` them first, and its expected outcome
 * is a **merged** tree, not a single document's parse result. Fixture
 * `.yaml` documents live under the `tests/corpus/cases/merge-fold/` etc.
 * directories (tasks.md T002) exactly where `resolve-case.ts`'s fixtures live —
 * `.yaml` files are ignored by v0.1's `discoverCaseFiles` (which only
 * matches `*.json`), so the two discovery sweeps stay disjoint by
 * construction. Each case's JSON descriptor lives in the sibling
 * `tests/corpus/merge-cases/` directory this file's loader reads.
 *
 * The expected tree shape reuses `case.ts`'s `ExpectedNode` — merge
 * produces the same kind of tree v0.1 already has a format for describing;
 * inventing a second one would be exactly the kind of duplication research
 * D2 (the pointer promotion) exists to avoid.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DiagnosticCode } from "../../src/diagnostics/codes.js";
import { isDiagnosticCode } from "../../src/diagnostics/codes.js";
import { parseExpectedNode, type ExpectedNode } from "./case.js";

/** A span assertion anchored to one of the case's fixture documents (mirrors resolve-case.ts's `ExpectedResolveSpan`) — a merged tree's nodes come from many different documents, so each assertion names its own. */
export interface ExpectedMergeSpan {
  /** RFC 6901 pointer into the *merged* tree. */
  readonly pointer: string;
  /** Path of the document this position is in, relative to the case's fixture directory. */
  readonly document: string;
  readonly line: number;
  readonly column: number;
  readonly start?: number;
  readonly end?: number;
}

/** One expected diagnostic from a failed merge (Phase 6 / User Story 4 — not exercised by this slice's own cases, but the shape is written now so a later phase's cases need no format change). */
export interface ExpectedMergeDiagnostic {
  readonly code: DiagnosticCode;
  readonly document: string;
  readonly line: number;
  readonly column: number;
  readonly start?: number;
  readonly end?: number;
}

/** One expected entry in a `why()` chain or `synthesized` contributor list — User Story 3 (T038–T043). Identifies a layer by the fixture document its span falls in, same convention `ExpectedMergeSpan` uses, since a `Layer` object itself has no fixture-relative identity to assert against. */
export interface ExpectedProvenanceEntry {
  /** Path of the document this entry's layer is, relative to the case's fixture directory. */
  readonly document: string;
  readonly outcome: "won" | "overridden" | "accumulated";
}

/** One expected `why()` call against the merged configuration — User Story 3. */
export type ExpectedWhy =
  | { readonly pointer: string; readonly kind: "chain"; readonly entries: readonly ExpectedProvenanceEntry[] }
  | { readonly pointer: string; readonly kind: "synthesized"; readonly contributors: readonly ExpectedProvenanceEntry[] }
  | { readonly pointer: string; readonly kind: "unknown-pointer" };

export type MergeExpect =
  | { readonly ok: true; readonly tree: ExpectedNode; readonly spans?: readonly ExpectedMergeSpan[]; readonly why?: readonly ExpectedWhy[] }
  | { readonly ok: false; readonly diagnostics: readonly ExpectedMergeDiagnostic[] };

/** One merge-conformance case. */
export interface MergeCase {
  readonly name: string;
  /** The `spec.md` FR this case is the oracle for, e.g. `"v0.3 FR-007"`. */
  readonly cites: string;
  /** Absolute path to the directory holding this case's fixture `.yaml` documents. */
  readonly fixtureDir: string;
  /** Entry (config) document path, relative to `fixtureDir`. */
  readonly entry: string;
  /** Sandbox root, relative to `fixtureDir` — required by `resolve()` regardless of whether this case's chain ever leaves it. */
  readonly sandboxRoot: string;
  readonly expect: MergeExpect;
}

function fail(source: string, reason: string): never {
  throw new Error(`Merge conformance case at '${source}' cannot be interpreted: ${reason}`);
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

function parseMergeSpan(raw: unknown, source: string, at: string): ExpectedMergeSpan {
  if (!isPlainObject(raw)) {
    fail(source, `'${at}' must be an object`);
  }
  const pointer = requireString(raw, "pointer", source, at);
  const document = requireString(raw, "document", source, at);
  const line = requireNumber(raw, "line", source, at);
  const column = requireNumber(raw, "column", source, at);
  const start = parseOptionalOffset(raw, "start", source, at);
  const end = parseOptionalOffset(raw, "end", source, at);
  return { pointer, document, line, column, ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}) };
}

function parseMergeDiagnostic(raw: unknown, source: string, at: string): ExpectedMergeDiagnostic {
  if (!isPlainObject(raw)) {
    fail(source, `'${at}' must be an object`);
  }
  const codeRaw = raw["code"];
  if (typeof codeRaw !== "string" || !isDiagnosticCode(codeRaw)) {
    fail(source, `'${at}.code' must be a known DiagnosticCode, got ${JSON.stringify(codeRaw)}`);
  }
  const document = requireString(raw, "document", source, at);
  const line = requireNumber(raw, "line", source, at);
  const column = requireNumber(raw, "column", source, at);
  const start = parseOptionalOffset(raw, "start", source, at);
  const end = parseOptionalOffset(raw, "end", source, at);
  return { code: codeRaw, document, line, column, ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}) };
}

function parseProvenanceEntry(raw: unknown, source: string, at: string): ExpectedProvenanceEntry {
  if (!isPlainObject(raw)) {
    fail(source, `'${at}' must be an object`);
  }
  const document = requireString(raw, "document", source, at);
  const outcomeRaw = raw["outcome"];
  if (outcomeRaw !== "won" && outcomeRaw !== "overridden" && outcomeRaw !== "accumulated") {
    fail(source, `'${at}.outcome' must be "won", "overridden", or "accumulated", got ${JSON.stringify(outcomeRaw)}`);
  }
  return { document, outcome: outcomeRaw };
}

function parseWhy(raw: unknown, source: string, at: string): ExpectedWhy {
  if (!isPlainObject(raw)) {
    fail(source, `'${at}' must be an object`);
  }
  const pointer = requireString(raw, "pointer", source, at);
  const kind = raw["kind"];
  if (kind === "unknown-pointer") {
    return { pointer, kind };
  }
  if (kind === "chain") {
    const entriesRaw = raw["entries"];
    if (!Array.isArray(entriesRaw) || entriesRaw.length === 0) {
      fail(source, `'${at}.entries' must be a non-empty array when kind is "chain"`);
    }
    return { pointer, kind, entries: entriesRaw.map((entry, index) => parseProvenanceEntry(entry, source, `${at}.entries[${index}]`)) };
  }
  if (kind === "synthesized") {
    const contributorsRaw = raw["contributors"];
    if (!Array.isArray(contributorsRaw)) {
      fail(source, `'${at}.contributors' must be an array when kind is "synthesized"`);
    }
    return { pointer, kind, contributors: contributorsRaw.map((entry, index) => parseProvenanceEntry(entry, source, `${at}.contributors[${index}]`)) };
  }
  fail(source, `'${at}.kind' must be "chain", "synthesized", or "unknown-pointer", got ${JSON.stringify(kind)}`);
}

function parseExpect(raw: unknown, source: string): MergeExpect {
  if (!isPlainObject(raw)) {
    fail(source, "'expect' must be an object");
  }
  const ok = raw["ok"];
  if (ok === true) {
    const tree = parseExpectedNode(raw["tree"], source, "");
    const rawSpans = raw["spans"];
    const rawWhy = raw["why"];
    const spans = rawSpans === undefined ? undefined : Array.isArray(rawSpans) ? rawSpans.map((span, index) => parseMergeSpan(span, source, `expect.spans[${index}]`)) : fail(source, "'expect.spans' must be an array if present");
    const why = rawWhy === undefined ? undefined : Array.isArray(rawWhy) ? rawWhy.map((entry, index) => parseWhy(entry, source, `expect.why[${index}]`)) : fail(source, "'expect.why' must be an array if present");
    return { ok: true, tree, ...(spans !== undefined ? { spans } : {}), ...(why !== undefined ? { why } : {}) };
  }
  if (ok === false) {
    const diagnosticsRaw = raw["diagnostics"];
    if (!Array.isArray(diagnosticsRaw) || diagnosticsRaw.length === 0) {
      fail(source, "'expect.diagnostics' must be a non-empty array when ok is false");
    }
    return { ok: false, diagnostics: diagnosticsRaw.map((item, index) => parseMergeDiagnostic(item, source, `expect.diagnostics[${index}]`)) };
  }
  fail(source, "'expect.ok' must be true or false");
}

const CITES_PATTERN = /^v0\.3 FR-\d+$/;

/** Load and validate one merge-conformance case from `file`. `fixtureDir` resolves relative to `file`'s directory, per the case's own `fixtureDir` field, same convention as `resolve-case.ts`. */
export function loadMergeCase(file: string): MergeCase {
  const raw: unknown = JSON.parse(readFileSync(file, "utf-8"));
  if (!isPlainObject(raw)) {
    fail(file, "top level must be an object");
  }
  const name = requireString(raw, "name", file, "$");
  const cites = requireString(raw, "cites", file, "$");
  if (!CITES_PATTERN.test(cites)) {
    fail(file, `'cites' must look like "v0.3 FR-007", got ${JSON.stringify(cites)}`);
  }
  const fixtureDirField = requireString(raw, "fixtureDir", file, "$");
  const entry = requireString(raw, "entry", file, "$");
  const sandboxRoot = requireString(raw, "sandboxRoot", file, "$");
  const expect = parseExpect(raw["expect"], file);
  const fixtureDir = join(dirname(file), "..", "cases", fixtureDirField);
  return { name, cites, fixtureDir, entry, sandboxRoot, expect };
}
