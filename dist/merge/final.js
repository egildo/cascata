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
import { createDiagnostic } from "../diagnostics/diagnostic.js";
/** The five siblings a **top-level** `keys.<name>` declaration may carry (SPEC.md §9's amended vocabulary line, now that `seal` has moved inside `demand`) — used only to detect "did this layer declare *anything* here", never to interpret any one of them. */
const KEY_DECLARATION_SIBLINGS = ["demand", "provide", "cascade", "final", "delegate"];
/** The first of `KEY_DECLARATION_SIBLINGS` present in `declarationNode`, if any — used as the `final-key-redeclared` diagnostic's own anchor (the offending keyword's own span, not the whole declaration mapping's). */
function firstDeclaredSibling(declarationNode) {
    if (declarationNode.type !== "mapping") {
        return undefined;
    }
    for (const sibling of KEY_DECLARATION_SIBLINGS) {
        const node = declarationNode.entries.get(sibling);
        if (node !== undefined) {
            return node;
        }
    }
    return undefined;
}
/** Whether a raw `final:` value node asserts `true` — the only value that arms it. `final: true` is a boolean (settled during implementation, mirroring `required: true`'s own convention — SPEC.md §9, amended). `final: false` is legal and inert (this function returns `false` for it, same as absence). */
function isFinalTrue(node) {
    return node.type === "scalar" && node.kind === "bool" && node.value === true;
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
export function resolveFinal(layers) {
    const state = new Map();
    const diagnostics = [];
    for (const layer of layers) {
        if (layer.role !== "schema") {
            continue;
        }
        const keysNode = layer.tree.type === "mapping" ? layer.tree.entries.get("keys") : undefined;
        if (keysNode === undefined || keysNode.type !== "mapping") {
            continue;
        }
        for (const [keyName, declarationNode] of keysNode.entries) {
            if (declarationNode.type !== "mapping") {
                continue;
            }
            const current = state.get(keyName) ?? {};
            if (current.final !== undefined) {
                const offending = firstDeclaredSibling(declarationNode);
                if (offending !== undefined) {
                    diagnostics.push(createDiagnostic({
                        level: "error",
                        code: "final-key-redeclared",
                        message: `key '${keyName}' was sealed 'final' by '${current.final.layer.identity.location}' — no descendant schema layer may declare it again, not even a legal narrowing (SPEC.md §6.3, v0.7 FR-010)`,
                        primary: offending.span,
                        pedigreePosition: layer.rank,
                    }));
                }
                continue; // final closes the question; nothing else this layer says about this key is read.
            }
            const finalNode = declarationNode.entries.get("final");
            if (finalNode !== undefined && isFinalTrue(finalNode)) {
                const provideNode = declarationNode.entries.get("provide");
                state.set(keyName, { final: { layer, span: finalNode.span, hasProvide: provideNode !== undefined } });
            }
        }
    }
    return { state, diagnostics };
}
//# sourceMappingURL=final.js.map