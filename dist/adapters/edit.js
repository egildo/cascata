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
import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { resolvePointer } from "../model/pointer.js";
import { findJson, parseBack as parseBackJson, renderJsonString } from "./json/write.js";
import { findYaml, parseBack as parseBackYaml, renderYamlString, yamlNonFinite, yamlPadding } from "./yaml/write.js";
export function editDiagnostic(code, message, primary) {
    return createDiagnostic({ level: "error", code, message, primary });
}
function requireArguments(options, pointer, fnName) {
    if (options === undefined || options === null || (options.format !== "yaml" && options.format !== "json")) {
        throw new Error(`${fnName}() requires options.format to be "yaml" or "json"`);
    }
    if (options.origin === undefined || options.origin === null) {
        throw new Error(`${fnName}() requires 'origin' identifying the document these bytes came from`);
    }
    if (typeof pointer !== "string" || (pointer !== "" && !pointer.startsWith("/"))) {
        throw new Error(`${fnName}(): malformed JSON Pointer ${JSON.stringify(pointer)}: must be empty or start with '/'`);
    }
}
function find(bytes, options, pointer) {
    return options.format === "yaml" ? findYaml(bytes, options.origin, options.limits, pointer) : findJson(bytes, options.origin, options.limits, pointer);
}
function kindOf(node) {
    return node.type === "scalar" ? node.kind : node.type;
}
/**
 * The stored byte range and model kind of the value at `pointer`, or why
 * there is none. A document that does not parse gives the parse's own
 * diagnostics. A container or a block scalar is located like any value —
 * only `setValue` refuses them.
 */
export function locate(bytes, options, pointer) {
    requireArguments(options, pointer, "locate");
    const result = find(bytes, options, pointer);
    if (!result.ok) {
        return result;
    }
    const { found } = result;
    return { ok: true, start: found.start, end: found.end, kind: kindOf(found.node) };
}
// --- what a value is, and how a number is spelled ------------------------
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** FR-006: the kind `value` must read back as, given the kind of the scalar it replaces. */
export function kindForValue(value, replaced) {
    if (typeof value === "string")
        return "string";
    if (typeof value === "boolean")
        return "bool";
    if (value === null)
        return "null";
    if (typeof value === "bigint")
        return "int";
    if (replaced.type === "scalar" && replaced.kind === "float")
        return "float";
    return Number.isInteger(value) ? "int" : "float";
}
/** §4.2's equality of a model scalar and a value of the given kind; `NaN` equals `NaN` here, because setting it again must write nothing new. */
function equalsValue(node, kind, value) {
    if (node.type !== "scalar" || node.kind !== kind)
        return false;
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
function floatText(value) {
    if (Object.is(value, -0))
        return "-0.0";
    const text = String(value);
    return /^-?\d+$/.test(text) ? `${text}.0` : text;
}
function scalarText(value, kind, options, found) {
    switch (kind) {
        case "bool":
            return value === true ? "true" : "false";
        case "null":
            return "null";
        case "int":
            return BigInt(value).toString();
        case "float": {
            const number = value;
            if (!Number.isFinite(number)) {
                return options.format === "yaml" ? yamlNonFinite(number) : undefined;
            }
            return floatText(number);
        }
        case "string":
            return options.format === "yaml" ? renderYamlString(value, found) : renderJsonString(value);
    }
}
function describeValue(value) {
    return typeof value === "string" ? JSON.stringify(value) : typeof value === "bigint" ? `${value}n` : String(value);
}
/**
 * The edit that makes the value at `pointer` equal `value` (FR-002 to
 * FR-009), or why not. Never throws for a document or a value — only for
 * programmer error (a missing origin or format, a malformed pointer, a value
 * that is not a scalar).
 */
export function setValue(bytes, options, pointer, value) {
    requireArguments(options, pointer, "setValue");
    if (!(typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean" || value === null)) {
        throw new TypeError("setValue() takes a scalar value: string, number, bigint, boolean or null");
    }
    const result = find(bytes, options, pointer);
    if (!result.ok) {
        return result;
    }
    const { found } = result;
    const refuse = (code, message) => ({ ok: false, diagnostics: [editDiagnostic(code, message, found.span)] });
    if (found.sharedBy !== undefined) {
        return { ok: false, diagnostics: [editDiagnostic("edit-target-shared", "This value is anchored and an alias shares it; writing it would change every place that shares it", found.sharedBy)] };
    }
    if (found.node.type !== "scalar") {
        return refuse("edit-unsupported", `Setting a ${found.node.type} is an insertion, which is not written yet; only a scalar can be replaced`);
    }
    if (found.style === "block") {
        return refuse("edit-unsupported", "A block scalar ('|' or '>') is not rewritten; only a plain or quoted scalar can be replaced");
    }
    if (typeof value === "string" && LONE_SURROGATE.test(value)) {
        return refuse("edit-unrepresentable", "A string with an unpaired UTF-16 surrogate cannot be encoded as UTF-8");
    }
    const kind = kindForValue(value, found.node);
    const existing = bytes.subarray(found.start, found.end);
    // L1: the value is already there, so the bytes already there stay — whatever their spelling.
    if (equalsValue(found.node, kind, value)) {
        return { ok: true, edit: { start: found.start, end: found.end, bytes: Uint8Array.from(existing) } };
    }
    const text = scalarText(value, kind, options, found);
    if (text === undefined) {
        return refuse("edit-unrepresentable", `${options.format.toUpperCase()} has no spelling for ${describeValue(value)}`);
    }
    const encoded = new TextEncoder().encode(options.format === "yaml" && found.end === found.start ? yamlPadding(bytes, found.start, text) : text);
    const edit = { start: found.start, end: found.end, bytes: encoded };
    // The safety net: read the edit back. A value that does not come back as the
    // value set (an explicit `!!str` tag over a number, say) is refused, not returned.
    if (!readsBack(bytes, options, pointer, edit, kind, value)) {
        return refuse("edit-unsupported", `${describeValue(value)} could not be written here and read back as the same value`);
    }
    return { ok: true, edit };
}
function readsBack(bytes, options, pointer, edit, kind, value) {
    const applied = new Uint8Array(bytes.length - (edit.end - edit.start) + edit.bytes.length);
    applied.set(bytes.subarray(0, edit.start), 0);
    applied.set(edit.bytes, edit.start);
    applied.set(bytes.subarray(edit.end), edit.start + edit.bytes.length);
    const tree = options.format === "yaml" ? parseBackYaml(applied, options.origin, options.limits) : parseBackJson(applied, options.origin, options.limits);
    if (tree === undefined)
        return false;
    const node = resolvePointer(tree, pointer);
    return node !== undefined && equalsValue(node, kind, value);
}
//# sourceMappingURL=edit.js.map