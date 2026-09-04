/**
 * UTF-8 well-formedness, and where a byte offset sits — shared by every
 * format adapter (v1.2, specs/011-json-adapter T001, research P-2).
 *
 * Both functions below were written for the YAML adapter in v0.2 and lived
 * as module-private functions in `src/adapters/yaml/parse.ts` until the
 * JSON adapter needed the identical thing. They were **moved, not
 * rewritten**: this is exactly the kind of code that is wrong the second
 * time it is written, and RFC 3629 / Unicode Table 3-7 is exactly the kind
 * of table nobody transcribes twice without a mistake. The v0.2 corpus
 * cases under `tests/corpus/cases/bytes-encoding/` are the regression
 * evidence for the move, and were confirmed green before anything was
 * built on top.
 *
 * `src/adapters/` is the one format-aware part of the codebase (Principle
 * IV), and this file sits at its root rather than inside either adapter:
 * neither `yaml/` nor `json/` may depend on the other, and a concern both
 * share belongs to neither.
 *
 * The original v0.2 prose follows, unchanged, because the reasoning it
 * records is what makes the implementation below the right one:
 *
 * The validator below is intentionally NOT "decode with the default
 * (repairing) TextDecoder, then scan the result for U+FFFD": a document
 * may legitimately *contain* U+FFFD (its own case, tests/corpus/cases/
 * bytes-encoding/legitimate-replacement-character-accepted.json), so that
 * approach cannot tell "was always U+FFFD" from "was repaired into one",
 * and repairing at all is what FR-002 forbids. Validation runs on the
 * bytes directly, per RFC 3629 / Unicode Table 3-7's well-formedness
 * rules, before any decoding is attempted.
 */
/**
 * The byte offset of the first ill-formed UTF-8 sequence in `bytes`, or
 * `undefined` if every byte belongs to a well-formed sequence. Well-formed
 * here excludes overlong encodings, encoded surrogates (U+D800-U+DFFF),
 * and code points past U+10FFFF, matching Unicode's Table 3-7 exactly —
 * a plain per-byte continuation-count check would silently accept all
 * three.
 */
export declare function findFirstInvalidUtf8ByteOffset(bytes: Uint8Array): number | undefined;
/**
 * Line/column of `offset`, computed directly from the raw bytes rather
 * than through `LineCounter` (there is no decoded string yet to build one
 * from at this point — this runs *before* decoding, on the byte prefix
 * known to be well-formed since `offset` is where that stops being true).
 * Column is a code-point count, matching every other span in this
 * codebase (`src/adapters/yaml/parse.ts`'s module doc, findings 1 and 2).
 */
export declare function locateByteOffset(bytes: Uint8Array, offset: number): {
    line: number;
    column: number;
};
/**
 * How many bytes `text` occupies when encoded as UTF-8 — the replacement
 * for node's `Buffer.byteLength(text, "utf-8")`, which made the library
 * fail to load in any realm that is not node (issue #1).
 *
 * Counts rather than encodes. `new TextEncoder().encode(text).length` is
 * the one-liner and is exactly correct, but it allocates the encoded copy
 * to then throw it away — and the first caller is the parser's *size
 * limit* check, whose whole purpose is to refuse an over-large document
 * "without being parsed at all" (contracts/parse-api.md). Allocating a
 * second copy of a 500 MB input in order to decide it is too big is the
 * one place where the extra copy is not free.
 *
 * An unpaired surrogate counts as 3 bytes, because that is what encoding
 * it produces: both `TextEncoder` and `Buffer.byteLength` substitute
 * U+FFFD (3 bytes in UTF-8) for a code unit that cannot be encoded. This
 * function is not the place that *rejects* such input — `parseYaml`'s own
 * lone-surrogate scan (`invalid-encoding`) is, and it needs a byte length
 * to build the span it reports the rejection with, so counting has to
 * agree with the encoder rather than refuse.
 */
export declare function utf8ByteLength(text: string): number;
//# sourceMappingURL=encoding.d.ts.map