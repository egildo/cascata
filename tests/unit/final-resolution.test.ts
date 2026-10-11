/**
 * `src/merge/final.ts`'s own unit + property coverage — v0.7 FR-010
 * through FR-014, SPEC.md §6.3. Discharges tasks.md T027 (Constitution
 * Principle II: the monotonicity table's row — `final` refuses *every*
 * redeclaration shape, not only widenings) as an executable property
 * test.
 *
 * `seal`'s own monotonicity ("open -> closed legal, closed -> open
 * inert") moved into `src/validate/`, since `seal` now lives in the
 * `demand` vocabulary and needs no whole-stack resolution at all — see
 * `tests/unit/seal.test.ts` for its own end-to-end coverage. This file
 * covers only what remains here: `final`, per key, **top-level only**
 * (SPEC.md §9, amended — a nested key declaration carries `demand` and
 * `delegate` only, never `final`).
 *
 * Hand-built `Layer`s, mirroring `tests/unit/monotonicity.test.ts`'s own
 * house style — no `resolve()`/parsing involved, so these run against
 * `resolveFinal` in isolation.
 */
import { describe, expect, it } from "vitest";
import { createBoolScalar, createMapping, createStringScalar, type Node } from "../../src/model/node.js";
import { createOrigin, createSourceSpan, type SourceSpan } from "../../src/model/span.js";
import { resolveFinal } from "../../src/merge/final.js";
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

/** One schema layer that may declare `final` (and, for redeclaration noise, `provide`/`cascade`) on `key`, top-level only. `final: undefined` writes no `final` key at all; `final: true`/`false` writes the literal boolean. */
function schemaLayerFor(id: string, rank: number, key: string, opts: { final?: boolean; provide?: boolean; cascade?: boolean }): Layer {
  const entries: [string, Node][] = [];
  if (opts.final !== undefined) {
    entries.push(["final", createBoolScalar(opts.final, span(id, 20))]);
  }
  if (opts.provide === true) {
    entries.push(["provide", createStringScalar(`${id}-value`, span(id, 30))]);
  }
  if (opts.cascade === true) {
    entries.push(["cascade", createStringScalar("append", span(id, 35))]);
  }
  const keysEntries: [string, Node][] = entries.length > 0 ? [[key, createMapping(entries, span(id, 40))]] : [];
  const tree = createMapping([["keys", createMapping(keysEntries, span(id, 50))]], span(id, 60));
  return { identity: { location: id, physical: id, hash: "0".repeat(64) }, role: "schema", rank, tree };
}

function configLayerFor(id: string, rank: number): Layer {
  return { identity: { location: id, physical: id, hash: "0".repeat(64) }, role: "config", rank, tree: createMapping([], span(id, 0)) };
}

const KEY = "network";
const TRIALS = 300;

describe("resolveFinal — final refuses every redeclaration shape, not only widenings (v0.7 FR-010)", () => {
  it("a descendant restating provide alone (no final) after final is still refused", () => {
    // The discriminating case FR-010 names explicitly: ANY declaration is refused, not only an attempt to redeclare `final` itself.
    const layers: Layer[] = [
      schemaLayerFor("root", 0, KEY, { final: true }),
      schemaLayerFor("descendant", 1, KEY, { provide: true }), // no `final` at all -- would be a totally ordinary provide anywhere else
      configLayerFor("c0", 2),
    ];
    const { diagnostics, state } = resolveFinal(layers);
    expect(diagnostics.some((d) => d.code === "final-key-redeclared")).toBe(true);
    // The redeclaration is inert: the key's own final state stays exactly as the root left it (no provide).
    expect(state.get(KEY)?.final?.hasProvide).toBe(false);
  });

  it("over randomly generated layer stacks, EVERY declaration shape after final is refused: final-again, provide alone, or cascade alone", () => {
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const rng = mulberry32(50_000 + trial);
      const finalAt = randInt(rng, 0, 2);
      const afterAt = finalAt + 1 + randInt(rng, 0, 2);
      const shape = randInt(rng, 0, 2); // 0: final again, 1: provide alone, 2: cascade alone

      const layers: Layer[] = [];
      for (let i = 0; i <= afterAt; i += 1) {
        if (i === finalAt) {
          layers.push(schemaLayerFor(`s${trial}-${i}`, i, KEY, { final: true }));
        } else if (i === afterAt) {
          if (shape === 0) layers.push(schemaLayerFor(`s${trial}-${i}`, i, KEY, { final: true }));
          else if (shape === 1) layers.push(schemaLayerFor(`s${trial}-${i}`, i, KEY, { provide: true }));
          else layers.push(schemaLayerFor(`s${trial}-${i}`, i, KEY, { cascade: true }));
        } else {
          layers.push(schemaLayerFor(`s${trial}-${i}`, i, KEY, {}));
        }
      }
      layers.push(configLayerFor(`c${trial}`, afterAt + 1));

      const { diagnostics } = resolveFinal(layers);
      expect(diagnostics.some((d) => d.code === "final-key-redeclared"), `trial ${trial}: shape ${shape} after final at ${finalAt}, offending at ${afterAt}`).toBe(true);
    }
  });

  it("a config declaring final has no effect (v0.7 FR-014)", () => {
    const layers: Layer[] = [{ identity: { location: "c0", physical: "c0", hash: "0".repeat(64) }, role: "config", rank: 0, tree: createMapping([["keys", createMapping([[KEY, createMapping([["final", createBoolScalar(true, span("c0", 1))]], span("c0", 2))]], span("c0", 3))]], span("c0", 4)) }];
    const { state, diagnostics } = resolveFinal(layers);
    expect(diagnostics).toEqual([]);
    expect(state.size).toBe(0);
  });

  it("final: true arms it; final: false is inert and does not", () => {
    const layers: Layer[] = [schemaLayerFor("s0", 0, KEY, { final: false }), configLayerFor("c0", 1)];
    const { state, diagnostics } = resolveFinal(layers);
    expect(diagnostics).toEqual([]);
    expect(state.get(KEY)?.final).toBeUndefined();
  });

  it("v0.7 FR-009c's second half: final: false declared by a DESCENDANT after an ancestor already sealed final: true is refused as a weakening, via final-key-redeclared -- not silently accepted as 'reopening'", () => {
    const layers: Layer[] = [
      schemaLayerFor("root", 0, KEY, { final: true }),
      schemaLayerFor("descendant", 1, KEY, { final: false }),
      configLayerFor("c0", 2),
    ];
    const { state, diagnostics } = resolveFinal(layers);
    expect(diagnostics.some((d) => d.code === "final-key-redeclared")).toBe(true);
    // The redeclaration is inert: the root's own final state is unchanged -- final: false from the descendant does NOT reopen the key.
    expect(state.get(KEY)?.final?.layer.identity.location).toBe("root");
  });

  it("hasProvide is recorded correctly: final alone vs. final+provide together", () => {
    const noProvide = resolveFinal([schemaLayerFor("s0", 0, KEY, { final: true }), configLayerFor("c0", 1)]);
    expect(noProvide.state.get(KEY)?.final?.hasProvide).toBe(false);

    const withProvide = resolveFinal([schemaLayerFor("s0", 0, KEY, { final: true, provide: true }), configLayerFor("c0", 1)]);
    expect(withProvide.state.get(KEY)?.final?.hasProvide).toBe(true);
  });
});
