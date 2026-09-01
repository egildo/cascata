/**
 * T062 (tasks.md, Phase 7 Polish): confirm merging is deterministic — SC-005,
 * contracts/merge-api.md's Behavioral Contract point 3 ("Same input,
 * byte-identical tree, identical chains in identical order").
 *
 * Modeled on tests/unit/resolve-determinism.test.ts (v0.2's SC-009
 * coverage): project the real, un-mockable output of `resolve()` then
 * `merge()` into a structural, order-sensitive shape `toEqual` can compare
 * without tripping over `Node`'s frozen-`Map`/Proxy machinery, run the
 * real pipeline twice (or several times) against the same fixture, and
 * assert the projections match.
 *
 * "Byte-identical tree" is checked more strictly than `nodesEqual` (which
 * README.md documents as deliberately excluding spans and origins from
 * model equality) — `projectTree` below includes every span field, since
 * SC-005 is a claim about the whole result, positions included, and a
 * merge that produced the same *values* at different *positions* across
 * two runs would still be a determinism bug `nodesEqual` alone would miss.
 *
 * Four scenarios:
 *   1. tree + provenance chains — a three-layer `provide`/override fixture.
 *   2. `cascade: append` — the chain that names every contributor, not a
 *      winner (contracts/merge-api.md "why and appended keys").
 *   3. `why()`'s `synthesized` outcome — a container no single layer wrote.
 *   4. the `ok: false` path — malformed merge policy, same diagnostics in
 *      the same order across runs (SC-005 says "and the same diagnostics",
 *      mirroring `parse()`/`resolve()`'s own determinism contracts).
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { merge, resolve, why } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";
import type { Diagnostic, MergedConfiguration, Node, WhyResult } from "../../src/index.js";

const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases");

interface TreeProjection {
  readonly type: string;
  readonly value?: unknown;
  readonly span: { readonly originId: string; readonly start: number; readonly end: number; readonly line: number; readonly column: number };
  readonly children?: readonly (readonly [string, TreeProjection])[] | readonly TreeProjection[];
}

/** Recursively project a Node into a plain, order-preserving structure — every span field included, unlike `nodesEqual` (README.md). */
function projectTree(node: Node): TreeProjection {
  const span = { originId: node.span.origin.id, start: node.span.start, end: node.span.end, line: node.span.line, column: node.span.column };
  if (node.type === "scalar") {
    return { type: `scalar:${node.kind}`, value: node.kind === "int" ? node.value.toString() : node.value, span };
  }
  if (node.type === "mapping") {
    return { type: "mapping", span, children: [...node.entries.entries()].map(([key, child]) => [key, projectTree(child)] as const) };
  }
  return { type: "sequence", span, children: node.items.map(projectTree) };
}

/** Project a `why()` chain/synthesized-contributors list: each entry's layer identity, outcome, and span — order-sensitive. */
function projectWhy(result: WhyResult): unknown {
  if (result.kind === "unknown-pointer") {
    return { kind: "unknown-pointer" };
  }
  const entries = result.kind === "chain" ? result.entries : result.contributors;
  return {
    kind: result.kind,
    entries: entries.map((entry) => ({
      location: entry.layer.identity.location,
      hash: entry.layer.identity.hash,
      rank: entry.layer.rank,
      outcome: entry.outcome,
      line: entry.span.line,
      column: entry.span.column,
      start: entry.span.start,
      end: entry.span.end,
    })),
  };
}

function projectDiagnostics(diagnostics: readonly Diagnostic[]): unknown {
  return diagnostics.map((d) => ({ code: d.code, line: d.primary.line, column: d.primary.column, originId: d.primary.origin.id }));
}

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

describe("merge() determinism (T062, SC-005)", () => {
  it("a three-layer provide/override fold produces a byte-identical tree and identical provenance across repeated runs", async () => {
    const first = await mergeFixture("merge-provenance/three-layer-chain");
    const second = await mergeFixture("merge-provenance/three-layer-chain");

    expect(projectTree(second.tree)).toEqual(projectTree(first.tree));
    expect(projectWhy(why(second, "/title"))).toEqual(projectWhy(why(first, "/title")));
    // Guards against the assertion above holding vacuously for an empty chain.
    const titleWhy = why(first, "/title");
    expect(titleWhy.kind).toBe("chain");
    if (titleWhy.kind === "chain") {
      expect(titleWhy.entries.length).toBe(3); // config, schema-mid, schema-root all provide/override /title
    }
  });

  it("running the same fold five times in a row never diverges, including span positions", async () => {
    const fixtureDir = join(CASES_DIR, "merge-fold/deep/three-layer-nested");
    const resolutions = await Promise.all(Array.from({ length: 5 }, () => resolve(join(fixtureDir, "config.yaml"), { host: createNodeHost(), sandboxRoot: fixtureDir })));
    const configurations = resolutions.map((resolved) => {
      if (!resolved.ok) throw new Error("unreachable — fixture is known-good");
      const result = merge({ graph: resolved.graph, pedigree: resolved.pedigree });
      if (!result.ok) throw new Error("unreachable — fixture is known-good");
      return result.configuration;
    });
    const [first, ...rest] = configurations;
    if (first === undefined) throw new Error("unreachable");
    const firstProjection = projectTree(first.tree);
    for (const configuration of rest) {
      expect(projectTree(configuration.tree)).toEqual(firstProjection);
    }
  });

  it("a cascade: append chain names every contributor in the same order across repeated runs — no single winner to make order incidental", async () => {
    const first = await mergeFixture("merge-append/three-layer");
    const second = await mergeFixture("merge-append/three-layer");

    const firstWhy = why(first, "/items");
    const secondWhy = why(second, "/items");
    expect(projectWhy(secondWhy)).toEqual(projectWhy(firstWhy));
    expect(firstWhy.kind).toBe("chain");
    if (firstWhy.kind === "chain") {
      expect(firstWhy.entries.every((e) => e.outcome === "accumulated")).toBe(true);
      expect(firstWhy.entries.length).toBe(3);
    }
  });

  it("why()'s synthesized outcome names the same contributors in the same order across repeated runs", async () => {
    const first = await mergeFixture("merge-provenance/synthesized");
    const second = await mergeFixture("merge-provenance/synthesized");

    // Find a pointer at least one run answers `synthesized` for, and
    // confirm both runs agree it exists and answer identically — this is
    // what "identical chains in identical order" means for the outcome
    // that has contributors instead of a winner.
    const firstRoot = first.tree;
    if (firstRoot.type !== "mapping") throw new Error("expected a mapping root");
    let synthesizedPointer: string | undefined;
    for (const key of firstRoot.entries.keys()) {
      if (why(first, `/${key}`).kind === "synthesized") {
        synthesizedPointer = `/${key}`;
        break;
      }
    }
    if (synthesizedPointer === undefined) {
      throw new Error("fixture merge-provenance/synthesized produced no synthesized pointer at top level — fixture assumption broken");
    }
    expect(projectWhy(why(second, synthesizedPointer))).toEqual(projectWhy(why(first, synthesizedPointer)));
    expect(why(first, synthesizedPointer).kind).toBe("synthesized");
  });

  it("malformed merge policy produces the same diagnostics in the same order across repeated runs", async () => {
    const fixtureDir = join(CASES_DIR, "merge-policy/unknown/bad-string");
    const first = await resolve(join(fixtureDir, "config.yaml"), { host: createNodeHost(), sandboxRoot: fixtureDir });
    const second = await resolve(join(fixtureDir, "config.yaml"), { host: createNodeHost(), sandboxRoot: fixtureDir });
    if (!first.ok || !second.ok) throw new Error("unreachable — resolve() itself is not under test here");

    const firstResult = merge({ graph: first.graph, pedigree: first.pedigree });
    const secondResult = merge({ graph: second.graph, pedigree: second.pedigree });
    expect(firstResult.ok).toBe(false);
    expect(secondResult.ok).toBe(false);
    if (firstResult.ok || secondResult.ok) throw new Error("unreachable — checked above");

    expect(projectDiagnostics(secondResult.diagnostics)).toEqual(projectDiagnostics(firstResult.diagnostics));
    expect(firstResult.diagnostics[0]?.code).toBe("unknown-cascade-strategy");
  });
});
