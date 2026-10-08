/**
 * v1.10 (specs/019-bounded-cost, round 2): Cascata's own duplicate-key check
 * is the only one, and it is linear.
 *
 * `yaml`'s `parseDocument` checks every new pair against every pair already in
 * its mapping (`uniqueKeys`, on by default): one flat mapping of 32,000 keys
 * took 11.9 s there and 154 ms with it off. Cascata never used that error (it
 * reports a duplicate with the first occurrence attached, which `yaml`'s does
 * not), so the reader passes `uniqueKeys: false`. This file proves nothing
 * observable moved and that the cost is linear.
 */

import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { locate, parseText, setValue } from "../../src/index.js";
import { parse } from "../../src/index.js";

const origin = { id: "d", label: "<d>" };
const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const diagnosticsOf = (text: string) => {
  const result = parseText(text, { origin });
  return result.ok ? [] : result.diagnostics;
};
const where = (text: string) => diagnosticsOf(text).map((d) => ({ code: d.code, start: d.primary.start, end: d.primary.end, line: d.primary.line, column: d.primary.column, related: d.related.map((r) => [r.label, r.span.start, r.span.end]) }));

describe("a duplicate key is reported by Cascata, with the first occurrence attached — hand-counted", () => {
  const MESSAGE = "The same key appears more than once in this mapping";
  it("plain: the later key, the first as related", () => {
    expect(where("a: 1\na: 2\n")).toEqual([{ code: "duplicate-key", start: 5, end: 6, line: 2, column: 1, related: [["first occurrence", 0, 1]] }]);
    expect(diagnosticsOf("a: 1\na: 2\n")[0]?.message).toBe(MESSAGE);
  });
  it("differing only by quoting: a and \"a\" (the later key's span includes its quotes)", () => {
    expect(where('a: 1\n"a": 2\n')).toEqual([{ code: "duplicate-key", start: 5, end: 8, line: 2, column: 1, related: [["first occurrence", 0, 1]] }]);
    expect(where("a: 1\n'a': 2\n")).toEqual([{ code: "duplicate-key", start: 5, end: 8, line: 2, column: 1, related: [["first occurrence", 0, 1]] }]);
  });
  it("differing only by an escape: \"\\u0061\" is a", () => {
    expect(where('a: 1\n"\\u0061": 2\n').map((d) => d.code)).toEqual(["duplicate-key"]);
  });
  it("in a flow mapping", () => {
    expect(where("{a: 1, a: 2}\n")).toEqual([{ code: "duplicate-key", start: 7, end: 8, line: 1, column: 8, related: [["first occurrence", 1, 2]] }]);
  });
  it("non-ASCII: the bytes, not the UTF-16 units (é is two)", () => {
    expect(where("é: 1\né: 2\n")).toEqual([{ code: "duplicate-key", start: 6, end: 8, line: 2, column: 1, related: [["first occurrence", 0, 2]] }]);
  });
  it("three occurrences: two diagnostics, both naming the first", () => {
    expect(where("a: 1\nb: 2\na: 3\na: 4\n")).toEqual([
      { code: "duplicate-key", start: 10, end: 11, line: 3, column: 1, related: [["first occurrence", 0, 1]] },
      { code: "duplicate-key", start: 15, end: 16, line: 4, column: 1, related: [["first occurrence", 0, 1]] },
    ]);
  });
  it("a key written twice around a merge key; a written key beside a merged one is not a duplicate", () => {
    // `base: &b {x: 1}⏎` is 16 bytes; in line 2, `x` is at 20 and again at 34.
    expect(where("base: &b {x: 1}\nw: {x: 1, <<: *b, x: 2}\n")).toEqual([{ code: "duplicate-key", start: 34, end: 35, line: 2, column: 19, related: [["first occurrence", 20, 21]] }]);
    expect(where("base: &b {x: 1}\nw: {<<: *b, x: 2}\n")).toEqual([]);
  });
  it("the same key through an alias: &k a and *k (yaml's own check never saw this one)", () => {
    expect(where("&k a: 1\n*k : 2\n").map((d) => [d.code, d.start])).toEqual([["duplicate-key", 8]]);
  });
});

describe("nothing yaml's DUPLICATE_KEY used to flag goes unflagged", () => {
  const BATTERY = [
    "a: 1\na: 2\n", 'a: 1\n"a": 2\n', "a: 1\n'a': 2\n", "{a: 1, a: 2}\n", 'x: {a: 1, "a": 2}\n', "a: 1\nb: 2\na: 3\na: 4\n",
    "base: &b {x: 1}\nw: {x: 1, <<: *b, x: 2}\n", "a: &b {x: 1, x: 2}\nw: {<<: *b}\n", "é: 1\né: 2\n", 'a: 1\n"\\u0061": 2\n', "a: 1\n? a\n: 2\n",
    "a : 1\na: 2\n", "- {a: 1, a: 2}\n- {b: 1, b: 2}\n", "a:\n  b: 1\n  b: 2\nc:\n  d: 1\n  d: 2\n", "~: 1\nnull: 2\n", "'': 1\n\"\": 2\n", "日本: 1\n日本: 2\n",
    "x: &x {a: 1}\ny: &y {<<: *x, a: 2}\nz: {<<: [*x, *y], q: 1, q: 2}\n",
  ];
  it("every pair yaml reports as a duplicate is a Cascata duplicate-key, or a key Cascata refuses outright, at the same byte", () => {
    let flagged = 0;
    for (const text of BATTERY) {
      const errors = parseDocument(text, { merge: true }).errors.filter((e) => e.code === "DUPLICATE_KEY");
      const mine = diagnosticsOf(text);
      for (const error of errors) {
        flagged += 1;
        const byte = enc(text.slice(0, error.pos[0])).length;
        expect(
          mine.some((d) => (d.code === "duplicate-key" || d.code === "non-string-key") && d.primary.start === byte),
          `${JSON.stringify(text)}: yaml flagged ${error.pos[0]}, Cascata said ${JSON.stringify(mine.map((d) => [d.code, d.primary.start]))}`,
        ).toBe(true);
      }
    }
    expect(flagged).toBeGreaterThan(15); // not vacuous
  });

  it("and the diagnostics a duplicate yields are never yaml's: no malformed-document for any of them", () => {
    for (const text of BATTERY) expect(diagnosticsOf(text).map((d) => d.code), JSON.stringify(text)).not.toContain("malformed-document");
  });
});
