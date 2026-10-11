/**
 * Wall-clock tests, moved out of the parallel run (specs/020-edit-targets, round 2).
 *
 * `pnpm test` runs the main suite, then this project (`vitest.timing.config.ts`) with one file
 * at a time and nothing else alongside, because every test here asserts on elapsed time or a
 * ratio of elapsed times and the parallel suite loads the machine. The assertions are the ones
 * they always were, moved verbatim from `tests/unit/accumulate.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { parse } from "../../src/index.js";
import { createOrigin } from "../../src/model/span.js";
import type { Layer } from "../../src/merge/provenance.js";
import { accumulate } from "../../src/generate/accumulate.js";

const ENCODER = new TextEncoder();

function schemaLayer(location: string, rank: number, text: string): Layer {
  const origin = createOrigin(location, location);
  const parsed = parse(ENCODER.encode(text), { origin });
  if (!parsed.ok) {
    throw new Error(`fixture '${location}' does not parse: ${parsed.diagnostics.map((d) => d.message).join("; ")}`);
  }
  return { identity: { location, physical: location, hash: String(rank).repeat(64).slice(0, 64) }, role: "schema", rank, tree: parsed.tree };
}

function chain(...texts: readonly string[]): readonly Layer[] {
  return texts.map((text, index) => schemaLayer(`layer${index}.yaml`, index, text));
}

describe("contract §1 row 14 / FR-006 — `keys` + `values` over a shared type is polynomial", () => {
  function nestedChain(depth: number): string {
    const lines: string[] = ["types:"];
    for (let level = 0; level < depth; level += 1) {
      lines.push(`  n${level}:`);
      lines.push("    demand:");
      lines.push("      type: mapping");
      lines.push(`      keys: { child: { demand: { type: n${level + 1} } } }`);
      lines.push(`      values: { type: n${level + 1} }`);
    }
    lines.push(`  n${depth}:`);
    lines.push("    demand: { type: string }");
    lines.push("keys:");
    lines.push("  root: { demand: { type: n0 } }");
    return `${lines.join("\n")}\n`;
  }

  function timeOf(depth: number, runs: number): number {
    let best = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const text = nestedChain(depth);
      const layerSets = Array.from({ length: runs }, () => chain(text, text));
      const start = performance.now();
      for (const layers of layerSets) {
        accumulate(layers);
      }
      best = Math.min(best, performance.now() - start);
    }
    return best;
  }

  it("depths 10, 15, 18 and 24 scale by a ratio, not by a power", () => {
    const d10 = timeOf(10, 20);
    const d15 = timeOf(15, 20);
    const d18 = timeOf(18, 20);
    const d24 = timeOf(24, 20);
    // 10 → 24 is fourteen extra levels. Exponentially that is 2^14 = 16384×.
    // Polynomially it is a small multiple of the depth ratio (2.4×). The
    // bound asserted is 40× — well over two orders of magnitude of headroom
    // for a loaded machine, and still two orders below the exponential.
    expect(d24 / Math.max(d10, 0.01), `d10=${d10.toFixed(1)}ms d15=${d15.toFixed(1)}ms d18=${d18.toFixed(1)}ms d24=${d24.toFixed(1)}ms`).toBeLessThan(40);
    expect(d18 / Math.max(d10, 0.01)).toBeLessThan(40);
  }, 120_000);
});
