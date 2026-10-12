/**
 * v1.16 (specs/026-shift-and-amend): `shifted` and `amend` on an opened document, and on a writer's.
 * Every expectation is written by hand from the rule, before the code.
 */

import { describe, expect, it } from "vitest";
import { createOrigin, openDocument, type AmendOperation, type EditData, type EditOptions, type OpenedDocument } from "../../src/index.js";
import { jsonWriter, yamlWriter } from "../../src/writers.js";

const ENC = new TextEncoder();
const origin = createOrigin("shift-amend", "shift-amend");
const yaml: EditOptions = { format: "yaml", origin };
const json: EditOptions = { format: "json", origin };

function open(text: string, options: EditOptions = yaml): OpenedDocument {
  const result = openDocument(ENC.encode(text), options);
  if (!result.ok) throw new Error("did not open");
  return result.document;
}

const walls = "walls:\n  - h: 1\n  - h: 2\n  - h: 3\nnames:\n  W1: a\n";

describe("v1.16 FR-001 -- shifted: a list along the pointer changed length", () => {
  const base = open(walls);
  it("an item added at the top shifts every index into that list", () => {
    const newer = open("walls:\n  - h: 0\n  - h: 1\n  - h: 2\n  - h: 3\nnames:\n  W1: a\n");
    expect(base.shifted("/walls/2/h", newer)).toBe(true);
    expect(base.shifted("/walls/0", newer)).toBe(true);
    expect(base.shifted("/walls/-", newer)).toBe(false); // `-` names the end, wherever it is
  });
  it("an item appended at the end shifts too: the guard counts, it does not compare", () => {
    expect(base.shifted("/walls/0/h", open(walls.replace("  - h: 3\n", "  - h: 3\n  - h: 4\n")))).toBe(true);
  });
  it("a pointer through no list is never shifted, whatever a list elsewhere did", () => {
    const newer = open("walls:\n  - h: 0\nnames:\n  W1: b\n");
    expect(base.shifted("/names/W1", newer)).toBe(false);
    expect(base.shifted("", newer)).toBe(false);
  });
  it("same length, changed contents: not shifted", () => {
    expect(base.shifted("/walls/1/h", open(walls.replace("h: 2", "h: 20")))).toBe(false);
  });
  it("a list in one version and a mapping in the other is shifted: the step no longer means an index", () => {
    expect(base.shifted("/walls/1", open("walls:\n  \"1\": x\nnames:\n  W1: a\n"))).toBe(true);
  });
  it("a prefix absent in the newer version is not shifted: that is gone, the caller's other answer", () => {
    expect(base.shifted("/walls/1/h", open("names:\n  W1: a\n"))).toBe(false);
  });
  it("a nested list counts at its own step", () => {
    const nested = open("m:\n  - [1, 2]\n");
    expect(nested.shifted("/m/0/1", open("m:\n  - [1, 2, 3]\n"))).toBe(true);
    expect(nested.shifted("/m/0", open("m:\n  - [1, 2, 3]\n"))).toBe(false);
  });
  it("across formats the models are compared, not the bytes", () => {
    expect(open('{"walls": [1, 2]}', json).shifted("/walls/0", open("walls: [1, 2]\n"))).toBe(false);
  });
  it("a newer document that is not an opened document is programmer error", () => {
    expect(() => base.shifted("/walls/0", {} as unknown as OpenedDocument)).toThrow(TypeError);
  });
});

describe("v1.16 FR-002 -- amend: an operation inside a staged value", () => {
  const doc = open("a: 1\n");
  const wall: EditData = new Map<string, EditData>([["h", 3.2], ["tags", ["x", "y"]]]);
  it("outside the staged path, or at it, answers not inside", () => {
    expect(doc.amend({ path: "/walls/W3", value: wall }, { op: "set", path: "/walls/W3", value: 1n })).toEqual({ inside: false });
    expect(doc.amend({ path: "/walls/W3", value: wall }, { op: "set", path: "/walls/W30/h", value: 1n })).toEqual({ inside: false });
    expect(doc.amend({ path: "/walls/W3", value: wall }, { op: "remove", path: "/walls" })).toEqual({ inside: false });
  });
  it("set replaces a value that is there", () => {
    expect(doc.amend({ path: "/walls/W3", value: wall }, { op: "set", path: "/walls/W3/h", value: 3.4 })).toEqual({
      inside: true, ok: true, value: new Map<string, EditData>([["h", 3.4], ["tags", ["x", "y"]]]),
    });
    expect(doc.amend({ path: "/walls/W3", value: wall }, { op: "set", path: "/walls/W3/tags/1", value: "z" })).toEqual({
      inside: true, ok: true, value: new Map<string, EditData>([["h", 3.2], ["tags", ["x", "z"]]]),
    });
  });
  it("add creates: a new key at the end, an item before an index, `-` appending", () => {
    expect(doc.amend({ path: "/walls/W3", value: wall }, { op: "add", path: "/walls/W3/w", value: 4 })).toEqual({
      inside: true, ok: true, value: new Map<string, EditData>([["h", 3.2], ["tags", ["x", "y"]], ["w", 4]]),
    });
    expect(doc.amend({ path: "/walls/W3", value: wall }, { op: "add", path: "/walls/W3/tags/0", value: "w" })).toEqual({
      inside: true, ok: true, value: new Map<string, EditData>([["h", 3.2], ["tags", ["w", "x", "y"]]]),
    });
    expect(doc.amend({ path: "/walls/W3", value: wall }, { op: "add", path: "/walls/W3/tags/-", value: "w" })).toEqual({
      inside: true, ok: true, value: new Map<string, EditData>([["h", 3.2], ["tags", ["x", "y", "w"]]]),
    });
    expect(doc.amend({ path: "/walls/W3", value: wall }, { op: "add", path: "/walls/W3/tags/2", value: "w" })).toEqual({
      inside: true, ok: true, value: new Map<string, EditData>([["h", 3.2], ["tags", ["x", "y", "w"]]]),
    });
  });
  it("remove deletes a key or an item", () => {
    expect(doc.amend({ path: "/walls/W3", value: wall }, { op: "remove", path: "/walls/W3/h" })).toEqual({
      inside: true, ok: true, value: new Map<string, EditData>([["tags", ["x", "y"]]]),
    });
    expect(doc.amend({ path: "/walls/W3", value: wall }, { op: "remove", path: "/walls/W3/tags/0" })).toEqual({
      inside: true, ok: true, value: new Map<string, EditData>([["h", 3.2], ["tags", ["y"]]]),
    });
  });
  it("refusals are answers, with the reason, never throws", () => {
    const refused = (operation: AmendOperation) => {
      const result = doc.amend({ path: "/walls/W3", value: wall }, operation);
      return result.inside && !result.ok;
    };
    expect(refused({ op: "add", path: "/walls/W3/h", value: 1n })).toBe(true); // exists: add only creates
    expect(refused({ op: "set", path: "/walls/W3/w", value: 1n })).toBe(true); // absent: set only changes
    expect(refused({ op: "remove", path: "/walls/W3/w" })).toBe(true); // absent
    expect(refused({ op: "add", path: "/walls/W3/tags/3", value: "w" })).toBe(true); // past the end
    expect(refused({ op: "set", path: "/walls/W3/tags/2", value: "w" })).toBe(true); // the end is no item to change
    expect(refused({ op: "remove", path: "/walls/W3/tags/2" })).toBe(true); // nor to remove
    expect(refused({ op: "set", path: "/walls/W3/tags/01", value: "w" })).toBe(true); // not an index (RFC 6901)
    expect(refused({ op: "remove", path: "/walls/W3/tags/-" })).toBe(true); // `-` names no item
    expect(refused({ op: "add", path: "/walls/W3/h/x", value: 1n })).toBe(true); // the parent is a scalar
    expect(refused({ op: "add", path: "/walls/W3/q/x", value: 1n })).toBe(true); // the parent is absent
  });
  it("the staged value is not changed; the answer is a new value", () => {
    const tags: EditData[] = ["x"];
    const staged = new Map<string, EditData>([["tags", tags]]);
    doc.amend({ path: "/w", value: staged }, { op: "add", path: "/w/tags/-", value: "y" });
    doc.amend({ path: "/w", value: staged }, { op: "remove", path: "/w/tags" });
    expect(staged.get("tags")).toBe(tags);
    expect(tags).toEqual(["x"]);
    expect([...staged.keys()]).toEqual(["tags"]);
  });
  it("escaped segments: `~1` is a slash and `~0` a tilde in the remainder", () => {
    expect(doc.amend({ path: "", value: new Map<string, EditData>([["a/b", 1n]]) }, { op: "set", path: "/a~1b", value: 2n })).toEqual({
      inside: true, ok: true, value: new Map<string, EditData>([["a/b", 2n]]),
    });
    expect(doc.amend({ path: "/m~0", value: new Map() }, { op: "add", path: "/m~0/k", value: 1n })).toEqual({
      inside: true, ok: true, value: new Map<string, EditData>([["k", 1n]]),
    });
    expect(doc.amend({ path: "/m~0", value: new Map() }, { op: "add", path: "/m~1/k", value: 1n })).toEqual({ inside: false });
  });
  it("a staged value or an operation value that is not EditData is programmer error, as setValue's is", () => {
    expect(() => doc.amend({ path: "/w", value: { h: 1 } as unknown as EditData }, { op: "remove", path: "/w/h" })).toThrow(TypeError);
    expect(() => doc.amend({ path: "/w", value: wall }, { op: "set", path: "/w/h", value: { x: 1 } as unknown as EditData })).toThrow(TypeError);
  });
});

describe("v1.16 FR-002 -- inside: the question amend asks first", () => {
  const doc = open("a: 1\n");
  it("strictly below, by whole segments", () => {
    expect(doc.inside("/walls/W3/h", "/walls/W3")).toBe(true);
    expect(doc.inside("/walls/W3", "/walls/W3")).toBe(false);
    expect(doc.inside("/walls/W30", "/walls/W3")).toBe(false);
    expect(doc.inside("/walls", "/walls/W3")).toBe(false);
    expect(doc.inside("/a", "")).toBe(true);
    expect(doc.inside("", "")).toBe(false);
  });
  it("a malformed pointer is programmer error", () => {
    expect(() => doc.inside("walls", "")).toThrow();
  });
});

describe("v1.16 FR-003 -- a writer's document answers both", () => {
  it("yamlWriter and jsonWriter", () => {
    for (const [writer, older, newer] of [
      [yamlWriter(), "l: [1]\n", "l: [1, 2]\n"],
      [jsonWriter(), '{"l": [1]}', '{"l": [1, 2]}'],
    ] as const) {
      const a = writer.open(ENC.encode(older));
      const b = writer.open(ENC.encode(newer));
      if (!a.ok || !b.ok) throw new Error("did not open");
      expect(a.document.shifted("/l/0", b.document)).toBe(true);
      expect(a.document.shifted("/l/0", a.document)).toBe(false);
      expect(a.document.amend({ path: "/w", value: [1n] }, { op: "add", path: "/w/-", value: 2n })).toEqual({ inside: true, ok: true, value: [1n, 2n] });
      expect(a.document.inside("/w/0", "/w")).toBe(true);
    }
  });
  it("a writer's document with a newer one from another writer of the same library is accepted", () => {
    const a = yamlWriter().open(ENC.encode("l: [1]\n"));
    const b = jsonWriter().open(ENC.encode('{"l": [1, 2]}'));
    if (!a.ok || !b.ok) throw new Error("did not open");
    expect(a.document.shifted("/l/0", b.document)).toBe(true);
  });
});
