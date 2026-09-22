/**
 * Named types — SPEC.md §7 (Article IV), §9.1; v0.5 FR-001 through
 * FR-020; specs/005-named-types/contracts/type-resolution.md.
 *
 * **SPEC.md §15 (commit 0b63d67) settled a contradiction §7 shipped
 * with, overriding this file's original research.md D1 decision below.**
 * §7 carried two laws prescribing opposite responses to one syntactic
 * act: "descendants may narrow inherited types" is performed BY
 * redeclaring a name; "collision is an error" forbade exactly that. v1's
 * `$adopts` is single-parent and chain-only (§6.1), so every pedigree is
 * one linear chain and every pair of layers is ancestor/descendant —
 * meaning every same-name pair a v1 pedigree could ever produce is
 * precisely the shape a narrowing takes, never the unrelated-declarations
 * case the collision law was written for (the multi-adoption future
 * §6.1 pre-commits C3 linearization for). Settled in favour of narrowing
 * (FR-016, FR-016a): **an unqualified name resolves to the *nearest*
 * declaration at or above the usage layer — never to an error merely
 * because more than one layer declares it.** A redeclaration narrows
 * from its declaring layer downward (FR-008, the identical rule §5.2
 * states for cascade strategies); a widening needs no refusal, since an
 * ancestor's own usage keeps resolving the ancestor's own declaration
 * regardless (FR-028).
 *
 * `collisionDiagnostics` (FR-016b) and `qualifierCollisionDiagnostics`
 * (FR-019a, extended by the same reasoning) are kept, correctly
 * generalized, for the multi-adoption future — but are **structurally
 * unreachable in v1**: `declarations` and `configuration.layers` can
 * only ever hold layers from one chain, so there is no way, at this
 * milestone, to construct two "unrelated" declarations for either
 * function to find. See each function's own doc comment — the lesson
 * this milestone's own depth-limit guard already taught once (a guard
 * identical in shape to a real one, but never reachable from any input
 * the surrounding pipeline can produce) applies here too, and must not
 * be repeated silently.
 */
import { type Diagnostic } from "../diagnostics/diagnostic.js";
import type { Node } from "../model/node.js";
import type { Layer, MergedConfiguration } from "../merge/provenance.js";
import { type BuiltinTypeName } from "./typeexpr.js";
import type { RawDemand } from "./vocabulary.js";
/** One named type, contributed by one schema layer's `types:` section (data-model.md "Type Declaration"). */
export interface TypeDeclaration {
    readonly name: string;
    /** The type's own raw demand — an empty map if the entry declares no `demand` at all (vacuous type). */
    readonly demand: RawDemand;
    /** The type's own declared alternative names (`accept: [...]` at declaration), or `undefined` if none declared. Each is a raw name string, unresolved. */
    readonly accept: readonly string[] | undefined;
    readonly layer: Layer;
    readonly layerRank: number;
    readonly pointer: string;
    readonly span: Node["span"];
}
/** research.md D5: a document's qualifier is the last non-empty `/`-segment of its `$id`; `undefined` if it has none (absent `$id`, or one that yields no segments — FR-019b). Probed against non-ASCII, boundary, and adversarial input before being written down. */
export declare function qualifierOf(idValue: string): string | undefined;
/** `layer`'s own qualifier, if it has a usable `$id` (research.md D5). No assertion cast: `idNode.type`/`idNode.kind` are re-checked here (not inferred across `idNodeOf`'s own return boundary), so TypeScript narrows `idNode.value` to `string` structurally rather than this file asserting it (constitution: "No assertion casts on the node model"). */
export declare function qualifierOfLayer(layer: Layer): string | undefined;
/** One problem found reading one layer's own `types:` section vocabulary — mirrors `vocabulary.ts`'s `DemandVocabularyProblem`. */
export interface TypeVocabularyProblem {
    readonly diagnostic: Diagnostic;
}
/**
 * Read one schema layer's `types:` section into raw `TypeDeclaration`s,
 * plus any closed-vocabulary/shape problems found along the way
 * (FR-001–FR-003). Mirrors `vocabulary.ts`'s `readDemandVocabulary`
 * reading style: absent, empty, or non-mapping `types:` contributes
 * nothing, never an error.
 */
export declare function readTypeDeclarations(layer: Layer): {
    readonly declarations: readonly TypeDeclaration[];
    readonly problems: readonly TypeVocabularyProblem[];
};
/**
 * Every `TypeDeclaration` declared by `layers`, in layer-rank order
 * (deterministic — FR-010).
 *
 * **v1.1: the layers-only form.** `allDeclarations` below is this function
 * applied to a configuration's own layers and is unchanged; the type
 * generator has no configuration to hand it (`SPEC.md` §18: the accumulated
 * demand is computed from schema layers alone), so the layer list — which
 * is all this ever read — became the parameter.
 */
export declare function declarationsOfLayers(layers: readonly Layer[]): readonly TypeDeclaration[];
/** Every `TypeDeclaration` reachable anywhere in the pedigree, root to leaf, in layer-rank order (deterministic — FR-010). */
export declare function allDeclarations(configuration: MergedConfiguration): readonly TypeDeclaration[];
/** Every closed-vocabulary/shape problem found reading every layer's own `types:` section. */
export declare function allTypeVocabularyProblems(configuration: MergedConfiguration): readonly Diagnostic[];
/**
 * FR-016b: a collision — two declarations of one unqualified name whose
 * layers do **not** stand in an ancestor/descendant relation. Reserved
 * for the multi-adoption future §6.1 pre-commits a door for.
 *
 * **Structurally unreachable in v1.** `$adopts` is single-parent and
 * chain-only (§6.1): every layer `validate()` ever sees for one
 * `MergedConfiguration` comes from one linear chain, so any two
 * `declarations` differ in `layerRank`, and in a strict chain rank order
 * *is* ancestor/descendant order — there is no structural way, at this
 * milestone, for two declarations of one name to be "unrelated". Two
 * declarations sharing a name is `FR-016a`'s narrowing, not this. This
 * function is kept — same name, same signature, same diagnostic code —
 * so the call site in `check.ts` needs no restructuring once
 * multi-adoption gives it real work to do; until then it returns `[]`
 * unconditionally, on purpose, not by omission. Do not read its
 * emptiness as "this pedigree has no collisions" the way a caller might
 * read any other guard's silence — read it as "this guard cannot fire
 * yet", the distinction `tests/unit/validate-depth-limit.test.ts`'s own
 * finding exists to keep visible.
 */
export declare function collisionDiagnostics(declarations: readonly TypeDeclaration[]): readonly Diagnostic[];
/** FR-018: a schema declaring a type whose name is one of the built-ins. Checked independently of multi-layer collision — a single schema alone naming a type `string` collides against the built-in "declaration". */
export declare function builtinCollisionDiagnostics(declarations: readonly TypeDeclaration[]): readonly Diagnostic[];
/**
 * FR-019a: two documents whose `$id`s share a qualifier (research.md
 * D5), where those documents do **not** stand in an ancestor/descendant
 * relation. **v1.1: takes the layer list rather than a whole
 * configuration** — it only ever read `configuration.layers`, and the type
 * generator has no configuration to give it. This extends `collisionDiagnostics`'s own FR-016b reasoning
 * to the qualified namespace by the identical structural argument:
 * **not literally stated in `SPEC.md`'s §15 amendment**, which settled
 * only the unqualified case — this is the implementer's own inference
 * from FR-016's now-settled philosophy, flagged for the owner in the
 * milestone report rather than asserted quietly.
 *
 * The reasoning: two documents sharing a qualifier *and* the same local
 * type name is exactly `FR-016a`'s narrowing chain, restated in the
 * qualified namespace (`resolveTypeName`'s qualified branch below is
 * nearest-wins for this reason, mirroring the unqualified branch
 * exactly). Two documents sharing a qualifier with **no** overlapping
 * local name have nothing to disambiguate at all — no qualified
 * reference is ever ambiguous between them, since at most one of them
 * declares any given name. Either way, under v1's single-chain topology
 * (§6.1), there is no reachable case left for this function to refuse,
 * for the same structural reason `collisionDiagnostics` gives: any two
 * documents in one pedigree are ancestor/descendant, never unrelated.
 * Kept — same name, same signature, same diagnostic code — for the
 * multi-adoption future; unreachable in v1, on purpose, documented here
 * rather than left to look like live protection.
 */
export declare function qualifierCollisionDiagnostics(layers: readonly Layer[]): readonly Diagnostic[];
/**
 * Resolve one name (built-in, unqualified, or qualified) from
 * `usageLayerRank`'s own scope (FR-008, FR-016): the **nearest**
 * declaration among layers `0..usageLayerRank` plus the built-in set. A
 * name declared only by a later (descendant) layer, or not declared
 * anywhere reachable, is unresolvable — `undefined`. A name declared by
 * more than one reachable layer is **not** an error (FR-016a) — it
 * resolves to whichever of them is nearest, exactly like an ordinary
 * value's own merge precedence.
 */
export declare function resolveTypeName(name: string, usageLayerRank: number, declarations: readonly TypeDeclaration[]): TypeDeclaration | BuiltinTypeName | undefined;
/**
 * v0.5 FR-009: refuse a cycle among type definitions rather than follow
 * it. **v0.7 part 2 (`SPEC.md` §7, amended; §15) makes what this walk
 * traverses the law rather than a scope decision.**
 *
 * It walks each declaration's own `demand.type` and `accept` alternatives
 * — resolved from that declaration's own layer scope — and deliberately
 * does **not** descend into `keys`, `items`, or `values`. Those two sets
 * are exactly §7's two categories:
 *
 * - A cycle closed through `type:`/`accept:` alone is **unguarded**. It
 *   consumes nothing, has no fixpoint any value can reach, and is refused
 *   here as `unresolvable-type-cycle`.
 * - A cycle closed through at least one of `keys`/`items`/`values` is
 *   **guarded**, therefore productive: every traversal consumes a level of
 *   the document being checked, so it terminates on any finite value. It
 *   is not a cycle this function has anything to say about, and it is
 *   accepted — which is why nothing below descends into structure.
 *
 * FR-009's subtle case falls out with no special handling: a loop that is
 * unguarded at one link (`A → B` by alias) and guarded at another
 * (`B → A` through `keys`) is **accepted**, because the walk from `A`
 * reaches `B` and then finds nothing to follow — one structural level
 * anywhere makes the whole loop productive.
 *
 * The v0.5 comment that stood here recorded the same traversal as "no
 * Acceptance Scenario exercises a cycle reachable only through nested
 * structure". True at the time; from v0.7 part 2 it is the rule, and the
 * behaviour is unchanged because the rule was already drawn in the right
 * place. Termination is enforced independently, and belt-and-suspenders,
 * by `check.ts`'s `WalkContext.typeHops` — this function is the
 * diagnostic an author sees, not the thing that stops the recursion.
 */
export declare function cycleDiagnostics(declarations: readonly TypeDeclaration[]): readonly Diagnostic[];
//# sourceMappingURL=types.d.ts.map