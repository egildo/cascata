/**
 * `DocumentIdentity` and `$pin` verification — data-model.md "Document
 * Identity"; SPEC.md §6.1 (amended: hashing raw bytes, not a canonical
 * form — research D1, the probe-gate finding that withdrew RFC 8785 from
 * this design after it was shown to collide `int 2` with `float 2.0` and
 * to be unable to represent an exact integer past IEEE-754's range).
 *
 * Foundational scaffolding (tasks.md Phase 2): nothing in this slice
 * (T001-T018) yet calls `createDocumentIdentity` from a real fetch or
 * file read — that arrives with User Story 2 (T027) and User Story 3
 * (T045), out of scope here. T007's own task text asks for hashing
 * "over exact bytes... no canonicalization, no text decoding," so this
 * file is written and tested (T011) as a standalone unit now.
 *
 * `src/resolve/` must never import from `src/adapters/` — enforced by
 * tests/unit/layering.test.ts (T012).
 */
import { sha256Hex } from "./sha256.js";
/** What makes two fetches the same document: an absolute resolved location plus the hash of its bytes. */
/**
 * SHA-256 over `bytes` exactly as given — no canonicalization, no text
 * decoding (research D1, D2). Returns lowercase hex, matching
 * `crypto.Hash#digest("hex")`'s native output and the `sha256:<hex>`
 * shape `$pin` values are written in (SPEC.md §6.1: `$pin: sha256:9f2c…`).
 *
 * The digest comes from `./sha256.js` rather than from `node:crypto`,
 * whose bare import made the library fail at module evaluation in any
 * realm that is not node (issue #1). The output string is byte-for-byte
 * what `createHash("sha256")…digest("hex")` produced — asserted against
 * it, and against FIPS 180-4's published vectors, in
 * `tests/unit/portability.test.ts`. See that file for why this is
 * arithmetic in `src/` rather than a `Host` verb or an async
 * `crypto.subtle` call.
 */
export function hashBytes(bytes) {
    return sha256Hex(bytes);
}
/** Construct a Document Identity from a resolved location and the bytes found there; `physical` (v1.13 FR-004) defaults to the location itself. */
export function createDocumentIdentity(location, bytes, physical = location) {
    return { location, physical, hash: hashBytes(bytes) };
}
/**
 * The `$pin` syntax: `sha256:` followed by 64 hex digits — SPEC.md §6.1's
 * literal example (`sha256:9f2c…`). The prose calls this "the W3C
 * Subresource Integrity pattern followed literally," but real SRI syntax
 * is dash-separated and base64-encoded (`sha256-<base64>`); Cascata's own
 * `$pin` syntax is colon-separated. Hex, not base64, is this
 * implementation's reading — closer to how `sha256:<hex>` is already
 * conventional elsewhere (OCI/Docker content digests use exactly this
 * shape) and it is what `Hash#digest("hex")` produces with no re-encoding
 * step. Recorded as a judgment call, not a spec quotation: see the
 * milestone report. Case-insensitive on input; `hash` is always compared
 * and stored lowercase.
 */
const PIN_PATTERN = /^sha256:([0-9a-fA-F]{64})$/;
/**
 * Verify a `$pin` string against a Document Identity's hash, distinguishing
 * **malformed** (not a well-formed `sha256:…` value at all — contracts/
 * diagnostics.md's `malformed-pin`) from **mismatch** (well-formed, but
 * names a different hash than what was actually fetched — `pin-mismatch`).
 * Span-free by design: at this Foundational stage no `Reference` with a
 * real span carries a pin yet (that is User Story 2/3 work); a future
 * caller attaches this result's `reason` to the reference's own span when
 * building the diagnostic.
 */
export function verifyPin(pin, identity) {
    const match = PIN_PATTERN.exec(pin);
    if (match === null) {
        return { ok: false, reason: "malformed" };
    }
    const expected = match[1];
    if (expected === undefined) {
        // Unreachable: the pattern has exactly one capture group, and `match`
        // being non-null guarantees it participated. Defensive per this
        // codebase's convention of never trusting an index into a match array
        // under noUncheckedIndexedAccess without a runtime check.
        throw new Error("Internal error: malformed-pin regex matched with no capture group");
    }
    const expectedLower = expected.toLowerCase();
    if (expectedLower !== identity.hash) {
        return { ok: false, reason: "mismatch", expected: expectedLower, actual: identity.hash };
    }
    return { ok: true };
}
//# sourceMappingURL=identity.js.map