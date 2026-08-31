/**
 * v0.5 FR-025 (research.md D4): recursion through `keys`/`items` past
 * `MAX_DEMAND_DEPTH` (64) is refused, not followed into a stack overflow.
 *
 * **Why this is a synthetic-AST unit test, not a `tests/corpus/` fixture
 * (Acceptance Scenario 6's natural home).** A real `keys`/`items` schema
 * document deep enough to trip `MAX_DEMAND_DEPTH=64` cannot be built
 * through `resolve()`: every document `resolve()` reads goes through
 * `parseYamlBytes`/`parseYaml` with v0.1's own `DEFAULT_LIMITS.maxDepth`
 * (`src/adapters/yaml/limits.ts`) — also 64, but counting *every* raw
 * YAML mapping/sequence nesting level, not semantic `keys`/`items` steps.
 * Each semantic step costs at least 1 raw YAML level (a bare `items`
 * chain, the cheapest encoding) and the semantic demand itself already
 * starts 2 raw levels deep (`{keys: {value: {<demand>}}}`). Reaching
 * semantic depth 64 therefore needs raw YAML depth 66 — 2 levels past
 * where `resolve()`'s own parse step already refuses with
 * `document-unreachable` (wrapping a `depth-limit-exceeded` from the
 * *parser*, not from `src/validate/`). `resolve()` has no public option
 * to raise `ParseLimits.maxDepth` (`ResolveOptions.limits` only reaches
 * `FetchLimits`) — confirmed by tracing `parseAtLocation` in
 * `src/index.ts`, which calls `parseYamlBytes(bytes, origin)` with no
 * third argument at all. So under the *documented, resolve()-mediated
 * pipeline*, `src/validate/`'s own depth guard (`vocabulary.ts`'s
 * `recursiveVocabularyProblems` and `check.ts`'s `checkNestedItems`/
 * `checkNestedKeys`) is unreachable dead code: the parser's identical
 * numeric limit, counting a coarser unit, always fires first. Flagged in
 * full in the milestone report — this is exactly the kind of "guard that
 * turns out not to guard anything" CLAUDE.md's sabotage discipline exists
 * to surface, discovered here without needing to sabotage anything: the
 * guard already can't be reached by any document `resolve()` accepts.
 *
 * `validate()`'s own contract, though, takes a `MergedConfiguration`
 * (`src/index.ts`), not a file path — nothing requires that tree to have
 * come from `resolve()`+`merge()`. `tests/unit/validate-monotonicity.test.ts`
 * already establishes the precedent of hand-building `Layer`s and feeding
 * them through `fold()` directly, bypassing `resolve()`/`parse()`
 * entirely. That is the only way left to exercise `src/validate/`'s own
 * depth guard in isolation — and it is a legitimate second line of
 * defence regardless of today's unreachability: a future format adapter,
 * or a caller who raises `ParseLimits.maxDepth` for unrelated reasons
 * (deeply nested *data*, not demand structure), would reach it directly.
 */

import { describe, expect, it } from "vitest";
import { createMapping, createSequence, createStringScalar, type Node } from "../../src/model/node.js";
import { createOrigin, createSourceSpan, type SourceSpan } from "../../src/model/span.js";
import { fold } from "../../src/merge/fold.js";
import type { Layer } from "../../src/merge/provenance.js";
import { validate } from "../../src/index.js";

const KEY = "value";
const MAX_DEMAND_DEPTH = 64; // v0.5 FR-025 — independently restated, not imported from src/validate/vocabulary.ts (Principle V: this test must not trust the very constant it exists to check)

function origin(id: string): ReturnType<typeof createOrigin> {
  return createOrigin(id, id);
}

function span(id: string, at: number): SourceSpan {
  return createSourceSpan({ origin: origin(id), start: at, end: at + 1, line: 1, column: at + 1, documentLength: 1_000_000 });
}

/**
 * A demand mapping with `depth` nested `items` keywords wrapping a bare
 * `{type: string}` leaf — `depth=0` is the leaf itself, no nesting.
 * `depth=65` is one step past `MAX_DEMAND_DEPTH`: descending through all
 * 65 `items` keywords would put the innermost leaf's demand at semantic
 * depth 65, so the 65th (outermost-added, innermost-in-recursion-order)
 * `items` keyword is where FR-025 must refuse.
 */
function nestedItemsDemand(id: string, depth: number): Node {
  let inner: Node = createMapping([["type", createStringScalar("string", span(id, 1))]], span(id, 2));
  for (let level = 0; level < depth; level += 1) {
    inner = createMapping([["items", inner]], span(id, 100 + level));
  }
  return inner;
}

/** `depth` nested single-item sequences wrapping an inert string leaf — the value-side mirror of `nestedItemsDemand`, needed to drive `check.ts`'s *runtime* walk (not `vocabulary.ts`'s schema-shape-only pass) down to the same semantic depth. */
function nestedSequenceValue(id: string, depth: number): Node {
  let inner: Node = createStringScalar("leaf", span(id, 1));
  for (let level = 0; level < depth; level += 1) {
    inner = createSequence([inner], span(id, 200 + level));
  }
  return inner;
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
  return { tree: fold(layers), provenance: new Map(), pedigree: [], layers, delegationBreadcrumbs: new Map() };
}

describe("v0.5 FR-025 — nested keys/items recursion is depth-bounded", () => {
  it("exactly MAX_DEMAND_DEPTH levels of items is accepted (boundary, not refused)", () => {
    const schemaId = "schema-boundary-ok";
    const configId = "config-boundary-ok";
    const demand = nestedItemsDemand(schemaId, MAX_DEMAND_DEPTH);
    const value = nestedSequenceValue(configId, MAX_DEMAND_DEPTH);
    const layers = [schemaLayerWithDemand(schemaId, 0, demand), configLayerWithValue(configId, 1, value)];
    const result = validate(configurationFrom(layers));
    expect(result.ok, `expected exactly ${MAX_DEMAND_DEPTH} levels to be within the limit, got: ${result.ok ? "ok" : JSON.stringify(result.diagnostics.map((d) => d.code))}`).toBe(true);
  });

  it("MAX_DEMAND_DEPTH + 1 levels of items, with no value reaching that deep, is refused by the schema-shape (vocabulary) pass alone", () => {
    const schemaId = "schema-over-shape-only";
    const demand = nestedItemsDemand(schemaId, MAX_DEMAND_DEPTH + 1);
    // No config value at all for KEY — checkDemand's runtime walk never
    // examines "items" past the point value becomes undefined, so only
    // vocabulary.ts's schema-shape pass (which needs no value) can see this.
    const layers = [schemaLayerWithDemand(schemaId, 0, demand), configLayerWithValue("config-over-shape-only", 1, undefined)];
    const result = validate(configurationFrom(layers));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.code).toBe("depth-limit-exceeded");
    expect(diagnostic?.pedigreePosition).toBe(0);
    const expectedPointer = "/keys/value/demand" + "/items".repeat(MAX_DEMAND_DEPTH + 1);
    expect(diagnostic?.demand?.pointer).toBe(expectedPointer);
  });

  it("MAX_DEMAND_DEPTH + 1 levels of items, with a value that also recurses that deep, is refused — probe: does the runtime (check.ts) guard duplicate the schema-shape (vocabulary.ts) one?", () => {
    const schemaId = "schema-over-both";
    const configId = "config-over-both";
    const demand = nestedItemsDemand(schemaId, MAX_DEMAND_DEPTH + 1);
    const value = nestedSequenceValue(configId, MAX_DEMAND_DEPTH + 1);
    const layers = [schemaLayerWithDemand(schemaId, 0, demand), configLayerWithValue(configId, 1, value)];
    const result = validate(configurationFrom(layers));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Recorded, not asserted to a fixed count: this test exists to
    // observe whether the schema-shape and runtime guards both fire for
    // one authoring mistake (a real duplicate-diagnostic risk, the same
    // shape as the two bugs check.ts's rewrite already found and fixed
    // this milestone) or whether one pass defers to the other. See the
    // milestone report for what this run showed.
    const codes = result.diagnostics.map((d) => d.code);
    console.log(`probe: ${result.diagnostics.length} diagnostic(s) for one over-depth demand with a matching over-depth value:`, JSON.stringify(result.diagnostics.map((d) => ({ code: d.code, message: d.message, pointer: d.demand?.pointer, mergedPointer: d.pointer })), null, 2));
    expect(codes.every((c) => c === "depth-limit-exceeded")).toBe(true);
  });
});
