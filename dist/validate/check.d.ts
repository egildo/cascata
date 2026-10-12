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
import type { Layer, MergedConfiguration } from "../merge/provenance.js";
import { type Diagnostic } from "../diagnostics/diagnostic.js";
/** v0.7 FR-002: an `ok: true` outcome carries whatever `info`-level lints were found (e.g. §5.5's `required-vacuous`) — possibly empty, never `error`-level (an `error` anywhere makes the whole check `ok: false` instead). */
/**
 * `checkConfiguration`'s own options — **v1.0 FR-004/FR-005**, and the
 * only one there is.
 *
 * `memoize: false` disables the named-type memo, running the walk exactly
 * as every milestone before v1.0 ran it. It is not a tuning knob and is
 * not reachable from the public `validate()`: it exists because FR-005
 * requires the memoized diagnostics to be *identical, in set and order*,
 * to the unbounded walk's, and an identity claim needs both sides to be
 * runnable. Keeping the old walk available is the strongest form of that
 * check available, and much stronger than a fixture recording what the old
 * walk once said.
 */
export interface CheckOptions {
    readonly memoize?: boolean;
    /**
     * **v1.0 FR-004a** — `false` disables §10's multiplicity rule ("one
     * violated demand at one position is one diagnostic"), producing the raw
     * walk's output.
     *
     * Like `memoize`, this is not a tuning knob and is unreachable from the
     * public `validate()`. It exists because two claims need the raw output
     * to still be observable: that the duplicates the rule collapses are
     * identical in *every* readable field — otherwise the identity would be
     * checked only against itself — and FR-005's own comparison of the
     * memoized against the unmemoized walk, which stays meaningful precisely
     * because it can be run before the collapse as well as after.
     */
    readonly dedupe?: boolean;
}
export type CheckOutcome = {
    readonly ok: true;
    readonly diagnostics: readonly Diagnostic[];
} | {
    readonly ok: false;
    readonly diagnostics: Diagnostic[];
};
/** Exported for `src/validate/resource.ts` (v0.7 US6) — the identical predicate this file's own `url` built-in type check already uses; kept as one definition rather than a second copy. */
export declare function isValidUrl(value: string): boolean;
/** Exported for `src/validate/resource.ts` (v0.7 US6) — see `isValidUrl`'s own doc. */
export declare function isValidPath(value: string): boolean;
/**
 * **v1.1 (010 FR-030)** — every closed-vocabulary problem a *schema chain*
 * has, with no configuration in hand.
 *
 * This is exactly the set of passes `checkConfiguration` below runs before
 * it looks at a single value: the per-layer demand vocabulary (unknown and
 * unimplemented keywords, malformed shapes, malformed sections, malformed
 * key declarations), the namespace checks, the guarded/unguarded type-cycle
 * refusal, per-layer type-usage reachability and accept-widening, and the
 * shape of a top-level `seal`. **The same functions, not a second
 * implementation** — the two call sites share every one of them, so a
 * schema `validate()` refuses is a schema `generateTypes()` refuses, and
 * neither can drift into accepting what the other rejects.
 *
 * What it deliberately does **not** run is everything downstream of a
 * value: the demand walk, `seal`'s own violation check, `final`, and the
 * directives pass all need a merged tree, and a generator has none.
 *
 * `error`s and `info`s both come back; the caller decides. `generateTypes()`
 * refuses on any `error` and carries the `info`s through (FR-030).
 */
export declare function schemaVocabularyProblems(layers: readonly Layer[]): readonly Diagnostic[];
/**
 * Check `configuration` against every schema layer's `demand`, root to
 * leaf. Vocabulary problems (demand keywords, type entries, collisions,
 * qualifiers, cycles, accept-widening) and value violations are found by
 * independent passes and reported together (v0.3 FR-028's precedent).
 */
export declare function checkConfiguration(configuration: MergedConfiguration, options?: CheckOptions): CheckOutcome;
//# sourceMappingURL=check.d.ts.map