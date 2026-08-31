/**
 * The fold — SPEC.md §5.1, §5.3; contracts/precedence.md's numbered list;
 * research D4; v0.3 FR-004 through FR-010, FR-026, FR-027; tasks.md T010,
 * T018–T023, T034, T035, T044.
 *
 * Folds a ranked stack of `Layer`s (root schema lowest, config highest —
 * contracts/precedence.md rule 1) into one `Node` tree, while
 * `src/merge/provenance.ts`'s `ProvenanceBuilder` grows the provenance
 * record alongside it (T044) — never reconstructed from the finished tree
 * afterward; see that file's module doc for why that distinction is
 * load-bearing. The whole algorithm is contracts/precedence.md's numbered
 * list, applied mechanically:
 *
 * 1. A nearer layer beats a further one.
 * 2. Mappings on both sides merge deeply, rule 1 applying independently to
 *    each key inside — the only rule that recurses.
 * 3. Any other pairing replaces wholesale (scalar over mapping, sequence
 *    over sequence, mapping over scalar). **This is where T019's risk
 *    lives**: merging sequences element-wise here would look plausible and
 *    pass every mapping test — `cascade: append` exists precisely so that
 *    never has to happen. This file recurses on nothing but a
 *    mapping-vs-mapping pairing; every other pairing falls straight
 *    through to "replace" *unless* rule 4 below applies to that key.
 * 4. `cascade: append` (User Story 2, Phase 4): a top-level key currently
 *    `"append"` accumulates root-first instead of replacing —
 *    `strategy.ts`'s `accumulateAppend` does the accumulating; this file
 *    only decides, per top-level key, whether to call it
 *    (`effectiveStrategy`) instead of the ordinary rule 1-3 pairing.
 *    Confined to **top-level keys only** (v0.3 FR-027, T035): `keys:` in a
 *    schema names a key of the config's own top level (`SPEC.md` §9's
 *    worked chain — `keys.styles` governs a top-level `styles:`), never a
 *    nested key of the same name buried inside another key's value, so
 *    strategies are threaded into the outermost `mergeMappings` call
 *    alone; every recursive call for nested structure passes
 *    `NO_STRATEGIES`.
 *
 *    **Which strategy is "current" changes as the fold proceeds** (v0.3
 *    FR-026, T034): rather than resolving one strategy per key before
 *    folding begins and applying it to every layer alike, `fold()` calls
 *    `strategy.ts`'s `advanceStrategies` once per layer, immediately
 *    before merging that layer's own contribution — so a layer that
 *    declares `append` accumulates its own contribution and every later
 *    one onto whatever the fold has already produced, and never reaches
 *    back to re-combine layers that already settled under `replace`
 *    before the declaration existed. The discriminating case (tasks.md
 *    T029): root provides `[a]` with no strategy, a middle layer `[b]`
 *    with no strategy, a leaf declares `append` and provides `[c]` — root
 *    is the fold's base case (nothing to merge against yet), middle
 *    *replaces* it (ordinary rule 3 — `[a]` is gone), and only then does
 *    the leaf's declaration make anything accumulate, onto `[b]`. Result:
 *    `[b, c]`, not `[a, b, c]` — the first implementation resolved one
 *    flat map before folding and got this case wrong; see the milestone
 *    report.
 * 5. An explicit null is a value, not an absence — this needs **no special
 *    case** below: a `null` scalar `Node` is an ordinary `Node`, and this
 *    file never treats "the node at this position" as absent unless the
 *    position genuinely has no contributing `Node` at all (`undefined`).
 *    Conflating "explicit null" with "absent" is the mistake FR-008 rules
 *    out, and the type (`Node | undefined`, never a nullable `Node`) makes
 *    that conflation a type error, not just a discipline.
 * 6. Absence contributes nothing — a layer with nothing to say about a
 *    position is skipped, never treated as clearing it.
 */

import { createMapping, type Mapping, type Node } from "../model/node.js";
import { freeze } from "../model/freeze.js";
import type { Graph } from "../graph/build.js";
import type { Pedigree } from "../graph/pedigree.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { accumulateAppend, advanceStrategies, effectiveStrategy, readKeysVocabulary, resolveStrategies } from "./strategy.js";
import { createProvenanceBuilder, type Layer, type MergedConfiguration, type MergeStrategy, type ProvenanceBuilder, type ProvenanceRecord } from "./provenance.js";

/** No key has a declared strategy — used for every merge below the top level, where `cascade` never applies (rule 4's own doc comment above). */
const NO_STRATEGIES: ReadonlyMap<string, MergeStrategy> = new Map();

/**
 * Derive the ranked `Layer` list from a resolved `Graph` — root schema
 * lowest, config highest of all (FR-005, data-model.md "Layer").
 *
 * Takes `Graph` rather than the narrower `Pedigree` type: `graph.documents`
 * carries each document's parsed `tree`, and `Pedigree` (v0.2,
 * `src/graph/pedigree.ts`) deliberately does not (`PedigreeEntry` holds
 * only `identity`, `via`, `verified`) — the fold cannot merge anything
 * without the trees. `graph.documents.slice(1)` (every document but the
 * entry, in discovery/leaf-to-root order) reversed is exactly the
 * computation `graph/pedigree.ts`'s own `buildPedigree` performs, so this
 * produces the same root-to-leaf schema ordering a `Pedigree` built from
 * the same `Graph` would name — see the milestone report for why `Layer`
 * carries `tree` directly instead.
 */
export function deriveLayers(graph: Graph): readonly Layer[] {
  const schemaDocumentsRootToLeaf = [...graph.documents.slice(1)].reverse();
  const layers: Layer[] = schemaDocumentsRootToLeaf.map((document, index) => ({
    identity: document.identity,
    role: "schema",
    rank: index,
    tree: document.tree,
  }));
  layers.push({
    identity: graph.entry.identity,
    role: "config",
    rank: layers.length,
    tree: graph.entry.tree,
  });
  return layers;
}

/**
 * A schema layer's own top-level contribution: a **synthetic** mapping
 * built from every key's `provide` value in its `keys:` section — not a
 * node any parser produced, since a real schema document scatters its
 * provide values across several `keys.<name>.provide` positions rather
 * than holding one physical mapping of them.
 *
 * Every *value* inside this synthetic mapping is a real node with a real
 * span from the schema document (`decl.provide` itself, untouched) — only
 * the wrapper is synthetic. Its own span is passed as `schemaTree.span`
 * and is provably never the final span of anything in the merged output:
 * the config layer always folds last and always contributes *something*
 * at the top level (`layer.tree` is never `undefined`), so by
 * contracts/precedence.md rule 1 the config's own span always wins the
 * outermost mapping's span in `mergeMappings` below, and any single key
 * this wrapper alone supplies is taken from it unmodified (its own real
 * span intact, never the wrapper's) — see the milestone report for the
 * full argument.
 *
 * Returns `undefined` when the schema declares no `provide` at all
 * (rule 6, absence contributes nothing) — including every case FR-003
 * covers (`keys:` absent, empty, or not a mapping — `readKeysVocabulary`
 * already reduces all of those to "nothing to read").
 */
function schemaContribution(schemaTree: Node): Node | undefined {
  const vocabulary = readKeysVocabulary(schemaTree);
  const entries: [string, Node][] = [];
  for (const [key, declaration] of vocabulary) {
    if (declaration.provide !== undefined) {
      entries.push([key, declaration.provide]);
    }
  }
  if (entries.length === 0) {
    return undefined;
  }
  return createMapping(entries, schemaTree.span);
}

/**
 * SPEC.md §9's reserved document keys — structural metadata about the
 * pedigree itself (which schema a config adopts, a document's own
 * identity/pin/version), never configuration *data*. `$extends` is listed
 * defensively even though §6.2 marks it a future, not-yet-recognized
 * keyword: stripping a key nothing in v1 would ever emit is harmless, and
 * skipping it here would be one more place to remember when it arrives.
 *
 * **Judgment call, not a literal FR** (see the milestone report): FR-004
 * through FR-010 never say in so many words that these keys must be
 * excluded from the fold's output, but User Story 1's own Independent Test
 * does — "confirm the result contains the config's value for the
 * overridden key and the schema's for the other, with **no trace of the
 * layering in the tree's shape**" (spec.md) — and a `$schema` key
 * surviving into the merged configuration is exactly such a trace: it
 * names which schema was adopted, which is pedigree information, not
 * something the config author was declaring as a value. Confirmed
 * empirically too: `graph.entry.tree` is v0.1/v0.2's ordinary parsed tree,
 * which never strips `$`-prefixed keys (they are read, not removed) — so
 * without this step every merged configuration would carry its own
 * `$schema` pointer as a literal top-level key alongside real data.
 */
const RESERVED_DOCUMENT_KEYS: ReadonlySet<string> = new Set(["$id", "$version", "$adopts", "$pin", "$schema", "$extends"]);

/** Strip SPEC.md §9's reserved document keys from a config's own top-level tree before it enters the fold. A no-op for anything that is not a mapping, or a mapping with none of those keys. */
function stripReservedDocumentKeys(tree: Node): Node {
  if (tree.type !== "mapping") {
    return tree;
  }
  let sawReserved = false;
  const entries: [string, Node][] = [];
  for (const [key, value] of tree.entries) {
    if (RESERVED_DOCUMENT_KEYS.has(key)) {
      sawReserved = true;
      continue;
    }
    entries.push([key, value]);
  }
  return sawReserved ? createMapping(entries, tree.span) : tree;
}

/** One layer's raw, unmerged contribution — `undefined` exactly when the layer has nothing to say (rule 6). */
function contributionOf(layer: Layer): Node | undefined {
  return layer.role === "schema" ? schemaContribution(layer.tree) : stripReservedDocumentKeys(layer.tree);
}

/**
 * Merge two mappings deeply (rule 2), the only rule that recurses.
 * `incoming` is the nearer layer — its span wins for the resulting
 * mapping's own span (research D4: "the span of the nearest layer
 * contributing to that mapping"), since `incoming` genuinely does
 * contribute *a mapping* at this position, whatever keys it does or does
 * not set within it.
 *
 * `strategies` governs rule 4 for the keys of *this* mapping only —
 * `mergeValue`'s own recursive call below always passes `NO_STRATEGIES`
 * for nested structure, which is what confines `cascade` to top-level
 * keys (this function's module-doc rule 4).
 *
 * `path` is this mapping's own position (`[]` at the top level), and
 * `builder` is where every merge decision below is also recorded as
 * provenance (T044) — `current` genuinely is a mapping at `path` already
 * (this function is only ever called once `mergeValue` has confirmed
 * both sides are mappings), and `incoming` is now a *second* (or third,
 * ...) layer contributing one there too, so this position becomes
 * `synthesized` (`src/merge/provenance.ts`'s module doc) regardless of
 * whether any individual key inside collides.
 */
function mergeMappings(path: readonly string[], current: Mapping, incoming: Mapping, layer: Layer, strategies: ReadonlyMap<string, MergeStrategy>, builder: ProvenanceBuilder): Mapping {
  builder.recordSynthesized(path);
  const keys = new Set<string>([...current.entries.keys(), ...incoming.entries.keys()]);
  const merged: [string, Node][] = [];
  for (const key of keys) {
    const childPath = [...path, key];
    const currentValue = current.entries.get(key);
    const incomingValue = incoming.entries.get(key);
    if (effectiveStrategy(key, strategies) === "append") {
      if (incomingValue !== undefined) {
        builder.recordAccumulation(childPath, incomingValue.span, layer);
      }
      const accumulated = accumulateAppend(currentValue, incomingValue);
      if (accumulated !== undefined) {
        merged.push([key, accumulated]);
      }
      // else unreachable: same reasoning as the comment below — `key` came
      // from the union of both maps, so `accumulateAppend` always has at
      // least one defined side to return.
      continue;
    }
    if (currentValue !== undefined && incomingValue !== undefined) {
      merged.push([key, mergeValue(childPath, currentValue, incomingValue, layer, NO_STRATEGIES, builder)]);
    } else if (incomingValue !== undefined) {
      builder.recordFreshContribution(childPath, incomingValue, layer);
      merged.push([key, incomingValue]);
    } else if (currentValue !== undefined) {
      // Untouched by this layer — whatever provenance this key already
      // carries (from whichever earlier layer(s) actually contributed at
      // `childPath`) stays exactly as it was; nothing new to record.
      merged.push([key, currentValue]);
    }
    // else unreachable: `key` was drawn from the union of both maps' own keys.
  }
  return createMapping(merged, incoming.span);
}

/**
 * Merge one position: `current` is everything folded so far (or
 * `undefined` if nothing has spoken yet), `incoming` is the next layer's
 * raw contribution at this exact position. Recurses only when both sides
 * are mappings (rule 2); every other pairing replaces wholesale with
 * `incoming` (rule 3) — which is also where rule 5 (null replaces) falls
 * out for free, since a `null` scalar is just another `Node` that "replaces
 * wholesale" like any other. `strategies` is threaded straight through to
 * `mergeMappings` unchanged — it is this function's caller that decides
 * whether `strategies` carries real entries or is `NO_STRATEGIES`.
 *
 * `current === undefined` is unreachable here in practice — `fold()`'s own
 * loop only calls this once a first contribution already exists, recording
 * that first contribution itself rather than calling this function — but
 * the case is handled defensively (as a fresh contribution) rather than
 * assumed away, since nothing about this function's own signature rules
 * it out.
 */
function mergeValue(path: readonly string[], current: Node | undefined, incoming: Node, layer: Layer, strategies: ReadonlyMap<string, MergeStrategy>, builder: ProvenanceBuilder): Node {
  if (current === undefined) {
    builder.recordFreshContribution(path, incoming, layer);
    return incoming;
  }
  if (current.type === "mapping" && incoming.type === "mapping") {
    return mergeMappings(path, current, incoming, layer, strategies, builder);
  }
  builder.recordReplacement(path, current, incoming, layer);
  return incoming;
}

/**
 * Fold every layer, root to leaf, into one `Node` tree plus its
 * provenance record (FR-004, T044). A single-layer fold (just the config,
 * no schema at all) is the identity — FR-009 — because the loop below
 * never calls `mergeValue` at all in that case: there is only ever one
 * contribution, taken as-is (still recorded as that single layer's
 * `"won"` chain, per SC-002).
 *
 * Strategy state is **not** resolved once before this loop runs and then
 * applied uniformly — `strategy.ts`'s `advanceStrategies` is called once
 * per layer, immediately before merging that layer's own contribution,
 * which is what makes a strategy take effect "from its declaring layer
 * downward" (v0.3 FR-026, T034) rather than reaching back over layers
 * that already settled under a different strategy. This function assumes
 * the caller has already run `resolveStrategies` and found no diagnostics
 * — `advanceStrategies`'s own doc comment explains why calling this on an
 * invalid (weakening) stack is unspecified.
 */
export function fold(layers: readonly Layer[]): Node {
  return foldWithProvenance(layers).tree;
}

/** `fold()`'s full result — the tree plus the provenance record built alongside it. `foldConfiguration` is `fold()`'s only caller that needs the provenance half; every other caller (this file's own hand-constructed unit tests among them) just wants the tree, which is what `fold()` itself returns. */
export function foldWithProvenance(layers: readonly Layer[]): { readonly tree: Node; readonly provenance: ProvenanceRecord } {
  const builder = createProvenanceBuilder();
  let result: Node | undefined;
  let strategies: ReadonlyMap<string, MergeStrategy> = NO_STRATEGIES;
  for (const layer of layers) {
    strategies = advanceStrategies(strategies, layer);
    const contribution = contributionOf(layer);
    if (contribution === undefined) {
      continue;
    }
    if (result === undefined) {
      builder.recordFreshContribution([], contribution, layer);
      result = contribution;
    } else {
      result = mergeValue([], result, contribution, layer, strategies, builder);
    }
  }
  if (result === undefined) {
    // Unreachable: `deriveLayers` always appends the config layer last, and
    // a config layer's contribution is `layer.tree`, a `Node` (never
    // `undefined` — `GraphDocument.tree` is non-optional).
    throw new Error("Internal error: fold() produced no result — deriveLayers should always include a config layer");
  }
  return { tree: result, provenance: builder.finish() };
}

/** `foldConfiguration`'s result — never both a configuration and diagnostics (mirrors `MergeResult` in `src/index.ts`, which this shape feeds directly). */
export type FoldOutcome = { readonly ok: true; readonly configuration: MergedConfiguration } | { readonly ok: false; readonly diagnostics: Diagnostic[] };

/**
 * Fold a resolved graph and its pedigree into a `MergedConfiguration`, or
 * refuse with diagnostics (FR-004, FR-010, FR-016, FR-017). The tree is
 * deeply frozen before being returned, so it satisfies every v0.1
 * invariant merge inherits rather than is exempted from: every node
 * positioned (true throughout — no node here is ever constructed without
 * a span, by the model's own construction invariant), mappings in
 * canonical key order (`createMapping` always sorts), and deeply frozen
 * (`freeze`, called once here, exactly as v0.1's own `parse` does at its
 * own boundary). `freeze` mutates every node's own `span` object in place
 * (`src/model/freeze.ts`) rather than cloning it, so the `SourceSpan`
 * references already captured in `provenance`'s entries are the exact
 * same objects the frozen tree ends up holding — the two structures never
 * diverge over freezing.
 *
 * `resolveStrategies` runs **before** the fold itself: a `cascade-strategy
 * -weakened` refusal (T032) is a fact about the pedigree's own vocabulary,
 * independent of any data, so there is no reason to build a tree first and
 * discover it cannot be trusted — this mirrors User Story 4's later
 * refusals (Phase 6, not yet implemented), which will extend the same
 * `diagnostics.length > 0` branch rather than add a second one. Its own
 * `strategies` field is unused past that check now (T034):
 * `foldWithProvenance` derives the strategy in effect at each layer for
 * itself, via `advanceStrategies`, rather than being handed one flat map.
 */
export function foldConfiguration(graph: Graph, pedigree: Pedigree): FoldOutcome {
  const layers = deriveLayers(graph);
  const { diagnostics } = resolveStrategies(layers);
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics: [...diagnostics] };
  }
  const { tree, provenance } = foldWithProvenance(layers);
  return { ok: true, configuration: { tree: freeze(tree), provenance, pedigree } };
}
