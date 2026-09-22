/**
 * Coverage for `merge()` (src/index.ts, tasks.md T024) as a whole:
 * `resolve()` then `merge()` through the real pipeline, checking what
 * `foldConfiguration` promises beyond tree *shape* (already covered by
 * tests/corpus/merge-corpus.test.ts) — frozen, canonically ordered,
 * `pedigree` carried through, and the never-both `MergeResult` contract.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { merge, resolve } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases", "merge-fold", "deep", "two-layer-mapping");

async function resolveFixture(): Promise<Extract<Awaited<ReturnType<typeof resolve>>, { ok: true }>> {
  const result = await resolve(join(FIXTURE_DIR, "config.yaml"), { host: createNodeHost(), sandboxRoot: FIXTURE_DIR });
  if (!result.ok) {
    throw new Error(`fixture failed to resolve: ${result.diagnostics.map((d) => d.code).join(", ")}`);
  }
  return result;
}

describe("merge() (T024) — FR-010, contracts/merge-api.md", () => {
  it("returns ok:true with a configuration, and never a configuration alongside an error", async () => {
    const resolved = await resolveFixture();
    const result = merge({ graph: resolved.graph, pedigree: resolved.pedigree });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.configuration.tree).toBeDefined();
    // v1.8: the `ok: true` branch now carries `diagnostics` — the fold can
    // raise an `info` (`append-scalar-wrapped`) that changes a value
    // without refusing it, and a lint nobody carries is a lint nobody
    // reads. The claim FR-010 actually makes is about **errors**, and it is
    // asserted directly here rather than through the absence of a field:
    // a merge yields a configuration or errors, never both. This fixture
    // raises nothing at all, so the list is also empty.
    expect(result.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("the merged tree is deeply frozen (FR-010) — mutation attempts throw", async () => {
    const resolved = await resolveFixture();
    const result = merge({ graph: resolved.graph, pedigree: resolved.pedigree });
    if (!result.ok) throw new Error("unreachable");
    const tree = result.configuration.tree;
    expect(Object.isFrozen(tree)).toBe(true);
    if (tree.type === "mapping") {
      expect(() => {
        // @ts-expect-error — entries is a ReadonlyMap at the type level; set() must also be unreachable at runtime (tests/unit/freeze.test.ts's convention).
        tree.entries.set("sabotage", tree);
      }).toThrow();
    }
  });

  it("mappings in the merged tree are in canonical (code-point sorted) key order (FR-010)", async () => {
    const resolved = await resolveFixture();
    const result = merge({ graph: resolved.graph, pedigree: resolved.pedigree });
    if (!result.ok) throw new Error("unreachable");
    const tree = result.configuration.tree;
    if (tree.type !== "mapping") throw new Error("expected a mapping root");
    const network = tree.entries.get("network");
    if (network === undefined || network.type !== "mapping") throw new Error("expected /network to be a mapping");
    // host < retries < timeout by code point — deep-merged, not just top-level.
    expect([...network.entries.keys()]).toEqual(["host", "retries", "timeout"]);
  });

  it("carries the pedigree through unchanged (data-model.md 'Merged Configuration')", async () => {
    const resolved = await resolveFixture();
    const result = merge({ graph: resolved.graph, pedigree: resolved.pedigree });
    if (!result.ok) throw new Error("unreachable");
    expect(result.configuration.pedigree).toBe(resolved.pedigree);
  });
});
