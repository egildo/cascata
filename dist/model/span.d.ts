/**
 * SourceSpan and Origin — SPEC.md §4.1 ("span: SourceSpan — NON-OPTIONAL"),
 * data-model.md "SourceSpan" and "Origin".
 *
 * A span is never absent from a node (Principle III, data-model.md). This
 * module owns the one validating constructor for both types; every other
 * module in the codebase treats `SourceSpan` and `Origin` as opaque,
 * already-valid data.
 */
/**
 * Which document produced a node.
 *
 * In this milestone every node produced by one `parse()` call shares one
 * Origin. The type exists now, rather than being folded into a bare string,
 * because Principle III forbids making it optional later — the cascade's
 * layer identity will anchor to this same shape without changing it
 * (data-model.md "Origin").
 */
export interface Origin {
    /** Stable identity of the document — the caller supplies it. */
    readonly id: string;
    /** Human-readable name for diagnostics (a path, a URL, `<stdin>`). */
    readonly label: string;
    /**
     * Where the document really is (v1.13 FR-004, SPEC.md Article VI): the host's canonical path for a file,
     * the URL after redirects for a remote document. Present **only when it differs from the document's
     * logical location**, so every origin of an unlinked, unredirected document is what it was before v1.13.
     * `id` and `label` stay logical.
     */
    readonly physical?: string;
}
/**
 * Where a piece of text sits.
 *
 * Offsets are bytes, so they compose with hashing and slicing later; line
 * and column are 1-based, and column is counted in code points, so it
 * matches what an editor shows. A zero-width span (`start === end`) is
 * legal and meaningful: it is what an empty value has, and it is how "the
 * position where something is missing" is expressed (data-model.md
 * "SourceSpan").
 */
export interface SourceSpan {
    /** Which document produced this. */
    readonly origin: Origin;
    /** Byte offset of the first byte, 0-based. */
    readonly start: number;
    /** Byte offset one past the last byte. */
    readonly end: number;
    /** 1-based line of `start`. */
    readonly line: number;
    /** 1-based column of `start`, counted in code points. */
    readonly column: number;
}
/**
 * Construct an Origin.
 *
 * Throws on a malformed identity — this is a programmer error (a caller
 * building an Origin by hand), never a bad-document outcome, so it is
 * reported by exception rather than by diagnostic (contracts/parse-api.md).
 */
export declare function createOrigin(id: string, label: string, physical?: string): Origin;
/**
 * Construct a SourceSpan, validating its invariants:
 *
 * - `start <= end`
 * - both are within `[0, documentLength]`
 * - `line >= 1`, `column >= 1`
 *
 * `documentLength` (in bytes) is required so "both within the document's
 * byte length" (data-model.md) is actually checked, not merely stated.
 *
 * Throws on violation — an invalid span is a bug in the code constructing
 * it, not a property of the document being read.
 */
export declare function createSourceSpan(fields: {
    origin: Origin;
    start: number;
    end: number;
    line: number;
    column: number;
    documentLength: number;
}): SourceSpan;
//# sourceMappingURL=span.d.ts.map