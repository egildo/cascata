/**
 * The accumulated numeric demand, per merged-configuration pointer —
 * `SPEC.md` **Article VII (§17)**, v1.0 FR-015 through FR-021;
 * specs/009-output-surface-and-freeze/contracts/numeric-projection.md.
 *
 * > **The demand decides the numeric type, not the document.** `kind` is
 * > lexical — `30` is an int and `30.0` is a float — so a *faithful*
 * > projection would let a config author's punctuation decide whether the
 * > consuming application sees `bigint` or `number`, under an unchanged
 * > schema. That is backwards. — §17
 *
 * ## The rule
 *
 * ```text
 * admission(P) = ⋂ over every demand applying at P ( ⋃ over its depth-0 alternatives )
 * ```
 *
 * Within one `type:` expression the alternatives are *alternatives*, so
 * they **union**. Across demands — two schema layers, or a `keys` entry and
 * a `values` entry covering one key — demands compose by **intersection**
 * (§5.1), which is why no precedence rule has to be invented and why the
 * answer does not depend on the order the layers are read in.
 *
 * | `admission(P)` | entry |
 * |---|---|
 * | contains `float` | `"number"` |
 * | contains `int`, not `float` | `"bigint"` |
 * | contains neither | **no entry** — §17's "no numeric demand" row |
 *
 * Two values in the map and not three: a pointer absent from it is the
 * fourth row, projected faithfully by lexical kind. Absence is the honest
 * spelling of "nothing was promised", and an enum member for it would
 * invite a call site to forget one of three cases.
 *
 * **The gap this file has to fill in for the article.** §17's table covers
 * `int`, `float`, `int | float`, and "no numeric demand". It says nothing
 * about a demand mixing numeric and non-numeric types (`int | string`).
 * Read here by the rule above with no special case: `int | string` admits
 * `{int}`, does not admit `float`, and therefore projects `bigint`. The
 * generalization the article actually states is *"the schema declared a
 * float acceptable here"*, and a non-numeric alternative says nothing
 * whatever about floats — so it must not cost an author exactness they had
 * before they added it. **Reported as a gap in the article** rather than
 * quietly chosen; under §15's freeze rule the fix is an addition, which
 * stays permitted, but only if it is named.
 *
 * ## Why this is a second walk and not a side channel on `check.ts`'s
 *
 * `checkDemand`'s walk has boolean-only fast paths — `alternativeMatchesBoolean`,
 * `matchesResolvedName` — used for existential union membership, and those
 * visit alternatives that do **not** apply to the value in hand. A
 * collector riding along on that walk would record an `int` demand at a
 * pointer holding a string. Separating the two keeps "which alternatives
 * *could* apply here" (this file's question) apart from "did this value
 * satisfy them" (that file's).
 *
 * The cost is named rather than hidden: two walks over the same demands can
 * drift. It is paid down by sharing every reader (`readDemandVocabulary`,
 * `readNestedKeysMapping`, `resolveTypeName`, `parseTypeExpression`) and by
 * copying the depth/`typeHops` accounting structurally rather than
 * reinventing it — and by carrying the same shape of memo, since this walk
 * has the identical `keys` + `values` blow-up `check.ts` bounds.
 */

import type { MergedConfiguration, Layer } from "../merge/provenance.js";
import type { Node } from "../model/node.js";
import { pointerFromPath } from "../model/pointer.js";
import { readDemandVocabulary, readNestedKeysMapping, MAX_DEMAND_DEPTH, type RawDemand } from "./vocabulary.js";
import { allDeclarations, resolveTypeName, type TypeDeclaration } from "./types.js";
import { parseTypeExpression, type Alternative } from "./typeexpr.js";

/** What §17's table decides at one merged-configuration pointer. A pointer with no entry has no numeric demand at all. */
export type NumericClass = "bigint" | "number";

/**
 * Which numeric built-ins a demand admits at one position. Neither flag set
 * means "this demand says nothing about numbers", which is different from
 * "this demand forbids numbers".
 *
 * **Exported from v1.1 (010 FR-016, research D-3), with the lattice and the
 * two functions that compute it.** The type generator has to answer §17's
 * one question — "does the accumulated demand admit `float`?" — over a
 * position no document reaches, and it must get the *same* answer
 * `project()` gets. Sharing the function rather than restating the rule is
 * what makes that a property of construction: the two cannot disagree
 * because they are the same code. Nothing about this file's behaviour
 * changes; four names stop being private.
 */
export interface Admission {
  readonly int: boolean;
  readonly float: boolean;
}

const NOTHING: Admission = { int: false, float: false };

export function union(a: Admission, b: Admission): Admission {
  return { int: a.int || b.int, float: a.float || b.float };
}

export function intersect(a: Admission, b: Admission): Admission {
  return { int: a.int && b.int, float: a.float && b.float };
}

function mentionsNumbers(a: Admission): boolean {
  return a.int || a.float;
}

interface WalkContext {
  readonly configuration: MergedConfiguration;
  readonly allDecls: readonly TypeDeclaration[];
  /** Whose scope a `type:` name resolves in — the *declaring* layer's, once resolution crosses into a named type (§7). */
  readonly scopeRank: number;
  /** Structural levels consumed (`keys`/`items`/`values`), bounded by `MAX_DEMAND_DEPTH` — `check.ts`'s own accounting. */
  readonly depth: number;
  /** Named-type resolutions since the last structural level, bounded the same way. §7's guarded-recursion rule: a productive recursion resets this, an unguarded one does not and stops here. */
  readonly typeHops: number;
}

/**
 * The numeric admission of one type *name*, resolved in `scopeRank`'s
 * scope. A built-in answers directly; a declared type answers with its own
 * `demand.type`'s admission, intersected with its `accept` set where it
 * declares one (that being what `checkNamedType` does: the value must
 * satisfy the type's own demand **and** match one narrowed alternative).
 *
 * `seen` stops an unguarded cycle (`A: {type: B}, B: {type: A}`), which
 * `types.ts` refuses as a declaration but which this walk must still
 * survive, exactly as `check.ts`'s `typeHops` does for the same reason.
 */
export function admissionOfName(name: string, scopeRank: number, allDecls: readonly TypeDeclaration[], usageAccept: readonly string[] | undefined, seen: ReadonlySet<TypeDeclaration>): Admission {
  const resolved = resolveTypeName(name, scopeRank, allDecls);
  if (resolved === undefined) {
    return NOTHING;
  }
  if (typeof resolved === "string") {
    return resolved === "int" ? { int: true, float: false } : resolved === "float" ? { int: false, float: true } : NOTHING;
  }
  if (seen.has(resolved)) {
    return NOTHING;
  }
  const nextSeen = new Set(seen);
  nextSeen.add(resolved);
  const own = admissionOfDemand(resolved.demand, resolved.layerRank, allDecls, undefined, nextSeen);
  const narrowed = usageAccept ?? resolved.accept;
  if (narrowed === undefined || narrowed.length === 0) {
    return own;
  }
  let accepted = NOTHING;
  for (const alternative of narrowed) {
    accepted = union(accepted, admissionOfName(alternative, resolved.layerRank, allDecls, undefined, nextSeen));
  }
  // The value must satisfy both, so the admissions intersect — unless the
  // accept set says nothing about numbers at all (`[url, path]`, the
  // ordinary case), in which case it is not a numeric statement and must
  // not silently erase one.
  return mentionsNumbers(accepted) ? intersect(own, accepted) : own;
}

/** The admission of one demand mapping's own `type:` expression, at depth 0 — its alternatives unioned. Array-depth alternatives say nothing about *this* position; they are descended into by the value walk instead. */
export function admissionOfDemand(raw: RawDemand, scopeRank: number, allDecls: readonly TypeDeclaration[], usageAccept: readonly string[] | undefined, seen: ReadonlySet<TypeDeclaration>): Admission {
  const typeNode = raw.get("type");
  if (typeNode === undefined || typeNode.type !== "scalar" || typeNode.kind !== "string") {
    return NOTHING;
  }
  const parsed = parseTypeExpression(typeNode.value);
  if (!parsed.ok) {
    return NOTHING;
  }
  const depthZero = parsed.value.alternatives.filter((alternative) => alternative.depth === 0);
  // `accept` narrows a *single* named-type alternative, exactly as
  // `checkTypeExpressionWithAccept` applies it — a union of two or more
  // alternatives never receives it.
  const accept = parsed.value.alternatives.length === 1 ? usageAccept : undefined;
  let admission = NOTHING;
  for (const alternative of depthZero) {
    admission = union(admission, admissionOfName(alternative.name, scopeRank, allDecls, accept, seen));
  }
  return admission;
}

/** Read a demand's own `accept:` into a list of names, or `undefined` where it declares none — the identical read `check.ts` performs. */
function usageAcceptOf(raw: RawDemand): readonly string[] | undefined {
  const acceptNode = raw.get("accept");
  if (acceptNode === undefined || acceptNode.type !== "sequence") {
    return undefined;
  }
  return acceptNode.items.flatMap((item) => (item.type === "scalar" && item.kind === "string" ? [item.value] : []));
}

/**
 * Walk every demand against the merged tree, recording each position's
 * accumulated admission.
 *
 * Mirrors `check.ts`'s `checkDemand` descent step for step — `type`
 * (including array depth), `items`, `keys`, `values`, and a named type's
 * whole body in the type's own declaring scope — because the numeric rule
 * has to reach exactly as far as a demand does and no further.
 */
function walk(raw: RawDemand, value: Node | undefined, pointer: string, ctx: WalkContext, record: (pointer: string, admission: Admission) => void, visited: Map<TypeDeclaration, Map<Node, Set<string>>>): void {
  if (value === undefined || ctx.depth > MAX_DEMAND_DEPTH || ctx.typeHops > MAX_DEMAND_DEPTH) {
    return;
  }
  const accept = usageAcceptOf(raw);
  const typeNode = raw.get("type");
  if (typeNode !== undefined && typeNode.type === "scalar" && typeNode.kind === "string") {
    const parsed = parseTypeExpression(typeNode.value);
    if (parsed.ok) {
      const admission = admissionOfDemand(raw, ctx.scopeRank, ctx.allDecls, accept, new Set());
      if (mentionsNumbers(admission)) {
        record(pointer, admission);
      }
      for (const alternative of parsed.value.alternatives) {
        if (alternative.depth > 0) {
          walkArrayAlternative(alternative, value, pointer, ctx, record, visited, accept);
          continue;
        }
        // A named type's own body constrains this same position, in the
        // type's own layer scope (§7) — `keys`, `items` and `values`
        // inside it reach nested pointers, so it has to be walked, not
        // merely asked for its admission.
        const resolved = resolveTypeName(alternative.name, ctx.scopeRank, ctx.allDecls);
        if (resolved !== undefined && typeof resolved !== "string") {
          walkNamedType(resolved, value, pointer, ctx, record, visited);
        }
      }
    }
  }

  const itemsNode = raw.get("items");
  if (itemsNode !== undefined && itemsNode.type === "mapping" && value.type === "sequence") {
    value.items.forEach((item, index) => {
      walk(itemsNode.entries, item, `${pointer}${pointerFromPath([index])}`, { ...ctx, depth: ctx.depth + 1, typeHops: 0 }, record, visited);
    });
  }

  const keysNode = raw.get("keys");
  if (keysNode !== undefined && keysNode.type === "mapping" && value.type === "mapping") {
    for (const [childName, childRaw] of readNestedKeysMapping(keysNode)) {
      walk(childRaw, value.entries.get(childName), `${pointer}${pointerFromPath([childName])}`, { ...ctx, depth: ctx.depth + 1, typeHops: 0 }, record, visited);
    }
  }

  const valuesNode = raw.get("values");
  if (valuesNode !== undefined && valuesNode.type === "mapping" && value.type === "mapping") {
    for (const [childName, childValue] of value.entries) {
      walk(valuesNode.entries, childValue, `${pointer}${pointerFromPath([childName])}`, { ...ctx, depth: ctx.depth + 1, typeHops: 0 }, record, visited);
    }
  }
}

/** An alternative of array depth ≥ 1: descend one sequence level per `[]`, exactly as `checkSingleAlternative` does. */
function walkArrayAlternative(alternative: Alternative, value: Node, pointer: string, ctx: WalkContext, record: (pointer: string, admission: Admission) => void, visited: Map<TypeDeclaration, Map<Node, Set<string>>>, accept: readonly string[] | undefined): void {
  if (value.type !== "sequence") {
    return;
  }
  const inner: Alternative = { name: alternative.name, depth: alternative.depth - 1 };
  value.items.forEach((item, index) => {
    const itemPointer = `${pointer}${pointerFromPath([index])}`;
    if (inner.depth > 0) {
      walkArrayAlternative(inner, item, itemPointer, ctx, record, visited, accept);
      return;
    }
    const admission = admissionOfName(inner.name, ctx.scopeRank, ctx.allDecls, accept, new Set());
    if (mentionsNumbers(admission)) {
      record(itemPointer, admission);
    }
    const resolved = resolveTypeName(inner.name, ctx.scopeRank, ctx.allDecls);
    if (resolved !== undefined && typeof resolved !== "string") {
      walkNamedType(resolved, item, itemPointer, ctx, record, visited);
    }
  });
}

/**
 * Walk a resolved named type's whole demand at `pointer`, in the type's own
 * declaring scope.
 *
 * `visited` is the same shape of memo `check.ts` carries and exists for the
 * same reason: where `keys` and `values` both name one recursive type, both
 * arms arrive here with identical arguments, and without it the walk is
 * 2^depth. Skipping a repeat is exactly equivalent rather than merely
 * cheaper — recording is idempotent, since intersecting an admission with
 * itself is that admission.
 */
function walkNamedType(decl: TypeDeclaration, value: Node, pointer: string, ctx: WalkContext, record: (pointer: string, admission: Admission) => void, visited: Map<TypeDeclaration, Map<Node, Set<string>>>): void {
  if (ctx.typeHops > MAX_DEMAND_DEPTH) {
    return;
  }
  let byValue = visited.get(decl);
  if (byValue === undefined) {
    byValue = new Map();
    visited.set(decl, byValue);
  }
  let keys = byValue.get(value);
  if (keys === undefined) {
    keys = new Set();
    byValue.set(value, keys);
  }
  const key = `${pointer} ${ctx.depth} ${ctx.typeHops}`;
  if (keys.has(key)) {
    return;
  }
  keys.add(key);
  walk(decl.demand, value, pointer, { ...ctx, scopeRank: decl.layerRank, typeHops: ctx.typeHops + 1 }, record, visited);
}

/**
 * Every merged-configuration pointer whose accumulated demand decides its
 * numeric type (§17). A pointer absent from the result has no numeric
 * demand and is projected faithfully by lexical kind.
 *
 * Consumes only `configuration` (Principle IV) and performs no I/O
 * (Article VI). Deterministic: every mapping it reads is canonically
 * key-sorted by construction, and intersection is commutative, so the
 * answer does not depend on layer order either.
 */
export function collectNumericDemands(configuration: MergedConfiguration): ReadonlyMap<string, NumericClass> {
  const allDecls = allDeclarations(configuration);
  const admissions = new Map<string, Admission>();
  function record(pointer: string, admission: Admission): void {
    const existing = admissions.get(pointer);
    admissions.set(pointer, existing === undefined ? admission : intersect(existing, admission));
  }

  for (const layer of configuration.layers) {
    if (layer.role !== "schema") {
      continue;
    }
    const schemaLayer: Layer = layer;
    const visited = new Map<TypeDeclaration, Map<Node, Set<string>>>();
    for (const [keyName, raw] of readDemandVocabulary(schemaLayer.tree)) {
      const pointer = pointerFromPath([keyName]);
      const value = configuration.tree.type === "mapping" ? configuration.tree.entries.get(keyName) : undefined;
      walk(raw, value, pointer, { configuration, allDecls, scopeRank: schemaLayer.rank, depth: 0, typeHops: 0 }, record, visited);
    }
  }

  const result = new Map<string, NumericClass>();
  for (const [pointer, admission] of admissions) {
    if (admission.float) {
      result.set(pointer, "number");
    } else if (admission.int) {
      result.set(pointer, "bigint");
    }
    // Neither: two demands whose numeric alternatives do not overlap. No
    // value can satisfy both, so `validate()` has already refused it and
    // there is nothing for this map to promise.
  }
  return result;
}
