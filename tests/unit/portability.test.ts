/**
 * Browser-realm portability (issue #1, reported by BelType against v1.4).
 *
 * Two node-only facilities sat inside `src/`: `node:crypto`'s `createHash`
 * in `src/resolve/identity.ts`, and the `Buffer` global in
 * `src/adapters/yaml/parse.ts`. Neither reached past the host seam for
 * I/O — Article VI's actual subject — but both reached past it for a
 * *platform facility*, which made the library fail at module evaluation
 * in any realm that is not node. This file is the conformance evidence
 * for their two replacements; `tests/unit/layering.test.ts` carries the
 * mechanical sweep that keeps them from coming back.
 *
 * **`node:crypto` is the oracle here, and that is the point.** Principle V
 * forbids deriving an expected value from the implementation under test.
 * The digests below come from FIPS 180-4's own published vectors, and
 * every differential case is checked against node's `createHash` — an
 * implementation written by someone else, decades older than this one.
 * A test importing `node:crypto` is not a boundary violation:
 * `tests/` has never been policed by the host boundary, and this suite
 * has always been node-only (it reads its own fixtures off the disk).
 *
 * Probe gate (Principle V) for both replacements: one non-ASCII input,
 * one boundary input, one adversarial input, each named as such below.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/resolve/sha256.js";
import { utf8ByteLength } from "../../src/adapters/encoding.js";

const encoder = new TextEncoder();

/** node's own SHA-256 — the external oracle, never this codebase's. */
function oracle(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("sha256Hex — FIPS 180-4 published vectors (values transcribed from the standard, not produced by any code here)", () => {
  const published: ReadonlyArray<readonly [string, string, string]> = [
    ["the empty message", "", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ['"abc" — FIPS 180-4 B.1', "abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "the 448-bit two-block message — FIPS 180-4 B.2",
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
  ];

  for (const [label, input, digest] of published) {
    it(`hashes ${label}`, () => {
      expect(sha256Hex(encoder.encode(input))).toBe(digest);
    });
  }

  // FIPS 180-4 B.3: one million "a". Also the boundary case for the
  // length field itself (8,000,000 bits) and for any accumulator that
  // might overflow a 32-bit byte count part-way.
  it('hashes one million "a" — FIPS 180-4 B.3', () => {
    const million = new Uint8Array(1_000_000).fill(0x61);
    expect(sha256Hex(million)).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });
});

describe("sha256Hex — differential against node:crypto", () => {
  // **Boundary inputs.** SHA-256 pads to a 64-byte block with a
  // one-bit terminator and a 64-bit length; a message of 55 bytes is the
  // last that fits its length in the same block, 56 is the first that
  // does not, and 64 is a whole block whose padding is therefore an
  // entire extra block. Every one of these is a place an implementation
  // can be wrong while passing "abc".
  for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
    it(`agrees with node:crypto on ${length} incrementing bytes (block/padding boundary)`, () => {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) {
        bytes[i] = i % 256;
      }
      expect(sha256Hex(bytes)).toBe(oracle(bytes));
    });
  }

  // **Non-ASCII inputs.** The probe-gate requirement, and the exact class
  // of input that made two earlier conclusions in this codebase wrong.
  for (const text of ["café", "日本語のキー", "🌍🚀", "Ω≈ç√∫˜µ", "égildo"]) {
    it(`agrees with node:crypto on non-ASCII text ${JSON.stringify(text)}`, () => {
      const bytes = encoder.encode(text);
      expect(sha256Hex(bytes)).toBe(oracle(bytes));
    });
  }

  // **Adversarial inputs.** All-zero and all-0xFF bytes (a signed-shift
  // bug shows up on the high bit), a byte string that is not valid UTF-8
  // at all (the hash is over bytes, never over text — v0.2 research D2),
  // and the padding terminator's own value standing alone as the message.
  const adversarial: ReadonlyArray<readonly [string, Uint8Array]> = [
    ["64 zero bytes", new Uint8Array(64)],
    ["64 0xFF bytes — the high bit set in every word", new Uint8Array(64).fill(0xff)],
    ["a lone 0x80 — the padding terminator as the whole message", new Uint8Array([0x80])],
    ["bytes that are not valid UTF-8", new Uint8Array([0xff, 0xfe, 0xc0, 0x80, 0xed, 0xa0, 0x80])],
    ["0xFF repeated 1000 times", new Uint8Array(1000).fill(0xff)],
  ];
  for (const [label, bytes] of adversarial) {
    it(`agrees with node:crypto on ${label}`, () => {
      expect(sha256Hex(bytes)).toBe(oracle(bytes));
    });
  }

  it("is sensitive to a single flipped bit", () => {
    const bytes = encoder.encode("cascata");
    const mutated = new Uint8Array(bytes);
    mutated[0] = (mutated[0] ?? 0) ^ 0x01;
    expect(sha256Hex(mutated)).not.toBe(sha256Hex(bytes));
  });

  it("returns lowercase hex of exactly 64 digits", () => {
    expect(sha256Hex(encoder.encode("x"))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not read past a subarray's own view of its buffer", () => {
    // A Uint8Array need not start at byte 0 of its buffer. An
    // implementation indexing the underlying ArrayBuffer instead of the
    // view would hash the wrong bytes here and nowhere else.
    const backing = new Uint8Array([0xaa, 0xbb, 0x61, 0x62, 0x63, 0xcc]);
    const view = backing.subarray(2, 5);
    expect(sha256Hex(view)).toBe(oracle(view));
    expect(sha256Hex(view)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("utf8ByteLength — differential against Buffer.byteLength", () => {
  // The replacement for `Buffer.byteLength(s, "utf-8")` must agree with it
  // on every input the parser can see, including the ones where UTF-8 and
  // UTF-16 disagree about length and the ones that are not well-formed
  // UTF-16 at all. Both functions replace an unpaired surrogate with
  // U+FFFD (3 bytes); that agreement is asserted, not assumed.
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["the empty string (boundary)", ""],
    ["pure ASCII", "key: value\n"],
    ["two-byte scalars (non-ASCII)", "café: naïve\n"],
    ["three-byte scalars (non-ASCII)", "日本語: のキー\n"],
    ["astral plane, surrogate pairs (non-ASCII)", "🌍: 🚀\n"],
    ["a combining mark", "é: x\n"],
    ["a byte-order mark", "\ufeffkey: value\n"],
    ["a lone high surrogate (adversarial, not well-formed UTF-16)", "\ud800"],
    ["a lone low surrogate (adversarial)", "\udc00"],
    ["a reversed pair (adversarial)", "\udc00\ud800"],
    ["a lone surrogate between valid text (adversarial)", "a\ud800b"],
    ["a trailing lone surrogate (adversarial)", "key: v\ud83d"],
    ["U+FFFD written literally", "�"],
    ["the last BMP scalar (boundary)", "￿"],
    ["the first astral scalar (boundary)", "\u{10000}"],
    ["the last scalar (boundary)", "\u{10ffff}"],
    ["a NUL", "\u0000"],
    ["the last one-byte scalar (boundary)", "\u007f"],
    ["the first two-byte scalar (boundary)", "\u0080"],
    ["the last two-byte scalar (boundary)", "߿"],
    ["the first three-byte scalar (boundary)", "ࠀ"],
  ];

  for (const [label, text] of cases) {
    it(`agrees with Buffer.byteLength on ${label}`, () => {
      expect(utf8ByteLength(text)).toBe(Buffer.byteLength(text, "utf-8"));
    });
  }

  it("agrees with Buffer.byteLength on 4,000 pseudo-random strings over the whole code-unit range", () => {
    // Deterministic, so a failure is reproducible: a small LCG rather
    // than Math.random.
    let seed = 0x2545f491;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed;
    };
    for (let i = 0; i < 4000; i += 1) {
      let text = "";
      const length = next() % 12;
      for (let j = 0; j < length; j += 1) {
        // The full UTF-16 code-unit range, lone surrogates included.
        text += String.fromCharCode(next() % 0x10000);
      }
      expect(utf8ByteLength(text), JSON.stringify(text)).toBe(Buffer.byteLength(text, "utf-8"));
    }
  });
});
