/**
 * Runs one write case — specs/018-write-value, SPEC.md Article IX.
 *
 * The expected values in a case are the authority (counted by hand). On top
 * of them, every `setValue` case that expects an edit is also round-tripped
 * through the reader: the edit is applied, the result parsed, and the three
 * laws are checked against the *reader* — which is a second witness, never
 * the first. This file computes the expected kind from the spec's FR-006
 * itself, rather than importing the writer's rule.
 */

import { parseDocument } from "yaml";
import { parseJsonBytes } from "../../src/adapters/json/parse.js";
import { locate, setValue } from "../../src/index.js";
import type { EditValue } from "../../src/index.js";
import type { Diagnostic } from "../../src/diagnostics/diagnostic.js";
import type { Node, Scalar } from "../../src/model/node.js";
import { resolvePointer } from "../../src/model/pointer.js";
import { createOrigin } from "../../src/model/span.js";
import { parse } from "../../src/index.js";
import type { WriteCase } from "./write-case.js";
import { writeSourceOf } from "./write-case.js";

export interface WriteCaseResult {
  readonly name: string;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

function parseAs(format: "yaml" | "json", bytes: Uint8Array): { ok: true; tree: Node } | { ok: false } {
  const origin = createOrigin("write-case", "write-case");
  const outcome = format === "yaml" ? parse(bytes, { origin }) : parseJsonBytes(bytes, origin);
  return outcome.ok ? { ok: true, tree: outcome.tree } : { ok: false };
}

/** FR-006, restated: the kind the value must read back as, given the kind it replaces. */
function expectedKind(value: EditValue, replaced: Node | undefined): Scalar["kind"] {
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "bool";
  if (value === null) return "null";
  if (typeof value === "bigint") return "int";
  if (replaced !== undefined && replaced.type === "scalar" && replaced.kind === "float") return "float";
  return Number.isInteger(value) ? "int" : "float";
}

function sameScalar(node: Node | undefined, kind: Scalar["kind"], value: EditValue): boolean {
  if (node === undefined || node.type !== "scalar" || node.kind !== kind) return false;
  if (kind === "null") return true;
  if (kind === "int") return node.value === (typeof value === "bigint" ? value : BigInt(value as number));
  if (kind === "float" && typeof value === "number" && Number.isNaN(value)) return typeof node.value === "number" && Number.isNaN(node.value);
  return node.value === value;
}

/** Every scalar leaf of a tree by pointer, so "only the value moves" can compare two trees leaf by leaf. */
function leaves(node: Node, pointer: string, into: Map<string, string>): void {
  if (node.type === "scalar") {
    into.set(pointer, `${node.kind}:${node.value === null ? "" : String(node.value)}`);
  } else if (node.type === "mapping") {
    for (const [key, child] of node.entries) leaves(child, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, into);
  } else {
    node.items.forEach((child, index) => leaves(child, `${pointer}/${index}`, into));
  }
}

/** Every pointer of a node whose span is `start`-`end` (a value and its alias and merge-key copies share one). */
function nodesAt(node: Node, pointer: string, start: number, end: number): string[] {
  const found = node.span.start === start && node.span.end === end ? [pointer] : [];
  if (node.type === "mapping") {
    for (const [key, child] of node.entries) found.push(...nodesAt(child, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, start, end));
  } else if (node.type === "sequence") {
    node.items.forEach((child, index) => found.push(...nodesAt(child, `${pointer}/${index}`, start, end)));
  }
  return found;
}

function describe(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map((d) => `${d.code} at ${d.primary.start}-${d.primary.end}`).join(", ");
}

export function runWriteCase(testCase: WriteCase): WriteCaseResult {
  const failures: string[] = [];
  const bytes = writeSourceOf(testCase);
  const options = { format: testCase.format, origin: createOrigin("write-case", "write-case"), sharedEdits: testCase.sharedEdits };
  const { expect } = testCase;

  if (testCase.call === "locate") {
    const result = locate(bytes, options, testCase.pointer);
    if ("located" in expect) {
      if (!result.ok) failures.push(`expected a location, got diagnostics: ${describe(result.diagnostics)}`);
      else if (result.start !== expect.located.start || result.end !== expect.located.end || result.kind !== expect.located.kind) {
        failures.push(`expected ${expect.located.start}-${expect.located.end} ${expect.located.kind}, got ${result.start}-${result.end} ${result.kind}`);
      }
    } else if ("diagnostic" in expect) {
      checkDiagnostic(result.ok ? undefined : result.diagnostics, expect.diagnostic, failures);
    }
    return { name: testCase.name, passed: failures.length === 0, failures };
  }

  const value = testCase.value as EditValue;
  const result = setValue(bytes, options, testCase.pointer, value);
  if ("diagnostic" in expect) {
    checkDiagnostic(result.ok ? undefined : result.diagnostics, expect.diagnostic, failures);
    if (result.ok) failures.push(`expected ${expect.diagnostic.code}, got an edit ${result.edit.start}-${result.edit.end}`);
    return { name: testCase.name, passed: failures.length === 0, failures };
  }
  if (!("edit" in expect)) {
    failures.push("a setValue case must expect an edit or a diagnostic");
    return { name: testCase.name, passed: false, failures };
  }
  if (!result.ok) {
    failures.push(`expected an edit, got diagnostics: ${describe(result.diagnostics)}`);
    return { name: testCase.name, passed: false, failures };
  }
  const { edit } = result;
  // v1.12 FR-005: under "warn" one info names what else the edit changes; under "refuse" and "allow", nothing is said.
  const infos = result.diagnostics.map((d) => `${d.level} ${d.code} at ${d.primary.start}-${d.primary.end}`);
  if (testCase.sharedEdits === "warn") {
    if (infos.length !== 1 || infos[0] !== `info edit-target-shared at ${edit.start}-${edit.end}`) failures.push(`under warn, expected one info edit-target-shared at the value, got [${infos.join(", ")}]`);
  } else if (infos.length !== 0) {
    failures.push(`under ${testCase.sharedEdits}, expected no diagnostic with the edit, got [${infos.join(", ")}]`);
  }
  const text = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(edit.bytes);
  if (edit.start !== expect.edit.start || edit.end !== expect.edit.end) {
    failures.push(`expected range ${expect.edit.start}-${expect.edit.end}, got ${edit.start}-${edit.end}`);
  }
  if (text !== expect.edit.bytes) {
    failures.push(`expected bytes ${JSON.stringify(expect.edit.bytes)}, got ${JSON.stringify(text)}`);
  }

  // The second witness: the reader.
  const before = parseAs(testCase.format, bytes);
  if (!before.ok) {
    failures.push("the input does not parse, but setValue answered an edit");
    return { name: testCase.name, passed: false, failures };
  }
  const replaced = resolvePointer(before.tree, testCase.pointer);
  // L3: the edit is the value's span — widened, where a tag cannot hold the value, over that tag and the blanks
  // after it (v1.12 FR-011); an anchor written after the tag is then carried again at the start of the edit's bytes.
  if (replaced !== undefined) {
    const dropped = new TextDecoder().decode(bytes.subarray(edit.start, replaced.span.start));
    const tagDrop = /^!(<[^>]*>|\S*)[ \t]+(&\S+[ \t]+)?$/.exec(dropped);
    const widenedOverTag = edit.start < replaced.span.start && tagDrop !== null && text.startsWith(tagDrop[2] ?? "");
    if ((replaced.span.start !== edit.start && !widenedOverTag) || replaced.span.end !== edit.end) {
      failures.push(`L3: the edit range ${edit.start}-${edit.end} is not the value's span ${replaced.span.start}-${replaced.span.end}`);
    }
  }
  const applied = new Uint8Array(bytes.length - (edit.end - edit.start) + edit.bytes.length);
  applied.set(bytes.subarray(0, edit.start), 0);
  applied.set(edit.bytes, edit.start);
  applied.set(bytes.subarray(edit.end), edit.start + edit.bytes.length);
  const after = parseAs(testCase.format, applied);
  if (!after.ok) {
    failures.push("the edited document does not parse");
    return { name: testCase.name, passed: false, failures };
  }
  // A third witness for YAML (v1.12 FR-011): `yaml` itself, which Cascata's reader overrules only by ignoring this
  // warning — a tag that cannot hold its value (`!!int x`) is read as intended by Cascata alone.
  if (testCase.format === "yaml") {
    const unresolved = parseDocument(new TextDecoder("utf-8", { ignoreBOM: true }).decode(applied)).warnings.filter((w) => w.code === "TAG_RESOLVE_FAILED");
    if (unresolved.length > 0) failures.push(`the edited document carries a tag that cannot hold its value: ${unresolved[0]?.message ?? ""}`);
  }
  const kind = expectedKind(value, replaced);
  // The places that share the value's bytes — the pointer itself, and under "warn" and "allow" every alias
  // and merge-key copy of it (v1.12 FR-007) — each read the value set; every other leaf is untouched.
  const sharing = replaced === undefined ? [testCase.pointer] : nodesAt(before.tree, "", replaced.span.start, replaced.span.end);
  if (!sharing.includes(testCase.pointer)) sharing.push(testCase.pointer);
  if (testCase.sharedEdits === "refuse" && sharing.length > 1) failures.push(`under refuse, an edit was answered for a value with copies: ${sharing.join(", ")}`);
  for (const pointer of sharing) {
    if (!sameScalar(resolvePointer(after.tree, pointer), kind, value)) {
      failures.push(`L2: the edited document does not read ${String(value)} as a ${kind} at ${pointer}`);
    }
  }
  const was = new Map<string, string>();
  const now = new Map<string, string>();
  leaves(before.tree, "", was);
  leaves(after.tree, "", now);
  for (const pointer of sharing) {
    now.delete(pointer);
    was.delete(pointer);
  }
  if ([...was].map(([k, v]) => `${k}=${v}`).join("\n") !== [...now].map(([k, v]) => `${k}=${v}`).join("\n")) {
    failures.push("L3: some other value changed when the edit was applied");
  }
  return { name: testCase.name, passed: failures.length === 0, failures };
}

function checkDiagnostic(actual: readonly Diagnostic[] | undefined, expected: { code: string; start: number; end: number }, failures: string[]): void {
  if (actual === undefined) {
    failures.push(`expected ${expected.code}, but the call succeeded`);
    return;
  }
  const match = actual.find((d) => d.code === expected.code);
  if (match === undefined) {
    failures.push(`expected ${expected.code}, got ${describe(actual)}`);
    return;
  }
  if (match.level !== "error") failures.push(`expected level error, got ${match.level}`);
  if (match.primary.start !== expected.start || match.primary.end !== expected.end) {
    failures.push(`${expected.code}: expected span ${expected.start}-${expected.end}, got ${match.primary.start}-${match.primary.end}`);
  }
}
