/**
 * Wall-clock tests, moved out of the parallel run (specs/020-edit-targets, round 2).
 *
 * `pnpm test` runs the main suite, then this project (`vitest.timing.config.ts`) with one file
 * at a time and nothing else alongside, because every test here asserts on elapsed time or a
 * ratio of elapsed times and the parallel suite loads the machine. The assertions are the ones
 * they always were, moved verbatim from `tests/unit/anchor-table.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { parse } from "../../src/index.js";

describe("linear time: the witness (the sweep above is the guarantee)", () => {
  const lines = (n: number): string => {
    const out: string[] = [];
    for (let i = 0; i < n; i += 1) out.push(`a${i}: &a${i} ${i}`, `b${i}: *a${i}`);
    return `${out.join("\n")}\n`;
  };
  const fastest = (run: () => void): number => {
    let best = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const start = performance.now();
      run();
      best = Math.min(best, performance.now() - start);
    }
    return best;
  };
  /**
   * Cascata's read against `yaml`'s own `parseDocument` of the same text, with
   * its duplicate-key check off (as the reader runs it): the floor Cascata
   * cannot go below. Round 1 of this milestone mistook the superlinear cost it
   * saw in that parse for the composer's anchors; it was `uniqueKeys` (every
   * new pair against every pair before it in one mapping), and
   * `tests/unit/duplicate-keys.test.ts` owns it now. The 9.6 s that v1.10 removed
   * from alias resolution was all on Cascata's side of the line, so the witness
   * is the read relative to the parse beneath it.
   */
  const times = (n: number): { library: number; whole: number } => {
    const text = lines(n);
    const bytes = new TextEncoder().encode(text);
    const origin = { id: "t", label: "t" };
    return {
      library: fastest(() => void parseDocument(text, { merge: true, uniqueKeys: false })),
      whole: fastest(() => expect(parse(bytes, { origin }).ok).toBe(true)),
    };
  };
  it("reading 4,000 and 8,000 aliases costs a small multiple of yaml's own parse of them, not tens of times it", { timeout: 60_000 }, () => {
    for (const n of [4000, 8000]) {
      const { library, whole } = times(n);
      // Before v1.10: 9.6 s over a 0.3 s parse at 4,000 (32x), and growing with the square. Now ~1.1x.
      expect(whole, `${n} aliases: yaml ${library.toFixed(0)} ms, whole read ${whole.toFixed(0)} ms`).toBeLessThan(3 * library + 500);
    }
  });
});
