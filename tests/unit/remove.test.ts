/**
 * v1.15 Part D -- remove (specs/025-open-insert-delete, FR-016 to FR-019, FR-021).
 *
 * The byte-exact cases are the write corpus (`remove-*`, `json-remove-*`). These are the rest: the kind law (a container
 * that empties keeps its kind) at every nesting, removing everything one entry at a time, the documented limit of
 * independent edits, the counted parse, and the read-back's whole-tree comparison shown with plans that are wrong.
 */
import { describe, expect, it } from "vitest";
import { parseJsonBytes } from "../../src/adapters/json/parse.js";
import { createOrigin, openDocument, parse } from "../../src/index.js";
import type { EditOptions } from "../../src/index.js";
import { openDocumentUsing, type FormatOpened } from "../../src/adapters/edit.js";
import { parseCalls } from "../../src/adapters/parse-count.js";
import { yamlWriter } from "../../src/writers.js";

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const origin = createOrigin("remove", "remove");
const yaml: EditOptions = { format: "yaml", origin };
const json: EditOptions = { format: "json", origin };

function open(text: string, options: EditOptions = yaml) {
  const result = openDocument(ENC.encode(text), options);
  if (!result.ok) throw new Error("did not open");
  return result.document;
}

function apply(text: string, edit: { start: number; end: number; bytes: Uint8Array }): string {
  const bytes = ENC.encode(text);
  return DEC.decode(bytes.subarray(0, edit.start)) + DEC.decode(edit.bytes) + DEC.decode(bytes.subarray(edit.end));
}

function read(text: string, options: EditOptions = yaml) {
  const result = options.format === "yaml" ? parse(ENC.encode(text), { origin }) : parseJsonBytes(ENC.encode(text), origin);
  if (!result.ok) throw new Error(`does not parse: ${JSON.stringify(text)}`);
  return result.tree;
}

describe("v1.15 FR-017 -- a container that empties keeps its kind, however it was written", () => {
  const rows: [string, string, string, EditOptions, "mapping" | "sequence"][] = [
    ["a block mapping value", "walls:\n  W1: 1\nnext: 1\n", "/walls/W1", yaml, "mapping"],
    ["a block sequence value", "walls:\n  - 1\nnext: 1\n", "/walls/0", yaml, "sequence"],
    ["an indented-flush block sequence", "walls:\n- 1\nnext: 1\n", "/walls/0", yaml, "sequence"],
    ["an item of a sequence", "- k: 1\n- 2\n", "/0/k", yaml, "mapping"],
    ["a mapping nested three deep", "a:\n  b:\n    c:\n      d: 1\ne: 1\n", "/a/b/c/d", yaml, "mapping"],
    ["a flow mapping", "walls: {W1: 1}\n", "/walls/W1", yaml, "mapping"],
    ["a flow sequence", "walls: [1]\n", "/walls/0", yaml, "sequence"],
    ["a flow sequence in a block sequence", "- [1]\n- 2\n", "/0/0", yaml, "sequence"],
    ["the root mapping", "a: 1\n", "/a", yaml, "mapping"],
    ["the root sequence", "- 1\n", "/0", yaml, "sequence"],
    ["a JSON object", '{"walls": {"W1": 1}}', "/walls/W1", json, "mapping"],
    ["a JSON array", '{"walls": [1]}', "/walls/0", json, "sequence"],
    ["a multi-line JSON object", '{\n  "walls": {\n    "W1": 1\n  }\n}\n', "/walls/W1", json, "mapping"],
    ["the JSON root", '{"a": 1}', "/a", json, "mapping"],
    ["the JSON root array", "[1]", "/0", json, "sequence"],
  ];
  for (const [name, text, pointer, options, kind] of rows) {
    it(`${name}: what is left is an empty ${kind}, not null`, () => {
      const result = open(text, options).remove(pointer);
      if (!result.ok) throw new Error(`refused: ${result.diagnostics.map((d) => d.code).join(",")}`);
      const after = apply(text, result.edit);
      const parentPointer = pointer.slice(0, pointer.lastIndexOf("/"));
      let node = read(after, options);
      for (const segment of parentPointer === "" ? [] : parentPointer.slice(1).split("/")) {
        node = node.type === "mapping" ? (node.entries.get(segment) ?? node) : node.type === "sequence" ? (node.items[Number(segment)] ?? node) : node;
      }
      expect(node.type).toBe(kind);
      expect(node.type === "mapping" ? node.entries.size : node.type === "sequence" ? node.items.length : -1).toBe(0);
    });
  }

  it("a mapping never becomes `key:` with nothing under it", () => {
    const result = open("walls:\n  W1: 1\n").remove("/walls/W1");
    expect(result.ok && apply("walls:\n  W1: 1\n", result.edit)).toBe("walls: {}\n");
  });
});

describe("v1.15 FR-016 -- removing every entry in turn, reopening between, ends at an empty container of the same kind", () => {
  const rows: [string, string, EditOptions][] = [
    ["a block mapping with comments", "# top\na: 1 # one\n# about b\nb:\n  c: 2\n\n# note\nd: [1, 2]\n", yaml],
    ["a block sequence of mappings", "- a: 1\n  b: 2\n- c: 3\n- - x\n  - y\n", yaml],
    ["a flow mapping", "m: { a: 1, b: [1, 2], c: {d: 4} }\n", yaml],
    ["a CRLF file", "a: 1\r\nb:\r\n  c: 2\r\nd: 3\r\n", yaml],
    ["a JSON object, one member per line", '{\n  "a": 1,\n  "b": {\n    "c": [1, 2]\n  },\n  "d": 3\n}\n', json],
    ["a compact JSON array", '[1,{"a":2},[3,4]]', json],
  ];
  for (const [name, text, options] of rows) {
    it(`${name}`, () => {
      let current = text;
      for (let guard = 0; guard < 50; guard += 1) {
        const tree = read(current, options);
        // The first leaf-most entry: remove the first entry of the root until the root is empty.
        if (tree.type === "mapping" ? tree.entries.size === 0 : tree.type === "sequence" ? tree.items.length === 0 : true) break;
        const pointer = tree.type === "mapping" ? `/${[...tree.entries.keys()][0]}` : "/0";
        const result = open(current, options).remove(pointer);
        if (!result.ok) throw new Error(`refused ${pointer} in ${JSON.stringify(current)}: ${result.diagnostics.map((d) => d.code).join(",")}`);
        current = apply(current, result.edit);
      }
      const end = read(current, options);
      expect(end.type === "mapping" ? end.entries.size : end.type === "sequence" ? end.items.length : -1).toBe(0);
      expect(end.type).toBe(read(text, options).type);
    });
  }
});

describe("v1.15 ruling 2 -- the documented limit: independent edits, each right alone, can break the kind law together", () => {
  it("removing every entry of a mapping, one edit each, then applying them together leaves `walls:` with nothing under it", () => {
    const text = "walls:\n  W1: 1\n  W2: 2\nnext: 1\n";
    const document = open(text);
    const first = document.remove("/walls/W1");
    const second = document.remove("/walls/W2");
    if (!first.ok || !second.ok) throw new Error("refused");
    // Each alone is right: the mapping keeps one entry.
    expect(read(apply(text, first.edit)).type).toBe("mapping");
    // Applied together (they do not overlap) the mapping is empty and has no `{}`: it reads as null.
    const together = DEC.decode(ENC.encode(text).subarray(0, 7)) + DEC.decode(ENC.encode(text).subarray(23));
    expect(together).toBe("walls:\nnext: 1\n");
    const tree = read(together);
    const walls = tree.type === "mapping" ? tree.entries.get("walls") : undefined;
    expect(walls?.type === "scalar" ? walls.kind : walls?.type).toBe("null");
    // The two edits are [7,15) and [15,23): adjacent, not overlapping, so an applier accepts them.
    expect([first.edit.start, first.edit.end, second.edit.start, second.edit.end]).toEqual([7, 15, 15, 23]);
  });
});

describe("v1.15 FR-016 -- a lone carriage return is a line break", () => {
  it("removes whole lines of a lone-CR file", () => {
    const result = open("a: 1\r# about b\rb: 2\rc: 3\r").remove("/b");
    expect(result.ok && [result.edit.start, result.edit.end]).toEqual([5, 20]);
  });
});

describe("v1.15 FR-018 -- refusals", () => {
  it("every refusal is a diagnostic, never a throw", () => {
    const document = open("a: 1\nb: [1]\n");
    for (const [pointer, code] of [
      ["", "edit-remove-document"],
      ["/x", "edit-target-absent"],
      ["/b/5", "edit-target-absent"],
      ["/b/-", "edit-target-absent"],
      ["/b/x", "edit-target-absent"],
    ] as const) {
      const result = document.remove(pointer);
      expect(result.ok, pointer).toBe(false);
      if (!result.ok) expect(result.diagnostics[0]?.code, pointer).toBe(code);
    }
  });

  it("edit-reveals-merged names the merged value as related", () => {
    const result = open("base: &b\n  x: 1\nd:\n  <<: *b\n  x: 2\n").remove("/d/x");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const [d] = result.diagnostics;
      expect(d?.code).toBe("edit-reveals-merged");
      expect(d?.related.map((r) => [r.span.start, r.span.end])).toEqual([[14, 15]]);
    }
  });

  it("a key that does not override anything is removed even with a merge key beside it", () => {
    const text = "base: &b\n  x: 1\nd:\n  <<: *b\n  y: 2\n";
    const result = open(text).remove("/d/y");
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(text, result.edit)).toBe("base: &b\n  x: 1\nd:\n  <<: *b\n");
  });
});

describe("v1.15 FR-004, FR-025 -- an answered remove parses once, to read back; a refusal parses nothing", () => {
  it("N answered removes parse N + 1 times and a refused one none", () => {
    const before = parseCalls();
    const document = open("a: 1\nb: 2\nc: 3\n");
    expect(document.remove("/a").ok).toBe(true);
    expect(document.remove("/b").ok).toBe(true);
    expect(document.remove("/zzz").ok).toBe(false);
    expect(document.remove("").ok).toBe(false);
    expect(parseCalls() - before).toBe(1 + 2);
  });
});

describe("v1.15 FR-006 -- a writer's document removes", () => {
  it("remove answers the shapes write has", () => {
    const opened = yamlWriter().open(ENC.encode("a: 1\nb: 2\n"));
    if (!opened.ok) throw new Error("did not open");
    expect(opened.document.remove("/a")).toEqual({ ok: true, edit: { start: 0, end: 5, bytes: new Uint8Array() }, diagnostics: [] });
    const refused = opened.document.remove("");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(typeof refused.reason).toBe("string");
  });
});

describe("v1.15 FR-019 -- the remove's read-back compares the whole tree (shown with plans that are wrong)", () => {
  const tampered = (change: (plan: { start: number; end: number; text: string }) => { start: number; end: number; text: string }) => (format: FormatOpened): FormatOpened => ({
    ...format,
    remove: (target, container, at) => {
      const plan = format.remove(target, container, at);
      return plan.ok ? { ...plan, ...change(plan) } : plan;
    },
  });
  const refusedAs = (text: string, options: EditOptions, pointer: string, change: Parameters<typeof tampered>[0]): string | undefined => {
    const result = openDocumentUsing(ENC.encode(text), options, tampered(change));
    if (!result.ok) throw new Error("did not open");
    const removed = result.document.remove(pointer);
    return removed.ok ? undefined : removed.diagnostics[0]?.code;
  };

  it("a remove that also takes the next entry is refused, though the entry asked for is gone", () => {
    expect(refusedAs("a: 1\nb: 2\nc: 3\n", yaml, "/a", (plan) => ({ ...plan, end: plan.end + 5 }))).toBe("edit-read-back");
    expect(refusedAs("[1, 2, 3]", json, "/0", (plan) => ({ ...plan, end: plan.end + 3 }))).toBe("edit-read-back");
  });

  it("a remove that takes the wrong entry is refused", () => {
    expect(refusedAs("a: 1\nb: 2\nc: 3\n", yaml, "/a", () => ({ start: 5, end: 10, text: "" }))).toBe("edit-read-back");
  });

  it("a remove that leaves the entry in place is refused", () => {
    expect(refusedAs("a: 1\nb: 2\n", yaml, "/a", () => ({ start: 0, end: 0, text: "" }))).toBe("edit-read-back");
  });

  it("a remove that empties a mapping into null is refused: the kind law", () => {
    expect(refusedAs("walls:\n  W1: 1\nnext: 1\n", yaml, "/walls/W1", () => ({ start: 7, end: 15, text: "" }))).toBe("edit-read-back");
  });

  it("the sound plans are accepted", () => {
    expect(refusedAs("a: 1\nb: 2\n", yaml, "/a", (plan) => plan)).toBeUndefined();
  });
});
