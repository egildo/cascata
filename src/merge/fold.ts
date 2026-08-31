/**
 * The fold — SPEC.md §5.1, §5.3; contracts/precedence.md's numbered list;
 * research D4; v0.3 FR-004 through FR-010; tasks.md T010, T018–T023.
 *
 * Folds a ranked stack of `Layer`s (root schema lowest, config highest —
 * contracts/precedence.md rule 1) into one `Node` tree. The whole
 * algorithm is contracts/precedence.md's numbered list, applied
 * mechanically:
 *
 * 1. A nearer layer beats a further one.
 * 2. Mappings on both sides merge deeply, rule 1 applying independently to
 *    each key inside — the only rule that recurses.
 * 3. Any other pairing replaces wholesale (scalar over mapping, sequence
 *    over sequence, mapping over scalar). **This is where T019's risk
 *    lives**: merging sequences element-wise here would look plausible and
 *    pass every mapping test — `cascade: append` (Phase 4, out of this
 *    slice's scope) exists precisely so that never has to happen. This
 *    file recurses on nothing but a mapping-vs-mapping pairing; every other
 *    pairing falls straight through to "replace".
 * 4. `cascade: append` is out of scope for this slice (User Story 2,
 *    Phase 4) — every key folds as `replace`, which is FR-011's default
 *    anyway, so this file never consults `strategy.ts`'s `cascade` field.
 * 5. An explicit null is a value, not an absence — this needs **no special
 *    case** below: a `null` scalar `Node` is an ordinary `Node`, and this
 *    file never treats "the node at this position" as absent unless the
 *    position genuinely has no contributing `Node` at all (`undefined`).
 *    Conflating "explicit null" with "absent" is the mistake FR-008 rules
 *    out, and the type (`Node | undefined`, never a nullable `Node`) makes
 *    that conflation a type error, not just a discipline.
 * 6. Absence contributes nothing — a layer with nothing to say about a
 *    position is skipped, never treated as clearing it.
 *
 * **Provenance is not built here in this slice.** See
 * `src/merge/provenance.ts`'s module doc: recording the chain (including
 * what got overridden) is tasks.md T041, Phase 5, out of T001–T024's scope.
 */

import { createMapping, type Mapping, type Node } from "../model/node.js";
import { freeze } from "../model/freeze.js";
import type { Graph } from "../graph/build.js";
import type { Pedigree } from "../graph/pedigree.js";
import { readKeysVocabulary } from "./strategy.js";
import type { Layer, MergedConfiguration } from "./provenance.js";

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
 */
function mergeMappings(current: Mapping, incoming: Mapping): Mapping {
  const keys = new Set<string>([...current.entries.keys(), ...incoming.entries.keys()]);
  const merged: [string, Node][] = [];
  for (const key of keys) {
    const currentValue = current.entries.get(key);
    const incomingValue = incoming.entries.get(key);
    if (currentValue !== undefined && incomingValue !== undefined) {
      merged.push([key, mergeValue(currentValue, incomingValue)]);
    } else if (incomingValue !== undefined) {
      merged.push([key, incomingValue]);
    } else if (currentValue !== undefined) {
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
 * wholesale" like any other.
 */
function mergeValue(current: Node | undefined, incoming: Node): Node {
  if (current === undefined) {
    return incoming;
  }
  if (current.type === "mapping" && incoming.type === "mapping") {
    return mergeMappings(current, incoming);
  }
  return incoming;
}

/**
 * Fold every layer, root to leaf, into one `Node` tree (FR-004). A
 * single-layer fold (just the config, no schema at all) is the identity —
 * FR-009 — because the loop below never calls `mergeValue` at all in that
 * case: there is only ever one contribution, taken as-is.
 */
export function fold(layers: readonly Layer[]): Node {
  let result: Node | undefined;
  for (const layer of layers) {
    const contribution = contributionOf(layer);
    if (contribution === undefined) {
      continue;
    }
    result = result === undefined ? contribution : mergeValue(result, contribution);
  }
  if (result === undefined) {
    // Unreachable: `deriveLayers` always appends the config layer last, and
    // a config layer's contribution is `layer.tree`, a `Node` (never
    // `undefined` — `GraphDocument.tree` is non-optional).
    throw new Error("Internal error: fold() produced no result — deriveLayers should always include a config layer");
  }
  return result;
}

/**
 * Fold a resolved graph and its pedigree into a `MergedConfiguration`
 * (FR-004, FR-010). The tree is deeply frozen before being returned, so it
 * satisfies every v0.1 invariant merge inherits rather than is exempted
 * from: every node positioned (true throughout — no node here is ever
 * constructed without a span, by the model's own construction invariant),
 * mappings in canonical key order (`createMapping` always sorts), and
 * deeply frozen (`freeze`, called once here, exactly as v0.1's own `parse`
 * does at its own boundary).
 *
 * `provenance` is the empty record in this slice — see
 * `src/merge/provenance.ts`'s module doc for why populating it is Phase 5
 * work (T041) rather than part of this fold.
 */
export function foldConfiguration(graph: Graph, pedigree: Pedigree): MergedConfiguration {
  const layers = deriveLayers(graph);
  const tree = freeze(fold(layers));
  return { tree, provenance: new Map(), pedigree };
}
