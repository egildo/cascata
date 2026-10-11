/**
 * `final` resolution — SPEC.md §6.3, §9; specs/007-sealing-and-embedding,
 * v0.7 FR-010 through FR-014.
 *
 * **`final` stays per-key, and top-level only** (governance — "who may
 * speak" — not shape). SPEC.md §9's amended text is explicit: a
 * **top-level** `keys.<name>` entry carries the full per-key vocabulary
 * (`demand`, `provide`, `cascade`, `final`, `delegate`); a **nested**
 * entry (inside `demand.keys.<child>`) carries `demand` and `delegate`
 * only. `provide`, `cascade`, and `final` state a *layer's authority
 * over a key* — a relationship between documents, meaningful only where
 * a schema declares a key of its own — while a nested key is part of a
 * value's **shape**, which is `demand`'s job. `delegate` nests because
 * §8's grant is per key at any depth, by deliberate v0.6 design; `final`
 * is not a second exception.
 *
 * (This file briefly nested `final` during implementation, by analogy
 * with `delegate`'s own nested grants — reverted once SPEC.md settled
 * the parity claim the analogy rested on was false. See the milestone
 * report.)
 *
 * `seal` moved into the `demand` vocabulary in v0.7 (see
 * `src/validate/vocabulary.ts`'s own doc) and is no longer resolved
 * here — checked per-layer, per-position, entirely inside
 * `src/validate/check.ts`. This file keeps a whole-stack, root-to-leaf
 * resolution because `final`'s redeclaration refusal (FR-010) genuinely
 * needs to remember "was this key already sealed by an earlier layer" —
 * a fact `seal`'s own per-layer-independent check never needs.
 */
import type { SourceSpan } from "../model/span.js";
import { type Diagnostic } from "../diagnostics/diagnostic.js";
import type { Layer } from "./provenance.js";
/** Where `final` was declared, and whether that same declaration also carries `provide` (§5.5's pinned-constant pattern, FR-011/FR-012). */
export interface FinalState {
    readonly layer: Layer;
    readonly span: SourceSpan;
    readonly hasProvide: boolean;
}
export interface KeyFinalState {
    readonly final?: FinalState;
}
/** Keyed by bare top-level key name (`final` does not nest — see this module's own doc). */
export interface FinalResolution {
    readonly state: ReadonlyMap<string, KeyFinalState>;
    readonly diagnostics: readonly Diagnostic[];
}
/**
 * Resolve one effective `KeyFinalState` per **top-level** key across the
 * whole layer stack, root to leaf (FR-010 through FR-014). Only
 * `role: "schema"` layers are read (FR-014: a config's own `final` has
 * no effect).
 *
 * For each key, per schema layer, in order: if `final` is already set
 * from an earlier layer, **any** further declaration of that key (any of
 * `KEY_DECLARATION_SIBLINGS` present) is refused as `final-key-redeclared`
 * (FR-010) — including a redeclaration that would be a legal narrowing,
 * and including `final` itself being declared again. Otherwise,
 * `final: true` arms `final`, recording whether this exact declaration
 * also carries `provide` (FR-011/FR-012's distinction). `final: false`,
 * or no `final` at all, is inert.
 */
export declare function resolveFinal(layers: readonly Layer[]): FinalResolution;
//# sourceMappingURL=final.d.ts.map