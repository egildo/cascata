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
import { pointerFromPath, resolvePointer } from "../model/pointer.js";
import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { readDemandVocabulary, readNestedKeysMapping, recursiveVocabularyProblems, vocabularyProblemsForLayer, localNameOf, MAX_DEMAND_DEPTH } from "./vocabulary.js";
import { checkEnum, checkMax, checkMaxLength, checkMin, checkMinLength, checkPattern, requiredViolationCause } from "./constraints.js";
import { dedupeViolations, renderViolation } from "./violation.js";
import { allDeclarations, typeVocabularyProblems, builtinCollisionDiagnostics, collisionDiagnostics, cycleDiagnostics, declarationsOfLayers, qualifierCollisionDiagnostics, resolveTypeName } from "./types.js";
import { parseTypeExpression } from "./typeexpr.js";
import { readDirectives, reservedKeyValue } from "./directives.js";
import { extend } from "../extend.js";
/** Non-recursive, single-value-in/sites-out leaf keywords. `required` is a post-merge absence check (handled separately); `items`/`keys` recurse; `type`/`accept` are handled together by the type-resolution machinery below. */
const SIMPLE_LEAF_KEYWORDS = new Set(["min", "max", "minLength", "maxLength", "pattern", "enum"]);
function runSimpleLeafCheck(keyword, keywordValue, target) {
    switch (keyword) {
        case "min":
            return checkMin(keywordValue, target);
        case "max":
            return checkMax(keywordValue, target);
        case "minLength":
            return checkMinLength(keywordValue, target);
        case "maxLength":
            return checkMaxLength(keywordValue, target);
        case "pattern":
            return checkPattern(keywordValue, target);
        case "enum":
            return checkEnum(keywordValue, target);
        default:
            return [];
    }
}
function siteAt(base, declaring, declaringSpan) {
    return { pointerSuffix: base.pointerSuffix, node: base.node, reason: base.reason, declaring, declaringSpan };
}
function mismatchSite(value, expectedDescription, declaring, declaringSpan) {
    return { pointerSuffix: [], node: value, reason: { kind: "type-mismatch", expectedDescription, actualDescription: describeActual(value) }, declaring, declaringSpan };
}
// --- Type-expression matching, with named-type resolution (v0.5) ----------
function describeAlternative(alt) {
    return alt.depth === 0 ? alt.name : `${alt.name}${"[]".repeat(alt.depth)}`;
}
function describeExpression(expr) {
    return expr.alternatives.map(describeAlternative).join(" | ");
}
function describeActual(node) {
    return node.type === "scalar" ? `a ${node.kind} scalar` : `a ${node.type}`;
}
/** Exported for `src/validate/resource.ts` (v0.7 US6) — the identical predicate this file's own `url` built-in type check already uses; kept as one definition rather than a second copy. */
export function isValidUrl(value) {
    try {
        new URL(value);
        return true;
    }
    catch {
        return false;
    }
}
/** Exported for `src/validate/resource.ts` (v0.7 US6) — see `isValidUrl`'s own doc. */
export function isValidPath(value) {
    return value.length > 0 && !value.includes(" ");
}
function matchesBuiltinLeaf(node, name) {
    switch (name) {
        case "string":
            return node.type === "scalar" && node.kind === "string";
        case "int":
            return node.type === "scalar" && node.kind === "int";
        case "float":
            return node.type === "scalar" && node.kind === "float";
        case "bool":
            return node.type === "scalar" && node.kind === "bool";
        case "null":
            return node.type === "scalar" && node.kind === "null";
        case "mapping":
            return node.type === "mapping";
        case "sequence":
            return node.type === "sequence";
        case "url":
            return node.type === "scalar" && node.kind === "string" && isValidUrl(node.value);
        case "path":
            return node.type === "scalar" && node.kind === "string" && isValidPath(node.value);
        default:
            return false;
    }
}
/**
 * Check `value` against one resolved named type (v0.5 FR-007, FR-008,
 * research.md D3): the type's own `demand`, in **the type's own
 * declaring layer's scope** — never the usage's — and, if the type
 * declares `accept` (narrowed by `usageAccept`, defaulting to its full
 * declared set), the value must additionally match at least one narrowed
 * alternative. Every violation produced here is attributed to the type's
 * own position (FR-007's "exactly as if written inline at the usage").
 *
 * **v0.7 part 2: this function delegates the whole demand to
 * `checkDemand`.** Until this milestone it re-implemented a *subset* of
 * that walk by hand — `type`, the simple leaf keywords, `seal`, `accept` —
 * and silently checked nothing at all for `keys`, `items`, `values` and
 * `required` inside a named type. The v0.5 comment that stood here called
 * that a scope decision ("no worked example exercises it"), which was true
 * then and is fatal now: the meta-schema's central construct is the
 * recursive named type `demand`, whose entire content is a `keys:`
 * mapping. A meta-schema checked by the old code would have passed
 * everything, including documents it was written to refuse — a green
 * fixed point proving nothing. Found by probe before any of this milestone
 * was written; the three `tests/corpus/cases/recursion/` cases are that
 * probe, and they returned `ok: true` against the old code.
 *
 * Delegating rather than duplicating is what keeps the two walks from
 * drifting: there is now exactly one implementation of "check a demand
 * against a value", and a named type differs from an inline demand only in
 * **which layer and pointer it declares from**.
 *
 * `ctx.typeHops` — not `ctx.depth` — bounds this recursion. The two count
 * different things and §7's guarded-recursion rule is precisely the
 * distinction: `depth` counts **structural** levels consumed (`keys`,
 * `items`, `values`), and a recursion that consumes them is *productive*
 * and terminates on any finite document; `typeHops` counts named-type
 * resolutions **since the last structural level**, and a recursion that
 * consumes none of those is *unguarded* and would not terminate at all.
 * Every structural descent resets `typeHops` to 0, which is what lets a
 * guarded recursive type check a document as deep as the document
 * actually is, while `A: {type: B}, B: {type: A}` still stops.
 *
 * ## v1.0 FR-004–FR-007: this is where the `keys` + `values` blow-up is bounded
 *
 * §9 makes `keys` and `values` compose by intersection where both cover an
 * entry, so both descend. Where both also name the **same** recursive type,
 * the walk visits every subtree twice per level — **2^depth**, measured at
 * 7.4 ms / 60.9 ms / 919.8 ms for depths 10 / 14 / 18. Legal input,
 * unbounded work: §11 caps document *size*, and nothing caps work.
 *
 * **This function is the join point, and the only one.** The two arms are
 * genuinely different demands — `keys.<name>.demand` and `values` — with
 * different demand pointers, so nothing above here can be memoized without
 * keying on the very thing that still differs. They re-converge exactly
 * here, because this function rewrites the demand pointer to
 * `["types", <name>, "demand"]` and the usage layer to `decl.layer`: both
 * arms enter the type's body with identical arguments and diverge nowhere
 * below it.
 *
 * The key is `decl` → `value` → `mergedPointer ∥ depth ∥ typeHops ∥
 * usageAccept`. Two of those are demonstrably load-bearing and are covered
 * by cases built to collide without them
 * (`tests/unit/composition-bound.test.ts`): **`decl`**, since two named
 * types can be checked against one value at one pointer, and
 * **`usageAccept`**, since two usages can narrow one type differently at
 * one pointer. **`mergedPointer` and `depth` are redundant *today* and are
 * kept anyway**: `depth` is always the pointer's own segment count less one
 * (every structural descent adds exactly one of each), and the fold places
 * any given node object at exactly one pointer, so node identity already
 * separates them. **Both were sabotage-tested and neither is falsifiable** —
 * dropping `depth`, and separately dropping `mergedPointer`, leaves the
 * entire suite green, which is `guards-that-dont-guard` in its exact form
 * and is reported as such. They stay because those two invariants live in
 * `src/merge/fold.ts` and in this file's own descent, are enforced by
 * nothing, and a cache that silently depends on two unenforced properties
 * of two other modules is the defect FR-006 exists to prevent. Recorded
 * rather than dropped, so the next reader can disagree with it knowingly.
 *
 * `ctx.usageLayer` is deliberately **not** in the key: this function
 * overwrites it with `decl.layer` before doing anything, so it cannot
 * affect the result — and two schema layers checking one value through one
 * type therefore share a cache entry, which is correct and is what
 * whole-chain validation's redundancy (§5.4) has always meant. Both layers
 * still append the violations, so the diagnostic is still reported once per
 * layer; a cache that *deduplicated* there would be changing the answer,
 * which FR-005 forbids as firmly as confusing two subtrees.
 * `ctx.configuration` and `ctx.allDecls` are not in the key either — they
 * are fixed for the life of one `checkConfiguration` call, which is exactly
 * the cache's lifetime.
 */
function checkNamedType(decl, value, usageAccept, ctx, mergedPointer) {
    const memo = ctx.memo;
    if (memo === undefined) {
        return checkNamedTypeUncached(decl, value, usageAccept, ctx, mergedPointer);
    }
    let byDeclaration = memo.get(decl);
    if (byDeclaration === undefined) {
        byDeclaration = new Map();
        memo.set(decl, byDeclaration);
    }
    let byValue = byDeclaration.get(value);
    if (byValue === undefined) {
        byValue = new Map();
        byDeclaration.set(value, byValue);
    }
    // U+0000 as the separator because it cannot occur in an RFC 6901 pointer
    // or in a §9.1 type name, so no two distinct key tuples can render to one
    // string. (Two *strings* would be enough for a Map, but a collision here
    // would be a wrong answer rather than a slow one.)
    const key = `${mergedPointer}\u0000${ctx.depth}\u0000${ctx.typeHops}\u0000${usageAccept === undefined ? "" : usageAccept.join("\u0000")}`;
    const hit = byValue.get(key);
    if (hit !== undefined) {
        return hit;
    }
    const computed = checkNamedTypeUncached(decl, value, usageAccept, ctx, mergedPointer);
    byValue.set(key, computed);
    return computed;
}
/**
 * The body `checkNamedType` memoizes. Split out rather than guarded inline
 * so the cache and the computation cannot drift: there is exactly one
 * expression of what checking a named type *means*, and the wrapper above
 * decides only whether to compute it again.
 *
 * **Every caller copies the returned array's elements rather than the array
 * itself** (`extend`, or an array-literal spread), so a cached result is
 * never appended to by a later caller. That is what makes handing the same
 * array object back twice safe.
 */
function checkNamedTypeUncached(decl, value, usageAccept, ctx, mergedPointer) {
    if (ctx.typeHops > MAX_DEMAND_DEPTH) {
        return [];
    }
    const typeCtx = { ...ctx, usageLayer: decl.layer, typeHops: ctx.typeHops + 1 };
    const violations = [...checkDemand(decl.demand, value, ["types", decl.name, "demand"], mergedPointer, typeCtx)];
    const declaredAccept = decl.accept;
    if (declaredAccept !== undefined && declaredAccept.length > 0) {
        const narrowed = usageAccept ?? declaredAccept;
        const matchesAny = narrowed.some((altName) => matchesResolvedName(altName, value, typeCtx, mergedPointer));
        if (!matchesAny) {
            const declaring = { layer: decl.layer, layerRank: decl.layerRank, pointerPath: ["types", decl.name, "accept"] };
            violations.push(toViolation(ctx.configuration, mergedPointer, mismatchSite(value, `one of [${narrowed.join(", ")}]`, declaring, decl.span)));
        }
    }
    // **v1.0 FR-004a, and the load-bearing line of it.** §10: one violated
    // demand at one position is one diagnostic. Collapsing *here* — before
    // the memo caches the result, so before any caller can concatenate it —
    // is what bounds the output. §9's `keys` and `values` may both cover an
    // entry and both recurse into this same type, so each level would
    // otherwise hand its caller two copies of everything below it, and a
    // 296-byte configuration at depth 24 would exhaust memory while the
    // lists were being assembled. A final pass cannot reach that: by the
    // time it runs, the memory is already gone.
    return ctx.dedupe ? dedupeViolations(violations) : violations;
}
/** Whether `value` matches `name` resolved from `ctx.usageLayer`'s scope — boolean only, for existential union/accept membership checks that do not need detailed attribution. */
function matchesResolvedName(name, value, ctx, mergedPointer) {
    const resolved = resolveTypeName(name, ctx.usageLayer.rank, ctx.allDecls);
    if (resolved === undefined) {
        return false;
    }
    if (typeof resolved === "string") {
        return matchesBuiltinLeaf(value, resolved);
    }
    return checkNamedType(resolved, value, undefined, ctx, mergedPointer).length === 0;
}
function alternativeMatchesBoolean(alt, value, ctx, mergedPointer) {
    if (alt.depth === 0) {
        return matchesResolvedName(alt.name, value, ctx, mergedPointer);
    }
    if (value.type !== "sequence") {
        return false;
    }
    const inner = { name: alt.name, depth: alt.depth - 1 };
    return value.items.every((item) => alternativeMatchesBoolean(inner, item, ctx, mergedPointer));
}
/**
 * Depth-0 leaf check for the single-alternative fast path — resolves
 * once, then recurses through array depth without re-resolving.
 * `usageDeclaring` is where this alternative was *written* (the usage's
 * own `type:` position); `usageSpan` is that `type:` value node's own
 * span — used for a builtin mismatch's `Demand.span`, distinct from the
 * *offending value*'s own span (`value.span`, used for
 * `Violation.valueSpan`). A resolved named type overrides both via
 * `checkNamedType`, which attributes to the type's own declaration
 * instead.
 *
 * **An unresolvable name produces no violation site here** (`[]`, not a
 * mismatch) — reachability failures are reported once, as a vocabulary
 * problem, by `reachabilityProblems` below, the same way a globally
 * unknown name is reported once by `vocabulary.ts`'s own
 * `refuseTypeExpressionProblems`. Reporting a generic `type-mismatch`
 * here too, on top of either, would be exactly the duplicate v0.3
 * FR-028's "found by different passes, reported together, never twice"
 * precedent forbids — v0.4's own `parseTypeDemand === undefined -> []`
 * skip is the direct ancestor of this rule, generalized to reachability.
 */
function checkSingleAlternative(alt, value, ctx, usageAccept, usageDeclaring, usageSpan, mergedPointer) {
    if (alt.depth === 0) {
        const resolved = resolveTypeName(alt.name, ctx.usageLayer.rank, ctx.allDecls);
        if (resolved === undefined) {
            return [];
        }
        if (typeof resolved === "string") {
            return matchesBuiltinLeaf(value, resolved) ? [] : [toViolation(ctx.configuration, mergedPointer, mismatchSite(value, alt.name, usageDeclaring, usageSpan))];
        }
        return checkNamedType(resolved, value, usageAccept, ctx, mergedPointer);
    }
    if (value.type !== "sequence") {
        return [toViolation(ctx.configuration, mergedPointer, mismatchSite(value, describeAlternative(alt), usageDeclaring, usageSpan))];
    }
    const inner = { name: alt.name, depth: alt.depth - 1 };
    const violations = [];
    // v0.7 part 2: the element index used to ride along as a `pointerSuffix`
    // and be spliced onto the anchor by `toViolation`. It is now folded into
    // `mergedPointer` one step earlier, which is the identical string
    // computed at the position that knows the index — and is what lets this
    // whole path deal in `Violation`s, so `checkNamedType` can hand its work
    // to `checkDemand`.
    value.items.forEach((item, index) => {
        extend(violations, checkSingleAlternative(inner, item, ctx, usageAccept, usageDeclaring, usageSpan, `${mergedPointer}${pointerFromPath([index])}`));
    });
    return violations;
}
/**
 * Check `value` against a `type:` expression's own alternatives (v0.5
 * FR-005, FR-008). Detailed, type-attributed violations are produced only
 * for the common case §7's own examples show: exactly one alternative
 * (at any array depth). A union of 2+ alternatives falls back to
 * existential boolean matching with one generic `type-mismatch` when
 * nothing matches — a scope decision (research.md), not a citation gap:
 * no Acceptance Scenario exercises detailed attribution through a union
 * of named types.
 */
function checkTypeExpressionWithAccept(typeNode, value, ctx, usageAccept, usageDeclaring, mergedPointer) {
    if (typeNode.type !== "scalar" || typeNode.kind !== "string") {
        return [];
    }
    const parsed = parseTypeExpression(typeNode.value);
    if (!parsed.ok) {
        return [];
    }
    // Deliberately no `unresolvedAlternatives` gate here (unlike
    // vocabulary.ts's own use of it): that helper checks only against
    // typeexpr.ts's hardcoded built-in set, which has no notion of a
    // *declared* type — using it as a pre-check here would treat every
    // named-type usage as unresolvable before `resolveTypeName` (which
    // knows about both) ever got a chance to look. A name this milestone's
    // own scope genuinely cannot resolve still ends up refused below, via
    // `checkSingleAlternative`'s/`alternativeMatchesBoolean`'s own
    // `resolved === undefined` branches — the same outcome, reached
    // correctly instead of prematurely.
    const expr = parsed.value;
    if (expr.alternatives.length === 1) {
        const alt = expr.alternatives[0];
        if (alt !== undefined) {
            return checkSingleAlternative(alt, value, ctx, usageAccept, usageDeclaring, typeNode.span, mergedPointer);
        }
    }
    const matches = expr.alternatives.some((alt) => alternativeMatchesBoolean(alt, value, ctx, mergedPointer));
    if (matches) {
        return [];
    }
    return [toViolation(ctx.configuration, mergedPointer, mismatchSite(value, describeExpression(expr), usageDeclaring, typeNode.span))];
}
// --- Turning sites into diagnostics -----------------------------------
/**
 * The layer a value's own span traces back to, plus its delegation
 * breadcrumb if any (v0.6, research.md D4). A direct match against
 * `configuration.layers` (every pre-v0.6 case, unchanged) carries no
 * breadcrumb. A span whose origin does not match any layer directly is
 * checked next against `configuration.delegationBreadcrumbs` — every
 * value reached through delegation, at any hop depth, ultimately
 * belongs to the **config layer** (FR-010: delegation only ever resolves
 * against the config's own tree, never a schema's `provide`), which in
 * every pedigree is the single highest-rank layer.
 */
function layerForSpanOrigin(configuration, originId) {
    const found = configuration.layers.find((layer) => layer.identity.location === originId);
    if (found !== undefined) {
        return { layer: found };
    }
    const breadcrumb = configuration.delegationBreadcrumbs.get(originId);
    if (breadcrumb !== undefined) {
        const configLayer = configuration.layers.reduce((highest, layer) => (layer.rank > highest.rank ? layer : highest));
        return { layer: configLayer, delegatedFrom: breadcrumb };
    }
    throw new Error(`Internal error: no layer in configuration.layers matches span.origin.id '${originId}', and it is not a known delegation origin either — every merged-tree node's span should trace back to a real layer or a fragment`);
}
function buildDemand(declaring, span) {
    return { layer: declaring.layer, layerRank: declaring.layerRank, pointer: pointerFromPath(declaring.pointerPath), span };
}
function toViolation(configuration, anchorMergedPointer, site) {
    const demand = buildDemand(site.declaring, site.declaringSpan);
    const mergedPointer = site.pointerSuffix.length === 0 ? anchorMergedPointer : `${anchorMergedPointer}${pointerFromPath(site.pointerSuffix)}`;
    const { layer: valueLayer, delegatedFrom } = layerForSpanOrigin(configuration, site.node.span.origin.id);
    return { demand, mergedPointer, valueSpan: site.node.span, valueLayer, reason: site.reason, ...(delegatedFrom !== undefined ? { delegatedFrom } : {}) };
}
function parentPointerOf(pointer) {
    if (pointer.length === 0) {
        return "";
    }
    return pointer.slice(0, pointer.lastIndexOf("/"));
}
/**
 * Check one demand mapping (`raw`) against `value` (possibly absent),
 * recursing into `keys`/`items` (v0.5 FR-021–FR-026). `demandPointerPath`
 * is the full pointer to `raw` itself, in `ctx.usageLayer`'s own
 * document; `mergedPointer` is the full pointer to `value`'s own position
 * in the merged configuration.
 */
function checkDemand(raw, value, demandPointerPath, mergedPointer, ctx) {
    const violations = [];
    const usageDeclaringBase = { layer: ctx.usageLayer, layerRank: ctx.usageLayer.rank, pointerPath: demandPointerPath };
    const requiredNode = raw.get("required");
    if (requiredNode !== undefined && requiredNode.type === "scalar" && requiredNode.kind === "bool" && requiredNode.value === true) {
        const cause = requiredViolationCause(value);
        if (cause !== undefined) {
            const demand = buildDemand({ ...usageDeclaringBase, pointerPath: [...demandPointerPath, "required"] }, requiredNode.span);
            if (cause === "null" && value !== undefined) {
                const { layer: valueLayer, delegatedFrom } = layerForSpanOrigin(ctx.configuration, value.span.origin.id);
                violations.push({ demand, mergedPointer, valueSpan: value.span, valueLayer, reason: { kind: "required-violated", cause: "null" }, ...(delegatedFrom !== undefined ? { delegatedFrom } : {}) });
            }
            else {
                const anchorPointer = parentPointerOf(mergedPointer);
                const anchorNode = resolvePointer(ctx.configuration.tree, anchorPointer) ?? ctx.configuration.tree;
                const { layer: valueLayer, delegatedFrom } = layerForSpanOrigin(ctx.configuration, anchorNode.span.origin.id);
                violations.push({ demand, mergedPointer: anchorPointer, valueSpan: anchorNode.span, valueLayer, reason: { kind: "required-violated", cause: "absent" }, ...(delegatedFrom !== undefined ? { delegatedFrom } : {}) });
            }
        }
    }
    if (value === undefined) {
        return violations;
    }
    const acceptNode = raw.get("accept");
    const usageAccept = acceptNode !== undefined && acceptNode.type === "sequence" ? acceptNode.items.flatMap((item) => (item.type === "scalar" && item.kind === "string" ? [item.value] : [])) : undefined;
    for (const [keyword, keywordValue] of raw) {
        if (keyword === "required" || keyword === "accept") {
            continue;
        }
        if (keyword === "type") {
            const declaring = { ...usageDeclaringBase, pointerPath: [...demandPointerPath, "type"] };
            extend(violations, checkTypeExpressionWithAccept(keywordValue, value, ctx, usageAccept, declaring, mergedPointer));
            continue;
        }
        if (SIMPLE_LEAF_KEYWORDS.has(keyword)) {
            const declaring = { ...usageDeclaringBase, pointerPath: [...demandPointerPath, keyword] };
            for (const base of runSimpleLeafCheck(keyword, keywordValue, value)) {
                violations.push(toViolation(ctx.configuration, mergedPointer, siteAt(base, declaring, keywordValue.span)));
            }
            continue;
        }
        if (keyword === "items") {
            extend(violations, checkNestedItems(keywordValue, value, demandPointerPath, mergedPointer, ctx));
            continue;
        }
        if (keyword === "keys") {
            extend(violations, checkNestedKeys(keywordValue, value, demandPointerPath, mergedPointer, ctx));
            continue;
        }
        if (keyword === "values") {
            extend(violations, checkNestedValues(keywordValue, value, demandPointerPath, mergedPointer, ctx));
            continue;
        }
        if (keyword === "seal") {
            // v0.7: seal lives in the demand vocabulary now — checked here,
            // using `raw` wholesale (not just this one keyword's own value),
            // since the closed-check needs `raw`'s own `keys` sibling too. See
            // this file's own "seal" section (sealClosedSites) for why no
            // cross-layer accumulation is needed.
            const declaring = { ...usageDeclaringBase, pointerPath: [...demandPointerPath, "seal"] };
            for (const site of sealClosedSites(raw, value)) {
                violations.push(toViolation(ctx.configuration, mergedPointer, siteAt(site, declaring, keywordValue.span)));
            }
        }
    }
    return violations;
}
function checkNestedItems(itemsDeclaration, value, demandPointerPath, mergedPointer, ctx) {
    if (itemsDeclaration.type !== "mapping" || value.type !== "sequence") {
        return [];
    }
    if (ctx.depth + 1 > MAX_DEMAND_DEPTH) {
        return [depthLimitViolation(itemsDeclaration, ctx, [...demandPointerPath, "items"], mergedPointer)];
    }
    const violations = [];
    value.items.forEach((item, index) => {
        extend(violations, checkDemand(itemsDeclaration.entries, item, [...demandPointerPath, "items"], `${mergedPointer}${pointerFromPath([index])}`, { ...ctx, depth: ctx.depth + 1, typeHops: 0 }));
    });
    return violations;
}
function checkNestedKeys(keysDeclaration, value, demandPointerPath, mergedPointer, ctx) {
    if (keysDeclaration.type !== "mapping" || value.type !== "mapping") {
        return [];
    }
    if (ctx.depth + 1 > MAX_DEMAND_DEPTH) {
        return [depthLimitViolation(keysDeclaration, ctx, [...demandPointerPath, "keys"], mergedPointer)];
    }
    const nested = readNestedKeysMapping(keysDeclaration);
    const violations = [];
    for (const [childName, childRaw] of nested) {
        const childPointer = `${mergedPointer}${pointerFromPath([childName])}`;
        const childValue = value.entries.get(childName);
        extend(violations, checkDemand(childRaw, childValue, [...demandPointerPath, "keys", childName, "demand"], childPointer, { ...ctx, depth: ctx.depth + 1, typeHops: 0 }));
    }
    return violations;
}
/**
 * v0.7 part 2 FR-001–FR-006, SPEC.md §9 amended: `values` constrains
 * **every** entry of a mapping, whatever its key.
 *
 * Three properties, each with its own conformance case:
 *
 * - **A non-mapping value is a no-op** (FR-006), not a second diagnostic —
 *   the shape refusal belongs to `type`, and doubling it would produce two
 *   diagnostics for one mistake (v0.3 FR-028's precedent). Structurally
 *   identical to `checkNestedKeys`' own `value.type !== "mapping"` guard,
 *   and to `checkNestedItems`' `!== "sequence"` one.
 * - **`keys` and `values` compose by intersection** (FR-002) with no
 *   precedence rule: they are two independent keywords of one demand, and
 *   `checkDemand`'s own loop runs both, in canonical keyword order. There
 *   is nothing here that has to know about `keys` at all — which is the
 *   whole argument SPEC.md §9 makes for needing no new composition rule.
 * - **`values` is orthogonal to `seal`** (FR-004). `sealClosedSites` draws
 *   its declared set from `keys` alone; nothing here adds a name to it.
 *   `values` says what shape, `seal` says which keys.
 *
 * The declaration's own shape is a **bare demand mapping**, exactly as
 * `items` takes — corrected in v0.7 part 2, post-implementation, from a
 * first reading of **key declaration** (`{demand?, delegate?}`); see
 * `vocabulary.ts`'s `DEMAND_KEYWORDS` doc for the failure mode that
 * settles it (the key-declaration reading made the wrong spelling a
 * silent no-op instead of a refusal).
 */
function checkNestedValues(valuesDeclaration, value, demandPointerPath, mergedPointer, ctx) {
    if (valuesDeclaration.type !== "mapping" || value.type !== "mapping") {
        return [];
    }
    if (ctx.depth + 1 > MAX_DEMAND_DEPTH) {
        return [depthLimitViolation(valuesDeclaration, ctx, [...demandPointerPath, "values"], mergedPointer)];
    }
    const violations = [];
    // `value.entries` is canonically key-sorted by construction (§4.2), so
    // iteration order — and therefore diagnostic order — is deterministic
    // without sorting anything here (v0.5 FR-010's own argument).
    for (const [childName, childValue] of value.entries) {
        extend(violations, checkDemand(valuesDeclaration.entries, childValue, [...demandPointerPath, "values"], `${mergedPointer}${pointerFromPath([childName])}`, { ...ctx, depth: ctx.depth + 1, typeHops: 0 }));
    }
    return violations;
}
/**
 * v0.5 FR-025, research.md D4: nesting past `MAX_DEMAND_DEPTH` is refused
 * rather than recursed into further — reuses v0.1's `depth-limit-exceeded`
 * code (the identical hazard), anchored at the demand node whose
 * recursion would cross the limit.
 *
 * **Bug found and fixed during US2's own conformance testing**
 * (`tests/unit/validate-depth-limit.test.ts`'s probe): this used to build
 * a `{kind: "type-mismatch", ...}` reason — there was no dedicated
 * `ViolationReason` variant for a depth-limit refusal when this was
 * first written, so it borrowed `type-mismatch`'s shape to describe one
 * in prose. `CODE_FOR_REASON` (`violation.ts`) then rendered it as a
 * `type-mismatch` *diagnostic code* — the wrong code, catchable only by
 * a case where the runtime (`check.ts`) walk, not just the schema-shape
 * (`vocabulary.ts`) pass, actually reaches the boundary against a real
 * value. Fixed by adding a genuine `"depth-limit-exceeded"` reason kind
 * to `violation.ts` instead of overloading `type-mismatch`.
 */
function depthLimitViolation(node, ctx, pointerPath, mergedPointer) {
    const demand = buildDemand({ layer: ctx.usageLayer, layerRank: ctx.usageLayer.rank, pointerPath }, node.span);
    const { layer: valueLayer, delegatedFrom } = layerForSpanOrigin(ctx.configuration, node.span.origin.id);
    return { demand, mergedPointer, valueSpan: node.span, valueLayer, reason: { kind: "depth-limit-exceeded", maxDepth: MAX_DEMAND_DEPTH }, ...(delegatedFrom !== undefined ? { delegatedFrom } : {}) };
}
/** Check one schema layer's own top-level `keys.<name>.demand` against `configuration.tree`. */
function violationsForLayer(configuration, layer, allDecls, memo, dedupe) {
    if (layer.role !== "schema") {
        return [];
    }
    const vocabulary = readDemandVocabulary(layer.tree);
    const violations = [];
    for (const [keyName, raw] of vocabulary) {
        const keyPointer = pointerFromPath([keyName]);
        const value = resolvePointer(configuration.tree, keyPointer);
        extend(violations, checkDemand(raw, value, ["keys", keyName, "demand"], keyPointer, { configuration, usageLayer: layer, allDecls, depth: 0, typeHops: 0, memo, dedupe }));
    }
    return violations;
}
// --- type-usage problems: reachability + accept-widening (schema-authoring, not value violations) ----
/**
 * Two `type:`-usage problems, found independent of any value, walked
 * together in one recursive pass over every demand (mirroring
 * `vocabulary.ts`'s own recursive vocabulary pass, and — like it — never
 * looking at whether a value exists):
 *
 * - **Reachability** (v0.5 FR-008, research.md D2): a name in
 *   `knownDeclaredNames` (declared *somewhere* in the pedigree) that
 *   `resolveTypeName` cannot resolve from this usage's own layer —
 *   because it is declared only by a descendant (unreachable), or
 *   because it collided (research.md D1, unresolvable everywhere) — is
 *   `unknown-type-name`. A name **not** in `knownDeclaredNames` at all is
 *   *not* re-reported here: `vocabulary.ts`'s own `refuseTypeExpressionProblems`
 *   already refused it as globally unknown, and the value-checking walk
 *   (`checkSingleAlternative`) already skips (no violation) rather than
 *   guessing at a second diagnostic for the same name (v0.3 FR-028's
 *   never-twice precedent, generalized).
 * - **Accept-widening** (FR-013, research.md D3): a usage's `accept`
 *   naming something outside the referenced type's own declared set,
 *   including any selection at all when the type declares none.
 */
function typeUsageProblems(layers, allDecls, knownDeclaredNames) {
    const problems = [];
    function checkAlternativeReachability(alt, layer, pointerPath, span) {
        // `knownDeclaredNames` holds only unqualified local names
        // (`TypeDeclaration.name`, `types.ts`); a qualified alternative like
        // `root/resource` must be compared by its local part, or every
        // qualified reference — valid or not — looks globally unknown here.
        if (!knownDeclaredNames.has(localNameOf(alt.name))) {
            return; // globally unknown — vocabulary.ts's own pass already refused it.
        }
        if (resolveTypeName(alt.name, layer.rank, allDecls) !== undefined) {
            return; // reachable — nothing to report.
        }
        problems.push(createDiagnostic({ level: "error",
            code: "unknown-type-name",
            message: `'${pointerFromPath(pointerPath)}' names '${alt.name}', declared in the pedigree but not reachable from this layer's own scope (an ancestor cannot resolve a descendant's types, or the name collided — SPEC.md §7, v0.5 FR-008)`,
            primary: span,
            demand: { pointer: pointerFromPath(pointerPath), span },
            pedigreePosition: layer.rank,
        }));
    }
    function walk(raw, layer, pointerPath, depth) {
        if (depth > MAX_DEMAND_DEPTH) {
            return;
        }
        const typeNode = raw.get("type");
        const acceptNode = raw.get("accept");
        if (typeNode !== undefined && typeNode.type === "scalar" && typeNode.kind === "string") {
            const parsed = parseTypeExpression(typeNode.value);
            if (parsed.ok) {
                for (const alt of parsed.value.alternatives) {
                    checkAlternativeReachability(alt, layer, [...pointerPath, "type"], typeNode.span);
                }
                if (parsed.value.alternatives.length === 1 && acceptNode !== undefined && acceptNode.type === "sequence") {
                    const alt = parsed.value.alternatives[0];
                    if (alt !== undefined) {
                        const resolved = resolveTypeName(alt.name, layer.rank, allDecls);
                        const declaredSet = resolved !== undefined && typeof resolved !== "string" ? (resolved.accept ?? []) : [];
                        for (const item of acceptNode.items) {
                            if (item.type === "scalar" && item.kind === "string" && !declaredSet.includes(item.value)) {
                                problems.push(createDiagnostic({ level: "error",
                                    code: "type-accept-widened",
                                    message: `'${pointerFromPath([...pointerPath, "accept"])}' selects '${item.value}', which is outside the declared set [${declaredSet.join(", ")}] — selecting outside the declared set is widening (SPEC.md §5.2, v0.5 FR-013)`,
                                    primary: item.span,
                                    demand: { pointer: pointerFromPath([...pointerPath, "accept"]), span: item.span },
                                    pedigreePosition: layer.rank,
                                }));
                            }
                        }
                    }
                }
            }
        }
        const itemsNode = raw.get("items");
        if (itemsNode !== undefined && itemsNode.type === "mapping") {
            walk(itemsNode.entries, layer, [...pointerPath, "items"], depth + 1);
        }
        const keysNode = raw.get("keys");
        if (keysNode !== undefined && keysNode.type === "mapping") {
            const nested = readNestedKeysMapping(keysNode);
            for (const [childName, childRaw] of nested) {
                walk(childRaw, layer, [...pointerPath, "keys", childName, "demand"], depth + 1);
            }
        }
        // v0.7 part 2: `values` nests exactly as `items` does (a bare demand
        // mapping — corrected post-implementation, `vocabulary.ts`'s
        // `DEMAND_KEYWORDS` doc), so a type-usage problem written under one
        // must be found under the other too — this walk and `vocabulary.ts`'s
        // own recursive pass descend in lockstep, which is the property that
        // keeps a name unreachable from a nested position reported once
        // rather than never.
        const valuesNode = raw.get("values");
        if (valuesNode !== undefined && valuesNode.type === "mapping") {
            walk(valuesNode.entries, layer, [...pointerPath, "values"], depth + 1);
        }
    }
    for (const layer of layers) {
        if (layer.role !== "schema") {
            continue;
        }
        const vocabulary = readDemandVocabulary(layer.tree);
        for (const [keyName, raw] of vocabulary) {
            walk(raw, layer, ["keys", keyName, "demand"], 0);
        }
    }
    return problems;
}
// --- seal (v0.7, SPEC.md §6.3/§9 amended) -------------------------------------------------------
//
// `seal` moved into the `demand` vocabulary during implementation
// (governance finding, reported in full): a per-key `seal` could not
// reach a nested mapping or the inside of a named type, and the
// meta-schema needs both. As an ordinary demand keyword it needs **no
// whole-stack pre-resolution and no dedicated weakening diagnostic** —
// `src/merge/seal.ts` (whole-stack `seal`/`final` resolution) no longer
// exists; only `src/merge/final.ts` (`final` alone) remains. The reason
// is the same one already established for named-type narrowing (SPEC.md
// §15): whole-chain validation checks every schema layer's own `seal`
// declaration at every position, every time, redundantly. If an ancestor
// declares `seal: closed` at some position, that layer's own check keeps
// firing on every subsequent resolution regardless of what any
// descendant later declares — including a descendant's own `seal: open`,
// which is therefore **inert**, not something requiring an explicit
// refusal: "a widening needs no refusal... inert exactly where it would
// otherwise do harm" (§15's own words for the identical situation).
// Symmetrically, a descendant is free to *add* new declared children to
// an already-closed struct's `keys` vocabulary without needing to touch
// `seal` at all — the ancestor's own closed check still runs against
// only what *it itself* declared, so genuinely new children a descendant
// names are simply outside that one ancestor layer's own check, and nothing
// here needs to "merge" declarations across layers to get this right.
//
// Consequence: `seal: closed`'s enforcement is **entirely local** to one
// `RawDemand` (one layer's own declaration at one position, or one
// resolved named type's own declaration) — it needs no map, no pointer
// bookkeeping, and no separate pass. `sealClosedSites` below is called
// from exactly two places: `checkDemand`'s existing per-position walk
// (ordinary keys, nested to arbitrary depth for free, since that walk
// already recurses), and `checkNamedType`'s walk (so `seal` works inside
// a named type too — the case named-type narrowing exists for).
/** FR-007: if `raw` declares `seal: closed` and `value` is a mapping, one `ViolationSite` per present child not named by `raw`'s own `keys` (this layer's/type's own declaration alone — see this section's module doc for why no cross-layer accumulation is needed or wanted). A `seal: open` or absent `seal` contributes nothing. A malformed `seal` value is `src/validate/vocabulary.ts`'s job (`malformed-demand-value`), not checked again here. */
function sealClosedSites(raw, value) {
    const sealNode = raw.get("seal");
    if (sealNode === undefined || sealNode.type !== "scalar" || sealNode.kind !== "string" || sealNode.value !== "closed") {
        return [];
    }
    if (value.type !== "mapping") {
        return [];
    }
    const keysNode = raw.get("keys");
    const declared = keysNode !== undefined && keysNode.type === "mapping" ? new Set(readNestedKeysMapping(keysNode).keys()) : new Set();
    const sites = [];
    for (const [childName, childNode] of value.entries) {
        if (declared.has(childName)) {
            continue;
        }
        sites.push({ pointerSuffix: [childName], node: childNode, reason: { kind: "seal-violated", childKey: childName } });
    }
    return sites;
}
/**
 * A schema's **top-level** `seal` (SPEC.md §9, amended v0.7): the mate to
 * a schema's top-level `keys:`, governing the **config's own top level**
 * — new in v0.7 ("there was previously no syntax for closing a
 * document's top level at all"). Read directly off the schema tree, not
 * through any `demand` (there is no wrapping key at the document's own
 * top level to hang a `demand:` off of) — mirrors how top-level `keys:`
 * itself is read (`src/merge/strategy.ts`'s `readKeysVocabulary`),
 * reusing the identical `malformed-demand-value`-shaped refusal for a
 * value that is present but not `"open"`/`"closed"`.
 */
/**
 * The **shape** half of the top-level `seal` check: a present `seal:` whose
 * value is not `'open'`/`'closed'`. Split out of `topLevelSealDiagnostics`
 * in v1.1 so the schema-vocabulary pass can run it with no configuration in
 * hand; the value half — which keys a sealed top level actually admits —
 * stays below, where the merged tree is.
 */
function malformedTopLevelSealDiagnostics(layers) {
    const diagnostics = [];
    for (const layer of layers) {
        if (layer.role !== "schema" || layer.tree.type !== "mapping") {
            continue;
        }
        const sealNode = layer.tree.entries.get("seal");
        if (sealNode === undefined || (sealNode.type === "scalar" && sealNode.kind === "string" && (sealNode.value === "open" || sealNode.value === "closed"))) {
            continue;
        }
        diagnostics.push(createDiagnostic({
            level: "error",
            code: "malformed-demand-value",
            message: `top-level 'seal' is not 'open' or 'closed' (SPEC.md §9, v0.7)`,
            primary: sealNode.span,
            pointer: "",
            pedigreePosition: layer.rank,
        }));
    }
    return diagnostics;
}
function topLevelSealDiagnostics(configuration) {
    const diagnostics = malformedTopLevelSealDiagnostics(configuration.layers);
    for (const layer of configuration.layers) {
        if (layer.role !== "schema" || layer.tree.type !== "mapping") {
            continue;
        }
        const sealNode = layer.tree.entries.get("seal");
        if (sealNode === undefined) {
            continue;
        }
        if (!(sealNode.type === "scalar" && sealNode.kind === "string")) {
            continue;
        }
        if (sealNode.value !== "closed" || configuration.tree.type !== "mapping") {
            continue;
        }
        const declared = new Set(readDemandVocabulary(layer.tree).keys());
        for (const [childName, childNode] of configuration.tree.entries) {
            if (declared.has(childName)) {
                continue;
            }
            const { layer: valueLayer, delegatedFrom } = layerForSpanOrigin(configuration, childNode.span.origin.id);
            diagnostics.push(createDiagnostic({
                level: "error",
                code: "seal-violation",
                message: `top-level key '${childName}' is not declared by this schema's own 'keys:' vocabulary, and the document's top level is sealed 'seal: closed' (SPEC.md §6.3, §9, v0.7 FR-007)`,
                primary: childNode.span,
                pointer: pointerFromPath([childName]),
                pedigreePosition: valueLayer.rank,
                ...(delegatedFrom !== undefined ? { delegatedFrom } : {}),
            }));
        }
    }
    return diagnostics;
}
// --- final (v0.7, SPEC.md §6.3) — the pinned-constant pattern, needing the merged tree ----------
/** Whether `raw` (a schema layer's own demand at some position) declares `required: true`. */
function declaresRequiredTrue(raw) {
    const node = raw.get("required");
    return node !== undefined && node.type === "scalar" && node.kind === "bool" && node.value === true;
}
/**
 * FR-011/FR-012/FR-013: for a **top-level** key resolved `final` with
 * `provide`, decide whether the merged value at that key's own pointer
 * is the **config's own** contribution (refused as `final-key-set`) or
 * still the schema's `provide` constant (accepted; and if any schema
 * layer also declared `required: true` for this key, §5.5's
 * `required-vacuous` info lint fires instead — never both, since a
 * refused override already says everything the lint would).
 *
 * Attribution is by **span**, not by value equality (FR-011's own point:
 * "even though the value may be byte-identical to the provided constant"
 * — a config restating the identical literal still owns that span, under
 * ordinary replace-wholesale precedence, so the merged node's span traces
 * to the config document regardless of what it says).
 *
 * **Top-level only, by construction** (`final.ts`'s own doc, SPEC.md
 * §9 amended): a nested key declaration carries `demand`/`delegate`
 * only — `provide` cannot even be *written* at a nested position in a
 * way this vocabulary reads, so `final`'s own state (`src/merge/final.ts`)
 * is keyed by bare top-level key name, not a pointer path.
 */
function finalProvideDiagnostics(configuration, keyName, finalState) {
    const final = finalState.final;
    if (final === undefined || !final.hasProvide) {
        return [];
    }
    const value = configuration.tree.type === "mapping" ? configuration.tree.entries.get(keyName) : undefined;
    if (value === undefined) {
        return [];
    }
    const pointer = pointerFromPath([keyName]);
    const { layer: valueLayer } = layerForSpanOrigin(configuration, value.span.origin.id);
    if (valueLayer.role === "config") {
        return [
            createDiagnostic({
                level: "error",
                code: "final-key-set",
                message: `'${keyName}' is 'final' with 'provide' — its value is a constant the config may not set, even to restate it (SPEC.md §5.5, §6.3, v0.7 FR-011)`,
                primary: value.span,
                pointer,
                pedigreePosition: valueLayer.rank,
            }),
        ];
    }
    const requiredDeclared = configuration.layers.some((layer) => {
        if (layer.role !== "schema") {
            return false;
        }
        const raw = readDemandVocabulary(layer.tree).get(keyName);
        return raw !== undefined && declaresRequiredTrue(raw);
    });
    if (!requiredDeclared) {
        return [];
    }
    return [
        createDiagnostic({
            level: "info",
            code: "required-vacuous",
            message: `'required' is vacuous under 'final provide' at '${keyName}' — the value is already pinned by 'final', so 'required' asks for nothing 'final' does not already guarantee (SPEC.md §5.5, v0.7 FR-013)`,
            primary: value.span,
            pointer,
            pedigreePosition: final.layer.rank,
        }),
    ];
}
/** Every `final` diagnostic the merged tree alone can determine (FR-011, FR-013) — walked once per top-level key with a resolved `final` state. `seal`'s own diagnostics are found elsewhere (`sealClosedSites`, inline in `checkDemand`/`checkNamedType`; `topLevelSealDiagnostics`, above) — it needs no equivalent state map at all. */
function finalDiagnostics(configuration) {
    const diagnostics = [];
    for (const [keyName, finalState] of configuration.finalState) {
        extend(diagnostics, finalProvideDiagnostics(configuration, keyName, finalState));
    }
    return diagnostics;
}
// --- directives: (v0.7 part 2, SPEC.md §9 amended) ----------------------
/**
 * Every diagnostic every schema layer's own `directives:` section
 * produces (FR-011 through FR-014, contracts/values-and-directives.md §4).
 *
 * The subject is the **config layer** — the document being validated —
 * read from its own parsed tree, because reserved keys are gone from the
 * merged configuration by then and by design (§9). "Publishing a schema is
 * validating it as a config" (§2.6) is what makes this the right subject
 * and not a special case: in the bootstrap the config layer *is* a schema
 * document, and its `$id`/`$version`/`$adopts`/`$pin` are exactly the
 * things a meta-schema has always needed to constrain and had no way to.
 *
 * Each entry's `demand` runs through `checkDemand` unchanged — the same
 * one implementation every other demand in this file goes through, which
 * is what makes §9's "the same per-key vocabulary as a `keys:` entry"
 * true of the checking and not only of the syntax. `mergedPointer` is
 * seeded with the empty pointer (the merged root), and the resulting
 * violations are rendered with `omitMergedPointer`: a directive has no
 * merged position, and the empty pointer is only what a `required`
 * absence needs to anchor against.
 */
function directiveDiagnostics(configuration, allDecls, memo, dedupe) {
    const diagnostics = [];
    const subject = configuration.layers.find((layer) => layer.role === "config");
    for (const layer of configuration.layers) {
        const { declarations, problems } = readDirectives(layer);
        extend(diagnostics, problems);
        if (subject === undefined) {
            continue;
        }
        for (const declaration of declarations) {
            const raw = declaration.demand;
            if (raw === undefined) {
                continue;
            }
            const pointerPath = ["directives", declaration.name, "demand"];
            // The schema-shape pass, exactly as `keys.<name>.demand` gets one.
            for (const problem of recursiveVocabularyProblems(raw, layer.rank, pointerPath, 0, new Set(allDecls.map((decl) => decl.name)))) {
                diagnostics.push(problem.diagnostic);
            }
            const value = reservedKeyValue(subject, declaration.name);
            const violations = checkDemand(raw, value, pointerPath, "", { configuration, usageLayer: layer, allDecls, depth: 0, typeHops: 0, memo, dedupe });
            for (const violation of violations) {
                diagnostics.push(renderViolation(violation, { omitMergedPointer: true }));
            }
        }
    }
    return diagnostics;
}
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
export function schemaVocabularyProblems(layers) {
    const allDecls = declarationsOfLayers(layers);
    const knownDeclaredNames = new Set(allDecls.map((declaration) => declaration.name));
    const diagnostics = [];
    for (const layer of layers) {
        extend(diagnostics, vocabularyProblemsForLayer(layer, knownDeclaredNames));
    }
    extend(diagnostics, typeVocabularyProblems(layers));
    extend(diagnostics, collisionDiagnostics(allDecls));
    extend(diagnostics, builtinCollisionDiagnostics(allDecls));
    extend(diagnostics, qualifierCollisionDiagnostics(layers));
    extend(diagnostics, cycleDiagnostics(allDecls));
    extend(diagnostics, typeUsageProblems(layers, allDecls, knownDeclaredNames));
    extend(diagnostics, malformedTopLevelSealDiagnostics(layers));
    return diagnostics;
}
/**
 * Check `configuration` against every schema layer's `demand`, root to
 * leaf. Vocabulary problems (demand keywords, type entries, collisions,
 * qualifiers, cycles, accept-widening) and value violations are found by
 * independent passes and reported together (v0.3 FR-028's precedent).
 */
export function checkConfiguration(configuration, options = {}) {
    // v1.0 FR-004: one memo for the whole call, which is what makes the key
    // able to omit the configuration and the declaration set. `memoize:
    // false` runs the unbounded walk, and exists so FR-005's "identical
    // diagnostics" can be *checked against something* rather than asserted.
    const memo = options.memoize === false ? undefined : new Map();
    // v1.0 FR-004a: §10's multiplicity rule, on unless a test needs the raw
    // walk as an oracle.
    const dedupe = options.dedupe !== false;
    const allDecls = allDeclarations(configuration);
    const knownDeclaredNames = new Set(allDecls.map((d) => d.name));
    const vocabularyDiagnostics = [];
    for (const layer of configuration.layers) {
        extend(vocabularyDiagnostics, vocabularyProblemsForLayer(layer, knownDeclaredNames));
    }
    extend(vocabularyDiagnostics, typeVocabularyProblems(configuration.layers));
    extend(vocabularyDiagnostics, collisionDiagnostics(allDecls));
    extend(vocabularyDiagnostics, builtinCollisionDiagnostics(allDecls));
    extend(vocabularyDiagnostics, qualifierCollisionDiagnostics(configuration.layers));
    extend(vocabularyDiagnostics, cycleDiagnostics(allDecls));
    extend(vocabularyDiagnostics, typeUsageProblems(configuration.layers, allDecls, knownDeclaredNames));
    const violations = [];
    for (const layer of configuration.layers) {
        extend(violations, violationsForLayer(configuration, layer, allDecls, memo, dedupe));
    }
    // The same identity once more over the whole set. Not what bounds the
    // memory — `checkNamedType` already did that, as results accumulated —
    // but what makes §10's rule **total**: a violation reached by two paths
    // that never crossed a named type, or by two of a layer's own keys,
    // is collapsed here rather than only on the named-type path.
    const reported = dedupe ? dedupeViolations(violations) : violations;
    const diagnostics = [...vocabularyDiagnostics, ...reported.map((violation) => renderViolation(violation)), ...topLevelSealDiagnostics(configuration), ...finalDiagnostics(configuration), ...directiveDiagnostics(configuration, allDecls, memo, dedupe)];
    const errors = diagnostics.filter((d) => d.level === "error");
    if (errors.length > 0) {
        return { ok: false, diagnostics: errors };
    }
    // v0.7 FR-002: every remaining diagnostic is level:"info" (e.g.
    // required-vacuous) — a successful certification still reports them.
    return { ok: true, diagnostics };
}
//# sourceMappingURL=check.js.map