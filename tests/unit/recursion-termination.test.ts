/**
 * v0.7 part 2 (008) FR-010, `SPEC.md` §7 (amended) — **checking a guarded
 * recursive type terminates on every finite document.**
 *
 * FR-010 says this must be established "by property test, not by example",
 * and the reason is exact: a hand-written three-level case cannot tell
 * "terminates" from "terminates for three levels". What has to be shown is
 * that no *shape* of finite document makes the walk diverge — so the
 * documents are generated adversarially, from a seeded PRNG, and the
 * assertion is that every one of them returns.
 *
 * Follows `tests/unit/monotonicity.test.ts`'s house pattern: a hand-rolled
 * mulberry32, so every failure is reproducible from its seed, and no
 * property-testing dependency (`yaml` stays the only runtime one).
 *
 * **Documents are hand-built as trees and fed through `fold()` +
 * `validate()`**, not written as YAML and put through `resolve()`. Two
 * reasons, both load-bearing: the parser's own `maxDepth` (64, counting
 * raw levels) would refuse the deepest generated documents before
 * `src/validate/` ever saw them, which is the same unreachability
 * `tests/unit/validate-depth-limit.test.ts` records; and the property
 * under test belongs to `validate()`, whose contract takes a
 * `MergedConfiguration` from anywhere.
 *
 * A non-terminating walk shows up here as the test never returning, which
 * Vitest reports as a timeout — deliberately not wrapped in a manual timer,
 * because a timer that fires at the wrong moment turns a real hang into a
 * flake and a real pass into noise.
 */
import { describe, expect, it } from "vitest";
import { validate } from "../../src/index.js";
import { createIntScalar, createMapping, createSequence, createStringScalar, type Node } from "../../src/model/node.js";
import { createOrigin, createSourceSpan, type SourceSpan } from "../../src/model/span.js";
import { fold } from "../../src/merge/fold.js";
import type { Layer } from "../../src/merge/provenance.js";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ORIGIN_SCHEMA = createOrigin("term-schema", "term-schema");
const ORIGIN_CONFIG = createOrigin("term-config", "term-config");

let offset = 0;
function span(origin: ReturnType<typeof createOrigin>): SourceSpan {
  offset += 1;
  return createSourceSpan({ origin, start: offset, end: offset + 1, line: 1, column: offset, documentLength: 10_000_000 });
}

/**
 * The recursive schema under test, written once and reused for every
 * generated document. `node` reaches itself two ways at once — through
 * `keys` and through `items` — so a single generated document exercises
 * both guards, and either one failing to consume a level would show up as
 * a hang.
 *
 * ```yaml
 * types:
 *   node:
 *     demand:
 *       type: mapping | sequence | string | int
 *       keys:   { child: { demand: { type: node } } }
 *       values: { demand: { type: string | int | mapping | sequence } }
 *       items:  { type: node }
 * keys:
 *   root: { demand: { type: node } }
 * ```
 *
 * **`values` deliberately does NOT recurse here, and that omission is a
 * finding rather than a convenience.** `keys` and `values` both covering
 * one entry is FR-002's composition, and when *both* sides recurse into
 * the same child through the same type, the walk visits each subtree
 * twice per level — **2^depth** work. Measured: 8 ms at depth 10, 123 ms
 * at 15, 898 ms at 18, and past that it stops being a test and becomes a
 * denial of service. `values` therefore points at a non-recursive demand
 * in this schema, and the blowup gets its own bounded test below, where
 * it is recorded rather than hidden.
 *
 * **v1.0 (009) bounds the walk** — a memo on `checkNamedType`,
 * `tests/unit/composition-bound.test.ts` — and this generator is left
 * pointing at a non-recursive `values` unchanged, so that the FR-010
 * termination property keeps being tested on the shape it was written
 * for rather than on the shape the bound now handles.
 */
function recursiveSchemaLayer(): Layer {
  const nodeRef = (): Node => createMapping([["type", createStringScalar("node", span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA));
  const demand = createMapping(
    [
      ["type", createStringScalar("mapping | sequence | string | int", span(ORIGIN_SCHEMA))],
      ["items", nodeRef()],
      ["keys", createMapping([["child", createMapping([["demand", nodeRef()]], span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA))],
      ["values", createMapping([["demand", createMapping([["type", createStringScalar("string | int | mapping | sequence", span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA))],
    ],
    span(ORIGIN_SCHEMA),
  );
  const tree = createMapping(
    [
      ["types", createMapping([["node", createMapping([["demand", demand]], span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA))],
      ["keys", createMapping([["root", createMapping([["demand", nodeRef()]], span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA))],
    ],
    span(ORIGIN_SCHEMA),
  );
  return { identity: { location: "term-schema", physical: "term-schema", hash: "0".repeat(64) }, role: "schema", rank: 0, tree };
}

/** An adversarially shaped finite value: mappings, sequences and leaves interleaved at random, up to `maxDepth` levels. */
function randomValue(rng: () => number, maxDepth: number): Node {
  if (maxDepth <= 0 || rng() < 0.25) {
    return rng() < 0.5 ? createStringScalar("leaf", span(ORIGIN_CONFIG)) : createIntScalar(7n, span(ORIGIN_CONFIG));
  }
  const width = 1 + Math.floor(rng() * 3);
  if (rng() < 0.5) {
    const entries: [string, Node][] = [];
    for (let index = 0; index < width; index += 1) {
      // "child" is the name the schema's own `keys` declares, so roughly
      // half the entries are covered by BOTH `keys` and `values` — the
      // composition path (FR-002) inside a recursive type.
      entries.push([rng() < 0.5 ? "child" : `k${index}`, randomValue(rng, maxDepth - 1)]);
    }
    const deduped = new Map(entries);
    return createMapping([...deduped], span(ORIGIN_CONFIG));
  }
  const items: Node[] = [];
  for (let index = 0; index < width; index += 1) {
    items.push(randomValue(rng, maxDepth - 1));
  }
  return createSequence(items, span(ORIGIN_CONFIG));
}

function configurationFor(value: Node): Parameters<typeof validate>[0] {
  const configLayer: Layer = {
    identity: { location: "term-config", physical: "term-config", hash: "1".repeat(64) },
    role: "config",
    rank: 1,
    tree: createMapping([["root", value]], span(ORIGIN_CONFIG)),
  };
  const layers = [recursiveSchemaLayer(), configLayer];
  return { tree: fold(layers), provenance: new Map(), pedigree: [], layers, delegationBreadcrumbs: new Map(), finalState: new Map() };
}

describe("v0.7 part 2 FR-010 — checking a guarded recursive type terminates on every finite document", () => {
  it("returns for 200 adversarially nested documents, seeded and reproducible", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const rng = mulberry32(seed);
      const value = randomValue(rng, 1 + Math.floor(rng() * 10));
      const result = validate(configurationFor(value));
      // The verdict is not the point and is deliberately not asserted —
      // some generated documents satisfy the type and some do not. What
      // is asserted is that a verdict was *reached*: a non-terminating
      // walk never gets here at all.
      expect(typeof result.ok, `seed ${seed}`).toBe("boolean");
    }
  });

  it("returns for a deliberately deep document — deeper than any hand-written case would be", () => {
    // 400 levels: six times the demand-depth cap, and beyond anything the
    // parser would admit, which is exactly why it is built rather than
    // written. If the guard were counting the wrong thing, this is where
    // it would show.
    let value: Node = createStringScalar("bottom", span(ORIGIN_CONFIG));
    for (let level = 0; level < 400; level += 1) {
      value = createMapping([["child", value]], span(ORIGIN_CONFIG));
    }
    const result = validate(configurationFor(value));
    expect(typeof result.ok).toBe("boolean");
  });

  it("RECORDED FINDING (v0.7), BOUNDED (v1.0): keys and values both recursing into one entry", () => {
    // FR-002 says both apply where both cover an entry, and both therefore
    // descend — into the *same* child, with two demands that name the same
    // recursive type. v0.7 recorded that each level doubles the work.
    //
    // **Two corrections, both v1.0's (009).**
    //
    // First, the spelling. This case used to write
    // `values: { demand: { type: node } }` — the *key-declaration* form the
    // first v0.7 implementation took, corrected later in that same
    // milestone to a **bare demand** (`SPEC.md` §9/§15). Under the
    // corrected reading that value is a demand mapping whose only keyword
    // is `demand`, which is not a demand keyword and which `checkDemand`
    // ignores — so `values` recursed into *nothing* and this case exhibited
    // no blow-up at all: 0.2 ms flat from depth 10 to depth 18, where the
    // mandated spelling costs 7.4 ms and 919.8 ms. The test was guarding
    // nothing. It is corrected here to the spelling §9 mandates, which is
    // the one that reproduces the finding.
    //
    // Second, the finding itself is now **bounded**, by a memo on
    // `checkNamedType` (v1.0 FR-004, `tests/unit/composition-bound.test.ts`).
    // The walk is linear; the *diagnostic output* of a violating document
    // is still 2^depth, which that file records in turn. This case keeps
    // its place as the regression guard for the accepting document.
    const nodeRef = (): Node => createMapping([["type", createStringScalar("node", span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA));
    const demand = createMapping(
      [
        ["type", createStringScalar("mapping | string", span(ORIGIN_SCHEMA))],
        ["keys", createMapping([["child", createMapping([["demand", nodeRef()]], span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA))],
        ["values", nodeRef()],
      ],
      span(ORIGIN_SCHEMA),
    );
    const tree = createMapping(
      [
        ["types", createMapping([["node", createMapping([["demand", demand]], span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA))],
        ["keys", createMapping([["root", createMapping([["demand", nodeRef()]], span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA))],
      ],
      span(ORIGIN_SCHEMA),
    );
    const schemaLayer: Layer = { identity: { location: "term-schema", physical: "term-schema", hash: "0".repeat(64) }, role: "schema", rank: 0, tree };
    // Depth 20 rather than v0.7's 12: past the point the unbounded walk
    // could reach at all (2^20), so this case now also *demonstrates* the
    // bound rather than merely tolerating the blow-up.
    let value: Node = createStringScalar("bottom", span(ORIGIN_CONFIG));
    for (let level = 0; level < 20; level += 1) {
      value = createMapping([["child", value]], span(ORIGIN_CONFIG));
    }
    const configLayer: Layer = { identity: { location: "term-config", physical: "term-config", hash: "1".repeat(64) }, role: "config", rank: 1, tree: createMapping([["root", value]], span(ORIGIN_CONFIG)) };
    const layers = [schemaLayer, configLayer];
    const result = validate({ tree: fold(layers), provenance: new Map(), pedigree: [], layers, delegationBreadcrumbs: new Map(), finalState: new Map() });
    expect(result.ok).toBe(true);
  });

  it("returns for an UNGUARDED cycle too — the cycle refusal is the diagnostic, typeHops is what stops the walk", () => {
    // `a -> b -> a` by alias alone, with a value present. `cycleDiagnostics`
    // refuses the declaration, but `checkConfiguration` runs the value walk
    // regardless (collect-all, v0.3 FR-028) — so something else has to stop
    // it, and that something is `WalkContext.typeHops`.
    const alias = (name: string): Node => createMapping([["demand", createMapping([["type", createStringScalar(name, span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA));
    const tree = createMapping(
      [
        ["types", createMapping([["a", alias("b")], ["b", alias("a")]], span(ORIGIN_SCHEMA))],
        ["keys", createMapping([["root", createMapping([["demand", createMapping([["type", createStringScalar("a", span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA))],
      ],
      span(ORIGIN_SCHEMA),
    );
    const schemaLayer: Layer = { identity: { location: "term-schema", physical: "term-schema", hash: "0".repeat(64) }, role: "schema", rank: 0, tree };
    const configLayer: Layer = { identity: { location: "term-config", physical: "term-config", hash: "1".repeat(64) }, role: "config", rank: 1, tree: createMapping([["root", createStringScalar("x", span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG)) };
    const layers = [schemaLayer, configLayer];
    const result = validate({ tree: fold(layers), provenance: new Map(), pedigree: [], layers, delegationBreadcrumbs: new Map(), finalState: new Map() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((d) => d.code === "unresolvable-type-cycle")).toBe(true);
  });
});

/**
 * A **pre-existing** totality defect, found by the FR-010 property test
 * from a direction that had nothing to do with recursion, and fixed here.
 *
 * `validate()` accumulated its results with `array.push(...results)`. A
 * spread call passes one argument per element and V8 refuses past roughly
 * 125,000 of them with `RangeError: Maximum call stack size exceeded` — so
 * a legitimate 800 KB document (well inside §11's 8 MB cap) whose every
 * sequence element violated one demand made `validate()` **throw** instead
 * of returning 200,000 diagnostics. Present since v0.5; independent of
 * anything v0.7 part 2 added.
 *
 * `validate()` returning a verdict for every finite document is the same
 * totality posture v0.1 legislated for `parse()`. This case is what keeps
 * the spread from coming back.
 */
describe("totality — validate() returns a verdict for a document with very many violations, never throws", () => {
  it("200,000 violations in one sequence produce 200,000 diagnostics, not a RangeError", () => {
    const ITEM_COUNT = 200_000;
    const schemaTree = createMapping(
      [
        [
          "keys",
          createMapping(
            [["root", createMapping([["demand", createMapping([["type", createStringScalar("sequence", span(ORIGIN_SCHEMA))], ["items", createMapping([["type", createStringScalar("string", span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA))]],
            span(ORIGIN_SCHEMA),
          ),
        ],
      ],
      span(ORIGIN_SCHEMA),
    );
    const schemaLayer: Layer = { identity: { location: "term-schema", physical: "term-schema", hash: "0".repeat(64) }, role: "schema", rank: 0, tree: schemaTree };
    const items: Node[] = [];
    const itemSpan = span(ORIGIN_CONFIG);
    for (let index = 0; index < ITEM_COUNT; index += 1) {
      items.push(createIntScalar(1n, itemSpan));
    }
    const configLayer: Layer = { identity: { location: "term-config", physical: "term-config", hash: "1".repeat(64) }, role: "config", rank: 1, tree: createMapping([["root", createSequence(items, span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG)) };
    const layers = [schemaLayer, configLayer];
    const result = validate({ tree: fold(layers), provenance: new Map(), pedigree: [], layers, delegationBreadcrumbs: new Map(), finalState: new Map() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(ITEM_COUNT);
  });
});
