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
import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { ARRAY_INDEX, resolvePointer, unescapePointerSegment } from "../model/pointer.js";
import { resolveLimits } from "./limits.js";
import { dataEqualsNode, equalsValue, hasLoneSurrogate, inspectData, isContainerData, plainScalarText } from "./edit-data.js";
import { treeMatches } from "./readback.js";
import { openJson, parseBack as parseBackJson, renderJsonString } from "./json/write.js";
import { openYaml, parseBack as parseBackYaml, renderYamlString, yamlNonFinite, yamlPadding } from "./yaml/write.js";
export function editDiagnostic(code, message, primary) {
    return createDiagnostic({ level: "error", code, message, primary });
}
function requireOptions(options, fnName) {
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
function requirePointer(pointer, fnName) {
    if (typeof pointer !== "string" || (pointer !== "" && !pointer.startsWith("/"))) {
        throw new Error(`${fnName}(): malformed JSON Pointer ${JSON.stringify(pointer)}: must be empty or start with '/'`);
    }
}
function kindOf(node) {
    return node.type === "scalar" ? node.kind : node.type;
}
/**
 * Parse `bytes` once and answer `locate`, `setValue`, `add` and `remove` as often as asked. A document that does not parse
 * gives the parse's own diagnostics. Only programmer error throws (a missing origin or format, a bad policy, a value that is
 * not `EditData`).
 */
export function openDocument(bytes, options) {
    return openDocumentUsing(bytes, options, (format) => format);
}
/**
 * `openDocument` with the format's plans passed through `wrap` first. Not exported from the package: it is how a test hands
 * the read-back a plan that is wrong (one that eats the next entry, say) to see that the read-back refuses it.
 */
export function openDocumentUsing(bytes, options, wrap) {
    requireOptions(options, "openDocument");
    // The document is its own: a caller who changes the array or the options afterwards changes nothing it answers (FR-002).
    const stored = Uint8Array.from(bytes);
    const fixed = { format: options.format, origin: options.origin, sharedEdits: options.sharedEdits ?? "refuse", ...(options.limits !== undefined ? { limits: { ...options.limits } } : {}) };
    const parsed = fixed.format === "yaml" ? openYaml(stored, fixed.origin, fixed.limits) : openJson(stored, fixed.origin, fixed.limits);
    if (!parsed.ok) {
        return parsed;
    }
    const doc = { bytes: stored, options: fixed, sharedEdits: fixed.sharedEdits ?? "refuse", limits: resolveLimits(fixed.limits), format: wrap(parsed.opened) };
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
function inspect(doc, value, fnName) {
    return inspectData(value, fnName, doc.limits.maxDepth, doc.limits.maxBytes);
}
/**
 * The stored byte range and model kind of the value at `pointer`, or why
 * there is none. A document that does not parse gives the parse's own
 * diagnostics. A container or a block scalar is located like any value --
 * only `setValue` refuses a block scalar.
 */
export function locate(bytes, options, pointer) {
    requireOptions(options, "locate");
    requirePointer(pointer, "locate");
    const result = openDocument(bytes, options);
    return result.ok ? result.document.locate(pointer) : result;
}
function locateIn(doc, pointer) {
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
export function kindForValue(value, replaced) {
    if (typeof value === "string")
        return "string";
    if (typeof value === "boolean")
        return "bool";
    if (value === null)
        return "null";
    if (typeof value === "bigint")
        return "int";
    // v1.15 (the owner's ruling): a whole number keeps an integer's kind; with no integer to keep, a `number` is a
    // decimal, as the value view hands decimals out as `number` and integers as `bigint`.
    if (replaced.type === "scalar" && replaced.kind === "int")
        return Number.isInteger(value) ? "int" : "float";
    return "float";
}
function scalarText(value, kind, options, found) {
    if (kind !== "string")
        return plainScalarText(value, kind, options.format === "yaml" ? yamlNonFinite : undefined);
    return options.format === "yaml" ? renderYamlString(value, found) : renderJsonString(value);
}
function describeValue(value) {
    if (Array.isArray(value))
        return `a sequence of ${value.length}`;
    if (value instanceof Map)
        return `a mapping of ${value.size}`;
    return typeof value === "string" ? JSON.stringify(value) : typeof value === "bigint" ? `${value}n` : String(value);
}
const refuseAt = (code, message, span) => ({ ok: false, diagnostics: [editDiagnostic(code, message, span)] });
/** A value deeper or larger than the document's limits would meet on being read: refused as the read-back would, earlier, with its code (v1.15 FR-007). */
function pastLimits(facts, span) {
    if (facts.tooDeep)
        return refuseAt("edit-read-back", "The value nests deeper than the document's depth limit allows", span);
    if (facts.tooBig)
        return refuseAt("edit-read-back", "The value holds more nodes than the document's size limit allows", span);
    return undefined;
}
/**
 * The edit that makes the value at `pointer` equal `value` (FR-002 to
 * FR-009), or why not. Never throws for a document or a value -- only for
 * programmer error (a missing origin or format, a malformed pointer, a value
 * that is not `EditData`).
 */
export function setValue(bytes, options, pointer, value) {
    requireOptions(options, "setValue");
    requirePointer(pointer, "setValue");
    inspectData(value, "setValue", resolveLimits(options.limits).maxDepth, resolveLimits(options.limits).maxBytes);
    const result = openDocument(bytes, options);
    return result.ok ? result.document.setValue(pointer, value) : result;
}
function setValueIn(doc, pointer, value) {
    requirePointer(pointer, "setValue");
    const facts = inspect(doc, value, "setValue");
    const { bytes, options, sharedEdits } = doc;
    const result = doc.format.find(pointer, sharedEdits);
    if (!result.ok) {
        return result;
    }
    const { found } = result;
    const refuse = (code, message) => refuseAt(code, message, found.span);
    if (found.sharedBy !== undefined && sharedEdits === "refuse") {
        return { ok: false, diagnostics: [editDiagnostic("edit-target-shared", "This value is anchored and an alias shares it; writing it would change every place that shares it", found.sharedBy)] };
    }
    const diagnostics = found.sharedBy !== undefined && sharedEdits === "warn" ? [sharedInfo(found)] : [];
    if (found.style === "block") {
        return refuse("edit-block-scalar", "A block scalar ('|' or '>') is not rewritten; only a plain or quoted scalar can be replaced");
    }
    if (isContainerData(value) || found.node.type !== "scalar") {
        // v1.15 FR-008: a container replaced, or written over a scalar. The kind is the value's.
        const limited = pastLimits(facts, found.span);
        if (limited !== undefined)
            return limited;
        if (dataEqualsNode(value, found.node)) {
            // L1: the value is already there (a mapping's key order is no part of it), so the bytes already there stay.
            return { ok: true, edit: { start: found.start, end: found.end, bytes: Uint8Array.from(bytes.subarray(found.start, found.end)) }, diagnostics };
        }
        const pointers = new Set([pointer, ...(found.copies ?? [])]);
        const ops = [...pointers].map((at) => ({ kind: "replace", path: segmentsOf(at), data: value }));
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
        if (found.bareKey.indicator === undefined)
            return refuse("edit-bare-key-in-flow", "A key with no value inside a flow collection is not written; only a key that has a value, or a block mapping's `? key`, can take one");
        spelled = found.bareKey.indicator + yamlPadding(bytes, found.start, text).trimStart();
    }
    else if (options.format === "yaml" && found.end === found.start) {
        spelled = yamlPadding(bytes, found.start, text);
    }
    let start = found.start;
    let encoded = new TextEncoder().encode(spelled);
    if (found.tag !== undefined && found.tag.holds !== kind) {
        // A tag that cannot hold the value is not written over it (v1.12 FR-011): the edit widens over the tag and the
        // space after it, and carries again whatever sat between them and the value (an anchor written after the tag).
        // `yaml` resolved a tag, so its tokens hold one (v1.12.1): not finding it is a bug, not the document's fault.
        const drop = found.tag.drop();
        if (drop === undefined)
            throw new Error("Internal error: setValue(): the value has an explicit tag, and the parser's tokens show none");
        const kept = bytes.subarray(drop.kept, found.start);
        const joined = new Uint8Array(kept.length + encoded.length);
        joined.set(kept, 0);
        joined.set(encoded, kept.length);
        start = drop.start;
        encoded = joined;
    }
    const edit = { start, end: found.end, bytes: encoded };
    // The safety net: read the edit back. A value that does not come back as the
    // value set (an explicit `!!str` tag over a number, say) is refused, not returned.
    if (!readsBack(doc, [pointer, ...(found.copies ?? [])], edit, kind, value)) {
        return refuse("edit-read-back", `${describeValue(value)} could not be written here and read back as the same value`);
    }
    return { ok: true, edit, diagnostics };
}
const segmentsOf = (pointer) => (pointer === "" ? [] : pointer.slice(1).split("/").map(unescapePointerSegment));
function applyTo(bytes, edit) {
    const applied = new Uint8Array(bytes.length - (edit.end - edit.start) + edit.bytes.length);
    applied.set(bytes.subarray(0, edit.start), 0);
    applied.set(edit.bytes, edit.start);
    applied.set(bytes.subarray(edit.end), edit.start + edit.bytes.length);
    return applied;
}
function parseBackOf(doc, applied) {
    return doc.options.format === "yaml" ? parseBackYaml(applied, doc.options.origin, doc.options.limits) : parseBackJson(applied, doc.options.origin, doc.options.limits);
}
/**
 * A plan becomes an edit only if it reads back (v1.15 FR-014, FR-019): the edited bytes are parsed once, and the tree must be the
 * original with every operation applied -- the whole tree, so that a sibling lost or a key moved is caught, not just the place edited.
 */
function finish(doc, plan, ops, span, diagnostics, failure) {
    if (!plan.ok) {
        return { ok: false, diagnostics: [createDiagnostic({ level: "error", code: plan.code, message: plan.message, primary: plan.span ?? span, ...(plan.related !== undefined ? { related: [...plan.related] } : {}) })] };
    }
    const bytes = new TextEncoder().encode(plan.text);
    if (doc.bytes.length - (plan.end - plan.start) + bytes.length > doc.limits.maxBytes) {
        return refuseAt("edit-read-back", "The document would be larger than the size limit allows", span);
    }
    const edit = { start: plan.start, end: plan.end, bytes };
    const tree = parseBackOf(doc, applyTo(doc.bytes, edit));
    if (tree === undefined || !treeMatches(doc.format.tree, tree, ops))
        return refuseAt("edit-read-back", failure, span);
    return { ok: true, edit, diagnostics };
}
// --- add and remove ------------------------------------------------------------------
function splitPointer(pointer) {
    const at = pointer.lastIndexOf("/");
    return { parent: pointer.slice(0, at), last: unescapePointerSegment(pointer.slice(at + 1)) };
}
/** Under "refuse" a shared container is refused (the first alias that shares it); under "warn" the edit says what else it changes. */
function sharing(doc, found) {
    if (found.sharedBy !== undefined && doc.sharedEdits === "refuse") {
        return { refusal: { ok: false, diagnostics: [editDiagnostic("edit-target-shared", "This value is anchored and an alias shares it; writing it would change every place that shares it", found.sharedBy)] }, diagnostics: [] };
    }
    return { diagnostics: found.sharedBy !== undefined && doc.sharedEdits === "warn" ? [sharedInfo(found)] : [] };
}
function addIn(doc, pointer, value) {
    requirePointer(pointer, "add");
    const facts = inspect(doc, value, "add");
    const root = doc.format.tree.span;
    // The empty pointer names the document, which exists: add creates, setValue changes.
    if (pointer === "")
        return refuseAt("edit-target-exists", "The root of the document exists; add creates and setValue changes", root);
    const { parent, last } = splitPointer(pointer);
    const found = doc.format.find(parent, doc.sharedEdits);
    if (!found.ok)
        return found;
    const container = found.found;
    const shared = sharing(doc, container);
    if (shared.refusal !== undefined)
        return shared.refusal;
    const node = container.node;
    if (node.type === "scalar")
        return refuseAt("edit-parent-scalar", `The value at '${parent}' is a scalar; an entry can only be added to a mapping or a sequence`, container.span);
    let at;
    if (node.type === "mapping") {
        const existing = node.entries.get(last);
        if (existing !== undefined) {
            return refuseAt("edit-target-exists", `A value already exists at '${pointer}'; add creates, setValue changes`, doc.format.keySpan(container, last) ?? existing.span);
        }
        at = { key: last };
    }
    else {
        const length = node.items.length;
        const index = last === "-" ? length : ARRAY_INDEX.test(last) ? Number(last) : -1;
        if (index < 0 || index > length)
            return refuseAt("edit-target-absent", `No place at '${pointer}'; a sequence of ${length} takes an index from 0 to ${length}, or '-'`, container.span);
        at = { index };
    }
    const limited = pastLimits(facts, container.span);
    if (limited !== undefined)
        return limited;
    const parents = new Set([parent, ...(container.copies ?? [])]);
    const ops = [...parents,].map((place) => ({ kind: "add", parent: segmentsOf(place), at, data: value }));
    if ("key" in at)
        for (const place of doc.format.dependents(container))
            ops.push({ kind: "add", parent: segmentsOf(place), at, data: value, tolerant: true });
    return finish(doc, doc.format.add(container, at, value), ops, container.span, shared.diagnostics, `${describeValue(value)} could not be added here and read back as the entry added`);
}
function removeIn(doc, pointer) {
    requirePointer(pointer, "remove");
    if (pointer === "")
        return refuseAt("edit-remove-document", "The whole document cannot be removed", doc.format.tree.span);
    const { parent, last } = splitPointer(pointer);
    // An entry whose value is an alias (`d: *b`) shares nothing with what it points at: taking the entry out changes no other place.
    // So the policy is asked about the container then, and about the target (reached through an alias? anchored and aliased?) otherwise.
    const probe = doc.format.find(pointer, "allow");
    if (!probe.ok)
        return probe;
    const targetFound = probe.found.valueIsAlias === true ? probe : doc.format.find(pointer, doc.sharedEdits);
    if (!targetFound.ok)
        return targetFound;
    const target = targetFound.found;
    const containerFound = doc.format.find(parent, doc.sharedEdits);
    if (!containerFound.ok)
        return containerFound;
    const container = containerFound.found;
    const shared = sharing(doc, target.valueIsAlias === true ? container : target);
    if (shared.refusal !== undefined)
        return shared.refusal;
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
    if (node.type === "scalar")
        throw new Error("Internal error: remove(): the parent of a value is a scalar");
    const at = node.type === "mapping" ? { key: last } : { index: Number(last) };
    const parents = new Set(holder === container ? [parent, ...(container.copies ?? [])] : holder.copies ?? []);
    const ops = [...parents].map((place) => ({ kind: "remove", parent: segmentsOf(place), at }));
    if ("key" in at)
        for (const place of doc.format.dependents(holder))
            ops.push({ kind: "remove", parent: segmentsOf(place), at, tolerant: true });
    return finish(doc, doc.format.remove(target, holder, at), ops, target.span, shared.diagnostics, `'${pointer}' could not be removed here and read back as the entry gone`);
}
/** Under `"warn"`: the edit is answered, and this says so — at the value, naming every alias that shares it (v1.12 FR-005). */
function sharedInfo(found) {
    const others = found.sharedWith ?? [];
    return createDiagnostic({
        level: "info",
        code: "edit-target-shared",
        message: `This value is shared; the edit also changes ${others.length === 1 ? "the place an alias shares it" : `the ${others.length} places aliases share it`}`,
        primary: found.span,
        related: others.map((span) => ({ label: "an alias that shares this value", span })),
    });
}
function readsBack(doc, pointers, edit, kind, value) {
    const tree = parseBackOf(doc, applyTo(doc.bytes, edit));
    if (tree === undefined)
        return false;
    // The pointer asked about, and under "warn" and "allow" every place that shared the value's bytes before the edit
    // (v1.12 FR-007): each reads the value set, or the edit did not land where the value is held.
    return pointers.every((at) => {
        const node = resolvePointer(tree, at);
        return node !== undefined && equalsValue(node, kind, value);
    });
}
//# sourceMappingURL=edit.js.map