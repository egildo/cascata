/**
 * v1.11 FR-001 — `why()` entries carry `pointer`: the RFC 6901 pointer of the entry's value inside
 * its own document. Every expected value is counted by hand from the texts in
 * `edit-target-fixture.ts`; none is copied from a run.
 */
import { describe, expect, it } from "vitest";
import { why } from "../../src/index.js";
import { InMemoryHost } from "./host-test-double.js";
import { build, cascade, files } from "./edit-target-fixture.js";
import { merge, resolve } from "../../src/index.js";

async function entriesAt(configuration: Awaited<ReturnType<typeof cascade>>, pointer: string) {
  const answer = why(configuration, pointer);
  if (answer.kind === "unknown-pointer") throw new Error(`unknown pointer ${pointer}`);
  return answer.kind === "chain" ? answer.entries : answer.contributors;
}

describe("v1.11 FR-001 — a config layer's value", () => {
  it("/walls/W1/height is at its own pointer in project.yaml, bytes 96-99", async () => {
    const entries = await entriesAt(await cascade(), "/walls/W1/height");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.pointer).toBe("/walls/W1/height");
    expect(entries[0]?.span.origin.id).toBe("/virtual/project.yaml");
    expect([entries[0]?.span.start, entries[0]?.span.end]).toEqual([96, 99]);
  });

  it("an override's value is at its own pointer in override.yaml, bytes 43-46", async () => {
    const entries = await entriesAt(await cascade(), "/walls/W2/height");
    expect(entries[0]?.pointer).toBe("/walls/W2/height");
    expect(entries[0]?.span.origin.id).toBe("/virtual/override.yaml");
    expect([entries[0]?.span.start, entries[0]?.span.end]).toEqual([43, 46]);
  });
});

describe("v1.11 FR-001 — a value grafted from a delegated fragment", () => {
  it("/levels/L1/elevation is /L1/elevation inside levels.yaml, not /levels/L1/elevation", async () => {
    const entries = await entriesAt(await cascade(), "/levels/L1/elevation");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.pointer).toBe("/L1/elevation");
    expect(entries[0]?.span.origin.id).toBe("/virtual/levels.yaml #graft=1");
    expect(entries[0]?.span.origin.label).toBe("/virtual/levels.yaml");
    expect(entries[0]?.delegatedFrom).toBeDefined();
    expect(entries[0]?.layer.role).toBe("config");
  });

  it("the delegating key itself is the fragment's root: pointer empty", async () => {
    const entries = await entriesAt(await cascade(), "/levels");
    expect(entries[0]?.pointer).toBe("");
  });
});

describe("v1.11 FR-001 — a schema's provide", () => {
  it("/defaults/height is the provided value's place inside the schema document", async () => {
    const entries = await entriesAt(await cascade(), "/defaults/height");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.layer.role).toBe("schema");
    expect(entries[0]?.span.origin.id).toBe("/virtual/root.yaml");
    expect(entries[0]?.pointer).toBe("/keys/defaults/provide/height");
  });

  it("a container provided by a schema is the provide mapping itself", async () => {
    const entries = await entriesAt(await cascade(), "/defaults");
    expect(entries[0]?.pointer).toBe("/keys/defaults/provide");
  });
});

describe("v1.11 FR-001 — a synthesized container", () => {
  it("/walls names each contributor with the pointer of the value it supplied", async () => {
    const entries = await entriesAt(await cascade(), "/walls");
    expect(entries.map((entry) => [entry.span.origin.id, entry.pointer])).toEqual([
      ["/virtual/project.yaml", "/walls/W1"],
      ["/virtual/override.yaml", "/walls/W2"],
    ]);
  });
});

describe("v1.11 FR-001 — an accumulated list", () => {
  it("each contribution is at its own pointer, root first, whatever its place in the merged list", async () => {
    const entries = await entriesAt(await cascade(), "/styles");
    expect(entries.map((entry) => [entry.span.origin.id, entry.outcome, entry.pointer])).toEqual([
      ["/virtual/root.yaml", "accumulated", "/keys/styles/provide"],
      ["/virtual/project.yaml", "accumulated", "/styles"],
      ["/virtual/override.yaml", "accumulated", "/styles"],
    ]);
  });

  it("an item below the list answers the list's entries, with the list's pointers", async () => {
    const entries = await entriesAt(await cascade(), "/styles/2");
    expect(entries.map((entry) => entry.pointer)).toEqual(["/keys/styles/provide", "/styles", "/styles"]);
  });
});

describe("v1.11 FR-001 — an overridden contribution keeps its own pointer", () => {
  it("project.yaml's /walls/W1/height loses nothing; a replaced title shows both pointers", async () => {
    const root = ["keys:", "  title:", "    demand:", "      type: string", "    provide: Untitled", ""].join("\n");
    const entry = ["$schema: ./root.yaml", "title: Mine", ""].join("\n");
    const configuration = await build("/virtual/e.yaml", { "/virtual/root.yaml": root, "/virtual/e.yaml": entry });
    const entries = await entriesAt(configuration, "/title");
    expect(entries.map((e) => [e.outcome, e.span.origin.id, e.pointer])).toEqual([
      ["won", "/virtual/e.yaml", "/title"],
      ["overridden", "/virtual/root.yaml", "/keys/title/provide"],
    ]);
  });
});

describe("v1.11 FR-001 — escaping", () => {
  it("a key with a slash and a key with a tilde are escaped in the document's own pointer", async () => {
    const configuration = await build("/virtual/e.yaml", { "/virtual/e.yaml": ["a/b:", "  c~d: 1", ""].join("\n") });
    const entries = await entriesAt(configuration, "/a~1b/c~0d");
    expect(entries[0]?.pointer).toBe("/a~1b/c~0d");
  });
});

describe("v1.11 FR-001 — aliases give two nodes one span; the pointer asked about breaks the tie", () => {
  // "a: &x 1\nb: *x\n" — both values carry the anchor's span, bytes 6-7 (§4.2: positions attribute to the anchor's content).
  it("/b is /b, and /a is /a", async () => {
    const configuration = await build("/virtual/e.yaml", { "/virtual/e.yaml": "a: &x 1\nb: *x\n" });
    const a = await entriesAt(configuration, "/a");
    const b = await entriesAt(configuration, "/b");
    expect([a[0]?.span.start, a[0]?.span.end, b[0]?.span.start, b[0]?.span.end]).toEqual([6, 7, 6, 7]);
    expect(a[0]?.pointer).toBe("/a");
    expect(b[0]?.pointer).toBe("/b");
  });
});

describe("v1.11 FR-001 — a JSON document", () => {
  it("answers the same way", async () => {
    const configuration = await build("/virtual/project.json", { "/virtual/project.json": '{\n  "$schema": "./root.yaml",\n  "walls": {\n    "W1": {\n      "height": 3.2\n    }\n  }\n}\n' });
    const entries = await entriesAt(configuration, "/walls/W1/height");
    expect(entries[0]?.pointer).toBe("/walls/W1/height");
    expect(entries[0]?.span.origin.id).toBe("/virtual/project.json");
  });
});

describe("v1.11 FR-001 — a fragment in another format", () => {
  it("a JSON fragment under a YAML config", async () => {
    const project = ["$schema: ./root.yaml", "levels: ./levels.json", ""].join("\n");
    const resolved = await resolve("/virtual/project.yaml", { host: new InMemoryHost({ files: files({ "/virtual/project.yaml": project, "/virtual/levels.json": '{\n  "L1": {\n    "elevation": 0\n  }\n}\n' }) }), sandboxRoot: "/virtual" });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const merged = merge(resolved);
    if (!merged.ok) throw new Error("merge");
    const entries = await entriesAt(merged.configuration, "/levels/L1/elevation");
    expect(entries[0]?.pointer).toBe("/L1/elevation");
    expect(entries[0]?.span.origin.label).toBe("/virtual/levels.json");
  });
});
