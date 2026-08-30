/**
 * Unit tests for src/resolve/identity.ts (T011) — hashing over exact
 * bytes (research D1, D2) and `$pin` verification, distinguishing a pin
 * that is well-formed but wrong from one that is not well-formed at all
 * (contracts/diagnostics.md: `pin-mismatch` vs `malformed-pin`).
 */

import { describe, expect, it } from "vitest";
import { createDocumentIdentity, hashBytes, verifyPin } from "../../src/resolve/identity.js";

describe("hashBytes / createDocumentIdentity", () => {
  it("hashes the empty byte string to SHA-256's known empty-input digest", () => {
    // A fixed, independently-known value (confirmed against `sha256sum`
    // outside this codebase, not derived from hashBytes itself) — this
    // checks against an external oracle, not hashBytes against itself.
    const knownEmptyInputDigest = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(knownEmptyInputDigest).toHaveLength(64);
    expect(hashBytes(new Uint8Array())).toBe(knownEmptyInputDigest);
  });

  it("hashes exact bytes, not a re-encoded or canonicalized form (research D1)", () => {
    const bytes = new TextEncoder().encode("a: 1\n");
    const hash = hashBytes(bytes);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Same bytes, hashed twice, must agree (determinism) — and a single
    // differing byte must change the hash (sensitivity), the two
    // properties a content hash exists to provide.
    expect(hashBytes(bytes)).toBe(hash);
    const mutated = new Uint8Array(bytes);
    mutated[0] = mutated[0]! + 1;
    expect(hashBytes(mutated)).not.toBe(hash);
  });

  it("hashes byte-identical documents to the same identity regardless of location", () => {
    const bytes = new TextEncoder().encode("shared: true\n");
    const a = createDocumentIdentity("/a/schema.yaml", bytes);
    const b = createDocumentIdentity("https://example.com/schema.yaml", bytes);
    expect(a.hash).toBe(b.hash);
    expect(a.location).not.toBe(b.location);
  });

  it("hashes the int 2 and float 2.0 source bytes differently — exactly the collision JCS would have produced (research D1)", () => {
    // This is not testing YAML parsing (out of scope for identity.ts,
    // which never decodes text) — it is testing that hashing raw bytes,
    // unlike JCS canonicalization, does not collapse two source texts
    // that §4.2 holds to mean different things.
    const intBytes = new TextEncoder().encode("version: 2\n");
    const floatBytes = new TextEncoder().encode("version: 2.0\n");
    expect(hashBytes(intBytes)).not.toBe(hashBytes(floatBytes));
  });
});

describe("verifyPin", () => {
  const bytes = new TextEncoder().encode("x: 1\n");
  const identity = createDocumentIdentity("/x.yaml", bytes);

  it("accepts a pin that matches the identity's hash", () => {
    const result = verifyPin(`sha256:${identity.hash}`, identity);
    expect(result).toEqual({ ok: true });
  });

  it("accepts a pin written in uppercase hex, matched case-insensitively", () => {
    const result = verifyPin(`sha256:${identity.hash.toUpperCase()}`, identity);
    expect(result).toEqual({ ok: true });
  });

  it("reports 'mismatch', not 'malformed', for a well-formed pin naming the wrong hash", () => {
    const wrongButWellFormed = "sha256:" + "0".repeat(64);
    const result = verifyPin(wrongButWellFormed, identity);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("mismatch");
    if (result.reason !== "mismatch") throw new Error("unreachable");
    expect(result.expected).toBe("0".repeat(64));
    expect(result.actual).toBe(identity.hash);
  });

  it("reports 'malformed', not 'mismatch', for the wrong algorithm prefix", () => {
    const result = verifyPin(`sha512:${identity.hash}`, identity);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("reports 'malformed' for a hash of the wrong length", () => {
    const result = verifyPin(`sha256:${identity.hash.slice(0, 63)}`, identity);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("reports 'malformed' for non-hex characters", () => {
    const result = verifyPin(`sha256:${"g".repeat(64)}`, identity);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("reports 'malformed' for a pin with no colon at all", () => {
    const result = verifyPin(identity.hash, identity);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("reports 'malformed' for an empty string", () => {
    const result = verifyPin("", identity);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });
});
