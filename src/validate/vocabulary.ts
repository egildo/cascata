/**
 * Reading a schema's `demand` vocabulary — SPEC.md §9 ("Schema vocabulary
 * per key: `demand` (`type`, `items`, `required`, `accept`, `keys`, plus
 * JSON-Schema-named leaf constraints: `min`, `max`, `minLength`,
 * `maxLength`, `pattern`, `enum`)..."), amended (§15) for `keys`/`items`
 * nesting to arbitrary depth; v0.4 FR-001 through FR-007, FR-011a,
 * FR-011b; v0.5 FR-021 through FR-025;
 * specs/005-named-types/contracts/nested-demands.md.
 *
 * **v0.5: the demand vocabulary is fully closed *and* fully implemented.**
 * `accept` and `keys` leave `UNIMPLEMENTED_DEMAND_KEYWORDS` (empty as of
 * this milestone) — the last two keywords §9 named but no milestone had
 * yet built. `format` stays outside the vocabulary entirely (v0.4's own
 * §15 amendment) — a schema writing it is `unknown-demand-keyword`, not
 * this file's unimplemented column.
 *
 * `readDemandVocabulary` only **extracts** a schema's top-level
 * `keys.<name>.demand` — one level, as v0.4 left it. Nesting is a
 * property of *checking*, not of this one read: `recursiveVocabularyProblems`
 * below walks a demand mapping's own `items`/`keys` sub-values to
 * whatever depth they nest (FR-023), bounded by `MAX_DEMAND_DEPTH`
 * (FR-025, research.md D4) — the same walk `check.ts`'s value-checking
 * pass performs in parallel, for the same reason: a demand and the value
 * it constrains nest together.
 *
 * `seal`, `final`, and `delegate` stay unread (v0.4 FR-002, unchanged).
 *
 * **Vocabulary problems never look at whether a *value* satisfies a
 * demand** — only whether the demand is well-formed. `constraints.ts`'s
 * leaf checks already treat a malformed value as silently not-applicable,
 * so running both passes unconditionally produces exactly one diagnostic
 * per malformed keyword, never a duplicate (v0.3 FR-028's precedent).
 */

import { createDiagnostic, type Diagnostic } from "../diagnostics/diagnostic.js";
import type { Node } from "../model/node.js";
import { pointerFromPath } from "../model/pointer.js";
import type { Layer } from "../merge/provenance.js";
import { parseTypeExpression, unresolvedAlternatives } from "./typeexpr.js";

/**
 * §9's closed `demand` keyword list (v0.4 FR-005). Order is declaration
 * order, not significant otherwise.
 *
 * **`seal` joins this list in v0.7** (SPEC.md §9/§6.3, amended) — moved
 * here from a per-key sibling of `provide`/`cascade`/`final`/`delegate`,
 * where it started this milestone. `seal` constrains a mapping value's
 * *shape*: it composes by intersection (`open ∩ closed = closed`) and
 * narrows monotonically, exactly like `required`/`type`/every other
 * demand keyword — and unlike `cascade` (merge policy) or `final`
 * (governance, "who may speak"), which stay per-key. The decisive reason
 * (not merely tidiness): a per-key `seal` cannot reach a nested mapping
 * or the inside of a named type's own `demand`, and the meta-schema
 * (specs/008-metaschema-bootstrap) needs both.
 */
export const DEMAND_KEYWORDS = ["type", "items", "required", "min", "max", "minLength", "maxLength", "pattern", "enum", "accept", "keys", "seal"] as const;

export type DemandKeyword = (typeof DEMAND_KEYWORDS)[number];

const DEMAND_KEYWORD_SET: ReadonlySet<string> = new Set(DEMAND_KEYWORDS);

/**
 * Keywords §9 lists but some milestone does not yet implement — refused as
 * unimplemented, not unknown. **Empty as of v0.5**: `accept` (v0.4
 * FR-006/FR-011b) and `keys` (SPEC.md §9's amendment, §15) were the last
 * two, and this milestone implements both (v0.5 User Story 2, User Story
 * 3). Kept as a live `Set` rather than deleted, since a future milestone
 * may add a new keyword that starts in this column the way they did.
 */
const UNIMPLEMENTED_DEMAND_KEYWORDS: ReadonlySet<string> = new Set<string>([]);

/** Nesting bound for `keys`/`items` recursion (v0.5 FR-025, research.md D4) — reused from v0.1's `maxDepth` default, the identical hazard (adversarially deep nesting exhausting the stack), not a new constant. */
export const MAX_DEMAND_DEPTH = 64;

/**
 * The unqualified local name inside a possibly-qualified `type:`
 * alternative (`core/resource` -> `resource`; `resource` -> `resource`
 * unchanged) — `TypeDeclaration.name` and `knownDeclaredNames`
 * (`types.ts`) are always local names, never qualified strings, so any
 * "is this name declared *anywhere* in the pedigree" check must compare
 * against the local part of a qualified reference, not the qualified
 * string itself.
 *
 * **Bug found and fixed while writing v0.5 US4's T036 conformance case**:
 * both `refuseTypeExpressionProblems` below and `check.ts`'s
 * `checkAlternativeReachability` used to test
 * `knownDeclaredNames.has(alt.name)` directly. For a qualified reference
 * like `root/resource`, that string is never a member of
 * `knownDeclaredNames` (which only ever holds `"resource"`), so *every*
 * qualified reference — valid or not — was refused as globally unknown
 * before `resolveTypeName`'s own, correct qualifier-matching logic ever
 * ran. FR-019's "qualification is the way out" of a collision did not
 * work at all until this fix; T036 (a genuinely valid qualified
 * reference) is what caught it, going from an unexpected
 * `unknown-type-name` to the correct outcome.
 */
export function localNameOf(name: string): string {
  const slashIndex = name.indexOf("/");
  return slashIndex === -1 ? name : name.slice(slashIndex + 1);
}

/** One raw `demand:` declaration for one key — every keyword present, unvalidated. */
export type RawDemand = ReadonlyMap<string, Node>;

/**
 * Read the `keys:` section of a schema's tree into a map of key name →
 * raw `demand` declaration (every keyword present, verbatim, unvalidated).
 * An absent `keys:`, an empty mapping, a non-mapping `keys:`, a per-key
 * declaration that is not itself a mapping, or a per-key declaration with
 * no `demand` at all, all contribute nothing for that key — mirrors
 * `src/merge/strategy.ts`'s `readKeysVocabulary` exactly (v0.3 FR-003's
 * rule; v0.4 FR-004). One level only — `readNestedKeysMapping` below is
 * the general form a nested `keys:` demand also uses (v0.5 FR-021).
 */
export function readDemandVocabulary(schemaTree: Node): ReadonlyMap<string, RawDemand> {
  if (schemaTree.type !== "mapping") {
    return new Map();
  }
  const keysNode = schemaTree.entries.get("keys");
  if (keysNode === undefined || keysNode.type !== "mapping") {
    return new Map();
  }
  return readNestedKeysMapping(keysNode);
}

/**
 * The general form: given a `keys:`-shaped mapping node directly (a
 * schema's own top-level one, or a nested `keys` demand's own value —
 * v0.5 FR-021, both share the identical shape, child name → `{ demand:
 * {...} }`), extract each child's raw demand. A child declaration that
 * is not itself a mapping, or that has no `demand:` (or a non-mapping
 * one), contributes nothing for that child.
 */
export function readNestedKeysMapping(keysNode: Node): ReadonlyMap<string, RawDemand> {
  const result = new Map<string, RawDemand>();
  if (keysNode.type !== "mapping") {
    return result;
  }
  for (const [childName, declarationNode] of keysNode.entries) {
    if (declarationNode.type !== "mapping") {
      continue;
    }
    const demandNode = declarationNode.entries.get("demand");
    if (demandNode === undefined || demandNode.type !== "mapping") {
      continue;
    }
    result.set(childName, demandNode.entries);
  }
  return result;
}

/** One vocabulary problem, with its own diagnostic. */
export interface DemandVocabularyProblem {
  readonly diagnostic: Diagnostic;
}

function describePointer(pointerPath: readonly (string | number)[]): string {
  return pointerFromPath(pointerPath);
}

/**
 * Refuse every closed-vocabulary problem in one demand mapping — an
 * unrecognized keyword (`unknown-demand-keyword`), a recognized-but-
 * unimplemented one (`unimplemented-demand-keyword`) — at that keyword's
 * own value span. `demandPointerPath` is the **full** pointer path up to
 * and including this demand mapping itself (e.g. `["keys","tags","demand"]`
 * for a top-level one, or `["keys","tags","demand","keys","host","demand"]`
 * for one nested two levels down) — generalized from v0.4's
 * `(keyName, keysPointerPath)` split so the same function serves any
 * nesting depth (v0.5).
 *
 * **No `Diagnostic.pointer` (merged-configuration pointer) is set here** —
 * a vocabulary problem is a mistake in the schema document itself,
 * independent of any config or merged position (v0.4's own reasoning,
 * unchanged).
 */
export function refuseUnknownOrUnimplementedKeywords(demandPointerPath: readonly (string | number)[], layerRank: number, raw: RawDemand): DemandVocabularyProblem[] {
  const problems: DemandVocabularyProblem[] = [];
  for (const [keyword, valueNode] of raw) {
    if (UNIMPLEMENTED_DEMAND_KEYWORDS.has(keyword)) {
      problems.push({
        diagnostic: createDiagnostic({ level: "error",
          code: "unimplemented-demand-keyword",
          message: `'${describePointer(demandPointerPath)}.${keyword}' — named by SPEC.md §9 but not built until v0.5`,
          primary: valueNode.span,
          demand: { pointer: pointerFromPath([...demandPointerPath, keyword]), span: valueNode.span },
          pedigreePosition: layerRank,
        }),
      });
      continue;
    }
    if (!DEMAND_KEYWORD_SET.has(keyword)) {
      problems.push({
        diagnostic: createDiagnostic({ level: "error",
          code: "unknown-demand-keyword",
          message: `'${describePointer(demandPointerPath)}.${keyword}' is not one of SPEC.md §9's closed demand keywords`,
          primary: valueNode.span,
          demand: { pointer: pointerFromPath([...demandPointerPath, keyword]), span: valueNode.span },
          pedigreePosition: layerRank,
        }),
      });
    }
  }
  return problems;
}

/**
 * Refuse a constraint value of the wrong shape as `malformed-demand-value`
 * (v0.4 FR-007), naming the shape expected. `type` is checked here only
 * for its most basic shape (a string scalar) — the grammar and name
 * resolution are `refuseTypeExpressionProblems`'s job. `accept` and
 * `keys` are real, checked keywords as of v0.5 (see their own `case`s
 * below); `format` is not in `DEMAND_KEYWORDS` at all (SPEC.md §15) and
 * falls to `default` like any other unrecognized keyword.
 */
export function refuseMalformedShapes(demandPointerPath: readonly (string | number)[], layerRank: number, raw: RawDemand): DemandVocabularyProblem[] {
  const problems: DemandVocabularyProblem[] = [];
  function refuse(keyword: string, node: Node, expectedShape: string): void {
    problems.push({
      diagnostic: createDiagnostic({ level: "error",
        code: "malformed-demand-value",
        message: `'${describePointer(demandPointerPath)}.${keyword}' is not ${expectedShape}`,
        primary: node.span,
        demand: { pointer: pointerFromPath([...demandPointerPath, keyword]), span: node.span },
        pedigreePosition: layerRank,
      }),
    });
  }
  for (const [keyword, node] of raw) {
    switch (keyword) {
      case "type":
        if (!(node.type === "scalar" && node.kind === "string")) {
          refuse(keyword, node, "a string");
        }
        break;
      case "required":
        if (!(node.type === "scalar" && node.kind === "bool")) {
          refuse(keyword, node, "a boolean");
        }
        break;
      case "min":
      case "max":
        if (!(node.type === "scalar" && (node.kind === "int" || node.kind === "float"))) {
          refuse(keyword, node, "a number");
        }
        break;
      case "minLength":
      case "maxLength":
        if (!(node.type === "scalar" && node.kind === "int")) {
          refuse(keyword, node, "an integer");
        }
        break;
      case "pattern":
        if (!(node.type === "scalar" && node.kind === "string")) {
          refuse(keyword, node, "a string");
          break;
        }
        try {
          new RegExp(node.value, "u");
        } catch {
          refuse(keyword, node, "a valid ECMA-262 regular expression");
        }
        break;
      case "enum":
        if (node.type !== "sequence") {
          refuse(keyword, node, "a sequence");
        }
        break;
      case "items":
        if (node.type !== "mapping") {
          refuse(keyword, node, "a mapping");
        }
        break;
      case "keys":
        // v0.5 FR-021: keys' own shape mirrors a schema's top-level
        // `keys:` section — a mapping of child name -> { demand: {...} }
        // — so the basic shape check is the same "must be a mapping" as
        // `items`; each child's own `.demand` sub-shape is checked by the
        // recursive walk below, not here.
        if (node.type !== "mapping") {
          refuse(keyword, node, "a mapping");
        }
        break;
      case "accept":
        // v0.5 FR-011/FR-012: a usage's accept is a sequence of type-name
        // strings, the same shape a type declaration's own `accept` uses
        // (src/validate/types.ts).
        if (node.type !== "sequence" || !node.items.every((item) => item.type === "scalar" && item.kind === "string")) {
          refuse(keyword, node, "a sequence of strings");
        }
        break;
      case "seal":
        // v0.7, SPEC.md §6.3/§9 amended: 'open' or 'closed', the identical
        // two-value domain the (retired) per-key `unknown-seal-value` code
        // used to police — now folded into this file's own
        // malformed-demand-value posture, matching every other demand
        // keyword's shape check.
        if (!(node.type === "scalar" && node.kind === "string" && (node.value === "open" || node.value === "closed"))) {
          refuse(keyword, node, "'open' or 'closed'");
        }
        break;
      default:
        break; // unknown/unimplemented keywords are the other function's job.
    }
  }
  return problems;
}

/**
 * Wire `typeexpr.ts`'s own parse/resolution failures to diagnostics (v0.4
 * FR-009, FR-012). Only reached for a `type` value that is already a
 * string scalar — `refuseMalformedShapes` refuses anything else. As of
 * v0.5, "resolution" beyond a name being a syntactically-known built-in
 * or grammatically well-formed name is `check.ts`'s job (it needs a
 * layer's own type scope, which this file does not have) — this function
 * still catches a name that resolves against **neither** the built-in
 * set **nor any declared type anywhere in the pedigree**, since that is
 * unresolvable regardless of scope; a name reachable only via scope
 * (declared, but not by an ancestor of the usage layer) is caught later,
 * in `check.ts`, where scope is available.
 */
export function refuseTypeExpressionProblems(demandPointerPath: readonly (string | number)[], layerRank: number, raw: RawDemand, knownDeclaredNames: ReadonlySet<string>): DemandVocabularyProblem[] {
  const typeNode = raw.get("type");
  if (typeNode === undefined || typeNode.type !== "scalar" || typeNode.kind !== "string") {
    return [];
  }
  const pointer = pointerFromPath([...demandPointerPath, "type"]);
  const parsed = parseTypeExpression(typeNode.value);
  if (!parsed.ok) {
    return [
      {
        diagnostic: createDiagnostic({ level: "error",
          code: "malformed-type-expression",
          message: `'${describePointer(demandPointerPath)}.type: ${typeNode.value}' does not parse under SPEC.md §9.1's grammar: ${parsed.reason}`,
          primary: typeNode.span,
          demand: { pointer, span: typeNode.span },
          pedigreePosition: layerRank,
        }),
      },
    ];
  }
  const unresolved = unresolvedAlternatives(parsed.value).filter((alt) => !knownDeclaredNames.has(localNameOf(alt.name)));
  if (unresolved.length > 0) {
    const names = [...new Set(unresolved.map((alt) => alt.name))].join(", ");
    return [
      {
        diagnostic: createDiagnostic({ level: "error",
          code: "unknown-type-name",
          message: `'${describePointer(demandPointerPath)}.type: ${typeNode.value}' names an unresolvable type (${names})`,
          primary: typeNode.span,
          demand: { pointer, span: typeNode.span },
          pedigreePosition: layerRank,
        }),
      },
    ];
  }
  return [];
}

function depthLimitProblem(node: Node, layerRank: number, pointerPath: readonly (string | number)[]): DemandVocabularyProblem {
  return {
    diagnostic: createDiagnostic({ level: "error",
      code: "depth-limit-exceeded",
      message: `nested demand at '${describePointer(pointerPath)}' exceeds the ${MAX_DEMAND_DEPTH}-level limit (v0.5 FR-025)`,
      primary: node.span,
      demand: { pointer: pointerFromPath(pointerPath), span: node.span },
      pedigreePosition: layerRank,
    }),
  };
}

/**
 * Recursively find every vocabulary problem in one demand mapping,
 * descending into `items`/`keys` to whatever depth they nest (v0.5
 * FR-023), bounded by `MAX_DEMAND_DEPTH` (FR-025). `demandPointerPath` is
 * the full pointer path up to and including `raw` itself; `depth` is the
 * nesting level `raw` sits at (0 for a top-level key's own demand).
 */
export function recursiveVocabularyProblems(raw: RawDemand, layerRank: number, demandPointerPath: readonly (string | number)[], depth: number, knownDeclaredNames: ReadonlySet<string>): readonly DemandVocabularyProblem[] {
  const problems: DemandVocabularyProblem[] = [
    ...refuseUnknownOrUnimplementedKeywords(demandPointerPath, layerRank, raw),
    ...refuseMalformedShapes(demandPointerPath, layerRank, raw),
    ...refuseTypeExpressionProblems(demandPointerPath, layerRank, raw, knownDeclaredNames),
  ];

  const itemsNode = raw.get("items");
  if (itemsNode !== undefined && itemsNode.type === "mapping") {
    const nextPath = [...demandPointerPath, "items"];
    if (depth + 1 > MAX_DEMAND_DEPTH) {
      problems.push(depthLimitProblem(itemsNode, layerRank, nextPath));
    } else {
      problems.push(...recursiveVocabularyProblems(itemsNode.entries, layerRank, nextPath, depth + 1, knownDeclaredNames));
    }
  }

  const keysNode = raw.get("keys");
  if (keysNode !== undefined && keysNode.type === "mapping") {
    if (depth + 1 > MAX_DEMAND_DEPTH) {
      problems.push(depthLimitProblem(keysNode, layerRank, [...demandPointerPath, "keys"]));
    } else {
      const nested = readNestedKeysMapping(keysNode);
      for (const [childName, childRaw] of nested) {
        problems.push(...recursiveVocabularyProblems(childRaw, layerRank, [...demandPointerPath, "keys", childName, "demand"], depth + 1, knownDeclaredNames));
      }
    }
  }

  return problems;
}

/**
 * Every closed-vocabulary problem in one schema layer's own top-level
 * `keys.<name>.demand` declarations, recursively (v0.5 FR-017's
 * collect-all discipline applied across the whole layer, at every
 * nesting depth). `layer.role !== "schema"` contributes nothing (FR-003).
 * The `types:` section itself is `src/validate/types.ts`'s job, not this
 * function's — it is validated once per pedigree there, not per key here.
 */
export function vocabularyProblemsForLayer(layer: Layer, knownDeclaredNames: ReadonlySet<string>): Diagnostic[] {
  if (layer.role !== "schema") {
    return [];
  }
  const problems: Diagnostic[] = [];
  const vocabulary = readDemandVocabulary(layer.tree);
  for (const [keyName, raw] of vocabulary) {
    for (const problem of recursiveVocabularyProblems(raw, layer.rank, ["keys", keyName, "demand"], 0, knownDeclaredNames)) {
      problems.push(problem.diagnostic);
    }
  }
  return problems;
}
