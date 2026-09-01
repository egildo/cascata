/**
 * v0.7 part 2 (008) FR-001 through FR-006, `SPEC.md` §9/§5.2 (amended) —
 * `values`, the construct for a mapping whose keys are the author's to
 * choose rather than the schema's to enumerate.
 *
 * The six acceptance scenarios live as conformance cases
 * (`tests/corpus/validate-cases/T003*.json`), where their exact positions
 * and diagnostic counts are asserted. This file carries the three
 * properties a fixture cannot state:
 *
 * - **FR-003's depth bound.** `values` must be bounded by the same
 *   `MAX_DEMAND_DEPTH` `keys`/`items` are, and reaching that bound must
 *   produce `depth-limit-exceeded` rather than a stack overflow. Driven
 *   from a synthetic AST rather than a document, and the third case here
 *   says why in the form of an assertion: a `values` chain long enough to
 *   reach the guard **cannot be written as a document at all**, because
 *   v0.1's parse `maxDepth` is the same 64 counting a coarser unit. That
 *   is `guards-that-dont-guard` restated for this keyword — the guard is
 *   real, but unreachable through `resolve()`, and saying so is the
 *   point.
 * - **FR-005's monotonicity row, discharged dynamically.** §5.2 says
 *   loosening or removing an inherited `values` is refused. This
 *   milestone discharges that the way v0.4 FR-033 and v0.7's `seal` row
 *   already do — as a property of the validation **outcome** under
 *   whole-chain validation (§5.4), never as a static refusal of the
 *   declaration. The property under test is the conjunction: a
 *   descendant's silence about `values` cannot rescue a value the
 *   ancestor's own `values` refuses.
 * - **FR-004's orthogonality**, in the direction the corpus case does not
 *   cover: `values` with `seal: closed` and no `keys` refuses every key,
 *   which is `seal` deciding membership while `values` says only shape.
 */
import { describe, expect, it } from "vitest";
import { load, validate } from "../../src/index.js";
import { InMemoryHost } from "./host-test-double.js";
import { createBoolScalar, createIntScalar, createMapping, createStringScalar, type Node } from "../../src/model/node.js";
import { createOrigin, createSourceSpan, type SourceSpan } from "../../src/model/span.js";
import { fold } from "../../src/merge/fold.js";
import type { Layer } from "../../src/merge/provenance.js";

/** v0.5 FR-025 — independently restated, never imported from `src/validate/vocabulary.ts` (Principle V: a test must not trust the constant it exists to check). */
const MAX_DEMAND_DEPTH = 64;

const KEY = "value";

function origin(id: string): ReturnType<typeof createOrigin> {
  return createOrigin(id, id);
}

function span(id: string, at: number): SourceSpan {
  return createSourceSpan({ origin: origin(id), start: at, end: at + 1, line: 1, column: at + 1, documentLength: 1_000_000 });
}

function schemaLayerWithDemand(id: string, rank: number, demand: Node): Layer {
  const tree = createMapping([["keys", createMapping([[KEY, createMapping([["demand", demand]], span(id, 900))]], span(id, 950))]], span(id, 990));
  return { identity: { location: id, hash: "0".repeat(64) }, role: "schema", rank, tree };
}

function configLayerWithValue(id: string, rank: number, value: Node | undefined): Layer {
  const tree = createMapping(value !== undefined ? [[KEY, value]] : [], span(id, 999));
  return { identity: { location: id, hash: "0".repeat(64) }, role: "config", rank, tree };
}

function configurationFrom(layers: readonly Layer[]): Parameters<typeof validate>[0] {
  return { tree: fold(layers), provenance: new Map(), pedigree: [], layers, delegationBreadcrumbs: new Map(), finalState: new Map() };
}

const ENCODER = new TextEncoder();

async function loadFiles(files: Record<string, string>) {
  const map = new Map(Object.entries(files).map(([location, text]) => [location, ENCODER.encode(text)] as const));
  return load("/v/config.yaml", { host: new InMemoryHost({ files: map }), sandboxRoot: "/v" });
}

describe("v0.7 part 2 FR-003 — values is depth-bounded, by the same guard keys/items are", () => {
  /**
   * A demand mapping with `depth` nested `values` key-declarations
   * wrapping a `{type: string}` leaf. `depth=0` is the leaf itself.
   *
   * **Synthetic AST, not a fixture, for the reason
   * `tests/unit/validate-depth-limit.test.ts` records in full**: a real
   * document deep enough to reach `MAX_DEMAND_DEPTH` cannot get through
   * `resolve()`, because v0.1's own parse `maxDepth` is the same number
   * (64) counting a coarser unit. `values` makes that gap *wider*, not
   * narrower — each semantic `values` step costs **two** raw YAML levels
   * (`values:` then its `demand:`), where a bare `items` chain costs one.
   * Confirmed by running it: a `values` chain long enough to matter is
   * refused by the parser as `document-unreachable` long before
   * `src/validate/`'s own guard is consulted. The guard remains a real
   * second line of defence for a caller who raises `ParseLimits.maxDepth`,
   * a future adapter, or a hand-built `MergedConfiguration` — which is
   * exactly what this test is.
   */
  function nestedValuesDemand(id: string, depth: number): Node {
    let inner: Node = createMapping([["type", createStringScalar("string", span(id, 1))]], span(id, 2));
    for (let level = 0; level < depth; level += 1) {
      inner = createMapping([["values", createMapping([["demand", inner]], span(id, 300 + level))]], span(id, 100 + level));
    }
    return inner;
  }

  /** `depth` nested single-entry mappings wrapping an inert string leaf — the value-side mirror, needed to drive `check.ts`'s runtime walk (not `vocabulary.ts`'s schema-shape pass) to the same semantic depth. */
  function nestedMappingValue(id: string, depth: number): Node {
    let inner: Node = createStringScalar("leaf", span(id, 1));
    for (let level = 0; level < depth; level += 1) {
      inner = createMapping([["k", inner]], span(id, 200 + level));
    }
    return inner;
  }

  it(`exactly ${MAX_DEMAND_DEPTH} levels of values is accepted (boundary, not refused)`, () => {
    const schemaId = "values-boundary-schema";
    const configId = "values-boundary-config";
    const layers = [schemaLayerWithDemand(schemaId, 0, nestedValuesDemand(schemaId, MAX_DEMAND_DEPTH)), configLayerWithValue(configId, 1, nestedMappingValue(configId, MAX_DEMAND_DEPTH))];
    const result = validate(configurationFrom(layers));
    expect(result.ok, result.ok ? "ok" : JSON.stringify(result.diagnostics.map((d) => d.code))).toBe(true);
  });

  it(`${MAX_DEMAND_DEPTH} + 1 levels of values is refused as depth-limit-exceeded, at the values keyword's own pointer`, () => {
    const schemaId = "values-over-schema";
    const layers = [schemaLayerWithDemand(schemaId, 0, nestedValuesDemand(schemaId, MAX_DEMAND_DEPTH + 1)), configLayerWithValue("values-over-config", 1, undefined)];
    const result = validate(configurationFrom(layers));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("depth-limit-exceeded");
    // Derived by hand from contracts/values-and-directives.md §1.7, not
    // from output: each accepted level contributes "/values/demand", and
    // the level that crosses the bound is named by "/values" alone.
    expect(result.diagnostics[0]?.demand?.pointer).toBe("/keys/value/demand" + "/values/demand".repeat(MAX_DEMAND_DEPTH) + "/values");
  });

  it("a values chain deep enough to reach the guard cannot be written as a document at all — the parser refuses it first", async () => {
    const schemaLines: string[] = ["keys:", "  deep:", "    demand:"];
    let indent = "      ";
    for (let level = 0; level < MAX_DEMAND_DEPTH; level += 1) {
      schemaLines.push(`${indent}values:`, `${indent}  demand:`);
      indent += "    ";
    }
    schemaLines.push(`${indent}type: int`);
    const result = await loadFiles({ "/v/schema.yaml": `${schemaLines.join("\n")}\n`, "/v/config.yaml": "$schema: ./schema.yaml\ndeep: {}\n" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.code)).toEqual(["document-unreachable"]);
  });
});

describe("v0.7 part 2 FR-005 — §5.2's values row, discharged dynamically under whole-chain validation", () => {
  const ROOT = ["keys:", "  tags:", "    demand:", "      type: mapping", "      values:", "        demand:", "          type: string", ""].join("\n");

  it("a descendant that says nothing about values cannot rescue a value the ancestor's values refuses", async () => {
    const result = await loadFiles({
      "/v/root.yaml": ROOT,
      "/v/child.yaml": ["$adopts: ./root.yaml", "keys:", "  tags:", "    demand:", "      type: mapping", ""].join("\n"),
      "/v/config.yaml": ["$schema: ./child.yaml", "tags:", "  alpha: 7", ""].join("\n"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The ancestor's own layer is the one that refuses — pedigree position 0.
    expect(result.diagnostics.map((d) => [d.code, d.pedigreePosition])).toEqual([["type-mismatch", 0]]);
  });

  it("a descendant TIGHTENING values is legal, and both layers' demands apply", async () => {
    const result = await loadFiles({
      "/v/root.yaml": ROOT,
      "/v/child.yaml": ["$adopts: ./root.yaml", "keys:", "  tags:", "    demand:", "      type: mapping", "      values:", "        demand:", "          type: string", "          minLength: 4", ""].join("\n"),
      "/v/config.yaml": ["$schema: ./child.yaml", "tags:", "  alpha: ab", ""].join("\n"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Root's `type: string` is satisfied; only the child's own tightening fires.
    expect(result.diagnostics.map((d) => [d.code, d.pedigreePosition])).toEqual([["length-violated", 1]]);
  });

  it("the same tightened chain accepts a value satisfying both layers", async () => {
    const result = await loadFiles({
      "/v/root.yaml": ROOT,
      "/v/child.yaml": ["$adopts: ./root.yaml", "keys:", "  tags:", "    demand:", "      type: mapping", "      values:", "        demand:", "          type: string", "          minLength: 4", ""].join("\n"),
      "/v/config.yaml": ["$schema: ./child.yaml", "tags:", "  alpha: abcd", ""].join("\n"),
    });
    expect(result.ok).toBe(true);
  });
});

describe("v0.7 part 2 FR-004 — values says what shape, seal says which keys", () => {
  it("values with seal: closed and no keys refuses every entry — membership is seal's question alone", async () => {
    const result = await loadFiles({
      "/v/schema.yaml": ["keys:", "  tags:", "    demand:", "      type: mapping", "      seal: closed", "      values:", "        demand:", "          type: string", ""].join("\n"),
      "/v/config.yaml": ["$schema: ./schema.yaml", "tags:", "  alpha: fine", ""].join("\n"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // `alpha` is a perfectly good string — `values` is satisfied. It is
    // refused for not being *declared*, which is seal's verdict, not values'.
    expect(result.diagnostics.map((d) => d.code)).toEqual(["seal-violation"]);
  });
});

// --- §5.2's `values` row, as a property (constitution gate 3) --------------
//
// The three cases above are examples. Gate 3 asks for the row to be
// discharged as a **property**, the way v0.4 discharged Types/Enums/Ranges/
// `required` and v0.7 part 1 discharged `seal` and `final`: validity is the
// **conjunction** of every layer's own `values` demand, independently
// evaluated against the merged tree (§5.4) — which is precisely what makes a
// descendant's weaker (or absent) `values` unable to rescue a value some
// ancestor's stricter one rejects.
//
// The oracle is written out by hand from §5.2 and §5.4, never by calling the
// leaf checks it exists to judge — `tests/unit/validate-monotonicity.test.ts`'s
// own discipline, and the reason it duplicates `kindMatches` rather than
// importing it.

const KINDS = ["string", "int", "bool"] as const;
type Kind = (typeof KINDS)[number];

/** Independent oracle: does a value of kind `actual` satisfy `type: <demanded>`? */
function kindSatisfies(actual: Kind, demanded: Kind | undefined): boolean {
  return demanded === undefined || actual === demanded;
}

function valueOfKind(kind: Kind, id: string, at: number): Node {
  switch (kind) {
    case "string":
      return createStringScalar("x", span(id, at));
    case "int":
      return createIntScalar(1n, span(id, at));
    case "bool":
      return createBoolScalar(true, span(id, at));
  }
}

/** `keys: { m: { demand: { type: mapping, values: { demand: { type: <kind> } } } } }`, or no `values` at all when `kind` is undefined. */
function valuesSchemaLayer(id: string, rank: number, kind: Kind | undefined): Layer {
  const inner: [string, Node][] = [["type", createStringScalar("mapping", span(id, 1))]];
  if (kind !== undefined) {
    inner.push(["values", createMapping([["demand", createMapping([["type", createStringScalar(kind, span(id, 2))]], span(id, 3))]], span(id, 4))]);
  }
  const tree = createMapping([["keys", createMapping([["m", createMapping([["demand", createMapping(inner, span(id, 5))]], span(id, 6))]], span(id, 7))]], span(id, 8));
  return { identity: { location: id, hash: `${rank}`.repeat(64).slice(0, 64) }, role: "schema", rank, tree };
}

describe("v0.7 part 2 — §5.2's values row as a property (constitution gate 3)", () => {
  it("validity is the conjunction of every layer's own values demand, over 300 seeded trials", () => {
    let mismatches = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const rng = mulberry32(seed);
      const layerCount = 1 + Math.floor(rng() * 3);
      const declared: (Kind | undefined)[] = [];
      for (let index = 0; index < layerCount; index += 1) {
        // A third of layers declare nothing — the "descendant goes silent"
        // shape §5.2's row is about.
        declared.push(rng() < 0.33 ? undefined : (KINDS[Math.floor(rng() * KINDS.length)] ?? "string"));
      }
      const entryCount = 1 + Math.floor(rng() * 3);
      const entries: [string, Node][] = [];
      const entryKinds: Kind[] = [];
      for (let index = 0; index < entryCount; index += 1) {
        const kind = KINDS[Math.floor(rng() * KINDS.length)] ?? "string";
        entryKinds.push(kind);
        entries.push([`e${index}`, valueOfKind(kind, "values-prop-config", 100 + index)]);
      }

      const layers: Layer[] = declared.map((kind, index) => valuesSchemaLayer(`values-prop-schema-${index}`, index, kind));
      layers.push({
        identity: { location: "values-prop-config", hash: "f".repeat(64) },
        role: "config",
        rank: layers.length,
        tree: createMapping([["m", createMapping(entries, span("values-prop-config", 9))]], span("values-prop-config", 10)),
      });

      // The oracle: every layer's own demand, against every entry. No
      // "nearest layer wins", no short-circuit on the first silent layer.
      const expected = declared.every((kind) => entryKinds.every((entryKind) => kindSatisfies(entryKind, kind)));
      const actual = validate(configurationFrom(layers)).ok;
      if (actual !== expected) {
        mismatches += 1;
        expect.soft(actual, `seed ${seed}: declared=${JSON.stringify(declared)} entries=${JSON.stringify(entryKinds)}`).toBe(expected);
      }
    }
    expect(mismatches).toBe(0);
  });
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
