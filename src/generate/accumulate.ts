/**
 * The accumulated demand — `SPEC.md` **Article VIII (§18)**, laws one
 * through four; §5.1; §7; v1.1 FR-001 through FR-008;
 * specs/010-type-generator/contracts/accumulated-demand.md.
 *
 * > **The accumulated demand is a stage, and has a name.** For every
 * > position a schema chain can describe, the accumulated demand is the
 * > intersection of every demand any layer places there (§5.1), each named
 * > type resolved in the scope of the layer that used it (§7). It is
 * > computed from schema layers alone. No configuration takes part, and
 * > positions are *shapes*. — Article VIII
 *
 * ## Why this is a third walk
 *
 * `check.ts`'s walk fuses descent with judgment and gates every descent on
 * the value's runtime type; `numeric.ts`'s walk is per pointer of a
 * concrete document and bails the instant there is no value. Neither can
 * describe a position **no document reaches**, which is every position this
 * file exists to describe. The cost — a third reading of the same demands —
 * is paid down the way v1.0 paid it: every reader is shared
 * (`parseDemand`, `resolveTypeName`, `parseTypeExpression`,
 * `readDemandVocabulary`, `readKeysVocabulary`), and the numeric class is
 * not restated but **imported** (`admissionOfDemand`, `admissionOfName`),
 * so `project()` and this file cannot disagree about §17's one question:
 * they run the same function over the same declarations (research D-3).
 *
 * ## A reference is a leaf, and that is the whole termination argument
 *
 * A named type is recorded as a `ref` naming its declarations — never
 * unrolled. Guarded recursion therefore terminates because the walk simply
 * stops: `demand`'s `items` is a reference back to `demand`, and a
 * reference has no body to descend into. Structural descent (`keys`,
 * `values`, `items`) is bounded by the demand text itself, which is finite.
 *
 * The one place work can still multiply is a reference to a declaration
 * **set** — two different declarations of one name, which §7's narrowing
 * produces and which must be intersected body-with-body (research D-2,
 * plan P-4). Those bodies are computed once per set, memoized on the set,
 * and a set that re-enters itself while being computed is recorded as
 * `recursive` and later emitted as one synthesized alias. Without that
 * memo the two-layer recursive shape does not merely get slow — it does not
 * terminate.
 *
 * ## Two named limits, both unexercised by any fixture and both reported
 *
 * 1. **A position that both names a type and declares structural demands of
 *    its own** (`{ type: node, keys: { … } }`) emits the named type; the
 *    position's own `keys`/`values`/`items`/`seal` reach JSDoc but not the
 *    type. The honest emission is an intersection, and research F-2 shows
 *    the host type system cannot express one safely (`&` neither closes a
 *    seal nor survives the numeric rule). No schema in the validate corpus
 *    or the meta-schema writes that shape.
 * 2. **An alternative narrowed by a usage `accept`** carries both the
 *    built-in the `accept` selects and the declaration it narrows; the
 *    built-in decides the emission. For §7's own `resource` — `accept:
 *    [url, path]`, narrowed to `[url]` — both spellings emit `string`, so
 *    the narrowing is invisible in the type and survives in JSDoc, exactly
 *    as the contract's row 27 says.
 */

import { createDiagnostic, type Diagnostic } from "../diagnostics/diagnostic.js";
import { nodesEqual } from "../model/equality.js";
import { compareByCodePoint, type Node, type Scalar } from "../model/node.js";
import { pointerFromPath } from "../model/pointer.js";
import type { SourceSpan } from "../model/span.js";
import type { Layer } from "../merge/provenance.js";
import { readKeysVocabulary } from "../merge/strategy.js";
import { MAX_DEMAND_DEPTH, parseDemand, readNestedKeysMapping, type ParsedDemand, type RawDemand } from "../validate/vocabulary.js";
import { qualifierOfLayer, readTypeDeclarations, resolveTypeName, type TypeDeclaration } from "../validate/types.js";
import type { Alternative, BuiltinTypeName, TypeExpression } from "../validate/typeexpr.js";
import { admissionOfDemand, admissionOfName, intersect as intersectAdmission, union as unionAdmission, type Admission } from "../validate/numeric.js";
import { aliasName, qualifiedAlias } from "./identifiers.js";
import { extend } from "../extend.js";

// --- The tree ------------------------------------------------------------

/** One alternative set after intersection. A `ref` names a declaration set; the emitter decides the spelling. */
export type AccumulatedType =
  | { readonly kind: "builtin"; readonly name: BuiltinTypeName; readonly depth: number }
  | { readonly kind: "ref"; readonly declarations: readonly TypeDeclaration[]; readonly depth: number }
  | { readonly kind: "union"; readonly alternatives: readonly AccumulatedType[] };

/** One constraint that survives accumulation, with the provenance JSDoc needs (FR-023). */
export interface AccumulatedConstraint {
  readonly keyword: "min" | "max" | "minLength" | "maxLength" | "pattern" | "accept";
  /** Rendered for JSDoc — never parsed back. */
  readonly value: string;
  readonly layer: Layer;
  readonly pointer: string;
  readonly span: SourceSpan;
}

/** One demand that contributed to a position, for JSDoc and for the lints. */
export interface DemandSource {
  readonly layer: Layer;
  readonly pointer: string;
  readonly span: SourceSpan;
}

/** The intersection of every layer's demands at one position of the shape — value-free. */
export interface AccumulatedPosition {
  /** `undefined`: no `type` demanded anywhere. `"empty"`: the demands admit no value (FR-004, FR-022). */
  readonly type: AccumulatedType | "empty" | undefined;
  /** The union of names across layers; each name's own position is the intersection of everything naming it. */
  readonly keys: ReadonlyMap<string, AccumulatedKey>;
  readonly values?: AccumulatedPosition;
  readonly items?: AccumulatedPosition;
  /** OR across layers (FR-010). */
  readonly required: boolean;
  /** Set intersection under `nodesEqual`; `undefined` where no layer declared one. An empty array is a real answer: every member was intersected away. */
  readonly enum?: readonly Node[];
  /** `closed` if any layer closes here (FR-012). */
  readonly seal: "open" | "closed";
  /** §17's admission at depth 0 — present only where the demand mentions a number. */
  readonly numeric?: Admission;
  /**
   * §17's admission at every array depth the demand mentions a number at,
   * `0` included. **An addition to data-model.md**, and a needed one: `type:
   * "int[]"` says nothing about the position and everything about its
   * elements, so an emitter deciding `bigint` vs `number` for the element
   * needs the admission at depth 1. Computed exactly as `numeric.ts`
   * computes it for a real element (FR-016).
   */
  readonly numericByDepth: ReadonlyMap<number, Admission>;
  /** The intersected `accept` set, where any layer declared one (FR-028). */
  readonly accept?: readonly string[];
  readonly constraints: readonly AccumulatedConstraint[];
  readonly sources: readonly DemandSource[];
}

/** One named key of a position. `provided` and `constant` exist only where a schema declares a key of its own (§9's top-level vocabulary). */
export interface AccumulatedKey {
  readonly position: AccumulatedPosition;
  /** Some layer provides it — feeds optionality only (FR-010). */
  readonly provided: boolean;
  /** `final: true` with a scalar `provide`: the pinned constant (FR-020). */
  readonly constant?: Scalar;
}

/** One `types:` entry, with everything the emitter needs to name and print it. */
export interface AccumulatedDeclaration {
  readonly declaration: TypeDeclaration;
  /** §7's qualifier — the last non-empty `/`-segment of the declaring document's `$id`, or `layer<rank>` where it declares none. */
  readonly qualifier: string;
  readonly body: AccumulatedPosition;
  readonly emittedName: string;
}

/**
 * A reference naming **more than one** declaration — §7's narrowing chain,
 * intersected body with body (P-4). Emitted inline at each usage, unless
 * the recursion re-enters the set, in which case one alias is synthesized
 * for it (contract row 23).
 */
export interface AccumulatedIntersection {
  /** `<rank>:<name>` per declaration, joined by `&` — the memo key, and stable. */
  readonly key: string;
  readonly declarations: readonly TypeDeclaration[];
  readonly body: AccumulatedPosition;
  /** The set was reached again while its own body was being computed. */
  readonly recursive: boolean;
  /** The declarations' emitted names joined by `_and_`. */
  readonly emittedName: string;
}

export interface AccumulatedTree {
  /** The config's top level: every layer's top-level `keys:`, and the top-level `seal`. */
  readonly root: AccumulatedPosition;
  /** Every named type, in emission order: layer rank, then the layer's own canonical `types:` order. */
  readonly declarations: readonly AccumulatedDeclaration[];
  /** Every multi-declaration reference the tree contains, keyed by `AccumulatedIntersection.key`. An addition to data-model.md — the emitter needs the intersected body, and it has to be computed here. */
  readonly intersections: ReadonlyMap<string, AccumulatedIntersection>;
  readonly rootName: string;
}

/** `diagnostics` carries `info` lints only — this stage refuses nothing. */
export interface AccumulateResult {
  readonly tree: AccumulatedTree;
  readonly diagnostics: readonly Diagnostic[];
}

export interface AccumulateOptions {
  readonly rootName?: string;
}

// --- Internals -----------------------------------------------------------

/** One demand applying at one position, with the scope its type names resolve in (§7). */
interface Contribution {
  readonly parsed: ParsedDemand;
  /**
   * The same demand unread, for `numeric.ts`'s own functions. Absent for a
   * synthesized contribution (a declaration's `accept`), which carries no
   * numeric statement of its own that `admissionOfName` has not already made.
   */
  readonly raw?: RawDemand;
  readonly scopeRank: number;
  readonly layer: Layer;
}

/** One alternative after resolution: a built-in, a set of declarations, or both (a usage `accept` narrowing a named type). */
interface ResolvedAlternative {
  readonly depth: number;
  readonly builtin?: BuiltinTypeName;
  readonly declarations: readonly TypeDeclaration[];
}

interface Ctx {
  readonly allDecls: readonly TypeDeclaration[];
  readonly bodies: Map<string, AccumulatedPosition>;
  readonly inProgress: Set<string>;
  readonly recursive: Set<string>;
  readonly intersectionSets: Map<string, readonly TypeDeclaration[]>;
  readonly pendingSets: string[];
  readonly diagnostics: Diagnostic[];
}

function declarationKey(declaration: TypeDeclaration): string {
  return `${declaration.layerRank}:${declaration.name}`;
}

function setKeyOf(declarations: readonly TypeDeclaration[]): string {
  return declarations.map(declarationKey).join("&");
}

/** Declarations in a set are ordered by declaring rank — the chain's own order, so a set has exactly one spelling. */
function sortDeclarations(declarations: readonly TypeDeclaration[]): readonly TypeDeclaration[] {
  return [...declarations].sort((a, b) => (a.layerRank !== b.layerRank ? a.layerRank - b.layerRank : compareByCodePoint(a.name, b.name)));
}

function mentionsNumbers(admission: Admission): boolean {
  return admission.int || admission.float;
}

// --- Alternative resolution and intersection -----------------------------

function resolveOne(alternative: Alternative, scopeRank: number, ctx: Ctx): ResolvedAlternative | undefined {
  const resolved = resolveTypeName(alternative.name, scopeRank, ctx.allDecls);
  if (resolved === undefined) {
    // Unresolvable from this layer's scope. `validate()` refuses such a
    // schema (`unknown-type-name`) and `generateTypes()` runs that pass
    // first, so this is unreachable through the supported surface; dropping
    // the alternative rather than emptying the position is the reading that
    // cannot invent a `never` nobody wrote.
    return undefined;
  }
  if (typeof resolved === "string") {
    return { depth: alternative.depth, builtin: resolved, declarations: [] };
  }
  return { depth: alternative.depth, declarations: [resolved] };
}

/** Two alternatives at one position, conjoined. `undefined` where nothing can satisfy both. */
function combineAlternatives(a: ResolvedAlternative, b: ResolvedAlternative): ResolvedAlternative | undefined {
  if (a.depth !== b.depth) {
    return undefined;
  }
  if (a.builtin !== undefined && b.builtin !== undefined && a.builtin !== b.builtin) {
    return undefined;
  }
  const builtin = a.builtin ?? b.builtin;
  const declarations = sortDeclarations([...new Set([...a.declarations, ...b.declarations])]);
  return { depth: a.depth, ...(builtin !== undefined ? { builtin } : {}), declarations };
}

function alternativeKey(alternative: ResolvedAlternative): string {
  return `${alternative.depth} ${alternative.builtin ?? ""} ${setKeyOf(alternative.declarations)}`;
}

function dedupeAlternatives(alternatives: readonly ResolvedAlternative[]): readonly ResolvedAlternative[] {
  const byKey = new Map<string, ResolvedAlternative>();
  for (const alternative of alternatives) {
    byKey.set(alternativeKey(alternative), alternative);
  }
  return [...byKey.values()];
}

/** The cross product, conjoined pairwise — §5.1's intersection over two *sets of alternatives*. */
function intersectAlternativeLists(a: readonly ResolvedAlternative[], b: readonly ResolvedAlternative[]): readonly ResolvedAlternative[] {
  const combined: ResolvedAlternative[] = [];
  for (const left of a) {
    for (const right of b) {
      const merged = combineAlternatives(left, right);
      if (merged !== undefined) {
        combined.push(merged);
      }
    }
  }
  return dedupeAlternatives(combined);
}

/**
 * One contribution's own alternatives, resolved in its scope, with a usage
 * `accept` applied.
 *
 * `accept` narrows a **single** named alternative, which is exactly the
 * condition `check.ts`'s `checkTypeExpressionWithAccept` and `numeric.ts`'s
 * `admissionOfDemand` both apply: a union of two or more alternatives never
 * receives one. The narrowed names resolve in the *declaration's* scope,
 * not the usage's — the type's own alternatives are the type's.
 */
function alternativesOf(contribution: Contribution, ctx: Ctx): readonly ResolvedAlternative[] | undefined {
  const expression = contribution.parsed.type;
  if (expression === undefined) {
    return undefined;
  }
  const resolved = expression.alternatives.flatMap((alternative) => {
    const one = resolveOne(alternative, contribution.scopeRank, ctx);
    return one === undefined ? [] : [one];
  });
  if (resolved.length === 0) {
    return undefined;
  }
  const accept = contribution.parsed.accept;
  const only = resolved.length === 1 ? resolved[0] : undefined;
  if (accept === undefined || accept.length === 0 || only === undefined || only.declarations.length !== 1) {
    return dedupeAlternatives(resolved);
  }
  const declaration = only.declarations[0];
  if (declaration === undefined) {
    return dedupeAlternatives(resolved);
  }
  const narrowed = accept.flatMap((name) => {
    const alternative = resolveOne({ name, depth: only.depth }, declaration.layerRank, ctx);
    if (alternative === undefined) {
      return [];
    }
    const merged = combineAlternatives(only, alternative);
    return merged === undefined ? [] : [merged];
  });
  return narrowed.length === 0 ? dedupeAlternatives(resolved) : dedupeAlternatives(narrowed);
}

/** A declaration's own `accept:` as a synthetic type expression — the second conjunct `checkNamedType` applies beside the body. */
function acceptExpression(names: readonly string[]): TypeExpression {
  const alternatives = names.map((name) => ({ name, depth: 0 }));
  return { alternatives: [...new Map(alternatives.map((a) => [`${a.depth} ${a.name}`, a])).values()].sort((a, b) => compareByCodePoint(a.name, b.name)) };
}

/** Alternatives ordered canonically: by depth, then built-ins before references, then by name. Two equal sets therefore print identically (FR-007). */
function sortAlternatives(alternatives: readonly ResolvedAlternative[]): readonly ResolvedAlternative[] {
  return [...alternatives].sort((a, b) => {
    if (a.depth !== b.depth) {
      return a.depth - b.depth;
    }
    const nameA = a.builtin ?? "";
    const nameB = b.builtin ?? "";
    if (nameA !== nameB) {
      return compareByCodePoint(nameA, nameB);
    }
    return compareByCodePoint(setKeyOf(a.declarations), setKeyOf(b.declarations));
  });
}

function toAccumulatedType(alternative: ResolvedAlternative): AccumulatedType {
  if (alternative.builtin !== undefined) {
    return { kind: "builtin", name: alternative.builtin, depth: alternative.depth };
  }
  return { kind: "ref", declarations: alternative.declarations, depth: alternative.depth };
}

// --- The position walk ---------------------------------------------------

const EMPTY_KEYS: ReadonlyMap<string, AccumulatedKey> = new Map();

function emptyPosition(): AccumulatedPosition {
  return { type: undefined, keys: EMPTY_KEYS, required: false, seal: "open", numericByDepth: new Map(), constraints: [], sources: [] };
}

function sourcesOf(contributions: readonly Contribution[]): readonly DemandSource[] {
  return contributions.map((contribution) => ({ layer: contribution.layer, pointer: contribution.parsed.pointer, span: contribution.parsed.span }));
}

/**
 * The empty-intersection lint (FR-004, contract §2). `nearer` is the
 * higher-ranked of the two demands; the diagnostic anchors there and
 * carries the farther one's pointer, span and rank, so a reader sees both
 * ends of the contradiction from either.
 */
function unsatisfiableDiagnostic(first: Contribution, second: Contribution): Diagnostic {
  const nearer = second.layer.rank >= first.layer.rank ? second : first;
  const farther = nearer === second ? first : second;
  return createDiagnostic({
    level: "info",
    code: "demand-unsatisfiable",
    message: `the demand at '${nearer.parsed.pointer}' in '${nearer.layer.identity.location}' and the demand at '${farther.parsed.pointer}' in '${farther.layer.identity.location}' admit no common value, so this position accumulates to 'never' (SPEC.md §18, v1.1 FR-004)`,
    primary: nearer.parsed.span,
    demand: { pointer: farther.parsed.pointer, span: farther.parsed.span },
    related: [{ label: "and this demand", span: nearer.parsed.span }],
    pointer: farther.parsed.pointer,
    pedigreePosition: farther.layer.rank,
  });
}

function accumulateType(contributions: readonly Contribution[], ctx: Ctx): AccumulatedType | "empty" | undefined {
  let running: readonly ResolvedAlternative[] | undefined;
  let runningContribution: Contribution | undefined;
  for (const contribution of contributions) {
    const own = alternativesOf(contribution, ctx);
    if (own === undefined) {
      continue;
    }
    if (running === undefined || runningContribution === undefined) {
      running = own;
      runningContribution = contribution;
      continue;
    }
    const merged = intersectAlternativeLists(running, own);
    if (merged.length === 0) {
      ctx.diagnostics.push(unsatisfiableDiagnostic(runningContribution, contribution));
      return "empty";
    }
    running = merged;
    runningContribution = contribution;
  }
  if (running === undefined) {
    return undefined;
  }
  if (running.length === 0) {
    return "empty";
  }
  const sorted = sortAlternatives(running);
  for (const alternative of sorted) {
    if (alternative.declarations.length > 1) {
      registerIntersection(alternative.declarations, ctx);
    }
  }
  const types = sorted.map(toAccumulatedType);
  const first = types[0];
  if (types.length === 1 && first !== undefined) {
    return first;
  }
  return { kind: "union", alternatives: types };
}

/**
 * §17's admission, per array depth, computed by `numeric.ts`'s own
 * functions over the same declarations — which is what makes FR-016 a
 * property of construction rather than a claim (research D-3).
 *
 * Depth 0 replays `collectNumericDemands`'s own step: `admissionOfDemand`
 * per contributing demand, folded by intersection, recorded only where the
 * demand mentions numbers at all. Deeper levels replay
 * `walkArrayAlternative`'s: `admissionOfName` on the alternative's core,
 * intersected across every contribution that mentions one at that depth.
 */
function accumulateNumeric(contributions: readonly Contribution[], ctx: Ctx): ReadonlyMap<number, Admission> {
  const byDepth = new Map<number, Admission>();
  function fold(depth: number, admission: Admission): void {
    if (!mentionsNumbers(admission)) {
      return;
    }
    const existing = byDepth.get(depth);
    byDepth.set(depth, existing === undefined ? admission : intersectAdmission(existing, admission));
  }
  for (const contribution of contributions) {
    const raw = contribution.raw;
    if (raw === undefined) {
      continue;
    }
    fold(0, admissionOfDemand(raw, contribution.scopeRank, ctx.allDecls, contribution.parsed.accept, new Set()));
    const expression = contribution.parsed.type;
    if (expression === undefined) {
      continue;
    }
    const byArrayDepth = new Map<number, Admission>();
    for (const alternative of expression.alternatives) {
      if (alternative.depth === 0) {
        continue;
      }
      const admission = admissionOfName(alternative.name, contribution.scopeRank, ctx.allDecls, contribution.parsed.accept, new Set());
      const existing = byArrayDepth.get(alternative.depth);
      byArrayDepth.set(alternative.depth, existing === undefined ? admission : unionAdmission(existing, admission));
    }
    for (const [depth, admission] of byArrayDepth) {
      fold(depth, admission);
    }
  }
  const cleaned = new Map<number, Admission>();
  for (const [depth, admission] of byDepth) {
    if (mentionsNumbers(admission)) {
      cleaned.set(depth, admission);
    }
  }
  return cleaned;
}

function accumulateEnum(contributions: readonly Contribution[]): readonly Node[] | undefined {
  let members: readonly Node[] | undefined;
  for (const contribution of contributions) {
    const own = contribution.parsed.enum;
    if (own === undefined) {
      continue;
    }
    members = members === undefined ? own : members.filter((member) => own.some((candidate) => nodesEqual(member, candidate)));
  }
  return members;
}

function accumulateAccept(contributions: readonly Contribution[]): readonly string[] | undefined {
  let names: readonly string[] | undefined;
  for (const contribution of contributions) {
    const own = contribution.parsed.accept;
    if (own === undefined) {
      continue;
    }
    names = names === undefined ? own : names.filter((name) => own.includes(name));
  }
  return names;
}

function constraintOf(keyword: AccumulatedConstraint["keyword"], value: string, contribution: Contribution): AccumulatedConstraint {
  return { keyword, value, layer: contribution.layer, pointer: pointerFromPath([...pointerSegmentsOf(contribution.parsed.pointer), keyword]), span: contribution.parsed.span };
}

/** The pointer path back out of an RFC 6901 string, so a keyword can be appended with the same escaping every other pointer in this codebase uses. */
function pointerSegmentsOf(pointer: string): readonly string[] {
  if (pointer === "") {
    return [];
  }
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function accumulateConstraints(contributions: readonly Contribution[]): readonly AccumulatedConstraint[] {
  const constraints: AccumulatedConstraint[] = [];
  let min: { readonly value: number; readonly constraint: AccumulatedConstraint } | undefined;
  let max: { readonly value: number; readonly constraint: AccumulatedConstraint } | undefined;
  let minLength: { readonly value: bigint; readonly constraint: AccumulatedConstraint } | undefined;
  let maxLength: { readonly value: bigint; readonly constraint: AccumulatedConstraint } | undefined;

  for (const contribution of contributions) {
    const parsed = contribution.parsed;
    if (parsed.min !== undefined && (parsed.min.kind === "int" || parsed.min.kind === "float")) {
      const value = Number(parsed.min.value);
      if (min === undefined || value > min.value) {
        min = { value, constraint: constraintOf("min", String(parsed.min.value), contribution) };
      }
    }
    if (parsed.max !== undefined && (parsed.max.kind === "int" || parsed.max.kind === "float")) {
      const value = Number(parsed.max.value);
      if (max === undefined || value < max.value) {
        max = { value, constraint: constraintOf("max", String(parsed.max.value), contribution) };
      }
    }
    if (parsed.minLength !== undefined && (minLength === undefined || parsed.minLength > minLength.value)) {
      minLength = { value: parsed.minLength, constraint: constraintOf("minLength", String(parsed.minLength), contribution) };
    }
    if (parsed.maxLength !== undefined && (maxLength === undefined || parsed.maxLength < maxLength.value)) {
      maxLength = { value: parsed.maxLength, constraint: constraintOf("maxLength", String(parsed.maxLength), contribution) };
    }
  }
  for (const winner of [min, max, minLength, maxLength]) {
    if (winner !== undefined) {
      constraints.push(winner.constraint);
    }
  }
  for (const contribution of contributions) {
    if (contribution.parsed.pattern !== undefined) {
      constraints.push(constraintOf("pattern", contribution.parsed.pattern, contribution));
    }
  }
  for (const contribution of contributions) {
    const accept = contribution.parsed.accept;
    if (accept !== undefined) {
      constraints.push(constraintOf("accept", accept.join(", "), contribution));
    }
  }
  // A fixed order — keyword by code point, then the layer order each group
  // was collected in — so the emitted JSDoc is byte-identical run to run.
  const order = ["accept", "max", "maxLength", "min", "minLength", "pattern"];
  return constraints
    .map((constraint, index) => ({ constraint, index }))
    .sort((a, b) => {
      const keywordDelta = order.indexOf(a.constraint.keyword) - order.indexOf(b.constraint.keyword);
      return keywordDelta !== 0 ? keywordDelta : a.index - b.index;
    })
    .map((entry) => entry.constraint);
}

/**
 * A contribution's `raw` view must descend in lockstep with its `parsed`
 * one, or `numeric.ts`'s functions get asked about the wrong demand — the
 * first defect this file's own cases caught, and exactly the drift
 * `numeric.ts`'s module doc warns two walks over one vocabulary invite.
 *
 * Both views are therefore derived from the **same nodes** through the
 * **same shared readers** (`readNestedKeysMapping`, and the two-line
 * `values`/`items` read every other consumer performs): nothing here knows
 * where a nested demand lives that `vocabulary.ts` does not already say.
 */
function rawChildOf(raw: RawDemand | undefined, keyword: "values" | "items"): RawDemand | undefined {
  const node = raw?.get(keyword);
  return node !== undefined && node.type === "mapping" ? node.entries : undefined;
}

function rawKeyOf(raw: RawDemand | undefined, name: string): RawDemand | undefined {
  const keysNode = raw?.get("keys");
  if (keysNode === undefined || keysNode.type !== "mapping") {
    return undefined;
  }
  return readNestedKeysMapping(keysNode).get(name);
}

function descend(contribution: Contribution, parsed: ParsedDemand, raw: RawDemand | undefined): Contribution {
  return { parsed, ...(raw !== undefined ? { raw } : {}), scopeRank: contribution.scopeRank, layer: contribution.layer };
}

/** The child demands that apply at one named key: every `keys.<name>.demand`, then every `values` (contract row 6). */
function keyContributions(contributions: readonly Contribution[], name: string): readonly Contribution[] {
  const children: Contribution[] = [];
  for (const contribution of contributions) {
    const declared = contribution.parsed.keys?.get(name)?.demand;
    if (declared !== undefined) {
      children.push(descend(contribution, declared, rawKeyOf(contribution.raw, name)));
    }
  }
  for (const contribution of contributions) {
    const values = contribution.parsed.values;
    if (values !== undefined) {
      children.push(descend(contribution, values, rawChildOf(contribution.raw, "values")));
    }
  }
  return children;
}

function childContributions(contributions: readonly Contribution[], keyword: "values" | "items"): readonly Contribution[] {
  const children: Contribution[] = [];
  for (const contribution of contributions) {
    const child = contribution.parsed[keyword];
    if (child !== undefined) {
      children.push(descend(contribution, child, rawChildOf(contribution.raw, keyword)));
    }
  }
  return children;
}

function positionOf(contributions: readonly Contribution[], depth: number, ctx: Ctx): AccumulatedPosition {
  if (contributions.length === 0 || depth > MAX_DEMAND_DEPTH) {
    return emptyPosition();
  }
  const numericByDepth = accumulateNumeric(contributions, ctx);
  const names = new Set<string>();
  for (const contribution of contributions) {
    for (const name of contribution.parsed.keys?.keys() ?? []) {
      names.add(name);
    }
  }
  const keys = new Map<string, AccumulatedKey>();
  for (const name of [...names].sort(compareByCodePoint)) {
    keys.set(name, { position: positionOf(keyContributions(contributions, name), depth + 1, ctx), provided: false });
  }
  const values = childContributions(contributions, "values");
  const items = childContributions(contributions, "items");
  const accumulatedEnum = accumulateEnum(contributions);
  const accept = accumulateAccept(contributions);
  const numeric = numericByDepth.get(0);
  return {
    type: accumulateType(contributions, ctx),
    keys,
    ...(values.length > 0 ? { values: positionOf(values, depth + 1, ctx) } : {}),
    ...(items.length > 0 ? { items: positionOf(items, depth + 1, ctx) } : {}),
    required: contributions.some((contribution) => contribution.parsed.required === true),
    ...(accumulatedEnum !== undefined ? { enum: accumulatedEnum } : {}),
    seal: contributions.some((contribution) => contribution.parsed.seal === "closed") ? "closed" : "open",
    ...(numeric !== undefined ? { numeric } : {}),
    numericByDepth,
    ...(accept !== undefined ? { accept } : {}),
    constraints: accumulateConstraints(contributions),
    sources: sourcesOf(contributions),
  };
}

// --- Declaration bodies --------------------------------------------------

/** The contributions one declaration set puts at a position: each declaration's own demand, plus its own `accept` as a second conjunct (what `checkNamedType` applies). */
function bodyContributions(declarations: readonly TypeDeclaration[]): readonly Contribution[] {
  const contributions: Contribution[] = [];
  for (const declaration of declarations) {
    const pointerPath = ["types", declaration.name, "demand"] as const;
    contributions.push({ parsed: parseDemand(declaration.demand, pointerPath, declaration.span), raw: declaration.demand, scopeRank: declaration.layerRank, layer: declaration.layer });
    const accept = declaration.accept;
    if (accept !== undefined && accept.length > 0) {
      contributions.push({
        parsed: { type: acceptExpression(accept), span: declaration.span, pointer: pointerFromPath(["types", declaration.name, "accept"]) },
        scopeRank: declaration.layerRank,
        layer: declaration.layer,
      });
    }
  }
  return contributions;
}

function registerIntersection(declarations: readonly TypeDeclaration[], ctx: Ctx): void {
  const key = setKeyOf(declarations);
  if (ctx.inProgress.has(key)) {
    ctx.recursive.add(key);
    return;
  }
  if (ctx.intersectionSets.has(key)) {
    return;
  }
  ctx.intersectionSets.set(key, declarations);
  ctx.pendingSets.push(key);
}

/**
 * One declaration set's body, computed once and memoized on the set.
 *
 * `inProgress` is what makes a recursive set terminate: a reference to a
 * set already being computed is recorded as recursive and left as a
 * reference, so the emitter synthesizes one alias for it rather than
 * unrolling a body that has no end (contract row 23).
 */
function bodyOfSet(key: string, declarations: readonly TypeDeclaration[], ctx: Ctx): AccumulatedPosition {
  const memoized = ctx.bodies.get(key);
  if (memoized !== undefined) {
    return memoized;
  }
  ctx.inProgress.add(key);
  const body = positionOf(bodyContributions(declarations), 0, ctx);
  ctx.inProgress.delete(key);
  ctx.bodies.set(key, body);
  return body;
}

// --- The root ------------------------------------------------------------

/**
 * One layer's own contribution to the config's top level: its top-level
 * `keys:` section and its top-level `seal`, read as if they were one
 * demand mapping. They are the same two keywords at a different scope
 * (§9: "the two are one keyword at two scopes and must never diverge in
 * meaning"), so reading them through the same reader is what keeps them
 * from diverging here.
 */
function rootContribution(layer: Layer): Contribution | undefined {
  if (layer.tree.type !== "mapping") {
    return undefined;
  }
  const entries: [string, Node][] = [];
  const keysNode = layer.tree.entries.get("keys");
  if (keysNode !== undefined && keysNode.type === "mapping") {
    entries.push(["keys", keysNode]);
  }
  const sealNode = layer.tree.entries.get("seal");
  if (sealNode !== undefined) {
    entries.push(["seal", sealNode]);
  }
  if (entries.length === 0) {
    return undefined;
  }
  const raw: RawDemand = new Map(entries);
  return { parsed: parseDemand(raw, [], layer.tree.span), raw, scopeRank: layer.rank, layer };
}

/** `provide` and `final` for one layer's own top-level keys — §9's per-key vocabulary, which exists only where a schema declares a key of its own. */
function governanceOf(layer: Layer): ReadonlyMap<string, { readonly provide?: Node; readonly final: boolean }> {
  const result = new Map<string, { readonly provide?: Node; readonly final: boolean }>();
  const vocabulary = readKeysVocabulary(layer.tree);
  const keysNode = layer.tree.type === "mapping" ? layer.tree.entries.get("keys") : undefined;
  const names = new Set<string>(vocabulary.keys());
  if (keysNode !== undefined && keysNode.type === "mapping") {
    for (const name of keysNode.entries.keys()) {
      names.add(name);
    }
  }
  for (const name of names) {
    const declaration = keysNode !== undefined && keysNode.type === "mapping" ? keysNode.entries.get(name) : undefined;
    const finalNode = declaration !== undefined && declaration.type === "mapping" ? declaration.entries.get("final") : undefined;
    const provide = vocabulary.get(name)?.provide;
    result.set(name, { ...(provide !== undefined ? { provide } : {}), final: finalNode !== undefined && finalNode.type === "scalar" && finalNode.kind === "bool" && finalNode.value === true });
  }
  return result;
}

// --- The stage -----------------------------------------------------------

/**
 * The accumulated demand of one schema chain, root to leaf.
 *
 * Takes **schema layers only**: a `config` layer is a programmer error and
 * throws, the same posture `resolve()` takes for a missing host. No
 * configuration is consulted, no I/O is performed, and the result is
 * reachable with no emitter in sight (FR-008, Principle IV).
 */
export function accumulate(layers: readonly Layer[], options: AccumulateOptions = {}): AccumulateResult {
  for (const layer of layers) {
    if (layer.role !== "schema") {
      throw new TypeError(`accumulate() takes schema layers only; the layer at rank ${layer.rank} ('${layer.identity.location}') has role 'config'. The accumulated demand is computed from schema layers alone (SPEC.md §18) — a configuration takes no part in it.`);
    }
  }

  const allDecls: TypeDeclaration[] = [];
  for (const layer of layers) {
    extend(allDecls, readTypeDeclarations(layer).declarations);
  }
  const ctx: Ctx = { allDecls, bodies: new Map(), inProgress: new Set(), recursive: new Set(), intersectionSets: new Map(), pendingSets: [], diagnostics: [] };

  const rootContributions = layers.flatMap((layer) => {
    const contribution = rootContribution(layer);
    return contribution === undefined ? [] : [contribution];
  });
  const bareRoot = positionOf(rootContributions, 0, ctx);

  // §9's per-key vocabulary — `provide` and `final` — is a statement about a
  // layer's authority over a key, so it exists at the top level and nowhere
  // else (§15, "Nested vs. top-level key declarations"). It is folded in
  // here rather than inside the walk for exactly that reason.
  const rootKeys = new Map<string, AccumulatedKey>();
  const governance = layers.map((layer) => governanceOf(layer));
  const providedNames = new Set<string>();
  for (const perLayer of governance) {
    for (const [name, entry] of perLayer) {
      if (entry.provide !== undefined) {
        providedNames.add(name);
      }
    }
  }
  for (const name of [...new Set([...bareRoot.keys.keys(), ...providedNames])].sort(compareByCodePoint)) {
    const position = bareRoot.keys.get(name)?.position ?? emptyPosition();
    let provided = false;
    let constant: Scalar | undefined;
    for (const perLayer of governance) {
      const entry = perLayer.get(name);
      if (entry === undefined) {
        continue;
      }
      if (entry.provide !== undefined) {
        provided = true;
      }
      if (constant === undefined && entry.final && entry.provide !== undefined && entry.provide.type === "scalar") {
        constant = entry.provide;
      }
    }
    rootKeys.set(name, { position, provided, ...(constant !== undefined ? { constant } : {}) });
  }
  const root: AccumulatedPosition = { ...bareRoot, keys: rootKeys };

  // Every declaration's own body, in emission order. Computing them all —
  // rather than only the reachable ones — is what makes the emitted module
  // a description of the chain's vocabulary rather than of one root's
  // reachability, and it is deterministic without a reachability analysis.
  const byName = new Map<string, TypeDeclaration[]>();
  for (const declaration of allDecls) {
    const existing = byName.get(declaration.name);
    if (existing === undefined) {
      byName.set(declaration.name, [declaration]);
    } else {
      existing.push(declaration);
    }
  }
  const qualifierUse = new Map<string, number>();
  for (const declaration of allDecls) {
    if ((byName.get(declaration.name) ?? []).length > 1) {
      const qualifier = qualifierOfLayer(declaration.layer) ?? `layer${declaration.layerRank}`;
      qualifierUse.set(`${declaration.name} ${qualifier}`, (qualifierUse.get(`${declaration.name} ${qualifier}`) ?? 0) + 1);
    }
  }
  const declarations: AccumulatedDeclaration[] = allDecls.map((declaration) => {
    const qualifier = qualifierOfLayer(declaration.layer) ?? `layer${declaration.layerRank}`;
    const siblings = byName.get(declaration.name) ?? [];
    const emittedName =
      siblings.length <= 1
        ? aliasName(declaration.name)
        : qualifiedAlias(qualifier, declaration.name, (qualifierUse.get(`${declaration.name} ${qualifier}`) ?? 0) > 1 ? declaration.layerRank : undefined);
    return { declaration, qualifier, body: bodyOfSet(setKeyOf([declaration]), [declaration], ctx), emittedName };
  });

  // Multi-declaration sets are discovered while walking, and computing one
  // can discover another — a worklist, not a loop over a fixed list.
  const emittedNameOf = new Map<string, string>(declarations.map((entry) => [declarationKey(entry.declaration), entry.emittedName]));
  const intersections = new Map<string, AccumulatedIntersection>();
  while (ctx.pendingSets.length > 0) {
    const key = ctx.pendingSets.shift();
    if (key === undefined) {
      break;
    }
    const set = ctx.intersectionSets.get(key);
    if (set === undefined || intersections.has(key)) {
      continue;
    }
    const body = bodyOfSet(key, set, ctx);
    intersections.set(key, { key, declarations: set, body, recursive: false, emittedName: set.map((declaration) => emittedNameOf.get(declarationKey(declaration)) ?? aliasName(declaration.name)).join("_and_") });
  }
  // `recursive` is only known once every body has been computed, so it is
  // stamped on afterwards rather than guessed at during the walk.
  for (const [key, intersection] of intersections) {
    intersections.set(key, { ...intersection, recursive: ctx.recursive.has(key) });
  }

  const leaf = layers[layers.length - 1];
  const rootName = options.rootName ?? aliasName((leaf === undefined ? undefined : qualifierOfLayer(leaf)) ?? "Configuration");

  return { tree: { root, declarations, intersections, rootName }, diagnostics: ctx.diagnostics };
}
