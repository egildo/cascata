/**
 * Anchor/alias/merge-key expansion mechanics — SPEC.md §4.2 ("YAML
 * anchors/aliases/merge keys (`<<`) are resolved and expanded at parse
 * time; the model never contains references"), research D3 (cycle
 * detection on the active expansion path) and D4 (positions attribute to
 * the anchor's content, not the alias site).
 *
 * This module works entirely in terms of `yaml`'s own AST node types
 * (Alias, YAMLMap, YAMLSeq, Scalar) and never touches Cascata's model or
 * imports from `../../model/` or `../../diagnostics/` — the walk in
 * parse.ts is what converts a resolved AST node into a `Node`, by calling
 * back into its own conversion functions on whatever this module hands
 * back. That split avoids a circular import between the two files: this
 * module only ever returns "the yaml AST node to walk next," or throws one
 * of the two signals below, and never needs to call into parse.ts itself.
 *
 * `src/adapters/yaml/` is format-aware by design (Principle IV) — this is
 * the one place in the codebase allowed to import from the `yaml` package.
 */

import { isAlias, isMap, isScalar, isSeq } from "yaml";
import type { Alias, Document, ParsedNode, Scalar, YAMLMap, YAMLSeq } from "yaml";

// See parse.ts's module doc for why `.Parsed` is used throughout rather
// than the bare classes: it is what keeps a mapping's entries and a
// sequence's items typed as `ParsedNode` instead of `unknown` once
// narrowed by `isMap`/`isSeq`/`isScalar`.
type ScalarNode = Scalar.Parsed;
type MapNode = YAMLMap.Parsed;
type SeqNode = YAMLSeq.Parsed;

/** What an alias can resolve to — everything `Alias#resolve` returns except `undefined` (a dangling alias). */
type AliasTarget = ScalarNode | MapNode | SeqNode;

/**
 * Thrown when an alias's active expansion path loops back on a node still
 * being walked — the document refers to content that encloses itself.
 *
 * Phase 3 does not yet have a dedicated diagnostic code for this: T047
 * (Phase 4) is what turns a caught instance of this error into the
 * `alias-cycle` code at the alias's own position. It is still thrown here,
 * in Phase 3, because the entry point being built in this same phase
 * (`parse()`, T033) must never hang on any input — "Total... none hangs"
 * is a contracts/parse-api.md invariant of the entry point itself, not
 * something deferred to Phase 4. Until T047 lands, parse.ts catches this
 * and reports it as `malformed-document` — an honest description (this
 * really is content the reader can't make sense of) that will be replaced
 * by a precise code once Phase 4 exists.
 */
export class AliasCycleError extends Error {
  constructor(public readonly alias: Alias) {
    super(`Alias '*${alias.source}' refers to content that encloses itself`);
    this.name = "AliasCycleError";
  }
}

/**
 * Thrown when an alias names an anchor that was never defined. `yaml`
 * itself reports no error for this (verified empirically: `parseDocument`
 * on `"a: *nope\n"` produces an empty `errors` array, and
 * `Alias#resolve` simply returns `undefined`) — SPEC.md and the
 * contracts have no dedicated code for a dangling alias either, so this
 * is mapped to `malformed-document` for the same reason as
 * {@link AliasCycleError}: a defensible generic description, not a
 * permanent home.
 */
export class DanglingAliasError extends Error {
  constructor(public readonly alias: Alias) {
    super(`Alias '*${alias.source}' does not refer to any defined anchor`);
    this.name = "DanglingAliasError";
  }
}

/** Thrown when a merge key's value does not resolve to a mapping (or a sequence of mappings). */
export class InvalidMergeSourceError extends Error {
  constructor() {
    super("A merge key ('<<') must resolve to a mapping, or a sequence of mappings");
    this.name = "InvalidMergeSourceError";
  }
}

/**
 * Whether a mapping-key AST node is the special `<<` merge-key marker.
 * `merge: true` (passed to `parseDocument`, research D1) makes `yaml`
 * resolve a literal `<<` key to a `Scalar` whose `.value` is a unique JS
 * `Symbol` (verified empirically: `Symbol(<<)`, not the string `"<<"`)
 * rather than leaving it as an ordinary string-valued key.
 */
export function isMergeKeyPair(key: ParsedNode): boolean {
  return isScalar(key) && typeof key.value === "symbol";
}

/**
 * Resolve an alias to its target AST node, guarding the active expansion
 * path against cycles.
 *
 * `activePath` holds the AST node object references currently being
 * walked. `Alias#resolve` returns a reference to the anchor's own node
 * (verified empirically: resolving `*x` inside the very mapping `&x`
 * anchors returns that exact same `YAMLMap` instance), so a cycle is
 * exactly "the resolved target is already in `activePath`" — no separate
 * anchor-name bookkeeping is needed.
 */
export function resolveAlias(alias: Alias, doc: Document, activePath: ReadonlySet<object>): AliasTarget {
  const target = alias.resolve(doc);
  if (target === undefined) {
    throw new DanglingAliasError(alias);
  }
  if (activePath.has(target)) {
    throw new AliasCycleError(alias);
  }
  if (target.range == null) {
    // Only reachable if `doc` was never actually produced by
    // `parseDocument` — every node that library parses has a range.
    throw new Error("Internal error: alias resolved to a node with no range");
  }
  // `Alias#resolve` is declared to return the bare `Scalar | YAMLMap |
  // YAMLSeq` classes rather than their `.Parsed` variants — an
  // imprecision in `yaml`'s own types, since anything reachable through a
  // `Document` this adapter ever holds (always built by `parseDocument`)
  // is in fact fully parsed, as just confirmed by the range check above.
  // This corrects for that library-typing gap; it is not a cast on
  // Cascata's own node model, which is what the constitution's ban on
  // assertion casts is about.
  return target as AliasTarget;
}

function resolveMergeSource(node: ParsedNode, doc: Document, activePath: ReadonlySet<object>): MapNode {
  const target = isAlias(node) ? resolveAlias(node, doc, activePath) : node;
  if (!isMap(target)) {
    throw new InvalidMergeSourceError();
  }
  return target;
}

/**
 * Normalize a merge key's value into an ordered list of source mappings to
 * fold — in the order later sources must lose to earlier ones on
 * conflict. `<<` may name a single mapping (directly, or via one alias) or
 * a sequence of them (`<<: [*a, *b]`), verified empirically for both
 * shapes.
 */
export function mergeSources(value: ParsedNode | null, doc: Document, activePath: ReadonlySet<object>): MapNode[] {
  if (value === null) {
    throw new InvalidMergeSourceError();
  }
  if (isSeq(value)) {
    return value.items.map((item) => resolveMergeSource(item, doc, activePath));
  }
  return [resolveMergeSource(value, doc, activePath)];
}
