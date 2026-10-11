/**
 * Constitution Principle II, `SPEC.md` §5.2's monotonicity table, v0.3
 * FR-023 and FR-024; tasks.md T033, T034.
 *
 * The first milestone Principle II binds on: "The normative monotonicity
 * table MUST exist as executable property tests, one case per row." Two
 * rows of the table are discharged here, each as far as this milestone's
 * vocabulary can construct it (research D5) — not by simulating the parts
 * it cannot:
 *
 * - **`cascade: append` arrays** (§5.2's row: "Append provisions" legal,
 *   "Remove inherited items" never) — discharged **fully**. Over randomly
 *   generated layer stacks: appending never removes an item accumulation
 *   actually reached, and the order is always root-first from wherever
 *   accumulation began. Separately, no stack in which a strategy weakens
 *   from `append` to `replace` is ever accepted — the `cascade` strategy
 *   row's "Never" clause, immediately below the arrays row in the table
 *   and load-bearing for it (a silent weakening would let the arrays
 *   row's "never remove" be violated by construction).
 *
 *   **Corrected for v0.3 FR-026 (tasks.md T034).** This file's own first
 *   version encoded "no ancestor's contribution is ever absent" —
 *   literally every layer's own items, unconditionally — which was the
 *   *uniform* reading of §5.2's "once a key accumulates, it keeps
 *   accumulating" that a v0.3 implementer surfaced as ambiguous and that
 *   `SPEC.md` §5.2 was then amended to settle **against**: a strategy
 *   governs from the layer that declares it *downward*, so a layer whose
 *   contribution was already replaced by an ordinary (still-`replace`)
 *   layer **before** any layer ever declared `append` is genuinely gone,
 *   and asserting its presence would have been asserting the bug this
 *   property test exists to catch. `simulateAccumulation` (below) computes
 *   the corrected expectation independently of the implementation, per
 *   Principle V — it does not special-case the discriminating scenario,
 *   it simply implements the same two rules `fold()` does (first
 *   contributor wins the base case; every layer after that either
 *   replaces or accumulates depending on the strategy *in effect at that
 *   layer*) and lets the random search find whichever trials exercise it.
 *
 * - **Defaults (`provide`)** (§5.2's row: "Replace with any value
 *   satisfying accumulated demands" legal, "Provide a value violating any
 *   ancestor demand" never) — discharged **only as far as `demand` exists
 *   to make it constructible**. `demand` arrives in v0.4
 *   (`src/merge/strategy.ts`'s module doc: this milestone reads `provide`
 *   and `cascade` only). What *is* testable now, and is tested below, is
 *   the legal-mutation half taken alone: a nearer layer may replace a
 *   provided value (precedence rule 1, applied to `provide` specifically).
 *   **The "satisfies accumulated demands" half of that same table cell is
 *   NOT tested here, and is not simulated with a stand-in constraint
 *   either.** Doing either would be exactly the mistake research D5 warns
 *   against: v0.2 shipped three requirements describing scenarios its own
 *   vocabulary could not yet construct, each caught by a different
 *   implementer, and the lesson recorded there was that a requirement
 *   about something needs the vocabulary producing it to exist first. A
 *   green test asserting against a fictional `demand` would have to be
 *   rewritten the moment v0.4 lands regardless of how it was written now.
 *   This half of the row is therefore **deferred to v0.4's own
 *   monotonicity tests, not stubbed** (FR-024, research D5) — recorded
 *   here in prose, the way this constitution requires an undischargeable
 *   obligation to be recorded rather than silently dropped.
 *
 * No `fast-check` or other property-testing dependency is introduced —
 * `yaml` remains the only runtime dependency, and this project has never
 * carried a dev-only generative-testing library either (CLAUDE.md: "Adding
 * anything else needs a constitution amendment"). The generators below are
 * a small hand-rolled seeded PRNG (mulberry32) plus purpose-built stack
 * builders, no different in kind from `tests/unit/fold.test.ts`'s
 * hand-constructed `Layer`s — just driven by many seeds instead of one.
 */

import { describe, expect, it } from "vitest";
import { createMapping, createSequence, createStringScalar, type Node } from "../../src/model/node.js";
import { createOrigin, createSourceSpan, type SourceSpan } from "../../src/model/span.js";
import { fold } from "../../src/merge/fold.js";
import { resolveStrategies } from "../../src/merge/strategy.js";
import type { Layer } from "../../src/merge/provenance.js";

// --- A small seeded PRNG, so every failure is reproducible from its seed ---

/** mulberry32 — a standard, tiny, deterministic 32-bit PRNG. Not cryptographic; not meant to be. */
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

const LABEL_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A random short label, independent of layer position — so that if a sabotaged implementation sorted accumulated items, the sorted order would (overwhelmingly likely, across many trials) disagree with the required root-first order. */
function randomLabel(rng: () => number): string {
  const length = randInt(rng, 4, 9);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += LABEL_ALPHABET[randInt(rng, 0, LABEL_ALPHABET.length - 1)];
  }
  return out;
}

// --- Layer builders, mirroring tests/unit/fold.test.ts's hand-constructed style ---

function origin(id: string): ReturnType<typeof createOrigin> {
  return createOrigin(id, id);
}

function span(id: string, at: number): SourceSpan {
  return createSourceSpan({ origin: origin(id), start: at, end: at + 1, line: 1, column: at + 1, documentLength: 1_000_000 });
}

function sequenceOf(id: string, values: readonly string[]): Node {
  return createSequence(
    values.map((value, index) => createStringScalar(value, span(id, index))),
    span(id, values.length),
  );
}

/** One schema layer that may declare `cascade` on `key` and/or `provide` a sequence for it. `undefined` items means the layer says nothing about `key` at all (rule 6) — distinct from an explicitly empty sequence, which is `[]`. */
function schemaLayerFor(id: string, rank: number, key: string, cascade: "append" | "replace" | undefined, items: readonly string[] | undefined): Layer {
  const declarationEntries: [string, Node][] = [];
  if (cascade !== undefined) {
    declarationEntries.push(["cascade", createStringScalar(cascade, span(id, 900))]);
  }
  if (items !== undefined) {
    declarationEntries.push(["provide", sequenceOf(id, items)]);
  }
  const keysEntries: [string, Node][] = declarationEntries.length > 0 ? [[key, createMapping(declarationEntries, span(id, 950))]] : [];
  const tree = createMapping([["keys", createMapping(keysEntries, span(id, 980))]], span(id, 990));
  return { identity: { location: id, physical: id, hash: "0".repeat(64) }, role: "schema", rank, tree };
}

/** The config layer, optionally contributing a sequence for `key`. */
function configLayerFor(id: string, rank: number, key: string, items: readonly string[] | undefined): Layer {
  const entries: [string, Node][] = items !== undefined ? [[key, sequenceOf(id, items)]] : [];
  const tree = createMapping(entries, span(id, 999));
  return { identity: { location: id, physical: id, hash: "0".repeat(64) }, role: "config", rank, tree };
}

function foldLayers(layers: readonly Layer[]): { readonly ok: true; readonly tree: Node } | { readonly ok: false; readonly diagnostics: ReturnType<typeof resolveStrategies>["diagnostics"] } {
  const { diagnostics } = resolveStrategies(layers);
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return { ok: true, tree: fold(layers) };
}

function stringsOf(node: Node | undefined): readonly string[] | undefined {
  if (node === undefined) return undefined;
  if (node.type !== "sequence") throw new Error(`expected a sequence, got ${node.type}`);
  return node.items.map((item) => {
    if (item.type !== "scalar" || item.kind !== "string") throw new Error("expected a string scalar item");
    return item.value;
  });
}

const KEY = "items";
const TRIALS = 300;

/**
 * Simulate the fold's own §5.2 semantics over plain string arrays, to
 * compute this property test's expected value independently of the real
 * implementation (Principle V: never derive an expectation by copying the
 * implementation's output) — but faithful to v0.3 FR-026/T034's corrected
 * reading: a strategy governs **from its declaring layer downward**, not
 * uniformly across the whole stack. Before that correction this function
 * would have been `perLayerCascade` — the whole point of the fix is that
 * one flat "resolved strategy" is not enough information to reproduce the
 * fold's actual behaviour, since the SAME final strategy (`"append"`)
 * yields different results depending on *when* it was declared.
 *
 * Mirrors `fold()`'s own two base rules exactly: the first layer to
 * contribute anything just becomes the running value, regardless of
 * strategy (nothing precedes it to replace or accumulate against); every
 * layer after that either replaces the running value wholesale
 * (`"replace"`) or concatenates onto it (`"append"`), and a layer with no
 * items (`undefined`) contributes nothing either way (rule 6).
 */
function simulateAccumulation(perLayerCascade: readonly ("append" | "replace" | undefined)[], perLayerItems: readonly (readonly string[] | undefined)[]): readonly string[] | undefined {
  let strategy: "append" | "replace" = "replace";
  let current: string[] | undefined;
  for (let i = 0; i < perLayerItems.length; i += 1) {
    if (perLayerCascade[i] === "append") {
      strategy = "append"; // Tighten — one-way, matches strategy.ts's advanceStrategies.
    }
    const items = perLayerItems[i];
    if (items === undefined) {
      continue; // Rule 6: silence contributes nothing.
    }
    current = current === undefined || strategy === "replace" ? [...items] : [...current, ...items];
  }
  return current;
}

describe("monotonicity (Principle II, SPEC.md §5.2) — cascade: append row (FR-023, FR-016, v0.3 FR-026)", () => {
  it("over randomly generated layer stacks, accumulation is root-first from the declaring layer downward, and never drops a contribution accumulation actually reached", () => {
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const rng = mulberry32(trial + 1);
      // Roughly one trial in seven is a single-layer (config-only) stack —
      // T033's "single-layer stacks" risk case named in tasks.md's Notes.
      const schemaCount = trial % 7 === 0 ? 0 : randInt(rng, 0, 4);
      const appendAt = schemaCount > 0 ? randInt(rng, 0, schemaCount - 1) : -1;

      const layers: Layer[] = [];
      const perLayerItems: (readonly string[] | undefined)[] = [];
      const perLayerCascade: ("append" | "replace" | undefined)[] = [];
      let sawAnyDeclaredItems = false;

      for (let i = 0; i < schemaCount; i += 1) {
        const cascade = i === appendAt ? "append" : rng() < 0.3 ? "append" : undefined;
        const hasItems = rng() < 0.7;
        const items = hasItems ? Array.from({ length: randInt(rng, 0, 3) }, () => randomLabel(rng)) : undefined;
        if (items !== undefined) sawAnyDeclaredItems = true;
        layers.push(schemaLayerFor(`schema-${trial}-${i}`, i, KEY, cascade, items));
        perLayerItems.push(items);
        perLayerCascade.push(cascade);
      }
      const configHasItems = rng() < 0.8;
      const configItems = configHasItems ? Array.from({ length: randInt(rng, 0, 3) }, () => randomLabel(rng)) : undefined;
      if (configItems !== undefined) sawAnyDeclaredItems = true;
      layers.push(configLayerFor(`config-${trial}`, schemaCount, KEY, configItems));
      perLayerItems.push(configItems);
      perLayerCascade.push(undefined); // FR-015: a config never declares cascade.

      const outcome = foldLayers(layers);
      expect(outcome.ok, `trial ${trial}: expected a valid stack (no weakening was generated) to fold successfully`).toBe(true);
      if (!outcome.ok) continue; // unreachable after the assertion above; narrows for TS

      const tree = outcome.tree;
      if (tree.type !== "mapping") throw new Error("unreachable: config layer's tree is always a mapping here");
      const actual = stringsOf(tree.entries.get(KEY));

      if (schemaCount === 0) {
        // No schema ever declared cascade: append, so FR-011's default
        // (replace) applies — the property under test in this block does
        // not fire, but the stack must still fold to exactly the config's
        // own contribution (or nothing, if the config was silent too).
        expect(actual).toEqual(configItems);
        continue;
      }

      const expected = simulateAccumulation(perLayerCascade, perLayerItems);
      if (!sawAnyDeclaredItems) {
        expect(actual, `trial ${trial}: no layer ever declared '${KEY}' at all`).toBeUndefined();
      } else {
        expect(actual, `trial ${trial}: matches the declaring-layer-downward simulation`).toEqual(expected);
      }
    }
  });

  it("over randomly generated layer stacks, a strategy weakening from append to replace is never accepted", () => {
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const rng = mulberry32(10_000 + trial);
      const schemaCount = randInt(rng, 2, 5); // at least 2: one to declare append, a later one to weaken it
      const appendAt = randInt(rng, 0, schemaCount - 2);
      const weakenAt = randInt(rng, appendAt + 1, schemaCount - 1);

      const layers: Layer[] = [];
      for (let i = 0; i < schemaCount; i += 1) {
        let cascade: "append" | "replace" | undefined;
        if (i === appendAt) cascade = "append";
        else if (i === weakenAt) cascade = "replace";
        else cascade = rng() < 0.2 ? "append" : undefined; // noise: redundant tightening elsewhere, never a second weaken
        const items = rng() < 0.5 ? Array.from({ length: randInt(rng, 0, 2) }, () => randomLabel(rng)) : undefined;
        layers.push(schemaLayerFor(`schema-${trial}-${i}`, i, KEY, cascade, items));
      }
      const configItems = rng() < 0.5 ? [randomLabel(rng)] : undefined;
      layers.push(configLayerFor(`config-${trial}`, schemaCount, KEY, configItems));

      const outcome = foldLayers(layers);
      expect(outcome.ok, `trial ${trial}: a weakening stack (append at ${appendAt}, replace at ${weakenAt}) must be refused, never silently accepted`).toBe(false);
      if (outcome.ok) continue; // unreachable after the assertion above; narrows for TS
      expect(outcome.diagnostics.some((d) => d.code === "cascade-strategy-weakened"), `trial ${trial}: refusal must carry cascade-strategy-weakened`).toBe(true);
    }
  });
});

describe("monotonicity (Principle II, SPEC.md §5.2) — Defaults (provide) row, constructible half only (FR-024)", () => {
  it("over randomly generated layer stacks, a nearer layer's provide (or explicit config value) replaces a further layer's — never both, never the further one winning", () => {
    for (let trial = 0; trial < TRIALS; trial += 1) {
      const rng = mulberry32(20_000 + trial);
      const schemaCount = randInt(rng, 0, 4);
      const layers: Layer[] = [];
      let lastContributor: string | undefined;

      for (let i = 0; i < schemaCount; i += 1) {
        const contributes = rng() < 0.6;
        const value = contributes ? `schema-${trial}-${i}-value` : undefined;
        if (value !== undefined) lastContributor = value;
        const keysEntries: [string, Node][] = contributes ? [["value", createMapping([["provide", createStringScalar(value as string, span(`s${trial}-${i}`, 1))]], span(`s${trial}-${i}`, 0))]] : [];
        const tree = createMapping([["keys", createMapping(keysEntries, span(`s${trial}-${i}`, 2))]], span(`s${trial}-${i}`, 3));
        layers.push({ identity: { location: `s${trial}-${i}`, physical: `s${trial}-${i}`, hash: "0".repeat(64) }, role: "schema", rank: i, tree });
      }
      const configContributes = rng() < 0.6;
      const configValue = configContributes ? `config-${trial}-value` : undefined;
      if (configValue !== undefined) lastContributor = configValue;
      const configEntries: [string, Node][] = configContributes ? [["value", createStringScalar(configValue as string, span(`c${trial}`, 1))]] : [];
      layers.push({ identity: { location: `c${trial}`, physical: `c${trial}`, hash: "0".repeat(64) }, role: "config", rank: schemaCount, tree: createMapping(configEntries, span(`c${trial}`, 0)) });

      const outcome = foldLayers(layers);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      const tree = outcome.tree;
      if (tree.type !== "mapping") throw new Error("unreachable");
      const node = tree.entries.get("value");
      if (lastContributor === undefined) {
        expect(node, `trial ${trial}: no layer ever contributed 'value'`).toBeUndefined();
      } else {
        expect(node?.type === "scalar" ? node.value : undefined, `trial ${trial}: the nearest contributor must win, wholesale`).toBe(lastContributor);
      }
    }
  });
});
