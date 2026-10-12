/**
 * v1.15 Part B -- writing a container (specs/025-open-insert-delete, FR-007 to FR-011).
 *
 * The byte-exact cases are the write corpus (`tests/corpus/write-cases/set-container-*`, `json-set-container-*`). These are the
 * rest: what throws, what the limits refuse, the order a Map keeps, and the read-back's whole-tree comparison, which is shown
 * by handing it plans that are wrong.
 */
import { describe, expect, it } from "vitest";
import { createOrigin, openDocument, setValue } from "../../src/index.js";
import type { EditData, EditOptions } from "../../src/index.js";
import { openDocumentUsing, type FormatOpened } from "../../src/adapters/edit.js";
import { jsonWriter, yamlWriter } from "../../src/writers.js";

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const origin = createOrigin("containers", "containers");
const yaml: EditOptions = { format: "yaml", origin };
const json: EditOptions = { format: "json", origin };

function applied(text: string, edit: { start: number; end: number; bytes: Uint8Array }): string {
  const bytes = ENC.encode(text);
  return DEC.decode(bytes.subarray(0, edit.start)) + DEC.decode(edit.bytes) + DEC.decode(bytes.subarray(edit.end));
}

function write(text: string, pointer: string, value: EditData, options: EditOptions = yaml): string {
  const result = setValue(ENC.encode(text), options, pointer, value);
  if (!result.ok) throw new Error(`refused: ${result.diagnostics.map((d) => d.code).join(", ")}`);
  return applied(text, result.edit);
}

describe("v1.15 FR-007 -- what is not EditData throws, naming what it found", () => {
  const bytes = ENC.encode("a: 1\n");
  const bad: [string, unknown, RegExp][] = [
    ["a plain object", { x: 1 }, /plain object.*Map/],
    ["undefined", undefined, /undefined/],
    ["a symbol", Symbol("s"), /symbol/],
    ["a function", () => 1, /function/],
    ["a Set", new Set([1]), /Set/],
    ["a Date", new Date(0), /Date/],
    ["a Map with a number key", new Map([[1, "x"]]), /key that is number/],
    ["a sparse array", [1, , 3], /hole/],
    ["a plain object inside an array", [1, { x: 1 }], /value at \[1\].*plain object/],
    ["a plain object inside a Map", new Map([["k", { x: 1 }]]), /value at \["k"\].*plain object/],
  ];
  for (const [name, value, message] of bad) {
    it(`${name}: setValue throws, one-shot and opened`, () => {
      expect(() => setValue(bytes, yaml, "/a", value as EditData)).toThrow(message);
      const opened = openDocument(bytes, yaml);
      if (!opened.ok) throw new Error("did not open");
      expect(() => opened.document.setValue("/a", value as EditData)).toThrow(message);
    });
  }

  it("a cycle through an array throws", () => {
    const loop: unknown[] = [1];
    loop.push(loop);
    expect(() => setValue(bytes, yaml, "/a", loop as EditData)).toThrow(/contains itself/);
  });

  it("a cycle through a Map throws", () => {
    const loop = new Map<string, unknown>();
    loop.set("self", loop);
    expect(() => setValue(bytes, yaml, "/a", loop as EditData)).toThrow(/contains itself/);
  });

  it("the same array twice in one array is not a cycle", () => {
    const shared: EditData = [1n, 2n];
    expect(write("a: 1\n", "/a", [shared, shared])).toBe("a:\n  - - 1\n    - 2\n  - - 1\n    - 2\n");
  });

  it("a document that does not parse still returns its diagnostics for good data, and bad data still throws first", () => {
    expect(setValue(ENC.encode("a: [1, 2\n"), yaml, "/a", [1]).ok).toBe(false);
    expect(() => setValue(ENC.encode("a: [1, 2\n"), yaml, "/a", { x: 1 } as unknown as EditData)).toThrow(/plain object/);
  });

  it("the writers throw the same way", () => {
    expect(() => yamlWriter().write(bytes, "/a", { x: 1 } as unknown as EditData)).toThrow(/plain object/);
    expect(() => jsonWriter().write(ENC.encode('{"a": 1}'), "/a", new Map([[1, 1]]) as unknown as EditData)).toThrow(/key that is number/);
  });
});

describe("v1.15 FR-007 -- depth and size are the document's limits, refused as the read-back would (edit-read-back)", () => {
  const nest = (depth: number): EditData => {
    let value: EditData = 1;
    for (let i = 0; i < depth; i += 1) value = [value];
    return value;
  };
  it("data deeper than maxDepth is refused before it is spelled, as edit-read-back", () => {
    const result = setValue(ENC.encode("a: 1\n"), { ...yaml, limits: { maxDepth: 3 } }, "/a", nest(10));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe("edit-read-back");
  });

  it("data that fits alone but not where it goes is refused by the read-back itself, with the same code", () => {
    // The root mapping is depth 0 and `a`'s value depth 1, so [[[1]]] puts its scalar at depth 4: the reader refuses a document of maxDepth 3 that holds it.
    const result = setValue(ENC.encode("a: 1\n"), { ...yaml, limits: { maxDepth: 3 } }, "/a", nest(3));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe("edit-read-back");
    // ...and [[1]] puts it at depth 3, which the reader allows.
    expect(setValue(ENC.encode("a: 1\n"), { ...yaml, limits: { maxDepth: 3 } }, "/a", nest(2)).ok).toBe(true);
  });

  it("the same for JSON", () => {
    expect(setValue(ENC.encode('{"a": 1}'), { ...json, limits: { maxDepth: 3 } }, "/a", nest(3)).ok).toBe(false);
    expect(setValue(ENC.encode('{"a": 1}'), { ...json, limits: { maxDepth: 3 } }, "/a", nest(2)).ok).toBe(true);
  });

  it("a hostile depth does not overflow the stack: 100,000 levels are refused, not crashed on", () => {
    const result = setValue(ENC.encode("a: 1\n"), yaml, "/a", nest(100_000));
    expect(result.ok).toBe(false);
  });

  it("a DAG that expands to billions of nodes is refused by its node count, quickly", () => {
    let value: EditData = [1];
    for (let i = 0; i < 40; i += 1) value = [value, value];
    const started = performance.now();
    const result = setValue(ENC.encode("a: 1\n"), { ...yaml, limits: { maxBytes: 1000 } }, "/a", value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe("edit-read-back");
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("a value that would make the document larger than maxBytes is refused", () => {
    const result = setValue(ENC.encode("a: 1\n"), { ...yaml, limits: { maxBytes: 20 } }, "/a", ["a fairly long string", "another fairly long string"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe("edit-read-back");
  });
});

describe("v1.15 FR-007, FR-009 -- a mapping is a Map: its order is its own", () => {
  it("array-index keys stay where they were put, after a key that sorts later", () => {
    // A plain object would list `2` and `10` ahead of `b`; a Map keeps b, 2, 10 (CLAUDE.md, Known traps).
    expect(write("a: 1\n", "/a", new Map<string, EditData>([["b", 1n], ["2", 2n], ["10", 3n]]))).toBe('a:\n  b: 1\n  "2": 2\n  "10": 3\n');
  });

  it("a key `__proto__` is an ordinary key", () => {
    const text = write("a: 1\n", "/a", new Map<string, EditData>([["__proto__", 1n], ["x", 2n]]));
    expect(text).toBe("a:\n  __proto__: 1\n  x: 2\n");
    const reread = openDocument(ENC.encode(text), yaml);
    expect(reread.ok && reread.document.locate("/a/__proto__").ok).toBe(true);
  });

  it("an empty key and a key with a colon are quoted", () => {
    expect(write("a: 1\n", "/a", new Map<string, EditData>([["", 1n], ["k: v", 2n], ["#c", 3n]]))).toBe('a:\n  "": 1\n  "k: v": 2\n  "#c": 3\n');
  });
});

describe("v1.15 FR-008 -- the kind is the value's", () => {
  it("a container replaces a scalar and the reverse, in both formats", () => {
    expect(write("a: 1\nb: 2\n", "/a", [1n, 2n])).toBe("a:\n  - 1\n  - 2\nb: 2\n");
    expect(write("a:\n  - 1\n  - 2\nb: 2\n", "/a", "s")).toBe("a: s\nb: 2\n");
    expect(write('{"a": 1}', "/a", [1n, 2n], json)).toBe('{"a": [1, 2]}');
    expect(write('{"a": [1, 2]}', "/a", "s", json)).toBe('{"a": "s"}');
  });

  it("a mapping over a sequence and a sequence over a mapping", () => {
    expect(write("a:\n  - 1\nb: 2\n", "/a", new Map<string, EditData>([["k", 1n]]))).toBe("a:\n  k: 1\nb: 2\n");
    expect(write("a:\n  k: 1\nb: 2\n", "/a", [1n])).toBe("a:\n  - 1\nb: 2\n");
  });

  it("setting a container to an equal one writes the bytes already there, key order ignored (L1)", () => {
    const text = "m:\n  b: 2\n  a: 1\n";
    const result = setValue(ENC.encode(text), yaml, "/m", new Map<string, EditData>([["a", 1n], ["b", 2n]]));
    expect(result.ok && applied(text, result.edit)).toBe(text);
    const same = setValue(ENC.encode('{"x": [1, 2]}'), json, "/x", [1n, 2n]);
    expect(same.ok && DEC.decode(same.edit.bytes)).toBe("[1, 2]");
  });

  it("a container equal in shape but not in kind is not equal: 1 is an integer, 1.5 a float", () => {
    expect(write("a: [1]\n", "/a", [1.5])).toBe("a: [1.5]\n");
    expect(write("a: [1.0]\n", "/a", [1n])).toBe("a: [1]\n");
  });

  it("an empty container is written inline", () => {
    expect(write("a:\n  b: 1\nc: 2\n", "/a", [])).toBe("a: []\nc: 2\n");
    expect(write("a: 1\n", "/a", new Map())).toBe("a: {}\n");
  });

  it("edit-container is still what editTarget gives, and no longer what the writer gives", () => {
    const result = setValue(ENC.encode("a:\n  b: 1\n"), yaml, "/a", 5);
    expect(result.ok).toBe(true);
  });
});

describe("v1.15 FR-009 -- style is copied from the neighbours", () => {
  it("a sibling written flow makes the new container flow", () => {
    expect(write("a: [1, 2]\nb: 1\n", "/b", [3n, 4n])).toBe("a: [1, 2]\nb: [3, 4]\n");
    expect(write("a: {x: 1}\nb: 1\n", "/b", new Map<string, EditData>([["w", 2n]]))).toBe("a: {x: 1}\nb: {w: 2}\n");
  });

  it("a sibling written block makes it block", () => {
    expect(write("a:\n  - 1\nb: 1\n", "/b", [3n, 4n])).toBe("a:\n  - 1\nb:\n  - 3\n  - 4\n");
  });

  it("the replaced container's own style wins: a flow sequence stays flow, a block one stays block", () => {
    expect(write("a: [1]\nb:\n  - 1\n", "/a", [2n, 3n])).toBe("a: [2, 3]\nb:\n  - 1\n");
    expect(write("a: [1]\nb:\n  - 1\n", "/b", [2n, 3n])).toBe("a: [1]\nb:\n  - 2\n  - 3\n");
  });

  it("a sequence dash flush with its key stays flush; indented stays indented", () => {
    expect(write("x:\n- 1\ny: 1\n", "/y", [2n, 3n])).toBe("x:\n- 1\ny:\n- 2\n- 3\n");
    expect(write("x:\n  - 1\ny: 1\n", "/y", [2n, 3n])).toBe("x:\n  - 1\ny:\n  - 2\n  - 3\n");
  });

  it("the blanks after a colon are the sibling's", () => {
    // Three blanks after the sibling's colon; the new entry's `k:` takes the same three.
    expect(write("a:   1\nb: 2\n", "/b", new Map<string, EditData>([["k", 1n]]))).toBe("a:   1\nb:\n  k:   1\n");
  });

  it("with no sibling to copy, the document's own step is used: a four-space file nests by four", () => {
    expect(write("top:\n    inner: 1\nother: 1\n", "/other", new Map<string, EditData>([["a", new Map<string, EditData>([["b", 1n]])]]))).toBe("top:\n    inner: 1\nother:\n    a:\n        b: 1\n");
  });

  it("with no step in the document at all, two spaces", () => {
    expect(write("a: 1\n", "/a", new Map<string, EditData>([["b", new Map<string, EditData>([["c", 1n]])]]))).toBe("a:\n  b:\n    c: 1\n");
  });

  it("a document with no line break uses LF", () => {
    expect(write("a: 1", "/a", [1n, 2n])).toBe("a:\n  - 1\n  - 2");
  });

  it("a CRLF file gets CRLF lines and a lone-CR file gets CR lines", () => {
    expect(write("a: 1\r\nb: 2\r\n", "/a", [1n, 2n])).toBe("a:\r\n  - 1\r\n  - 2\r\nb: 2\r\n");
    expect(write("a: 1\rb: 2\r", "/a", [1n, 2n])).toBe("a:\r  - 1\r  - 2\rb: 2\r");
  });

  it("nothing writes an anchor, a tag or an alias", () => {
    const text = write("a: 1\n", "/a", new Map<string, EditData>([["x", [1, "s", null, true]]]));
    expect(text).not.toMatch(/[&*!]/);
  });

  it("strings follow Article IX's spelling: yes is quoted, a multi-line string is double-quoted, never a block scalar", () => {
    expect(write("a: 1\n", "/a", ["yes", "plain text", "two\nlines", "x: y", "-dash", ""])).toBe('a:\n  - "yes"\n  - plain text\n  - "two\\nlines"\n  - "x: y"\n  - "-dash"\n  - ""\n');
  });

  it("in flow, a string with a comma or a bracket is quoted", () => {
    expect(write("a: [1]\n", "/a", ["x,y", "[z]", "plain"])).toBe('a: ["x,y", "[z]", plain]\n');
  });

  it("numbers: a whole number is a decimal (v1.15 FR-027), a bigint an integer, a float, and the non-finite floats in YAML", () => {
    expect(write("a: 1\n", "/a", [3, 3n, 3.5, 12345678901234567890n, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0])).toBe("a:\n  - 3.0\n  - 3\n  - 3.5\n  - 12345678901234567890\n  - .nan\n  - .inf\n  - -.inf\n  - -0.0\n");
  });

  it("JSON has no NaN or infinity: refused as edit-unrepresentable, at the value it would have replaced", () => {
    const result = setValue(ENC.encode('{"a": 1}'), json, "/a", [1, Number.NaN]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe("edit-unrepresentable");
  });

  it("a string with an unpaired surrogate, as a value or as a key, is edit-unrepresentable", () => {
    for (const bad of [["\uD800"], new Map<string, EditData>([["\uDC00", 1]])]) {
      for (const [text, options] of [["a: 1\n", yaml], ['{"a": 1}', json]] as const) {
        const result = setValue(ENC.encode(text), options, "/a", bad);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.diagnostics[0]?.code).toBe("edit-unrepresentable");
      }
    }
  });
});

describe("v1.15 FR-010 -- JSON layout is copied", () => {
  it("one line stays one line; a document in which no container spans a line stays on one", () => {
    expect(write('{"a": 1, "b": 2}', "/a", [1n, 2n], json)).toBe('{"a": [1, 2], "b": 2}');
  });

  it("the blanks after the colon and the comma are the document's: a compact file stays compact", () => {
    expect(write('{"a":1,"b":2}', "/a", new Map<string, EditData>([["x", 1n], ["z", 2n]]), json)).toBe('{"a":{"x": 1, "z": 2},"b":2}'.replace('"x": 1, "z": 2', '"x":1,"z":2'));
  });

  it("a nested container inside a multi-line one is multi-line too, at the document's step", () => {
    const text = '{\n    "a": 1\n}\n';
    expect(write(text, "/a", new Map<string, EditData>([["x", [1n]]]), json)).toBe('{\n    "a": {\n        "x": [\n            1\n        ]\n    }\n}\n');
  });
});

describe("v1.15 FR-014 -- the read-back compares the whole tree (shown with plans that are wrong)", () => {
  /** A format whose replace plan is the real one with its range widened by `extra` bytes -- eating what follows. */
  const widening = (extra: number) => (format: FormatOpened): FormatOpened => ({
    ...format,
    replace: (found, pointer, data) => {
      const plan = format.replace(found, pointer, data);
      return plan.ok ? { ...plan, end: plan.end + extra } : plan;
    },
  });

  it("a plan that eats the next sibling is refused as edit-read-back, though the value at the pointer reads right", () => {
    const text = "a:\n  x: 1\nb: 2\nc: 3\n";
    const sound = openDocument(ENC.encode(text), yaml);
    if (!sound.ok) throw new Error("did not open");
    expect(sound.document.setValue("/a", new Map([["x", 9]])).ok).toBe(true);
    const tampered = openDocumentUsing(ENC.encode(text), yaml, widening(5));
    if (!tampered.ok) throw new Error("did not open");
    // `b: 2\n` is gone, and /a/x still reads 9: only a comparison of the whole tree notices.
    const result = tampered.document.setValue("/a", new Map([["x", 9]]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe("edit-read-back");
  });

  it("the same for JSON", () => {
    const text = '{"a": {"x": 1}, "b": 2}';
    const tampered = openDocumentUsing(ENC.encode(text), json, widening(0));
    if (!tampered.ok) throw new Error("did not open");
    const drop = (format: FormatOpened): FormatOpened => ({
      ...format,
      replace: (found, pointer, data) => {
        const plan = format.replace(found, pointer, data);
        return plan.ok ? { ...plan, text: `${plan.text}, "c": 3` } : plan;
      },
    });
    const extra = openDocumentUsing(ENC.encode(text), json, drop);
    if (!extra.ok) throw new Error("did not open");
    // The value at /a reads right and /b is intact, but a key was added: the whole tree differs.
    expect(extra.document.setValue("/a", new Map([["y", 2]])).ok).toBe(false);
  });
});
