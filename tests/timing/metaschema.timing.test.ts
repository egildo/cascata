/**
 * Wall-clock tests, moved out of the parallel run (specs/020-edit-targets, round 2).
 *
 * `pnpm test` runs the main suite, then this project (`vitest.timing.config.ts`) with one file
 * at a time and nothing else alongside, because every test here asserts on elapsed time or a
 * ratio of elapsed times and the parallel suite loads the machine. The assertions are the ones
 * they always were, moved verbatim from `tests/unit/metaschema.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "../../src/index.js";
import { nodeMetaSchemaLocation } from "../../src/host/node.js";
import { createOrigin } from "../../src/model/span.js";

const ENCODER = new TextEncoder();
const META_LOCATION = nodeMetaSchemaLocation();
const META_TEXT = readFileSync(META_LOCATION, "utf-8");

/** The `pattern` the shipped meta-schema declares for `typeExpr`, as the parser hands it back. */
function typeExprPattern(): RegExp {
  const parsed = parse(ENCODER.encode(META_TEXT), { origin: createOrigin(META_LOCATION, META_LOCATION) });
  if (!parsed.ok || parsed.tree.type !== "mapping") throw new Error("meta-schema does not parse");
  const types = parsed.tree.entries.get("types");
  if (types === undefined || types.type !== "mapping") throw new Error("no types section");
  const typeExpr = types.entries.get("typeExpr");
  if (typeExpr === undefined || typeExpr.type !== "mapping") throw new Error("no typeExpr");
  const demand = typeExpr.entries.get("demand");
  if (demand === undefined || demand.type !== "mapping") throw new Error("no typeExpr.demand");
  const pattern = demand.entries.get("pattern");
  if (pattern === undefined || pattern.type !== "scalar" || pattern.kind !== "string") throw new Error("no typeExpr.demand.pattern");
  return new RegExp(pattern.value, "u");
}

describe("the typeExpr pattern", () => {
  it("stays LINEAR on adversarial input — the quadratic form must not come back (research.md W-1)", () => {
    const pattern = typeExprPattern();
    const timeFor = (length: number): number => {
      const input = `a${" ".repeat(length)}`;
      const started = process.hrtime.bigint();
      pattern.test(input);
      return Number(process.hrtime.bigint() - started) / 1e6;
    };
    timeFor(1000); // warm up, so the first measurement is not compile time
    const small = Math.max(timeFor(4000), 0.001);
    const large = timeFor(16_000);
    // Quadratic was measured at 4x per doubling: 4000 -> 16000 is two
    // doublings, so ~16x. A generous ceiling of 8x still fails that and
    // passes anything linear, without turning a timing measurement into a
    // flaky assertion.
    expect(large / small, `4000 chars: ${small}ms, 16000 chars: ${large}ms`).toBeLessThan(8);
    expect(large).toBeLessThan(50);
  });
});
