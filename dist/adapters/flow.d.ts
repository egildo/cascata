/**
 * Adding to and removing from a bracketed, comma-separated list -- v1.15 FR-010, FR-012, FR-016.
 *
 * A JSON array or object and a YAML flow collection are one shape to a writer that works on bytes: an opening
 * bracket, entries separated by commas, a closing bracket. This module knows nothing else: not what an entry
 * means, not how its text is spelled (the caller does that), only where the bytes between entries are and which
 * of them is the one comma an entry takes with it. Style is copied from the neighbours: the gap an existing pair
 * of entries has (`, ` or `,\n  `) is the gap a new entry gets.
 */
export interface FlowEntry {
    /** The first byte of the entry: its key, or its value if it has none. */
    readonly start: number;
    /** The byte after the entry's value. */
    readonly end: number;
}
export interface FlowBox {
    /** The opening bracket. */
    readonly open: number;
    /** The closing bracket. */
    readonly close: number;
    readonly entries: readonly FlowEntry[];
}
/** A change in bytes: replace `[start, end)` with `text`. */
export interface TextEdit {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}
/**
 * Add an entry whose text is `entryText` at `index` (0 to the number of entries) of a box that has entries. A new last
 * entry goes after the old last, with the box's own separator; a new entry before an old one goes just ahead of it.
 * `fallback` is the separator when the box offers none to copy (one entry on one line).
 */
export declare function flowAdd(bytes: Uint8Array, box: FlowBox, index: number, entryText: string, eol: string, fallback: string): TextEdit;
/**
 * Remove the entry at `index`, and exactly one comma with its spacing: the following comma, or the preceding one for the
 * last entry. The only entry takes the whole interior with it, so `{ "a": 1 }` becomes `{}`.
 */
export declare function flowRemove(bytes: Uint8Array, box: FlowBox, index: number): TextEdit;
/** The break that follows `at`, if any (used to keep a line ending whole). */
export declare function breakAfter(bytes: Uint8Array, at: number): string;
//# sourceMappingURL=flow.d.ts.map