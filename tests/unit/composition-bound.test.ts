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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkConfiguration } from "../../src/validate/check.js";
import { load, validate } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";
import { createBoolScalar, createMapping, createSequence, createIntScalar, createStringScalar, type Node } from "../../src/model/node.js";
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
  /**
   * **Re-read, not merely re-run, once FR-004a landed.** FR-005 asks that
   * memoizing change no diagnostic. It never asked that the *output* be
   * frozen forever — §10's multiplicity rule (FR-004a) deliberately
   * changes it, and a comparison against a recorded pre-FR-004a fixture
   * would have made FR-005 forbid the correction that fixed the bug.
   *
   * The instrument survives intact and is run **twice**, which is what
   * keeps it from becoming a tautology:
   *
   *   1. `memoize: true` vs `memoize: false`, both collapsed — two
   *      genuinely different code paths (one computes each named type
   *      once, one computes it 2^d times) asked to agree on the answer;
   *   2. `memoize: true` vs `memoize: false`, both **raw**
   *      (`dedupe: false`) — the original FR-005 comparison, unchanged,
   *      on unchanged output, at a depth where the raw output still
   *      exists. If memoizing altered any diagnostic, this is where it
   *      shows, and the collapse cannot hide it because the collapse is
   *      not running.
   *
   * Comparing a collapsed run against a collapsed run alone would be the
   * weaker claim, since the collapse could in principle mask a difference
   * by discarding the diagnostic that carried it. Running the raw
   * comparison as well is what forecloses that.
   */
  function fingerprint(configuration: MergedConfiguration, memoize: boolean, dedupe = true): string {
    const outcome = checkConfiguration(configuration, { memoize, dedupe });
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
    // vacuously, which is exactly how a cache test proves nothing. The
    // count is now derived rather than bounded — **nine**, and each one is
    // a distinct position: the eight `bad` keys, one per level, each
    // covered by `values` alone, plus the innermost `child` leaf. Under
    // FR-004a they no longer multiply, so a `> 10` threshold (written when
    // the same document produced hundreds) would fail for the right
    // reason; asserting the derivation instead is stronger than either.
    expect(JSON.parse(unbounded).length).toBe(9);
    expect(memoized).toBe(unbounded);
  });

  it("and RAW — with §10's collapse switched off — the two walks still agree exactly, which is what keeps this from being a tautology", () => {
    // Depth 5 rather than 8: the raw output of this shape is exponential
    // by construction (that is the finding FR-004a fixes), and the
    // *unmemoized* raw walk has to actually run for its output to be the
    // oracle. Small enough to run, large enough that a difference in any
    // one of the hundreds of diagnostics would show.
    const configuration = violatingConfiguration(5);
    const memoizedRaw = fingerprint(configuration, true, false);
    const unboundedRaw = fingerprint(configuration, false, false);
    expect(JSON.parse(unboundedRaw).length).toBeGreaterThan(30);
    expect(memoizedRaw).toBe(unboundedRaw);
    // And the collapse is what the two of them have in common afterwards.
    expect(JSON.parse(fingerprint(configuration, true)).length).toBeLessThan(JSON.parse(memoizedRaw).length);
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

describe("v1.0 FR-004a — one violated demand at one position is ONE diagnostic (SPEC.md §10, amended)", () => {
  /**
   * **The other half of the bound, and the half that needed governance.**
   *
   * The memo made the *walk* linear. It could not make the *output*
   * polynomial: where a violation sits at depth d under a shared recursive
   * type, the `keys` arm and the `values` arm each returned it and every
   * level up doubled the list — 2^d byte-identical diagnostics for one
   * violated demand at one position. Measured before the fix: 1,048,576 at
   * depth 20, and a **296-byte** configuration at depth 24 killed the
   * process.
   *
   * `SPEC.md` §10 now legislates the multiplicity it had been silent on:
   * *one violated demand at one position is one diagnostic.* Settled as a
   * **correction**, not a meaning change — §10 says what a diagnostic
   * carries and describes one sentence per violation, and every copy was
   * identical in every field a consumer can read, so the repetition
   * communicated nothing.
   *
   * **The identity is §10's own**: the code, the violated demand (its
   * declaring layer *and* its RFC 6901 pointer — §10 defines a demand as
   * both, and a bare pointer would collapse two layers that legitimately
   * declare the same one), and the offending value's position.
   * `violationIdentity` in `src/validate/violation.ts` is the one place it
   * is spelled, beside §10's canonical sentence, because both are §10's
   * own statements about a diagnostic.
   *
   * **It is applied as results accumulate, not at the end.** A final pass
   * cannot help: the exhaustion happens while the lists are being
   * assembled and concatenated up the recursion, long before any final
   * pass runs. `checkNamedType` collapses before it caches, so each level
   * hands its caller a bounded list; `checkConfiguration` then applies the
   * same identity once more over the whole set, which is what makes the
   * rule total rather than a property of the named-type path alone.
   */
  function violatingLinearDepth(depth: number): MergedConfiguration {
    let value: Node = createIntScalar(9n, span(ORIGIN_CONFIG)); // an int violates `mapping | string`
    for (let level = 0; level < depth; level += 1) {
      value = createMapping([["child", value]], span(ORIGIN_CONFIG));
    }
    return configurationOf(sharedRecursiveSchema(), createMapping([["root", value]], span(ORIGIN_CONFIG)));
  }

  it("a violation at depth d yields exactly one diagnostic, at every depth — never 2^d", () => {
    for (const depth of [0, 1, 2, 3, 4, 8, 12, 20]) {
      const result = validate(violatingLinearDepth(depth));
      expect(result.ok, `depth ${depth}`).toBe(false);
      if (result.ok) continue;
      expect(result.diagnostics, `depth ${depth}`).toHaveLength(1);
      expect(result.diagnostics[0]?.code).toBe("type-mismatch");
      expect(result.diagnostics[0]?.pointer).toBe(`/root${"/child".repeat(depth)}`);
    }
  }, 60_000);

  it("the collapsed duplicates were byte-identical in EVERY readable field — the fuller equality, so a field that legitimately differed could not have been silently collapsed", () => {
    // The raw walk stays runnable (`dedupe: false`) at a depth where its
    // output still exists, for exactly this assertion. Without it the
    // identity would be checked only against itself: keying on §10's
    // triple and then asserting §10's triple matches is a tautology, and
    // what has to be shown is that the *rest* of the diagnostic matched
    // too — otherwise a future field that legitimately varies would be
    // collapsed away silently.
    const configuration = violatingLinearDepth(8);
    const raw = checkConfiguration(configuration, { dedupe: false });
    expect(raw.diagnostics).toHaveLength(2 ** 8);
    const fully = new Set(
      raw.diagnostics.map((d) =>
        JSON.stringify({
          code: d.code,
          level: d.level,
          message: d.message,
          pointer: d.pointer ?? null,
          pedigreePosition: d.pedigreePosition ?? null,
          related: d.related,
          delegatedFrom: d.delegatedFrom ?? null,
          demand: d.demand === undefined ? null : { pointer: d.demand.pointer, origin: d.demand.span.origin.id, start: d.demand.span.start, end: d.demand.span.end, line: d.demand.span.line, column: d.demand.span.column },
          primary: { origin: d.primary.origin.id, start: d.primary.start, end: d.primary.end, line: d.primary.line, column: d.primary.column },
        }),
      ),
    );
    expect(fully.size, "256 diagnostics differing in some field would mean the identity is collapsing information").toBe(1);
    // And the collapse keeps exactly one of them, unchanged.
    const collapsed = checkConfiguration(configuration);
    expect(collapsed.diagnostics).toHaveLength(1);
    expect(JSON.stringify(collapsed.diagnostics[0])).toBe(JSON.stringify(raw.diagnostics[0]));
  });

  it("collapsing keeps the FIRST occurrence, so diagnostic order is the order the walk produced", () => {
    const configuration = violatingLinearDepth(6);
    const raw = checkConfiguration(configuration, { dedupe: false });
    const collapsed = checkConfiguration(configuration);
    // De-duplicating `raw` by hand, keeping first occurrences, must give
    // exactly what the implementation gives — same members, same order.
    const seen = new Set<string>();
    const expected: string[] = [];
    for (const diagnostic of raw.diagnostics) {
      const key = `${diagnostic.code}\u0000${diagnostic.demand?.pointer ?? ""}\u0000${diagnostic.pedigreePosition ?? ""}\u0000${diagnostic.pointer ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      expected.push(diagnostic.message);
    }
    expect(collapsed.diagnostics.map((d) => d.message)).toEqual(expected);
  });

  it("AND THE PLACEMENT IS PINNED TOO: depth 40 — where 2^depth cannot fit in any machine — is still one diagnostic", () => {
    // **This case, not the 296-byte one, is what proves the collapse
    // happens as results accumulate.** Sabotaging the accumulating
    // collapse and leaving only the final pass does *not* kill the
    // depth-24 case: the final pass runs before `renderViolation`, so it
    // saves the process from building 16.7M `Diagnostic` objects and the
    // case survives — 7.97 s instead of 8 ms, on ~270 MB of transient
    // references. Slower by three orders of magnitude, and still alive.
    //
    // At depth 40 that escape closes for good: 2^40 references is a
    // terabyte, and no final pass can be reached. With the collapse
    // applied as results accumulate the work is linear in depth and this
    // returns instantly. A ~470-byte document, still well inside §11's
    // parse-depth cap of 64.
    let value: Node = createIntScalar(9n, span(ORIGIN_CONFIG));
    for (let level = 0; level < 40; level += 1) {
      value = createMapping([["child", value]], span(ORIGIN_CONFIG));
    }
    const configuration = configurationOf(sharedRecursiveSchema(), createMapping([["root", value]], span(ORIGIN_CONFIG)));
    const result = validate(configuration);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
  }, 30_000);

  it("THE PINNED CASE: a 296-byte configuration at depth 24 returns a verdict instead of exhausting memory, end to end through load()", async () => {
    // The document that killed the process. Real bytes, real `load()`,
    // through the host seam — not a hand-built tree, because the point of
    // the finding was that a *legal, ordinary, tiny* document did this.
    const root = join(__dirname, "..", "corpus", "cases", "composition", "deep-shared-recursion");
    const configPath = join(root, "config.yaml");
    expect(readFileSync(configPath).byteLength, "the pinned case is this exact document").toBe(296);
    const result = await load(configPath, { host: createNodeHost(), sandboxRoot: root });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Before §10's multiplicity rule this was 2^24 = 16,777,216 copies of
    // one violation. It is one.
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("type-mismatch");
    expect(result.diagnostics[0]?.pointer).toBe(`/root${"/child".repeat(24)}`);
  }, 60_000);
});

describe("v1.0 FR-004a — the identity does NOT over-collapse: two genuinely different violations stay two", () => {
  /**
   * The dangerous half of a de-duplication. A cache that confuses two
   * subtrees produces a wrong pointer; an over-eager collapse **hides a
   * real error**, silently, which is worse than the exhaustion it was
   * introduced to fix. Both cases below fail if the identity loses a
   * component.
   */
  it("two different demands failing at ONE position are two diagnostics — the demand pointer separates them", () => {
    // `keys.k` demands a string; `values` demands an int; the value is a
    // bool, so both fail at `/root/k`. Same code, same value pointer,
    // same layer — only the demand pointer differs, and §10 counts a
    // demand by its pointer as well as its declaring layer.
    const schema = m([["keys", m([["root", m([["demand", m([["keys", m([["k", m([["demand", m([["type", s("string")]])]])]])], ["values", m([["type", s("int")]])]])]])]])]]);
    const config = createMapping([["root", createMapping([["k", createBoolScalar(true, span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG));
    const result = validate(configurationOf(schema, config));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.map((d) => d.demand?.pointer).sort()).toEqual(["/keys/root/demand/keys/k/demand/type", "/keys/root/demand/values/type"]);
    expect(new Set(result.diagnostics.map((d) => d.pointer))).toEqual(new Set(["/root/k"]));
  });

  it("ONE demand pointer declared by TWO layers is two diagnostics — whole-chain validation still reports per layer (§5.4)", () => {
    // The case a bare (code, demand pointer, value pointer) identity would
    // silently collapse, and the reason the declaring layer is in the key:
    // §10 defines the violated demand as "its declaring layer + span, as a
    // JSON Pointer into that document", so the pointer alone is not the
    // demand.
    const schemaTree = m([["types", m([["strType", m([["demand", m([["type", s("string")]])]])]])], ["keys", m([["root", m([["demand", m([["type", s("strType")]])]])]])]]);
    const rootLayer: Layer = { identity: { location: "bound-schema", hash: "0".repeat(64) }, role: "schema", rank: 0, tree: schemaTree };
    const houseLayer: Layer = { identity: { location: "bound-house", hash: "2".repeat(64) }, role: "schema", rank: 1, tree: schemaTree };
    const configLayer: Layer = { identity: { location: "bound-config", hash: "1".repeat(64) }, role: "config", rank: 2, tree: createMapping([["root", createIntScalar(9n, span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG)) };
    const layers = [rootLayer, houseLayer, configLayer];
    const configuration: MergedConfiguration = { tree: fold(layers), provenance: new Map(), pedigree: [], layers, delegationBreadcrumbs: new Map(), finalState: new Map() };
    const result = validate(configuration);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.map((d) => d.pedigreePosition)).toEqual([0, 1]);
  });

  it("two violations of DIFFERENT kinds at one position stay two — the code separates them", () => {
    const schema = m([["keys", m([["root", m([["demand", m([["maxLength", createIntScalar(2n, span(ORIGIN_SCHEMA))], ["pattern", s("^z")], ["type", s("string")]])]])]])]]);
    const config = createMapping([["root", createStringScalar("abcdef", span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG));
    const result = validate(configurationOf(schema, config));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.code).sort()).toEqual(["length-violated", "pattern-mismatch"]);
  });
});
