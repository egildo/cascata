/**
 * Wall-clock tests, moved out of the parallel run (specs/020-edit-targets, round 2).
 *
 * `pnpm test` runs the main suite, then this project (`vitest.timing.config.ts`) with one file
 * at a time and nothing else alongside, because every test here asserts on elapsed time or a
 * ratio of elapsed times and the parallel suite loads the machine. The assertions are the ones
 * they always were, moved verbatim from `tests/unit/validate-totality.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { load } from "../../src/index.js";
import { InMemoryHost } from "../unit/host-test-double.js";
import { parseTypeExpression } from "../../src/validate/typeexpr.js";

const ENCODER = new TextEncoder();

describe("legal input, bounded cost — the type-expression parser is linear in alternatives", () => {
  function timeUnion(alternatives: number): number {
    const union = Array.from({ length: alternatives }, (_, index) => `n${index}`).join("|");
    const started = process.hrtime.bigint();
    const parsed = parseTypeExpression(union);
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.alternatives).toHaveLength(alternatives);
    return elapsed;
  }

  it("doubling the alternatives does not quadruple the work", () => {
    timeUnion(2_000); // warm up, so the first measurement is not JIT time
    const small = Math.max(timeUnion(20_000), 0.001);
    const large = timeUnion(80_000);
    // Two doublings. Quadratic was measured at 4x per doubling — 16x here.
    // A ceiling of 8x fails that comfortably and passes anything linear,
    // without turning a timing measurement into a flaky assertion.
    expect(large / small, `20,000: ${small}ms, 80,000: ${large}ms`).toBeLessThan(8);
  }, 120_000);

  it("a 907 KB, 130,000-alternative union — the measured case — returns in well under the minute it used to cost", async () => {
    const union = Array.from({ length: 130_000 }, (_, index) => `n${index}`).join("|");
    const schema = `keys:\n  k:\n    demand: { type: "${union}" }\n`;
    expect(schema.length).toBeLessThan(8 * 1024 * 1024);
    const host = new InMemoryHost({
      files: new Map([
        ["/v/schema.yaml", ENCODER.encode(schema)],
        ["/v/config.yaml", ENCODER.encode("$schema: ./schema.yaml\nk: hi\n")],
      ]),
    });
    const started = Date.now();
    const result = await load("/v/config.yaml", { host, sandboxRoot: "/v" });
    const elapsed = Date.now() - started;
    expect(typeof result.ok).toBe("boolean");
    // Ten seconds is a ceiling, not a target — it was 68 seconds, and is
    // now around 0.6. Anything near the old figure is the quadratic back.
    expect(elapsed, `${elapsed}ms`).toBeLessThan(10_000);
  }, 120_000);
});
