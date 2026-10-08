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
import { type Diagnostic } from "../diagnostics/diagnostic.js";
import type { DiagnosticCode } from "../diagnostics/codes.js";
import type { Node, ScalarKind } from "../model/node.js";
import type { Origin, SourceSpan } from "../model/span.js";
import type { ParseLimits } from "./limits.js";
export type EditFormat = "yaml" | "json";
/** What `locate` and `setValue` read, as `parse` reads: the format, which document the bytes came from (required), and the limits. */
export interface EditOptions {
    readonly format: EditFormat;
    readonly origin: Origin;
    readonly limits?: Partial<ParseLimits>;
}
/** The kind of a located value: a scalar's model kind (§4.1), or `mapping`/`sequence`. */
export type LocatedKind = ScalarKind | "mapping" | "sequence";
export type LocateResult = {
    readonly ok: true;
    readonly start: number;
    readonly end: number;
    readonly kind: LocatedKind;
} | {
    readonly ok: false;
    readonly diagnostics: Diagnostic[];
};
/** A scalar the caller can set: `string`, `number`, `bigint`, `boolean` or `null`. */
export type EditValue = string | number | bigint | boolean | null;
/** Put `bytes` in place of `[start, end)` of the input — the bytes of the document as stored (§4.2), a byte-order mark and every carriage return counted. */
export interface Edit {
    readonly start: number;
    readonly end: number;
    readonly bytes: Uint8Array;
}
export type SetValueResult = {
    readonly ok: true;
    readonly edit: Edit;
} | {
    readonly ok: false;
    readonly diagnostics: Diagnostic[];
};
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
    /** YAML: the first alias that shares this value (it, or a container above it, is anchored and aliased). `locate` still answers; `setValue` refuses. */
    readonly sharedBy?: SourceSpan;
}
export type FindResult = {
    readonly ok: true;
    readonly found: Found;
} | {
    readonly ok: false;
    readonly diagnostics: Diagnostic[];
};
export declare function editDiagnostic(code: DiagnosticCode, message: string, primary: SourceSpan): Diagnostic;
/**
 * The stored byte range and model kind of the value at `pointer`, or why
 * there is none. A document that does not parse gives the parse's own
 * diagnostics. A container or a block scalar is located like any value —
 * only `setValue` refuses them.
 */
export declare function locate(bytes: Uint8Array, options: EditOptions, pointer: string): LocateResult;
/** FR-006: the kind `value` must read back as, given the kind of the scalar it replaces. */
export declare function kindForValue(value: EditValue, replaced: Node): ScalarKind;
/**
 * The edit that makes the value at `pointer` equal `value` (FR-002 to
 * FR-009), or why not. Never throws for a document or a value — only for
 * programmer error (a missing origin or format, a malformed pointer, a value
 * that is not a scalar).
 */
export declare function setValue(bytes: Uint8Array, options: EditOptions, pointer: string, value: EditValue): SetValueResult;
//# sourceMappingURL=edit.d.ts.map