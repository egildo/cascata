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
 *
 * ## `append-over-non-sequence` (User Story 4, T056, T058; FR-013)
 *
 * `strategy.ts`'s `checkAppendable` is the predicate; this file decides
 * *when* to call it, at exactly two moments in `foldWithProvenance`'s own
 * loop — both needed, neither redundant with the other, and each firing
 * **at most once** per offending value (no `Set`-based deduplication is
 * needed, because each moment is itself a one-shot event):
 *
 * 1. **A layer's own fresh contribution.** Before merging `contribution`
 *    (this layer's raw, unmerged value) into `result`, every top-level key
 *    of `contribution` that is *currently* under `"append"` is checked.
 *    This covers every layer's own `provide` (schema) or literal value
 *    (config) the moment it is supplied — including the very first layer
 *    of the whole fold, which bypasses `mergeMappings` entirely (rule 6's
 *    "base case" below) and so would otherwise never be checked at all.
 * 2. **A key's strategy transitioning to `"append"`.** Immediately after
 *    `advanceStrategies` runs for a layer, any key that just became
 *    `"append"` for the first time (it was not already, per the previous
 *    layer's strategy map) has `result`'s *existing* value at that key
 *    checked — the value some **earlier** layer supplied under ordinary
 *    `"replace"`, before `cascade: append` was ever declared for it. This
 *    is the case contracts/diagnostics.md's "in the layer that supplied
 *    it" note is really about: the declaring layer and the offending
 *    layer can be different documents, because a schema may declare
 *    `cascade: append` on a key **without also (re-)supplying it** — the
 *    value being accumulated onto is whatever an ancestor already left
 *    there. `checkAppendable`'s own primary span is that value's real
 *    span, so the diagnostic always names the document that actually
 *    wrote it, never the layer that merely declared the strategy.
 *
 * Together these two moments cover every value that is ever asked to
 * participate in an `append` accumulation, each checked exactly once: (1)
 * catches every layer's own contribution as it arrives, and (2) catches
 * whatever pre-existed the moment accumulation starts. Neither moment
 * re-checks a value the other already covered — (1) never re-examines
 * `result` (only `contribution`, this layer's own new value), and (2)
 * only fires on a transition, which happens **at most once** per key
 * across the whole fold regardless of what the rest of the stack looks
 * like: `advanceStrategies` (`strategy.ts`) only ever *adds* a key to its
 * running map (tightening to `"append"`), never removes one, so once a key
 * is in the map it stays there for every later layer — a running map can
 * only grow, so a key can enter it only once. This holds even on a stack
 * `resolveStrategies` would refuse for weakening elsewhere (see
 * `foldConfiguration`'s own doc comment for why running this file's loop
 * on such a stack is safe and not merely non-crashing).
 *
 * Both moments push onto one shared `diagnostics` array for the whole
 * fold rather than returning on the first hit (T058): a schema
 * mis-declaring two unrelated top-level keys under `append` is two
 * independent mistakes in two different places, and a reader fixing the
 * first should not have to re-run the fold to discover the second — the
 * same "collect every failure it can determine independently" property
 * v0.2's `resolveAllBranches` established for reference resolution. This
 * array is itself kept separate from `resolveStrategies`' own diagnostics
 * within this file's functions — `foldWithProvenance` returns only its own
 * `append-over-non-sequence` findings — but `foldConfiguration` (below)
 * now runs both `resolveStrategies` and `foldWithProvenance`
 * unconditionally and concatenates the two arrays (v0.3 FR-028, T061): a
 * schema's vocabulary problem in one key must not hide a data-shape
 * problem in another.
 */
import { type Node } from "../model/node.js";
import type { Graph } from "../graph/build.js";
import type { Pedigree } from "../graph/pedigree.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { type Layer, type MergedConfiguration, type ProvenanceRecord } from "./provenance.js";
import type { DelegationHop } from "../model/reference.js";
import type { PathFacility } from "../paths.js";
/**
 * Derive the ranked `Layer` list from a resolved `Graph` — root schema
 * lowest, the entry above every schema, and each override above the
 * entry in the order given (FR-005, data-model.md "Layer"; v1.6 FR-011).
 * An override is a `role: "config"` layer like the entry: the fold reads
 * no strategy from it and provisions fill what it leaves silent, which
 * is what makes it governed rather than privileged.
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
export declare function deriveLayers(graph: Graph): readonly Layer[];
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
/**
 * Exported since v0.7 part 2: `src/validate/directives.ts` closes the
 * `directives:` section's own vocabulary to exactly this set (SPEC.md §9),
 * and the two MUST be the same set. Two literals would be two lists that
 * could drift, and drifting means either a reserved key the meta-schema
 * cannot constrain or a `directives:` entry naming something the fold does
 * not strip — the second of which would put a `$`-key into a merged
 * configuration, which §9 forbids absolutely.
 */
export declare const RESERVED_DOCUMENT_KEYS: ReadonlySet<string>;
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
 * that already settled under a different strategy. This convenience
 * wrapper discards `foldWithProvenance`'s `diagnostics` entirely and gives
 * its caller no way to see them — appropriate only for a caller that has
 * either already run `resolveStrategies` and found no diagnostics, or (this
 * file's own hand-constructed unit tests) only ever builds well-formed
 * layers to begin with. `advanceStrategies`'s own doc comment explains why
 * this function's loop is in fact well-defined on any layer stack,
 * including one `resolveStrategies` would refuse — `foldConfiguration`
 * below is the caller that relies on that and surfaces both passes'
 * diagnostics together (v0.3 FR-028, T061).
 */
export declare function fold(layers: readonly Layer[]): Node;
/** `fold()`'s full result — the tree, the provenance record built alongside it, and any `append-over-non-sequence` diagnostics found along the way (FR-013, T056, T058). `foldConfiguration` is `fold()`'s only caller that needs the provenance and diagnostics halves; every other caller (this file's own hand-constructed unit tests among them) just wants the tree, which is what `fold()` itself returns — those callers only ever build well-formed layers, so `diagnostics` is always empty for them. */
export declare function foldWithProvenance(layers: readonly Layer[]): {
    readonly tree: Node;
    readonly provenance: ProvenanceRecord;
    readonly diagnostics: readonly Diagnostic[];
};
/** `foldConfiguration`'s result — never both a configuration and diagnostics (mirrors `MergeResult` in `src/index.ts`, which this shape feeds directly). */
/**
 * `foldConfiguration`'s verdict. The `ok: true` branch carries
 * `diagnostics` as of v1.8 (FR-002): the fold can now produce an `info`
 * lint (`append-scalar-wrapped`) that changes a value without refusing it,
 * and a lint nobody carries is a lint nobody reads. It is always `info`-
 * only — an `error` anywhere makes the whole fold `ok: false`, which is
 * what `partitionByLevel` below enforces — and possibly empty, which is
 * every fold before v1.8 and most folds after it. An additive field, so
 * every existing consumer of the `ok: true` branch compiles and behaves
 * unchanged.
 */
export type FoldOutcome = {
    readonly ok: true;
    readonly configuration: MergedConfiguration;
    readonly diagnostics: readonly Diagnostic[];
} | {
    readonly ok: false;
    readonly diagnostics: Diagnostic[];
};
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
 * `resolveStrategies` and `foldWithProvenance` **both always run** (v0.3
 * FR-028, T061), and their diagnostics are concatenated — vocabulary
 * failures first, then data-dependent ones — rather than the fold being
 * skipped the moment `resolveStrategies` finds anything. Before FR-028
 * existed this function returned as soon as `resolveStrategies` reported a
 * diagnostic, on the reasoning that `advanceStrategies` is documented as
 * unspecified on a stack `resolveStrategies` has refused. That reasoning
 * was sound as far as it went but stopped one step short: FR-028 requires
 * every independently-determinable failure back, including a data-shape
 * failure (`append-over-non-sequence`) in a key untouched by whatever made
 * a *different* key's vocabulary unreadable, so skipping the fold entirely
 * whenever `resolveStrategies` found anything under-reports by
 * construction — exactly the bug this requirement exists to forbid.
 *
 * Running the fold unconditionally is safe because `advanceStrategies` (and
 * everything downstream of it in `foldWithProvenance`'s loop) is in fact
 * total over **every** layer stack, not only ones `resolveStrategies` has
 * accepted — it is simply that nothing had stated so before FR-028 gave a
 * reason to check. Walk what it does with a `cascade` declaration
 * `resolveStrategies` would refuse:
 *
 * - An **unrecognized value** (`interpretCascade` returns `undefined`, the
 *   `unknown-`/`unimplemented-cascade-strategy` cases): `advanceStrategies`
 *   only ever branches on `interpretCascade(...) === "append"`, so anything
 *   `interpretCascade` cannot read simply fails that check and is skipped —
 *   the same "exactly as if nothing had been declared" reading
 *   `resolveStrategies`' own doc comment already gives this case.
 * - A **weakening** attempt (`append` → `replace`, `cascade-strategy
 *   -weakened`): the declared value there is a syntactically valid
 *   `"replace"`, which `interpretCascade` reads fine — but
 *   `advanceStrategies` still only *acts* on a value that reads as
 *   `"append"` (an explicit `"replace"` is never itself a tightening, per
 *   its own doc comment below), so this declaration is skipped too, and the
 *   key stays `"append"` from whichever earlier layer already tightened it
 *   — the one behaviour that keeps faith with `resolveStrategies`' own
 *   verdict (the map it built also never recorded the weakening).
 *
 * Neither case is a crash, an exception, or a silently wrong tree escaping
 * as `ok: true` — the running strategy map simply never advances for a key
 * whose declaration was unreadable or illegal, in every place that map is
 * read (`checkFreshAppendContributions`, `checkTransitionedAppendKeys`,
 * `mergeMappings`'s own `effectiveStrategy` lookup). And a data-dependent
 * diagnostic the fold finds for some *other*, well-formed key never depends
 * on this: `checkAppendable` is a pure function of one key's own current
 * strategy and one value's own shape, so it is unaffected by what happened
 * to any other key elsewhere in the stack. This is why running both passes
 * unconditionally and concatenating their diagnostics is correct and not
 * merely non-crashing: every diagnostic either pass reports is one that
 * pass would have reported on this exact stack in isolation.
 *
 * The tree itself never leaks out on this path regardless: `diagnostics`
 * below is the union of both passes, and `freeze`/`ok: true` are reached
 * only when it is empty — a merge still yields a configuration or
 * diagnostics, never both, and never a tree built while trusting a
 * strategy map some layer's declaration was never allowed to advance.
 * `resolveStrategies`' own `strategies` field is unused past its own
 * diagnostics (T034): `foldWithProvenance` derives the strategy in effect
 * at each layer for itself, via `advanceStrategies`, rather than being
 * handed one flat map.
 */
export declare function foldConfiguration(graph: Graph, pedigree: Pedigree, delegationBreadcrumbs?: ReadonlyMap<string, readonly DelegationHop[]>, paths?: PathFacility): FoldOutcome;
//# sourceMappingURL=fold.d.ts.map