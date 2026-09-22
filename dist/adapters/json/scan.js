/**
 * The JSON adapter's byte cursor — specs/011-json-adapter/data-model.md
 * "Scanner", research P-1.
 *
 * The one place in this adapter where a position is computed. Everything
 * else asks the scanner where it is; nothing else touches `offset`, `line`
 * or `column`.
 *
 * **This adapter scans bytes, not a decoded string, and that is the whole
 * reason it can be trusted about positions.** The YAML adapter has no
 * choice — `yaml` reports UTF-16 code-unit indices, so v0.1 must convert
 * them through a per-document offset table, and the two findings in that
 * file's own module doc are what happens when nobody checks. A parser that
 * owns its own cursor can simply count the things the contract is written
 * in:
 *
 *   - **`offset` is a byte offset**, because the cursor moves one byte at a
 *     time over a `Uint8Array`. There is nothing to convert.
 *   - **`column` is a count of code points**, because a UTF-8 continuation
 *     byte (`0b10xxxxxx`) is precisely a byte that does *not* begin a new
 *     code point. Counting every consumed byte that is not one is counting
 *     code points, exactly, with no decoding and no lookahead.
 *   - **`line` counts `0x0A` bytes.** A newline can never be a fragment of
 *     a multi-byte sequence — every byte of one has its high bit set — so
 *     line counting is safe at the byte level in a way it would not be in,
 *     say, UTF-16 with surrogate pairs.
 *
 * All three are maintained incrementally by `advance()`, so a document is
 * scanned once and no position is ever recomputed by walking backwards
 * (which would be quadratic, and which is how positions drift).
 *
 * The bytes handed to a `Scanner` are already known to be well-formed
 * UTF-8: `parse.ts` validates them, and refuses, before constructing one.
 * The column rule above depends on that — over arbitrary bytes,
 * "not a continuation byte" would be a guess rather than a code point.
 */
/** RFC 8259 §2's whitespace: space, horizontal tab, line feed, carriage return. Nothing else — not a vertical tab, not a form feed, not U+00A0. */
const SPACE = 0x20;
const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
export class Scanner {
    /** The document's bytes, after any leading BOM was removed by the caller. */
    bytes;
    offsetValue = 0;
    lineValue = 1;
    columnValue = 1;
    constructor(bytes) {
        this.bytes = bytes;
    }
    get offset() {
        return this.offsetValue;
    }
    get atEnd() {
        return this.offsetValue >= this.bytes.length;
    }
    /** The cursor's three coordinates, which always describe the same point because `advance` is the only way to move. */
    get position() {
        return { offset: this.offsetValue, line: this.lineValue, column: this.columnValue };
    }
    /** The byte `ahead` positions from the cursor, or `undefined` past the end. Never moves. */
    peek(ahead = 0) {
        return this.bytes[this.offsetValue + ahead];
    }
    /**
     * Consume one byte and return it, or `undefined` at the end of input (in
     * which case nothing moves). This is the only mutator.
     */
    advance() {
        const byte = this.bytes[this.offsetValue];
        if (byte === undefined) {
            return undefined;
        }
        this.offsetValue += 1;
        if (byte === LINE_FEED) {
            this.lineValue += 1;
            this.columnValue = 1;
        }
        else if ((byte & 0xc0) !== 0x80) {
            // Not a UTF-8 continuation byte, so this byte begins a code point.
            this.columnValue += 1;
        }
        return byte;
    }
    /** Consume RFC 8259 §2 whitespace. Deliberately not a general "is this space" test: a vertical tab between tokens is a syntax error, not whitespace. */
    skipWhitespace() {
        for (;;) {
            const byte = this.peek();
            if (byte === SPACE || byte === TAB || byte === LINE_FEED || byte === CARRIAGE_RETURN) {
                this.advance();
                continue;
            }
            return;
        }
    }
}
/** Whether `byte` is an ASCII decimal digit. */
export function isDigit(byte) {
    return byte !== undefined && byte >= 0x30 && byte <= 0x39;
}
/** The value of a hexadecimal digit byte (either case), or `undefined` if it is not one. */
export function hexDigitValue(byte) {
    if (byte === undefined)
        return undefined;
    if (byte >= 0x30 && byte <= 0x39)
        return byte - 0x30;
    if (byte >= 0x41 && byte <= 0x46)
        return byte - 0x41 + 10;
    if (byte >= 0x61 && byte <= 0x66)
        return byte - 0x61 + 10;
    return undefined;
}
//# sourceMappingURL=scan.js.map