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
/**
 * SHA-256 over `bytes` exactly as given, as lowercase hex — the same
 * 64-digit string `crypto.Hash#digest("hex")` produces, which is what
 * `$pin`'s `sha256:<hex>` shape is written in (SPEC.md §6.1).
 *
 * Reads only through the `Uint8Array` view it is handed, never through
 * the view's underlying buffer: a subarray of a larger buffer hashes its
 * own bytes and no others.
 */
export declare function sha256Hex(bytes: Uint8Array): string;
//# sourceMappingURL=sha256.d.ts.map