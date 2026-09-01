/**
 * T063 (tasks.md, Phase 7 Polish): confirm a merged tree satisfies every
 * v0.1 invariant, using v0.1's own assertions — FR-010, SC-006, quickstart.md
 * scenario 9 ("verified by the same assertions v0.1 uses, applied to a
 * merged result. Merge does not get an exemption for being downstream.").
 *
 * v0.1 enforces three invariants on every tree it produces:
 *   1. Every node is positioned — `span` is non-optional at the type level
 *      (Principle III) and `createSourceSpan` refuses to construct an
 *      invalid one (src/model/span.ts). This walks the actual merged tree
 *      and re-checks it at runtime, rather than trusting the type system
 *      alone — a node built by some path other than the validating
 *      factories would still type-check.
 *   2. Mappings are in canonical (code-point-sorted) key order —
 *      `createMapping` always sorts (src/model/node.ts); this re-derives
 *      the expected order independently with `compareByCodePoint` rather
 *      than trusting the same sort the code under test performs.
 *   3. The whole tree is deeply frozen — `Object.freeze` alone does not
 *      protect a `Map`'s internal slot (tests/unit/freeze.test.ts), so this
 *      walks every mapping in the merged tree, not just the root, and
 *      tries `.set()` on each one.
 *
 * Unlike tests/unit/merge-index.test.ts (T024's own coverage, which checks
 * these properties opportunistically), this file's `walkTree` recurses
 * through the *entire* tree so a violation three levels deep — under an
 * appended sequence's items, for instance — cannot hide the way a
 * single-nesting-level spot check would.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { merge, resolve, type MergedConfiguration } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";
import { compareByCodePoint } from "../../src/model/node.js";
import type { Node } from "../../src/model/node.js";

const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases");

async function mergeFixture(relativeDir: string): Promise<MergedConfiguration> {
  const fixtureDir = join(CASES_DIR, relativeDir);
  const resolved = await resolve(join(fixtureDir, "config.yaml"), { host: createNodeHost(), sandboxRoot: fixtureDir });
  if (!resolved.ok) {
    throw new Error(`fixture failed to resolve: ${resolved.diagnostics.map((d) => d.code).join(", ")}`);
  }
  const result = merge({ graph: resolved.graph, pedigree: resolved.pedigree });
  if (!result.ok) {
    throw new Error(`fixture failed to merge: ${result.diagnostics.map((d) => d.code).join(", ")}`);
  }
  return result.configuration;
}

/** Recursively visit every node in a tree, root included. */
function walkTree(node: Node, visit: (node: Node) => void): void {
  visit(node);
  if (node.type === "mapping") {
    for (const child of node.entries.values()) {
      walkTree(child, visit);
    }
  } else if (node.type === "sequence") {
    for (const item of node.items) {
      walkTree(item, visit);
    }
  }
}

describe("T063: a merged tree satisfies every v0.1 invariant (FR-010, SC-006)", () => {
  it("every node in a three-layer, nested-mapping merge is positioned with a structurally valid span", async () => {
    const configuration = await mergeFixture("merge-fold/deep/three-layer-nested");
    let visited = 0;
    walkTree(configuration.tree, (node) => {
      visited += 1;
      expect(node.span).toBeDefined();
      expect(node.span.origin).toBeDefined();
      expect(node.span.origin.id.length).toBeGreaterThan(0);
      expect(node.span.start).toBeGreaterThanOrEqual(0);
      expect(node.span.end).toBeGreaterThanOrEqual(node.span.start);
      expect(node.span.line).toBeGreaterThanOrEqual(1);
      expect(node.span.column).toBeGreaterThanOrEqual(1);
    });
    // app: {debug, name, version} plus the root mapping itself — a
    // sanity floor so this cannot pass by vacuously visiting nothing.
    expect(visited).toBeGreaterThanOrEqual(5);
  });

  it("every mapping at every depth is in canonical (code-point-sorted) key order, independently re-derived", async () => {
    const configuration = await mergeFixture("merge-fold/deep/three-layer-nested");
    let mappingsChecked = 0;
    walkTree(configuration.tree, (node) => {
      if (node.type !== "mapping") return;
      mappingsChecked += 1;
      const keys = [...node.entries.keys()];
      const expected = [...keys].sort(compareByCodePoint);
      expect(keys).toEqual(expected);
    });
    expect(mappingsChecked).toBeGreaterThanOrEqual(2); // root, and /app
    // The specific case this fixture is chosen for: app's three provided/
    // overridden keys sort as debug < name < version by code point, not
    // by declaration or arrival order (schema-root writes name/version;
    // schema-mid provides version/debug; config overrides name only).
    const root = configuration.tree;
    if (root.type !== "mapping") throw new Error("expected a mapping root");
    const app = root.entries.get("app");
    if (app === undefined || app.type !== "mapping") throw new Error("expected /app to be a mapping");
    expect([...app.entries.keys()]).toEqual(["debug", "name", "version"]);
  });

  it("the entire tree is deeply frozen — every nested mapping's Map, not only the root's", async () => {
    const configuration = await mergeFixture("merge-fold/deep/three-layer-nested");
    let mappingsChecked = 0;
    walkTree(configuration.tree, (node) => {
      expect(Object.isFrozen(node)).toBe(true);
      if (node.type === "mapping") {
        mappingsChecked += 1;
        expect(() => {
          // @ts-expect-error — entries is a ReadonlyMap at the type level (tests/unit/freeze.test.ts's convention).
          node.entries.set("sabotage", node);
        }).toThrow(TypeError);
      }
      if (node.type === "sequence") {
        expect(() => {
          // @ts-expect-error — items is a readonly array at the type level.
          node.items.push(node);
        }).toThrow(TypeError);
      }
    });
    expect(mappingsChecked).toBeGreaterThanOrEqual(2);
  });

  it("holds equally for a cascade: append sequence — every accumulated item is positioned, and the array is frozen", async () => {
    const configuration = await mergeFixture("merge-append/three-layer");
    const root = configuration.tree;
    if (root.type !== "mapping") throw new Error("expected a mapping root");
    const items = root.entries.get("items");
    if (items === undefined || items.type !== "sequence") throw new Error("expected /items to be a sequence");
    // root-item (schema-root), mid-item (schema-mid), config-item (config) — root-first, nothing lost.
    expect(items.items.map((item) => (item.type === "scalar" ? item.value : undefined))).toEqual(["root-item", "mid-item", "config-item"]);
    for (const item of items.items) {
      expect(item.span.origin.id.length).toBeGreaterThan(0);
      expect(item.span.end).toBeGreaterThanOrEqual(item.span.start);
    }
    expect(Object.isFrozen(items.items)).toBe(true);
    expect(() => {
      // @ts-expect-error — items is a readonly array at the type level.
      items.items.push(items.items[0]!);
    }).toThrow(TypeError);
  });
});
