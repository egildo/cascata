/**
 * `src/merge/seal.ts`'s own unit + property coverage — v0.7 FR-006 through
 * FR-015, SPEC.md §6.3. Discharges tasks.md T026/T027 (Constitution
 * Principle II: the monotonicity table's two new v0.7 rows —
 * `seal: open -> closed` legal, `closed -> open` never; `final` refuses
 * *every* redeclaration shape, not only widenings) as executable property
 * tests, plus the ordinary unit cases `resolveSeal` needs on its own.
 *
 * Hand-built `Layer`s, mirroring `tests/unit/monotonicity.test.ts`'s own
 * house style — no `resolve()`/parsing involved, so these run against
 * `resolveSeal` in isolation.
 */
import { describe, expect, it } from "vitest";
import { createBoolScalar, createMapping, createStringScalar, type Node } from "../../src/model/node.js";
import { createOrigin, createSourceSpan, type SourceSpan } from "../../src/model/span.js";
import { resolveSeal } from "../../src/merge/seal.js";
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

function randInt(rng: () => number, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

function origin(id: string): ReturnType<typeof createOrigin> {
  return createOrigin(id, id);
}

function span(id: string, at: number): SourceSpan {
  return createSourceSpan({ origin: origin(id), start: at, end: at + 1, line: 1, column: at + 1, documentLength: 1_000_000 });
}

/** One schema layer that may declare `seal`/`final` (and, for redeclaration noise, `provide`) on `key`. */
function schemaLayerFor(id: string, rank: number, key: string, opts: { seal?: "open" | "closed" | "garbage"; final?: boolean; provide?: boolean }): Layer {
  const entries: [string, Node][] = [];
  if (opts.seal !== undefined) {
    entries.push(["seal", createStringScalar(opts.seal, span(id, 10))]);
  }
  if (opts.final === true) {
    entries.push(["final", createBoolScalar(true, span(id, 20))]);
  }
  if (opts.provide === true) {
    entries.push(["provide", createStringScalar(`${id}-value`, span(id, 30))]);
  }
  const keysEntries: [string, Node][] = entries.length > 0 ? [[key, createMapping(entries, span(id, 40))]] : [];
  const tree = createMapping([["keys", createMapping(keysEntries, span(id, 50))]], span(id, 60));
  return { identity: { location: id, hash: "0".repeat(64) }, role: "schema", rank, tree };
}

function configLayerFor(id: string, rank: number): Layer {
  return { identity: { location: id, hash: "0".repeat(64) }, role: "config", rank, tree: createMapping([], span(id, 0)) };
}

const KEY = "network";
const TRIALS = 300;

describe("resolveSeal — seal: open -> closed is legal and silent; closed -> open is refused (v0.7 FR-009)", () => {
  it("over randomly generated layer stacks, seal never reopens once closed, and any attempt is refused", () => {
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const rng = mulberry32(trial + 1);
      const schemaCount = randInt(rng, 1, 5);
      const closeAt = randInt(rng, 0, schemaCount - 1);
      let reopenAt = -1;
      if (rng() < 0.5 && closeAt < schemaCount - 1) {
        reopenAt = randInt(rng, closeAt + 1, schemaCount - 1);
      }

      const layers: Layer[] = [];
      for (let i = 0; i < schemaCount; i += 1) {
        let seal: "open" | "closed" | undefined;
        if (i === closeAt) seal = "closed";
        else if (i === reopenAt) seal = "open";
        layers.push(schemaLayerFor(`s${trial}-${i}`, i, KEY, { seal }));
      }
      layers.push(configLayerFor(`c${trial}`, schemaCount));

      const { state, diagnostics } = resolveSeal(layers);
      const keyState = state.get(KEY);

      if (reopenAt === -1) {
        expect(diagnostics, `trial ${trial}: no reopen attempted, expected zero diagnostics`).toEqual([]);
        expect(keyState?.openness, `trial ${trial}: expected closed once closeAt=${closeAt} passed`).toBe("closed");
      } else {
        expect(diagnostics.some((d) => d.code === "seal-weakened"), `trial ${trial}: reopening at layer ${reopenAt} must be refused as seal-weakened`).toBe(true);
        // The refusal does not un-close it: openness is left "closed" (the verdict), matching cascade's own precedent (resolveStrategies never un-tightens a key on a weakening it refuses).
        expect(keyState?.openness, `trial ${trial}: a refused reopen must not actually reopen the key`).toBe("closed");
      }
    }
  });

  it("unknown-seal-value fires for a value that is neither open nor closed", () => {
    const layers = [schemaLayerFor("s0", 0, KEY, { seal: "garbage" }), configLayerFor("c0", 1)];
    const { diagnostics } = resolveSeal(layers);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("unknown-seal-value");
    expect(diagnostics[0]?.level).toBe("error");
  });
});

describe("resolveSeal — final refuses every redeclaration shape, not only widenings (v0.7 FR-010)", () => {
  it("a descendant restating the identical (or narrower) seal after final is still refused", () => {
    // The discriminating case FR-010 names explicitly: a narrowing must still be refused, or this rule is indistinguishable from ordinary monotonicity.
    const layers: Layer[] = [
      schemaLayerFor("root", 0, KEY, { seal: "open", final: true }),
      schemaLayerFor("descendant", 1, KEY, { seal: "closed" }), // narrower than open -- would be LEGAL under ordinary seal rules, but final forbids it outright
      configLayerFor("c0", 2),
    ];
    const { diagnostics, state } = resolveSeal(layers);
    expect(diagnostics.some((d) => d.code === "final-key-redeclared")).toBe(true);
    // The redeclaration is inert: the key stays exactly as `final` left it (open, in this trial), never adopting the descendant's attempted "closed".
    expect(state.get(KEY)?.openness).toBe("open");
  });

  it("over randomly generated layer stacks, EVERY declaration shape after final is refused: seal, final-again, or provide alone", () => {
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const rng = mulberry32(50_000 + trial);
      const finalAt = randInt(rng, 0, 2);
      const afterAt = finalAt + 1 + randInt(rng, 0, 2);
      const shape = randInt(rng, 0, 2); // 0: seal again, 1: final again, 2: provide alone

      const layers: Layer[] = [];
      for (let i = 0; i <= afterAt; i += 1) {
        if (i === finalAt) {
          layers.push(schemaLayerFor(`s${trial}-${i}`, i, KEY, { final: true }));
        } else if (i === afterAt) {
          if (shape === 0) layers.push(schemaLayerFor(`s${trial}-${i}`, i, KEY, { seal: "closed" }));
          else if (shape === 1) layers.push(schemaLayerFor(`s${trial}-${i}`, i, KEY, { final: true }));
          else layers.push(schemaLayerFor(`s${trial}-${i}`, i, KEY, { provide: true }));
        } else {
          layers.push(schemaLayerFor(`s${trial}-${i}`, i, KEY, {}));
        }
      }
      layers.push(configLayerFor(`c${trial}`, afterAt + 1));

      const { diagnostics } = resolveSeal(layers);
      expect(diagnostics.some((d) => d.code === "final-key-redeclared"), `trial ${trial}: shape ${shape} after final at ${finalAt}, offending at ${afterAt}`).toBe(true);
    }
  });

  it("a config declaring seal/final has no effect (v0.7 FR-014)", () => {
    const layers: Layer[] = [{ identity: { location: "c0", hash: "0".repeat(64) }, role: "config", rank: 0, tree: createMapping([["keys", createMapping([[KEY, createMapping([["seal", createStringScalar("closed", span("c0", 1))]], span("c0", 2))]], span("c0", 3))]], span("c0", 4)) }];
    const { state, diagnostics } = resolveSeal(layers);
    expect(diagnostics).toEqual([]);
    expect(state.size).toBe(0);
  });
});
