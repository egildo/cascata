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
import { type Diagnostic } from "../diagnostics/diagnostic.js";
import type { DiagnosticCode } from "../diagnostics/codes.js";
import type { Node, ScalarKind } from "../model/node.js";
import type { Origin, SourceSpan } from "../model/span.js";
import { type ParseLimits } from "./limits.js";
import { type EditData, type EditValue } from "./edit-data.js";
import type { Plan } from "./plan.js";
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
export type LocateResult = {
    readonly ok: true;
    readonly start: number;
    readonly end: number;
    readonly kind: LocatedKind;
} | {
    readonly ok: false;
    readonly diagnostics: Diagnostic[];
};
/** Put `bytes` in place of `[start, end)` of the input — the bytes of the document as stored (§4.2), a byte-order mark and every carriage return counted. */
export interface Edit {
    readonly start: number;
    readonly end: number;
    readonly bytes: Uint8Array;
}
/** `diagnostics` on success (v1.12): empty, or under `sharedEdits: "warn"` the one `info` naming what else the edit changes. */
export type SetValueResult = {
    readonly ok: true;
    readonly edit: Edit;
    readonly diagnostics: readonly Diagnostic[];
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
    readonly bareKey?: {
        readonly indicator: string | undefined;
    };
    /**
     * YAML (v1.12 FR-011): the scalar's explicit tag. `holds` is the one kind the tag can hold. `drop` is
     * where the tag starts and where the bytes kept after it begin (an anchor, a comment, a line break, then
     * the value); since v1.12.1 found wherever the tag is, so absent only when `yaml`'s tokens show none.
     */
    readonly tag?: {
        readonly holds: LocatedKind | undefined;
        readonly drop: () => {
            readonly start: number;
            readonly kept: number;
        } | undefined;
    };
}
export type FindResult = {
    readonly ok: true;
    readonly found: Found;
} | {
    readonly ok: false;
    readonly diagnostics: Diagnostic[];
};
export declare function editDiagnostic(code: DiagnosticCode, message: string, primary: SourceSpan): Diagnostic;
/** Where a new entry goes in a container: the key of a mapping entry, the index of a sequence item. */
export type EntryAt = {
    readonly key: string;
} | {
    readonly index: number;
};
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
    mergedUnder(target: Found): {
        readonly key: SourceSpan;
        readonly merged: SourceSpan;
    } | undefined;
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
export type OpenResult = {
    readonly ok: true;
    readonly document: OpenedDocument;
} | {
    readonly ok: false;
    readonly diagnostics: Diagnostic[];
};
/**
 * Parse `bytes` once and answer `locate`, `setValue`, `add` and `remove` as often as asked. A document that does not parse
 * gives the parse's own diagnostics. Only programmer error throws (a missing origin or format, a bad policy, a value that is
 * not `EditData`).
 */
export declare function openDocument(bytes: Uint8Array, options: EditOptions): OpenResult;
/**
 * `openDocument` with the format's plans passed through `wrap` first. Not exported from the package: it is how a test hands
 * the read-back a plan that is wrong (one that eats the next entry, say) to see that the read-back refuses it.
 */
export declare function openDocumentUsing(bytes: Uint8Array, options: EditOptions, wrap: (format: FormatOpened) => FormatOpened): OpenResult;
/**
 * The stored byte range and model kind of the value at `pointer`, or why
 * there is none. A document that does not parse gives the parse's own
 * diagnostics. A container or a block scalar is located like any value --
 * only `setValue` refuses a block scalar.
 */
export declare function locate(bytes: Uint8Array, options: EditOptions, pointer: string): LocateResult;
/** FR-006: the kind `value` must read back as, given the kind of the scalar it replaces. */
export declare function kindForValue(value: EditValue, replaced: Node): ScalarKind;
/**
 * The edit that makes the value at `pointer` equal `value` (FR-002 to
 * FR-009), or why not. Never throws for a document or a value -- only for
 * programmer error (a missing origin or format, a malformed pointer, a value
 * that is not `EditData`).
 */
export declare function setValue(bytes: Uint8Array, options: EditOptions, pointer: string, value: EditData): SetValueResult;
//# sourceMappingURL=edit.d.ts.map