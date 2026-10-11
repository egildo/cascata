/**
 * Wall-clock tests, moved out of the parallel run (specs/020-edit-targets, round 2).
 *
 * `pnpm test` runs the main suite, then this project (`vitest.timing.config.ts`) with one file
 * at a time and nothing else alongside, because every test here asserts on elapsed time or a
 * ratio of elapsed times and the parallel suite loads the machine. The assertions are the ones
 * they always were, moved verbatim from `tests/unit/composition-bound.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { checkConfiguration } from "../../src/validate/check.js";
import { createMapping, createStringScalar, type Node } from "../../src/model/node.js";
import { createOrigin, createSourceSpan, type SourceSpan } from "../../src/model/span.js";
import { fold } from "../../src/merge/fold.js";
import type { Layer, MergedConfiguration } from "../../src/merge/provenance.js";

const ORIGIN_SCHEMA = createOrigin("bound-schema", "bound-schema");
const ORIGIN_CONFIG = createOrigin("bound-config", "bound-config");

let offset = 0;
function span(origin: ReturnType<typeof createOrigin>): SourceSpan {
  offset += 1;
  return createSourceSpan({ origin, start: offset, end: offset + 1, line: 1, column: offset, documentLength: 10_000_000 });
}

function s(value: string): Node {
  return createStringScalar(value, span(ORIGIN_SCHEMA));
}

function m(entries: readonly (readonly [string, Node])[]): Node {
  return createMapping(entries, span(ORIGIN_SCHEMA));
}

function configurationOf(schemaTree: Node, configTree: Node): MergedConfiguration {
  const schemaLayer: Layer = { identity: { location: "bound-schema", physical: "bound-schema", hash: "0".repeat(64) }, role: "schema", rank: 0, tree: schemaTree };
  const configLayer: Layer = { identity: { location: "bound-config", physical: "bound-config", hash: "1".repeat(64) }, role: "config", rank: 1, tree: configTree };
  const layers = [schemaLayer, configLayer];
  return { tree: fold(layers), provenance: new Map(), pedigree: [], layers, delegationBreadcrumbs: new Map(), finalState: new Map() };
}

/**
 * The discriminating schema, written in the spelling §9 mandates:
 *
 * ```yaml
 * types:
 *   node:
 *     demand:
 *       type: mapping | string
 *       keys:   { child: { demand: { type: node } } }
 *       values: { type: node }          # a BARE demand, not { demand: ... }
 * keys:
 *   root: { demand: { type: node } }
 * ```
 *
 * `child` is named by `keys` *and* covered by `values`, and both name the same
 * recursive type — the exact shape FR-002 says composes by intersection,
 * and the exact shape that doubles per level.
 */
function sharedRecursiveSchema(): Node {
  const nodeRef = (): Node => m([["type", s("node")]]);
  return m([
    ["types", m([["node", m([["demand", m([["type", s("mapping | string")], ["keys", m([["child", m([["demand", nodeRef()]])]])], ["values", nodeRef()]])]])]])],
    ["keys", m([["root", m([["demand", nodeRef()]])]])],
  ]);
}

/** A `depth`-level chain of `{child: …}` mappings ending in `leaf`, each level also carrying a sibling so `values` has something of its own to visit. */
function chain(depth: number, leaf: Node): Node {
  let value = leaf;
  for (let level = 0; level < depth; level += 1) {
    value = createMapping(
      [
        ["child", value],
        ["sib", createStringScalar(`s${level}`, span(ORIGIN_CONFIG))],
      ],
      span(ORIGIN_CONFIG),
    );
  }
  return value;
}

function chainConfiguration(depth: number, leaf: Node): MergedConfiguration {
  return configurationOf(sharedRecursiveSchema(), createMapping([["root", chain(depth, leaf)]], span(ORIGIN_CONFIG)));
}

/** Total milliseconds for `runs` validations, taking the best of three attempts — the minimum is the least noisy summary of a timing sample, and the assertion below is a ratio of two of them, never a threshold on either. */
function timeOf(build: () => MergedConfiguration, runs: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const configurations = Array.from({ length: runs }, build);
    const start = performance.now();
    for (const configuration of configurations) {
      checkConfiguration(configuration);
    }
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe("v1.0 FR-004 / SC-002 — the composition is polynomial, established by ratio", () => {
  it("doubling the depth does not square the work", () => {
    // **A ratio, never a wall-clock threshold**: scaling is a fact about
    // the algorithm, milliseconds are a fact about the machine. Under the
    // unbounded walk, going from depth 12 to depth 24 multiplies the work
    // by 2^12 = 4096. Under the memo it is linear in the number of
    // (type, node) pairs, so roughly 2×. The bound asserted is 20× —
    // two orders of magnitude of headroom for a loaded CI box, and still
    // two orders of magnitude below what the exponential produces.
    const leaf = createStringScalar("bottom", span(ORIGIN_CONFIG));
    const shallow = timeOf(() => chainConfiguration(12, leaf), 40);
    const deep = timeOf(() => chainConfiguration(24, leaf), 40);
    expect(deep / Math.max(shallow, 0.01), `depth 24 took ${deep.toFixed(1)}ms for 40 runs, depth 12 took ${shallow.toFixed(1)}ms`).toBeLessThan(20);
  }, 120_000);
});
