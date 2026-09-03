/**
 * SHA-256 (FIPS 180-4), in arithmetic this library owns.
 *
 * **Why this exists rather than `node:crypto`.** `resolve/identity.ts`
 * hashes bytes in exactly one place, synchronously, inside
 * `createDocumentIdentity`. A bare `import { createHash } from
 * "node:crypto"` made the whole library fail at *module evaluation* in
 * any realm that is not node — reported from outside (issue #1) by an
 * embedder whose editing tools run the cascade inside a browser tab.
 * That is not a rule violation: `node:crypto` is on the allowed
 * built-ins list. It is narrower than that — Article VI's premise is
 * that the library reads only what the host answers, and reaching for a
 * *platform facility* past that seam is what makes the seam not
 * portable.
 *
 * Three routes were open, and each cost something:
 *
 * - **A `hash` verb on `Host`.** The most Article-VI-shaped answer, but
 *   it hands every embedder the obligation to supply a SHA-256 — the
 *   exact burden the reporting embedder called disproportionate for one
 *   call, and it would be async (see below), so it ripples too.
 * - **`globalThis.crypto.subtle.digest`.** No new code, native on both
 *   platforms — and unavoidably **async**, in node as much as in the
 *   browser. `hashBytes` is synchronous and sits under
 *   `createDocumentIdentity` and `createResolvedDocument`, both of which
 *   are synchronous and called from several places; the ripple is real
 *   and buys nothing a caller can observe.
 * - **This file.** Sixty lines of well-specified integer arithmetic, no
 *   dependency (the constitution's ceiling is about *dependencies*, and
 *   code in `src/` is not one), no API change, no ripple, no host
 *   obligation. `crypto.subtle` stays available to anyone who wants it
 *   at the call site later; nothing here forecloses that.
 *
 * **Nothing here is a general-purpose crypto offering.** It hashes
 * document bytes so that two fetches can be told apart and a `$pin` can
 * be checked (SPEC.md §6.1); there is no streaming interface, no HMAC,
 * no constant-time comparison, and none is wanted — `$pin` compares two
 * public digests of public bytes, where a timing signal reveals nothing
 * an attacker did not already hand us. Its conformance evidence is
 * `tests/unit/portability.test.ts`: FIPS 180-4's own published vectors
 * plus a differential sweep against `node:crypto` over block/padding
 * boundaries, non-ASCII text and adversarial byte strings. The oracle is
 * deliberately the implementation this file replaced.
 */

// FIPS 180-4 §4.2.2 — the first thirty-two bits of the fractional parts
// of the cube roots of the first sixty-four primes.
const K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

// FIPS 180-4 §5.3.3 — the first thirty-two bits of the fractional parts
// of the square roots of the first eight primes.
const H0: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/** Rotate a 32-bit word right by `n` bits (FIPS 180-4 §3.2's ROTR). */
function rotr(word: number, n: number): number {
  return ((word >>> n) | (word << (32 - n))) >>> 0;
}

/**
 * SHA-256 over `bytes` exactly as given, as lowercase hex — the same
 * 64-digit string `crypto.Hash#digest("hex")` produces, which is what
 * `$pin`'s `sha256:<hex>` shape is written in (SPEC.md §6.1).
 *
 * Reads only through the `Uint8Array` view it is handed, never through
 * the view's underlying buffer: a subarray of a larger buffer hashes its
 * own bytes and no others.
 */
export function sha256Hex(bytes: Uint8Array): string {
  const h = new Uint32Array(H0);
  const w = new Uint32Array(64);

  // The message length in bits, as a 64-bit big-endian value.
  // `bytes.length * 8` exceeds 2^32 well before it exceeds Number's exact
  // integer range, so the high word is computed by division rather than
  // by a shift — `<<` and `>>>` are 32-bit operators and would silently
  // wrap. `Math.floor` over the byte count first, so a document larger
  // than 512 MiB still reports its length correctly.
  const bitLengthHigh = Math.floor(bytes.length / 0x20000000);
  const bitLengthLow = (bytes.length * 8) >>> 0;

  // The padded message is the input, then 0x80, then zeroes, then the
  // 8-byte length — rounded up to a whole number of 64-byte blocks. The
  // padding is materialized as a final short buffer (one block, or two
  // when the terminator and the length cannot share one) rather than by
  // copying the whole message.
  const blockCount = Math.floor(bytes.length / 64);
  const tailLength = bytes.length - blockCount * 64;
  const tail = new Uint8Array(tailLength + 9 <= 64 ? 64 : 128);
  tail.set(bytes.subarray(blockCount * 64), 0);
  tail[tailLength] = 0x80;
  const lengthOffset = tail.length - 8;
  tail[lengthOffset] = (bitLengthHigh >>> 24) & 0xff;
  tail[lengthOffset + 1] = (bitLengthHigh >>> 16) & 0xff;
  tail[lengthOffset + 2] = (bitLengthHigh >>> 8) & 0xff;
  tail[lengthOffset + 3] = bitLengthHigh & 0xff;
  tail[lengthOffset + 4] = (bitLengthLow >>> 24) & 0xff;
  tail[lengthOffset + 5] = (bitLengthLow >>> 16) & 0xff;
  tail[lengthOffset + 6] = (bitLengthLow >>> 8) & 0xff;
  tail[lengthOffset + 7] = bitLengthLow & 0xff;

  for (let block = 0; block < blockCount; block += 1) {
    compress(h, w, bytes, block * 64);
  }
  for (let offset = 0; offset < tail.length; offset += 64) {
    compress(h, w, tail, offset);
  }

  let hex = "";
  for (let i = 0; i < 8; i += 1) {
    hex += (h[i] ?? 0).toString(16).padStart(8, "0");
  }
  return hex;
}

/**
 * One 64-byte block, in place: FIPS 180-4 §6.2.2's four steps over the
 * message schedule `w` (reused across blocks, fully overwritten each
 * time) and the eight working variables held in `h`.
 *
 * Every intermediate is forced back into an unsigned 32-bit word with
 * `>>> 0`. `|0`/`>>>0` and `+` on values above 2^31 is where a
 * hand-written SHA-256 goes wrong quietly — the differential tests over
 * all-0xFF input in `tests/unit/portability.test.ts` exist for exactly
 * this line of reasoning.
 */
function compress(h: Uint32Array, w: Uint32Array, block: Uint8Array, offset: number): void {
  for (let t = 0; t < 16; t += 1) {
    const i = offset + t * 4;
    w[t] =
      (((block[i] ?? 0) << 24) | ((block[i + 1] ?? 0) << 16) | ((block[i + 2] ?? 0) << 8) | (block[i + 3] ?? 0)) >>> 0;
  }
  for (let t = 16; t < 64; t += 1) {
    const w15 = w[t - 15] ?? 0;
    const w2 = w[t - 2] ?? 0;
    const s0 = (rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)) >>> 0;
    const s1 = (rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)) >>> 0;
    w[t] = ((w[t - 16] ?? 0) + s0 + (w[t - 7] ?? 0) + s1) >>> 0;
  }

  let a = h[0] ?? 0;
  let b = h[1] ?? 0;
  let c = h[2] ?? 0;
  let d = h[3] ?? 0;
  let e = h[4] ?? 0;
  let f = h[5] ?? 0;
  let g = h[6] ?? 0;
  let hh = h[7] ?? 0;

  for (let t = 0; t < 64; t += 1) {
    const bigSigma1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
    const ch = ((e & f) ^ (~e & g)) >>> 0;
    const t1 = (hh + bigSigma1 + ch + (K[t] ?? 0) + (w[t] ?? 0)) >>> 0;
    const bigSigma0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
    const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
    const t2 = (bigSigma0 + maj) >>> 0;

    hh = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }

  h[0] = ((h[0] ?? 0) + a) >>> 0;
  h[1] = ((h[1] ?? 0) + b) >>> 0;
  h[2] = ((h[2] ?? 0) + c) >>> 0;
  h[3] = ((h[3] ?? 0) + d) >>> 0;
  h[4] = ((h[4] ?? 0) + e) >>> 0;
  h[5] = ((h[5] ?? 0) + f) >>> 0;
  h[6] = ((h[6] ?? 0) + g) >>> 0;
  h[7] = ((h[7] ?? 0) + hh) >>> 0;
}
