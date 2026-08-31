/**
 * Reading a schema's `demand` vocabulary — SPEC.md §9 ("Schema vocabulary
 * per key: `demand` (`type`, `items`, `required`, `accept`, plus
 * JSON-Schema-named leaf constraints: `min`, `max`, `minLength`,
 * `maxLength`, `pattern`, `enum`, `format`)..."); v0.4 FR-001 through
 * FR-007, FR-011a, FR-011b;
 * specs/004-constraint-checker/contracts/demand-vocabulary.md.
 *
 * Mirrors `src/merge/strategy.ts`'s `readKeysVocabulary` in reading style —
 * absent/empty/non-mapping `keys:` contributes nothing, never an error
 * (v0.3 FR-003's rule, unchanged) — but reads the field that function
 * deliberately does not: `demand`. `seal`, `final`, and `delegate` stay
 * unread by *this* module too (v0.4 FR-002, mirroring v0.3's posture):
 * there is no code path here that inspects any of the three, which is what
 * "ignored" means throughout this codebase.
 *
 * `readDemandVocabulary` only **extracts** what a schema wrote — it does
 * not yet judge whether a keyword is legal. `refuseUnknownOrUnimplemented
 * Keywords` and `refuseTypesSection` add that judgment on top
 * (`unknown-demand-keyword`, `unimplemented-demand-keyword`,
 * `unimplemented-types-section`), consumed by `src/validate/check.ts`
 * (tasks.md T048/T049/T052, User Story 4). Value-**shape** refusal
 * (`malformed-demand-value` — e.g. `min: "ten"`) lives in
 * `src/validate/constraints.ts` instead (T050), alongside the leaf checks
 * that are the first code to actually interpret each keyword's value —
 * this file only ever reads a keyword's raw `Node`, never its shape.
 */

import { createDiagnostic, type Diagnostic } from "../diagnostics/diagnostic.js";
import type { Node } from "../model/node.js";
import { pointerFromPath } from "../model/pointer.js";

/** §9's closed `demand` keyword list (v0.4 FR-005). Order is declaration order, not significant otherwise. */
export const DEMAND_KEYWORDS = ["type", "items", "required", "min", "max", "minLength", "maxLength", "pattern", "enum", "accept", "format"] as const;

export type DemandKeyword = (typeof DEMAND_KEYWORDS)[number];

const DEMAND_KEYWORD_SET: ReadonlySet<string> = new Set(DEMAND_KEYWORDS);

/** Keywords §9 lists but this milestone does not implement (v0.4 FR-006, FR-011b) — refused as unimplemented, not unknown. */
const UNIMPLEMENTED_DEMAND_KEYWORDS: ReadonlySet<string> = new Set(["accept", "format"]);

/** One raw `demand:` declaration for one key — every keyword present, unvalidated. */
export type RawDemand = ReadonlyMap<string, Node>;

/**
 * Read the `keys:` section of a schema's tree into a map of key name →
 * raw `demand` declaration (every keyword present, verbatim, unvalidated).
 * An absent `keys:`, an empty mapping, a non-mapping `keys:`, a per-key
 * declaration that is not itself a mapping, or a per-key declaration with
 * no `demand` at all, all contribute nothing for that key — mirrors
 * `src/merge/strategy.ts`'s `readKeysVocabulary` exactly (v0.3 FR-003's
 * rule; v0.4 FR-004).
 */
export function readDemandVocabulary(schemaTree: Node): ReadonlyMap<string, RawDemand> {
  const result = new Map<string, RawDemand>();

  if (schemaTree.type !== "mapping") {
    return result;
  }
  const keysNode = schemaTree.entries.get("keys");
  if (keysNode === undefined || keysNode.type !== "mapping") {
    return result;
  }

  for (const [keyName, declarationNode] of keysNode.entries) {
    if (declarationNode.type !== "mapping") {
      continue;
    }
    const demandNode = declarationNode.entries.get("demand");
    if (demandNode === undefined || demandNode.type !== "mapping") {
      // No `demand:` declared for this key (it may still declare
      // provide/cascade/seal/final/delegate, none of which this module
      // reads), or `demand:` itself is not a mapping — nothing to check.
      continue;
    }
    result.set(keyName, demandNode.entries);
  }

  return result;
}

/** Where one raw `demand:` mapping's own document lives, for building `unknown-demand-keyword`-style diagnostics with a real pointer (v0.4 FR-005, FR-022). */
export interface DemandVocabularyProblem {
  readonly diagnostic: Diagnostic;
}

/**
 * Refuse every closed-vocabulary problem in one key's raw `demand`
 * declaration — an unrecognized keyword (`unknown-demand-keyword`), a
 * recognized-but-unimplemented one (`unimplemented-demand-keyword`) — at
 * that keyword's own key-node span, never the value's. Collects every
 * problem in this one declaration rather than stopping at the first
 * (v0.4 FR-017's collect-all discipline, applied at vocabulary-reading
 * granularity — the walk over every key across every layer is
 * `check.ts`'s job).
 *
 * **No `Diagnostic.pointer` (merged-configuration pointer) is set here.**
 * FR-024 requires it for a *violation* — a value at a real position in the
 * merged tree failed a real demand. A vocabulary problem is a mistake in
 * the schema document itself, independent of any config or merged
 * position; inventing one (e.g. the demanded key's own merged pointer,
 * which may not even resolve to anything if no layer ever supplies it)
 * would imply a config-side fact this diagnostic has no basis for. `demand`
 * and `pedigreePosition` are populated, since both are genuinely about the
 * schema document alone.
 */
export function refuseUnknownOrUnimplementedKeywords(keyName: string, layerRank: number, keysPointerPath: readonly (string | number)[], raw: RawDemand): DemandVocabularyProblem[] {
  const problems: DemandVocabularyProblem[] = [];
  for (const [keyword, valueNode] of raw) {
    if (UNIMPLEMENTED_DEMAND_KEYWORDS.has(keyword)) {
      problems.push({
        diagnostic: createDiagnostic({
          code: "unimplemented-demand-keyword",
          message: `key '${keyName}' declares 'demand.${keyword}' — named by SPEC.md §7/§9 but not built until v0.5, when named types exist`,
          primary: valueNode.span,
          demand: { pointer: pointerFromPath([...keysPointerPath, keyName, "demand", keyword]), span: valueNode.span },
          pedigreePosition: layerRank,
        }),
      });
      continue;
    }
    if (!DEMAND_KEYWORD_SET.has(keyword)) {
      problems.push({
        diagnostic: createDiagnostic({
          code: "unknown-demand-keyword",
          message: `key '${keyName}' declares 'demand.${keyword}', which is not one of SPEC.md §9's closed demand keywords`,
          primary: valueNode.span,
          demand: { pointer: pointerFromPath([...keysPointerPath, keyName, "demand", keyword]), span: valueNode.span },
          pedigreePosition: layerRank,
        }),
      });
    }
  }
  return problems;
}

/**
 * A key's own key-node span is not separately captured by
 * `readDemandVocabulary` (only its value is, since `Map` does not carry
 * key spans) — the value's own span is used as the position for "this
 * keyword" throughout this file, and for a keyword the schema wrote at
 * all, the value immediately follows it on the same line in every
 * realistic document. Recorded here rather than left implicit: the
 * alternative considered was re-parsing the schema's own `Node.entries`
 * iteration to recover a key's span, not worth the complexity for a
 * position already within one token of the truth.
 */

/** A top-level `types:` section — refused wholesale as unimplemented (v0.4 FR-011a), naming v0.5. No `Diagnostic.pointer` for the same reason `refuseUnknownOrUnimplementedKeywords` omits it — this is a schema-authoring problem, not a value violation. */
export function refuseTypesSection(layerRank: number, schemaTree: Node): DemandVocabularyProblem | undefined {
  if (schemaTree.type !== "mapping") {
    return undefined;
  }
  const typesNode = schemaTree.entries.get("types");
  if (typesNode === undefined) {
    return undefined;
  }
  return {
    diagnostic: createDiagnostic({
      code: "unimplemented-types-section",
      message: "a top-level 'types:' section is named by SPEC.md §7 but not built until v0.5 — named types do not exist yet",
      primary: typesNode.span,
      demand: { pointer: pointerFromPath(["types"]), span: typesNode.span },
      pedigreePosition: layerRank,
    }),
  };
}
