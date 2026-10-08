/**
 * Wall-clock tests, moved out of the parallel run (specs/020-edit-targets, round 2).
 *
 * `pnpm test` runs the main suite, then this project (`vitest.timing.config.ts`) with one file
 * at a time and nothing else alongside. The assertion is the one it always was, moved verbatim
 * from `tests/unit/bounded-cost.test.ts`, whose copy of this case now counts the work instead.
 */
import { describe, expect, it } from "vitest";
import { parse } from "../../src/index.js";
import type { ParseLimits } from "../../src/adapters/limits.js";

const origin = { id: "b", label: "<b>" };
const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const read = (text: string, limits?: Partial<ParseLimits>) => parse(enc(text), { origin, ...(limits ? { limits } : {}) });
const refusals = (text: string, limits?: Partial<ParseLimits>): string[] => {
  const result = read(text, limits);
  return result.ok ? [] : result.diagnostics.map((d) => d.code);
};

describe("the bomb (FR-003, FR-004)", () => {
  const bomb = (levels: number): string => {
    let text = `l0: &l0 [${Array(10).fill("x").join(",")}]\n`;
    for (let i = 1; i <= levels; i += 1) text += `l${i}: &l${i} [${Array(10).fill(`*l${i - 1}`).join(",")}]\n`;
    return text;
  };

  it("eight levels (430 bytes: 30 for l0 and 50 a level) is refused at once, in well under a second, never built", () => {
    const text = bomb(8);
    expect(text.length).toBe(430);
    const start = performance.now();
    expect(refusals(text)).toEqual(["expansion-limit-exceeded"]);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
