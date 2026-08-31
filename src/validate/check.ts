/**
 * The root→leaf walk — SPEC.md §5.4, §7, §9 (amended), §10; v0.4 FR-013
 * through FR-021; v0.5 FR-005 through FR-028;
 * specs/005-named-types/contracts/{type-resolution,nested-demands}.md.
 *
 * Iterates every layer in `configuration.layers` (root to leaf) and, for
 * each schema layer's own `demand` vocabulary, checks the **same merged
 * tree** — whole-chain validation, unchanged in shape from v0.4.
 *
 * **v0.5 generalizes the walk from one level to arbitrary depth** (`keys`
 * generalized alongside `items`, both recursing into further `keys`/
 * `items` beneath them — FR-021–FR-023) and **threads type resolution
 * through it** (FR-005–FR-020): a `type:` name that is not a built-in is
 * resolved against the *usage layer's own scope* (research.md D2 —
 * ancestors and self only, never a descendant), and a resolved name's own
 * `demand`/`accept` is checked **recursively, in the type's own
 * declaring scope** — not the usage's — which is what makes FR-008's
 * "governs from the layer that declares it, downward" real rather than
 * decorative (research.md D1/D2: collision makes an unqualified name
 * globally unique or entirely unresolvable, so this milestone's own scope
 * rule matters for *reachability*, not for choosing among candidates).
 *
 * Every `RawSite` produced anywhere in this file carries its own
 * **declaring** layer/pointer/span explicitly (never inferred by a
 * fallback at the call site) — this is what lets a violation found inside
 * a *resolved named type's own demand* be attributed to the type's own
 * declaration (FR-007's "exactly as if written inline"), while a
 * violation found directly in a usage's own demand is attributed there.
 *
 * Determinism (v0.5 FR-010) still falls out of iteration order — every
 * `Mapping` this walk reads is canonically key-sorted by construction.
 * Collect-all is still structural: nothing here returns early at any loop
 * level (layers, keys, keywords, nesting depth, type resolution).
 */

import type { Node } from "../model/node.js";
import type { DelegationHop } from "../model/reference.js";
import { pointerFromPath, resolvePointer } from "../model/pointer.js";
import type { Layer, MergedConfiguration } from "../merge/provenance.js";
import { createDiagnostic, type Diagnostic } from "../diagnostics/diagnostic.js";
import { readDemandVocabulary, readNestedKeysMapping, vocabularyProblemsForLayer, localNameOf, MAX_DEMAND_DEPTH, type DemandKeyword, type RawDemand } from "./vocabulary.js";
import { checkEnum, checkMax, checkMaxLength, checkMin, checkMinLength, checkPattern, requiredViolationCause, type ViolationSite } from "./constraints.js";
import { renderViolation, type Demand, type Violation, type ViolationReason } from "./violation.js";
import { allDeclarations, builtinCollisionDiagnostics, collisionDiagnostics, cycleDiagnostics, qualifierCollisionDiagnostics, resolveTypeName, type TypeDeclaration } from "./types.js";
import { parseTypeExpression, type Alternative, type TypeExpression } from "./typeexpr.js";

export type CheckOutcome = { readonly ok: true } | { readonly ok: false; readonly diagnostics: Diagnostic[] };

/** Non-recursive, single-value-in/sites-out leaf keywords. `required` is a post-merge absence check (handled separately); `items`/`keys` recurse; `type`/`accept` are handled together by the type-resolution machinery below. */
const SIMPLE_LEAF_KEYWORDS: ReadonlySet<string> = new Set(["min", "max", "minLength", "maxLength", "pattern", "enum"]);

function runSimpleLeafCheck(keyword: DemandKeyword, keywordValue: Node, target: Node): ViolationSite[] {
  switch (keyword) {
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
      return [];
  }
}

// --- Declaring context ------------------------------------------------

/** Which document/layer/pointer actually wrote the demand keyword a `RawSite` reports on — the usage's own, or (once resolution crosses into a named type) the type's own declaring position (v0.5 FR-007). */
interface DeclaringContext {
  readonly layer: Layer;
  readonly layerRank: number;
  readonly pointerPath: readonly (string | number)[];
}

/** One violation site, fully self-describing — no field defaults to "whatever the caller happens to be checking" (v0.4's `ViolationSite` widened with an explicit declaring context, since resolution can now cross document boundaries). */
interface RawSite {
  readonly pointerSuffix: readonly (string | number)[];
  readonly node: Node;
  readonly reason: ViolationReason;
  readonly declaring: DeclaringContext;
  readonly declaringSpan: Node["span"];
}

function siteAt(base: ViolationSite, declaring: DeclaringContext, declaringSpan: Node["span"]): RawSite {
  return { pointerSuffix: base.pointerSuffix, node: base.node, reason: base.reason, declaring, declaringSpan };
}

function mismatchSite(value: Node, expectedDescription: string, declaring: DeclaringContext, declaringSpan: Node["span"]): RawSite {
  return { pointerSuffix: [], node: value, reason: { kind: "type-mismatch", expectedDescription, actualDescription: describeActual(value) }, declaring, declaringSpan };
}

// --- Type-expression matching, with named-type resolution (v0.5) ----------

function describeAlternative(alt: Alternative): string {
  return alt.depth === 0 ? alt.name : `${alt.name}${"[]".repeat(alt.depth)}`;
}

function describeExpression(expr: TypeExpression): string {
  return expr.alternatives.map(describeAlternative).join(" | ");
}

function describeActual(node: Node): string {
  return node.type === "scalar" ? `a ${node.kind} scalar` : `a ${node.type}`;
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isValidPath(value: string): boolean {
  return value.length > 0 && !value.includes(" ");
}

function matchesBuiltinLeaf(node: Node, name: string): boolean {
  switch (name) {
    case "string":
      return node.type === "scalar" && node.kind === "string";
    case "int":
      return node.type === "scalar" && node.kind === "int";
    case "float":
      return node.type === "scalar" && node.kind === "float";
    case "bool":
      return node.type === "scalar" && node.kind === "bool";
    case "null":
      return node.type === "scalar" && node.kind === "null";
    case "mapping":
      return node.type === "mapping";
    case "sequence":
      return node.type === "sequence";
    case "url":
      return node.type === "scalar" && node.kind === "string" && isValidUrl(node.value);
    case "path":
      return node.type === "scalar" && node.kind === "string" && isValidPath(node.value);
    default:
      return false;
  }
}

/**
 * Check `value` against one resolved named type (v0.5 FR-007, FR-008,
 * research.md D3): the type's own `demand`, in **the type's own
 * declaring layer's scope** — never the usage's — and, if the type
 * declares `accept` (narrowed by `usageAccept`, defaulting to its full
 * declared set), the value must additionally match at least one narrowed
 * alternative. Every site produced here declares at the type's own
 * position (FR-007's "exactly as if written inline at the usage").
 * `depth` guards against a pathological reference chain even though
 * `types.ts`'s own cycle detection should already have refused a genuine
 * cycle — belt and suspenders, matching v0.1's own layered depth
 * defenses.
 */
function checkNamedType(decl: TypeDeclaration, value: Node, usageAccept: readonly string[] | undefined, allDecls: readonly TypeDeclaration[], depth: number): readonly RawSite[] {
  if (depth > MAX_DEMAND_DEPTH) {
    return [];
  }
  const sites: RawSite[] = [];
  const typeDeclaring: DeclaringContext = { layer: decl.layer, layerRank: decl.layerRank, pointerPath: ["types", decl.name, "demand"] };

  const typeNode = decl.demand.get("type");
  if (typeNode !== undefined) {
    sites.push(...checkTypeExpressionOnValue(typeNode, value, decl.layerRank, allDecls, { layer: decl.layer, layerRank: decl.layerRank, pointerPath: [...typeDeclaring.pointerPath, "type"] }, depth + 1));
  }
  for (const [keyword, node] of decl.demand) {
    if (keyword === "type" || !SIMPLE_LEAF_KEYWORDS.has(keyword)) {
      continue;
    }
    const declaring: DeclaringContext = { layer: decl.layer, layerRank: decl.layerRank, pointerPath: [...typeDeclaring.pointerPath, keyword] };
    for (const base of runSimpleLeafCheck(keyword as DemandKeyword, node, value)) {
      sites.push(siteAt(base, declaring, node.span));
    }
  }
  // `required`, `items`, `keys` inside a *type's own* demand are not
  // exercised by any Acceptance Scenario and are out of scope for this
  // milestone's own worked examples (§7 never shows a type declaring
  // them) — a scope decision, not a citation gap.

  const declaredAccept = decl.accept;
  if (declaredAccept !== undefined && declaredAccept.length > 0) {
    const narrowed = usageAccept ?? declaredAccept;
    const matchesAny = narrowed.some((altName) => matchesResolvedName(altName, value, decl.layerRank, allDecls, depth + 1));
    if (!matchesAny) {
      const declaring: DeclaringContext = { layer: decl.layer, layerRank: decl.layerRank, pointerPath: [...typeDeclaring.pointerPath.slice(0, -1), "accept"] };
      sites.push(mismatchSite(value, `one of [${narrowed.join(", ")}]`, declaring, decl.span));
    }
  }
  return sites;
}

/** Whether `value` matches `name` resolved from `usageLayerRank`'s scope — boolean only, for existential union/accept membership checks that do not need detailed attribution. */
function matchesResolvedName(name: string, value: Node, usageLayerRank: number, allDecls: readonly TypeDeclaration[], depth: number): boolean {
  const resolved = resolveTypeName(name, usageLayerRank, allDecls);
  if (resolved === undefined) {
    return false;
  }
  if (typeof resolved === "string") {
    return matchesBuiltinLeaf(value, resolved);
  }
  return checkNamedType(resolved, value, undefined, allDecls, depth).length === 0;
}

function alternativeMatchesBoolean(alt: Alternative, value: Node, usageLayerRank: number, allDecls: readonly TypeDeclaration[], depth: number): boolean {
  if (alt.depth === 0) {
    return matchesResolvedName(alt.name, value, usageLayerRank, allDecls, depth);
  }
  if (value.type !== "sequence") {
    return false;
  }
  const inner: Alternative = { name: alt.name, depth: alt.depth - 1 };
  return value.items.every((item) => alternativeMatchesBoolean(inner, item, usageLayerRank, allDecls, depth));
}

/**
 * Depth-0 leaf check for the single-alternative fast path — resolves
 * once, then recurses through array depth without re-resolving.
 * `usageDeclaring` is where this alternative was *written* (the usage's
 * own `type:` position); `usageSpan` is that `type:` value node's own
 * span — used for a builtin mismatch's `Demand.span`, distinct from the
 * *offending value*'s own span (`value.span`, used for
 * `Violation.valueSpan`). A resolved named type overrides both via
 * `checkNamedType`, which attributes to the type's own declaration
 * instead.
 *
 * **An unresolvable name produces no violation site here** (`[]`, not a
 * mismatch) — reachability failures are reported once, as a vocabulary
 * problem, by `reachabilityProblems` below, the same way a globally
 * unknown name is reported once by `vocabulary.ts`'s own
 * `refuseTypeExpressionProblems`. Reporting a generic `type-mismatch`
 * here too, on top of either, would be exactly the duplicate v0.3
 * FR-028's "found by different passes, reported together, never twice"
 * precedent forbids — v0.4's own `parseTypeDemand === undefined -> []`
 * skip is the direct ancestor of this rule, generalized to reachability.
 */
function checkSingleAlternative(alt: Alternative, value: Node, usageLayerRank: number, allDecls: readonly TypeDeclaration[], usageAccept: readonly string[] | undefined, usageDeclaring: DeclaringContext, usageSpan: Node["span"], depth: number): readonly RawSite[] {
  if (alt.depth === 0) {
    const resolved = resolveTypeName(alt.name, usageLayerRank, allDecls);
    if (resolved === undefined) {
      return [];
    }
    if (typeof resolved === "string") {
      return matchesBuiltinLeaf(value, resolved) ? [] : [mismatchSite(value, alt.name, usageDeclaring, usageSpan)];
    }
    return checkNamedType(resolved, value, usageAccept, allDecls, depth);
  }
  if (value.type !== "sequence") {
    return [mismatchSite(value, describeAlternative(alt), usageDeclaring, usageSpan)];
  }
  const inner: Alternative = { name: alt.name, depth: alt.depth - 1 };
  const sites: RawSite[] = [];
  value.items.forEach((item, index) => {
    for (const site of checkSingleAlternative(inner, item, usageLayerRank, allDecls, usageAccept, usageDeclaring, usageSpan, depth)) {
      sites.push({ ...site, pointerSuffix: [index, ...site.pointerSuffix] });
    }
  });
  return sites;
}

/**
 * Check `value` against a `type:` expression's own alternatives (v0.5
 * FR-005, FR-008). Detailed, type-attributed violations are produced only
 * for the common case §7's own examples show: exactly one alternative
 * (at any array depth). A union of 2+ alternatives falls back to
 * existential boolean matching with one generic `type-mismatch` when
 * nothing matches — a scope decision (research.md), not a citation gap:
 * no Acceptance Scenario exercises detailed attribution through a union
 * of named types.
 */
function checkTypeExpressionOnValue(typeNode: Node, value: Node, usageLayerRank: number, allDecls: readonly TypeDeclaration[], usageDeclaring: DeclaringContext, depth: number): readonly RawSite[] {
  return checkTypeExpressionWithAccept(typeNode, value, usageLayerRank, allDecls, undefined, usageDeclaring, depth);
}

function checkTypeExpressionWithAccept(typeNode: Node, value: Node, usageLayerRank: number, allDecls: readonly TypeDeclaration[], usageAccept: readonly string[] | undefined, usageDeclaring: DeclaringContext, depth: number): readonly RawSite[] {
  if (typeNode.type !== "scalar" || typeNode.kind !== "string") {
    return [];
  }
  const parsed = parseTypeExpression(typeNode.value);
  if (!parsed.ok) {
    return [];
  }
  // Deliberately no `unresolvedAlternatives` gate here (unlike
  // vocabulary.ts's own use of it): that helper checks only against
  // typeexpr.ts's hardcoded built-in set, which has no notion of a
  // *declared* type — using it as a pre-check here would treat every
  // named-type usage as unresolvable before `resolveTypeName` (which
  // knows about both) ever got a chance to look. A name this milestone's
  // own scope genuinely cannot resolve still ends up refused below, via
  // `checkSingleAlternative`'s/`alternativeMatchesBoolean`'s own
  // `resolved === undefined` branches — the same outcome, reached
  // correctly instead of prematurely.
  const expr = parsed.value;

  if (expr.alternatives.length === 1) {
    const alt = expr.alternatives[0];
    if (alt !== undefined) {
      return checkSingleAlternative(alt, value, usageLayerRank, allDecls, usageAccept, usageDeclaring, typeNode.span, depth);
    }
  }

  const matches = expr.alternatives.some((alt) => alternativeMatchesBoolean(alt, value, usageLayerRank, allDecls, depth));
  if (matches) {
    return [];
  }
  return [mismatchSite(value, describeExpression(expr), usageDeclaring, typeNode.span)];
}

// --- Turning sites into diagnostics -----------------------------------

/**
 * The layer a value's own span traces back to, plus its delegation
 * breadcrumb if any (v0.6, research.md D4). A direct match against
 * `configuration.layers` (every pre-v0.6 case, unchanged) carries no
 * breadcrumb. A span whose origin does not match any layer directly is
 * checked next against `configuration.delegationBreadcrumbs` — every
 * value reached through delegation, at any hop depth, ultimately
 * belongs to the **config layer** (FR-010: delegation only ever resolves
 * against the config's own tree, never a schema's `provide`), which in
 * every pedigree is the single highest-rank layer.
 */
function layerForSpanOrigin(configuration: MergedConfiguration, originId: string): { readonly layer: Layer; readonly delegatedFrom?: readonly DelegationHop[] } {
  const found = configuration.layers.find((layer) => layer.identity.location === originId);
  if (found !== undefined) {
    return { layer: found };
  }
  const breadcrumb = configuration.delegationBreadcrumbs.get(originId);
  if (breadcrumb !== undefined) {
    const configLayer = configuration.layers.reduce((highest, layer) => (layer.rank > highest.rank ? layer : highest));
    return { layer: configLayer, delegatedFrom: breadcrumb };
  }
  throw new Error(`Internal error: no layer in configuration.layers matches span.origin.id '${originId}', and it is not a known delegation origin either — every merged-tree node's span should trace back to a real layer or a fragment`);
}

function buildDemand(declaring: DeclaringContext, span: Node["span"]): Demand {
  return { layer: declaring.layer, layerRank: declaring.layerRank, pointer: pointerFromPath(declaring.pointerPath), span };
}

function toViolation(configuration: MergedConfiguration, anchorMergedPointer: string, site: RawSite): Violation {
  const demand = buildDemand(site.declaring, site.declaringSpan);
  const mergedPointer = site.pointerSuffix.length === 0 ? anchorMergedPointer : `${anchorMergedPointer}${pointerFromPath(site.pointerSuffix)}`;
  const { layer: valueLayer, delegatedFrom } = layerForSpanOrigin(configuration, site.node.span.origin.id);
  return { demand, mergedPointer, valueSpan: site.node.span, valueLayer, reason: site.reason, ...(delegatedFrom !== undefined ? { delegatedFrom } : {}) };
}

// --- The recursive keys/items walk (v0.5) ---------------------------------

interface WalkContext {
  readonly configuration: MergedConfiguration;
  readonly usageLayer: Layer;
  readonly allDecls: readonly TypeDeclaration[];
  readonly depth: number;
}

function parentPointerOf(pointer: string): string {
  if (pointer.length === 0) {
    return "";
  }
  return pointer.slice(0, pointer.lastIndexOf("/"));
}

/**
 * Check one demand mapping (`raw`) against `value` (possibly absent),
 * recursing into `keys`/`items` (v0.5 FR-021–FR-026). `demandPointerPath`
 * is the full pointer to `raw` itself, in `ctx.usageLayer`'s own
 * document; `mergedPointer` is the full pointer to `value`'s own position
 * in the merged configuration.
 */
function checkDemand(raw: RawDemand, value: Node | undefined, demandPointerPath: readonly (string | number)[], mergedPointer: string, ctx: WalkContext): Violation[] {
  const violations: Violation[] = [];
  const usageDeclaringBase: DeclaringContext = { layer: ctx.usageLayer, layerRank: ctx.usageLayer.rank, pointerPath: demandPointerPath };

  const requiredNode = raw.get("required");
  if (requiredNode !== undefined && requiredNode.type === "scalar" && requiredNode.kind === "bool" && requiredNode.value === true) {
    const cause = requiredViolationCause(value);
    if (cause !== undefined) {
      const demand = buildDemand({ ...usageDeclaringBase, pointerPath: [...demandPointerPath, "required"] }, requiredNode.span);
      if (cause === "null" && value !== undefined) {
        const { layer: valueLayer, delegatedFrom } = layerForSpanOrigin(ctx.configuration, value.span.origin.id);
        violations.push({ demand, mergedPointer, valueSpan: value.span, valueLayer, reason: { kind: "required-violated", cause: "null" }, ...(delegatedFrom !== undefined ? { delegatedFrom } : {}) });
      } else {
        const anchorPointer = parentPointerOf(mergedPointer);
        const anchorNode = resolvePointer(ctx.configuration.tree, anchorPointer) ?? ctx.configuration.tree;
        const { layer: valueLayer, delegatedFrom } = layerForSpanOrigin(ctx.configuration, anchorNode.span.origin.id);
        violations.push({ demand, mergedPointer: anchorPointer, valueSpan: anchorNode.span, valueLayer, reason: { kind: "required-violated", cause: "absent" }, ...(delegatedFrom !== undefined ? { delegatedFrom } : {}) });
      }
    }
  }

  if (value === undefined) {
    return violations;
  }

  const acceptNode = raw.get("accept");
  const usageAccept = acceptNode !== undefined && acceptNode.type === "sequence" ? acceptNode.items.flatMap((item) => (item.type === "scalar" && item.kind === "string" ? [item.value] : [])) : undefined;

  for (const [keyword, keywordValue] of raw) {
    if (keyword === "required" || keyword === "accept") {
      continue;
    }
    if (keyword === "type") {
      const declaring: DeclaringContext = { ...usageDeclaringBase, pointerPath: [...demandPointerPath, "type"] };
      const sites = checkTypeExpressionWithAccept(keywordValue, value, ctx.usageLayer.rank, ctx.allDecls, usageAccept, declaring, ctx.depth);
      for (const site of sites) {
        violations.push(toViolation(ctx.configuration, mergedPointer, site));
      }
      continue;
    }
    if (SIMPLE_LEAF_KEYWORDS.has(keyword)) {
      const declaring: DeclaringContext = { ...usageDeclaringBase, pointerPath: [...demandPointerPath, keyword] };
      for (const base of runSimpleLeafCheck(keyword as DemandKeyword, keywordValue, value)) {
        violations.push(toViolation(ctx.configuration, mergedPointer, siteAt(base, declaring, keywordValue.span)));
      }
      continue;
    }
    if (keyword === "items") {
      violations.push(...checkNestedItems(keywordValue, value, demandPointerPath, mergedPointer, ctx));
      continue;
    }
    if (keyword === "keys") {
      violations.push(...checkNestedKeys(keywordValue, value, demandPointerPath, mergedPointer, ctx));
    }
  }

  return violations;
}

function checkNestedItems(itemsDeclaration: Node, value: Node, demandPointerPath: readonly (string | number)[], mergedPointer: string, ctx: WalkContext): Violation[] {
  if (itemsDeclaration.type !== "mapping" || value.type !== "sequence") {
    return [];
  }
  if (ctx.depth + 1 > MAX_DEMAND_DEPTH) {
    return [depthLimitViolation(itemsDeclaration, ctx, [...demandPointerPath, "items"], mergedPointer)];
  }
  const violations: Violation[] = [];
  value.items.forEach((item, index) => {
    violations.push(...checkDemand(itemsDeclaration.entries, item, [...demandPointerPath, "items"], `${mergedPointer}${pointerFromPath([index])}`, { ...ctx, depth: ctx.depth + 1 }));
  });
  return violations;
}

function checkNestedKeys(keysDeclaration: Node, value: Node, demandPointerPath: readonly (string | number)[], mergedPointer: string, ctx: WalkContext): Violation[] {
  if (keysDeclaration.type !== "mapping" || value.type !== "mapping") {
    return [];
  }
  if (ctx.depth + 1 > MAX_DEMAND_DEPTH) {
    return [depthLimitViolation(keysDeclaration, ctx, [...demandPointerPath, "keys"], mergedPointer)];
  }
  const nested = readNestedKeysMapping(keysDeclaration);
  const violations: Violation[] = [];
  for (const [childName, childRaw] of nested) {
    const childPointer = `${mergedPointer}${pointerFromPath([childName])}`;
    const childValue = value.entries.get(childName);
    violations.push(...checkDemand(childRaw, childValue, [...demandPointerPath, "keys", childName, "demand"], childPointer, { ...ctx, depth: ctx.depth + 1 }));
  }
  return violations;
}

/**
 * v0.5 FR-025, research.md D4: nesting past `MAX_DEMAND_DEPTH` is refused
 * rather than recursed into further — reuses v0.1's `depth-limit-exceeded`
 * code (the identical hazard), anchored at the demand node whose
 * recursion would cross the limit.
 *
 * **Bug found and fixed during US2's own conformance testing**
 * (`tests/unit/validate-depth-limit.test.ts`'s probe): this used to build
 * a `{kind: "type-mismatch", ...}` reason — there was no dedicated
 * `ViolationReason` variant for a depth-limit refusal when this was
 * first written, so it borrowed `type-mismatch`'s shape to describe one
 * in prose. `CODE_FOR_REASON` (`violation.ts`) then rendered it as a
 * `type-mismatch` *diagnostic code* — the wrong code, catchable only by
 * a case where the runtime (`check.ts`) walk, not just the schema-shape
 * (`vocabulary.ts`) pass, actually reaches the boundary against a real
 * value. Fixed by adding a genuine `"depth-limit-exceeded"` reason kind
 * to `violation.ts` instead of overloading `type-mismatch`.
 */
function depthLimitViolation(node: Node, ctx: WalkContext, pointerPath: readonly (string | number)[], mergedPointer: string): Violation {
  const demand = buildDemand({ layer: ctx.usageLayer, layerRank: ctx.usageLayer.rank, pointerPath }, node.span);
  const { layer: valueLayer, delegatedFrom } = layerForSpanOrigin(ctx.configuration, node.span.origin.id);
  return { demand, mergedPointer, valueSpan: node.span, valueLayer, reason: { kind: "depth-limit-exceeded", maxDepth: MAX_DEMAND_DEPTH }, ...(delegatedFrom !== undefined ? { delegatedFrom } : {}) };
}

/** Check one schema layer's own top-level `keys.<name>.demand` against `configuration.tree`. */
function violationsForLayer(configuration: MergedConfiguration, layer: Layer, allDecls: readonly TypeDeclaration[]): Violation[] {
  if (layer.role !== "schema") {
    return [];
  }
  const vocabulary = readDemandVocabulary(layer.tree);
  const violations: Violation[] = [];
  for (const [keyName, raw] of vocabulary) {
    const keyPointer = pointerFromPath([keyName]);
    const value = resolvePointer(configuration.tree, keyPointer);
    violations.push(...checkDemand(raw, value, ["keys", keyName, "demand"], keyPointer, { configuration, usageLayer: layer, allDecls, depth: 0 }));
  }
  return violations;
}

// --- type-usage problems: reachability + accept-widening (schema-authoring, not value violations) ----

/**
 * Two `type:`-usage problems, found independent of any value, walked
 * together in one recursive pass over every demand (mirroring
 * `vocabulary.ts`'s own recursive vocabulary pass, and — like it — never
 * looking at whether a value exists):
 *
 * - **Reachability** (v0.5 FR-008, research.md D2): a name in
 *   `knownDeclaredNames` (declared *somewhere* in the pedigree) that
 *   `resolveTypeName` cannot resolve from this usage's own layer —
 *   because it is declared only by a descendant (unreachable), or
 *   because it collided (research.md D1, unresolvable everywhere) — is
 *   `unknown-type-name`. A name **not** in `knownDeclaredNames` at all is
 *   *not* re-reported here: `vocabulary.ts`'s own `refuseTypeExpressionProblems`
 *   already refused it as globally unknown, and the value-checking walk
 *   (`checkSingleAlternative`) already skips (no violation) rather than
 *   guessing at a second diagnostic for the same name (v0.3 FR-028's
 *   never-twice precedent, generalized).
 * - **Accept-widening** (FR-013, research.md D3): a usage's `accept`
 *   naming something outside the referenced type's own declared set,
 *   including any selection at all when the type declares none.
 */
function typeUsageProblems(configuration: MergedConfiguration, allDecls: readonly TypeDeclaration[], knownDeclaredNames: ReadonlySet<string>): Diagnostic[] {
  const problems: Diagnostic[] = [];

  function checkAlternativeReachability(alt: Alternative, layer: Layer, pointerPath: readonly (string | number)[], span: Node["span"]): void {
    // `knownDeclaredNames` holds only unqualified local names
    // (`TypeDeclaration.name`, `types.ts`); a qualified alternative like
    // `root/resource` must be compared by its local part, or every
    // qualified reference — valid or not — looks globally unknown here.
    if (!knownDeclaredNames.has(localNameOf(alt.name))) {
      return; // globally unknown — vocabulary.ts's own pass already refused it.
    }
    if (resolveTypeName(alt.name, layer.rank, allDecls) !== undefined) {
      return; // reachable — nothing to report.
    }
    problems.push(
      createDiagnostic({
        code: "unknown-type-name",
        message: `'${pointerFromPath(pointerPath)}' names '${alt.name}', declared in the pedigree but not reachable from this layer's own scope (an ancestor cannot resolve a descendant's types, or the name collided — SPEC.md §7, v0.5 FR-008)`,
        primary: span,
        demand: { pointer: pointerFromPath(pointerPath), span },
        pedigreePosition: layer.rank,
      }),
    );
  }

  function walk(raw: RawDemand, layer: Layer, pointerPath: readonly (string | number)[], depth: number): void {
    if (depth > MAX_DEMAND_DEPTH) {
      return;
    }
    const typeNode = raw.get("type");
    const acceptNode = raw.get("accept");
    if (typeNode !== undefined && typeNode.type === "scalar" && typeNode.kind === "string") {
      const parsed = parseTypeExpression(typeNode.value);
      if (parsed.ok) {
        for (const alt of parsed.value.alternatives) {
          checkAlternativeReachability(alt, layer, [...pointerPath, "type"], typeNode.span);
        }
        if (parsed.value.alternatives.length === 1 && acceptNode !== undefined && acceptNode.type === "sequence") {
          const alt = parsed.value.alternatives[0];
          if (alt !== undefined) {
            const resolved = resolveTypeName(alt.name, layer.rank, allDecls);
            const declaredSet = resolved !== undefined && typeof resolved !== "string" ? (resolved.accept ?? []) : [];
            for (const item of acceptNode.items) {
              if (item.type === "scalar" && item.kind === "string" && !declaredSet.includes(item.value)) {
                problems.push(
                  createDiagnostic({
                    code: "type-accept-widened",
                    message: `'${pointerFromPath([...pointerPath, "accept"])}' selects '${item.value}', which is outside the declared set [${declaredSet.join(", ")}] — selecting outside the declared set is widening (SPEC.md §5.2, v0.5 FR-013)`,
                    primary: item.span,
                    demand: { pointer: pointerFromPath([...pointerPath, "accept"]), span: item.span },
                    pedigreePosition: layer.rank,
                  }),
                );
              }
            }
          }
        }
      }
    }
    const itemsNode = raw.get("items");
    if (itemsNode !== undefined && itemsNode.type === "mapping") {
      walk(itemsNode.entries, layer, [...pointerPath, "items"], depth + 1);
    }
    const keysNode = raw.get("keys");
    if (keysNode !== undefined && keysNode.type === "mapping") {
      const nested = readNestedKeysMapping(keysNode);
      for (const [childName, childRaw] of nested) {
        walk(childRaw, layer, [...pointerPath, "keys", childName, "demand"], depth + 1);
      }
    }
  }

  for (const layer of configuration.layers) {
    if (layer.role !== "schema") {
      continue;
    }
    const vocabulary = readDemandVocabulary(layer.tree);
    for (const [keyName, raw] of vocabulary) {
      walk(raw, layer, ["keys", keyName, "demand"], 0);
    }
  }
  return problems;
}

/**
 * Check `configuration` against every schema layer's `demand`, root to
 * leaf. Vocabulary problems (demand keywords, type entries, collisions,
 * qualifiers, cycles, accept-widening) and value violations are found by
 * independent passes and reported together (v0.3 FR-028's precedent).
 */
export function checkConfiguration(configuration: MergedConfiguration): CheckOutcome {
  const allDecls = allDeclarations(configuration);
  const knownDeclaredNames = new Set(allDecls.map((d) => d.name));

  const vocabularyDiagnostics: Diagnostic[] = [];
  for (const layer of configuration.layers) {
    vocabularyDiagnostics.push(...vocabularyProblemsForLayer(layer, knownDeclaredNames));
  }
  vocabularyDiagnostics.push(...collisionDiagnostics(allDecls));
  vocabularyDiagnostics.push(...builtinCollisionDiagnostics(allDecls));
  vocabularyDiagnostics.push(...qualifierCollisionDiagnostics(configuration));
  vocabularyDiagnostics.push(...cycleDiagnostics(allDecls));
  vocabularyDiagnostics.push(...typeUsageProblems(configuration, allDecls, knownDeclaredNames));

  const violations: Violation[] = [];
  for (const layer of configuration.layers) {
    violations.push(...violationsForLayer(configuration, layer, allDecls));
  }

  const diagnostics = [...vocabularyDiagnostics, ...violations.map(renderViolation)];
  if (diagnostics.length === 0) {
    return { ok: true };
  }
  return { ok: false, diagnostics };
}
