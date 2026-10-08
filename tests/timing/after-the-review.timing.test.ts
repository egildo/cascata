/**
 * v1.12 FR-004 (specs/022-after-the-review) — the wall-clock witnesses for issues #9 and #10.
 * The counted witnesses are in the main suite (`tests/unit/columns.test.ts`,
 * `tests/unit/pointer-index.test.ts`); this file times what cannot be counted.
 *
 * Linear work grows 4x from N to 4N; quadratic work grows 16x. The bound is 8x. `yaml`'s own
 * `parseDocument` of the same text (with `uniqueKeys: false`, as the reader runs it) is printed
 * beside each read as the same-machine reference, as the other timing cases do.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { editTarget, parse, why, type MergedConfiguration } from "../../src/index.js";
import { build } from "../unit/edit-target-fixture.js";

const origin = { id: "t", label: "t" };

function fastest(run: () => void): number {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

function readTimes(text: string): { library: number; whole: number } {
  const bytes = new TextEncoder().encode(text);
  return {
    library: fastest(() => void parseDocument(text, { intAsBigInt: true, merge: true, uniqueKeys: false })),
    whole: fastest(() => expect(parse(bytes, { origin }).ok).toBe(true)),
  };
}

function grows(shape: (n: number) => string, n: number): void {
  const small = readTimes(shape(n));
  const large = readTimes(shape(4 * n));
  const report = `${n}: ${small.whole.toFixed(0)} ms (yaml ${small.library.toFixed(0)} ms); ${4 * n}: ${large.whole.toFixed(0)} ms (yaml ${large.library.toFixed(0)} ms)`;
  expect(large.whole, report).toBeLessThan(8 * small.whole);
}

describe("v1.12 FR-001 — reading is linear in line length (issue #9)", () => {
  it("one line of N flow items and one of 4N: less than 8x the time, not 16x", { timeout: 300_000 }, () => {
    grows((n) => `a: [${Array.from({ length: n }, (_, i) => `x${i}`).join(", ")}]\n`, 10_000);
  });

  it("N aliases to one anchor, on one line, and 4N", { timeout: 300_000 }, () => {
    grows((n) => `a: &a 1\nb: [${Array(n).fill("*a").join(", ")}]\n`, 10_000);
  });
});

describe("v1.12 FR-003 — asking about every value is linear (issue #10)", () => {
  const configuration = (n: number): Promise<MergedConfiguration> => build("/virtual/many.yaml", { "/virtual/many.yaml": Array.from({ length: n }, (_, i) => `k${i}: ${i}`).join("\n") + "\n" });

  /** Fastest of three, each on a configuration of its own, so every run pays for the index it builds. */
  async function timeAll(ask: (merged: MergedConfiguration, pointer: string) => void, size: number): Promise<number> {
    let best = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const merged = await configuration(size);
      const start = performance.now();
      for (let i = 0; i < size; i += 1) ask(merged, `/k${i}`);
      best = Math.min(best, performance.now() - start);
    }
    return best;
  }

  async function grows(ask: (merged: MergedConfiguration, pointer: string) => void, n: number): Promise<void> {
    await timeAll(ask, n / 10); // warm-up
    const small = await timeAll(ask, n);
    const large = await timeAll(ask, 4 * n);
    expect(large, `${n} keys: ${small.toFixed(0)} ms; ${4 * n} keys: ${large.toFixed(0)} ms`).toBeLessThan(8 * small);
  }

  it("why() on every key of N and of 4N keys grows by less than 8x", { timeout: 300_000 }, async () => {
    await grows((merged, pointer) => void why(merged, pointer), 6_000);
  });

  it("editTarget() on every key of N and of 4N keys grows by less than 8x", { timeout: 300_000 }, async () => {
    await grows((merged, pointer) => void editTarget(merged, pointer), 6_000);
  });
});
