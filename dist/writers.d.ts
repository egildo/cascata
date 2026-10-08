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
import { type Edit, type EditValue } from "./adapters/edit.js";
export type WriterLocateResult = {
    readonly ok: true;
    readonly start: number;
    readonly end: number;
} | {
    readonly ok: false;
    readonly reason: string;
};
export type WriterWriteResult = {
    readonly ok: true;
    readonly edit: Edit;
} | {
    readonly ok: false;
    readonly reason: string;
};
/** One format's editing plug-in. */
export interface Writer {
    /** Whether this writer handles the document at `location`, by extension, case-insensitively. */
    claims(location: string): boolean;
    /** The stored byte range of the value at the pointer `path`. */
    locate(bytes: Uint8Array, path: string): WriterLocateResult;
    /** The edit that makes the value at the pointer `path` equal `value`. */
    write(bytes: Uint8Array, path: string, value: EditValue): WriterWriteResult;
}
/** Claims `.yaml` and `.yml`. */
export declare function yamlWriter(): Writer;
/** Claims `.json`. */
export declare function jsonWriter(): Writer;
export type { Edit, EditValue };
//# sourceMappingURL=writers.d.ts.map