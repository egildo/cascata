/**
 * v1.0 (009) FR-004 through FR-007 / SC-002 — **`keys` + `values`
 * composition over a shared recursive type is bounded.**
 *
 * §9 says that where `keys` and `values` both cover an entry, both apply,
 * and demands compose by intersection. Where both sides also recurse into
 * the *same* named type, the walk therefore visits every subtree twice per
 * level: **2^depth**. v0.7 recorded the hazard and left it, since bounding
 * it is not a vocabulary question. Measured at HEAD, with the `values`
 * spelling §9 actually mandates: 7.4 ms at depth 10, 60.9 ms at 14,
 * 919.8 ms at 18, and a clean 4× per two levels — legal input, unbounded
 * work, which §11 caps for document *size* and for nothing else.
 *
 * The bound is a memo on `checkNamedType`, and that is the only place it
 * can go. The blow-up is not "the same demand twice": it is two
 * *different* demands — `keys.<name>.demand` and `values` — that both name
 * one type. They diverge at the demand pointer and re-converge the instant
 * resolution crosses into the named type, because `checkNamedType`
 * rewrites the demand pointer to `/types/<name>/demand` and the usage
 * layer to the type's own. Memoizing `checkDemand` instead would key on
 * the demand pointer, which is precisely what still differs.
 *
 * **A cache is where correctness goes to die, so this file is mostly about
 * the key rather than about the speed.** FR-005 requires diagnostics
 * identical in set *and order* to the unbounded walk's, which is
 * established by keeping the unbounded walk runnable
 * (`checkConfiguration(cfg, { memoize: false })`) and diffing the two on
 * the same input. FR-006 requires proof that a mis-keyed cache fails,
 * which is established by two cases built to collide if a key component is
 * dropped — and then by dropping it, in the code, with the probe held
 * fixed (`sabotage-must-outrun-existing-cases`, and the refinement that a
 * cache experiment with two variables proves nothing).
 *
 * **Two of the six key components are not falsifiable, and that is recorded
 * rather than hidden.** Dropping `depth` from the key leaves the whole
 * suite green; so does dropping `mergedPointer`. Both are redundant *today*
 * — `depth` equals the pointer's segment count less one, and the fold puts
 * any given node object at exactly one pointer, so node identity already
 * separates them — and both rest on invariants nothing enforces. They stay
 * in the key; the two cases below prove the two components that *are*
 * falsifiable. See `checkNamedType`'s own doc and the milestone report.
 *
 * Layers are hand-built and folded, following
 * `tests/unit/recursion-termination.test.ts`: the property belongs to
 * `validate()`, whose contract takes a `MergedConfiguration` from
 * anywhere, and the deepest documents here are deeper than the parser
 * would admit.
 */
import { describe, expect, it } from "vitest";
import { checkConfiguration } from "../../src/validate/check.js";
import { validate } from "../../src/index.js";
import { createMapping, createSequence, createIntScalar, createStringScalar, type Node } from "../../src/model/node.js";
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
  const schemaLayer: Layer = { identity: { location: "bound-schema", hash: "0".repeat(64) }, role: "schema", rank: 0, tree: schemaTree };
  const configLayer: Layer = { identity: { location: "bound-config", hash: "1".repeat(64) }, role: "config", rank: 1, tree: configTree };
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

  it("depth 18 — the case v0.7 measured at 898 ms — is now a few milliseconds, end to end through validate()", () => {
    // Not an assertion on the number; an assertion that the depth v0.7
    // called "past the point where it stops being a test and becomes a
    // denial of service" now completes inside a Vitest default timeout
    // with room to spare. The scaling claim is the test above.
    const configuration = chainConfiguration(18, createStringScalar("bottom", span(ORIGIN_CONFIG)));
    const result = validate(configuration);
    expect(result.ok).toBe(true);
  }, 20_000);
});

describe("v1.0 FR-005 — the diagnostics are identical to the unbounded walk's, in set AND order", () => {
  /** Serializes everything a caller can observe about a diagnostic, so the comparison cannot pass by comparing too little. */
  function fingerprint(configuration: MergedConfiguration, memoize: boolean): string {
    const outcome = checkConfiguration(configuration, { memoize });
    return JSON.stringify(
      outcome.diagnostics.map((d) => ({
        code: d.code,
        level: d.level,
        message: d.message,
        pointer: d.pointer ?? null,
        demand: d.demand === undefined ? null : { pointer: d.demand.pointer, start: d.demand.span.start, origin: d.demand.span.origin.id },
        primary: { start: d.primary.start, end: d.primary.end, line: d.primary.line, column: d.primary.column, origin: d.primary.origin.id },
        pedigreePosition: d.pedigreePosition ?? null,
      })),
    );
  }

  /**
   * A value that violates at *many* positions inside the composition: an
   * `int` leaf at every level, against a type admitting only
   * `mapping | string`. Depth 8 keeps the **unbounded** side fast enough
   * to run (2^8), which is the whole point — the unbounded walk has to
   * actually run for its output to be the oracle.
   */
  function violatingConfiguration(depth: number): MergedConfiguration {
    let value: Node = createIntScalar(7n, span(ORIGIN_CONFIG));
    for (let level = 0; level < depth; level += 1) {
      value = createMapping(
        [
          ["child", value],
          ["bad", createIntScalar(BigInt(level), span(ORIGIN_CONFIG))],
        ],
        span(ORIGIN_CONFIG),
      );
    }
    return configurationOf(sharedRecursiveSchema(), createMapping([["root", value]], span(ORIGIN_CONFIG)));
  }

  it("a document violating at many positions produces byte-identical diagnostics either way", () => {
    const configuration = violatingConfiguration(8);
    const memoized = fingerprint(configuration, true);
    const unbounded = fingerprint(configuration, false);
    // Guard the guard: an empty diagnostic list would make this pass
    // vacuously, which is exactly how a cache test proves nothing.
    expect(JSON.parse(unbounded).length).toBeGreaterThan(10);
    expect(memoized).toBe(unbounded);
  });

  it("a clean document produces the same (empty) answer either way, at a depth the unbounded walk can still reach", () => {
    const configuration = chainConfiguration(8, createStringScalar("bottom", span(ORIGIN_CONFIG)));
    expect(fingerprint(configuration, true)).toBe(fingerprint(configuration, false));
    expect(checkConfiguration(configuration, { memoize: false }).ok).toBe(true);
  });
});

describe("v1.0 FR-006 — the key distinguishes what must be distinguished, proved by cases that collide without it", () => {
  /**
   * **Two different named types, one value, one pointer, one depth.**
   *
   * ```yaml
   * types:
   *   strType: { demand: { type: string } }
   *   intType: { demand: { type: int } }
   * keys:
   *   root:
   *     demand:
   *       keys:   { k: { demand: { type: strType } } }
   *       values: { type: intType }
   * ```
   *
   * With `root: { k: 5 }`, both arms reach `/root/k` with the identical
   * value node, pointer, depth and hop count, differing **only** in which
   * declaration they resolved. `strType` refuses (5 is not a string);
   * `intType` accepts. Exactly one diagnostic is correct.
   *
   * Drop `decl` from the cache key and the first arm's answer is handed to
   * the second: `keys` sorts before `values`, so the refusal would be
   * returned twice and the count would be 2. This is the case that proves
   * the component, and it is checked by varying the **code** — the probe
   * is held fixed (research D-1).
   */
  it("two different named types at one position are not confused (the `decl` component)", () => {
    const schema = m([
      ["types", m([["intType", m([["demand", m([["type", s("int")]])]])], ["strType", m([["demand", m([["type", s("string")]])]])]])],
      ["keys", m([["root", m([["demand", m([["keys", m([["k", m([["demand", m([["type", s("strType")]])]])]])], ["values", m([["type", s("intType")]])]])]])]])],
    ]);
    const config = createMapping([["root", createMapping([["k", createIntScalar(5n, span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG));
    const result = validate(configurationOf(schema, config));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    // And it is `strType`'s refusal, not `intType`'s — attribution is to
    // the type's own declaration (v0.5 FR-007), so the pointer says which
    // declaration answered.
    expect(result.diagnostics[0]?.code).toBe("type-mismatch");
    expect(result.diagnostics[0]?.demand?.pointer).toBe("/types/strType/demand/type");
    expect(result.diagnostics[0]?.pointer).toBe("/root/k");
  });

  /**
   * **One named type, two different `accept` narrowings, one value, one
   * pointer.**
   *
   * ```yaml
   * types:
   *   resource: { accept: [url, path], demand: { type: string } }
   * keys:
   *   root:
   *     demand:
   *       keys:   { k: { demand: { type: resource, accept: [url] } } }
   *       values: { type: resource, accept: [path] }
   * ```
   *
   * `assets/theme.css` is a `path` and not a `url` — §7's own worked
   * narrowing, one level down. The `keys` arm refuses it; the `values` arm
   * accepts it. Drop `usageAccept` from the key and the refusal is served
   * to both arms.
   */
  it("two different accept narrowings of one type at one position are not confused (the `usageAccept` component)", () => {
    const schema = m([
      ["types", m([["resource", m([["accept", createSequence([s("url"), s("path")], span(ORIGIN_SCHEMA))], ["demand", m([["type", s("string")]])]])]])],
      [
        "keys",
        m([
          [
            "root",
            m([
              [
                "demand",
                m([
                  ["keys", m([["k", m([["demand", m([["accept", createSequence([s("url")], span(ORIGIN_SCHEMA))], ["type", s("resource")]])]])]])],
                  ["values", m([["accept", createSequence([s("path")], span(ORIGIN_SCHEMA))], ["type", s("resource")]])],
                ]),
              ],
            ]),
          ],
        ]),
      ],
    ]);
    const config = createMapping([["root", createMapping([["k", createStringScalar("assets/theme.css", span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG));
    const result = validate(configurationOf(schema, config));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.demand?.pointer).toBe("/types/resource/accept");
    expect(result.diagnostics[0]?.message).toContain("[url]");
  });

  it("the same value checked by two SEPARATE layers still reports once per layer — a cache hit here is correct, not a swallowed diagnostic", () => {
    // Two schema layers declaring the identical demand for one key. Under
    // whole-chain validation (§5.4) each layer's own check runs, so the
    // refusal is reported twice — and it must keep being reported twice
    // once a memo makes the second computation free. A cache that
    // *deduplicated* here would be changing the answer, which FR-005
    // forbids just as much as a cache that confuses two subtrees.
    const schemaTree = m([["types", m([["strType", m([["demand", m([["type", s("string")]])]])]])], ["keys", m([["root", m([["demand", m([["type", s("strType")]])]])]])]]);
    const rootLayer: Layer = { identity: { location: "bound-schema", hash: "0".repeat(64) }, role: "schema", rank: 0, tree: schemaTree };
    const houseLayer: Layer = { identity: { location: "bound-house", hash: "2".repeat(64) }, role: "schema", rank: 1, tree: schemaTree };
    const configLayer: Layer = { identity: { location: "bound-config", hash: "1".repeat(64) }, role: "config", rank: 2, tree: createMapping([["root", createIntScalar(9n, span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG)) };
    const layers = [rootLayer, houseLayer, configLayer];
    const configuration: MergedConfiguration = { tree: fold(layers), provenance: new Map(), pedigree: [], layers, delegationBreadcrumbs: new Map(), finalState: new Map() };
    const memoized = checkConfiguration(configuration, { memoize: true });
    const unbounded = checkConfiguration(configuration, { memoize: false });
    expect(memoized.diagnostics).toHaveLength(2);
    expect(memoized.diagnostics.map((d) => d.message)).toEqual(unbounded.diagnostics.map((d) => d.message));
  });
});

describe("v1.0 FR-007 — the cache bounds work, not depth: the existing depth cap still fires", () => {
  /** The same recursive type reached through `keys` alone — still the memoized named-type path, without the diagnostic multiplication the recorded finding below explains. */
  function linearRecursiveSchema(): Node {
    return m([
      ["types", m([["node", m([["demand", m([["type", s("mapping | string")], ["keys", m([["child", m([["demand", m([["type", s("node")]])]])]])]])]])]])],
      ["keys", m([["root", m([["demand", m([["type", s("node")]])]])]])],
    ]);
  }

  function linearChain(depth: number): MergedConfiguration {
    let value: Node = createStringScalar("bottom", span(ORIGIN_CONFIG));
    for (let level = 0; level < depth; level += 1) {
      value = createMapping([["child", value]], span(ORIGIN_CONFIG));
    }
    return configurationOf(linearRecursiveSchema(), createMapping([["root", value]], span(ORIGIN_CONFIG)));
  }

  it("exactly MAX_DEMAND_DEPTH levels through a memoized recursive type is still accepted", () => {
    expect(validate(linearChain(64)).ok).toBe(true);
  });

  it("one level past it is still refused, through the memoized path, with the cap's own code", () => {
    const result = validate(linearChain(65));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.code)).toEqual(["depth-limit-exceeded"]);
  });

  it("and the cap fires identically with the memo off — the cache bounds work, not depth", () => {
    const configuration = linearChain(65);
    const withMemo = checkConfiguration(configuration, { memoize: true });
    const without = checkConfiguration(configuration, { memoize: false });
    expect(withMemo.diagnostics.map((d) => `${d.code}${d.pointer ?? ""}`)).toEqual(without.diagnostics.map((d) => `${d.code}${d.pointer ?? ""}`));
    expect(withMemo.diagnostics.some((d) => d.code === "depth-limit-exceeded")).toBe(true);
  });
});

describe("RECORDED FINDING — the memo bounds the WALK; the diagnostic OUTPUT of a violating document is still 2^depth", () => {
  /**
   * **This is the milestone's sharpest finding and it is deliberately a
   * test rather than a comment.**
   *
   * The memo makes the walk linear, which fixes v0.7's measured case
   * exactly: a *clean* document at depth 18 went from 919.8 ms to under a
   * millisecond. It does **not** — and provably cannot, under FR-005 —
   * bound the size of the *answer*. Where a violation sits at depth d
   * under a shared recursive type, the `keys` arm and the `values` arm
   * each return it, and each level up doubles the list: **2^d
   * byte-identical diagnostics for one violated demand at one position.**
   *
   * Measured here: 2, 4, 8, 16 at depths 1–4, and 4096 at depth 12 —
   * memoized and unmemoized alike, which is the point. FR-005 requires
   * the diagnostics to be *identical to the unbounded walk's*, and the
   * unbounded walk produces exactly these. Collapsing them would be a
   * change to what `validate()` returns for a document it already
   * accepts-or-refuses today, which is a governance decision and not an
   * implementer's (`SPEC.md` §10 legislates what a diagnostic carries and
   * is silent on multiplicity; v0.3 FR-028's "never twice" was written
   * about two *passes*, not two demands).
   *
   * The consequence is real and is reported rather than buried: a legal
   * config of ~30 nested levels — well inside §11's parse-depth cap of 64
   * — with one deep violation under a `keys`+`values` shared recursive
   * type still exhausts memory. v1.0 bounds the walk and leaves this
   * standing. See the milestone report.
   */
  function violatingLinearDepth(depth: number): MergedConfiguration {
    let value: Node = createIntScalar(9n, span(ORIGIN_CONFIG)); // an int violates `mapping | string`
    for (let level = 0; level < depth; level += 1) {
      value = createMapping([["child", value]], span(ORIGIN_CONFIG));
    }
    return configurationOf(sharedRecursiveSchema(), createMapping([["root", value]], span(ORIGIN_CONFIG)));
  }

  it("doubles per level, and does so identically with the memo on and off", () => {
    for (const depth of [1, 2, 3, 4, 8]) {
      const configuration = violatingLinearDepth(depth);
      const memoized = checkConfiguration(configuration, { memoize: true });
      const unbounded = checkConfiguration(configuration, { memoize: false });
      expect(memoized.diagnostics, `depth ${depth}`).toHaveLength(2 ** depth);
      expect(unbounded.diagnostics, `depth ${depth} — the unbounded walk produces the same count, which is why FR-005 forbids collapsing them`).toHaveLength(2 ** depth);
      expect(memoized.diagnostics.map((d) => `${d.code}${d.pointer ?? ""}${d.demand?.pointer ?? ""}`)).toEqual(unbounded.diagnostics.map((d) => `${d.code}${d.pointer ?? ""}${d.demand?.pointer ?? ""}`));
    }
  }, 60_000);

  it("every one of them is byte-identical in every field a consumer can read — which is why collapsing them would lose nothing, and why doing so is still not an implementer's call", () => {
    const outcome = checkConfiguration(violatingLinearDepth(6));
    expect(outcome.diagnostics).toHaveLength(64);
    const distinct = new Set(outcome.diagnostics.map((d) => JSON.stringify({ code: d.code, level: d.level, message: d.message, pointer: d.pointer ?? null, demand: d.demand?.pointer ?? null, primary: d.primary.start, pedigreePosition: d.pedigreePosition ?? null })));
    expect(distinct.size).toBe(1);
  });
});
