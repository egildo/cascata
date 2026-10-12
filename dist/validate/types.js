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
 * (FR-019a, extended by the same reasoning) are kept as reserved stubs —
 * names, signatures and codes, returning no diagnostic — for the
 * multi-adoption future, and are **structurally unreachable in v1**: `declarations` and `configuration.layers` can
 * only ever hold layers from one chain, so there is no way, at this
 * milestone, to construct two "unrelated" declarations for either
 * function to find. See each function's own doc comment — the lesson
 * this milestone's own depth-limit guard already taught once (a guard
 * identical in shape to a real one, but never reachable from any input
 * the surrounding pipeline can produce) applies here too, and must not
 * be repeated silently.
 */
import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { pointerFromPath } from "../model/pointer.js";
import { BUILTIN_TYPE_NAMES, parseTypeExpression } from "./typeexpr.js";
import { extend } from "../extend.js";
const BUILTIN_TYPE_NAME_SET = new Set(BUILTIN_TYPE_NAMES);
/** research.md D5: a document's qualifier is the last non-empty `/`-segment of its `$id`; `undefined` if it has none (absent `$id`, or one that yields no segments — FR-019b). Probed against non-ASCII, boundary, and adversarial input before being written down. */
export function qualifierOf(idValue) {
    const segments = idValue.split("/").filter((segment) => segment.length > 0);
    return segments.length > 0 ? segments[segments.length - 1] : undefined;
}
/** `layer`'s own `$id` value, if it declares one and it is a string scalar. */
function idNodeOf(layer) {
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
export function qualifierOfLayer(layer) {
    const idNode = idNodeOf(layer);
    if (idNode === undefined || idNode.type !== "scalar" || idNode.kind !== "string") {
        return undefined;
    }
    return qualifierOf(idNode.value);
}
/** A type entry's own closed vocabulary (FR-002): exactly `demand` and `accept`. */
const TYPE_ENTRY_KEYWORDS = new Set(["demand", "accept"]);
function refuse(code, message, primary, pointer, layerRank) {
    return {
        diagnostic: createDiagnostic({ level: "error",
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
export function readTypeDeclarations(layer) {
    const declarations = [];
    const problems = [];
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
        let demand = new Map();
        if (demandNode !== undefined) {
            if (demandNode.type !== "mapping") {
                problems.push(refuse("malformed-demand-value", `type '${name}' declares 'demand' with a value that is not a mapping`, demandNode.span, pointerFromPath(["types", name, "demand"]), layer.rank));
            }
            else {
                demand = demandNode.entries;
            }
        }
        const acceptNode = entryNode.entries.get("accept");
        let accept;
        if (acceptNode !== undefined) {
            if (acceptNode.type !== "sequence" || !acceptNode.items.every((item) => item.type === "scalar" && item.kind === "string")) {
                problems.push(refuse("malformed-demand-value", `type '${name}' declares 'accept' with a value that is not a sequence of strings`, acceptNode.span, pointerFromPath(["types", name, "accept"]), layer.rank));
            }
            else {
                accept = acceptNode.items.flatMap((item) => (item.type === "scalar" && item.kind === "string" ? [item.value] : []));
            }
        }
        declarations.push({ name, demand, accept, layer, layerRank: layer.rank, pointer: pointerFromPath(["types", name]), span: entryNode.span });
    }
    return { declarations, problems };
}
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
export function declarationsOfLayers(layers) {
    const all = [];
    for (const layer of layers) {
        extend(all, readTypeDeclarations(layer).declarations);
    }
    return all;
}
/** Every `TypeDeclaration` reachable anywhere in the pedigree, root to leaf, in layer-rank order (deterministic — FR-010). */
export function allDeclarations(configuration) {
    return declarationsOfLayers(configuration.layers);
}
/**
 * Every closed-vocabulary/shape problem found reading every layer's own `types:` section. Exported since v0.5
 * and called from nowhere until v1.12.1 (SPEC.md §15), so these refusals were catalogued and never raised.
 */
export function typeVocabularyProblems(layers) {
    const problems = [];
    for (const layer of layers) {
        for (const problem of readTypeDeclarations(layer).problems) {
            problems.push(problem.diagnostic);
        }
    }
    return problems;
}
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
export function collisionDiagnostics(declarations) {
    void declarations;
    return [];
}
/** FR-018: a schema declaring a type whose name is one of the built-ins. Checked independently of multi-layer collision — a single schema alone naming a type `string` collides against the built-in "declaration". */
export function builtinCollisionDiagnostics(declarations) {
    return declarations
        .filter((decl) => BUILTIN_TYPE_NAME_SET.has(decl.name))
        .map((decl) => createDiagnostic({ level: "error",
        code: "builtin-type-redeclared",
        message: `type '${decl.name}' redeclares a built-in type name — the built-in namespace is not open for redefinition (SPEC.md §7)`,
        primary: decl.span,
        demand: { pointer: decl.pointer, span: decl.span },
        pedigreePosition: decl.layerRank,
    }));
}
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
export function qualifierCollisionDiagnostics(layers) {
    void layers;
    return [];
}
/**
 * Among `candidates`, the **nearest** one reachable from `usageLayerRank`
 * (FR-016, FR-008): the greatest `layerRank` at or below the usage's own
 * — i.e. the most-recently-narrowing declaration the usage can see.
 * `undefined` if none is reachable at all. Two candidates can never tie
 * on `layerRank` in v1: `configuration.layers` has exactly one layer per
 * rank (a chain, §6.1), and one layer's own `types:` mapping cannot
 * declare the same name twice (a YAML document cannot have a duplicate
 * key at all — refused at parse time, §4.2 — long before this file ever
 * sees it).
 */
function nearestReachable(candidates, usageLayerRank) {
    let nearest;
    for (const decl of candidates) {
        if (decl.layerRank > usageLayerRank) {
            continue;
        }
        if (nearest === undefined || decl.layerRank > nearest.layerRank) {
            nearest = decl;
        }
    }
    return nearest;
}
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
export function resolveTypeName(name, usageLayerRank, declarations) {
    const slashIndex = name.indexOf("/");
    if (slashIndex === -1) {
        if (BUILTIN_TYPE_NAME_SET.has(name)) {
            return name;
        }
        return nearestReachable(declarations.filter((decl) => decl.name === name), usageLayerRank);
    }
    // Qualified: <qualifier>/<localName> (FR-019). Nearest-wins here too
    // (FR-019a's own doc comment above): a shared qualifier plus a shared
    // local name is FR-016a's narrowing chain restated in the qualified
    // namespace, not a second ambiguity to refuse.
    const qualifier = name.slice(0, slashIndex);
    const localName = name.slice(slashIndex + 1);
    return nearestReachable(declarations.filter((decl) => decl.name === localName && qualifierOfLayer(decl.layer) === qualifier), usageLayerRank);
}
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
export function cycleDiagnostics(declarations) {
    const byName = new Map();
    for (const decl of declarations) {
        if (!byName.has(decl.name)) {
            byName.set(decl.name, decl);
        }
    }
    function referencedNames(decl) {
        const names = [];
        const typeNode = decl.demand.get("type");
        if (typeNode !== undefined && typeNode.type === "scalar" && typeNode.kind === "string") {
            const parsed = parseTypeExpression(typeNode.value);
            if (parsed.ok) {
                extend(names, parsed.value.alternatives.map((alt) => alt.name));
            }
        }
        if (decl.accept !== undefined) {
            extend(names, decl.accept);
        }
        return names;
    }
    const diagnostics = [];
    const globallyCleared = new Set();
    for (const start of declarations) {
        if (globallyCleared.has(start.name)) {
            continue;
        }
        const stack = [];
        const onStack = new Set();
        let cycleFound = false;
        function visit(current) {
            if (cycleFound) {
                return;
            }
            if (onStack.has(current.name)) {
                diagnostics.push(createDiagnostic({ level: "error",
                    code: "unresolvable-type-cycle",
                    message: `type '${current.name}' is reachable from itself through: ${[...stack, current.name].join(" -> ")} (SPEC.md §7, v0.5 FR-009)`,
                    primary: current.span,
                    demand: { pointer: current.pointer, span: current.span },
                    pedigreePosition: current.layerRank,
                }));
                cycleFound = true;
                // Mark every name actually *in* the cycle (from where it closes
                // back to `current.name`, through to the top of the stack) as
                // globally cleared — not just `current.name` — so a later `start`
                // elsewhere in `declarations` does not re-discover and re-report
                // the identical cycle from a different entry point. Without this,
                // a two-node cycle a->b->a is reported twice: once starting from
                // `a` ("a -> b -> a") and once from `b` ("b -> a -> b") — the same
                // cycle, not two independent ones (v0.5 FR-031's collect-all is
                // about independent failures, not restatements of one).
                const cycleStart = stack.indexOf(current.name);
                for (const name of stack.slice(cycleStart)) {
                    globallyCleared.add(name);
                }
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
//# sourceMappingURL=types.js.map