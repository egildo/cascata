/**
 * Wall-clock tests, moved out of the parallel run (specs/020-edit-targets, round 2).
 *
 * `pnpm test` runs the main suite, then this project (`vitest.timing.config.ts`) with one file
 * at a time and nothing else alongside, because every test here asserts on elapsed time or a
 * ratio of elapsed times and the parallel suite loads the machine. The assertions are the ones
 * they always were, moved verbatim from `tests/unit/duplicate-keys.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { locate, setValue } from "../../src/index.js";
import { parse } from "../../src/index.js";

const origin = { id: "d", label: "<d>" };
const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("linear time: one large mapping", () => {
  const flat = (n: number): string => `${Array.from({ length: n }, (_, i) => `key${i}: ${i}`).join("\n")}\n`;
  const fastest = (run: () => void): number => {
    let best = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const start = performance.now();
      run();
      best = Math.min(best, performance.now() - start);
    }
    return best;
  };
  // `yaml`'s own parse with its duplicate check off is the floor Cascata cannot go below; the read is that plus a small multiple.
  for (const n of [16_000, 32_000]) {
    it(`${n} keys: the read is a small multiple of yaml's own parse without uniqueKeys, plus an allowance (it was 77x at 32,000)`, { timeout: 120_000 }, () => {
      const text = flat(n);
      const bytes = enc(text);
      const floor = fastest(() => void parseDocument(text, { merge: true, uniqueKeys: false }));
      const read = fastest(() => expect(parse(bytes, { origin }).ok).toBe(true));
      expect(read, `yaml (uniqueKeys: false) ${floor.toFixed(0)} ms, the read ${read.toFixed(0)} ms`).toBeLessThan(5 * floor + 600);
    });
  }

  it("the writer's reads (locate: one; setValue: two, the document and the read-back) are the same", { timeout: 120_000 }, () => {
    const n = 32_000;
    const text = flat(n);
    const bytes = enc(text);
    const floor = fastest(() => void parseDocument(text, { merge: true, uniqueKeys: false }));
    const options = { format: "yaml", origin } as const;
    const pointer = `/key${n - 1}`;
    const located = fastest(() => expect(locate(bytes, options, pointer).ok).toBe(true));
    const written = fastest(() => expect(setValue(bytes, options, pointer, 7).ok).toBe(true));
    expect(located, `yaml ${floor.toFixed(0)} ms, locate ${located.toFixed(0)} ms`).toBeLessThan(5 * floor + 600);
    expect(written, `yaml ${floor.toFixed(0)} ms, setValue ${written.toFixed(0)} ms`).toBeLessThan(2 * (5 * floor + 600));
  });
});
