/**
 * Named types — SPEC.md §7 (Article IV), §9.1; v0.5 FR-001 through
 * FR-020; specs/005-named-types/contracts/type-resolution.md.
 *
 * **research.md D1 is load-bearing for this whole file.** Collision is
 * unconditional: two or more schema layers declaring a type under the
 * same unqualified name always collide, including when the later
 * declaration would, read alone, look like a legitimate narrowing of the
 * earlier one. There is no mechanism here for "a descendant redeclares an
 * inherited type to narrow it" — narrowing is `accept` at the point of
 * use only (`src/validate/constraints.ts`). This follows spec.md §5.2's
 * own unconditional "Widen or redefine: Never" cell for the named-types
 * row and User Story 4's own unconditional collision Acceptance
 * Scenarios, over §7's more discursive "descendants may narrow inherited
 * types" prose — see research.md D1 for the full argument and for why
 * this makes the coordinating brief's own suggested FR-008 sabotage
 * ("a descendant redefines a type") unconstructible as a green-path case.
 *
 * Given collision makes an unqualified name globally unique (or entirely
 * unresolvable, if it collided), `resolveTypeName` below does not need to
 * *choose* among candidates — a layer's own "scope" (FR-008) only ever
 * has at most one non-built-in candidate to find. What scope actually
 * governs is *reachability*: a layer ranked before a type's declaring
 * layer cannot resolve it at all (research.md D2) — the property this
 * milestone's most important sabotage targets.
 */

import { createDiagnostic, type Diagnostic } from "../diagnostics/diagnostic.js";
import type { Node } from "../model/node.js";
import { pointerFromPath } from "../model/pointer.js";
import type { Layer, MergedConfiguration } from "../merge/provenance.js";
import { compareByCodePoint } from "../model/node.js";
import { BUILTIN_TYPE_NAMES, parseTypeExpression, type BuiltinTypeName } from "./typeexpr.js";
import type { RawDemand } from "./vocabulary.js";

const BUILTIN_TYPE_NAME_SET: ReadonlySet<string> = new Set(BUILTIN_TYPE_NAMES);

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
export function qualifierOf(idValue: string): string | undefined {
  const segments = idValue.split("/").filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : undefined;
}

/** `layer`'s own `$id` value, if it declares one and it is a string scalar. */
function idNodeOf(layer: Layer): Node | undefined {
  if (layer.tree.type !== "mapping") {
    return undefined;
  }
  const idNode = layer.tree.entries.get("$id");
  if (idNode === undefined || idNode.type !== "scalar" || idNode.kind !== "string") {
    return undefined;
  }
  return idNode;
}

/** `layer`'s own qualifier, if it has a usable `$id` (research.md D5). No assertion cast: `idNode.type`/`idNode.kind` are re-checked here (not inferred across `idNodeOf`'s own return boundary), so TypeScript narrows `idNode.value` to `string` structurally rather than this file asserting it (constitution: "No assertion casts on the node model"). */
export function qualifierOfLayer(layer: Layer): string | undefined {
  const idNode = idNodeOf(layer);
  if (idNode === undefined || idNode.type !== "scalar" || idNode.kind !== "string") {
    return undefined;
  }
  return qualifierOf(idNode.value);
}

/** One problem found reading one layer's own `types:` section vocabulary — mirrors `vocabulary.ts`'s `DemandVocabularyProblem`. */
export interface TypeVocabularyProblem {
  readonly diagnostic: Diagnostic;
}

/** A type entry's own closed vocabulary (FR-002): exactly `demand` and `accept`. */
const TYPE_ENTRY_KEYWORDS: ReadonlySet<string> = new Set(["demand", "accept"]);

function refuse(code: "unknown-type-entry-keyword" | "malformed-demand-value", message: string, primary: Node["span"], pointer: string, layerRank: number): TypeVocabularyProblem {
  return {
    diagnostic: createDiagnostic({
      code,
      message,
      primary,
      demand: { pointer, span: primary },
      pedigreePosition: layerRank,
    }),
  };
}

/**
 * Read one schema layer's `types:` section into raw `TypeDeclaration`s,
 * plus any closed-vocabulary/shape problems found along the way
 * (FR-001–FR-003). Mirrors `vocabulary.ts`'s `readDemandVocabulary`
 * reading style: absent, empty, or non-mapping `types:` contributes
 * nothing, never an error.
 */
export function readTypeDeclarations(layer: Layer): { readonly declarations: readonly TypeDeclaration[]; readonly problems: readonly TypeVocabularyProblem[] } {
  const declarations: TypeDeclaration[] = [];
  const problems: TypeVocabularyProblem[] = [];
  if (layer.role !== "schema" || layer.tree.type !== "mapping") {
    return { declarations, problems };
  }
  const typesNode = layer.tree.entries.get("types");
  if (typesNode === undefined || typesNode.type !== "mapping") {
    return { declarations, problems };
  }
  for (const [name, entryNode] of typesNode.entries) {
    if (entryNode.type !== "mapping") {
      // A type entry that isn't a mapping at all has nothing to read —
      // same "not a mapping -> nothing" posture v0.3/v0.4 use throughout.
      continue;
    }
    for (const [keyword, valueNode] of entryNode.entries) {
      if (!TYPE_ENTRY_KEYWORDS.has(keyword)) {
        problems.push(refuse("unknown-type-entry-keyword", `type '${name}' declares '${keyword}', which is not one of §7's closed type-entry keywords (demand, accept)`, valueNode.span, pointerFromPath(["types", name, keyword]), layer.rank));
      }
    }
    const demandNode = entryNode.entries.get("demand");
    let demand: RawDemand = new Map();
    if (demandNode !== undefined) {
      if (demandNode.type !== "mapping") {
        problems.push(refuse("malformed-demand-value", `type '${name}' declares 'demand' with a value that is not a mapping`, demandNode.span, pointerFromPath(["types", name, "demand"]), layer.rank));
      } else {
        demand = demandNode.entries;
      }
    }
    const acceptNode = entryNode.entries.get("accept");
    let accept: readonly string[] | undefined;
    if (acceptNode !== undefined) {
      if (acceptNode.type !== "sequence" || !acceptNode.items.every((item) => item.type === "scalar" && item.kind === "string")) {
        problems.push(refuse("malformed-demand-value", `type '${name}' declares 'accept' with a value that is not a sequence of strings`, acceptNode.span, pointerFromPath(["types", name, "accept"]), layer.rank));
      } else {
        accept = acceptNode.items.flatMap((item) => (item.type === "scalar" && item.kind === "string" ? [item.value] : []));
      }
    }
    declarations.push({ name, demand, accept, layer, layerRank: layer.rank, pointer: pointerFromPath(["types", name]), span: entryNode.span });
  }
  return { declarations, problems };
}

/** Every `TypeDeclaration` reachable anywhere in the pedigree, root to leaf, in layer-rank order (deterministic — FR-010). */
export function allDeclarations(configuration: MergedConfiguration): readonly TypeDeclaration[] {
  const all: TypeDeclaration[] = [];
  for (const layer of configuration.layers) {
    all.push(...readTypeDeclarations(layer).declarations);
  }
  return all;
}

/** Every closed-vocabulary/shape problem found reading every layer's own `types:` section. */
export function allTypeVocabularyProblems(configuration: MergedConfiguration): readonly Diagnostic[] {
  const problems: Diagnostic[] = [];
  for (const layer of configuration.layers) {
    for (const problem of readTypeDeclarations(layer).problems) {
      problems.push(problem.diagnostic);
    }
  }
  return problems;
}

/**
 * Unconditional collision detection (FR-017, research.md D1): group
 * `declarations` by unqualified name; two or more for the same name
 * collide. Mirrors v0.1's duplicate-key precedent — the diagnostic
 * anchors to each declaration beyond the first (sorted by rank, so the
 * report is deterministic), naming the very first as `related`.
 */
export function collisionDiagnostics(declarations: readonly TypeDeclaration[]): readonly Diagnostic[] {
  const byName = new Map<string, TypeDeclaration[]>();
  for (const decl of declarations) {
    const group = byName.get(decl.name);
    if (group === undefined) {
      byName.set(decl.name, [decl]);
    } else {
      group.push(decl);
    }
  }
  const diagnostics: Diagnostic[] = [];
  for (const [name, group] of [...byName.entries()].sort((a, b) => compareByCodePoint(a[0], b[0]))) {
    if (group.length < 2) {
      continue;
    }
    const sorted = [...group].sort((a, b) => a.layerRank - b.layerRank);
    const first = sorted[0];
    if (first === undefined) {
      continue;
    }
    for (const later of sorted.slice(1)) {
      diagnostics.push(
        createDiagnostic({
          code: "type-name-collision",
          message: `type '${name}' is declared by more than one layer in the pedigree — every declaration but the first is a collision (SPEC.md §7, §15)`,
          primary: later.span,
          related: [{ label: "first declared", span: first.span }],
          demand: { pointer: later.pointer, span: later.span },
          pedigreePosition: later.layerRank,
        }),
      );
    }
  }
  return diagnostics;
}

/** FR-018: a schema declaring a type whose name is one of the built-ins. Checked independently of multi-layer collision — a single schema alone naming a type `string` collides against the built-in "declaration". */
export function builtinCollisionDiagnostics(declarations: readonly TypeDeclaration[]): readonly Diagnostic[] {
  return declarations
    .filter((decl) => BUILTIN_TYPE_NAME_SET.has(decl.name))
    .map((decl) =>
      createDiagnostic({
        code: "builtin-type-redeclared",
        message: `type '${decl.name}' redeclares a built-in type name — the built-in namespace is not open for redefinition (SPEC.md §7)`,
        primary: decl.span,
        demand: { pointer: decl.pointer, span: decl.span },
        pedigreePosition: decl.layerRank,
      }),
    );
}

/** FR-019a: two documents in one pedigree whose qualifiers (research.md D5) match. Independent of the unqualified-name namespace. */
export function qualifierCollisionDiagnostics(configuration: MergedConfiguration): readonly Diagnostic[] {
  const byQualifier = new Map<string, Layer[]>();
  for (const layer of configuration.layers) {
    if (layer.role !== "schema") {
      continue;
    }
    const qualifier = qualifierOfLayer(layer);
    if (qualifier === undefined) {
      continue;
    }
    const group = byQualifier.get(qualifier);
    if (group === undefined) {
      byQualifier.set(qualifier, [layer]);
    } else {
      group.push(layer);
    }
  }
  const diagnostics: Diagnostic[] = [];
  for (const [qualifier, group] of [...byQualifier.entries()].sort((a, b) => compareByCodePoint(a[0], b[0]))) {
    if (group.length < 2) {
      continue;
    }
    const sorted = [...group].sort((a, b) => a.rank - b.rank);
    const first = sorted[0];
    if (first === undefined) {
      continue;
    }
    const firstId = idNodeOf(first);
    if (firstId === undefined) {
      continue; // unreachable: qualifierOfLayer already required an id node.
    }
    for (const later of sorted.slice(1)) {
      const laterId = idNodeOf(later);
      if (laterId === undefined) {
        continue;
      }
      diagnostics.push(
        createDiagnostic({
          code: "type-qualifier-collision",
          message: `document's '$id' ends in the same qualifier ('${qualifier}') as an earlier layer's — the escape hatch needs its own escape hatch to be an error, not a coin toss (SPEC.md §7, v0.5 FR-019a)`,
          primary: laterId.span,
          related: [{ label: "first declared", span: firstId.span }],
          pedigreePosition: later.rank,
        }),
      );
    }
  }
  return diagnostics;
}

/** The set of unqualified names that collide anywhere in the pedigree (research.md D1) — unresolvable everywhere, since which declaration is "right" is exactly what the collision refuses to guess. */
function collidingNames(declarations: readonly TypeDeclaration[]): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const decl of declarations) {
    counts.set(decl.name, (counts.get(decl.name) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name));
}

/**
 * Resolve one name (built-in, unqualified, or qualified) from `usageLayerRank`'s
 * own scope (FR-008, research.md D2): declarations from layers `0..usageLayerRank`
 * plus the built-in set. A colliding unqualified name, or a name only a
 * later (descendant) layer declares, is unresolvable — `undefined`.
 */
export function resolveTypeName(name: string, usageLayerRank: number, declarations: readonly TypeDeclaration[]): TypeDeclaration | BuiltinTypeName | undefined {
  const slashIndex = name.indexOf("/");
  if (slashIndex === -1) {
    if (BUILTIN_TYPE_NAME_SET.has(name)) {
      return name as BuiltinTypeName;
    }
    if (collidingNames(declarations).has(name)) {
      return undefined;
    }
    const reachable = declarations.filter((decl) => decl.name === name && decl.layerRank <= usageLayerRank);
    return reachable.length === 1 ? reachable[0] : undefined;
  }
  // Qualified: <qualifier>/<localName> (FR-019).
  const qualifier = name.slice(0, slashIndex);
  const localName = name.slice(slashIndex + 1);
  const reachableQualifying = declarations.filter((decl) => decl.layerRank <= usageLayerRank && decl.name === localName && qualifierOfLayer(decl.layer) === qualifier);
  return reachableQualifying.length === 1 ? reachableQualifying[0] : undefined;
}

/**
 * FR-009: refuse a cycle among type definitions rather than follow it.
 * Walks each declaration's own `demand.type` and `accept` alternatives —
 * the two places a type can name another type — resolved from that
 * declaration's own layer scope (a type's own references resolve in its
 * own declaring context, same as any other usage). Nested `keys`/`items`
 * type references are not walked for cycle detection: no Acceptance
 * Scenario exercises a cycle reachable only through nested structure, and
 * walking arbitrary nesting here would duplicate `check.ts`'s own
 * recursive walk for a case not required to work end-to-end — recorded
 * as a scope decision, not a citation gap.
 */
export function cycleDiagnostics(declarations: readonly TypeDeclaration[]): readonly Diagnostic[] {
  const byName = new Map<string, TypeDeclaration>();
  for (const decl of declarations) {
    if (!byName.has(decl.name)) {
      byName.set(decl.name, decl);
    }
  }

  function referencedNames(decl: TypeDeclaration): readonly string[] {
    const names: string[] = [];
    const typeNode = decl.demand.get("type");
    if (typeNode !== undefined && typeNode.type === "scalar" && typeNode.kind === "string") {
      const parsed = parseTypeExpression(typeNode.value);
      if (parsed.ok) {
        names.push(...parsed.value.alternatives.map((alt) => alt.name));
      }
    }
    if (decl.accept !== undefined) {
      names.push(...decl.accept);
    }
    return names;
  }

  const diagnostics: Diagnostic[] = [];
  const globallyCleared = new Set<string>();

  for (const start of declarations) {
    if (globallyCleared.has(start.name)) {
      continue;
    }
    const stack: string[] = [];
    const onStack = new Set<string>();
    let cycleFound = false;

    function visit(current: TypeDeclaration): void {
      if (cycleFound) {
        return;
      }
      if (onStack.has(current.name)) {
        diagnostics.push(
          createDiagnostic({
            code: "unresolvable-type-cycle",
            message: `type '${current.name}' is reachable from itself through: ${[...stack, current.name].join(" -> ")} (SPEC.md §7, v0.5 FR-009)`,
            primary: current.span,
            demand: { pointer: current.pointer, span: current.span },
            pedigreePosition: current.layerRank,
          }),
        );
        cycleFound = true;
        return;
      }
      stack.push(current.name);
      onStack.add(current.name);
      for (const refName of referencedNames(current)) {
        const next = byName.get(refName);
        if (next !== undefined) {
          visit(next);
          if (cycleFound) {
            break;
          }
        }
      }
      onStack.delete(current.name);
      stack.pop();
      if (!cycleFound) {
        globallyCleared.add(current.name);
      }
    }

    visit(start);
  }

  return diagnostics;
}
