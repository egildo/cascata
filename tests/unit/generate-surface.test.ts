/**
 * v1.1 (010) US5 — **one stage, one call.**
 *
 * `contracts/emitted-type.md` §5: `generateTypes()` resolves a *schema* as
 * the launching point, treats every document it reaches as a schema layer,
 * accumulates, generates, and returns a verdict — never a throw for a fact
 * about the world, always a throw for a missing `host` (Article VI).
 *
 * The point worth stating plainly, because `resolve()` reads the other way
 * round: **the entry document of a `generateTypes()` resolution is the leaf
 * schema, not a config** (plan D-5). Its own `keys:` govern the root, and
 * its `$adopts` — not a `$schema` it does not have — starts the chain.
 */

import { describe, expect, it } from "vitest";
import { accumulate, generate, generateTypes, type GenerateTypesOptions } from "../../src/index.js";
import { parse } from "../../src/index.js";
import { createOrigin } from "../../src/model/span.js";
import type { Layer } from "../../src/merge/provenance.js";
import { InMemoryHost } from "./host-test-double.js";
import { compileInMemory, renderProblems } from "./generate-literal.js";

const ENCODER = new TextEncoder();

const ROOT = `$id: vendor/core
keys:
  name:
    demand: { type: string, required: true }
  budget:
    demand: { type: "int | float" }
`;

const HOUSE = `$adopts: ./root.yaml
$id: acme/house
keys:
  budget:
    demand: { type: int }
`;

const LEAF = `$adopts: ./house.yaml
$id: acme/project
keys:
  owner:
    demand: { type: string }
`;

function chainFiles(): Map<string, Uint8Array> {
  return new Map([
    ["/virtual/root.yaml", ENCODER.encode(ROOT)],
    ["/virtual/house.yaml", ENCODER.encode(HOUSE)],
    ["/virtual/leaf.yaml", ENCODER.encode(LEAF)],
  ]);
}

function optionsFor(files: Map<string, Uint8Array>, extra: Partial<GenerateTypesOptions> = {}): GenerateTypesOptions {
  return { host: new InMemoryHost({ files }), sandboxRoot: "/virtual", ...extra };
}

// --- FR-029: generate() is pure --------------------------------------------

describe("FR-029 — `generate()` takes a tree and returns text, with no I/O and no host", () => {
  it("returns `{ source, diagnostics }` from an accumulated tree alone", () => {
    const origin = createOrigin("s.yaml", "s.yaml");
    const parsed = parse(ENCODER.encode(`keys:\n  a: { demand: { type: string } }\n`), { origin });
    if (!parsed.ok) {
      throw new Error("fixture does not parse");
    }
    const layer: Layer = { identity: { location: "s.yaml", physical: "s.yaml", hash: "0".repeat(64) }, role: "schema", rank: 0, tree: parsed.tree };
    const result = generate(accumulate([layer]).tree);
    expect(typeof result.source).toBe("string");
    expect(result.diagnostics).toEqual([]);
    expect(result.source).toContain("export type Configuration");
  });

  it("`accumulate` and `generate` are exported from the package root, beside `load()`", () => {
    expect(typeof accumulate).toBe("function");
    expect(typeof generate).toBe("function");
  });
});

// --- FR-030: generateTypes() ------------------------------------------------

describe("contract §5 — `generateTypes()` over a three-layer local chain", () => {
  it("returns ok:true with source, tree, and info-only diagnostics", async () => {
    const result = await generateTypes("/virtual/leaf.yaml", optionsFor(chainFiles()));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; "));
    }
    expect(result.diagnostics.every((d) => d.level === "info")).toBe(true);
    const problems = compileInMemory(result.source);
    expect(problems, renderProblems(problems)).toEqual([]);
  });

  it("every document it reached is a SCHEMA layer — the ancestors' demands govern, root to leaf", async () => {
    const result = await generateTypes("/virtual/leaf.yaml", optionsFor(chainFiles()));
    if (!result.ok) {
      throw new Error("expected ok:true");
    }
    // The root demands `name` and requires it; the house narrows `budget`
    // from `int | float` to `int`, which is §17's `bigint`.
    expect(result.source).toContain("readonly name: string;");
    expect(result.source).toContain("readonly budget?: bigint;");
    expect(result.tree.root.keys.has("name")).toBe(true);
  });

  it("D-5 — the ENTRY document's own `keys:` govern the root: it is the leaf schema, not a config", async () => {
    const result = await generateTypes("/virtual/leaf.yaml", optionsFor(chainFiles()));
    if (!result.ok) {
      throw new Error("expected ok:true");
    }
    expect(result.source).toContain("readonly owner?: string;");
  });

  it("reads every document through the host and nothing else", async () => {
    const host = new InMemoryHost({ files: chainFiles() });
    await generateTypes("/virtual/leaf.yaml", { host, sandboxRoot: "/virtual" });
    expect(host.reads).toContain("/virtual/leaf.yaml");
    expect(host.reads).toContain("/virtual/house.yaml");
    expect(host.reads).toContain("/virtual/root.yaml");
  });

  it("a single schema with no `$adopts` at all is a one-layer chain", async () => {
    const files = new Map([["/virtual/only.yaml", ENCODER.encode(ROOT)]]);
    const result = await generateTypes("/virtual/only.yaml", optionsFor(files));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.source).toContain("export type core = {");
  });
});

// --- FR-030: the root's name -------------------------------------------------

describe("FR-031 — the root alias name: the option, else the leaf `$id`'s qualifier, else `Configuration`", () => {
  it("the leaf `$id` qualifier is the default", async () => {
    const result = await generateTypes("/virtual/leaf.yaml", optionsFor(chainFiles()));
    if (!result.ok) {
      throw new Error("expected ok:true");
    }
    expect(result.source).toContain("export type project = {");
  });

  it("the `rootName` option wins over it", async () => {
    const result = await generateTypes("/virtual/leaf.yaml", optionsFor(chainFiles(), { rootName: "ProjectConfig" }));
    if (!result.ok) {
      throw new Error("expected ok:true");
    }
    expect(result.source).toContain("export type ProjectConfig = {");
  });

  it("a leaf with no `$id` falls back to `Configuration`", async () => {
    const files = new Map([["/virtual/bare.yaml", ENCODER.encode(`keys:\n  a: { demand: { type: string } }\n`)]]);
    const result = await generateTypes("/virtual/bare.yaml", optionsFor(files));
    if (!result.ok) {
      throw new Error("expected ok:true");
    }
    expect(result.source).toContain("export type Configuration = {");
  });
});

// --- FR-030: a schema the language refuses -----------------------------------

describe("contract §5 row 2 — a schema the validator refuses is never emitted from", () => {
  it("an unknown demand keyword is ok:false, with the validator's own diagnostic", async () => {
    const files = new Map([["/virtual/bad.yaml", ENCODER.encode(`keys:\n  a: { demand: { type: string, formats: "x" } }\n`)]]);
    const result = await generateTypes("/virtual/bad.yaml", optionsFor(files));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map((d) => d.code)).toEqual(["unknown-demand-keyword"]);
    expect(result.diagnostics[0]?.message).toContain("closed demand keywords");
  });

  it("a malformed type expression is refused before anything is emitted", async () => {
    const files = new Map([["/virtual/bad.yaml", ENCODER.encode(`keys:\n  a: { demand: { type: "string |" } }\n`)]]);
    const result = await generateTypes("/virtual/bad.yaml", optionsFor(files));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map((d) => d.code)).toContain("malformed-type-expression");
  });

  it("an unguarded type cycle is refused here too — v0.5's own refusal, ahead of the accumulated demand (FR-005)", async () => {
    const files = new Map([["/virtual/cyc.yaml", ENCODER.encode(`types:\n  a: { demand: { type: b } }\n  b: { demand: { type: a } }\nkeys:\n  k: { demand: { type: a } }\n`)]]);
    const result = await generateTypes("/virtual/cyc.yaml", optionsFor(files));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map((d) => d.code)).toContain("unresolvable-type-cycle");
  });

  it("a refusal is a diagnostic list and nothing else — never a source beside it", async () => {
    const files = new Map([["/virtual/bad.yaml", ENCODER.encode(`keys:\n  a: { demand: { type: string, formats: "x" } }\n`)]]);
    const result = await generateTypes("/virtual/bad.yaml", optionsFor(files));
    expect("source" in result).toBe(false);
    expect("tree" in result).toBe(false);
  });
});

// --- Article VI: what throws and what does not -------------------------------

describe("contract §5 row 4 / Article VI — a fact about the world is a diagnostic; a missing host is a throw", () => {
  it("a document the host declines is `document-unreachable`, not an exception", async () => {
    const result = await generateTypes("/virtual/missing.yaml", optionsFor(new Map()));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map((d) => d.code)).toEqual(["document-unreachable"]);
  });

  it("an ancestor the host declines is a diagnostic too", async () => {
    const files = new Map([["/virtual/leaf.yaml", ENCODER.encode(LEAF)]]);
    const result = await generateTypes("/virtual/leaf.yaml", optionsFor(files));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.diagnostics.map((d) => d.code)).toContain("document-unreachable");
  });

  it("a missing `host` throws — a programmer error, as it is for `load()`", async () => {
    const options = { sandboxRoot: "/virtual" } as unknown as GenerateTypesOptions;
    await expect(generateTypes("/virtual/leaf.yaml", options)).rejects.toThrow(/requires 'host'/);
  });

  it("a missing `sandboxRoot` throws too", async () => {
    const options = { host: new InMemoryHost({ files: chainFiles() }) } as unknown as GenerateTypesOptions;
    await expect(generateTypes("/virtual/leaf.yaml", options)).rejects.toThrow(/sandboxRoot/);
  });
});

// --- FR-033: load<T>() is untouched -----------------------------------------

describe("FR-033 — `load<T>()` is unchanged; this milestone only makes `T` derivable", () => {
  it("the package root still exports `load` beside the two new functions", async () => {
    const cascata = await import("../../src/index.js");
    expect(typeof cascata.load).toBe("function");
    expect(typeof cascata.generateTypes).toBe("function");
    expect(typeof cascata.accumulate).toBe("function");
    expect(typeof cascata.generate).toBe("function");
  });

  it("`cascata/generate` exports the pure stage on its own", async () => {
    const pure = await import("../../src/generate/index.js");
    expect(typeof pure.accumulate).toBe("function");
    expect(typeof pure.generate).toBe("function");
  });
});
