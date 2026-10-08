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
import { locate, setValue, type Edit, type EditFormat, type EditValue, type SetValueResult, type SharedEdits } from "./adapters/edit.js";
import { createOrigin } from "./model/span.js";

export type WriterLocateResult = { readonly ok: true; readonly start: number; readonly end: number } | { readonly ok: false; readonly reason: string };

/** `diagnostics` on success (v1.12): empty, or under `sharedEdits: "warn"` the one `info` naming what else the edit changes. */
export type WriterWriteResult = { readonly ok: true; readonly edit: Edit; readonly diagnostics: Extract<SetValueResult, { ok: true }>["diagnostics"] } | { readonly ok: false; readonly reason: string };

/** What a writer is made with (v1.12 FR-005): whether it writes a shared value. JSON has no sharing and accepts it, so one object can make both. */
export interface WriterOptions {
  readonly sharedEdits?: SharedEdits;
}

/** One format's editing plug-in. */
export interface Writer {
  /** Whether this writer handles the document at `location`, by extension, case-insensitively. */
  claims(location: string): boolean;
  /** The stored byte range of the value at the pointer `path`. */
  locate(bytes: Uint8Array, path: string): WriterLocateResult;
  /** The edit that makes the value at the pointer `path` equal `value`. */
  write(bytes: Uint8Array, path: string, value: EditValue): WriterWriteResult;
}

const ORIGIN = createOrigin("writer", "writer");

function writer(format: EditFormat, writerOptions: WriterOptions = {}): Writer {
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
export function yamlWriter(options?: WriterOptions): Writer {
  return writer("yaml", options);
}

/** Claims `.json`. Accepts `sharedEdits`, which changes nothing: JSON shares no value. */
export function jsonWriter(options?: WriterOptions): Writer {
  return writer("json", options);
}

export type { Edit, EditValue, SharedEdits };
