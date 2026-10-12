/**
 * The TypeScript emitter — `SPEC.md` **Article VIII (§18)**, laws five
 * through nine; §17; §5.5; v1.1 FR-009 through FR-029;
 * specs/010-type-generator/contracts/emitted-type.md.
 *
 * > **Emitters are translations of the tree, and thin.** The TypeScript
 * > generator emits the tree as declaration text; the JSON Schema exporter
 * > emits the same tree. Neither reads a schema document; both read the
 * > tree. — Article VIII
 *
 * This file is a **string printer**. It imports no compiler: `typescript`
 * is a devDependency, invoked in memory by the soundness oracle under
 * `tests/`, and nothing here parses or typechecks anything. Every row of
 * the contract's mapping table is one branch below, and every row is a
 * compatibility promise under §15's freeze rule from the release that
 * ships it.
 *
 * ## Three things the compiler decided, not the design
 *
 * 1. **A closed mapping with no declared keys is `{ readonly [key: string]:
 *    never }`, not `{}`.** Article VIII's row says "no index signature",
 *    which for the empty case would emit `{}` — a type that admits every
 *    non-nullish value. The probe caught it before it shipped (research
 *    F-4, W-1): the article's row needs the correction "no index signature
 *    where keys are declared; `never` where none are".
 * 2. **No global type name is ever written.** The utility spellings — the
 *    readonly mapped type, the record type, the array generic — do not
 *    appear in the emitted text, which is what makes a schema type named
 *    `Object` safe to emit bare: a module-scope alias shadows the global,
 *    and nothing here relies on the global (F-5, W-2). A case greps this
 *    file for their exact source spellings, so they must not appear even
 *    in a comment.
 * 3. **Two declarations of one name are never joined by `&`.** An alias
 *    intersection can be `never` where the semantic intersection is an
 *    ordinary type, and an open layer's index signature survives `&` with a
 *    closed layer's object type (F-2). The intersected body is emitted
 *    inline; a synthesized alias appears only where the recursion re-enters
 *    the set, which is the one shape inlining cannot terminate on.
 *
 * ## The limit that is the host type system's, not this file's
 *
 * **Closedness is enforced by TypeScript at object literals only.** A value
 * carrying extra keys reaching a closed type *through a variable* is
 * accepted structurally. The emitted type is exact; the compiler's
 * enforcement is partial (F-3, W-3). The oracle writes literals, so the
 * corpus's `seal-violation` cases do fail as they must — but a consumer's
 * variable is not a literal, and the contract names the limit rather than
 * pretending the type is stronger than the host makes it.
 */
import { type Diagnostic } from "../diagnostics/diagnostic.js";
import { type AccumulatedTree } from "./accumulate.js";
/** What `generate()` produces. A refused emission carries an empty `source` and the reason (FR-026). */
export interface GenerateResult {
    readonly source: string;
    readonly diagnostics: readonly Diagnostic[];
}
/**
 * The accumulated demand as TypeScript declaration text.
 *
 * Performs no I/O and writes nothing (FR-029, Article VI): the caller
 * decides where the text goes, or decides that it goes nowhere.
 *
 * A collision between two escaped names is a **refusal**, not a rename
 * (FR-026): the result carries the diagnostics and an empty `source`,
 * because a module in which one of two distinct schema types silently won
 * would say something no schema said.
 */
export declare function generate(tree: AccumulatedTree): GenerateResult;
//# sourceMappingURL=emit.d.ts.map