/**
 * v1.6 (014) FR-001 through FR-010 — overrides, through the one call. The
 * resolve-conformance corpus (`tests/corpus/resolve-cases/overrides-*.json`)
 * pins the graph, the order and the two refusals at resolution; this file
 * pins what an **embedder** sees at `load()`: the override's value winning,
 * a later override outranking an earlier one, a demand and a `final`
 * refusing an override's value at the override's own span, `append`
 * accumulating, `why()` naming the override's layer, delegation from
 * inside an override, and `generateTypes()` ignoring the option.
 *
 * In-memory host throughout, so `host.reads` is the record of what was
 * asked for and in which order.
 */
import { describe, expect, it } from "vitest";
import { generateTypes, load, why } from "../../src/index.js";
import { InMemoryHost } from "./host-test-double.js";

const ENCODER = new TextEncoder();

const ROOT = ENCODER.encode(
  [
    "$id: overrides/root",
    "keys:",
    "  title:",
    "    demand:",
    "      type: string",
    "    provide: Untitled",
    "  styles:",
    "    demand:",
    "      type: sequence",
    "      items:",
    "        type: string",
    "    cascade: append",
    "  depth:",
    "    demand:",
    "      type: int",
    "      max: 3",
    "  secret:",
    "    demand:",
    "      type: string",
    "    provide: sealed",
    "    final: true",
    "  params:",
    "    demand:",
    "      type: mapping",
    "      values:",
    "        type: string",
    "    delegate: allow",
    "",
  ].join("\n"),
);
const ENTRY = ENCODER.encode("$schema: ./root.yaml\ntitle: Authored\nstyles:\n  - a.css\n");
const OVER_A = ENCODER.encode("title: Overridden\nstyles:\n  - b.css\n");
const OVER_B = ENCODER.encode("title: Second\ndepth: 2\n");
const TOO_DEEP = ENCODER.encode("depth: 9\n");
const SETS_FINAL = ENCODER.encode("secret: mine\n");
const RESERVED = ENCODER.encode("$schema: ./root.yaml\ntitle: Nope\n");
const DELEGATING = ENCODER.encode("params: ./frag.yaml\n");
const FRAGMENT = ENCODER.encode("name: fragment\n");

function files(): Map<string, Uint8Array> {
  return new Map([
    ["/virtual/doc.yaml", ENTRY],
    ["/virtual/root.yaml", ROOT],
    ["/virtual/over-a.yaml", OVER_A],
    ["/virtual/over-b.yaml", OVER_B],
    ["/virtual/too-deep.yaml", TOO_DEEP],
    ["/virtual/sets-final.yaml", SETS_FINAL],
    ["/virtual/reserved.yaml", RESERVED],
    ["/virtual/cli/delegating.yaml", DELEGATING],
    ["/virtual/cli/frag.yaml", FRAGMENT],
  ]);
}

interface Config {
  readonly title: string;
  readonly styles: readonly string[];
  readonly depth?: bigint;
  readonly secret: string;
  readonly params?: { readonly name: string };
}

async function loadWith(host: InMemoryHost, overrides: readonly string[] | undefined) {
  return load<Config>("/virtual/doc.yaml", { host, sandboxRoot: "/virtual", ...(overrides === undefined ? {} : { overrides }) });
}

describe("v1.6 FR-001 — an override is one more config layer, read after the entry's chain", () => {
  it("the override's value wins over the entry's, and it was read after the chain", async () => {
    const host = new InMemoryHost({ files: files() });
    const result = await loadWith(host, ["./over-a.yaml"]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.title).toBe("Overridden");
    expect(result.value.secret).toBe("sealed");
    expect(host.reads.indexOf("/virtual/over-a.yaml")).toBeGreaterThan(host.reads.indexOf("/virtual/root.yaml"));
  });

  it("without the option, the same entry is what it always was, and no override is asked for", async () => {
    const host = new InMemoryHost({ files: files() });
    const result = await loadWith(host, undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.title).toBe("Authored");
    expect(result.value.styles).toEqual(["a.css"]);
    expect(host.reads).not.toContain("/virtual/over-a.yaml");
    expect(result.configuration.layers).toHaveLength(2);
  });

  it("an empty list is the same as no option", async () => {
    const host = new InMemoryHost({ files: files() });
    const result = await loadWith(host, []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.title).toBe("Authored");
    expect(result.configuration.layers).toHaveLength(2);
  });
});

describe("v1.6 FR-002 — a later override outranks an earlier one, and both outrank the entry", () => {
  it("in the order given", async () => {
    const result = await loadWith(new InMemoryHost({ files: files() }), ["./over-a.yaml", "./over-b.yaml"]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.title).toBe("Second");
    expect(result.value.depth).toBe(2n);
  });

  it("reversed, the answer reverses", async () => {
    const result = await loadWith(new InMemoryHost({ files: files() }), ["./over-b.yaml", "./over-a.yaml"]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.title).toBe("Overridden");
    expect(result.value.depth).toBe(2n);
  });
});

describe("v1.6 FR-003 — an override is governed by every demand the pedigree accumulated", () => {
  it("a demand refuses the override's value, primary at the override's own span", async () => {
    const result = await loadWith(new InMemoryHost({ files: files() }), ["./too-deep.yaml"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.code).toBe("range-violated");
    expect(diagnostic?.level).toBe("error");
    expect(diagnostic?.primary.origin.id).toBe("/virtual/too-deep.yaml");
    expect(diagnostic?.primary.line).toBe(1);
    expect(diagnostic?.primary.column).toBe(8);
  });

  it("a key sealed final with provide is refused when an override sets it", async () => {
    const result = await loadWith(new InMemoryHost({ files: files() }), ["./sets-final.yaml"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.code)).toEqual(["final-key-set"]);
    expect(result.diagnostics[0]?.primary.origin.id).toBe("/virtual/sets-final.yaml");
  });
});

describe("v1.6 FR-004 — a key under cascade: append accumulates the overrides' items after the entry's", () => {
  it("entry first, then each override in rank order", async () => {
    const result = await loadWith(new InMemoryHost({ files: files() }), ["./over-a.yaml", "./over-b.yaml"]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.styles).toEqual(["a.css", "b.css"]);
  });
});

describe("v1.6 FR-005 — an override carries no $-prefixed key", () => {
  it("override-reserved-key, primary at the key's value, and the pedigree stays the entry's", async () => {
    const result = await loadWith(new InMemoryHost({ files: files() }), ["./reserved.yaml"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.code).toBe("override-reserved-key");
    expect(diagnostic?.level).toBe("error");
    expect(diagnostic?.primary.origin.id).toBe("/virtual/reserved.yaml");
    expect(diagnostic?.primary.line).toBe(1);
    expect(diagnostic?.primary.column).toBe(10);
  });
});

describe("v1.6 FR-006 — why() names the override's layer", () => {
  it("role config, its own identity, the highest rank; the entry's value recorded as overridden", async () => {
    const result = await loadWith(new InMemoryHost({ files: files() }), ["./over-a.yaml"]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const answer = why(result.configuration, "/title");
    expect(answer.kind).toBe("chain");
    if (answer.kind !== "chain") return;
    const won = answer.entries.find((entry) => entry.outcome === "won");
    expect(won?.layer.role).toBe("config");
    expect(won?.layer.identity.location).toBe("/virtual/over-a.yaml");
    expect(won?.layer.rank).toBe(result.configuration.layers.length - 1);
    expect(won?.span.line).toBe(1);
    const lost = answer.entries.find((entry) => entry.layer.identity.location === "/virtual/doc.yaml");
    expect(lost?.outcome).toBe("overridden");
  });
});

describe("v1.6 FR-007 — an override may be named in a scheme the host owns", () => {
  it("located through the host, read at the answered location", async () => {
    const host = new InMemoryHost({ files: files(), identities: new Map([["beltype:cli", "/virtual/over-a.yaml"]]) });
    const result = await loadWith(host, ["beltype:cli"]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.title).toBe("Overridden");
    expect(host.locates).toContain("beltype:cli");
    expect(host.reads).toContain("/virtual/over-a.yaml");
  });

  it("a scheme no host claims is unsupported-scheme at the entry's phantom span", async () => {
    const result = await loadWith(new InMemoryHost({ files: files() }), ["beltype:cli"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.code)).toEqual(["unsupported-scheme"]);
    expect(result.diagnostics[0]?.primary.origin.id).toBe("/virtual/doc.yaml");
    expect(result.diagnostics[0]?.primary.line).toBe(1);
    expect(result.diagnostics[0]?.primary.column).toBe(1);
  });
});

describe("v1.6 FR-008 — an override that cannot be read is a refusal, anchored at the entry", () => {
  it("document-unreachable, primary in the entry document at 1:1, nothing thrown", async () => {
    const result = await loadWith(new InMemoryHost({ files: files() }), ["./missing.yaml"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("document-unreachable");
    expect(result.diagnostics[0]?.primary.origin.id).toBe("/virtual/doc.yaml");
    expect(result.diagnostics[0]?.primary.line).toBe(1);
    expect(result.diagnostics[0]?.primary.column).toBe(1);
  });
});

describe("v1.6 FR-009 — a granted key delegates from inside an override, relative to the override", () => {
  it("the fragment's values arrive, and why() carries the breadcrumb", async () => {
    const host = new InMemoryHost({ files: files() });
    const result = await loadWith(host, ["./cli/delegating.yaml"]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.params?.name).toBe("fragment");
    expect(host.reads).toContain("/virtual/cli/frag.yaml");
    const answer = why(result.configuration, "/params/name");
    expect(answer.kind).toBe("chain");
    if (answer.kind !== "chain") return;
    expect(answer.entries[0]?.delegatedFrom?.length).toBeGreaterThan(0);
  });
});

describe("v1.6 FR-010 — overrides are layers, not graph nodes", () => {
  it("two overrides with identical bytes are two layers", async () => {
    const files2 = files();
    files2.set("/virtual/twin.yaml", OVER_A);
    const result = await loadWith(new InMemoryHost({ files: files2 }), ["./over-a.yaml", "./twin.yaml"]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.configuration.layers).toHaveLength(4);
    expect(result.value.styles).toEqual(["a.css", "b.css", "b.css"]);
  });

  it("generateTypes() ignores the option", async () => {
    const host = new InMemoryHost({ files: files() });
    const result = await generateTypes("/virtual/root.yaml", { host, sandboxRoot: "/virtual", overrides: ["./missing.yaml"] });
    expect(result.ok).toBe(true);
    expect(host.reads).not.toContain("/virtual/missing.yaml");
  });
});
