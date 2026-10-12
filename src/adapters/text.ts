/**
 * Byte-level helpers for the writers (v1.15) -- lines, blanks and line breaks in a document's stored bytes.
 *
 * Both formats are read as bytes, and every offset a writer answers is a byte of the stored document (SPEC.md §4.2), so
 * these never decode. A line break is `\n`, `\r\n` or a lone `\r` (v1.9: a lone carriage return is a line break to
 * Cascata). Nothing here knows a format.
 */

const LF = 0x0a;
const CR = 0x0d;

export const isBreak = (byte: number | undefined): boolean => byte === LF || byte === CR;
export const isBlank = (byte: number | undefined): boolean => byte === 0x20 || byte === 0x09;

/** The length of the line break that begins at `at`: 2 for `\r\n`, 1 for `\n` or a lone `\r`, 0 for none. */
export function breakLengthAt(bytes: Uint8Array, at: number): number {
  if (bytes[at] === CR) return bytes[at + 1] === LF ? 2 : 1;
  return bytes[at] === LF ? 1 : 0;
}

/** The length of the line break that ends just before `at`. */
export function breakLengthBefore(bytes: Uint8Array, at: number): number {
  if (bytes[at - 1] === LF) return bytes[at - 2] === CR ? 2 : 1;
  return bytes[at - 1] === CR ? 1 : 0;
}

/** The number of bytes of byte-order marks the document opens with: a mark is no part of a line's indentation (v1.9). */
export function marksAtStart(bytes: Uint8Array): number {
  let at = 0;
  while (bytes[at] === 0xef && bytes[at + 1] === 0xbb && bytes[at + 2] === 0xbf) at += 3;
  return at;
}

/** The first byte of the line `at` is on (`at` may be the document's length); the first line begins after any byte-order marks. */
export function lineStartOf(bytes: Uint8Array, at: number): number {
  let i = at;
  while (i > 0 && !isBreak(bytes[i - 1])) i -= 1;
  return i === 0 ? Math.min(marksAtStart(bytes), at) : i;
}

/** The index of the line break that ends the line `at` is on, or the document's length. */
export function lineContentEnd(bytes: Uint8Array, at: number): number {
  let i = at;
  while (i < bytes.length && !isBreak(bytes[i])) i += 1;
  return i;
}

/** The first byte of the line after the one `at` is on, or the document's length if it is the last and has no break. */
export function nextLineStart(bytes: Uint8Array, at: number): number {
  const end = lineContentEnd(bytes, at);
  return end + breakLengthAt(bytes, end);
}

export function skipBlanksForward(bytes: Uint8Array, at: number): number {
  let i = at;
  while (isBlank(bytes[i])) i += 1;
  return i;
}

export function skipBlanksBackward(bytes: Uint8Array, at: number): number {
  let i = at;
  while (i > 0 && isBlank(bytes[i - 1])) i -= 1;
  return i;
}

/** The blanks that begin the line `at` is on, as text. */
export function indentationOf(bytes: Uint8Array, at: number): string {
  const start = lineStartOf(bytes, at);
  return new TextDecoder().decode(bytes.subarray(start, skipBlanksForward(bytes, start)));
}

/** The document's own line ending: its first line break, whichever it is; `\n` if it has none (v1.15 FR-009). */
export function documentLineBreak(bytes: Uint8Array): string {
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === LF) return "\n";
    if (bytes[i] === CR) return bytes[i + 1] === LF ? "\r\n" : "\r";
  }
  return "\n";
}

/** Whether the line holding `at` has only blanks before `at`. */
export function startsItsLine(bytes: Uint8Array, at: number): boolean {
  return skipBlanksForward(bytes, lineStartOf(bytes, at)) >= at;
}

/** Whether the line from `start` to its break is a comment (its first non-blank byte is `#`). */
export function isCommentLine(bytes: Uint8Array, start: number): boolean {
  return bytes[skipBlanksForward(bytes, start)] === 0x23;
}

export function isBlankLine(bytes: Uint8Array, start: number): boolean {
  const first = skipBlanksForward(bytes, start);
  return first >= bytes.length || isBreak(bytes[first]);
}

/**
 * Where the comment lines directly above the line starting at `lineStart` begin (v1.15 FR-016, Prettier's and Recast's
 * attachment): going up while each line above is a comment, and stopping at a blank line, at any other line, and at `floor`
 * -- the end of whatever came before, which the caller knows and these bytes do not (a block scalar's text may look
 * like a comment).
 */
export function attachedCommentsStart(bytes: Uint8Array, lineStart: number, floor: number): number {
  const top = Math.max(floor, marksAtStart(bytes));
  let start = lineStart;
  while (start > top) {
    const previous = lineStartOf(bytes, start - breakLengthBefore(bytes, start));
    if (previous < top || previous >= start || !isCommentLine(bytes, previous)) break;
    start = previous;
  }
  return start;
}

/**
 * The first byte after the line on which a block entry's value ends, line break included: a value that has already
 * consumed its break (a block scalar, a block collection) ends there; one that has not (a scalar, a flow collection,
 * an alias, nothing at all) gets the rest of its line -- blanks, a comment -- and its break.
 */
export function entryLineEnd(bytes: Uint8Array, valueEnd: number): number {
  if (valueEnd > 0 && isBreak(bytes[valueEnd - 1])) return valueEnd;
  return nextLineStart(bytes, valueEnd);
}
