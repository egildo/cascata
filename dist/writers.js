/**
 * Writers — SPEC.md Article IX (§19, v1.11); the entry point `@egildo/cascata/writers`.
 *
 * `locate` and `setValue` offered in the shape a source-graph library's editing stage expects:
 * `claims(location)`, `locate(bytes, path)` and `write(bytes, path, value)`, one writer per
 * format. The shape is met, not imported: this module names nothing but Cascata's own verbs, as
 * a read pass's host satisfies Article VI's `Host` without importing the caller.
 *
 * Since v1.15 a writer also **opens** a document (`open(bytes)`): parsed once, it answers `locate`, `write`, `add` and `remove`
 * as often as asked, each against the bytes as opened, and `write` takes a mapping (a `Map`) or a sequence, nested.
 *
 * A writer adds no behaviour. `path` is an RFC 6901 pointer; the bytes are the document as
 * stored (§4.2), a byte-order mark and every carriage return counted; the origin is synthetic
 * because a writer is handed bytes, not a document's identity. A refusal's `reason` is the first
 * diagnostic's message. As with the verbs, only programmer error throws (a pointer that is
 * neither empty nor starts with `/`, a value that is not scalar, array or `Map` data).
 */
import { formatForLocation } from "./adapters/registry.js";
import { locate, openDocument, setValue } from "./adapters/edit.js";
import { createOrigin } from "./model/span.js";
const ORIGIN = createOrigin("writer", "writer");
/** The opened document behind each writer document, so `shifted` can compare two versions (v1.16). */
const underlying = new WeakMap();
function writer(format, writerOptions = {}) {
    const options = { format, origin: ORIGIN, ...(writerOptions.sharedEdits !== undefined ? { sharedEdits: writerOptions.sharedEdits } : {}) };
    const open = (bytes) => {
        const opened = openDocument(bytes, options);
        if (!opened.ok)
            return { ok: false, reason: opened.diagnostics[0]?.message ?? "not parsed" };
        const { document } = opened;
        const answered = {
            locate(path) {
                const result = document.locate(path);
                return result.ok ? { ok: true, start: result.start, end: result.end } : { ok: false, reason: result.diagnostics[0]?.message ?? "not located" };
            },
            write(path, value) {
                const result = document.setValue(path, value);
                return result.ok ? result : { ok: false, reason: result.diagnostics[0]?.message ?? "not written" };
            },
            add(path, value) {
                const result = document.add(path, value);
                return result.ok ? result : { ok: false, reason: result.diagnostics[0]?.message ?? "not added" };
            },
            remove(path) {
                const result = document.remove(path);
                return result.ok ? result : { ok: false, reason: result.diagnostics[0]?.message ?? "not removed" };
            },
            shifted(path, newer) {
                const other = underlying.get(newer);
                if (other === undefined)
                    throw new TypeError("shifted() takes, as `newer`, a document a writer of this library opened");
                return document.shifted(path, other);
            },
            amend: (staged, operation) => document.amend(staged, operation),
            inside: (path, within) => document.inside(path, within),
        };
        underlying.set(answered, document);
        return { ok: true, document: answered };
    };
    // The one-shot verbs are the core's, which are open-then-ask (v1.15 FR-005).
    return {
        claims: (location) => formatForLocation(location) === format,
        locate(bytes, path) {
            const result = locate(bytes, options, path);
            return result.ok ? { ok: true, start: result.start, end: result.end } : { ok: false, reason: result.diagnostics[0]?.message ?? "not located" };
        },
        write(bytes, path, value) {
            const result = setValue(bytes, options, path, value);
            return result.ok ? result : { ok: false, reason: result.diagnostics[0]?.message ?? "not written" };
        },
        open,
    };
}
/** Claims `.yaml` and `.yml`. */
export function yamlWriter(options) {
    return writer("yaml", options);
}
/** Claims `.json`. Accepts `sharedEdits`, which changes nothing: JSON shares no value. */
export function jsonWriter(options) {
    return writer("json", options);
}
//# sourceMappingURL=writers.js.map