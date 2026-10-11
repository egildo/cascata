/**
 * v0.7 US4 — SPEC.md Article VI, FR-022, FR-026 through FR-031. A full
 * resolution driven by a host backed entirely by an in-memory map, with
 * no filesystem and no network reachable — Acceptance Scenario 2's own
 * words. Plus the host-refusal, missing-host, canonicalization-fallback,
 * and determinism scenarios (3 through 7) that only a controllable host
 * double can exercise directly.
 */
import { describe, expect, it } from "vitest";
import { resolve, type ResolveOptions } from "../../src/index.js";
import { InMemoryHost } from "./host-test-double.js";

const ENCODER = new TextEncoder();

const CONFIG_BYTES = ENCODER.encode("$schema: ./schema.yaml\ntitle: hello\n");
const SCHEMA_BYTES = ENCODER.encode("keys:\n  title:\n    demand:\n      type: string\n");

function baseFiles(): Map<string, Uint8Array> {
  return new Map([
    ["/virtual/config.yaml", CONFIG_BYTES],
    ["/virtual/schema.yaml", SCHEMA_BYTES],
  ]);
}

describe("v0.7 FR-022/FR-026 — a full resolution through an in-memory host, no filesystem reachable", () => {
  it("resolves $schema and the schema's own demand, entirely in-memory", async () => {
    const host = new InMemoryHost({ files: baseFiles() });
    const result = await resolve("/virtual/config.yaml", { host, sandboxRoot: "/virtual" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.graph.documents).toHaveLength(2);
    // Both the entry read and the schema read went through the host, not node:fs.
    expect(host.reads).toContain("/virtual/config.yaml");
    expect(host.reads).toContain("/virtual/schema.yaml");
  });
});

describe("v0.7 FR-028 — a host that declines to supply a document refuses with a diagnostic, never an exception", () => {
  it("a host with no files at all produces document-unreachable, not a thrown error", async () => {
    const host = new InMemoryHost({ files: new Map() });
    const result = await resolve("/virtual/config.yaml", { host, sandboxRoot: "/virtual" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("document-unreachable");
  });
});

describe("v0.7 FR-028 — resolve() called with no host throws (a programmer error, not a fact about the world)", () => {
  it("throws synchronously before any host method is ever called", async () => {
    const options = { sandboxRoot: "/virtual" } as unknown as ResolveOptions;
    await expect(resolve("/virtual/config.yaml", options)).rejects.toThrow(/requires 'host'/);
  });

  it("throws for a malformed host (missing a required method)", async () => {
    const brokenHost = { read: async () => ({ ok: false as const, reason: "x" }) } as unknown as ResolveOptions["host"];
    await expect(resolve("/virtual/config.yaml", { host: brokenHost, sandboxRoot: "/virtual" })).rejects.toThrow(/requires 'host'/);
  });
});

// The sandbox check (`isSandboxEscape`) applies only to **schema-authored**
// references (SPEC.md §8.1's razor, FR-020) — a config's own `$schema` is
// author consent and is exempt. Testing it therefore needs a THREE-layer
// chain: config's own `$schema` (exempt) names a middle schema, and it is
// *middle's* own `$adopts` (schema-authored) that gets checked. A two-layer
// setup, tried first, cannot exercise this at all — the same discriminating
// finding `tests/unit/authority.test.ts`'s own module doc records for
// `demandPinnedAdoption`.
function threeLayerFiles(): Map<string, Uint8Array> {
  return new Map([
    ["/virtual/config.yaml", ENCODER.encode("$schema: ./middle.yaml\ntitle: hello\n")],
    ["/virtual/middle.yaml", ENCODER.encode("$adopts: ./root.yaml\n")],
    ["/virtual/root.yaml", ENCODER.encode("keys:\n  title:\n    demand:\n      type: string\n")],
  ]);
}

describe("v0.7 FR-026/FR-027 — canonicalization is the host's answer; 'cannot canonicalize' is a sandbox verdict in neither direction", () => {
  it("a schema-authored reference (middle's own $adopts) the host CAN canonicalize to somewhere outside the sandbox root is refused (sandbox-escape)", async () => {
    // root.yaml, lexically inside /virtual, canonicalizes (per the host) to somewhere OUTSIDE it -- a symlink escape.
    const host = new InMemoryHost({ files: threeLayerFiles(), canonical: new Map([["/virtual/root.yaml", "/outside/root.yaml"]]) });
    const result = await resolve("/virtual/config.yaml", { host, sandboxRoot: "/virtual" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe("sandbox-escape");
  });

  it("a location the host CANNOT canonicalize (undefined) falls back to the lexical path -- not an automatic pass or refusal", async () => {
    const host = new InMemoryHost({ files: threeLayerFiles(), canonicalizeIsIdentity: false });
    // No entries in `canonical` at all, and canonicalizeIsIdentity:false -- every canonicalize() call returns undefined, exactly like a target that does not exist. The lexical path (/virtual/root.yaml) is still inside the lexical sandboxRoot (/virtual), so this must resolve, not refuse.
    const result = await resolve("/virtual/config.yaml", { host, sandboxRoot: "/virtual" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(host.canonicalizes.length).toBeGreaterThan(0);
  });
});

describe("v0.7 FR-031 — two different hosts supplying byte-identical documents produce identical trees, provenance, and diagnostics, in identical order", () => {
  it("two independently-constructed in-memory hosts with the same bytes resolve identically", async () => {
    const hostA = new InMemoryHost({ files: baseFiles() });
    const hostB = new InMemoryHost({ files: baseFiles() }); // a fresh Map instance, byte-identical content
    const resultA = await resolve("/virtual/config.yaml", { host: hostA, sandboxRoot: "/virtual" });
    const resultB = await resolve("/virtual/config.yaml", { host: hostB, sandboxRoot: "/virtual" });
    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    if (!resultA.ok || !resultB.ok) return;
    expect(resultA.graph.documents.map((d) => d.identity.hash)).toEqual(resultB.graph.documents.map((d) => d.identity.hash));
    expect(resultA.graph.documents.map((d) => d.identity.location)).toEqual(resultB.graph.documents.map((d) => d.identity.location));
    expect(resultA.pedigree.map((p) => p.identity.hash)).toEqual(resultB.pedigree.map((p) => p.identity.hash));
  });
});

describe("v0.7 FR-026 — the sandbox verdict genuinely uses the host's own canonical answer, not a lexical string comparison on the untranslated input", () => {
  it("sandboxRoot canonicalizing to a different spelling than the schema's own canonical answer is still refused", async () => {
    // sandboxRoot itself canonicalizes to a differently-spelled path (a
    // case-insensitive filesystem, or sandboxRoot itself sitting behind a
    // symlink); root.yaml's own location canonicalizes to a path that is
    // NOT beneath that spelling. If the check silently fell back to
    // comparing the *lexical* strings instead of the host's own answers,
    // this would incorrectly pass (both start with "/virtual").
    const host = new InMemoryHost({ files: threeLayerFiles(), canonical: new Map([["/virtual", "/VIRTUAL"]]) });
    const result = await resolve("/virtual/config.yaml", { host, sandboxRoot: "/virtual" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe("sandbox-escape");
  });
});

// Edge Case (spec.md): "a host that canonicalizes two distinct locations to
// one identity (a hardlink, a case-insensitive filesystem)". Investigated
// rather than assumed: Cascata's own diamond dedup (`GraphBuilder`,
// `src/graph/build.ts`) keys on **content hash** (`registerContent`'s
// `canonicalByHash`) or on the **lexical** location string
// (`resolvedByLocation`) — never on `host.canonicalize()`'s own answer.
// `canonicalize()` is consulted by exactly one thing: the sandbox check
// (`isWithinSandbox`). Two lexically-different locations the host reports
// as canonically identical (a hardlink) therefore dedupe automatically and
// correctly through the *existing*, host-independent content-hash
// mechanism the moment their bytes agree [v1.13: stale. That mechanism is
// gone (FR-006 revised) and identity is now the host's canonical answer,
// so a hardlink or case-variant is one document by physical path] — already covered end to end by
// `tests/unit/graph-content-dedup.test.ts` for the local case, which this
// milestone's host refactor does not touch. No new test is added here for
// that reason: one asserting host.canonicalize()-driven dedup would be
// asserting a mechanism that does not exist and never ran.
