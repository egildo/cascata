/**
 * v0.7 US5, SPEC.md Article VI (§16) — the one-call `load()`. FR-032
 * through FR-034.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { load, merge, nodesEqual, parse, resolve, validate, why, type LoadOptions } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";

const DELEGATE_LINT_DIR = join(__dirname, "..", "corpus", "cases", "validate-delegation", "delegate-leaf-shape-lint");
const REQUIRED_VACUOUS_DIR = join(__dirname, "..", "corpus", "cases", "seal", "final-provide-required-vacuous");
const SANDBOX_ESCAPE_DIR = join(__dirname, "..", "corpus", "cases", "sandbox-escape");
const BASIC_DIR = join(__dirname, "..", "corpus", "cases", "validate-delegation", "basic-grant");

function optionsFor(dir: string): LoadOptions {
  return { host: createNodeHost(), sandboxRoot: dir };
}

describe("v0.7 FR-032 — load() returns a validated configuration with any info lints, or errors, never both", () => {
  it("a config landing only on an info lint at resolve() time is ok:true with the lint carried through", async () => {
    const result = await load(join(DELEGATE_LINT_DIR, "config.yaml"), optionsFor(DELEGATE_LINT_DIR));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("delegate-inline-string-loaded");
  });

  it("a config landing only on an info lint at validate() time (required-vacuous) is ok:true with the lint carried through", async () => {
    const result = await load(join(REQUIRED_VACUOUS_DIR, "config.yaml"), optionsFor(REQUIRED_VACUOUS_DIR));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("required-vacuous");
  });

  it("a resolve()-stage failure (sandbox-escape) returns diagnostics, never a configuration", async () => {
    const dir = SANDBOX_ESCAPE_DIR;
    const result = await load(join(dir, "config.yaml"), { host: createNodeHost(), sandboxRoot: join(dir, "sandbox") });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.every((d) => d.level === "error")).toBe(true);
  });

  it("an ordinary success with no diagnostics at all is ok:true with an empty diagnostics array, not an absent field", async () => {
    const result = await load(join(BASIC_DIR, "config.yaml"), optionsFor(BASIC_DIR));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
  });
});

describe("v0.7 FR-033 — load()'s result is identical to the staged calls in sequence, diagnostic order included", () => {
  it("matches resolve() -> merge() -> validate() run by hand, for a success-with-lint case", async () => {
    const options = optionsFor(DELEGATE_LINT_DIR);
    const loaded = await load(join(DELEGATE_LINT_DIR, "config.yaml"), options);

    const resolved = await resolve(join(DELEGATE_LINT_DIR, "config.yaml"), options);
    if (!resolved.ok) throw new Error("expected resolve() ok:true");
    const merged = merge(resolved);
    if (!merged.ok) throw new Error("expected merge() ok:true");
    const validated = validate(merged.configuration);
    if (!validated.ok) throw new Error("expected validate() ok:true");

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // Not the identical object (load() makes its own independent staged
    // calls, it does not reuse this test's hand-rolled ones) but the
    // identical *content*: same tree shape (SPEC.md §4.2's own model
    // equality, `nodesEqual` — not vitest's generic `toEqual`, which does
    // not compare `Mapping.entries`' Proxy-wrapped `Map` reliably, per
    // CLAUDE.md's own "Object.freeze does nothing to a Map" trap), same
    // layers, same pedigree.
    expect(nodesEqual(loaded.configuration.tree, validated.certified.tree)).toBe(true);
    expect(loaded.configuration.layers.map((l) => l.identity.hash)).toEqual(validated.certified.layers.map((l) => l.identity.hash));
    expect(loaded.configuration.pedigree.map((p) => p.identity.hash)).toEqual(validated.certified.pedigree.map((p) => p.identity.hash));
    // Same diagnostics, same order: resolve's own info lints first, then validate's own.
    const expectedDiagnostics = [...resolved.diagnostics, ...validated.diagnostics];
    expect(loaded.diagnostics.map((d) => d.code)).toEqual(expectedDiagnostics.map((d) => d.code));
    expect(loaded.diagnostics.map((d) => d.level)).toEqual(expectedDiagnostics.map((d) => d.level));
  });

  it("matches the staged calls' diagnostics, in order, for a failure case", async () => {
    const dir = SANDBOX_ESCAPE_DIR;
    const options = { host: createNodeHost(), sandboxRoot: join(dir, "sandbox") };
    const loaded = await load(join(dir, "config.yaml"), options);
    const resolved = await resolve(join(dir, "config.yaml"), options);
    expect(loaded.ok).toBe(false);
    expect(resolved.ok).toBe(false);
    if (loaded.ok || resolved.ok) return;
    expect(loaded.diagnostics.map((d) => d.code)).toEqual(resolved.diagnostics.map((d) => d.code));
  });
});

describe("v0.7 FR-034 — the staged functions remain public", () => {
  it("parse, resolve, merge, validate, why are all still exported and callable", () => {
    expect(typeof parse).toBe("function");
    expect(typeof resolve).toBe("function");
    expect(typeof merge).toBe("function");
    expect(typeof validate).toBe("function");
    expect(typeof why).toBe("function");
  });
});

describe("v0.7 FR-032 — load() throws for a missing required option; never for a fact about the world", () => {
  it("throws when host is omitted", async () => {
    const options = { sandboxRoot: DELEGATE_LINT_DIR } as unknown as LoadOptions;
    await expect(load(join(DELEGATE_LINT_DIR, "config.yaml"), options)).rejects.toThrow(/requires 'host'/);
  });

  it("throws when sandboxRoot is omitted", async () => {
    const options = { host: createNodeHost() } as unknown as LoadOptions;
    await expect(load(join(DELEGATE_LINT_DIR, "config.yaml"), options)).rejects.toThrow(/requires 'sandboxRoot'/);
  });
});
