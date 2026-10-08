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
 *   - **`column` is a count of code points** (a leading mark is skipped, not counted), because a UTF-8 continuation
 *     byte (`0b10xxxxxx`) is precisely a byte that does *not* begin a new
 *     code point. Counting every consumed byte that is not one is counting
 *     code points, exactly, with no decoding and no lookahead.
 *   - **`line` counts line ends** — `0x0A`, `0x0D 0x0A`, and a lone `0x0D` (v1.9). A newline can never be a fragment of
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
/** Where the cursor is: a byte offset, a 1-based line, and a 1-based column in code points. */
export interface Position {
    readonly offset: number;
    readonly line: number;
    readonly column: number;
}
export declare class Scanner {
    /** The document's stored bytes, a leading byte-order mark included (v1.9). */
    readonly bytes: Uint8Array;
    private offsetValue;
    private lineValue;
    private columnValue;
    /** `start` is where scanning begins — past a leading byte-order mark, which is stored (it is an offset) but is no token and no column. */
    constructor(bytes: Uint8Array, start?: number);
    get offset(): number;
    get atEnd(): boolean;
    /** The cursor's three coordinates, which always describe the same point because `advance` is the only way to move. */
    get position(): Position;
    /** The byte `ahead` positions from the cursor, or `undefined` past the end. Never moves. */
    peek(ahead?: number): number | undefined;
    /**
     * Consume one byte and return it, or `undefined` at the end of input (in
     * which case nothing moves). This is the only mutator.
     */
    advance(): number | undefined;
    /** Consume RFC 8259 §2 whitespace. Deliberately not a general "is this space" test: a vertical tab between tokens is a syntax error, not whitespace. */
    skipWhitespace(): void;
}
/** Whether `byte` is an ASCII decimal digit. */
export declare function isDigit(byte: number | undefined): boolean;
/** The value of a hexadecimal digit byte (either case), or `undefined` if it is not one. */
export declare function hexDigitValue(byte: number | undefined): number | undefined;
//# sourceMappingURL=scan.d.ts.map