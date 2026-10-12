/**
 * Anchor/alias/merge-key expansion mechanics — SPEC.md §4.2 ("YAML
 * anchors/aliases/merge keys (`<<`) are resolved and expanded at parse
 * time; the model never contains references"), research D3 (cycle
 * detection on the active expansion path) and D4 (positions attribute to
 * the anchor's content, not the alias site).
 *
 * This module works entirely in terms of `yaml`'s own AST node types
 * (Alias, YAMLMap, YAMLSeq, Scalar) and never touches Cascata's model
 * (`../../model/`) except for `SourceSpan`, needed only to *label* a
 * diagnostic — it never builds a `Node`. The walk in parse.ts is what
 * converts a resolved AST node into a `Node`, by calling back into its own
 * conversion functions on whatever this module hands back.
 *
 * Revised for User Story 2 (Phase 4): every failure here used to throw,
 * unwinding the entire walk on the first alias problem found anywhere in
 * the document. FR-019 requires one read to report every violation it can
 * find, so alias/merge failures are now reported as diagnostics and
 * skipped — the enclosing structure keeps being walked for anything else
 * wrong with it — rather than aborting. `alias-cycle` is a stable code
 * (T047); a dangling alias and an invalid merge source have no code of
 * their own in contracts/diagnostics.md, so both fall back to
 * `malformed-document`, same as Phase 3's provisional treatment of all
 * three — flagged in the Phase 4 report as still true only for those two.
 *
 * `src/adapters/yaml/` is format-aware by design (Principle IV) — this is
 * the one place in the codebase allowed to import from the `yaml` package.
 */
import type { Alias, ParsedNode, Scalar, YAMLMap, YAMLSeq } from "yaml";
import { type Diagnostic } from "../../diagnostics/diagnostic.js";
import type { SourceSpan } from "../../model/span.js";
import type { AnchorTable } from "./anchors.js";
type ScalarNode = Scalar.Parsed;
type MapNode = YAMLMap.Parsed;
type SeqNode = YAMLSeq.Parsed;
/** What an alias can resolve to — everything `Alias#resolve` returns except `undefined` (a dangling alias). */
type AliasTarget = ScalarNode | MapNode | SeqNode;
/** Either a resolved AST node, or a diagnostic explaining why there isn't one. */
export type AliasResolution = {
    readonly ok: true;
    readonly target: AliasTarget;
} | {
    readonly ok: false;
    readonly diagnostic: Diagnostic;
};
/**
 * Whether a mapping-key AST node is the special `<<` merge-key marker.
 * `merge: true` (passed to `parseDocument`, research D1) makes `yaml`
 * resolve a literal `<<` key to a `Scalar` whose `.value` is a unique JS
 * `Symbol` (verified empirically: `Symbol(<<)`, not the string `"<<"`)
 * rather than leaving it as an ordinary string-valued key.
 */
export declare function isMergeKeyPair(key: ParsedNode): boolean;
/**
 * Resolve an alias to its target AST node, guarding the active expansion
 * path against cycles. Never throws: a dangling alias or a cycle is
 * reported as a diagnostic result instead, so the caller can skip this one
 * expansion and keep walking the rest of the document (FR-019).
 *
 * `activePath` holds the AST node object references currently being
 * walked. `Alias#resolve` returns a reference to the anchor's own node
 * (verified empirically: resolving `*x` inside the very mapping `&x`
 * anchors returns that exact same `YAMLMap` instance), so a cycle is
 * exactly "the resolved target is already in `activePath`" — no separate
 * anchor-name bookkeeping is needed.
 *
 * `aliasSpan` is the alias's own span, used as the diagnostic's primary
 * position in both failure cases — "the alias closing the cycle"
 * (contracts/diagnostics.md) for a cycle, and the only position available
 * for a dangling reference.
 */
export declare function resolveAlias(alias: Alias, anchors: AnchorTable, activePath: ReadonlySet<object>, aliasSpan: SourceSpan): AliasResolution;
/**
 * Normalize a merge key's value into an ordered list of source mappings to
 * fold — in the order later sources must lose to earlier ones on
 * conflict. `<<` may name a single mapping (directly, or via one alias) or
 * a sequence of them (`<<: [*a, *b]`), verified empirically for both
 * shapes.
 *
 * Never throws. A source that doesn't resolve to a mapping (a dangling
 * alias, a cycle, or a value that just isn't one) is reported via
 * `report` and skipped — the *other* sources in the same `<<` list, and
 * the rest of the enclosing mapping, still get folded/walked.
 */
export declare function mergeSources(value: ParsedNode | null, anchors: AnchorTable, activePath: ReadonlySet<object>, mergeValueSpan: SourceSpan, report: (diagnostic: Diagnostic) => void, itemSpan: (item: ParsedNode) => SourceSpan): MapNode[];
export {};
//# sourceMappingURL=expand.d.ts.map