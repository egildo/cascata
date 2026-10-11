/**
 * Writers — SPEC.md Article IX (§19, v1.11); the entry point `@egildo/cascata/writers`.
 *
 * `locate` and `setValue` offered in the shape a source-graph library's editing stage expects:
 * `claims(location)`, `locate(bytes, path)` and `write(bytes, path, value)`, one writer per
 * format. The shape is met, not imported: this module names nothing but Cascata's own verbs, as
 * a read pass's host satisfies Article VI's `Host` without importing the caller.
 *
 * A writer adds no behaviour. `path` is an RFC 6901 pointer; the bytes are the document as
 * stored (§4.2), a byte-order mark and every carriage return counted; the origin is synthetic
 * because a writer is handed bytes, not a document's identity. A refusal's `reason` is the first
 * diagnostic's message. As with the verbs, only programmer error throws (a pointer that is
 * neither empty nor starts with `/`, a value that is not a scalar).
 */
import { formatForLocation } from "./adapters/registry.js";
import { locate, setValue } from "./adapters/edit.js";
import { createOrigin } from "./model/span.js";
const ORIGIN = createOrigin("writer", "writer");
function writer(format, writerOptions = {}) {
    const options = { format, origin: ORIGIN, ...(writerOptions.sharedEdits !== undefined ? { sharedEdits: writerOptions.sharedEdits } : {}) };
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