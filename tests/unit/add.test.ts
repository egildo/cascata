/**
 * v1.15 Part C -- add (specs/025-open-insert-delete, FR-012 to FR-015, FR-020).
 *
 * The byte-exact cases are the write corpus (`add-*`, `json-add-*`). These are the rest: a batch of adds applied together
 * (FR-015), the facts about what an add does not touch, the counted parse, and the refusals' spans.
 */
import { describe, expect, it } from "vitest";
import { parseJsonBytes } from "../../src/adapters/json/parse.js";
import { createOrigin, openDocument, parse } from "../../src/index.js";
import type { EditData, EditOptions } from "../../src/index.js";
import { openDocumentUsing, type FormatOpened } from "../../src/adapters/edit.js";
import { parseCalls } from "../../src/adapters/parse-count.js";
import { yamlWriter } from "../../src/writers.js";

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const origin = createOrigin("add", "add");
const yaml: EditOptions = { format: "yaml", origin };
const json: EditOptions = { format: "json", origin };

interface Piece {
  readonly start: number;
  readonly end: number;
  readonly bytes: Uint8Array;
}

/** Apply edits of one opened document together, as a Language Server Protocol client applies a batch: against the original offsets, equal offsets in array order. */
function applyTogether(text: string, edits: readonly Piece[]): string {
  const bytes = ENC.encode(text);
  const ordered = edits.map((edit, order) => ({ edit, order })).sort((a, b) => a.edit.start - b.edit.start || a.order - b.order);
  let out = "";
  let at = 0;
  for (const { edit } of ordered) {
    if (edit.start < at) throw new Error("the edits overlap");
    out += DEC.decode(bytes.subarray(at, edit.start)) + DEC.decode(edit.bytes);
    at = edit.end;
  }
  return out + DEC.decode(bytes.subarray(at));
}

function open(text: string, options: EditOptions = yaml) {
  const result = openDocument(ENC.encode(text), options);
  if (!result.ok) throw new Error("did not open");
  return result.document;
}

/** The reader's view of `text` as plain JS, for comparing what a batch of adds read back as. */
function plain(text: string, options: EditOptions = yaml): unknown {
  const read = options.format === "yaml" ? parse(ENC.encode(text), { origin }) : parseJsonBytes(ENC.encode(text), origin);
  if (!read.ok) throw new Error(`does not parse: ${text}`);
  const walk = (node: typeof read.tree): unknown => (node.type === "scalar" ? (typeof node.value === "bigint" ? Number(node.value) : node.value) : node.type === "mapping" ? Object.fromEntries([...node.entries].map(([k, v]) => [k, walk(v)])) : node.items.map(walk));
  return walk(read.tree);
}

describe("v1.15 FR-015 -- appends to the same non-empty container compose, in the order given", () => {
  const cases: [string, string, EditOptions, string[], (string | number)[], unknown][] = [
    ["a block mapping", "a: 1\nb: 2\n", yaml, ["/c", "/d", "/e"], [3, 4, 5], { a: 1, b: 2, c: 3, d: 4, e: 5 }],
    ["a block mapping with no newline at the end", "a: 1\nb: 2", yaml, ["/c", "/d"], [3, 4], { a: 1, b: 2, c: 3, d: 4 }],
    ["a CRLF block mapping", "a: 1\r\nb: 2\r\n", yaml, ["/c", "/d"], [3, 4], { a: 1, b: 2, c: 3, d: 4 }],
    ["a nested block mapping", "top:\n  a: 1\nz: 9\n", yaml, ["/top/b", "/top/c"], [2, 3], { top: { a: 1, b: 2, c: 3 }, z: 9 }],
    ["a block sequence", "- a\n- b\n", yaml, ["/-", "/-", "/-"], ["x", "w", "v"], ["a", "b", "x", "w", "v"]],
    ["a flow mapping", "m: {a: 1}\n", yaml, ["/m/b", "/m/c"], [2, 3], { m: { a: 1, b: 2, c: 3 } }],
    ["a flow sequence", "s: [1, 2]\n", yaml, ["/s/-", "/s/-"], [3, 4], { s: [1, 2, 3, 4] }],
    ["a JSON object, one line", '{"a": 1}', json, ["/b", "/c"], [2, 3], { a: 1, b: 2, c: 3 }],
    ["a JSON object, one member per line", '{\n  "a": 1\n}\n', json, ["/b", "/c"], [2, 3], { a: 1, b: 2, c: 3 }],
    ["a JSON array", "[1, 2]", json, ["/-", "/-"], [3, 4], [1, 2, 3, 4]],
  ];
  for (const [name, text, options, pointers, values, expected] of cases) {
    it(`${name}: ${pointers.length} adds applied together read back as all of them, in order`, () => {
      const document = open(text, options);
      const edits = pointers.map((pointer, i) => {
        const result = document.add(pointer, values[i] as EditData);
        if (!result.ok) throw new Error(`refused ${pointer}: ${result.diagnostics.map((d) => d.code).join(",")}`);
        return result.edit;
      });
      const together = applyTogether(text, edits);
      expect(plain(together, options)).toEqual(expected);
    });
  }

  it("two inserts before the same item compose too, in array order", () => {
    const document = open("- a\n- b\n");
    const x = document.add("/1", "x");
    const w = document.add("/1", "w");
    if (!x.ok || !w.ok) throw new Error("refused");
    expect(applyTogether("- a\n- b\n", [x.edit, w.edit])).toBe("- a\n- x\n- w\n- b\n");
  });

  it("an add into an EMPTY container is not empty-ranged: two of them overlap, and the caller must reopen between them", () => {
    const text = "walls: {}\nnext: 1\n";
    const document = open(text);
    const first = document.add("/walls/W1", 1);
    const second = document.add("/walls/W2", 2);
    if (!first.ok || !second.ok) throw new Error("refused");
    // Both rewrite the `{}`: bytes 6..9, so they overlap and cannot be applied together.
    expect([first.edit.start, first.edit.end]).toEqual([6, 9]);
    expect([second.edit.start, second.edit.end]).toEqual([6, 9]);
    expect(() => applyTogether(text, [first.edit, second.edit])).toThrow(/overlap/);
    // Applying one and reopening is how the second is added.
    const reopened = open(applyTogether(text, [first.edit]));
    const again = reopened.add("/walls/W2", 2);
    expect(again.ok).toBe(true);
  });

  it("the JSON empty object and array are the same: the brackets are rewritten, so two adds overlap", () => {
    const object = open('{"a": {}}', json);
    const first = object.add("/a/x", 1);
    const second = object.add("/a/y", 2);
    if (!first.ok || !second.ok) throw new Error("refused");
    expect([first.edit.start, first.edit.end, second.edit.start, second.edit.end]).toEqual([6, 8, 6, 8]);
    const array = open("[]", json);
    const one = array.add("/-", 1);
    const two = array.add("/-", 2);
    if (!one.ok || !two.ok) throw new Error("refused");
    expect(() => applyTogether("[]", [one.edit, two.edit])).toThrow(/overlap/);
  });
});

describe("v1.15 FR-012 -- an add into a non-empty container is an insertion and writes nothing else", () => {
  const rows: [string, string, string, EditData, EditOptions][] = [
    ["block mapping", "a: 1 # one\nb:\n  c: 2\n# end\n", "/d", 3, yaml],
    ["nested block mapping", "a:\n  b: 1\n  # inner\nz: 2\n", "/a/c", 3, yaml],
    ["block sequence", "- a\n# c\n- b\n", "/1", "x", yaml],
    ["flow sequence", "s: [1, 2]\n", "/s/0", 9, yaml],
    ["JSON object", '{"a": 1}', "/b", 2, json],
    ["JSON array", "[1, 2]", "/1", 9, json],
  ];
  for (const [name, text, pointer, value, options] of rows) {
    it(`${name}: the edit has an empty range, and every byte outside it is where it was`, () => {
      const result = open(text, options).add(pointer, value);
      if (!result.ok) throw new Error("refused");
      expect(result.edit.start).toBe(result.edit.end);
      const applied = applyTogether(text, [result.edit]);
      expect(applied.startsWith(DEC.decode(ENC.encode(text).subarray(0, result.edit.start)))).toBe(true);
      expect(applied.endsWith(DEC.decode(ENC.encode(text).subarray(result.edit.end)))).toBe(true);
    });
  }

  it("the document the add was asked of is unchanged: locate answers as it did", () => {
    const document = open("a: 1\nb: 2\n");
    const before = document.locate("/b");
    document.add("/c", 3);
    expect(document.locate("/b")).toEqual(before);
    expect(document.locate("/c").ok).toBe(false);
  });

  it("the new entry takes a sequence index and shifts the ones after it", () => {
    const text = "- a\n- b\n- c\n";
    const result = open(text).add("/1", "x");
    if (!result.ok) throw new Error("refused");
    expect(plain(applyTogether(text, [result.edit]))).toEqual(["a", "x", "b", "c"]);
  });
});

describe("v1.15 FR-009, FR-012 -- a lone carriage return is a line break, and the lines added end in it", () => {
  it("appending to a lone-CR file adds a CR-ended line at the end of the last line", () => {
    // `a: 1\rb: 2\r` is ten bytes; the second line ends at 10.
    const result = open("a: 1\rb: 2\r").add("/c", 3);
    expect(result.ok && [result.edit.start, result.edit.end, DEC.decode(result.edit.bytes)]).toEqual([10, 10, "c: 3\r"]);
  });
  it("inserting before an item in a lone-CR file", () => {
    const result = open("- a\r- b\r").add("/1", "x");
    expect(result.ok && [result.edit.start, result.edit.end, DEC.decode(result.edit.bytes)]).toEqual([4, 4, "- x\r"]);
  });
});

describe("v1.15 FR-013 -- refusals", () => {
  it("every refusal is a diagnostic, never a throw", () => {
    const document = open("a: 1\nb: [1]\n");
    for (const [pointer, code] of [
      ["/x/y", "edit-target-absent"],
      ["/a/b", "edit-parent-scalar"],
      ["/a", "edit-target-exists"],
      ["/b/5", "edit-target-absent"],
      ["/b/x", "edit-target-absent"],
      ["", "edit-target-exists"],
    ] as const) {
      const result = document.add(pointer, 1);
      expect(result.ok, pointer).toBe(false);
      if (!result.ok) expect(result.diagnostics[0]?.code, pointer).toBe(code);
    }
  });

  it("an add to a parent that is null (`a:`) is edit-parent-scalar, since null is a scalar", () => {
    const result = open("a:\n").add("/a/b", 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe("edit-parent-scalar");
  });

  it("an add to a parent that is a block scalar is edit-parent-scalar", () => {
    const result = open("a: |\n  text\n").add("/a/b", 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe("edit-parent-scalar");
  });

  it("a key the mapping has under an escaped pointer is found: a/b and c~d", () => {
    const document = open("'a/b': 1\n'c~d': 2\n");
    expect(document.add("/a~1b", 5).ok).toBe(false);
    expect(document.add("/c~0d", 5).ok).toBe(false);
    expect(document.add("/e~1f", 5).ok).toBe(true);
  });

  it("an index '-' on a mapping is a key named '-'", () => {
    const result = open("a: 1\n").add("/-", 2);
    expect(result.ok && DEC.decode(result.edit.bytes)).toBe('"-": 2\n');
  });

  it("a key beyond the escape: the empty key", () => {
    const result = open("a: 1\n").add("/", 2);
    expect(result.ok && DEC.decode(result.edit.bytes)).toBe('"": 2\n');
  });
});

describe("v1.15 FR-004, FR-025 -- an answered add parses once, to read back; a refusal parses nothing", () => {
  it("N answered adds parse N + 1 times and a refused one none", () => {
    const before = parseCalls();
    const document = open("a: 1\n");
    expect(document.add("/b", 2).ok).toBe(true);
    expect(document.add("/c", 3).ok).toBe(true);
    expect(document.add("/a", 3).ok).toBe(false);
    expect(document.add("/x/y", 3).ok).toBe(false);
    expect(parseCalls() - before).toBe(1 + 2);
  });
});

describe("v1.15 FR-006 -- a writer's document adds", () => {
  it("add answers the shapes write has", () => {
    const opened = yamlWriter().open(ENC.encode("a: 1\n"));
    if (!opened.ok) throw new Error("did not open");
    expect(opened.document.add("/b", 2)).toEqual({ ok: true, edit: { start: 5, end: 5, bytes: ENC.encode("b: 2\n") }, diagnostics: [] });
    const refused = opened.document.add("/a", 2);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(typeof refused.reason).toBe("string");
  });
});

describe("v1.15 FR-020 -- sharedEdits decides, and the copies are checked", () => {
  const text = "base: &b\n  x: 1\nd: *b\n";
  it("refuse: edit-target-shared at the alias", () => {
    const result = open(text).add("/d/z", 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe("edit-target-shared");
  });
  it("warn: the edit and one info naming the other places", () => {
    const result = open(text, { ...yaml, sharedEdits: "warn" }).add("/d/z", 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diagnostics.map((d) => [d.level, d.code])).toEqual([["info", "edit-target-shared"]]);
      expect(result.diagnostics[0]?.related.length).toBeGreaterThanOrEqual(1);
    }
  });
  it("allow: the edit and nothing said", () => {
    const result = open(text, { ...yaml, sharedEdits: "allow" }).add("/d/z", 2);
    expect(result.ok && result.diagnostics.length).toBe(0);
  });
});

describe("v1.15 FR-014 -- the add's read-back compares the whole tree (shown with plans that are wrong)", () => {
  /** A format whose add plan is the real one, tampered with. */
  const tampered = (change: (plan: { start: number; end: number; text: string }) => { start: number; end: number; text: string }) => (format: FormatOpened): FormatOpened => ({
    ...format,
    add: (container, at, data) => {
      const plan = format.add(container, at, data);
      return plan.ok ? { ...plan, ...change(plan) } : plan;
    },
  });
  const refusedAs = (text: string, options: EditOptions, pointer: string, value: EditData, change: Parameters<typeof tampered>[0]): string | undefined => {
    const result = openDocumentUsing(ENC.encode(text), options, tampered(change));
    if (!result.ok) throw new Error("did not open");
    const added = result.document.add(pointer, value);
    return added.ok ? undefined : added.diagnostics[0]?.code;
  };

  it("an add that also eats the entry after it is refused, though the new entry reads right", () => {
    // Insert `x` before `b`, but let the edit's range run over `b: 2` too.
    expect(refusedAs("- a\n- b\n- c\n", yaml, "/1", "x", (plan) => ({ ...plan, end: plan.end + 4 }))).toBe("edit-read-back");
    expect(refusedAs('[1, 2, 3]', json, "/1", 9, (plan) => ({ ...plan, end: plan.end + 3 }))).toBe("edit-read-back");
  });

  it("an add that also writes an extra entry is refused", () => {
    expect(refusedAs("a: 1\n", yaml, "/b", 2, (plan) => ({ ...plan, text: `${plan.text}c: 3\n` }))).toBe("edit-read-back");
  });

  it("an add put at the wrong index is refused", () => {
    expect(refusedAs("- a\n- b\n", yaml, "/0", "x", () => ({ start: 8, end: 8, text: "- x\n" }))).toBe("edit-read-back");
  });

  it("the sound plans are accepted", () => {
    expect(refusedAs("- a\n- b\n", yaml, "/0", "x", (plan) => plan)).toBeUndefined();
  });
});
