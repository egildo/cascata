/**
 * `seal`/`final` resolution — SPEC.md §6.3, §5.2, §9;
 * specs/007-sealing-and-embedding, v0.7 FR-006 through FR-015.
 *
 * Mirrors `src/merge/strategy.ts`'s `resolveStrategies` in shape (one
 * running per-key state, walked schema-layer-by-schema-layer root to
 * leaf, config layers never read — FR-014's structural exemption) but is
 * its own file rather than a third axis bolted onto that one: `cascade`,
 * `seal`, and `final` are three independently-tightening axes over the
 * same `keys.<name>` declarations sharing no state, and one function
 * tracking three unrelated running maps is harder to read and test in
 * isolation than three cousins sharing one iteration shape
 * (research.md D4).
 *
 * Unlike `cascade`, `seal`/`final` never change what value wins at a
 * position — they only gate which keys/values are *legal* — so there is
 * no "advance per layer during the fold" twin the way `strategy.ts` has
 * `advanceStrategies` alongside `resolveStrategies`: one flat, whole-stack
 * resolution is enough, consumed later by `src/validate/check.ts` against
 * the already-merged tree.
 *
 * Reads the **raw** schema tree directly (`keys.<name>`'s own top-level
 * mapping) rather than going through `strategy.ts`'s `readKeysVocabulary`
 * (which only ever extracted `provide`/`cascade`): `final-key-redeclared`
 * (FR-010) must detect *any* of `demand`, `provide`, `cascade`, `seal`,
 * `final`, or `delegate` being declared, which no existing reader
 * assembles in one place.
 */

import type { Node } from "../model/node.js";
import type { SourceSpan } from "../model/span.js";
import { createDiagnostic, type Diagnostic } from "../diagnostics/diagnostic.js";
import type { Layer } from "./provenance.js";

export type SealOpenness = "open" | "closed";

/** Where `final` was declared, and whether that same declaration also carries `provide` (§5.5's pinned-constant pattern, FR-011/FR-012). */
export interface FinalState {
  readonly layer: Layer;
  readonly span: SourceSpan;
  readonly hasProvide: boolean;
}

/** One top-level key's resolved seal state — the whole-stack analogue of `strategy.ts`'s per-key `MergeStrategy`. */
export interface KeySealState {
  readonly openness: SealOpenness;
  /** Which layer (if any) declared `closed` — for diagnostics naming "the schema that closed it". `undefined` while `openness` is still the default `"open"`. */
  readonly closedBy?: { readonly layer: Layer; readonly span: SourceSpan };
  readonly final?: FinalState;
}

export interface SealResolution {
  readonly state: ReadonlyMap<string, KeySealState>;
  readonly diagnostics: readonly Diagnostic[];
}

/** The six siblings a `keys.<name>` declaration may carry (SPEC.md §9's vocabulary line) — used only to detect "did this layer declare *anything* here", never to interpret any one of them (that is each keyword's own reader's job). */
const KEY_DECLARATION_SIBLINGS = ["demand", "provide", "cascade", "seal", "final", "delegate"] as const;

/** The first of `KEY_DECLARATION_SIBLINGS` present in `declarationNode`, if any — used as the `final-key-redeclared` diagnostic's own anchor (the offending keyword's own span, not the whole declaration mapping's). */
function firstDeclaredSibling(declarationNode: Node): Node | undefined {
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

/** Interpret a raw `seal:` value node — `"open"`/`"closed"` only (FR-006); anything else is `undefined`, which the caller refuses as `unknown-seal-value`. */
function interpretSeal(node: Node): SealOpenness | undefined {
  if (node.type === "scalar" && node.kind === "string" && (node.value === "open" || node.value === "closed")) {
    return node.value;
  }
  return undefined;
}

/** Whether a raw `final:` value node asserts `true` — the only value that arms it (a judgment call: no worked example in SPEC.md spells `final`'s literal YAML syntax; `final: true`, mirroring `required: true`'s own boolean convention, is the reading used here — see the milestone report). */
function isFinalTrue(node: Node): boolean {
  return node.type === "scalar" && node.kind === "bool" && node.value === true;
}

function describeSealValue(node: Node): string {
  if (node.type === "scalar") {
    return node.kind === "string" ? JSON.stringify(node.value) : String(node.value);
  }
  return `a ${node.type}`;
}

/**
 * Resolve one effective `KeySealState` per top-level key across the whole
 * layer stack (FR-006 through FR-015), root to leaf. Only `role: "schema"`
 * layers are read (FR-014: a config's own `seal`/`final` has no effect —
 * this function never looks at a config layer's vocabulary at all, the
 * same structural exemption `resolveStrategies` gives `cascade`).
 *
 * For each key, per schema layer, in order:
 *
 * - If `final` is already set from an earlier layer, **any** further
 *   declaration of that key (any of `KEY_DECLARATION_SIBLINGS` present)
 *   is refused as `final-key-redeclared` (FR-010) — including a
 *   redeclaration that would be a legal narrowing, and including `final`
 *   itself being declared again. This layer's declaration is otherwise
 *   ignored entirely: `final` closes the question, so nothing it says
 *   past this point can reopen or further tighten anything.
 * - Otherwise, `seal: open → closed` tightens silently (FR-009); `closed →
 *   open` is refused as `seal-weakened`, the descendant's own declared
 *   value as the primary span (the same shape `cascade-strategy-weakened`
 *   already has). A `seal` value that is neither is refused as
 *   `unknown-seal-value` (FR-006).
 * - `final: true` on this same layer arms `final`, recording whether this
 *   exact declaration also carries `provide` (FR-011/FR-012's distinction).
 *
 * Every violation found is collected, not only the first (v0.3 FR-028's
 * "collect independently determinable failures" precedent, applied here).
 */
export function resolveSeal(layers: readonly Layer[]): SealResolution {
  const state = new Map<string, KeySealState>();
  const diagnostics: Diagnostic[] = [];

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
      const current: KeySealState = state.get(keyName) ?? { openness: "open" };

      if (current.final !== undefined) {
        const offending = firstDeclaredSibling(declarationNode);
        if (offending !== undefined) {
          diagnostics.push(
            createDiagnostic({
              level: "error",
              code: "final-key-redeclared",
              message: `key '${keyName}' was sealed 'final' by '${current.final.layer.identity.location}' — no descendant schema layer may declare it again, not even a legal narrowing (SPEC.md §6.3, v0.7 FR-010)`,
              primary: offending.span,
              pedigreePosition: layer.rank,
            }),
          );
        }
        continue; // final closes the question; nothing else this layer says about this key is read.
      }

      let openness = current.openness;
      let closedBy = current.closedBy;
      const sealNode = declarationNode.entries.get("seal");
      if (sealNode !== undefined) {
        const declared = interpretSeal(sealNode);
        if (declared === undefined) {
          diagnostics.push(
            createDiagnostic({
              level: "error",
              code: "unknown-seal-value",
              message: `key '${keyName}' declares 'seal: ${describeSealValue(sealNode)}', which is not 'open' or 'closed' (SPEC.md §6.3, v0.7 FR-006)`,
              primary: sealNode.span,
              pedigreePosition: layer.rank,
            }),
          );
        } else if (declared !== openness) {
          if (openness === "open" && declared === "closed") {
            openness = "closed";
            closedBy = { layer, span: sealNode.span };
          } else {
            diagnostics.push(
              createDiagnostic({
                level: "error",
                code: "seal-weakened",
                message: `key '${keyName}' cannot weaken 'seal: closed' to 'open' — an ancestor's closed struct may not be reopened by a descendant (SPEC.md §6.3, v0.7 FR-009)`,
                primary: sealNode.span,
                pedigreePosition: layer.rank,
              }),
            );
          }
        }
      }

      let final: FinalState | undefined = current.final;
      const finalNode = declarationNode.entries.get("final");
      if (finalNode !== undefined && isFinalTrue(finalNode)) {
        const provideNode = declarationNode.entries.get("provide");
        final = { layer, span: finalNode.span, hasProvide: provideNode !== undefined };
      }

      state.set(keyName, { openness, ...(closedBy !== undefined ? { closedBy } : {}), ...(final !== undefined ? { final } : {}) });
    }
  }

  return { state, diagnostics };
}
