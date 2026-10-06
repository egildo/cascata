/**
 * The leaf checks — SPEC.md §5.4, §7, §9; v0.4 FR-013;
 * specs/004-constraint-checker/contracts/demand-vocabulary.md's semantics
 * table.
 *
 * Each function is a pure `(demand value, target Node) -> ViolationSite[]`
 * — zero sites for a satisfied demand, one or more for a violated one.
 * `check.ts` attaches the declaring `Demand` (layer, pointer, span) and the
 * merged-configuration pointer prefix to turn a site into a full
 * `Violation`.
 *
 * A keyword applied to a value of the wrong JS kind produces **no**
 * violation from that keyword directly (contracts/demand-vocabulary.md:
 * "min/max/minLength/maxLength/pattern applied to a value of the wrong
 * kind produce no violation from that keyword directly — `type` is the
 * keyword responsible for kind mismatches"). A schema demanding `pattern`
 * with no `type: string` applies `pattern` only to values that happen to
 * be strings, mirroring JSON Schema's own "unapplicable keywords are
 * no-ops" convention (§12's selective vampirism).
 *
 * **A demand value of the wrong shape is silently not-applicable here**
 * (e.g. `min: "ten"` — a string where a number was expected). Refusing
 * that as `malformed-demand-value` is `src/validate/vocabulary.ts`'s job
 * (User Story 4, tasks.md T050) — these leaf checks assume a well-formed
 * demand value and simply find nothing to check against when it is not
 * one, so a schema with a malformed `min` behaves as "no `min` demand"
 * until US4's refusal wires in, rather than crashing.
 *
 * **v0.5**: `type` matching (including named-type resolution) moved to
 * `check.ts` — it needs a per-layer resolution scope (`src/validate/
 * types.ts`) and can recurse into a resolved type's own demand, neither
 * of which fits this file's "pure, single-value-in" contract. This file
 * keeps the leaf checks that never needed resolution: `min`, `max`,
 * `minLength`, `maxLength`, `pattern`, `enum`, and `required`'s absence
 * classification.
 */
import {} from "../model/node.js";
import { nodesEqual } from "../model/equality.js";
// --- min / max -----------------------------------------------------------
function numericValueOf(node) {
    if (node.type !== "scalar") {
        return undefined;
    }
    if (node.kind === "int") {
        return node.value;
    }
    if (node.kind === "float") {
        return node.value;
    }
    return undefined;
}
/** `min: <bound>` — refuses a numeric value below `bound` (FR-013). Native relational comparison across `bigint`/`number`, never a cast (research.md D5). No-op for a non-numeric value or a non-numeric bound (this module's own doc). */
export function checkMin(boundNode, value) {
    const bound = numericValueOf(boundNode);
    const actual = numericValueOf(value);
    if (bound === undefined || actual === undefined) {
        return [];
    }
    if (actual >= bound) {
        return [];
    }
    return [{ pointerSuffix: [], node: value, reason: { kind: "range-violated", bound: "min", boundDescription: String(bound), actualDescription: String(actual) } }];
}
/** `max: <bound>` — refuses a numeric value above `bound` (FR-013). */
export function checkMax(boundNode, value) {
    const bound = numericValueOf(boundNode);
    const actual = numericValueOf(value);
    if (bound === undefined || actual === undefined) {
        return [];
    }
    if (actual <= bound) {
        return [];
    }
    return [{ pointerSuffix: [], node: value, reason: { kind: "range-violated", bound: "max", boundDescription: String(bound), actualDescription: String(actual) } }];
}
// --- minLength / maxLength -----------------------------------------------
function intBoundOf(node) {
    return node.type === "scalar" && node.kind === "int" ? node.value : undefined;
}
/** `minLength`/`maxLength` count **code points**, not UTF-16 units (research.md's probe; §4.2's model-wide rule). `[...value].length` iterates by code point. No-op for a non-string value or non-int bound. */
function codePointLength(value) {
    return [...value].length;
}
export function checkMinLength(boundNode, value) {
    const bound = intBoundOf(boundNode);
    if (bound === undefined || value.type !== "scalar" || value.kind !== "string") {
        return [];
    }
    const actualLength = codePointLength(value.value);
    if (actualLength >= bound) {
        return [];
    }
    return [{ pointerSuffix: [], node: value, reason: { kind: "length-violated", bound: "minLength", boundValue: bound, actualLength } }];
}
export function checkMaxLength(boundNode, value) {
    const bound = intBoundOf(boundNode);
    if (bound === undefined || value.type !== "scalar" || value.kind !== "string") {
        return [];
    }
    const actualLength = codePointLength(value.value);
    if (actualLength <= bound) {
        return [];
    }
    return [{ pointerSuffix: [], node: value, reason: { kind: "length-violated", bound: "maxLength", boundValue: bound, actualLength } }];
}
// --- pattern ---------------------------------------------------------------
/** `pattern` — ECMA-262 regex, stated explicitly (§7). No length cap, no timeout: research.md D3 accepts this exposure explicitly rather than mitigating it partially. No-op for a non-string value or non-string pattern. */
export function checkPattern(patternNode, value) {
    if (patternNode.type !== "scalar" || patternNode.kind !== "string" || value.type !== "scalar" || value.kind !== "string") {
        return [];
    }
    let regex;
    try {
        regex = new RegExp(patternNode.value, "u");
    }
    catch {
        // An invalid regex source is a malformed demand value (US4's job to
        // refuse); this layer simply cannot check against it.
        return [];
    }
    if (regex.test(value.value)) {
        return [];
    }
    return [{ pointerSuffix: [], node: value, reason: { kind: "pattern-mismatch", pattern: patternNode.value } }];
}
// --- enum --------------------------------------------------------------
/** `enum` — membership via `nodesEqual` (`src/model/equality.ts`), the model's one definition (§4.2) — `int 1`, `float 1.0`, and `string "1"` are three distinct members. No-op if the declared `enum` value is not itself a sequence. */
export function checkEnum(enumNode, value) {
    if (enumNode.type !== "sequence") {
        return [];
    }
    if (enumNode.items.some((member) => nodesEqual(member, value))) {
        return [];
    }
    const allowedDescription = `[${enumNode.items.map(describeMemberForMessage).join(", ")}]`;
    return [{ pointerSuffix: [], node: value, reason: { kind: "enum-violated", allowedDescription } }];
}
function describeMemberForMessage(node) {
    if (node.type === "scalar") {
        if (node.kind === "string") {
            return JSON.stringify(node.value);
        }
        return String(node.value);
    }
    return `a ${node.type}`;
}
// --- required ------------------------------------------------------------
/** `required` — present and non-null (§4.2, §5.5). `value` is `undefined` when the key is absent from the merged tree; this function distinguishes that from an explicit `null` scalar (FR-028, FR-030). Returns a site only on violation; the caller (`check.ts`) supplies the correct anchor node (the absent position's nearest ancestor, or the `null` scalar itself) since this function alone cannot conjure a position for "absent". */
export function requiredViolationCause(value) {
    if (value === undefined) {
        return "absent";
    }
    if (value.type === "scalar" && value.kind === "null") {
        return "null";
    }
    return undefined;
}
//# sourceMappingURL=constraints.js.map