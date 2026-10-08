/**
 * v1.12 FR-001, FR-002, FR-004 — a node's column is two lookups in a table built with the byte
 * table, and answers what counting from the line's start answered.
 *
 * Every number below is counted by hand from the input written out beside it, never from a run
 * (the probe gate: these inputs were run against the counting `codePointColumn` before the table
 * replaced it, and the answers recorded in specs/022-after-the-review/report.md).
 */
import { describe, expect, it } from "vitest";
import { parse } from "../../src/index.js";
import { buildColumnTable } from "../../src/adapters/yaml/parse.js";
import { resolvePointer } from "../../src/model/pointer.js";

const origin = { id: "columns", label: "<columns>" };

function at(text: string, pointer: string): [number, number, number, number] {
  const result = parse(new TextEncoder().encode(text), { origin });
  if (!result.ok) throw new Error(`${JSON.stringify(text)}: ${result.diagnostics.map((d) => d.code).join(", ")}`);
  const node = resolvePointer(result.tree, pointer);
  if (node === undefined) throw new Error(`${JSON.stringify(text)}: nothing at ${pointer}`);
  return [node.span.start, node.span.end, node.span.line, node.span.column];
}

// [name, text, pointer, [start, end, line, column]]
const TABLE: readonly (readonly [string, string, string, readonly [number, number, number, number]])[] = [
  // a0 :1 sp2 [3 😀4-7 ,8 sp9 x10 — columns a1 :2 sp3 [4 😀5 ,6 sp7 x8
  ["astral: two units, one column (the astral itself)", "a: [\u{1F600}, x]\n", "/a/0", [4, 8, 1, 5]],
  ["astral: two units, one column (after it)", "a: [\u{1F600}, x]\n", "/a/1", [10, 11, 1, 8]],
  // a0 :1 sp2 [3 e4 U+0301 5-6 ,7 sp8 x9 — columns ... [4 e5 U+0301 6 ,7 sp8 x9
  ["combining sequence: each code point a column", "a: [e\u0301, x]\n", "/a/1", [9, 10, 1, 9]],
  // mark0-2 a3 :4 sp5 [6 b7 ,8 sp9 c10 — the mark at stored index 0 is no column: a1 ... c8
  ["mark at stored index 0: not a column (the root)", "\uFEFFa: [b, c]\n", "", [3, 12, 1, 1]],
  ["mark at stored index 0: not a column (after it)", "\uFEFFa: [b, c]\n", "/a/1", [10, 11, 1, 8]],
  // a0 :1 sp2 [3 "4 mark5-7 "8 ,9 sp10 x11 — columns [4 "5 mark6 "7 ,8 sp9 x10
  ["mark mid-line, inside quotes: a column", "a: [\"\uFEFF\", x]\n", "/a/1", [11, 12, 1, 10]],
  // mark0-2 mark3-5 a6 :7 sp8 1(9) — the second mark (stored index 1) is a column: a2 :3 sp4 1(5)
  ["a second prefix mark: a column", "\uFEFF\uFEFFa: 1\n", "/a", [9, 10, 1, 5]],
  // a0 :1 sp2 1(3) CR4 LF5 b6 :7 sp8 [9 x10 ,11 sp12 y13
  ["CRLF", "a: 1\r\nb: [x, y]\r\n", "/b/1", [13, 14, 2, 8]],
  ["CRLF (the flow sequence)", "a: 1\r\nb: [x, y]\r\n", "/b", [9, 15, 2, 4]],
  // a0 :1 sp2 1(3) CR4 b5 :6 sp7 [8 x9 ,10 sp11 y12
  ["a lone CR", "a: 1\rb: [x, y]\r", "/b/1", [12, 13, 2, 8]],
  // a0 :1 sp2 1(3) LF4 LF5 b6 :7 sp8 [9 x10 ,11 sp12 y13
  ["an empty line", "a: 1\n\nb: [x, y]\n", "/b/1", [13, 14, 3, 8]],
  // a0 :1 sp2 1(3) LF4 b5 :6 sp7 [8 x9 ,10 sp11 y12, and no line break after ]
  ["a last line without a line break", "a: 1\nb: [x, y]", "/b/1", [12, 13, 2, 8]],
];

describe("v1.12 FR-002 — columns on the probe table", () => {
  for (const [name, text, pointer, expected] of TABLE) {
    it(name, () => {
      expect(at(text, pointer)).toEqual(expected);
    });
  }
});

describe("v1.12 FR-001 — the column table itself", () => {
  it("counts code points before each UTF-16 index, the mark at index 0 excepted", () => {
    // "\uFEFF a 😀 \u0301 \uFEFF b" as UTF-16 units: mark0 a1 hi2 lo3 U+0301(4) mark5 b6, length 7.
    // Columns before each index (the mark at 0 is never one; the mark at 5 is):
    //   0:0  1:0  2:1  3:1 (the low half gets its pair's count)  4:2  5:3  6:4  7:5
    expect([...buildColumnTable("\uFEFFa\u{1F600}\u0301\uFEFFb")]).toEqual([0, 0, 1, 1, 2, 3, 4, 5]);
  });

  it("without a leading mark, every code point counts", () => {
    // a0 \n1 b2 c3, length 4: 0 1 2 3 4
    expect([...buildColumnTable("a\nbc")]).toEqual([0, 1, 2, 3, 4]);
  });
});
