/**
 * v1.11 FR-002 to FR-004 — `editTarget`: which document, and which pointer inside it, holds the
 * value that won at a merged pointer. The expected answers and every span are derived by hand
 * from the texts in `edit-target-fixture.ts` (the table in specs/020-edit-targets/spec.md).
 */
import { describe, expect, it } from "vitest";
import { editTarget, merge, resolve } from "../../src/index.js";
import { RecordedTransport } from "../corpus/transport.js";
import { yamlWriter } from "../../src/writers.js";
import { InMemoryHost } from "./host-test-double.js";
import { LEVELS, LEVELS_JSON, PROJECT_JSON, ROOT, build, cascade, files } from "./edit-target-fixture.js";

const ENCODER = new TextEncoder();

function refusal(result: ReturnType<typeof editTarget>) {
  if (result.ok) throw new Error(`expected a refusal, got ${JSON.stringify(result)}`);
  expect(result.diagnostics).toHaveLength(1);
  const diagnostic = result.diagnostics[0];
  if (diagnostic === undefined) throw new Error("unreachable");
  expect(diagnostic.level).toBe("error");
  return diagnostic;
}

describe("v1.11 FR-002 — a value some config layer supplied", () => {
  it("/walls/W1/height is project.yaml's, at the same pointer", async () => {
    expect(editTarget(await cascade(), "/walls/W1/height")).toEqual({ ok: true, location: "/virtual/project.yaml", pointer: "/walls/W1/height", format: "yaml", diagnostics: [] });
  });

  it("/walls/W2/height is the override's", async () => {
    expect(editTarget(await cascade(), "/walls/W2/height")).toEqual({ ok: true, location: "/virtual/override.yaml", pointer: "/walls/W2/height", format: "yaml", diagnostics: [] });
  });

  it("a JSON project config answers format json", async () => {
    const configuration = await build("/virtual/project.json", { "/virtual/project.json": PROJECT_JSON }, { overrides: ["./override.yaml"] });
    expect(editTarget(configuration, "/walls/W1/height")).toEqual({ ok: true, location: "/virtual/project.json", pointer: "/walls/W1/height", format: "json", diagnostics: [] });
    expect(editTarget(configuration, "/walls/W2/height")).toEqual({ ok: true, location: "/virtual/override.yaml", pointer: "/walls/W2/height", format: "yaml", diagnostics: [] });
  });

  it("a value from a delegated fragment is in the fragment's file, at the fragment's pointer", async () => {
    expect(editTarget(await cascade(), "/levels/L1/elevation")).toEqual({ ok: true, location: "/virtual/levels.yaml", pointer: "/L1/elevation", format: "yaml", diagnostics: [] });
  });

  it("a JSON fragment under a YAML config answers format json, and the fragment's location, not its graft id", async () => {
    const project = ["$schema: ./root.yaml", "levels: ./levels.json", ""].join("\n");
    const configuration = await build("/virtual/project.yaml", { "/virtual/project.yaml": project, "/virtual/levels.json": LEVELS_JSON });
    expect(editTarget(configuration, "/levels/L1/elevation")).toEqual({ ok: true, location: "/virtual/levels.json", pointer: "/L1/elevation", format: "json", diagnostics: [] });
  });

  it("reads no file", async () => {
    const host = new InMemoryHost({ files: files() });
    const resolved = await resolve("/virtual/project.yaml", { host, sandboxRoot: "/virtual" });
    if (!resolved.ok) throw new Error("resolve");
    const merged = merge(resolved);
    if (!merged.ok) throw new Error("merge");
    const reads = host.reads.length;
    editTarget(merged.configuration, "/walls/W1/height");
    editTarget(merged.configuration, "/walls/nope");
    expect(host.reads).toHaveLength(reads);
  });
});

describe("v1.11 FR-003 — refused: inherited", () => {
  it("/defaults/height is the root schema's provide: edit-target-inherited, naming the schema, at the provided value (bytes 92-95)", async () => {
    const diagnostic = refusal(editTarget(await cascade(), "/defaults/height"));
    expect(diagnostic.code).toBe("edit-target-inherited");
    expect(diagnostic.primary.origin.id).toBe("/virtual/root.yaml");
    expect([diagnostic.primary.start, diagnostic.primary.end]).toEqual([92, 95]);
    expect(diagnostic.message).toContain("/virtual/root.yaml");
    expect(diagnostic.message).toContain("default");
  });

  it("a schema's value read over https is inherited, not remote (the schema is the more useful name)", async () => {
    const transport = new RecordedTransport([{ url: "https://example.test/root.yaml", method: "GET", outcome: { kind: "response", response: { status: 200, headers: {}, body: ENCODER.encode(ROOT) } } }]);
    const entry = ["$schema: https://example.test/root.yaml", "walls:", "  W1:", "    height: 3.2", ""].join("\n");
    const configuration = await build("/virtual/remote-schema.yaml", { "/virtual/remote-schema.yaml": entry }, { transport });
    expect(refusal(editTarget(configuration, "/defaults/height")).code).toBe("edit-target-inherited");
  });
});

describe("v1.11 FR-003 — refused: remote", () => {
  it("a value from a fragment read over https is edit-target-remote, at the value in the fragment (bytes 17-18)", async () => {
    const transport = new RecordedTransport([{ url: "https://example.test/levels.yaml", method: "GET", outcome: { kind: "response", response: { status: 200, headers: {}, body: ENCODER.encode(LEVELS) } } }]);
    const project = ["$schema: ./root.yaml", "levels: https://example.test/levels.yaml", ""].join("\n");
    const configuration = await build("/virtual/project.yaml", { "/virtual/project.yaml": project }, { transport, allowRemoteDelegation: true });
    const diagnostic = refusal(editTarget(configuration, "/levels/L1/elevation"));
    expect(diagnostic.code).toBe("edit-target-remote");
    expect(diagnostic.primary.origin.label).toBe("https://example.test/levels.yaml");
    expect([diagnostic.primary.start, diagnostic.primary.end]).toEqual([17, 18]);
    expect(diagnostic.message).toContain("https://example.test/levels.yaml");
  });
});

describe("v1.11 FR-003 — refused: absent", () => {
  it("/walls/W3/height: edit-target-absent at the nearest existing ancestor, the merged /walls (override.yaml bytes 27-46)", async () => {
    const diagnostic = refusal(editTarget(await cascade(), "/walls/W3/height"));
    expect(diagnostic.code).toBe("edit-target-absent");
    expect(diagnostic.primary.origin.id).toBe("/virtual/override.yaml");
    expect([diagnostic.primary.start, diagnostic.primary.end]).toEqual([27, 46]);
  });

  it("nothing exists below the root: the root's own span (override.yaml bytes 0-46)", async () => {
    const diagnostic = refusal(editTarget(await cascade(), "/nope/x"));
    expect(diagnostic.code).toBe("edit-target-absent");
    expect([diagnostic.primary.start, diagnostic.primary.end]).toEqual([0, 46]);
  });

  it("an item past the end of a list", async () => {
    expect(refusal(editTarget(await cascade(), "/styles/4")).code).toBe("edit-target-absent");
  });
});

describe("v1.11 FR-003 — refused: a container", () => {
  it("/walls/W1, one layer's mapping, is edit-unsupported at its span (project.yaml bytes 88-99)", async () => {
    const diagnostic = refusal(editTarget(await cascade(), "/walls/W1"));
    expect(diagnostic.code).toBe("edit-unsupported");
    expect(diagnostic.primary.origin.id).toBe("/virtual/project.yaml");
    expect([diagnostic.primary.start, diagnostic.primary.end]).toEqual([88, 99]);
  });

  it("/walls, synthesized from two layers, is edit-unsupported", async () => {
    expect(refusal(editTarget(await cascade(), "/walls")).code).toBe("edit-unsupported");
  });

  it("the root is a container", async () => {
    expect(refusal(editTarget(await cascade(), "")).code).toBe("edit-unsupported");
  });

  it("a whole accumulated list is a container (FR-004)", async () => {
    expect(refusal(editTarget(await cascade(), "/styles")).code).toBe("edit-unsupported");
  });
});

describe("v1.11 FR-004 — one item of an accumulated list", () => {
  // The merged list is [house.css, a.css, b.css, c.css].
  it("the schema's own item is inherited (root.yaml bytes 276-285)", async () => {
    const diagnostic = refusal(editTarget(await cascade(), "/styles/0"));
    expect(diagnostic.code).toBe("edit-target-inherited");
    expect([diagnostic.primary.start, diagnostic.primary.end]).toEqual([276, 285]);
  });

  it("items 1 and 2 are project.yaml's items 0 and 1", async () => {
    const configuration = await cascade();
    expect(editTarget(configuration, "/styles/1")).toEqual({ ok: true, location: "/virtual/project.yaml", pointer: "/styles/0", format: "yaml", diagnostics: [] });
    expect(editTarget(configuration, "/styles/2")).toEqual({ ok: true, location: "/virtual/project.yaml", pointer: "/styles/1", format: "yaml", diagnostics: [] });
  });

  it("item 3 is the override's item 0", async () => {
    expect(editTarget(await cascade(), "/styles/3")).toEqual({ ok: true, location: "/virtual/override.yaml", pointer: "/styles/0", format: "yaml", diagnostics: [] });
  });

  it("an item of a list that replaces is the winning layer's, at its own index", async () => {
    const root = ["keys:", "  tags:", "    demand:", "      type: sequence", "    provide:", "      - x", "      - y", ""].join("\n");
    const entry = ["$schema: ./root.yaml", "tags:", "  - p", "  - q", "  - r", ""].join("\n");
    const configuration = await build("/virtual/e.yaml", { "/virtual/root.yaml": root, "/virtual/e.yaml": entry });
    expect(editTarget(configuration, "/tags/2")).toEqual({ ok: true, location: "/virtual/e.yaml", pointer: "/tags/2", format: "yaml", diagnostics: [] });
  });
});

describe("v1.11 FR-004 — a scalar wrapped into a list (v1.8)", () => {
  it("project.yaml's `styles: only.css` is the list's item 1 and the document's /styles — the scalar itself", async () => {
    const project = ["$schema: ./root.yaml", "styles: only.css", ""].join("\n");
    const configuration = await build("/virtual/project.yaml", { "/virtual/project.yaml": project });
    expect(editTarget(configuration, "/styles/1")).toEqual({ ok: true, location: "/virtual/project.yaml", pointer: "/styles", format: "yaml", diagnostics: [] });
  });
});

describe("v1.11 FR-002 — a fragment an override delegated to", () => {
  it("is the fragment's file, at the fragment's pointer", async () => {
    const override = ["levels: ./more.yaml", ""].join("\n");
    const configuration = await build("/virtual/project.yaml", { "/virtual/over2.yaml": override, "/virtual/more.yaml": "L9:\n  elevation: 9\n", "/virtual/project.yaml": "$schema: ./root.yaml\n" }, { overrides: ["./over2.yaml"] });
    expect(editTarget(configuration, "/levels/L9/elevation")).toEqual({ ok: true, location: "/virtual/more.yaml", pointer: "/L9/elevation", format: "yaml", diagnostics: [] });
  });
});

describe("v1.11 FR-003 — an override read over https", () => {
  it("is edit-target-remote", async () => {
    const transport = new RecordedTransport([{ url: "https://example.test/over.yaml", method: "GET", outcome: { kind: "response", response: { status: 200, headers: {}, body: ENCODER.encode("walls:\n  W9:\n    height: 1.5\n") } } }]);
    const configuration = await build("/virtual/project.yaml", {}, { transport, overrides: ["https://example.test/over.yaml"] });
    expect(refusal(editTarget(configuration, "/walls/W9/height")).code).toBe("edit-target-remote");
  });
});

describe("v1.11 FR-002 — a value overriding a schema's", () => {
  it("a config value over a provided one targets the config: the schema's value lost", async () => {
    const root = ["keys:", "  title:", "    demand:", "      type: string", "    provide: Untitled", ""].join("\n");
    const entry = ["$schema: ./root.yaml", "title: Mine", ""].join("\n");
    const configuration = await build("/virtual/e.yaml", { "/virtual/root.yaml": root, "/virtual/e.yaml": entry });
    expect(editTarget(configuration, "/title")).toEqual({ ok: true, location: "/virtual/e.yaml", pointer: "/title", format: "yaml", diagnostics: [] });
  });
});

describe("v1.11 FR-003 — refused: shared (round 2: refuse rather than guess)", () => {
  // Alias and merge-key copies keep the anchor's span, so a value that has copies cannot be told from them.
  // "a: &x 1\nb: *x\n": the `1` is bytes 6-7, and both nodes carry it. Writing either changes the other.
  it("an anchored value and its alias are both shared: /a and /b, positioned at the value (bytes 6-7)", async () => {
    const configuration = await build("/virtual/e.yaml", { "/virtual/e.yaml": "a: &x 1\nb: *x\n" });
    for (const pointer of ["/a", "/b"]) {
      const diagnostic = refusal(editTarget(configuration, pointer));
      expect(diagnostic.code, pointer).toBe("edit-target-shared");
      expect([diagnostic.primary.start, diagnostic.primary.end], pointer).toEqual([6, 7]);
    }
  });

  // "base: &b\n  k: 1\nw:\n  <<: *b\n": the first line is 8 bytes and a newline, so the `1` is at 9 (spaces), 11 (k), 12 (colon), 13 (space), 14: bytes 14-15.
  it("a merge-key copy and its source are both shared: /w/k and /base/k (bytes 14-15)", async () => {
    const configuration = await build("/virtual/e.yaml", { "/virtual/e.yaml": "base: &b\n  k: 1\nw:\n  <<: *b\n" });
    for (const pointer of ["/w/k", "/base/k"]) {
      const diagnostic = refusal(editTarget(configuration, pointer));
      expect(diagnostic.code, pointer).toBe("edit-target-shared");
      expect([diagnostic.primary.start, diagnostic.primary.end], pointer).toEqual([14, 15]);
    }
  });

  it("an alias inside a delegated fragment is shared too", async () => {
    const configuration = await build("/virtual/project.yaml", { "/virtual/project.yaml": "$schema: ./root.yaml\nlevels: ./levels.yaml\n", "/virtual/levels.yaml": "a: &x 1\nb: *x\n" });
    expect(refusal(editTarget(configuration, "/levels/b")).code).toBe("edit-target-shared");
    expect(refusal(editTarget(configuration, "/levels/a")).code).toBe("edit-target-shared");
  });

  it("controls: a key that overrides a merged one is the document's own, and an anchor nothing aliases is not shared", async () => {
    const merged = await build("/virtual/e.yaml", { "/virtual/e.yaml": "base: &b\n  k: 1\nw:\n  <<: *b\n  k: 2\n" });
    expect(editTarget(merged, "/w/k")).toEqual({ ok: true, location: "/virtual/e.yaml", pointer: "/w/k", format: "yaml", diagnostics: [] });
    const lone = await build("/virtual/e.yaml", { "/virtual/e.yaml": "a: &x 1\nb: 2\n" });
    expect(editTarget(lone, "/a")).toEqual({ ok: true, location: "/virtual/e.yaml", pointer: "/a", format: "yaml", diagnostics: [] });
  });
});

describe("v1.12.1 — editTarget answers where; only the writer answers whether", () => {
  // Each refusal is visible only in the document's bytes, or depends on the value: editTarget sees neither, so it answers ok.
  const rows = [
    { name: "a block scalar", text: "note: |\n  hi\n", pointer: "/note", value: "x", reason: /block scalar/ },
    { name: "a key with no value in a flow mapping", text: "m: {a}\n", pointer: "/m/a", value: "x", reason: /flow collection/ },
    { name: "a tag off the value's line that cannot hold the value", text: "a: !!int\n  4\n", pointer: "/a", value: "x", reason: /explicit tag/ },
  ];
  for (const row of rows) {
    it(`${row.name}: editTarget is ok, the writer refuses`, async () => {
      const configuration = await build("/virtual/e.yaml", { "/virtual/e.yaml": row.text });
      const target = editTarget(configuration, row.pointer);
      expect(target).toEqual({ ok: true, location: "/virtual/e.yaml", pointer: row.pointer, format: "yaml", diagnostics: [] });
      const written = yamlWriter().write(ENCODER.encode(row.text), row.pointer, row.value);
      expect(written.ok).toBe(false);
      if (!written.ok) expect(written.reason).toMatch(row.reason);
    });
  }
});

describe("v1.11 FR-002 — programmer error", () => {
  it("a pointer that is neither empty nor starts with / throws, as why() does", async () => {
    expect(() => editTarget(cascadeSync, "walls")).toThrow();
  });
});

const cascadeSync = await cascade();
