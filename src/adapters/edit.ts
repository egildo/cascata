/**
 * Writing a value back — SPEC.md Article IX (§19, v1.10); specs/018-write-value, specs/025-open-insert-delete.
 *
 * Four verbs on one document. `locate` answers the stored byte range and the
 * model kind of the value at an RFC 6901 pointer; `setValue`, `add` and `remove`
 * answer an **edit**: a byte range of the input and the bytes to put there.
 * None touches a file; applying the edit is the caller's. Since v1.15 a document
 * is **opened** (parsed once) and answers all four against the bytes as opened.
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
import { ARRAY_INDEX, resolvePointer, unescapePointerSegment } from "../model/pointer.js";
import type { Origin, SourceSpan } from "../model/span.js";
import { resolveLimits, type ParseLimits } from "./limits.js";
import { dataEqualsNode, equalsValue, hasLoneSurrogate, inspectData, isContainerData, plainScalarText, type EditData, type EditValue } from "./edit-data.js";
import { treeMatches, type Op } from "./readback.js";
import type { Plan } from "./plan.js";
import { openJson, parseBack as parseBackJson, renderJsonString } from "./json/write.js";
import { openYaml, parseBack as parseBackYaml, renderYamlString, yamlNonFinite, yamlPadding } from "./yaml/write.js";

export type { EditData, EditValue } from "./edit-data.js";

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
  /** YAML (v1.15): the value is written as an alias (`d: *b`). Removing the entry that holds it changes nothing it shares. */
  readonly valueIsAlias?: true;
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
   * where the tag starts and where the bytes kept after it begin (an anchor, a comment, a line break, then
   * the value); since v1.12.1 found wherever the tag is, so absent only when `yaml`'s tokens show none.
   */
  readonly tag?: { readonly holds: LocatedKind | undefined; readonly drop: () => { readonly start: number; readonly kept: number } | undefined };
}

export type FindResult = { readonly ok: true; readonly found: Found } | { readonly ok: false; readonly diagnostics: Diagnostic[] };

export function editDiagnostic(code: DiagnosticCode, message: string, primary: SourceSpan): Diagnostic {
  return createDiagnostic({ level: "error", code, message, primary });
}

function requireOptions(options: EditOptions, fnName: string): void {
  if (options === undefined || options === null || (options.format !== "yaml" && options.format !== "json")) {
    throw new Error(`${fnName}() requires options.format to be "yaml" or "json"`);
  }
  if (options.origin === undefined || options.origin === null) {
    throw new Error(`${fnName}() requires 'origin' identifying the document these bytes came from`);
  }
  if (options.sharedEdits !== undefined && options.sharedEdits !== "refuse" && options.sharedEdits !== "warn" && options.sharedEdits !== "allow") {
    throw new Error(`${fnName}(): sharedEdits must be "refuse", "warn" or "allow", got ${JSON.stringify(options.sharedEdits)}`);
  }
}

function requirePointer(pointer: string, fnName: string): void {
  if (typeof pointer !== "string" || (pointer !== "" && !pointer.startsWith("/"))) {
    throw new Error(`${fnName}(): malformed JSON Pointer ${JSON.stringify(pointer)}: must be empty or start with '/'`);
  }
}

function kindOf(node: Node): LocatedKind {
  return node.type === "scalar" ? node.kind : node.type;
}

/** Where a new entry goes in a container: the key of a mapping entry, the index of a sequence item. */
export type EntryAt = { readonly key: string } | { readonly index: number };

/** One format's parsed document: the tree its reader built, the finder over it, and the plans that edit around what it found (v1.15). */
export interface FormatOpened {
  readonly tree: Node;
  find(pointer: string, sharedEdits: SharedEdits): FindResult;
  /** Make the value at `found` (pointer `pointer`) equal `data`, where either is a container. */
  replace(found: Found, pointer: string, data: EditData): Plan;
  /** Add `data` at `at` to the container `container` is. */
  add(container: Found, at: EntryAt, data: EditData): Plan;
  /** Remove the entry `target` is from `container`, with what is attached to it. */
  remove(target: Found, container: Found, at: EntryAt): Plan;
  /** The span of the key `key` in the mapping `container`, wherever it is written or supplied. */
  keySpan(container: Found, key: string): SourceSpan | undefined;
  /**
   * The container that really holds `target`'s entry: `container` itself, except in YAML where the pointer reached the entry through a merge key
   * -- the entry then lives in the merge source, and that mapping (with its copies and the maps that merge it) is what an edit changes.
   */
  owner(target: Found, container: Found): Found;
  /** YAML: the pointers of the mappings that merge (`<<: *base`) the mapping `container` is, directly or through others -- they gain or lose the key an edit adds or removes. */
  dependents(container: Found): readonly string[];
  /** YAML: whether `target` is a key that overrides one a merge key supplies, with both spans. */
  mergedUnder(target: Found): { readonly key: SourceSpan; readonly merged: SourceSpan } | undefined;
}

/** What an opened document keeps. */
interface Doc {
  readonly bytes: Uint8Array;
  readonly options: EditOptions;
  readonly sharedEdits: SharedEdits;
  readonly limits: ParseLimits;
  readonly format: FormatOpened;
}

/**
 * A document parsed once (v1.15 FR-001 to FR-004, SPEC.md Article IX). Its bytes are its own copy; its answers
 * are always against them, never against an edit it has given, so the edits it answers are independent and a
 * caller applies several together only where they do not overlap (the Language Server Protocol's rule for a batch of
 * text edits). `locate` costs no parse after the opening; `setValue`, `add` and `remove` cost one, their read-back,
 * and only when they answer an edit to check.
 *
 * **Two limits of "independent", documented because the read-back cannot see them** (the parked batch read-back would):
 * an `add` into an *empty* container rewrites the `{}` or `[]`, so two such adds overlap and the caller must reopen between
 * them; and `remove`s of every entry of one mapping, answered one at a time and applied together, leave `walls:` with
 * nothing under it, which reads as null. Each edit alone is right.
 */
export interface OpenedDocument {
  /** As the one-shot `locate`, over the bytes as opened. */
  locate(pointer: string): LocateResult;
  /** As the one-shot `setValue`, over the bytes as opened. */
  setValue(pointer: string, value: EditData): SetValueResult;
  /** v1.15: create the entry at `pointer`, which must not exist; a sequence index, or `-` to append. */
  add(pointer: string, value: EditData): SetValueResult;
  /** v1.15: delete the entry at `pointer`, with the comments attached to it. */
  remove(pointer: string): SetValueResult;
}

export type OpenResult = { readonly ok: true; readonly document: OpenedDocument } | { readonly ok: false; readonly diagnostics: Diagnostic[] };

/**
 * Parse `bytes` once and answer `locate`, `setValue`, `add` and `remove` as often as asked. A document that does not parse
 * gives the parse's own diagnostics. Only programmer error throws (a missing origin or format, a bad policy, a value that is
 * not `EditData`).
 */
export function openDocument(bytes: Uint8Array, options: EditOptions): OpenResult {
  return openDocumentUsing(bytes, options, (format) => format);
}

/**
 * `openDocument` with the format's plans passed through `wrap` first. Not exported from the package: it is how a test hands
 * the read-back a plan that is wrong (one that eats the next entry, say) to see that the read-back refuses it.
 */
export function openDocumentUsing(bytes: Uint8Array, options: EditOptions, wrap: (format: FormatOpened) => FormatOpened): OpenResult {
  requireOptions(options, "openDocument");
  // The document is its own: a caller who changes the array or the options afterwards changes nothing it answers (FR-002).
  const stored = Uint8Array.from(bytes);
  const fixed: EditOptions = { format: options.format, origin: options.origin, sharedEdits: options.sharedEdits ?? "refuse", ...(options.limits !== undefined ? { limits: { ...options.limits } } : {}) };
  const parsed = fixed.format === "yaml" ? openYaml(stored, fixed.origin, fixed.limits) : openJson(stored, fixed.origin, fixed.limits);
  if (!parsed.ok) {
    return parsed;
  }
  const doc: Doc = { bytes: stored, options: fixed, sharedEdits: fixed.sharedEdits ?? "refuse", limits: resolveLimits(fixed.limits), format: wrap(parsed.opened) };
  return {
    ok: true,
    document: {
      locate: (pointer) => locateIn(doc, pointer),
      setValue: (pointer, value) => setValueIn(doc, pointer, value),
      add: (pointer, value) => addIn(doc, pointer, value),
      remove: (pointer) => removeIn(doc, pointer),
    },
  };
}

function inspect(doc: Doc, value: unknown, fnName: string) {
  return inspectData(value, fnName, doc.limits.maxDepth, doc.limits.maxBytes);
}

/**
 * The stored byte range and model kind of the value at `pointer`, or why
 * there is none. A document that does not parse gives the parse's own
 * diagnostics. A container or a block scalar is located like any value --
 * only `setValue` refuses a block scalar.
 */
export function locate(bytes: Uint8Array, options: EditOptions, pointer: string): LocateResult {
  requireOptions(options, "locate");
  requirePointer(pointer, "locate");
  const result = openDocument(bytes, options);
  return result.ok ? result.document.locate(pointer) : result;
}

function locateIn(doc: Doc, pointer: string): LocateResult {
  requirePointer(pointer, "locate");
  // Under "warn" and "allow" a value reached through an alias is located at the bytes `setValue` would write (v1.12.1).
  const result = doc.format.find(pointer, doc.sharedEdits);
  if (!result.ok) {
    return result;
  }
  const { found } = result;
  return { ok: true, start: found.start, end: found.end, kind: kindOf(found.node) };
}

// --- what a value is, and how a number is spelled ------------------------

/** FR-006: the kind `value` must read back as, given the kind of the scalar it replaces. */
export function kindForValue(value: EditValue, replaced: Node): ScalarKind {
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "bool";
  if (value === null) return "null";
  if (typeof value === "bigint") return "int";
  // v1.15 (the owner's ruling): a whole number keeps an integer's kind; with no integer to keep, a `number` is a
  // decimal, as the value view hands decimals out as `number` and integers as `bigint`.
  if (replaced.type === "scalar" && replaced.kind === "int") return Number.isInteger(value) ? "int" : "float";
  return "float";
}

function scalarText(value: EditValue, kind: ScalarKind, options: EditOptions, found: Found): string | undefined {
  if (kind !== "string") return plainScalarText(value, kind, options.format === "yaml" ? yamlNonFinite : undefined);
  return options.format === "yaml" ? renderYamlString(value as string, found) : renderJsonString(value as string);
}

function describeValue(value: EditData): string {
  if (Array.isArray(value)) return `a sequence of ${value.length}`;
  if (value instanceof Map) return `a mapping of ${value.size}`;
  return typeof value === "string" ? JSON.stringify(value) : typeof value === "bigint" ? `${value}n` : String(value);
}

const refuseAt = (code: DiagnosticCode, message: string, span: SourceSpan): SetValueResult => ({ ok: false, diagnostics: [editDiagnostic(code, message, span)] });

/** A value deeper or larger than the document's limits would meet on being read: refused as the read-back would, earlier, with its code (v1.15 FR-007). */
function pastLimits(facts: ReturnType<typeof inspectData>, span: SourceSpan): SetValueResult | undefined {
  if (facts.tooDeep) return refuseAt("edit-read-back", "The value nests deeper than the document's depth limit allows", span);
  if (facts.tooBig) return refuseAt("edit-read-back", "The value holds more nodes than the document's size limit allows", span);
  return undefined;
}

/**
 * The edit that makes the value at `pointer` equal `value` (FR-002 to
 * FR-009), or why not. Never throws for a document or a value -- only for
 * programmer error (a missing origin or format, a malformed pointer, a value
 * that is not `EditData`).
 */
export function setValue(bytes: Uint8Array, options: EditOptions, pointer: string, value: EditData): SetValueResult {
  requireOptions(options, "setValue");
  requirePointer(pointer, "setValue");
  inspectData(value, "setValue", resolveLimits(options.limits).maxDepth, resolveLimits(options.limits).maxBytes);
  const result = openDocument(bytes, options);
  return result.ok ? result.document.setValue(pointer, value) : result;
}

function setValueIn(doc: Doc, pointer: string, value: EditData): SetValueResult {
  requirePointer(pointer, "setValue");
  const facts = inspect(doc, value, "setValue");
  const { bytes, options, sharedEdits } = doc;
  const result = doc.format.find(pointer, sharedEdits);
  if (!result.ok) {
    return result;
  }
  const { found } = result;
  const refuse = (code: DiagnosticCode, message: string): SetValueResult => refuseAt(code, message, found.span);

  if (found.sharedBy !== undefined && sharedEdits === "refuse") {
    return { ok: false, diagnostics: [editDiagnostic("edit-target-shared", "This value is anchored and an alias shares it; writing it would change every place that shares it", found.sharedBy)] };
  }
  const diagnostics: readonly Diagnostic[] = found.sharedBy !== undefined && sharedEdits === "warn" ? [sharedInfo(found)] : [];
  if (found.style === "block") {
    return refuse("edit-block-scalar", "A block scalar ('|' or '>') is not rewritten; only a plain or quoted scalar can be replaced");
  }

  if (isContainerData(value) || found.node.type !== "scalar") {
    // v1.15 FR-008: a container replaced, or written over a scalar. The kind is the value's.
    const limited = pastLimits(facts, found.span);
    if (limited !== undefined) return limited;
    if (dataEqualsNode(value, found.node)) {
      // L1: the value is already there (a mapping's key order is no part of it), so the bytes already there stay.
      return { ok: true, edit: { start: found.start, end: found.end, bytes: Uint8Array.from(bytes.subarray(found.start, found.end)) }, diagnostics };
    }
    const pointers = new Set([pointer, ...(found.copies ?? [])]);
    const ops: Op[] = [...pointers].map((at) => ({ kind: "replace", path: segmentsOf(at), data: value }));
    return finish(doc, doc.format.replace(found, pointer, value), ops, found.span, diagnostics, `${describeValue(value)} could not be written here and read back as the same value`);
  }

  if (typeof value === "string" && hasLoneSurrogate(value)) {
    return refuse("edit-unrepresentable", "A string with an unpaired UTF-16 surrogate cannot be encoded as UTF-8");
  }

  const kind = kindForValue(value, found.node);
  const existing = bytes.subarray(found.start, found.end);
  // L1: the value is already there, so the bytes already there stay -- whatever their spelling.
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
    // `yaml` resolved a tag, so its tokens hold one (v1.12.1): not finding it is a bug, not the document's fault.
    const drop = found.tag.drop();
    if (drop === undefined) throw new Error("Internal error: setValue(): the value has an explicit tag, and the parser's tokens show none");
    const kept = bytes.subarray(drop.kept, found.start);
    const joined = new Uint8Array(kept.length + encoded.length);
    joined.set(kept, 0);
    joined.set(encoded, kept.length);
    start = drop.start;
    encoded = joined;
  }
  const edit: Edit = { start, end: found.end, bytes: encoded };

  // The safety net: read the edit back. A value that does not come back as the
  // value set (an explicit `!!str` tag over a number, say) is refused, not returned.
  if (!readsBack(doc, [pointer, ...(found.copies ?? [])], edit, kind, value)) {
    return refuse("edit-read-back", `${describeValue(value)} could not be written here and read back as the same value`);
  }
  return { ok: true, edit, diagnostics };
}

const segmentsOf = (pointer: string): string[] => (pointer === "" ? [] : pointer.slice(1).split("/").map(unescapePointerSegment));

function applyTo(bytes: Uint8Array, edit: Edit): Uint8Array {
  const applied = new Uint8Array(bytes.length - (edit.end - edit.start) + edit.bytes.length);
  applied.set(bytes.subarray(0, edit.start), 0);
  applied.set(edit.bytes, edit.start);
  applied.set(bytes.subarray(edit.end), edit.start + edit.bytes.length);
  return applied;
}

function parseBackOf(doc: Doc, applied: Uint8Array): Node | undefined {
  return doc.options.format === "yaml" ? parseBackYaml(applied, doc.options.origin, doc.options.limits) : parseBackJson(applied, doc.options.origin, doc.options.limits);
}

/**
 * A plan becomes an edit only if it reads back (v1.15 FR-014, FR-019): the edited bytes are parsed once, and the tree must be the
 * original with every operation applied -- the whole tree, so that a sibling lost or a key moved is caught, not just the place edited.
 */
function finish(doc: Doc, plan: Plan, ops: readonly Op[], span: SourceSpan, diagnostics: readonly Diagnostic[], failure: string): SetValueResult {
  if (!plan.ok) {
    return { ok: false, diagnostics: [createDiagnostic({ level: "error", code: plan.code, message: plan.message, primary: plan.span ?? span, ...(plan.related !== undefined ? { related: [...plan.related] } : {}) })] };
  }
  const bytes = new TextEncoder().encode(plan.text);
  if (doc.bytes.length - (plan.end - plan.start) + bytes.length > doc.limits.maxBytes) {
    return refuseAt("edit-read-back", "The document would be larger than the size limit allows", span);
  }
  const edit: Edit = { start: plan.start, end: plan.end, bytes };
  const tree = parseBackOf(doc, applyTo(doc.bytes, edit));
  if (tree === undefined || !treeMatches(doc.format.tree, tree, ops)) return refuseAt("edit-read-back", failure, span);
  return { ok: true, edit, diagnostics };
}

// --- add and remove ------------------------------------------------------------------

function splitPointer(pointer: string): { readonly parent: string; readonly last: string } {
  const at = pointer.lastIndexOf("/");
  return { parent: pointer.slice(0, at), last: unescapePointerSegment(pointer.slice(at + 1)) };
}

/** Under "refuse" a shared container is refused (the first alias that shares it); under "warn" the edit says what else it changes. */
function sharing(doc: Doc, found: Found): { readonly refusal?: SetValueResult; readonly diagnostics: readonly Diagnostic[] } {
  if (found.sharedBy !== undefined && doc.sharedEdits === "refuse") {
    return { refusal: { ok: false, diagnostics: [editDiagnostic("edit-target-shared", "This value is anchored and an alias shares it; writing it would change every place that shares it", found.sharedBy)] }, diagnostics: [] };
  }
  return { diagnostics: found.sharedBy !== undefined && doc.sharedEdits === "warn" ? [sharedInfo(found)] : [] };
}

function addIn(doc: Doc, pointer: string, value: EditData): SetValueResult {
  requirePointer(pointer, "add");
  const facts = inspect(doc, value, "add");
  const root = doc.format.tree.span;
  // The empty pointer names the document, which exists: add creates, setValue changes.
  if (pointer === "") return refuseAt("edit-target-exists", "The root of the document exists; add creates and setValue changes", root);
  const { parent, last } = splitPointer(pointer);
  const found = doc.format.find(parent, doc.sharedEdits);
  if (!found.ok) return found;
  const container = found.found;
  const shared = sharing(doc, container);
  if (shared.refusal !== undefined) return shared.refusal;
  const node = container.node;
  if (node.type === "scalar") return refuseAt("edit-parent-scalar", `The value at '${parent}' is a scalar; an entry can only be added to a mapping or a sequence`, container.span);
  let at: EntryAt;
  if (node.type === "mapping") {
    const existing = node.entries.get(last);
    if (existing !== undefined) {
      return refuseAt("edit-target-exists", `A value already exists at '${pointer}'; add creates, setValue changes`, doc.format.keySpan(container, last) ?? existing.span);
    }
    at = { key: last };
  } else {
    const length = node.items.length;
    const index = last === "-" ? length : ARRAY_INDEX.test(last) ? Number(last) : -1;
    if (index < 0 || index > length) return refuseAt("edit-target-absent", `No place at '${pointer}'; a sequence of ${length} takes an index from 0 to ${length}, or '-'`, container.span);
    at = { index };
  }
  const limited = pastLimits(facts, container.span);
  if (limited !== undefined) return limited;
  const parents = new Set([parent, ...(container.copies ?? [])]);
  const ops: Op[] = [...parents, ].map((place) => ({ kind: "add", parent: segmentsOf(place), at, data: value }));
  if ("key" in at) for (const place of doc.format.dependents(container)) ops.push({ kind: "add", parent: segmentsOf(place), at, data: value, tolerant: true });
  return finish(doc, doc.format.add(container, at, value), ops, container.span, shared.diagnostics, `${describeValue(value)} could not be added here and read back as the entry added`);
}

function removeIn(doc: Doc, pointer: string): SetValueResult {
  requirePointer(pointer, "remove");
  if (pointer === "") return refuseAt("edit-remove-document", "The whole document cannot be removed", doc.format.tree.span);
  const { parent, last } = splitPointer(pointer);
  // An entry whose value is an alias (`d: *b`) shares nothing with what it points at: taking the entry out changes no other place.
  // So the policy is asked about the container then, and about the target (reached through an alias? anchored and aliased?) otherwise.
  const probe = doc.format.find(pointer, "allow");
  if (!probe.ok) return probe;
  const targetFound = probe.found.valueIsAlias === true ? probe : doc.format.find(pointer, doc.sharedEdits);
  if (!targetFound.ok) return targetFound;
  const target = targetFound.found;
  const containerFound = doc.format.find(parent, doc.sharedEdits);
  if (!containerFound.ok) return containerFound;
  const container = containerFound.found;
  const shared = sharing(doc, target.valueIsAlias === true ? container : target);
  if (shared.refusal !== undefined) return shared.refusal;
  const merged = doc.format.mergedUnder(target);
  if (merged !== undefined) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          level: "error",
          code: "edit-reveals-merged",
          message: `Removing '${pointer}' would let the value a merge key supplies show through; the key overrides it and is the document's own`,
          primary: merged.key,
          related: [{ label: "the value a merge key supplies", span: merged.merged }],
        }),
      ],
    };
  }
  const holder = doc.format.owner(target, container);
  const node = holder.node;
  if (node.type === "scalar") throw new Error("Internal error: remove(): the parent of a value is a scalar");
  const at: EntryAt = node.type === "mapping" ? { key: last } : { index: Number(last) };
  const parents = new Set(holder === container ? [parent, ...(container.copies ?? [])] : holder.copies ?? []);
  const ops: Op[] = [...parents].map((place) => ({ kind: "remove", parent: segmentsOf(place), at }));
  if ("key" in at) for (const place of doc.format.dependents(holder)) ops.push({ kind: "remove", parent: segmentsOf(place), at, tolerant: true });
  return finish(doc, doc.format.remove(target, holder, at), ops, target.span, shared.diagnostics, `'${pointer}' could not be removed here and read back as the entry gone`);
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

function readsBack(doc: Doc, pointers: readonly string[], edit: Edit, kind: ScalarKind, value: EditValue): boolean {
  const tree = parseBackOf(doc, applyTo(doc.bytes, edit));
  if (tree === undefined) return false;
  // The pointer asked about, and under "warn" and "allow" every place that shared the value's bytes before the edit
  // (v1.12 FR-007): each reads the value set, or the edit did not land where the value is held.
  return pointers.every((at) => {
    const node = resolvePointer(tree, at);
    return node !== undefined && equalsValue(node, kind, value);
  });
}
