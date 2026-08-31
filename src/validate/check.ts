/**
 * The root→leaf walk — SPEC.md §5.4, §10; v0.4 FR-013 through FR-021;
 * specs/004-constraint-checker/contracts/validate-api.md.
 *
 * Iterates every layer in `configuration.layers` (root to leaf) and, for
 * each schema layer's own `demand` vocabulary, checks the **same merged
 * tree** — never a per-layer snapshot, never the nearest layer alone.
 * This is whole-chain validation from its very first version: the walk
 * was never written to check only the nearest layer and later widened,
 * because iterating every layer costs nothing extra over iterating one —
 * `configuration.layers` is already the full root-to-leaf list, and
 * checking fewer of them would have been the *extra* code. See the
 * milestone report for why this makes User Story 1 and User Story 2 the
 * same code path rather than two, and how that was verified (the leaf-only
 * sabotage, tasks.md T064, run against this file specifically).
 *
 * Determinism (FR-018) falls out of iteration order rather than a
 * separate sort: `configuration.layers` is already rank-ordered, and every
 * `Mapping` this walk reads (`vocabulary`, one key's `RawDemand`, an
 * `items` nested demand) is canonically key-sorted by construction
 * (`createMapping`) — so the same configuration always produces violations
 * in the same order without this file sorting anything itself.
 *
 * Collect-all (FR-017) is likewise structural: nothing here returns early
 * on the first violation found, at any of the three loop levels (layers,
 * keys, keywords).
 */

import type { Node } from "../model/node.js";
import { pointerFromPath, resolvePointer } from "../model/pointer.js";
import type { Layer, MergedConfiguration } from "../merge/provenance.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { readDemandVocabulary, vocabularyProblemsForLayer, type DemandKeyword } from "./vocabulary.js";
import { checkEnum, checkMax, checkMaxLength, checkMin, checkMinLength, checkPattern, checkType, parseTypeDemand, requiredViolationCause, type ViolationSite } from "./constraints.js";
import { renderViolation, type Demand, type Violation } from "./violation.js";

export type CheckOutcome = { readonly ok: true } | { readonly ok: false; readonly diagnostics: Diagnostic[] };

/** The keywords this file's own leaf-check dispatch handles directly. `required` is User Story 3's post-merge check (a different shape — it must reason about *absence*, which no `ViolationSite` can anchor to a value); `items` is handled by its own one-level recursion below, not this table; `accept`/`keys` are refused as unimplemented by `vocabulary.ts` (User Story 4, SPEC.md §9's amendment for `keys`) and never reach here as values to check. `format` is not demand vocabulary at all any more (SPEC.md §15) — a schema writing it is `unknown-demand-keyword`, refused the same way before ever reaching this dispatch. */
const LEAF_KEYWORDS: ReadonlySet<string> = new Set(["type", "min", "max", "minLength", "maxLength", "pattern", "enum"]);

function runLeafCheck(keyword: DemandKeyword, keywordValue: Node, target: Node): ViolationSite[] {
  switch (keyword) {
    case "type": {
      const expr = parseTypeDemand(keywordValue);
      return expr === undefined ? [] : checkType(expr, target);
    }
    case "min":
      return checkMin(keywordValue, target);
    case "max":
      return checkMax(keywordValue, target);
    case "minLength":
      return checkMinLength(keywordValue, target);
    case "maxLength":
      return checkMaxLength(keywordValue, target);
    case "pattern":
      return checkPattern(keywordValue, target);
    case "enum":
      return checkEnum(keywordValue, target);
    default:
      // items/required/accept/keys — not this function's job (see LEAF_KEYWORDS's own doc).
      return [];
  }
}

/**
 * The layer that wrote `originId` (a `span.origin.id`, which is a
 * document location — `src/index.ts`'s `createOrigin(location, location)`)
 * — v0.4 FR-023, plan.md's finding 3. Every value node this walk ever
 * inspects came from some layer's own real parsed tree (directly, or via
 * `provide`, which retains its own schema document's real span —
 * `src/merge/fold.ts`'s `schemaContribution`), so this always finds
 * exactly one match; failing to would be an invariant violation elsewhere
 * in the pipeline, not a bad-document outcome, hence the throw.
 */
function layerForSpanOrigin(configuration: MergedConfiguration, originId: string): Layer {
  const found = configuration.layers.find((layer) => layer.identity.location === originId);
  if (found === undefined) {
    throw new Error(`Internal error: no layer in configuration.layers matches span.origin.id '${originId}' — every merged-tree node's span should trace back to a real layer`);
  }
  return found;
}

/** Build one `Demand` — `keywordPath` is `[keyword]` for a top-level constraint or `["items", nestedKeyword]` for one nested under `items:` (contracts/demand-vocabulary.md's "Nested demand under `items`"). */
function buildDemand(layer: Layer, keyName: string, keywordPath: readonly string[], demandValueNode: Node): Demand {
  const topKeyword = keywordPath[0];
  if (topKeyword === undefined) {
    throw new Error("Internal error: buildDemand called with an empty keywordPath");
  }
  return {
    keyword: topKeyword as DemandKeyword,
    value: demandValueNode,
    layer,
    layerRank: layer.rank,
    pointer: pointerFromPath(["keys", keyName, "demand", ...keywordPath]),
    span: demandValueNode.span,
  };
}

/** Turn one `ViolationSite` into a full `Violation`, resolving the offending value's writing layer from its own span (FR-023). `anchorPointer` is the merged pointer the site's own `pointerSuffix` is relative to — a demanded key's own pointer, or one sequence item's pointer under `items:`. */
function toViolation(configuration: MergedConfiguration, demand: Demand, anchorPointer: string, site: ViolationSite): Violation {
  const mergedPointer = site.pointerSuffix.length === 0 ? anchorPointer : `${anchorPointer}${pointerFromPath(site.pointerSuffix)}`;
  const valueLayer = layerForSpanOrigin(configuration, site.node.span.origin.id);
  return { demand, mergedPointer, valueSpan: site.node.span, valueLayer, reason: site.reason };
}

/** Check one key's `items:` nested demand against each element of a `Sequence` value — contracts/demand-vocabulary.md's "Nested demand under `items`". A non-`Sequence` value or a non-mapping `items:` declaration is simply not checked by this keyword (`type` is what refuses a non-sequence). One level of recursion only: nested keywords are the same closed leaf set, `items`/`required` excluded (no citation for deeper recursion — see contracts/demand-vocabulary.md). */
function violationsForItems(layer: Layer, keyName: string, itemsDeclaration: Node, value: Node, configuration: MergedConfiguration): Violation[] {
  if (itemsDeclaration.type !== "mapping" || value.type !== "sequence") {
    return [];
  }
  const violations: Violation[] = [];
  value.items.forEach((item, index) => {
    const itemPointer = pointerFromPath([keyName, index]);
    for (const [nestedKeyword, nestedValue] of itemsDeclaration.entries) {
      if (!LEAF_KEYWORDS.has(nestedKeyword)) {
        continue;
      }
      const sites = runLeafCheck(nestedKeyword as DemandKeyword, nestedValue, item);
      for (const site of sites) {
        const demand = buildDemand(layer, keyName, ["items", nestedKeyword], nestedValue);
        violations.push(toViolation(configuration, demand, itemPointer, site));
      }
    }
  });
  return violations;
}

/** Whether a `required` demand's own value actually asserts the requirement — only literal `true` does (§5.2's "required: Add legal, Remove never" gives no meaning to an explicit `false` beyond "not required", which is silence's own default; a non-bool value is a malformed shape US4 refuses, not this function's job). */
function isRequiredTrue(node: Node): boolean {
  return node.type === "scalar" && node.kind === "bool" && node.value === true;
}

/**
 * Check one `required: true` demand against the post-merge tree (§5.5,
 * FR-027–FR-031). `value` is `undefined` when `keyName` is absent from the
 * merged tree entirely.
 *
 * **Absent case**: anchored at the merged tree's own root (`mergedPointer:
 * ""`, `configuration.tree`'s own span as the offending "value") — the
 * *nearest resolvable ancestor pointer* contracts/diagnostics.md's
 * `required-violated` row asks for, applied to a top-level key (this
 * milestone's `demand` vocabulary reaches exactly one level deep — see
 * this module's own report note on spec.md's nested-mapping Acceptance
 * Scenario). One violation, never a cascade, because there is no deeper
 * `required` this walk could even discover to cascade into.
 *
 * **Explicit-null case**: anchored at the `null` scalar's own span and
 * document (FR-030) — which may be the config's or a schema's, whichever
 * layer actually wrote the null.
 */
function violationForRequired(configuration: MergedConfiguration, layer: Layer, keyName: string, requiredNode: Node, value: Node | undefined): Violation | undefined {
  const cause = requiredViolationCause(value);
  if (cause === undefined) {
    return undefined;
  }
  const demand = buildDemand(layer, keyName, ["required"], requiredNode);
  // `value !== undefined` is always true here when `cause === "null"`
  // (`requiredViolationCause` only returns "null" for a defined null
  // scalar) — checked explicitly, rather than asserted, so TypeScript
  // narrows `value` to `Node` without an assertion cast on the node model
  // (constitution: "No assertion casts on the node model").
  if (cause === "null" && value !== undefined) {
    return toViolation(configuration, demand, pointerFromPath([keyName]), { pointerSuffix: [], node: value, reason: { kind: "required-violated", cause: "null" } });
  }
  return toViolation(configuration, demand, "", { pointerSuffix: [], node: configuration.tree, reason: { kind: "required-violated", cause: "absent" } });
}

/** Check one schema layer's own `demand` vocabulary against `configuration.tree`. A `role !== "schema"` layer (the config) contributes nothing (v0.4 FR-003, mirroring v0.3 FR-015's posture for `cascade`). */
function violationsForLayer(configuration: MergedConfiguration, layer: Layer): Violation[] {
  if (layer.role !== "schema") {
    return [];
  }
  const vocabulary = readDemandVocabulary(layer.tree);
  const violations: Violation[] = [];
  for (const [keyName, raw] of vocabulary) {
    const keyPointer = pointerFromPath([keyName]);
    const value = resolvePointer(configuration.tree, keyPointer);

    const requiredNode = raw.get("required");
    if (requiredNode !== undefined && isRequiredTrue(requiredNode)) {
      const violation = violationForRequired(configuration, layer, keyName, requiredNode, value);
      if (violation !== undefined) {
        violations.push(violation);
      }
    }

    if (value === undefined) {
      // FR-021's converse: a demand constrains a value if one exists.
      // `required` (just above) is the one exception — it is exactly the
      // check that must run when a value does *not* exist.
      continue;
    }
    for (const [keyword, keywordValue] of raw) {
      if (keyword === "required") {
        continue; // handled above, regardless of whether value is defined.
      }
      if (LEAF_KEYWORDS.has(keyword)) {
        const sites = runLeafCheck(keyword as DemandKeyword, keywordValue, value);
        for (const site of sites) {
          const demand = buildDemand(layer, keyName, [keyword], keywordValue);
          violations.push(toViolation(configuration, demand, keyPointer, site));
        }
        continue;
      }
      if (keyword === "items") {
        violations.push(...violationsForItems(layer, keyName, keywordValue, value, configuration));
      }
      // "accept"/"keys" never reach here as values — US4 refuses them at the vocabulary level.
    }
  }
  return violations;
}

/**
 * Check `configuration` against every schema layer's `demand`, root to
 * leaf (FR-014). Two independent passes run **unconditionally**, mirroring
 * v0.3 FR-028's precedent for merge (`foldConfiguration`'s own doc
 * comment): closed-vocabulary problems (`vocabulary.ts`'s
 * `vocabularyProblemsForLayer` — unknown/unimplemented keywords, malformed
 * shapes, unparseable/unresolvable `type` expressions) are found
 * independently of whether any *value* violates anything, and a malformed
 * demand never produces a duplicate or missing report from the other
 * pass — `constraints.ts`'s leaf checks already treat a malformed demand
 * value as silently not-applicable, so the vocabulary pass is the only
 * source of a diagnostic for it.
 */
export function checkConfiguration(configuration: MergedConfiguration): CheckOutcome {
  const vocabularyDiagnostics: Diagnostic[] = [];
  for (const layer of configuration.layers) {
    vocabularyDiagnostics.push(...vocabularyProblemsForLayer(layer));
  }
  const violations: Violation[] = [];
  for (const layer of configuration.layers) {
    violations.push(...violationsForLayer(configuration, layer));
  }
  const diagnostics = [...vocabularyDiagnostics, ...violations.map(renderViolation)];
  if (diagnostics.length === 0) {
    return { ok: true };
  }
  return { ok: false, diagnostics };
}
