/**
 * Byte-level helpers for the writers (v1.15) -- lines, blanks and line breaks in a document's stored bytes.
 *
 * Both formats are read as bytes, and every offset a writer answers is a byte of the stored document (SPEC.md §4.2), so
 * these never decode. A line break is `\n`, `\r\n` or a lone `\r` (v1.9: a lone carriage return is a line break to
 * Cascata). Nothing here knows a format.
 */
export declare const isBreak: (byte: number | undefined) => boolean;
export declare const isBlank: (byte: number | undefined) => boolean;
/** The length of the line break that begins at `at`: 2 for `\r\n`, 1 for `\n` or a lone `\r`, 0 for none. */
export declare function breakLengthAt(bytes: Uint8Array, at: number): number;
/** The length of the line break that ends just before `at`. */
export declare function breakLengthBefore(bytes: Uint8Array, at: number): number;
/** The number of bytes of byte-order marks the document opens with: a mark is no part of a line's indentation (v1.9). */
export declare function marksAtStart(bytes: Uint8Array): number;
/**
 * The first byte of the line `at` is on (`at` may be the document's length). A byte-order mark that opens the line -- the document's own
 * first bytes, or one that follows a comment in the prefix (v1.9) -- is no part of the line's indentation: the line begins after it.
 */
export declare function lineStartOf(bytes: Uint8Array, at: number): number;
/** The index of the line break that ends the line `at` is on, or the document's length. */
export declare function lineContentEnd(bytes: Uint8Array, at: number): number;
/** The first byte of the line after the one `at` is on, or the document's length if it is the last and has no break. */
export declare function nextLineStart(bytes: Uint8Array, at: number): number;
export declare function skipBlanksForward(bytes: Uint8Array, at: number): number;
export declare function skipBlanksBackward(bytes: Uint8Array, at: number): number;
/** The blanks that begin the line `at` is on, as text. */
export declare function indentationOf(bytes: Uint8Array, at: number): string;
/** The document's own line ending: its first line break, whichever it is; `\n` if it has none (v1.15 FR-009). */
export declare function documentLineBreak(bytes: Uint8Array): string;
/** Whether the line holding `at` has only blanks before `at`. */
export declare function startsItsLine(bytes: Uint8Array, at: number): boolean;
/** Whether the line from `start` to its break is a comment (its first non-blank byte is `#`). */
export declare function isCommentLine(bytes: Uint8Array, start: number): boolean;
export declare function isBlankLine(bytes: Uint8Array, start: number): boolean;
/**
 * Where the comment lines directly above the line starting at `lineStart` begin (v1.15 FR-016, Prettier's and Recast's
 * attachment): going up while each line above is a comment, and stopping at a blank line, at any other line, and at `floor`
 * -- the end of whatever came before, which the caller knows and these bytes do not (a block scalar's text may look
 * like a comment).
 */
export declare function attachedCommentsStart(bytes: Uint8Array, lineStart: number, floor: number): number;
/**
 * The first byte after the line on which a block entry's value ends, line break included: a value that has already
 * consumed its break (a block scalar, a block collection) ends there; one that has not (a scalar, a flow collection,
 * an alias, nothing at all) gets the rest of its line -- blanks, a comment -- and its break.
 */
export declare function entryLineEnd(bytes: Uint8Array, valueEnd: number): number;
//# sourceMappingURL=text.d.ts.map