/**
 * v1.10 (specs/019-bounded-cost) FR-003 to FR-006 — the expansion budget.
 *
 * W is the number of model nodes a document writes (an alias counts one,
 * keys are not nodes); E is the number in the expanded tree. A document is
 * refused when E > ratio x W + allowance (defaults 10 and 10,000), counted as
 * the expansion proceeds. Every W and E below is counted by hand from the
 * text; they are pinned through the budget itself, which refuses at E and
 * accepts at E + 1: with `expansionRatio: 0` the budget is the allowance, so
 * an allowance of E - 1 refuses and E loads, and with ratio 1 and allowance 0
 * the budget is W.
 */

import { describe, expect, it } from "vitest";
import { locate, parse, parseText, setValue } from "../../src/index.js";
import type { ParseLimits } from "../../src/adapters/limits.js";
import { parseJsonBytes } from "../../src/adapters/json/parse.js";
import { nodesEqual } from "../../src/model/equality.js";

const origin = { id: "b", label: "<b>" };
const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const read = (text: string, limits?: Partial<ParseLimits>) => parse(enc(text), { origin, ...(limits ? { limits } : {}) });
const refusals = (text: string, limits?: Partial<ParseLimits>): string[] => {
  const result = read(text, limits);
  return result.ok ? [] : result.diagnostics.map((d) => d.code);
};

/** Hand-counted documents: W (written) and E (expanded). */
const COUNTED: readonly { name: string; text: string; w: number; e: number }[] = [
  // root 1 + base (mapping, x, y) 3 + w (mapping, merge value *b, z) 3 = 7 written.
  // Expanded: root 1 + base 3 + w (mapping, z, and the merged x, y — the source mapping is not a node) 4 = 8.
  { name: "a merge key", text: "base: &b {x: 1, y: 2}\nw: {<<: *b, z: 3}\n", w: 7, e: 8 },
  // root 1 + a (seq, 1, 2) 3 + b (seq, *a, *a) 3 + c (*b) 1 = 8.
  // Expanded: root 1 + a 3 + b (1 + 2 x 3) 7 + c 7 = 18.
  { name: "an alias inside an anchored node", text: "a: &a [1, 2]\nb: &b [*a, *a]\nc: *b\n", w: 8, e: 18 },
  // root 1 + a (seq, 1, 2, 3) 4 + *x 1 + c 1 + *x 1 = 8.
  // Expanded: root 1 + 4 + (b: the first x, 4) + 1 + (d: the second x, a scalar, 1) = 11.
  { name: "an anchor redefined between two aliases", text: "a: &x [1, 2, 3]\nb: *x\nc: &x 9\nd: *x\n", w: 8, e: 11 },
  // root 1 + seq (3) + alias 1 = 5. Expanded: 1 + 3 + 3 = 7.
  { name: "non-ASCII key and anchor name", text: "é: &日本 [1, 2]\nb: *日本\n", w: 5, e: 7 },
  // root 1 + a (2) + b (2) + w (mapping 1, the merge value's sequence 1, its two aliases 2) 4 = 9.
  // Expanded: root 1 + a 2 + b 2 + w (mapping 1 + merged x, y) 3 = 8.
  { name: "a merge key with a list of aliases", text: "a: &a {x: 1}\nb: &b {y: 2}\nw: {<<: [*a, *b]}\n", w: 9, e: 8 },
  // No alias: E is W. root 1 + seq 1 + 3 scalars = 5.
  { name: "no aliases at all", text: "a: [1, 2, 3]\n", w: 5, e: 5 },
];

describe("FR-003: W and E are counted as the formula says", () => {
  for (const { name, text, e } of COUNTED) {
    it(`E, ${name}: refused at an allowance of ${e - 1}, loads at ${e}`, () => {
      expect(refusals(text, { expansionRatio: 0, expansionAllowance: e - 1 })).toEqual(["expansion-limit-exceeded"]);
      expect(refusals(text, { expansionRatio: 0, expansionAllowance: e })).toEqual([]);
    });
  }
  for (const { name, text, w, e } of COUNTED) {
    it(`W, ${name}: the budget is ${w} at ratio 1 and allowance 0 (so E = ${e} ${e > w ? "is refused" : "loads"})`, () => {
      expect(refusals(text, { expansionRatio: 1, expansionAllowance: 0 })).toEqual(e > w ? ["expansion-limit-exceeded"] : []);
      expect(refusals(text, { expansionRatio: 1, expansionAllowance: e - w })).toEqual([]);
    });
  }
  it("and the W of the merge document is pinned from both sides (7: E = 8 is over it, 8 is not)", () => {
    const text = COUNTED[0]?.text ?? "";
    expect(refusals(text, { expansionRatio: 1, expansionAllowance: 0 })).toEqual(["expansion-limit-exceeded"]);
    expect(refusals(text, { expansionRatio: 1, expansionAllowance: 1 })).toEqual([]);
  });
});

describe("FR-003/FR-005: the defaults are 10 and 10,000, exactly", () => {
  // An anchor of k nodes (a sequence of k - 1 scalars) under `p`, and m bare aliases to it under `s`:
  // W = 1 (root) + k + 1 (the aliases' sequence) + m; E = 1 + k + 1 + m x k.
  const shared = (k: number, m: number): string => `p: &p [${Array.from({ length: k - 1 }, (_, i) => String(i)).join(",")}]\ns: [${Array.from({ length: m }, () => "*p").join(",")}]\n`;
  it("k = 38, m = 370: W = 410, E = 14,100 = 10 x 410 + 10,000 — loads", () => {
    expect(refusals(shared(38, 370))).toEqual([]);
  });
  it("k = 38, m = 371: W = 411, E = 14,138 > 14,110 — refused", () => {
    expect(refusals(shared(38, 371))).toEqual(["expansion-limit-exceeded"]);
  });
});

describe("the bomb (FR-003, FR-004)", () => {
  const bomb = (levels: number): string => {
    let text = `l0: &l0 [${Array(10).fill("x").join(",")}]\n`;
    for (let i = 1; i <= levels; i += 1) text += `l${i}: &l${i} [${Array(10).fill(`*l${i - 1}`).join(",")}]\n`;
    return text;
  };

  it("three levels (180 bytes, W = 45, E = 12,345, budget 10,450) stops at the ninth alias of l3, bytes 171-174, line 4, column 42", () => {
    const result = read(bomb(3));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    const [d] = result.diagnostics;
    expect(d?.code).toBe("expansion-limit-exceeded");
    expect(d?.level).toBe("error");
    expect([d?.primary.start, d?.primary.end, d?.primary.line, d?.primary.column]).toEqual([171, 174, 4, 42]);
    // The message names W, the budget, and the count it stopped at (the first node past the budget).
    expect(d?.message).toMatch(/\b45\b/);
    expect(d?.message).toMatch(/\b10450\b/);
    expect(d?.message).toMatch(/\b10451\b/);
  });

  // The wall-clock half of this case ("in well under a second") is tests/timing/bounded-cost.timing.test.ts.
  // Here the same fact is counted: W = 1 + 11 + 11 x 8 = 100, budget = 10 x 100 + 10,000 = 11,000, and the expansion
  // stopped at the first node past it, 11,001 -- of the 1.2 billion the eight levels would build -- so it was never built.
  it("eight levels (430 bytes: 30 for l0 and 50 a level) is refused at once, never built: the count stops at the budget, 11,001", () => {
    const text = bomb(8);
    expect(text.length).toBe(430);
    const result = read(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.code)).toEqual(["expansion-limit-exceeded"]);
    const message = result.diagnostics[0]?.message ?? "";
    expect(message).toMatch(/\b100\b/);
    expect(message).toMatch(/\b11000\b/);
    expect(message).toMatch(/\b11001\b/);
  });

  it("raised through the parse limits it loads (FR-005): ratio 1000 admits the three-level bomb", () => {
    const result = read(bomb(3), { expansionRatio: 1000 });
    expect(result.ok).toBe(true);
    if (result.ok && result.tree.type === "mapping") {
      const l3 = result.tree.entries.get("l3");
      expect(l3?.type === "sequence" && l3.items.length).toBe(10);
    }
  });

  it("parseText applies the same budget", () => {
    const result = parseText(bomb(3), { origin });
    expect(result.ok ? [] : result.diagnostics.map((d) => d.code)).toEqual(["expansion-limit-exceeded"]);
  });

  it("the writer reads through the same door: locate and setValue give the diagnostic, they do not hang", () => {
    const bytes = enc(bomb(8));
    const options = { format: "yaml", origin } as const;
    const located = locate(bytes, options, "/l0/0");
    const written = setValue(bytes, options, "/l0/0", 1);
    expect(located.ok ? [] : located.diagnostics.map((d) => d.code)).toEqual(["expansion-limit-exceeded"]);
    expect(written.ok ? [] : written.diagnostics.map((d) => d.code)).toEqual(["expansion-limit-exceeded"]);
  });
});

describe("a merge key's expansion is counted too", () => {
  // `a` is an anchored mapping of 200 scalars (201 nodes); each m_i is `{<<: *a}` (mapping + the alias = 2 written; 201 expanded).
  const merged = (n: number): string => `a: &a {${Array.from({ length: 200 }, (_, i) => `k${i}: 0`).join(", ")}}\n${Array.from({ length: n }, (_, i) => `m${i}: {<<: *a}`).join("\n")}\n`;
  it("65 merges: W = 1 + 201 + 130 = 332, E = 1 + 201 + 65 x 201 = 13,267 <= 13,320 — loads", () => {
    expect(refusals(merged(65))).toEqual([]);
  });
  it("66 merges: W = 334, E = 13,468 > 13,340 — refused at the merge value of the last one (line 67, column 11)", () => {
    const result = read(merged(66));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.code)).toEqual(["expansion-limit-exceeded"]);
    expect([result.diagnostics[0]?.primary.line, result.diagnostics[0]?.primary.column]).toEqual([67, 11]);
  });
});

describe("sharing that passes, and sharing that is refused — the strictness, named", () => {
  it("a 20-node profile shared by 1,000 walls: W = 22 + 4N, E = 22 + 23N — loads, and reads as the document written out", () => {
    const n = 1000;
    const profile = `{${Array.from({ length: 19 }, (_, i) => `f${i}: ${i}`).join(", ")}}`;
    const aliased = `profile: &p ${profile}\nwalls:\n${Array.from({ length: n }, (_, i) => `  - {id: ${i}, profile: *p, h: 3}`).join("\n")}\n`;
    const written = `profile: ${profile}\nwalls:\n${Array.from({ length: n }, (_, i) => `  - {id: ${i}, profile: ${profile}, h: 3}`).join("\n")}\n`;
    const a = read(aliased);
    const b = read(written);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(nodesEqual(a.tree, b.tree)).toBe(true);
  });

  // A 100-node anchor (a mapping of 99 scalars) and a sequence of 1,000 bare aliases to it:
  // W = 1 + 100 + 1 + 1,000 = 1,102; E = 1 + 100 + 1 + 100 x 1,000 = 100,102; budget 10 x 1,102 + 10,000 = 21,020.
  const strict = `p: &p {${Array.from({ length: 99 }, (_, i) => `k${i}: ${i}`).join(", ")}}\ns: [${Array(1000).fill("*p").join(",")}]\n`;
  it("a 100-node anchor and 1,000 bare aliases to it is refused (E = 100,102 > 21,020)", () => {
    expect(refusals(strict)).toEqual(["expansion-limit-exceeded"]);
  });
  it("the same document with expansionRatio: 100 loads (budget 120,220)", () => {
    expect(refusals(strict, { expansionRatio: 100 })).toEqual([]);
  });
});

describe("FR-006: JSON is unaffected", () => {
  it("a JSON document neither counts nor refuses, whatever the expansion limits say", () => {
    const text = `[${Array.from({ length: 5000 }, (_, i) => String(i)).join(",")}]`;
    const result = parseJsonBytes(enc(text), origin, { expansionRatio: 0, expansionAllowance: 0 });
    expect(result.ok).toBe(true);
  });
});
