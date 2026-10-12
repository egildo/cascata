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
 * Construct an Origin.
 *
 * Throws on a malformed identity — this is a programmer error (a caller
 * building an Origin by hand), never a bad-document outcome, so it is
 * reported by exception rather than by diagnostic (contracts/parse-api.md).
 */
export function createOrigin(id, label, physical) {
    if (id.length === 0) {
        throw new Error("Origin.id must be a non-empty string");
    }
    if (label.length === 0) {
        throw new Error("Origin.label must be a non-empty string");
    }
    if (physical !== undefined && physical.length === 0) {
        throw new Error("Origin.physical must be a non-empty string when given");
    }
    return physical === undefined || physical === label ? { id, label } : { id, label, physical };
}
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
export function createSourceSpan(fields) {
    const { origin, start, end, line, column, documentLength } = fields;
    if (!Number.isInteger(start) || start < 0) {
        throw new Error(`SourceSpan.start must be a non-negative integer, got ${start}`);
    }
    if (!Number.isInteger(end) || end < start) {
        throw new Error(`SourceSpan.end (${end}) must be an integer >= start (${start})`);
    }
    if (end > documentLength) {
        throw new Error(`SourceSpan.end (${end}) must not exceed the document length (${documentLength})`);
    }
    if (start > documentLength) {
        throw new Error(`SourceSpan.start (${start}) must not exceed the document length (${documentLength})`);
    }
    if (!Number.isInteger(line) || line < 1) {
        throw new Error(`SourceSpan.line must be a positive integer, got ${line}`);
    }
    if (!Number.isInteger(column) || column < 1) {
        throw new Error(`SourceSpan.column must be a positive integer, got ${column}`);
    }
    return { origin, start, end, line, column };
}
//# sourceMappingURL=span.js.map