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
import { locate, openDocument, setValue, type AmendOperation, type AmendResult, type Edit, type EditData, type EditFormat, type EditValue, type OpenedDocument, type SetValueResult, type SharedEdits } from "./adapters/edit.js";
import { createOrigin } from "./model/span.js";

export type WriterLocateResult = { readonly ok: true; readonly start: number; readonly end: number } | { readonly ok: false; readonly reason: string };

/** `diagnostics` on success (v1.12): empty, or under `sharedEdits: "warn"` the one `info` naming what else the edit changes. */
export type WriterWriteResult = { readonly ok: true; readonly edit: Edit; readonly diagnostics: Extract<SetValueResult, { ok: true }>["diagnostics"] } | { readonly ok: false; readonly reason: string };

/** What a writer is made with (v1.12 FR-005): whether it writes a shared value. JSON has no sharing and accepts it, so one object can make both. */
export interface WriterOptions {
  readonly sharedEdits?: SharedEdits;
}

/** A document a writer has parsed once (v1.15 FR-006): `locate` and `write` as the writer's own, over the bytes as opened. */
export interface WriterDocument {
  /** The stored byte range of the value at the pointer `path`. */
  locate(path: string): WriterLocateResult;
  /** The edit that makes the value at the pointer `path` equal `value`. Independent of every other edit this document has answered: each is against the bytes as opened. */
  write(path: string, value: EditData): WriterWriteResult;
  /** v1.15: create the entry at `path`, which must not exist; a sequence index, or `-` to append. Independent of every other edit this document has answered. */
  add(path: string, value: EditData): WriterWriteResult;
  /** v1.15: delete the entry at `path`, with the comments attached to it. */
  remove(path: string): WriterWriteResult;
  /** v1.16: whether a list along `path` has a different length in `newer`, a later version opened by a writer of this library. */
  shifted(path: string, newer: WriterDocument): boolean;
  /** v1.16: `operation` applied inside the value staged at `staged.path`; `{ inside: false }` when it is not below it. */
  amend(staged: { readonly path: string; readonly value: EditData }, operation: AmendOperation): AmendResult;
}

export type WriterOpenResult = { readonly ok: true; readonly document: WriterDocument } | { readonly ok: false; readonly reason: string };

/** One format's editing plug-in. */
export interface Writer {
  /** Whether this writer handles the document at `location`, by extension, case-insensitively. */
  claims(location: string): boolean;
  /** The stored byte range of the value at the pointer `path`. */
  locate(bytes: Uint8Array, path: string): WriterLocateResult;
  /** The edit that makes the value at the pointer `path` equal `value`. */
  write(bytes: Uint8Array, path: string, value: EditData): WriterWriteResult;
  /** v1.15: parse `bytes` once and answer `locate` and `write` as often as asked (it copies the bytes). */
  open(bytes: Uint8Array): WriterOpenResult;
}

const ORIGIN = createOrigin("writer", "writer");

/** The opened document behind each writer document, so `shifted` can compare two versions (v1.16). */
const underlying = new WeakMap<WriterDocument, OpenedDocument>();

function writer(format: EditFormat, writerOptions: WriterOptions = {}): Writer {
  const options = { format, origin: ORIGIN, ...(writerOptions.sharedEdits !== undefined ? { sharedEdits: writerOptions.sharedEdits } : {}) };
  const open = (bytes: Uint8Array): WriterOpenResult => {
    const opened = openDocument(bytes, options);
    if (!opened.ok) return { ok: false, reason: opened.diagnostics[0]?.message ?? "not parsed" };
    const { document } = opened;
    const answered: WriterDocument = {
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
          if (other === undefined) throw new TypeError("shifted() takes, as `newer`, a document a writer of this library opened");
          return document.shifted(path, other);
        },
        amend: (staged, operation) => document.amend(staged, operation),
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
export function yamlWriter(options?: WriterOptions): Writer {
  return writer("yaml", options);
}

/** Claims `.json`. Accepts `sharedEdits`, which changes nothing: JSON shares no value. */
export function jsonWriter(options?: WriterOptions): Writer {
  return writer("json", options);
}

export type { AmendOperation, AmendResult, Edit, EditData, EditValue, SharedEdits };
