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

function isContinuationByteAt(bytes: Uint8Array, index: number): boolean {
  if (index >= bytes.length) {
    return false;
  }
  const value = bytes[index];
  return value !== undefined && value >= 0x80 && value <= 0xbf;
}

function isByteInRangeAt(bytes: Uint8Array, index: number, min: number, max: number): boolean {
  if (index >= bytes.length) {
    return false;
  }
  const value = bytes[index];
  return value !== undefined && value >= min && value <= max;
}

/**
 * The byte offset of the first ill-formed UTF-8 sequence in `bytes`, or
 * `undefined` if every byte belongs to a well-formed sequence. Well-formed
 * here excludes overlong encodings, encoded surrogates (U+D800-U+DFFF),
 * and code points past U+10FFFF, matching Unicode's Table 3-7 exactly —
 * a plain per-byte continuation-count check would silently accept all
 * three.
 */
export function findFirstInvalidUtf8ByteOffset(bytes: Uint8Array): number | undefined {
  const length = bytes.length;
  let index = 0;
  while (index < length) {
    const leadByte = bytes[index];
    if (leadByte === undefined) {
      // Unreachable: index < length guarantees a defined element.
      throw new Error("Internal error: UTF-8 scan indexed past the end of the byte array");
    }
    if (leadByte <= 0x7f) {
      index += 1;
      continue;
    }
    if (leadByte >= 0xc2 && leadByte <= 0xdf) {
      if (!isContinuationByteAt(bytes, index + 1)) return index;
      index += 2;
      continue;
    }
    if (leadByte === 0xe0) {
      if (!isByteInRangeAt(bytes, index + 1, 0xa0, 0xbf)) return index; // excludes overlong (E0 80-9F)
      if (!isContinuationByteAt(bytes, index + 2)) return index;
      index += 3;
      continue;
    }
    if (leadByte >= 0xe1 && leadByte <= 0xec) {
      if (!isContinuationByteAt(bytes, index + 1)) return index;
      if (!isContinuationByteAt(bytes, index + 2)) return index;
      index += 3;
      continue;
    }
    if (leadByte === 0xed) {
      if (!isByteInRangeAt(bytes, index + 1, 0x80, 0x9f)) return index; // excludes encoded surrogates (ED A0-BF)
      if (!isContinuationByteAt(bytes, index + 2)) return index;
      index += 3;
      continue;
    }
    if (leadByte >= 0xee && leadByte <= 0xef) {
      if (!isContinuationByteAt(bytes, index + 1)) return index;
      if (!isContinuationByteAt(bytes, index + 2)) return index;
      index += 3;
      continue;
    }
    if (leadByte === 0xf0) {
      if (!isByteInRangeAt(bytes, index + 1, 0x90, 0xbf)) return index; // excludes overlong (F0 80-8F)
      if (!isContinuationByteAt(bytes, index + 2)) return index;
      if (!isContinuationByteAt(bytes, index + 3)) return index;
      index += 4;
      continue;
    }
    if (leadByte >= 0xf1 && leadByte <= 0xf3) {
      if (!isContinuationByteAt(bytes, index + 1)) return index;
      if (!isContinuationByteAt(bytes, index + 2)) return index;
      if (!isContinuationByteAt(bytes, index + 3)) return index;
      index += 4;
      continue;
    }
    if (leadByte === 0xf4) {
      if (!isByteInRangeAt(bytes, index + 1, 0x80, 0x8f)) return index; // excludes > U+10FFFF (F4 90-BF)
      if (!isContinuationByteAt(bytes, index + 2)) return index;
      if (!isContinuationByteAt(bytes, index + 3)) return index;
      index += 4;
      continue;
    }
    // 0x80-0xC1: a bare continuation byte, or C0/C1 (which can only start
    // an overlong 2-byte sequence and so are never valid lead bytes).
    // 0xF5-0xFF: beyond the range that can encode a code point <= U+10FFFF.
    // No byte in either set may ever lead a well-formed sequence.
    return index;
  }
  return undefined;
}

/**
 * Line/column of `offset`, computed directly from the raw bytes rather
 * than through `LineCounter` (there is no decoded string yet to build one
 * from at this point — this runs *before* decoding, on the byte prefix
 * known to be well-formed since `offset` is where that stops being true).
 * Column is a code-point count, matching every other span in this
 * codebase (`src/adapters/yaml/parse.ts`'s module doc, findings 1 and 2),
 * and never counts a U+FEFF.
 */
export function locateByteOffset(bytes: Uint8Array, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStartByteOffset = 0;
  for (let index = 0; index < offset; index += 1) {
    if (bytes[index] === 0x0a) {
      line += 1;
      lineStartByteOffset = index + 1;
    }
  }
  let decodedLinePrefix: string;
  try {
    decodedLinePrefix = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(lineStartByteOffset, offset));
  } catch (error) {
    // Should be unreachable: findFirstInvalidUtf8ByteOffset guarantees
    // everything before `offset` is well-formed. Thrown rather than
    // silently mis-reporting a position, matching this file's existing
    // "Internal error" convention.
    throw new Error(`Internal error: byte range [${String(lineStartByteOffset)}, ${String(offset)}) was reported well-formed but failed to decode: ${error instanceof Error ? error.message : String(error)}`);
  }
  // A U+FEFF is a byte of the offset but never a column (SPEC.md §4.2, v1.9).
  const column = [...decodedLinePrefix].filter((character) => character !== "\uFEFF").length + 1;
  return { line, column };
}

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
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) {
      bytes += 1;
    } else if (unit < 0x800) {
      bytes += 2;
    } else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        // A well-formed surrogate pair: one astral scalar, four bytes,
        // and the low surrogate is consumed here rather than counted again.
        bytes += 4;
        i += 1;
      } else {
        // A high surrogate with no low surrogate after it — U+FFFD.
        bytes += 3;
      }
    } else {
      // Every remaining BMP scalar, and every unpaired surrogate (a lone
      // low surrogate, or a high one at the very end of the string),
      // which encodes as U+FFFD: three bytes either way.
      bytes += 3;
    }
  }
  return bytes;
}
