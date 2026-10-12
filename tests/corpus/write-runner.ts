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
import { openDocument } from "../../src/index.js";
import type { EditData, EditValue } from "../../src/index.js";
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
  // v1.15: a whole number keeps an integer's kind; with no integer to keep, a `number` is a decimal.
  if (replaced !== undefined && replaced.type === "scalar" && replaced.kind === "int") return Number.isInteger(value) ? "int" : "float";
  return "float";
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

// --- the container oracle (v1.15): the original tree with the operation applied, restated here ---------------------
//
// A plain structure of the model: `{ s: "kind:value" }`, `{ m: Map }` or `{ q: [...] }`. Built from the reader's tree and
// from the data separately, so the writer's own comparison is never the judge of itself.

type Plain = { readonly s: string } | { readonly m: Map<string, Plain> } | { readonly q: Plain[] };

function plainOfNode(node: Node): Plain {
  if (node.type === "scalar") return { s: `${node.kind}:${node.value === null ? "" : String(node.value)}` };
  if (node.type === "mapping") return { m: new Map([...node.entries].map(([key, child]) => [key, plainOfNode(child)] as const)) };
  return { q: node.items.map(plainOfNode) };
}

function plainOfData(data: EditData, replaced?: Node): Plain {
  if (Array.isArray(data)) return { q: data.map((item) => plainOfData(item)) };
  if (data instanceof Map) return { m: new Map([...data].map(([key, child]) => [key, plainOfData(child)] as const)) };
  const value = data as EditValue;
  return { s: `${expectedKind(value, replaced)}:${value === null ? "" : String(typeof value === "number" && Object.is(value, -0) ? 0 : value)}` };
}

function canon(plain: Plain): string {
  if ("s" in plain) return JSON.stringify(plain.s);
  if ("m" in plain) return `{${[...plain.m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, child]) => `${JSON.stringify(key)}:${canon(child)}`).join(",")}}`;
  return `[${plain.q.map(canon).join(",")}]`;
}

type Operation = { readonly kind: "replace"; readonly data: EditData; readonly replaced: Node | undefined } | { readonly kind: "add"; readonly data: EditData } | { readonly kind: "remove" };

function applyAt(plain: Plain, segments: readonly string[], operation: Operation): Plain {
  if (segments.length === 0) {
    if (operation.kind !== "replace") throw new Error("the oracle cannot add to or remove the root");
    return plainOfData(operation.data, operation.replaced);
  }
  const [head, ...rest] = segments;
  if (head === undefined) throw new Error("unreachable");
  const last = rest.length === 0;
  if ("m" in plain) {
    const entries = new Map(plain.m);
    if (!last) {
      const child = entries.get(head);
      if (child === undefined) throw new Error(`the oracle has no ${head}`);
      entries.set(head, applyAt(child, rest, operation));
    } else if (operation.kind === "remove") entries.delete(head);
    else entries.set(head, plainOfData(operation.data, operation.kind === "replace" ? operation.replaced : undefined));
    return { m: entries };
  }
  if ("q" in plain) {
    const items = [...plain.q];
    const index = head === "-" ? items.length : Number(head);
    if (!last) {
      const child = items[index];
      if (child === undefined) throw new Error(`the oracle has no item ${head}`);
      items[index] = applyAt(child, rest, operation);
    } else if (operation.kind === "remove") items.splice(index, 1);
    else if (operation.kind === "add") items.splice(index, 0, plainOfData(operation.data));
    else items[index] = plainOfData(operation.data, operation.replaced);
    return { q: items };
  }
  throw new Error("the oracle descended into a scalar");
}

const segmentsOf = (pointer: string): string[] => (pointer === "" ? [] : pointer.slice(1).split("/").map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~")));

function applyEdit(bytes: Uint8Array, edit: { readonly start: number; readonly end: number; readonly bytes: Uint8Array }): Uint8Array {
  const applied = new Uint8Array(bytes.length - (edit.end - edit.start) + edit.bytes.length);
  applied.set(bytes.subarray(0, edit.start), 0);
  applied.set(edit.bytes, edit.start);
  applied.set(bytes.subarray(edit.end), edit.start + edit.bytes.length);
  return applied;
}

const isContainerData = (data: EditData): boolean => Array.isArray(data) || data instanceof Map;

function at(plain: Plain, segments: readonly string[]): Plain | undefined {
  let here: Plain | undefined = plain;
  for (const segment of segments) {
    if (here === undefined) return undefined;
    here = "m" in here ? here.m.get(segment) : "q" in here ? here.q[Number(segment)] : undefined;
  }
  return here;
}

function describe(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map((d) => `${d.code} at ${d.primary.start}-${d.primary.end}`).join(", ");
}

export function runWriteCase(testCase: WriteCase): WriteCaseResult {
  const failures: string[] = [];
  const bytes = writeSourceOf(testCase);
  const options = { format: testCase.format, origin: createOrigin("write-case", "write-case"), sharedEdits: testCase.sharedEdits };
  const { expect } = testCase;
  const opened = openDocument(bytes, options);

  if (testCase.call === "locate") {
    if (!opened.ok) {
      if ("diagnostic" in expect) checkDiagnostic(opened.diagnostics, expect.diagnostic, failures);
      else failures.push(`expected a location, got diagnostics: ${describe(opened.diagnostics)}`);
      return { name: testCase.name, passed: failures.length === 0, failures };
    }
    const result = opened.document.locate(testCase.pointer);
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

  if (!opened.ok) {
    if ("diagnostic" in expect) checkDiagnostic(opened.diagnostics, expect.diagnostic, failures);
    else failures.push(`the input does not open: ${describe(opened.diagnostics)}`);
    return { name: testCase.name, passed: failures.length === 0, failures };
  }
  const { document } = opened;
  const value = testCase.value;
  const result = testCase.call === "setValue" ? document.setValue(testCase.pointer, value as EditData) : testCase.call === "add" ? document.add(testCase.pointer, value as EditData) : document.remove(testCase.pointer);
  if ("diagnostic" in expect) {
    checkDiagnostic(result.ok ? undefined : result.diagnostics, expect.diagnostic, failures);
    if (result.ok) failures.push(`expected ${expect.diagnostic.code}, got an edit ${result.edit.start}-${result.edit.end}`);
    return { name: testCase.name, passed: failures.length === 0, failures };
  }
  if (!("edit" in expect)) {
    failures.push(`a ${testCase.call} case must expect an edit or a diagnostic`);
    return { name: testCase.name, passed: false, failures };
  }
  if (!result.ok) {
    failures.push(`expected an edit, got diagnostics: ${describe(result.diagnostics)}`);
    return { name: testCase.name, passed: false, failures };
  }
  const { edit } = result;
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
    failures.push("the input does not parse, but an edit was answered");
    return { name: testCase.name, passed: false, failures };
  }
  // v1.12 FR-005: under "warn" one info names what else the edit changes -- at the value (its span; an edit that widens over a tag
  // or rewrites around a container is not that range) or, for add and remove, at the container; under "refuse" and "allow", nothing is said.
  const infos = result.diagnostics.map((d) => `${d.level} ${d.code} at ${d.primary.start}-${d.primary.end}`);
  if (testCase.sharedEdits === "warn") {
    const here = testCase.call === "setValue" ? resolvePointer(before.tree, testCase.pointer)?.span : undefined;
    const acceptable = here === undefined ? [] : [`info edit-target-shared at ${here.start}-${here.end}`, `info edit-target-shared at ${edit.start}-${edit.end}`];
    if (infos.length !== 1 || !/^info edit-target-shared at \d+-\d+$/.test(infos[0] ?? "")) failures.push(`under warn, expected one info edit-target-shared, got [${infos.join(", ")}]`);
    else if (testCase.call === "setValue" && !acceptable.includes(infos[0] ?? "")) failures.push(`under warn, expected the info at the value, got [${infos.join(", ")}]`);
  } else if (infos.length !== 0) {
    failures.push(`under ${testCase.sharedEdits}, expected no diagnostic with the edit, got [${infos.join(", ")}]`);
  }
  const applied = applyEdit(bytes, edit);
  const after = parseAs(testCase.format, applied);
  if (!after.ok) {
    failures.push("the edited document does not parse");
    return { name: testCase.name, passed: false, failures };
  }
  if (testCase.format === "yaml") {
    // A third witness for YAML (v1.12 FR-011): `yaml` itself, which Cascata's reader overrules only by ignoring this
    // warning -- a tag that cannot hold its value (`!!int x`) is read as intended by Cascata alone.
    const unresolved = parseDocument(new TextDecoder("utf-8", { ignoreBOM: true }).decode(applied)).warnings.filter((w) => w.code === "TAG_RESOLVE_FAILED");
    if (unresolved.length > 0) failures.push(`the edited document carries a tag that cannot hold its value: ${unresolved[0]?.message ?? ""}`);
  }
  const replaced = testCase.call === "setValue" ? resolvePointer(before.tree, testCase.pointer) : undefined;
  const containerValue = isContainerData(value as EditData);

  if (testCase.call === "setValue" && !containerValue && replaced !== undefined && replaced.type === "scalar") {
    runScalarSetValue(testCase, bytes, edit, text, before.tree, after.tree, replaced, value as EditValue, failures);
    return { name: testCase.name, passed: failures.length === 0, failures };
  }

  // v1.15: the original tree with the operation applied is the edited tree. The copies (an alias, a merge key) of the
  // container written to hold the same bytes before the edit, so each must read the same afterwards (v1.12 FR-007).
  const parentPointer = testCase.pointer.slice(0, testCase.pointer.lastIndexOf("/"));
  const target = testCase.call === "setValue" ? replaced : resolvePointer(before.tree, parentPointer);
  const places = target === undefined ? [testCase.pointer] : nodesAt(before.tree, "", target.span.start, target.span.end);
  let expected = plainOfNode(before.tree);
  const operation: Operation = testCase.call === "setValue" ? { kind: "replace", data: value as EditData, replaced } : testCase.call === "add" ? { kind: "add", data: value as EditData } : { kind: "remove" };
  const last = testCase.pointer.slice(testCase.pointer.lastIndexOf("/") + 1);
  const pointers = testCase.call === "setValue" ? (places.includes(testCase.pointer) ? places : [...places, testCase.pointer]) : places.map((parent) => `${parent}/${last}`);
  if (testCase.sharedEdits === "refuse" && pointers.length > 1) failures.push(`under refuse, an edit was answered for a place with copies: ${pointers.join(", ")}`);
  for (const pointer of pointers) expected = applyAt(expected, segmentsOf(pointer), operation);
  // The mappings the case says merge the container: the key an add creates appears there too unless they have it; the one a remove deletes goes.
  for (const dependent of testCase.dependents) {
    const merging = at(expected, segmentsOf(dependent));
    if (merging === undefined || !("m" in merging)) continue;
    if (operation.kind === "add" && merging.m.has(last)) continue;
    expected = applyAt(expected, [...segmentsOf(dependent), last], operation);
  }
  if (canon(expected) !== canon(plainOfNode(after.tree))) {
    failures.push(`the edited tree is not the original with the operation applied:\n  expected ${canon(expected)}\n  got      ${canon(plainOfNode(after.tree))}`);
  }
  return { name: testCase.name, passed: failures.length === 0, failures };
}

/** The v1.10 laws for a scalar replaced by a scalar, as they have always been judged. */
function runScalarSetValue(testCase: WriteCase, bytes: Uint8Array, edit: { readonly start: number; readonly end: number }, text: string, beforeTree: Node, afterTree: Node, replaced: Node, value: EditValue, failures: string[]): void {
  // L3: the edit is the value's span -- widened, where a tag cannot hold the value, over that tag and the blanks
  // after it (v1.12 FR-011), and over the blanks before it when a line break follows (v1.12.1); whatever sat between
  // them and the value (line breaks, blanks, comments, an anchor; v1.12.1) is then carried again at the start of the
  // edit's bytes.
  const dropped = new TextDecoder().decode(bytes.subarray(edit.start, replaced.span.start));
  const tagDrop = /^([ \t]*)!(?:<[^>]*>|\S*)[ \t]*((?:[ \t]|\r\n|\n|\r|#[^\r\n]*|&\S+)*)$/.exec(dropped);
  const blanksBefore = tagDrop?.[1] ?? "";
  const kept = tagDrop?.[2] ?? "";
  const widenedOverTag = edit.start < replaced.span.start && tagDrop !== null && text.startsWith(kept) && (blanksBefore === "" || /^[\r\n]/.test(kept));
  if ((replaced.span.start !== edit.start && !widenedOverTag) || replaced.span.end !== edit.end) {
    failures.push(`L3: the edit range ${edit.start}-${edit.end} is not the value's span ${replaced.span.start}-${replaced.span.end}`);
  }
  const kind = expectedKind(value, replaced);
  // The places that share the value's bytes -- the pointer itself, and under "warn" and "allow" every alias
  // and merge-key copy of it (v1.12 FR-007) -- each read the value set; every other leaf is untouched.
  const sharing = nodesAt(beforeTree, "", replaced.span.start, replaced.span.end);
  if (!sharing.includes(testCase.pointer)) sharing.push(testCase.pointer);
  if (testCase.sharedEdits === "refuse" && sharing.length > 1) failures.push(`under refuse, an edit was answered for a value with copies: ${sharing.join(", ")}`);
  for (const pointer of sharing) {
    if (!sameScalar(resolvePointer(afterTree, pointer), kind, value)) {
      failures.push(`L2: the edited document does not read ${String(value)} as a ${kind} at ${pointer}`);
    }
  }
  const was = new Map<string, string>();
  const now = new Map<string, string>();
  leaves(beforeTree, "", was);
  leaves(afterTree, "", now);
  for (const pointer of sharing) {
    now.delete(pointer);
    was.delete(pointer);
  }
  if ([...was].map(([k, v]) => `${k}=${v}`).join("\n") !== [...now].map(([k, v]) => `${k}=${v}`).join("\n")) {
    failures.push("L3: some other value changed when the edit was applied");
  }
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
