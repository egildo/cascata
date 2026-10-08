/**
 * v1.11 FR-002 to FR-004 — `editTarget`: which document, and which pointer inside it, holds the
 * value that won at a merged pointer. The expected answers and every span are derived by hand
 * from the texts in `edit-target-fixture.ts` (the table in specs/020-edit-targets/spec.md).
 */
import { describe, expect, it } from "vitest";
import { editTarget, merge, resolve } from "../../src/index.js";
import { RecordedTransport } from "../corpus/transport.js";
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
    expect(editTarget(await cascade(), "/walls/W1/height")).toEqual({ ok: true, location: "/virtual/project.yaml", pointer: "/walls/W1/height", format: "yaml" });
  });

  it("/walls/W2/height is the override's", async () => {
    expect(editTarget(await cascade(), "/walls/W2/height")).toEqual({ ok: true, location: "/virtual/override.yaml", pointer: "/walls/W2/height", format: "yaml" });
  });

  it("a JSON project config answers format json", async () => {
    const configuration = await build("/virtual/project.json", { "/virtual/project.json": PROJECT_JSON }, { overrides: ["./override.yaml"] });
    expect(editTarget(configuration, "/walls/W1/height")).toEqual({ ok: true, location: "/virtual/project.json", pointer: "/walls/W1/height", format: "json" });
    expect(editTarget(configuration, "/walls/W2/height")).toEqual({ ok: true, location: "/virtual/override.yaml", pointer: "/walls/W2/height", format: "yaml" });
  });

  it("a value from a delegated fragment is in the fragment's file, at the fragment's pointer", async () => {
    expect(editTarget(await cascade(), "/levels/L1/elevation")).toEqual({ ok: true, location: "/virtual/levels.yaml", pointer: "/L1/elevation", format: "yaml" });
  });

  it("a JSON fragment under a YAML config answers format json, and the fragment's location, not its graft id", async () => {
    const project = ["$schema: ./root.yaml", "levels: ./levels.json", ""].join("\n");
    const configuration = await build("/virtual/project.yaml", { "/virtual/project.yaml": project, "/virtual/levels.json": LEVELS_JSON });
    expect(editTarget(configuration, "/levels/L1/elevation")).toEqual({ ok: true, location: "/virtual/levels.json", pointer: "/L1/elevation", format: "json" });
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
    expect(editTarget(configuration, "/styles/1")).toEqual({ ok: true, location: "/virtual/project.yaml", pointer: "/styles/0", format: "yaml" });
    expect(editTarget(configuration, "/styles/2")).toEqual({ ok: true, location: "/virtual/project.yaml", pointer: "/styles/1", format: "yaml" });
  });

  it("item 3 is the override's item 0", async () => {
    expect(editTarget(await cascade(), "/styles/3")).toEqual({ ok: true, location: "/virtual/override.yaml", pointer: "/styles/0", format: "yaml" });
  });

  it("an item of a list that replaces is the winning layer's, at its own index", async () => {
    const root = ["keys:", "  tags:", "    demand:", "      type: sequence", "    provide:", "      - x", "      - y", ""].join("\n");
    const entry = ["$schema: ./root.yaml", "tags:", "  - p", "  - q", "  - r", ""].join("\n");
    const configuration = await build("/virtual/e.yaml", { "/virtual/root.yaml": root, "/virtual/e.yaml": entry });
    expect(editTarget(configuration, "/tags/2")).toEqual({ ok: true, location: "/virtual/e.yaml", pointer: "/tags/2", format: "yaml" });
  });
});

describe("v1.11 FR-002 — a value overriding a schema's", () => {
  it("a config value over a provided one targets the config: the schema's value lost", async () => {
    const root = ["keys:", "  title:", "    demand:", "      type: string", "    provide: Untitled", ""].join("\n");
    const entry = ["$schema: ./root.yaml", "title: Mine", ""].join("\n");
    const configuration = await build("/virtual/e.yaml", { "/virtual/root.yaml": root, "/virtual/e.yaml": entry });
    expect(editTarget(configuration, "/title")).toEqual({ ok: true, location: "/virtual/e.yaml", pointer: "/title", format: "yaml" });
  });
});

describe("v1.11 FR-002 — aliases", () => {
  it("/b, an alias of /a, is /b in its own document", async () => {
    const configuration = await build("/virtual/e.yaml", { "/virtual/e.yaml": "a: &x 1\nb: *x\n" });
    expect(editTarget(configuration, "/b")).toEqual({ ok: true, location: "/virtual/e.yaml", pointer: "/b", format: "yaml" });
  });
});

describe("v1.11 FR-002 — programmer error", () => {
  it("a pointer that is neither empty nor starts with / throws, as why() does", async () => {
    expect(() => editTarget(cascadeSync, "walls")).toThrow();
  });
});

const cascadeSync = await cascade();
