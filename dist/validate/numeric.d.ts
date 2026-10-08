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
import type { MergedConfiguration } from "../merge/provenance.js";
import { type RawDemand } from "./vocabulary.js";
import { type TypeDeclaration } from "./types.js";
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
export declare function union(a: Admission, b: Admission): Admission;
export declare function intersect(a: Admission, b: Admission): Admission;
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
export declare function admissionOfName(name: string, scopeRank: number, allDecls: readonly TypeDeclaration[], usageAccept: readonly string[] | undefined, seen: ReadonlySet<TypeDeclaration>): Admission;
/** The admission of one demand mapping's own `type:` expression, at depth 0 — its alternatives unioned. Array-depth alternatives say nothing about *this* position; they are descended into by the value walk instead. */
export declare function admissionOfDemand(raw: RawDemand, scopeRank: number, allDecls: readonly TypeDeclaration[], usageAccept: readonly string[] | undefined, seen: ReadonlySet<TypeDeclaration>): Admission;
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
export declare function collectNumericDemands(configuration: MergedConfiguration): ReadonlyMap<string, NumericClass>;
//# sourceMappingURL=numeric.d.ts.map