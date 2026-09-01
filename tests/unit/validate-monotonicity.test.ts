/**
 * Constitution Principle II, `SPEC.md` §5.2's monotonicity table, v0.4
 * FR-032, FR-033; tasks.md T054-T058.
 *
 * `demand` makes four more §5.2 rows constructible: **Types**, **Enums /
 * unions**, **Ranges / predicates**, and **`required`**. Each is
 * discharged here as a property of the validation **outcome** (FR-033's
 * corrected reading — this milestone achieves the monotonicity guarantee
 * *dynamically*, through whole-chain validation, never by refusing a
 * weakening declaration outright, which is static subsumption and belongs
 * to v1.x per §5.4).
 *
 * The property under test, for every row, is the same shape: validity is
 * the **conjunction** of every layer's own demand, independently
 * evaluated against the merged tree — never the verdict of the nearest
 * layer alone. That is precisely what makes a descendant's weaker demand
 * unable to rescue a value some ancestor's stricter demand rejects: the
 * ancestor's own check still runs and still fires. Each block below
 * computes its own expected verdict independently of `src/validate/`'s
 * implementation (an "oracle" duplicating the relevant §5.2 semantics in
 * a few lines, not by importing or calling the real leaf checks) — per
 * Principle V, never by copying what the implementation prints.
 *
 * Follows `tests/unit/monotonicity.test.ts`'s pattern exactly: a
 * hand-rolled seeded PRNG (mulberry32), hand-constructed `Layer`s fed
 * straight to `fold()` (bypassing `resolve()`/`graph/` entirely, which
 * this property does not need to exercise), then a hand-assembled
 * `MergedConfiguration` fed to `validate()`. No property-testing
 * dependency is introduced — `yaml` remains the only runtime dependency.
 *
 * **Struct openness is NOT discharged here** (§5.2's row governed by
 * `seal: open | closed`) — `seal` is v0.7 vocabulary this milestone does
 * not read at all (v0.4 FR-002, unchanged from v0.3's posture). Named
 * here as a recorded decision, per FR-032, rather than silently absent:
 * the row has no vocabulary yet to construct a property test against, the
 * same reasoning v0.3's own monotonicity file gave for deferring the
 * `Defaults (provide)` row's demand-satisfaction clause to this milestone.
 */

import { describe, expect, it } from "vitest";
import {
  createBoolScalar,
  createFloatScalar,
  createIntScalar,
  createMapping,
  createNullScalar,
  createSequence,
  createStringScalar,
  type Node,
} from "../../src/model/node.js";
import { createOrigin, createSourceSpan, type SourceSpan } from "../../src/model/span.js";
import { fold } from "../../src/merge/fold.js";
import type { Layer } from "../../src/merge/provenance.js";
import { validate } from "../../src/index.js";

// --- A small seeded PRNG, so every failure is reproducible from its seed ---

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

function pick<T>(rng: () => number, options: readonly T[]): T {
  const index = randInt(rng, 0, options.length - 1);
  const value = options[index];
  if (value === undefined) throw new Error("unreachable: index within bounds");
  return value;
}

// --- Layer/tree builders -------------------------------------------------

function origin(id: string): ReturnType<typeof createOrigin> {
  return createOrigin(id, id);
}

function span(id: string, at: number): SourceSpan {
  return createSourceSpan({ origin: origin(id), start: at, end: at + 1, line: 1, column: at + 1, documentLength: 1_000_000 });
}

const KEY = "value";

/** A schema layer whose `keys.value.demand` is exactly `demandEntries` (empty means the layer declares nothing for `KEY` at all — rule 6). */
function schemaLayerWithDemand(id: string, rank: number, demandEntries: readonly (readonly [string, Node])[]): Layer {
  const keysEntries: [string, Node][] = demandEntries.length > 0 ? [[KEY, createMapping([["demand", createMapping(demandEntries, span(id, 950))]], span(id, 960))]] : [];
  const tree = createMapping([["keys", createMapping(keysEntries, span(id, 980))]], span(id, 990));
  return { identity: { location: id, hash: "0".repeat(64) }, role: "schema", rank, tree };
}

/** The config layer, contributing `value` for `KEY` (or nothing, if `value` is `undefined`). */
function configLayerWithValue(id: string, rank: number, value: Node | undefined): Layer {
  const tree = createMapping(value !== undefined ? [[KEY, value]] : [], span(id, 999));
  return { identity: { location: id, hash: "0".repeat(64) }, role: "config", rank, tree };
}

function configurationFrom(layers: readonly Layer[]): Parameters<typeof validate>[0] {
  return { tree: fold(layers), provenance: new Map(), pedigree: [], layers, delegationBreadcrumbs: new Map(), sealState: new Map() };
}

const TRIALS = 300;

// --- Types row -------------------------------------------------------------

const BUILTIN_KINDS = ["string", "int", "float", "bool", "null", "mapping", "sequence"] as const;
type BuiltinKind = (typeof BUILTIN_KINDS)[number];

function valueOfKind(id: string, kind: BuiltinKind): Node {
  switch (kind) {
    case "string":
      return createStringScalar("x", span(id, 1));
    case "int":
      return createIntScalar(1n, span(id, 1));
    case "float":
      return createFloatScalar(1.5, span(id, 1));
    case "bool":
      return createBoolScalar(true, span(id, 1));
    case "null":
      return createNullScalar(span(id, 1));
    case "mapping":
      return createMapping([], span(id, 1));
    case "sequence":
      return createSequence([], span(id, 1));
  }
}

/** Independent oracle for `type: <kind>` matching — duplicated from §7's own kind names, not imported from `src/validate/constraints.ts`. */
function kindMatches(node: Node, demanded: BuiltinKind): boolean {
  switch (demanded) {
    case "string":
      return node.type === "scalar" && node.kind === "string";
    case "int":
      return node.type === "scalar" && node.kind === "int";
    case "float":
      return node.type === "scalar" && node.kind === "float";
    case "bool":
      return node.type === "scalar" && node.kind === "bool";
    case "null":
      return node.type === "scalar" && node.kind === "null";
    case "mapping":
      return node.type === "mapping";
    case "sequence":
      return node.type === "sequence";
  }
}

describe("monotonicity (Principle II, SPEC.md §5.2) — Types row (v0.4 FR-032, FR-033)", () => {
  it("a value's validity is the conjunction of every layer's own type demand — no descendant's demand can admit what an ancestor's rejects", () => {
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const rng = mulberry32(trial + 1);
      const schemaCount = randInt(rng, 1, 4);
      const layers: Layer[] = [];
      const demandedKinds: BuiltinKind[] = [];
      for (let i = 0; i < schemaCount; i += 1) {
        const declares = rng() < 0.7;
        if (declares) {
          const kind = pick(rng, BUILTIN_KINDS);
          demandedKinds.push(kind);
          layers.push(schemaLayerWithDemand(`schema-${trial}-${i}`, i, [["type", createStringScalar(kind, span(`schema-${trial}-${i}`, 900))]]));
        } else {
          layers.push(schemaLayerWithDemand(`schema-${trial}-${i}`, i, []));
        }
      }
      const valueKind = pick(rng, BUILTIN_KINDS);
      const value = valueOfKind(`config-${trial}`, valueKind);
      layers.push(configLayerWithValue(`config-${trial}`, schemaCount, value));

      const configuration = configurationFrom(layers);
      const result = validate(configuration);

      const expectedViolationCount = demandedKinds.filter((k) => !kindMatches(value, k)).length;
      if (expectedViolationCount === 0) {
        expect(result.ok, `trial ${trial}: value kind '${valueKind}' should satisfy every declared demand (${demandedKinds.join(",")})`).toBe(true);
      } else {
        expect(result.ok, `trial ${trial}: value kind '${valueKind}' should violate ${expectedViolationCount} of ${demandedKinds.join(",")}`).toBe(false);
        if (!result.ok) {
          expect(result.diagnostics.length, `trial ${trial}: collect-all — one diagnostic per violated layer`).toBe(expectedViolationCount);
        }
      }
    }
  });
});

// --- Enums/unions row --------------------------------------------------

const ENUM_UNIVERSE = ["a", "b", "c", "d", "e"] as const;

function randomSubset(rng: () => number, universe: readonly string[]): string[] {
  return universe.filter(() => rng() < 0.5);
}

describe("monotonicity (Principle II, SPEC.md §5.2) — Enums/unions row (v0.4 FR-032, FR-033)", () => {
  it("a value's validity requires membership in every layer's own enum -- a descendant's wider set never re-admits what an ancestor's narrower set rejects", () => {
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const rng = mulberry32(20_000 + trial);
      const schemaCount = randInt(rng, 1, 4);
      const layers: Layer[] = [];
      const declaredSets: string[][] = [];
      for (let i = 0; i < schemaCount; i += 1) {
        const declares = rng() < 0.7;
        if (declares) {
          const id = `schema-${trial}-${i}`;
          const subset = randomSubset(rng, ENUM_UNIVERSE);
          declaredSets.push(subset);
          const enumNode = createSequence(
            subset.map((v, idx) => createStringScalar(v, span(id, 800 + idx))),
            span(id, 900),
          );
          layers.push(schemaLayerWithDemand(id, i, [["enum", enumNode]]));
        } else {
          layers.push(schemaLayerWithDemand(`schema-${trial}-${i}`, i, []));
        }
      }
      const configId = `config-${trial}`;
      const chosenValue = pick(rng, ENUM_UNIVERSE);
      layers.push(configLayerWithValue(configId, schemaCount, createStringScalar(chosenValue, span(configId, 1))));

      const configuration = configurationFrom(layers);
      const result = validate(configuration);

      const violatingSets = declaredSets.filter((set) => !set.includes(chosenValue));
      if (violatingSets.length === 0) {
        expect(result.ok, `trial ${trial}: '${chosenValue}' should be a member of every declared enum (${declaredSets.map((s) => `[${s.join(",")}]`).join(" ")})`).toBe(true);
      } else {
        expect(result.ok, `trial ${trial}: '${chosenValue}' should violate ${violatingSets.length} declared enum(s)`).toBe(false);
        if (!result.ok) {
          expect(result.diagnostics.length).toBe(violatingSets.length);
        }
      }
    }
  });
});

// --- Ranges/predicates row -----------------------------------------------

describe("monotonicity (Principle II, SPEC.md §5.2) — Ranges/predicates row (v0.4 FR-032, FR-033)", () => {
  it("a value's validity requires satisfying every layer's own min/max -- tightening never loosens what an ancestor already demanded", () => {
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const rng = mulberry32(40_000 + trial);
      const schemaCount = randInt(rng, 1, 4);
      const layers: Layer[] = [];
      const mins: number[] = [];
      const maxes: number[] = [];
      for (let i = 0; i < schemaCount; i += 1) {
        const id = `schema-${trial}-${i}`;
        const entries: [string, Node][] = [];
        if (rng() < 0.6) {
          const min = randInt(rng, 0, 20);
          mins.push(min);
          entries.push(["min", createIntScalar(BigInt(min), span(id, 901))]);
        }
        if (rng() < 0.6) {
          const max = randInt(rng, 0, 20);
          maxes.push(max);
          entries.push(["max", createIntScalar(BigInt(max), span(id, 902))]);
        }
        layers.push(schemaLayerWithDemand(id, i, entries));
      }
      const configId = `config-${trial}`;
      const value = randInt(rng, 0, 20);
      layers.push(configLayerWithValue(configId, schemaCount, createIntScalar(BigInt(value), span(configId, 1))));

      const configuration = configurationFrom(layers);
      const result = validate(configuration);

      const violatedMins = mins.filter((m) => value < m).length;
      const violatedMaxes = maxes.filter((m) => value > m).length;
      const expectedViolationCount = violatedMins + violatedMaxes;

      if (expectedViolationCount === 0) {
        expect(result.ok, `trial ${trial}: ${value} should satisfy every min (${mins.join(",")}) and max (${maxes.join(",")})`).toBe(true);
      } else {
        expect(result.ok, `trial ${trial}: ${value} should violate ${expectedViolationCount} bound(s)`).toBe(false);
        if (!result.ok) {
          expect(result.diagnostics.length).toBe(expectedViolationCount);
        }
      }
    }
  });
});

// --- required row --------------------------------------------------------

describe("monotonicity (Principle II, SPEC.md §5.2) — required row (v0.4 FR-032, FR-033)", () => {
  it("once any layer demands required: true, the key must be present and non-null regardless of what any other layer says -- 'Add' is legal, there is no 'Remove'", () => {
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const rng = mulberry32(60_000 + trial);
      const schemaCount = randInt(rng, 1, 4);
      const layers: Layer[] = [];
      let requiredLayerCount = 0;
      for (let i = 0; i < schemaCount; i += 1) {
        const id = `schema-${trial}-${i}`;
        const declares = rng() < 0.6;
        if (declares) {
          requiredLayerCount += 1;
          layers.push(schemaLayerWithDemand(id, i, [["required", createBoolScalar(true, span(id, 901))]]));
        } else {
          layers.push(schemaLayerWithDemand(id, i, []));
        }
      }
      const configId = `config-${trial}`;
      // Three shapes: absent, explicit null, or a real value.
      const shape = pick(rng, ["absent", "null", "value"] as const);
      const value = shape === "absent" ? undefined : shape === "null" ? createNullScalar(span(configId, 1)) : createStringScalar("ok", span(configId, 1));
      layers.push(configLayerWithValue(configId, schemaCount, value));

      const configuration = configurationFrom(layers);
      const result = validate(configuration);

      const shouldBeValid = requiredLayerCount === 0 || shape === "value";
      expect(result.ok, `trial ${trial}: requiredLayerCount=${requiredLayerCount}, shape=${shape}`).toBe(shouldBeValid);
      if (!shouldBeValid && !result.ok) {
        // Exactly one violation per layer that declared required: true —
        // every such layer independently checks the same absence/null,
        // matching FR-016's "one diagnostic per violated demand".
        expect(result.diagnostics.length, `trial ${trial}: one diagnostic per required-declaring layer`).toBe(requiredLayerCount);
      }
    }
  });
});
