/**
 * `SPEC.md` §5.2's monotonicity table, v0.5 FR-029; tasks.md T040-T041.
 *
 * v0.5 makes the **Types (named)** row constructible: a named type's
 * reachability is governed by the layer that names it (FR-008,
 * research.md D2 — the identical rule v0.3 FR-026 settled for cascade
 * strategies), and collision is unconditional (FR-017, research.md D1).
 * Two properties, each stated as a property of the validation
 * **outcome** (the same posture `validate-monotonicity.test.ts`
 * establishes for v0.4's rows), each with its own independent oracle —
 * never by importing or calling `src/validate/types.ts`'s own logic
 * (Principle V):
 *
 * 1. **Reachability is scope-bound, not graph-wide** (FR-008). For a
 *    random chain of schema layers where exactly one layer `R` declares
 *    a type name and every layer has its own usage of that name, a
 *    usage in a layer with `rank < R` never resolves; a usage in a layer
 *    with `rank >= R` always does. This is precisely what the brief's
 *    own mandated sabotage (resolving against a single pedigree-wide
 *    merged graph instead of per-layer scope) would erase: under that
 *    sabotage, *every* layer's usage would resolve, and this property
 *    would go green regardless of `rank`.
 * 2. **Collision is unconditional** (FR-017, research.md D1). For a
 *    random assignment of type names to layers, every name declared by
 *    two or more layers produces exactly one `type-name-collision` per
 *    declaration beyond the first — independent of whether any usage
 *    ever names it, and independent of layer content otherwise.
 *
 * Both bypass `resolve()`/`parse()` entirely (hand-built `Layer`s fed to
 * `fold()`, `validate-monotonicity.test.ts`'s own established pattern)
 * — this property does not need the file-parsing pipeline, and (per
 * `tests/unit/validate-depth-limit.test.ts`'s own finding) going through
 * `resolve()` would in any case cap how deep/wide a synthetic pedigree
 * could ever legally get before tripping v0.1's own parse-depth guard.
 *
 * **Struct openness remains deferred** (§5.2's row governed by
 * `seal: open | closed`) — recorded here for a third time, per FR-029:
 * `seal` is still v0.7 vocabulary, unread by any milestone through v0.5.
 */

import { describe, expect, it } from "vitest";
import { createMapping, createStringScalar, type Node } from "../../src/model/node.js";
import { createOrigin, createSourceSpan, type SourceSpan } from "../../src/model/span.js";
import { fold } from "../../src/merge/fold.js";
import type { Layer } from "../../src/merge/provenance.js";
import { validate } from "../../src/index.js";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

function origin(id: string): ReturnType<typeof createOrigin> {
  return createOrigin(id, id);
}

function span(id: string, at: number): SourceSpan {
  return createSourceSpan({ origin: origin(id), start: at, end: at + 1, line: 1, column: at + 1, documentLength: 1_000_000 });
}

function configurationFrom(layers: readonly Layer[]): Parameters<typeof validate>[0] {
  return { tree: fold(layers), provenance: new Map(), pedigree: [], layers };
}

const TRIALS = 300;

describe("monotonicity (SPEC.md §5.2) — Types (named) row, v0.5 FR-029", () => {
  it("FR-008/research.md D2: a name resolves only from the layer that declares it downward -- never for a strict ancestor's own usage", () => {
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const rng = mulberry32(trial + 1);
      const schemaCount = randInt(rng, 2, 5);
      const declaringRank = randInt(rng, 0, schemaCount - 1);
      const typeName = `special${trial}`;

      const layers: Layer[] = [];
      for (let rank = 0; rank < schemaCount; rank += 1) {
        const id = `schema-${trial}-${rank}`;
        const keyName = `k${rank}`;
        const keysSection = createMapping([[keyName, createMapping([["demand", createMapping([["type", createStringScalar(typeName, span(id, 10))]], span(id, 20))]], span(id, 30))]], span(id, 40));
        const entries: [string, Node][] = [["keys", keysSection]];
        if (rank === declaringRank) {
          const typesSection = createMapping([[typeName, createMapping([["demand", createMapping([["type", createStringScalar("string", span(id, 50))]], span(id, 60))]], span(id, 70))]], span(id, 80));
          entries.push(["types", typesSection]);
        }
        const tree = createMapping(entries, span(id, 90));
        layers.push({ identity: { location: id, hash: "0".repeat(64) }, role: "schema", rank, tree });
      }
      // A config layer contributing nothing — typeUsageProblems' reachability
      // check is value-independent (fires from schema-authored demand
      // structure alone), so no config value is needed to exercise it.
      layers.push({ identity: { location: `config-${trial}`, hash: "0".repeat(64) }, role: "config", rank: schemaCount, tree: createMapping([], span(`config-${trial}`, 0)) });

      const result = validate(configurationFrom(layers));
      // Collision never arises here (the type name is declared by exactly
      // one layer), so any `ok:false` must come entirely from
      // unknown-type-name reachability failures — count them per rank.
      const unreachableRanks = result.ok ? new Set<number>() : new Set(result.diagnostics.filter((d) => d.code === "unknown-type-name").map((d) => d.pedigreePosition).filter((p): p is number => p !== undefined));

      for (let rank = 0; rank < schemaCount; rank += 1) {
        const expectedUnreachable = rank < declaringRank;
        expect(unreachableRanks.has(rank), `trial ${trial}: schemaCount=${schemaCount} declaringRank=${declaringRank} rank=${rank} expected unreachable=${expectedUnreachable}, diagnostics=${result.ok ? "[]" : JSON.stringify(result.diagnostics.map((d) => ({ code: d.code, ped: d.pedigreePosition })))}`).toBe(expectedUnreachable);
      }
    }
  });

  it("FR-017/research.md D1: every type name declared by two or more layers collides unconditionally, one diagnostic per declaration beyond the first", () => {
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const rng = mulberry32(trial + 10_000);
      const schemaCount = randInt(rng, 2, 4);
      const nameCount = randInt(rng, 1, 3);
      const names = Array.from({ length: nameCount }, (_, i) => `type${trial}_${i}`);

      // For each (rank, name) pair, independently decide whether that
      // layer declares that name -- the oracle counts, per name, how many
      // layers declared it, and expects exactly (count - 1) collisions.
      const declaresByRank: boolean[][] = [];
      for (let rank = 0; rank < schemaCount; rank += 1) {
        declaresByRank.push(names.map(() => rng() < 0.6));
      }
      // Force at least one name to be declared by at least 2 layers on
      // roughly half of trials, so the property isn't vacuously "no
      // collision, ok stays true" every time -- and force it un-collided
      // on the other half, so both branches of the oracle get exercised.
      if (trial % 2 === 0 && schemaCount >= 2) {
        const forcedName = randInt(rng, 0, nameCount - 1);
        const a = declaresByRank[0];
        const b = declaresByRank[1];
        if (a !== undefined && b !== undefined) {
          a[forcedName] = true;
          b[forcedName] = true;
        }
      }

      const layers: Layer[] = [];
      for (let rank = 0; rank < schemaCount; rank += 1) {
        const id = `schema-${trial}-${rank}`;
        const entries: [string, Node][] = [];
        const declares = declaresByRank[rank];
        const typeEntries: [string, Node][] = [];
        if (declares !== undefined) {
          names.forEach((name, i) => {
            if (declares[i] === true) {
              typeEntries.push([name, createMapping([["demand", createMapping([["type", createStringScalar("string", span(id, 100 + i))]], span(id, 200 + i))]], span(id, 300 + i))]);
            }
          });
        }
        if (typeEntries.length > 0) {
          entries.push(["types", createMapping(typeEntries, span(id, 900))]);
        }
        const tree = createMapping(entries, span(id, 990));
        layers.push({ identity: { location: id, hash: "0".repeat(64) }, role: "schema", rank, tree });
      }
      layers.push({ identity: { location: `config-${trial}`, hash: "0".repeat(64) }, role: "config", rank: schemaCount, tree: createMapping([], span(`config-${trial}`, 0)) });

      const result = validate(configurationFrom(layers));

      let expectedCollisions = 0;
      names.forEach((_, i) => {
        const declaringCount = declaresByRank.filter((row) => row[i] === true).length;
        expectedCollisions += Math.max(0, declaringCount - 1);
      });

      if (expectedCollisions === 0) {
        expect(result.ok, `trial ${trial}: expected no collision (names=${JSON.stringify(names)}, declaresByRank=${JSON.stringify(declaresByRank)}) but got ${result.ok ? "ok" : JSON.stringify(result.diagnostics.map((d) => d.code))}`).toBe(true);
      } else {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          const collisionCount = result.diagnostics.filter((d) => d.code === "type-name-collision").length;
          expect(collisionCount, `trial ${trial}: expected ${expectedCollisions} collisions (names=${JSON.stringify(names)}, declaresByRank=${JSON.stringify(declaresByRank)}), got ${JSON.stringify(result.diagnostics.map((d) => d.code))}`).toBe(expectedCollisions);
        }
      }
    }
  });
});
