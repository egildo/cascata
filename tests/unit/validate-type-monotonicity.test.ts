/**
 * `SPEC.md` §5.2's monotonicity table, v0.5 FR-029; tasks.md T040-T041,
 * revised per `SPEC.md` §15 (commit 0b63d67) settling narrowing over
 * collision — see `src/validate/types.ts`'s own header comment for the
 * full history. Two properties, each stated as a property of the
 * validation **outcome** (the same posture `validate-monotonicity.test.ts`
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
 * 2. **Redeclaration resolves nearest-wins, never as an error**
 *    (FR-016, FR-016a — replaces this file's original "collision is
 *    unconditional" property, which asserted the exact behaviour §15
 *    overturned). For a random subset of layers each independently
 *    declaring one type name with one of two distinguishable accept
 *    sets, and every layer carrying its own usage of that name against
 *    a fixed int value: a usage at rank `R` is governed by the
 *    **nearest** declaring layer at or below `R` (never any other, and
 *    never an error merely because more than one layer declares it); a
 *    usage with no declaring layer at or below it is unresolvable. This
 *    is exactly what the "resolve to the ancestor's declaration instead
 *    of nearest" sabotage (this correction's own mandated run) would
 *    erase — every single-declaring-layer trial would stay green
 *    regardless, and only a trial with 2+ declaring layers reachable
 *    from one usage would catch it.
 *
 * Both bypass `resolve()`/`parse()` entirely (hand-built `Layer`s fed to
 * `fold()`, `validate-monotonicity.test.ts`'s own established pattern)
 * — this property does not need the file-parsing pipeline, and (per
 * `tests/unit/validate-depth-limit.test.ts`'s own finding) going through
 * `resolve()` would in any case cap how deep/wide a synthetic pedigree
 * could ever legally get before tripping v0.1's own parse-depth guard.
 *
 * **Struct openness remains deferred** (§5.2's row governed by
 * `seal: open | closed`) — recorded here for a fourth time, per FR-029:
 * `seal` is still v0.7 vocabulary, unread by any milestone through v0.5.
 */

import { describe, expect, it } from "vitest";
import { createIntScalar, createMapping, createSequence, createStringScalar, type Node } from "../../src/model/node.js";
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

  it("FR-016/FR-016a: an unqualified name declared by several reachable layers resolves to the NEAREST, never an error, never an arbitrary one", () => {
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const rng = mulberry32(trial + 10_000);
      const schemaCount = randInt(rng, 2, 5);
      const typeName = `special${trial}`;

      // Independently decide, per layer, whether it declares `typeName`
      // and — if so — whether its own accept set admits `int` or only
      // `string` (mutually exclusive with the fixed int value used
      // below, so "which declaration governed this usage" is directly
      // observable from whether a violation was reported).
      const declares: boolean[] = [];
      const acceptsInt: boolean[] = [];
      let anyDeclares = false;
      for (let rank = 0; rank < schemaCount; rank += 1) {
        const d = rng() < 0.6;
        declares.push(d);
        acceptsInt.push(rng() < 0.5);
        if (d) anyDeclares = true;
      }
      // Force at least one declaration so the property isn't vacuously
      // "nothing declares it, every usage is unresolvable" every time.
      if (!anyDeclares) {
        declares[randInt(rng, 0, schemaCount - 1)] = true;
      }

      const layers: Layer[] = [];
      for (let rank = 0; rank < schemaCount; rank += 1) {
        const id = `schema-${trial}-${rank}`;
        const keyName = `k${rank}`;
        const keysSection = createMapping([[keyName, createMapping([["demand", createMapping([["type", createStringScalar(typeName, span(id, 10))]], span(id, 20))]], span(id, 30))]], span(id, 40));
        const entries: [string, Node][] = [["keys", keysSection]];
        if (declares[rank] === true) {
          const acceptName = acceptsInt[rank] === true ? "int" : "string";
          const typesSection = createMapping([[typeName, createMapping([["accept", createSequence([createStringScalar(acceptName, span(id, 55))], span(id, 56))]], span(id, 70))]], span(id, 80));
          entries.push(["types", typesSection]);
        }
        const tree = createMapping(entries, span(id, 90));
        layers.push({ identity: { location: id, hash: "0".repeat(64) }, role: "schema", rank, tree });
      }

      // A single fixed int value for every usage key -- which usages are
      // satisfied is then purely a function of the *nearest* reachable
      // declaration's own accept set, never of the value's own shape.
      const configId = `config-${trial}`;
      const configEntries: [string, Node][] = [];
      for (let rank = 0; rank < schemaCount; rank += 1) {
        configEntries.push([`k${rank}`, createIntScalar(1n, span(configId, rank))]);
      }
      layers.push({ identity: { location: configId, hash: "0".repeat(64) }, role: "config", rank: schemaCount, tree: createMapping(configEntries, span(configId, 900)) });

      const result = validate(configurationFrom(layers));
      // Grouped by the *usage* key's own rank ("k{rank}"), not by
      // `pedigreePosition` -- that field names the *declaring* layer for
      // a value violation (FR-007's "attributed to the type's own
      // position"), which for a narrowed type is the nearest declaring
      // layer, not the usage's own. `unknown-type-name`, by contrast,
      // *is* pedigreePosition'd at the usage's own layer (it is a
      // schema-authoring problem found by walking that layer's own
      // vocabulary). Extracting the usage key's rank from the diagnostic
      // pointer itself sidesteps that asymmetry rather than assuming a
      // single field means the same thing across both diagnostic shapes.
      const diagnosticsByRank = new Map<number, string[]>();
      if (!result.ok) {
        for (const d of result.diagnostics) {
          const fromMergedPointer = /^\/k(\d+)$/.exec(d.pointer ?? "");
          const fromDemandPointer = /^\/keys\/k(\d+)\//.exec(d.demand?.pointer ?? "");
          const match = fromMergedPointer ?? fromDemandPointer;
          if (match === null) continue;
          const usageRank = Number(match[1]);
          const list = diagnosticsByRank.get(usageRank) ?? [];
          list.push(d.code);
          diagnosticsByRank.set(usageRank, list);
        }
      }

      for (let rank = 0; rank < schemaCount; rank += 1) {
        // Independent oracle: the nearest rank <= this one that declares.
        let nearest: number | undefined;
        for (let r = rank; r >= 0; r -= 1) {
          if (declares[r] === true) {
            nearest = r;
            break;
          }
        }
        const codes = diagnosticsByRank.get(rank) ?? [];
        const label = `trial ${trial}: schemaCount=${schemaCount} declares=${JSON.stringify(declares)} acceptsInt=${JSON.stringify(acceptsInt)} rank=${rank} nearest=${nearest} codes=${JSON.stringify(codes)}`;
        if (nearest === undefined) {
          expect(codes, label).toContain("unknown-type-name");
        } else if (acceptsInt[nearest] === true) {
          expect(codes, label).not.toContain("unknown-type-name");
          expect(codes, label).not.toContain("type-mismatch");
        } else {
          expect(codes, label).toContain("type-mismatch");
        }
        // Never a collision, no matter how many layers declared it —
        // FR-016a's whole point.
        expect(codes, label).not.toContain("type-name-collision");
      }
    }
  });
});
