/**
 * Which document an edit belongs in — SPEC.md Article IX (§19, v1.11); specs/020-edit-targets.
 *
 * `editTarget` takes a merged configuration and a pointer into it and answers the document, and
 * the pointer inside that document, where the winning value is written — so a tool that edits its
 * model never has to know the cascade. It reads no file; the caller hands the document's bytes and
 * the answer's pointer to a writer (`./writers.ts`).
 *
 * Lives beside `index.ts` rather than under `src/merge/` because it needs the adapter registry
 * for a document's format, which the format-blind stages may not import.
 *
 * **The winning value is the merged node itself.** The fold carries every node through by
 * reference, so the scalar at a merged pointer still holds the span of the document that wrote
 * it. That is why a single item of an accumulated list (FR-004) needs no counting: the item
 * knows its own document, and the document's own tree knows the item's index in it.
 */
import type { EditFormat } from "./adapters/edit.js";
import { type Diagnostic } from "./diagnostics/diagnostic.js";
import type { MergedConfiguration } from "./merge/provenance.js";
/** The document and in-document pointer where the value at a merged pointer is written, or why there is none. */
export type EditTargetResult = {
    readonly ok: true;
    /** The document's location (`origin.id`; for a delegated fragment, the fragment's own location). */
    readonly location: string;
    /** The value's RFC 6901 pointer inside that document. */
    readonly pointer: string;
    readonly format: EditFormat;
} | {
    readonly ok: false;
    readonly diagnostics: Diagnostic[];
};
export declare function editTarget(configuration: MergedConfiguration, pointer: string): EditTargetResult;
//# sourceMappingURL=edit-target.d.ts.map