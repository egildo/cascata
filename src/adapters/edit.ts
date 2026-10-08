/**
 * Writing a value back — SPEC.md Article IX (§19, v1.10); specs/018-write-value.
 *
 * Two verbs on one document. `locate` answers the stored byte range and the
 * model kind of the value at an RFC 6901 pointer; `setValue` answers an
 * **edit**: a byte range of the input and the bytes to put there. Neither
 * touches a file; applying the edit is the caller's.
 *
 * Cascata's half of a design shared, by shape, with a caller that owns the
 * editing session: one plug-in per format that reads, locates and writes.
 * Nothing here imports or names that caller, and nothing downstream of
 * `src/adapters/` imports this file (`tests/unit/layering.test.ts`).
 *
 * **One parser per format.** The position of a value is whatever the format's
 * own adapter measured when it read the document (`yaml/write.ts` asks the
 * `yaml` document `parseYaml` already holds; `json/write.ts` asks the tree
 * the JSON scanner built), so the writer cannot disagree with the reader about
 * where a byte is. This file is the format-blind part: the three laws, the
 * kind rule (FR-006), what a number looks like, and the safety net — every
 * edit is applied to a copy and read back, and one that does not read back as
 * the value set is refused rather than returned.
 */

import { createDiagnostic, type Diagnostic } from "../diagnostics/diagnostic.js";
import type { DiagnosticCode } from "../diagnostics/codes.js";
import type { Node, ScalarKind } from "../model/node.js";
import { resolvePointer } from "../model/pointer.js";
import type { Origin, SourceSpan } from "../model/span.js";
import type { ParseLimits } from "./limits.js";
import { findJson, parseBack as parseBackJson, renderJsonString } from "./json/write.js";
import { findYaml, parseBack as parseBackYaml, renderYamlString, yamlNonFinite, yamlPadding } from "./yaml/write.js";

export type EditFormat = "yaml" | "json";

/**
 * Whether a **shared** value is written (SPEC.md Article IX, v1.12 FR-005): one an alias or merge
 * key shares, or (for `editTarget`) one whose document is grafted at more than one place. `refuse`,
 * the default, is what the law was: `edit-target-shared`, `level: "error"`. `warn` answers the edit
 * with one `edit-target-shared` at `level: "info"` naming every other place the write changes.
 * `allow` answers it and says nothing. Set by the embedder where its writers and edit targets are
 * made; never global.
 */
export type SharedEdits = "refuse" | "warn" | "allow";

/** What `locate` and `setValue` read, as `parse` reads: the format, which document the bytes came from (required), and the limits. */
export interface EditOptions {
  readonly format: EditFormat;
  readonly origin: Origin;
  readonly limits?: Partial<ParseLimits>;
  /** v1.12: whether `setValue` writes a shared value; `"refuse"` when absent. `locate` follows it too (v1.12.1): under `"warn"` and `"allow"` it answers the bytes `setValue` writes. */
  readonly sharedEdits?: SharedEdits;
}

/** The kind of a located value: a scalar's model kind (§4.1), or `mapping`/`sequence`. */
export type LocatedKind = ScalarKind | "mapping" | "sequence";

export type LocateResult =
  | { readonly ok: true; readonly start: number; readonly end: number; readonly kind: LocatedKind }
  | { readonly ok: false; readonly diagnostics: Diagnostic[] };

/** A scalar the caller can set: `string`, `number`, `bigint`, `boolean` or `null`. */
export type EditValue = string | number | bigint | boolean | null;

/** Put `bytes` in place of `[start, end)` of the input — the bytes of the document as stored (§4.2), a byte-order mark and every carriage return counted. */
export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly bytes: Uint8Array;
}

/** `diagnostics` on success (v1.12): empty, or under `sharedEdits: "warn"` the one `info` naming what else the edit changes. */
export type SetValueResult = { readonly ok: true; readonly edit: Edit; readonly diagnostics: readonly Diagnostic[] } | { readonly ok: false; readonly diagnostics: Diagnostic[] };

/** How a value was written, so a string can keep the style of the scalar it replaces. */
export type ScalarStyle = "plain" | "single" | "double" | "block" | "json";

/** The value at a pointer, as the format's adapter measured it. */
export interface Found {
  readonly start: number;
  readonly end: number;
  readonly node: Node;
  /** The node's span — the primary of a refusal at this value. */
  readonly span: SourceSpan;
  readonly style: ScalarStyle;
  /** Inside a flow collection (`[a, b]`, `{k: v}`): where `,`, `[`, `]`, `{` and `}` end a plain scalar. */
  readonly inFlow: boolean;
  /** YAML: the first alias that shares this value (it, or a container above it, is anchored and aliased). `locate` still answers; `setValue` refuses under `"refuse"`. */
  readonly sharedBy?: SourceSpan;
  /** YAML, under `"warn"` (v1.12 FR-005): every alias whose expansion holds this value, in document order — the other places the write changes. */
  readonly sharedWith?: readonly SourceSpan[];
  /** YAML, under `"warn"` and `"allow"` (v1.12 FR-007): the pointer of every node of the document that holds these bytes, read before the edit — each must read the value set after it. */
  readonly copies?: readonly string[];
  /**
   * YAML (v1.12 FR-010): the value of a key written with no value at all (`? a`). `indicator` is what the
   * edit must add before the value — a line break, the key's indentation and `: ` — or `undefined` in a
   * flow collection, where the value is refused rather than spelled.
   */
  readonly bareKey?: { readonly indicator: string | undefined };
  /**
   * YAML (v1.12 FR-011): the scalar's explicit tag. `holds` is the one kind the tag can hold. `drop` is
   * where the tag starts and where the bytes kept after it begin (an anchor written after the tag, then
   * the value), when the tag is on the value's own line; absent, the tag cannot be removed by this writer.
   */
  readonly tag?: { readonly holds: ScalarKind | undefined; readonly drop?: { readonly start: number; readonly kept: number } };
}

export type FindResult = { readonly ok: true; readonly found: Found } | { readonly ok: false; readonly diagnostics: Diagnostic[] };

export function editDiagnostic(code: DiagnosticCode, message: string, primary: SourceSpan): Diagnostic {
  return createDiagnostic({ level: "error", code, message, primary });
}

function requireArguments(options: EditOptions, pointer: string, fnName: string): void {
  if (options === undefined || options === null || (options.format !== "yaml" && options.format !== "json")) {
    throw new Error(`${fnName}() requires options.format to be "yaml" or "json"`);
  }
  if (options.origin === undefined || options.origin === null) {
    throw new Error(`${fnName}() requires 'origin' identifying the document these bytes came from`);
  }
  if (options.sharedEdits !== undefined && options.sharedEdits !== "refuse" && options.sharedEdits !== "warn" && options.sharedEdits !== "allow") {
    throw new Error(`${fnName}(): sharedEdits must be "refuse", "warn" or "allow", got ${JSON.stringify(options.sharedEdits)}`);
  }
  if (typeof pointer !== "string" || (pointer !== "" && !pointer.startsWith("/"))) {
    throw new Error(`${fnName}(): malformed JSON Pointer ${JSON.stringify(pointer)}: must be empty or start with '/'`);
  }
}

function find(bytes: Uint8Array, options: EditOptions, pointer: string, sharedEdits: SharedEdits): FindResult {
  return options.format === "yaml" ? findYaml(bytes, options.origin, options.limits, pointer, sharedEdits) : findJson(bytes, options.origin, options.limits, pointer);
}

function kindOf(node: Node): LocatedKind {
  return node.type === "scalar" ? node.kind : node.type;
}

/**
 * The stored byte range and model kind of the value at `pointer`, or why
 * there is none. A document that does not parse gives the parse's own
 * diagnostics. A container or a block scalar is located like any value —
 * only `setValue` refuses them.
 */
export function locate(bytes: Uint8Array, options: EditOptions, pointer: string): LocateResult {
  requireArguments(options, pointer, "locate");
  // Under "warn" and "allow" a value reached through an alias is located at the bytes `setValue` would write (v1.12.1).
  const result = find(bytes, options, pointer, options.sharedEdits ?? "refuse");
  if (!result.ok) {
    return result;
  }
  const { found } = result;
  return { ok: true, start: found.start, end: found.end, kind: kindOf(found.node) };
}

// --- what a value is, and how a number is spelled ------------------------

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** FR-006: the kind `value` must read back as, given the kind of the scalar it replaces. */
export function kindForValue(value: EditValue, replaced: Node): ScalarKind {
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "bool";
  if (value === null) return "null";
  if (typeof value === "bigint") return "int";
  if (replaced.type === "scalar" && replaced.kind === "float") return "float";
  return Number.isInteger(value) ? "int" : "float";
}

/** §4.2's equality of a model scalar and a value of the given kind; `NaN` equals `NaN` here, because setting it again must write nothing new. */
function equalsValue(node: Node, kind: ScalarKind, value: EditValue): boolean {
  if (node.type !== "scalar" || node.kind !== kind) return false;
  switch (node.kind) {
    case "string":
    case "bool":
      return node.value === value;
    case "int":
      return typeof value !== "string" && typeof value !== "boolean" && value !== null && node.value === BigInt(value);
    case "float":
      return typeof value === "number" && (node.value === value || (Number.isNaN(node.value) && Number.isNaN(value)));
    case "null":
      return true;
  }
}

/** The shortest round-trip spelling with a decimal point or an exponent guaranteed (FR-006): `3` is `3.0`, `-0` is `-0.0`, `1e21` is `1e+21`. */
function floatText(value: number): string {
  if (Object.is(value, -0)) return "-0.0";
  const text = String(value);
  return /^-?\d+$/.test(text) ? `${text}.0` : text;
}

function scalarText(value: EditValue, kind: ScalarKind, options: EditOptions, found: Found): string | undefined {
  switch (kind) {
    case "bool":
      return value === true ? "true" : "false";
    case "null":
      return "null";
    case "int":
      return BigInt(value as number | bigint).toString();
    case "float": {
      const number = value as number;
      if (!Number.isFinite(number)) {
        return options.format === "yaml" ? yamlNonFinite(number) : undefined;
      }
      return floatText(number);
    }
    case "string":
      return options.format === "yaml" ? renderYamlString(value as string, found) : renderJsonString(value as string);
  }
}

function describeValue(value: EditValue): string {
  return typeof value === "string" ? JSON.stringify(value) : typeof value === "bigint" ? `${value}n` : String(value);
}

/**
 * The edit that makes the value at `pointer` equal `value` (FR-002 to
 * FR-009), or why not. Never throws for a document or a value — only for
 * programmer error (a missing origin or format, a malformed pointer, a value
 * that is not a scalar).
 */
export function setValue(bytes: Uint8Array, options: EditOptions, pointer: string, value: EditValue): SetValueResult {
  requireArguments(options, pointer, "setValue");
  if (!(typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean" || value === null)) {
    throw new TypeError("setValue() takes a scalar value: string, number, bigint, boolean or null");
  }
  const sharedEdits = options.sharedEdits ?? "refuse";
  const result = find(bytes, options, pointer, sharedEdits);
  if (!result.ok) {
    return result;
  }
  const { found } = result;
  const refuse = (code: DiagnosticCode, message: string): SetValueResult => ({ ok: false, diagnostics: [editDiagnostic(code, message, found.span)] });

  if (found.sharedBy !== undefined && sharedEdits === "refuse") {
    return { ok: false, diagnostics: [editDiagnostic("edit-target-shared", "This value is anchored and an alias shares it; writing it would change every place that shares it", found.sharedBy)] };
  }
  const diagnostics: readonly Diagnostic[] = found.sharedBy !== undefined && sharedEdits === "warn" ? [sharedInfo(found)] : [];
  if (found.node.type !== "scalar") {
    return refuse("edit-container", `Setting a ${found.node.type} is an insertion, which is not written yet; only a scalar can be replaced`);
  }
  if (found.style === "block") {
    return refuse("edit-block-scalar", "A block scalar ('|' or '>') is not rewritten; only a plain or quoted scalar can be replaced");
  }
  if (typeof value === "string" && LONE_SURROGATE.test(value)) {
    return refuse("edit-unrepresentable", "A string with an unpaired UTF-16 surrogate cannot be encoded as UTF-8");
  }

  const kind = kindForValue(value, found.node);
  const existing = bytes.subarray(found.start, found.end);
  // L1: the value is already there, so the bytes already there stay — whatever their spelling.
  if (equalsValue(found.node, kind, value)) {
    return { ok: true, edit: { start: found.start, end: found.end, bytes: Uint8Array.from(existing) }, diagnostics };
  }

  const text = scalarText(value, kind, options, found);
  if (text === undefined) {
    return refuse("edit-unrepresentable", `${options.format.toUpperCase()} has no spelling for ${describeValue(value)}`);
  }
  let spelled = text;
  if (found.bareKey !== undefined) {
    // A key with no value (`? a`): the value needs the indicator the document lacks, on its own line (v1.12 FR-010).
    if (found.bareKey.indicator === undefined) return refuse("edit-bare-key-in-flow", "A key with no value inside a flow collection is not written; only a key that has a value, or a block mapping's `? key`, can take one");
    spelled = found.bareKey.indicator + yamlPadding(bytes, found.start, text).trimStart();
  } else if (options.format === "yaml" && found.end === found.start) {
    spelled = yamlPadding(bytes, found.start, text);
  }
  let start = found.start;
  let encoded = new TextEncoder().encode(spelled);
  if (found.tag !== undefined && found.tag.holds !== kind) {
    // A tag that cannot hold the value is not written over it (v1.12 FR-011): the edit widens over the tag and the
    // space after it, and carries again whatever sat between them and the value (an anchor written after the tag).
    if (found.tag.drop === undefined) return refuse("edit-tag-elsewhere", `The value's explicit tag cannot hold ${describeValue(value)}, and it is not on the value's own line, where this writer could remove it`);
    const kept = bytes.subarray(found.tag.drop.kept, found.start);
    const joined = new Uint8Array(kept.length + encoded.length);
    joined.set(kept, 0);
    joined.set(encoded, kept.length);
    start = found.tag.drop.start;
    encoded = joined;
  }
  const edit: Edit = { start, end: found.end, bytes: encoded };

  // The safety net: read the edit back. A value that does not come back as the
  // value set (an explicit `!!str` tag over a number, say) is refused, not returned.
  if (!readsBack(bytes, options, [pointer, ...(found.copies ?? [])], edit, kind, value)) {
    return refuse("edit-read-back", `${describeValue(value)} could not be written here and read back as the same value`);
  }
  return { ok: true, edit, diagnostics };
}

/** Under `"warn"`: the edit is answered, and this says so — at the value, naming every alias that shares it (v1.12 FR-005). */
function sharedInfo(found: Found): Diagnostic {
  const others = found.sharedWith ?? [];
  return createDiagnostic({
    level: "info",
    code: "edit-target-shared",
    message: `This value is shared; the edit also changes ${others.length === 1 ? "the place an alias shares it" : `the ${others.length} places aliases share it`}`,
    primary: found.span,
    related: others.map((span) => ({ label: "an alias that shares this value", span })),
  });
}

function readsBack(bytes: Uint8Array, options: EditOptions, pointers: readonly string[], edit: Edit, kind: ScalarKind, value: EditValue): boolean {
  const applied = new Uint8Array(bytes.length - (edit.end - edit.start) + edit.bytes.length);
  applied.set(bytes.subarray(0, edit.start), 0);
  applied.set(edit.bytes, edit.start);
  applied.set(bytes.subarray(edit.end), edit.start + edit.bytes.length);
  const tree = options.format === "yaml" ? parseBackYaml(applied, options.origin, options.limits) : parseBackJson(applied, options.origin, options.limits);
  if (tree === undefined) return false;
  // The pointer asked about, and under "warn" and "allow" every place that shared the value's bytes before the edit
  // (v1.12 FR-007): each reads the value set, or the edit did not land where the value is held.
  return pointers.every((at) => {
    const node = resolvePointer(tree, at);
    return node !== undefined && equalsValue(node, kind, value);
  });
}
