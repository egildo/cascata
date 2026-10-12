/**
 * v1.15 Part A -- the opened document (specs/025-open-insert-delete, FR-001 to FR-006, FR-025).
 *
 * Every parse count is taken with `parseCalls()` / `tokenizeCalls()` (src/adapters/parse-count.ts), a
 * counter of the work, never a clock. Offsets are counted by hand from the text.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createOrigin, locate, openDocument, setValue } from "../../src/index.js";
import type { EditOptions, EditValue } from "../../src/index.js";
import { parentWalkCalls, parseCalls, tokenizeCalls } from "../../src/adapters/parse-count.js";
import { jsonWriter, yamlWriter } from "../../src/writers.js";
import { loadWriteCase, writeSourceOf } from "../corpus/write-case.js";

const ENC = new TextEncoder();
const origin = createOrigin("opened", "opened");
const yaml: EditOptions = { format: "yaml", origin };
const json: EditOptions = { format: "json", origin };

function opened(text: string, options: EditOptions = yaml) {
  const result = openDocument(ENC.encode(text), options);
  if (!result.ok) throw new Error("did not open");
  return result.document;
}

/** The number of parses `run` costs. */
function parses(run: () => void): number {
  const before = parseCalls();
  run();
  return parseCalls() - before;
}

describe("v1.15 FR-001 -- openDocument", () => {
  it("is exported from the package root and answers ok with a document", () => {
    const result = openDocument(ENC.encode("a: 1\n"), yaml);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.document).sort()).toEqual(["add", "amend", "inside", "locate", "remove", "setValue", "shifted"]);
  });

  it("a document that does not parse gives the parse's own diagnostics, as locate does", () => {
    const bytes = ENC.encode("a: [1, 2\n");
    const direct = locate(bytes, yaml, "/a");
    const result = openDocument(bytes, yaml);
    expect(result.ok).toBe(false);
    expect(direct.ok).toBe(false);
    if (!result.ok && !direct.ok) expect(result.diagnostics.map((d) => [d.code, d.primary.start, d.primary.end])).toEqual(direct.diagnostics.map((d) => [d.code, d.primary.start, d.primary.end]));
  });

  it("a JSON document that does not parse does the same", () => {
    const result = openDocument(ENC.encode('{"a": '), json);
    expect(result.ok).toBe(false);
  });

  it("programmer error throws: no origin, a bad format, a bad policy", () => {
    const bytes = ENC.encode("a: 1\n");
    expect(() => openDocument(bytes, { format: "yaml" } as unknown as EditOptions)).toThrow(/origin/);
    expect(() => openDocument(bytes, { format: "toml", origin } as unknown as EditOptions)).toThrow(/format/);
    expect(() => openDocument(bytes, { ...yaml, sharedEdits: "sometimes" } as unknown as EditOptions)).toThrow(/sharedEdits/);
  });

  it("a malformed pointer given to the document throws, as to the one-shot verbs", () => {
    const document = opened("a: 1\n");
    expect(() => document.locate("a")).toThrow(/JSON Pointer/);
    expect(() => document.setValue("a", 1)).toThrow(/JSON Pointer/);
  });
});

describe("v1.15 FR-002 -- the document copies the bytes it is given", () => {
  it("overwriting the caller's array afterwards changes nothing the document answers", () => {
    // `a: 1\nb: 2\n`: a's value is byte 3, b's is byte 8.
    const bytes = ENC.encode("a: 1\nb: 2\n");
    const result = openDocument(bytes, yaml);
    if (!result.ok) throw new Error("did not open");
    bytes.fill(0x7a); // "zzzzzzzzzz"
    expect(result.document.locate("/b")).toEqual({ ok: true, start: 8, end: 9, kind: "int" });
    expect(result.document.setValue("/a", 7)).toEqual({ ok: true, edit: { start: 3, end: 4, bytes: ENC.encode("7") }, diagnostics: [] });
  });

  it("the same for JSON, whose finder never touches a tag", () => {
    const bytes = ENC.encode('{"a": 1}');
    const result = openDocument(bytes, json);
    if (!result.ok) throw new Error("did not open");
    bytes.fill(0x20);
    expect(result.document.locate("/a")).toEqual({ ok: true, start: 6, end: 7, kind: "int" });
  });

  it("an L1 edit's bytes are a copy too: changing them changes nothing the document holds", () => {
    const document = opened("a: 0x1F\n"); // not an integer to spell by hand: the bytes already there stay
    const first = document.setValue("/a", 31);
    expect(first.ok).toBe(true);
    if (first.ok) {
      first.edit.bytes.fill(0x21);
      const second = document.setValue("/a", 31);
      expect(second.ok && new TextDecoder().decode(second.edit.bytes)).toBe("0x1F");
    }
  });
});

describe("v1.15 FR-003 -- every answer is against the bytes as opened", () => {
  it("applying an answered edit leaves the document as it was", () => {
    const document = opened("a: 1\nb: 2\n");
    const edit = document.setValue("/a", 100);
    expect(edit).toEqual({ ok: true, edit: { start: 3, end: 4, bytes: ENC.encode("100") }, diagnostics: [] });
    // `b`'s value is still byte 8 of the bytes as opened, not byte 10 of the edited ones.
    expect(document.locate("/b")).toEqual({ ok: true, start: 8, end: 9, kind: "int" });
    expect(document.setValue("/b", 200)).toEqual({ ok: true, edit: { start: 8, end: 9, bytes: ENC.encode("200") }, diagnostics: [] });
    expect(document.setValue("/a", 100)).toEqual(edit);
  });

  it("two independent edits of one opened document do not overlap and apply together", () => {
    const document = opened("a: 1\nb: 2\n");
    const a = document.setValue("/a", 10);
    const b = document.setValue("/b", 20);
    if (!a.ok || !b.ok) throw new Error("not answered");
    // The caller applies the later one first: the offsets are those of the original bytes.
    let text = "a: 1\nb: 2\n";
    for (const { edit } of [b, a]) text = text.slice(0, edit.start) + new TextDecoder().decode(edit.bytes) + text.slice(edit.end);
    expect(text).toBe("a: 10\nb: 20\n");
  });
});

describe("v1.15 FR-003 -- an opened document answers what the one-shot verbs answer, over the whole write corpus", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "write-cases");
  const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  const plain = (r: ReturnType<typeof setValue>) => (r.ok ? { ok: true, edit: r.edit, diagnostics: r.diagnostics.map((d) => [d.level, d.code, d.message, d.primary.start, d.primary.end]) } : { ok: false, diagnostics: r.diagnostics.map((d) => [d.code, d.message, d.primary.start, d.primary.end]) });
  for (const file of files) {
    const testCase = loadWriteCase(join(dir, file));
    if (testCase.call !== "locate" && testCase.call !== "setValue") continue;
    const bytes = writeSourceOf(testCase);
    const options: EditOptions = { format: testCase.format, origin, sharedEdits: testCase.sharedEdits };
    it(`${testCase.name}: opened == one-shot`, () => {
      const result = openDocument(bytes, options);
      if (!result.ok) {
        expect(locate(bytes, options, testCase.pointer).ok).toBe(false);
        return;
      }
      const a = result.document.locate(testCase.pointer);
      const b = locate(bytes, options, testCase.pointer);
      expect(a.ok).toBe(b.ok);
      if (a.ok && b.ok) expect(a).toEqual(b);
      if (testCase.call === "setValue") {
        const value = testCase.value as EditValue;
        expect(plain(result.document.setValue(testCase.pointer, value))).toEqual(plain(setValue(bytes, options, testCase.pointer, value)));
      }
    });
  }
});

describe("v1.15 FR-004, FR-025 -- parse once, counted", () => {
  const TEXT = "a: 1\nb: two\nc:\n  d: 3.5\n  e: true\n";

  it("opening parses once", () => {
    expect(parses(() => opened(TEXT))).toBe(1);
  });

  it("N locates on one opened document parse once -- the opening's -- and nothing more (YAML)", () => {
    expect(
      parses(() => {
        const document = opened(TEXT);
        for (const pointer of ["/a", "/b", "/c", "/c/d", "/c/e", "/zzz", "", "/a", "/c/d"]) document.locate(pointer);
      }),
    ).toBe(1);
  });

  it("N locates on one opened JSON document parse once", () => {
    expect(
      parses(() => {
        const document = opened('{"a": 1, "b": [1, 2]}', json);
        for (const pointer of ["/a", "/b", "/b/0", "/b/1", "/x", ""]) document.locate(pointer);
      }),
    ).toBe(1);
  });

  it("N answered setValues parse N + 1 times: the opening and one read-back each", () => {
    expect(
      parses(() => {
        const document = opened(TEXT);
        for (const [pointer, value] of [["/a", 2], ["/b", "x"], ["/c/d", 9.5], ["/c/e", false]] as const) expect(document.setValue(pointer, value).ok).toBe(true);
      }),
    ).toBe(1 + 4);
  });

  it("the same for JSON", () => {
    expect(
      parses(() => {
        const document = opened('{"a": 1, "b": 2}', json);
        for (const [pointer, value] of [["/a", 5], ["/b", 6], ["/a", 7]] as const) expect(document.setValue(pointer, value).ok).toBe(true);
      }),
    ).toBe(1 + 3);
  });

  it("a refusal and a nothing-changed answer parse no more than the opening: there is no edit to read back", () => {
    expect(
      parses(() => {
        const document = opened("a: 1\nb: |\n  text\n");
        expect(document.setValue("/zzz", 1).ok).toBe(false); // absent
        expect(document.setValue("/b", "x").ok).toBe(false); // block scalar
        expect(document.setValue("/a", 1).ok).toBe(true); // L1: the bytes already there
      }),
    ).toBe(1);
  });

  it("the one-shot verbs cost what they cost before: locate one parse, setValue two", () => {
    const bytes = ENC.encode(TEXT);
    expect(parses(() => locate(bytes, yaml, "/a"))).toBe(1);
    expect(parses(() => setValue(bytes, yaml, "/a", 2))).toBe(2);
    expect(parses(() => setValue(bytes, yaml, "/zzz", 2))).toBe(1);
    const jsonBytes = ENC.encode('{"a": 1}');
    expect(parses(() => locate(jsonBytes, json, "/a"))).toBe(1);
    expect(parses(() => setValue(jsonBytes, json, "/a", 2))).toBe(2);
  });

  it("the writer's open costs the same: one parse, then N writes cost N more", () => {
    const bytes = ENC.encode(TEXT);
    expect(
      parses(() => {
        const result = yamlWriter().open(bytes);
        if (!result.ok) throw new Error("did not open");
        result.document.locate("/a");
        result.document.locate("/b");
        expect(result.document.write("/a", 2).ok).toBe(true);
        expect(result.document.write("/b", "z").ok).toBe(true);
      }),
    ).toBe(1 + 2);
  });

  it("the CST tokens a tag's removal reads are computed once per document, however many tags are dropped", () => {
    // Two `!!int` scalars set to strings: each edit must find its tag in the parser's tokens.
    const document = opened("a: !!int 1\nb: !!int 2\nc: !!int 3\n");
    const before = tokenizeCalls();
    expect(document.setValue("/a", "x").ok).toBe(true);
    expect(document.setValue("/b", "y").ok).toBe(true);
    expect(document.setValue("/c", "z").ok).toBe(true);
    expect(tokenizeCalls() - before).toBe(1);
  });

  it("a document with no tag to drop never tokenizes", () => {
    const document = opened(TEXT);
    const before = tokenizeCalls();
    document.setValue("/a", 5);
    document.setValue("/c/d", 5.5);
    expect(tokenizeCalls() - before).toBe(0);
  });

  it("the aliases that hold a node are found from a parent map built once per document", () => {
    // Under "warn" every edit of an anchored value names its aliases; the walk that finds each node's parent runs once.
    const document = opened("base: &b 1\nx: *b\ny: *b\nz: &c 2\nw: *c\n", { ...yaml, sharedEdits: "warn" });
    const before = parseCalls();
    const walks = parentWalkCalls();
    expect(document.setValue("/base", 5).ok).toBe(true);
    expect(document.setValue("/z", 6).ok).toBe(true);
    expect(parseCalls() - before).toBe(2); // the read-backs only
    expect(parentWalkCalls() - walks).toBe(1);
  });
});

describe("v1.15 FR-006 -- writers gain open", () => {
  it("a writer is claims, locate, write and open", () => {
    expect(Object.keys(yamlWriter()).sort()).toEqual(["claims", "locate", "open", "write"]);
    expect(Object.keys(jsonWriter()).sort()).toEqual(["claims", "locate", "open", "write"]);
  });

  it("open answers a document with locate and write in the shapes locate and write already have", () => {
    const bytes = ENC.encode("a: 1\nb: 2\n");
    const opened = yamlWriter().open(bytes);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(Object.keys(opened.document).sort()).toEqual(["add", "amend", "inside", "locate", "remove", "shifted", "write"]);
    expect(opened.document.locate("/b")).toEqual(yamlWriter().locate(bytes, "/b"));
    expect(opened.document.locate("/b")).toEqual({ ok: true, start: 8, end: 9 });
    expect(opened.document.write("/b", 3)).toEqual(yamlWriter().write(bytes, "/b", 3));
    expect(opened.document.write("/b", 3)).toEqual({ ok: true, edit: { start: 8, end: 9, bytes: ENC.encode("3") }, diagnostics: [] });
    expect(opened.document.locate("/zzz").ok).toBe(false);
  });

  it("a document that does not parse is { ok: false, reason } with the first diagnostic's message", () => {
    const result = jsonWriter().open(ENC.encode("{"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(typeof result.reason).toBe("string");
  });

  it("a writer made with sharedEdits opens documents under that policy", () => {
    const bytes = ENC.encode("base: &b 1\nx: *b\n");
    const refuse = yamlWriter().open(bytes);
    const warn = yamlWriter({ sharedEdits: "warn" }).open(bytes);
    if (!refuse.ok || !warn.ok) throw new Error("did not open");
    expect(refuse.document.write("/base", 2).ok).toBe(false);
    const written = warn.document.write("/base", 2);
    expect(written.ok && written.diagnostics.length).toBe(1);
  });

  it("opening copies the bytes", () => {
    const bytes = ENC.encode("a: 1\n");
    const result = yamlWriter().open(bytes);
    bytes.fill(0x20);
    if (result.ok) expect(result.document.locate("/a")).toEqual({ ok: true, start: 3, end: 4 });
  });
});
