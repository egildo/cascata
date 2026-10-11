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
import { type Diagnostic } from "../diagnostics/diagnostic.js";
import { type Node, type Scalar } from "../model/node.js";
import type { SourceSpan } from "../model/span.js";
import type { Layer } from "../merge/provenance.js";
import { type TypeDeclaration } from "../validate/types.js";
import type { BuiltinTypeName } from "../validate/typeexpr.js";
import { type Admission } from "../validate/numeric.js";
/** One alternative set after intersection. A `ref` names a declaration set; the emitter decides the spelling. */
export type AccumulatedType = {
    readonly kind: "builtin";
    readonly name: BuiltinTypeName;
    readonly depth: number;
} | {
    readonly kind: "ref";
    readonly declarations: readonly TypeDeclaration[];
    readonly depth: number;
    /**
     * The intersection of this reference's body with the position's **own**
     * structural demands, where the position declares any (`keys`,
     * `values`, `items`, `seal`). Present only then; a usage that adds
     * nothing of its own carries no `inlined` and is emitted as the alias
     * (row 22).
     *
     * §5.1's composition has no precedence rule and never had one:
     * `checkDemand` runs *every* keyword of one demand beside a resolved
     * `type:`, so `{ type: box, keys: { b: { demand: { required: true } } } }`
     * is enforced as both. Emitting `box` alone was wider than the
     * accumulated demand — the one direction Article VIII's soundness law
     * forbids — and the article is silent on the shape (research W-7).
     */
    readonly inlined?: AccumulatedPosition;
} | {
    readonly kind: "union";
    readonly alternatives: readonly AccumulatedType[];
};
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
/** The key an `AccumulatedIntersection` is stored under — the emitter's way back from a `ref`'s declaration list to its intersected body. */
export declare function intersectionKeyOf(declarations: readonly TypeDeclaration[]): string;
/**
 * The accumulated demand of one schema chain, root to leaf.
 *
 * Takes **schema layers only**: a `config` layer is a programmer error and
 * throws, the same posture `resolve()` takes for a missing host. No
 * configuration is consulted, no I/O is performed, and the result is
 * reachable with no emitter in sight (FR-008, Principle IV).
 */
export declare function accumulate(layers: readonly Layer[], options?: AccumulateOptions): AccumulateResult;
//# sourceMappingURL=accumulate.d.ts.map