/**
 * v1.3 (012) FR-001 through FR-004 — the launching schema, through the one
 * call. The resolve-conformance corpus (`tests/corpus/resolve-cases/
 * launching-schema-*.json`) pins the graph and the pedigree; this file
 * pins what an **embedder** sees at `load()`: the root's `provide`
 * arriving in the value, an authored `$schema` leaving the option unread,
 * and an unreachable launching schema refused as data.
 *
 * In-memory host throughout (v0.7's `InMemoryHost`), so `host.reads` is
 * the record of what was and was not asked for.
 */
import { describe, expect, it } from "vitest";
import { generateTypes, load } from "../../src/index.js";
import { InMemoryHost } from "./host-test-double.js";

const ENCODER = new TextEncoder();

const ROOT = ENCODER.encode("$id: launching/root\nkeys:\n  title:\n    demand:\n      type: string\n    provide: Untitled\n");
const OTHER = ENCODER.encode("$id: launching/other\nkeys:\n  title:\n    demand:\n      type: string\n    provide: Other\n");
const SILENT_ENTRY = ENCODER.encode("name: standalone\n");
const AUTHORED_ENTRY = ENCODER.encode("$schema: ./other.yaml\nname: standalone\n");

function files(): Map<string, Uint8Array> {
  return new Map([
    ["/virtual/doc.yaml", SILENT_ENTRY],
    ["/virtual/authored.yaml", AUTHORED_ENTRY],
    ["/virtual/root.yaml", ROOT],
    ["/virtual/other.yaml", OTHER],
  ]);
}

describe("v1.3 FR-001 — an entry naming no $schema is governed by the launching schema", () => {
  it("the root's provide reaches the value, and the root was read through the host", async () => {
    const host = new InMemoryHost({ files: files() });
    const result = await load<{ readonly title: string; readonly name: string }>("/virtual/doc.yaml", { host, sandboxRoot: "/virtual", schema: "./root.yaml" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.title).toBe("Untitled");
    expect(result.value.name).toBe("standalone");
    expect(host.reads).toContain("/virtual/root.yaml");
  });

  it("without the option, the same entry is what it always was: a single document, no provide", async () => {
    const host = new InMemoryHost({ files: files() });
    const result = await load<{ readonly title?: string }>("/virtual/doc.yaml", { host, sandboxRoot: "/virtual" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.title).toBeUndefined();
    expect(host.reads).not.toContain("/virtual/root.yaml");
  });
});

describe("v1.3 FR-002 — an authored $schema wins, and the launching schema is never read", () => {
  it("the authored chain governs and the option's document is not asked for", async () => {
    const host = new InMemoryHost({ files: files() });
    const result = await load<{ readonly title: string }>("/virtual/authored.yaml", { host, sandboxRoot: "/virtual", schema: "./root.yaml" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.title).toBe("Other");
    expect(host.reads).toContain("/virtual/other.yaml");
    expect(host.reads).not.toContain("/virtual/root.yaml");
  });
});

describe("v1.3 FR-004 — a launching schema that cannot be read is a refusal, anchored at the entry", () => {
  it("document-unreachable, primary span in the entry document at 1:1, and nothing thrown", async () => {
    const host = new InMemoryHost({ files: files() });
    const result = await load("/virtual/doc.yaml", { host, sandboxRoot: "/virtual", schema: "./missing.yaml" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.code).toBe("document-unreachable");
    expect(diagnostic?.level).toBe("error");
    expect(diagnostic?.primary.origin.id).toBe("/virtual/doc.yaml");
    expect(diagnostic?.primary.line).toBe(1);
    expect(diagnostic?.primary.column).toBe(1);
  });
});

describe("v1.3 — generateTypes() ignores the option: a schema entry with no $adopts is the chain's root", () => {
  it("emits the root's own type whether or not `schema` is passed", async () => {
    const host = new InMemoryHost({ files: files() });
    const without = await generateTypes("/virtual/root.yaml", { host, sandboxRoot: "/virtual" });
    const withOption = await generateTypes("/virtual/root.yaml", { host, sandboxRoot: "/virtual", schema: "./other.yaml" });
    expect(without.ok).toBe(true);
    expect(withOption.ok).toBe(true);
    if (!without.ok || !withOption.ok) return;
    expect(withOption.source).toBe(without.source);
    expect(host.reads).not.toContain("/virtual/other.yaml");
  });
});
