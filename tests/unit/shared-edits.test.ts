/**
 * v1.12 FR-005 to FR-008 — `sharedEdits`, and a file grafted twice is shared.
 *
 * The graft fixture is the spec's (specs/022-after-the-review, "The graft fixture"); every span is
 * counted by hand from the texts below, never from a run:
 *
 *   project.yaml  `$schema: ./root.yaml` is bytes 0-19 and its line break 20; `levels: ` starts at 21,
 *                 so `./levels.yaml` (13 bytes) is 29-42; `other: ` starts at 43, its value 50-63;
 *                 `third: ` starts at 64, `./third.yaml` (12 bytes) 71-83.
 *   levels.yaml   `L1:\n  elevation: 0\n` — L0 1 :2 LF3, two spaces 4-5, `elevation` 6-14, :15 sp16, `0` 17-18.
 *   third.yaml    `T1:\n  x: 5\n` — `5` is 9-10.
 */
import { describe, expect, it } from "vitest";
import { editTarget, setValue, type EditTargetResult, type MergedConfiguration } from "../../src/index.js";
import { jsonWriter, yamlWriter } from "../../src/writers.js";
import { build, cascade } from "./edit-target-fixture.js";

const ENCODER = new TextEncoder();
const ROOT = ["keys:", ...["levels", "other", "third"].flatMap((key) => [`  ${key}:`, "    demand:", "      type: mapping", "    delegate: allow"]), ""].join("\n");
const PROJECT = ["$schema: ./root.yaml", "levels: ./levels.yaml", "other: ./levels.yaml", "third: ./third.yaml", ""].join("\n");
const LEVELS = "L1:\n  elevation: 0\n";
const THIRD = "T1:\n  x: 5\n";

function grafted(): Promise<MergedConfiguration> {
  return build("/virtual/project.yaml", { "/virtual/root.yaml": ROOT, "/virtual/project.yaml": PROJECT, "/virtual/levels.yaml": LEVELS, "/virtual/third.yaml": THIRD });
}

const bytesOf = (span: { origin: { label: string }; start: number; end: number }) => [span.origin.label, span.start, span.end];

function only(result: EditTargetResult) {
  expect(result.diagnostics).toHaveLength(1);
  const diagnostic = result.diagnostics[0];
  if (diagnostic === undefined) throw new Error("unreachable");
  expect(diagnostic.code).toBe("edit-target-shared");
  return diagnostic;
}

describe("v1.12 FR-006 — a file grafted at two places is shared", () => {
  it("/levels/L1/elevation under refuse: edit-target-shared at the value, related naming other's delegating value (50-63)", async () => {
    const result = editTarget(await grafted(), "/levels/L1/elevation");
    expect(result.ok).toBe(false);
    const diagnostic = only(result);
    expect(diagnostic.level).toBe("error");
    expect(bytesOf(diagnostic.primary)).toEqual(["/virtual/levels.yaml", 17, 18]);
    expect(diagnostic.related.map((r) => bytesOf(r.span))).toEqual([["/virtual/project.yaml", 50, 63]]);
    // The message names each grafting place: project.yaml lines 2 and 3, column 9 and 8.
    expect(diagnostic.message).toContain("/virtual/project.yaml:2:9");
    expect(diagnostic.message).toContain("/virtual/project.yaml:3:8");
  });

  it("/other/L1/elevation under refuse: the same, naming levels's delegating value (29-42)", async () => {
    const diagnostic = only(editTarget(await grafted(), "/other/L1/elevation"));
    expect(diagnostic.level).toBe("error");
    expect(bytesOf(diagnostic.primary)).toEqual(["/virtual/levels.yaml", 17, 18]);
    expect(diagnostic.related.map((r) => bytesOf(r.span))).toEqual([["/virtual/project.yaml", 29, 42]]);
  });

  it("under warn: answered, levels.yaml at /L1/elevation, with one info naming the other graft", async () => {
    const configuration = await grafted();
    for (const [pointer, other] of [["/levels/L1/elevation", [50, 63]], ["/other/L1/elevation", [29, 42]]] as const) {
      const result = editTarget(configuration, pointer, { sharedEdits: "warn" });
      expect(result).toMatchObject({ ok: true, location: "/virtual/levels.yaml", pointer: "/L1/elevation", format: "yaml" });
      const diagnostic = only(result);
      expect(diagnostic.level).toBe("info");
      expect(bytesOf(diagnostic.primary)).toEqual(["/virtual/levels.yaml", 17, 18]);
      expect(diagnostic.related.map((r) => bytesOf(r.span))).toEqual([["/virtual/project.yaml", ...other]]);
    }
  });

  it("under allow: answered, nothing said", async () => {
    expect(editTarget(await grafted(), "/levels/L1/elevation", { sharedEdits: "allow" })).toEqual({ ok: true, location: "/virtual/levels.yaml", pointer: "/L1/elevation", format: "yaml", diagnostics: [] });
  });

  it("a file grafted once (/third/T1/x) is editable, with no diagnostic, under every policy", async () => {
    const configuration = await grafted();
    for (const sharedEdits of ["refuse", "warn", "allow"] as const) {
      expect(editTarget(configuration, "/third/T1/x", { sharedEdits })).toEqual({ ok: true, location: "/virtual/third.yaml", pointer: "/T1/x", format: "yaml", diagnostics: [] });
    }
  });

  it("two different files at two places are each editable", async () => {
    const project = ["$schema: ./root.yaml", "levels: ./levels.yaml", "other: ./third.yaml", ""].join("\n");
    const configuration = await build("/virtual/project.yaml", { "/virtual/root.yaml": ROOT, "/virtual/project.yaml": project, "/virtual/levels.yaml": LEVELS, "/virtual/third.yaml": THIRD });
    expect(editTarget(configuration, "/levels/L1/elevation")).toEqual({ ok: true, location: "/virtual/levels.yaml", pointer: "/L1/elevation", format: "yaml", diagnostics: [] });
    expect(editTarget(configuration, "/other/T1/x")).toEqual({ ok: true, location: "/virtual/third.yaml", pointer: "/T1/x", format: "yaml", diagnostics: [] });
  });
});

describe("v1.12 FR-005 — the 020 fixture answers the same under every policy", () => {
  const pointers = ["/walls/W1/height", "/walls/W2/height", "/levels/L1/elevation", "/defaults/height", "/walls/W3/height", "/nope/x", "/styles/4", "/walls/W1", "/walls", "", "/styles", "/styles/0", "/styles/1", "/styles/2", "/styles/3"];
  for (const sharedEdits of ["warn", "allow"] as const) {
    it(sharedEdits, async () => {
      const configuration = await cascade();
      for (const pointer of pointers) {
        expect(editTarget(configuration, pointer, { sharedEdits }), pointer).toEqual(editTarget(configuration, pointer));
      }
    });
  }
});

describe("v1.12 FR-005, FR-007 — an alias copy in editTarget", () => {
  // "a: &x 1\nb: *x\n": the `1` is bytes 6-7, and both /a and /b carry it.
  it("under warn: answered at the merged pointer's own copy, with one info", async () => {
    const configuration = await build("/virtual/e.yaml", { "/virtual/e.yaml": "a: &x 1\nb: *x\n" });
    for (const pointer of ["/a", "/b"]) {
      const result = editTarget(configuration, pointer, { sharedEdits: "warn" });
      expect(result, pointer).toMatchObject({ ok: true, location: "/virtual/e.yaml", pointer, format: "yaml" });
      const diagnostic = only(result);
      expect(diagnostic.level).toBe("info");
      expect([diagnostic.primary.start, diagnostic.primary.end]).toEqual([6, 7]);
      expect(diagnostic.related.map((r) => r.label)).toEqual([`the same value at '${pointer === "/a" ? "/b" : "/a"}' in /virtual/e.yaml`]);
    }
  });

  it("under allow: answered, nothing said", async () => {
    const configuration = await build("/virtual/e.yaml", { "/virtual/e.yaml": "a: &x 1\nb: *x\n" });
    expect(editTarget(configuration, "/b", { sharedEdits: "allow" })).toEqual({ ok: true, location: "/virtual/e.yaml", pointer: "/b", format: "yaml", diagnostics: [] });
  });
});

describe("v1.12 FR-005, FR-007 — the writer", () => {
  // base0-3 :4 sp5 &6 h7 sp8 `3.2` 9-12 LF12; W1 13-14 :15 sp16 `*h` 17-19.
  const bytes = ENCODER.encode("base: &h 3.2\nW1: *h\n");
  const origin = { id: "shared", label: "shared" };

  it("yamlWriter({ sharedEdits: 'allow' }) writes an alias copy where yamlWriter() refuses it", () => {
    expect(yamlWriter().write(bytes, "/W1", 3.4).ok).toBe(false);
    expect(yamlWriter({ sharedEdits: "allow" }).write(bytes, "/W1", 3.4)).toEqual({ ok: true, edit: { start: 9, end: 12, bytes: ENCODER.encode("3.4") }, diagnostics: [] });
  });

  it("under warn, the info is at the value and names the alias (17-19)", () => {
    for (const pointer of ["/W1", "/base"]) {
      const result = setValue(bytes, { format: "yaml", origin, sharedEdits: "warn" }, pointer, 3.4);
      if (!result.ok) throw new Error(pointer);
      expect([result.edit.start, result.edit.end]).toEqual([9, 12]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.level).toBe("info");
      expect([result.diagnostics[0]?.primary.start, result.diagnostics[0]?.primary.end]).toEqual([9, 12]);
      expect(result.diagnostics[0]?.related.map((r) => [r.span.start, r.span.end])).toEqual([[17, 19]]);
    }
  });

  it("under warn, every alias that holds the value is named — through a container's alias too", () => {
    // m0 :1 sp2 &3 c4 sp5 {6 v7 :8 sp9 &10 x11 sp12 1(13) }14 LF15; n16 :17 sp18 *19 c20 LF21; o22 :23 sp24 *25 x26 LF27
    const text = ENCODER.encode("m: &c {v: &x 1}\nn: *c\no: *x\n");
    const result = setValue(text, { format: "yaml", origin, sharedEdits: "warn" }, "/m/v", 2);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect([result.edit.start, result.edit.end]).toEqual([13, 14]);
    expect(result.diagnostics[0]?.related.map((r) => [r.span.start, r.span.end])).toEqual([[19, 21], [25, 27]]);
  });

  it("a policy that is none of the three is programmer error", () => {
    // @ts-expect-error — the point is a value outside the type
    expect(() => setValue(bytes, { format: "yaml", origin, sharedEdits: "sometimes" }, "/W1", 1)).toThrow();
    // @ts-expect-error — the point is a value outside the type
    expect(() => editTarget(cascadeSync, "/walls/W1/height", { sharedEdits: "sometimes" })).toThrow();
  });

  it("jsonWriter accepts the option and changes nothing", () => {
    const json = ENCODER.encode('{"a": 1}');
    expect(jsonWriter({ sharedEdits: "warn" }).write(json, "/a", 2)).toEqual(jsonWriter().write(json, "/a", 2));
  });
});

const cascadeSync = await cascade();
