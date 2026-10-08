/**
 * The write-conformance case format — v1.10 (specs/018-write-value),
 * SPEC.md Article IX.
 *
 * A write case is a third kind of case beside the parse cases
 * (`case.ts`) and the resolution cases (`resolve-case.ts`): one document,
 * one pointer, one verb (`locate` or `setValue`), and either the byte range
 * (and bytes) the writer must answer or the diagnostic it must refuse with.
 * Every number in a case is **counted by hand from the input's bytes**, in
 * stored bytes (SPEC.md §4.2), 0-based, end-exclusive; the runner's
 * round trip through `parse` is a second witness and never the first.
 *
 * The descriptors live in `tests/corpus/write-cases/`, a directory of their
 * own, so the parse-case sweep over `cases/` never tries to load one.
 *
 * `value` is tagged because JSON cannot say `NaN`, `Infinity`, `-0` or a
 * bigint: `{"string": "x"}`, `{"number": 3.4}` (or `"NaN"`, `"Infinity"`,
 * `"-Infinity"`, `"-0"`), `{"bigint": "3"}`, `{"bool": true}`, `{"null": true}`.
 */

import { readFileSync } from "node:fs";
import type { DiagnosticCode } from "../../src/diagnostics/codes.js";
import { isDiagnosticCode } from "../../src/diagnostics/codes.js";

export type WriteValue = string | number | bigint | boolean | null;

export type WriteExpect =
  | { readonly edit: { readonly start: number; readonly end: number; readonly bytes: string } }
  | { readonly located: { readonly start: number; readonly end: number; readonly kind: string } }
  | { readonly diagnostic: { readonly code: DiagnosticCode; readonly start: number; readonly end: number } };

export interface WriteCase {
  readonly name: string;
  readonly cites: string;
  readonly format: "yaml" | "json";
  readonly call: "locate" | "setValue";
  readonly input?: string;
  readonly inputBytes?: readonly number[];
  readonly pointer: string;
  readonly value?: WriteValue;
  /** v1.12 FR-005: the policy the call is made under; `"refuse"` when absent. */
  readonly sharedEdits: "refuse" | "warn" | "allow";
  readonly expect: WriteExpect;
}

/** `v1.10 FR-003`, `v1.12 FR-011` — a write case cites the milestone's own requirement numbers, qualified. */
const CITES_PATTERN = /^v1\.1[02] FR-\d+$/;

function fail(source: string, reason: string): never {
  throw new Error(`Write case ${source} cannot be interpreted: ${reason}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function offset(raw: Record<string, unknown>, field: string, source: string): number {
  const value = raw[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(source, `'${field}' must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

function parseValue(raw: unknown, source: string): WriteValue {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 1) {
    fail(source, `'value' must be an object with exactly one of string/number/bigint/bool/null`);
  }
  if ("string" in raw) {
    const v = raw["string"];
    if (typeof v !== "string") fail(source, "'value.string' must be a string");
    return v;
  }
  if ("number" in raw) {
    const v = raw["number"];
    if (typeof v === "number") return v;
    if (v === "NaN") return Number.NaN;
    if (v === "Infinity") return Number.POSITIVE_INFINITY;
    if (v === "-Infinity") return Number.NEGATIVE_INFINITY;
    if (v === "-0") return -0;
    fail(source, `'value.number' must be a number or one of "NaN", "Infinity", "-Infinity", "-0", got ${JSON.stringify(v)}`);
  }
  if ("bigint" in raw) {
    const v = raw["bigint"];
    if (typeof v !== "string" || !/^-?\d+$/.test(v)) fail(source, "'value.bigint' must be a decimal string");
    return BigInt(v);
  }
  if ("bool" in raw) {
    const v = raw["bool"];
    if (typeof v !== "boolean") fail(source, "'value.bool' must be a boolean");
    return v;
  }
  if ("null" in raw) return null;
  fail(source, `'value' has an unknown tag: ${Object.keys(raw).join(", ")}`);
}

function parseExpect(raw: unknown, source: string): WriteExpect {
  if (!isPlainObject(raw)) fail(source, "'expect' must be an object");
  const hasEdit = "edit" in raw;
  const hasLocated = "located" in raw;
  const hasDiagnostic = "diagnostic" in raw;
  if (Number(hasEdit) + Number(hasLocated) + Number(hasDiagnostic) !== 1) {
    fail(source, "'expect' must have exactly one of 'edit', 'located', 'diagnostic'");
  }
  if (hasEdit) {
    const e = raw["edit"];
    if (!isPlainObject(e) || typeof e["bytes"] !== "string") fail(source, "'expect.edit' needs start, end and 'bytes' as text");
    return { edit: { start: offset(e, "start", source), end: offset(e, "end", source), bytes: e["bytes"] } };
  }
  if (hasLocated) {
    const l = raw["located"];
    if (!isPlainObject(l) || typeof l["kind"] !== "string") fail(source, "'expect.located' needs start, end and 'kind'");
    return { located: { start: offset(l, "start", source), end: offset(l, "end", source), kind: l["kind"] } };
  }
  const d = raw["diagnostic"];
  if (!isPlainObject(d) || typeof d["code"] !== "string" || !isDiagnosticCode(d["code"])) {
    fail(source, "'expect.diagnostic.code' must be one of the stable diagnostic codes");
  }
  return { diagnostic: { code: d["code"], start: offset(d, "start", source), end: offset(d, "end", source) } };
}

export function parseWriteCase(raw: unknown, source: string): WriteCase {
  if (!isPlainObject(raw)) fail(source, "top level must be an object");
  const { name, cites, format, call, pointer, input, inputBytes } = raw;
  if (typeof name !== "string") fail(source, "'name' must be a string");
  if (typeof cites !== "string" || !CITES_PATTERN.test(cites)) fail(source, `'cites' must look like "v1.10 FR-003", got ${JSON.stringify(cites)}`);
  if (format !== "yaml" && format !== "json") fail(source, "'format' must be 'yaml' or 'json'");
  if (call !== "locate" && call !== "setValue") fail(source, "'call' must be 'locate' or 'setValue'");
  if (typeof pointer !== "string") fail(source, "'pointer' must be a string");
  if ((input === undefined) === (inputBytes === undefined)) fail(source, "exactly one of 'input' and 'inputBytes'");
  if (input !== undefined && typeof input !== "string") fail(source, "'input' must be a string");
  if (inputBytes !== undefined && (!Array.isArray(inputBytes) || !inputBytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255))) {
    fail(source, "'inputBytes' must be an array of 0..255");
  }
  const hasValue = raw["value"] !== undefined;
  if (call === "setValue" && !hasValue) fail(source, "a setValue case needs a 'value'");
  if (call === "locate" && hasValue) fail(source, "a locate case takes no 'value'");
  const sharedEdits = raw["sharedEdits"] ?? "refuse";
  if (sharedEdits !== "refuse" && sharedEdits !== "warn" && sharedEdits !== "allow") fail(source, "'sharedEdits' must be 'refuse', 'warn' or 'allow'");
  const expect = parseExpect(raw["expect"], source);
  if (call === "locate" && "edit" in expect) fail(source, "a locate case cannot expect an edit");
  if (call === "setValue" && "located" in expect) fail(source, "a setValue case cannot expect a location");
  return {
    name,
    cites,
    format,
    call,
    pointer,
    sharedEdits,
    expect,
    ...(typeof input === "string" ? { input } : {}),
    ...(Array.isArray(inputBytes) ? { inputBytes: inputBytes.map(Number) } : {}),
    ...(hasValue ? { value: parseValue(raw["value"], source) } : {}),
  };
}

export function loadWriteCase(file: string): WriteCase {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf-8"));
  } catch (error) {
    fail(file, `invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseWriteCase(raw, file);
}

export function writeSourceOf(testCase: WriteCase): Uint8Array {
  if (testCase.input !== undefined) return new TextEncoder().encode(testCase.input);
  if (testCase.inputBytes !== undefined) return Uint8Array.from(testCase.inputBytes);
  throw new Error("Internal error: a WriteCase had neither input nor inputBytes");
}
