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
 */

import picomatch from "picomatch";
import { type Node } from "../model/node.js";
import { nodesEqual } from "../model/equality.js";
import type { ViolationReason } from "./violation.js";
import { parseTypeExpression, unresolvedAlternatives, type Alternative, type TypeExpression } from "./typeexpr.js";

/** One offending position inside a demanded key's own value, relative to that key's merged pointer — `check.ts` prefixes `pointerSuffix` onto the demanded key's own pointer to get `Violation.mergedPointer`. */
export interface ViolationSite {
  readonly pointerSuffix: readonly (string | number)[];
  readonly node: Node;
  readonly reason: ViolationReason;
}

// --- type --------------------------------------------------------------

function describeAlternative(alt: Alternative): string {
  return alt.depth === 0 ? alt.name : `${alt.name}${"[]".repeat(alt.depth)}`;
}

function describeExpression(expr: TypeExpression): string {
  return expr.alternatives.map(describeAlternative).join(" | ");
}

function describeActual(node: Node): string {
  if (node.type === "scalar") {
    return `a ${node.kind} scalar`;
  }
  return `a ${node.type}`;
}

/** Whether `value` is a syntactically valid WHATWG URL (§7: "url → WHATWG URL Standard, what Node's `new URL()` implements"). No scheme restriction — research.md's probe found `new URL()` imposes none, and §7 cites the Standard, not a scheme policy. */
function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Whether `value` is a valid POSIX pathname (§7: "path → POSIX pathname semantics"). POSIX pathnames are null-terminated strings and must be non-empty; research.md's probe confirmed the model can hold an embedded U+0000, which this refuses. No further restriction is cited, so none is invented (Principle V: cite, don't invent). */
function isValidPath(value: string): boolean {
  return value.length > 0 && !value.includes("\u0000");
}

/** Whether `value` is a valid gitignore-syntax glob (§7: "glob → gitignore pattern syntax, implemented via picomatch"). `picomatch("")` throws (research.md D4's probed defect) rather than refusing gracefully, so the empty case is guarded here before picomatch ever sees it. */
function isValidGlob(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  try {
    picomatch(value);
    return true;
  } catch {
    return false;
  }
}

/** Whether `node` matches `alt` at exactly `alt`'s own depth — the base case (depth 0) of `matchesAlternative` below. */
function matchesLeaf(node: Node, name: string): boolean {
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
    case "glob":
      return node.type === "scalar" && node.kind === "string" && isValidGlob(node.value);
    default:
      // An alternative that never resolved (FR-012's unknown-type-name) —
      // vocabulary.ts refuses this at the schema level; a value can never
      // be judged to satisfy a rule the checker could not resolve.
      return false;
  }
}

/** Whether `node` matches `alt` at any depth, recursing through sequences for depth > 0. */
function matchesAlternative(node: Node, alt: Alternative): boolean {
  if (alt.depth === 0) {
    return matchesLeaf(node, alt.name);
  }
  if (node.type !== "sequence") {
    return false;
  }
  const inner: Alternative = { name: alt.name, depth: alt.depth - 1 };
  return node.items.every((item) => matchesAlternative(item, inner));
}

/**
 * Check `value` against a parsed `type` expression (FR-013, §9.1). Design
 * decision, recorded because §9.1 does not fully settle it: when `value`
 * fails to match **every** alternative, and the expression has **exactly
 * one** alternative with depth ≥ 1 (the common, spec.md-tested shape —
 * `type: string[]`), and `value` is itself a `Sequence`, this reports
 * **one violation per offending item**, pointed at by index — exactly
 * spec.md's own Acceptance Scenario 6 ("the diagnostic points at the
 * offending item, not the sequence"). Every other non-matching case (a
 * genuine union with more than one alternative, or a depth-0-only
 * expression, or a non-Sequence value) reports one violation at the
 * value's own top-level position. A genuine union mixing array and
 * non-array alternatives where a Sequence partially matches one array
 * alternative's items is treated the same as any other whole-value
 * mismatch — extending item-level blame to that case was judged not worth
 * the added complexity for a rule spec.md's own scenarios never exercise.
 */
export function checkType(expr: TypeExpression, value: Node): ViolationSite[] {
  if (expr.alternatives.some((alt) => matchesAlternative(value, alt))) {
    return [];
  }

  const arrayAlternatives = expr.alternatives.filter((alt) => alt.depth >= 1);
  if (expr.alternatives.length === 1 && arrayAlternatives.length === 1 && value.type === "sequence") {
    const inner: Alternative = { name: expr.alternatives[0]!.name, depth: expr.alternatives[0]!.depth - 1 };
    const sites: ViolationSite[] = [];
    value.items.forEach((item, index) => {
      if (!matchesAlternative(item, inner)) {
        sites.push({
          pointerSuffix: [index],
          node: item,
          reason: { kind: "type-mismatch", expectedDescription: describeAlternative(inner), actualDescription: describeActual(item) },
        });
      }
    });
    return sites;
  }

  return [{ pointerSuffix: [], node: value, reason: { kind: "type-mismatch", expectedDescription: describeExpression(expr), actualDescription: describeActual(value) } }];
}

/** Parse a `type` demand's source text, or `undefined` if the value is not a string scalar (wrong-shape — silently not-applicable per this module's own doc; US4 refuses it) or does not parse (also silently not-applicable here; US4's `malformed-type-expression` refusal happens in vocabulary.ts, not here). */
export function parseTypeDemand(value: Node): TypeExpression | undefined {
  if (value.type !== "scalar" || value.kind !== "string") {
    return undefined;
  }
  const parsed = parseTypeExpression(value.value);
  if (!parsed.ok) {
    return undefined;
  }
  if (unresolvedAlternatives(parsed.value).length > 0) {
    // An unresolvable name would silently match nothing under
    // matchesLeaf's default branch, which happens to be the right
    // behavior for a demand the checker cannot enforce — but FR-012
    // requires this to be *refused*, not silently permissive; that
    // refusal is vocabulary.ts's job (US4), so this leaf-check layer
    // simply declines to check at all rather than reporting a
    // misleading type-mismatch for a name that was never resolvable in
    // the first place.
    return undefined;
  }
  return parsed.value;
}

// --- min / max -----------------------------------------------------------

function numericValueOf(node: Node): bigint | number | undefined {
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
export function checkMin(boundNode: Node, value: Node): ViolationSite[] {
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
export function checkMax(boundNode: Node, value: Node): ViolationSite[] {
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

function intBoundOf(node: Node): bigint | undefined {
  return node.type === "scalar" && node.kind === "int" ? node.value : undefined;
}

/** `minLength`/`maxLength` count **code points**, not UTF-16 units (research.md's probe; §4.2's model-wide rule). `[...value].length` iterates by code point. No-op for a non-string value or non-int bound. */
function codePointLength(value: string): number {
  return [...value].length;
}

export function checkMinLength(boundNode: Node, value: Node): ViolationSite[] {
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

export function checkMaxLength(boundNode: Node, value: Node): ViolationSite[] {
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
export function checkPattern(patternNode: Node, value: Node): ViolationSite[] {
  if (patternNode.type !== "scalar" || patternNode.kind !== "string" || value.type !== "scalar" || value.kind !== "string") {
    return [];
  }
  let regex: RegExp;
  try {
    regex = new RegExp(patternNode.value, "u");
  } catch {
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
export function checkEnum(enumNode: Node, value: Node): ViolationSite[] {
  if (enumNode.type !== "sequence") {
    return [];
  }
  if (enumNode.items.some((member) => nodesEqual(member, value))) {
    return [];
  }
  const allowedDescription = `[${enumNode.items.map(describeMemberForMessage).join(", ")}]`;
  return [{ pointerSuffix: [], node: value, reason: { kind: "enum-violated", allowedDescription } }];
}

function describeMemberForMessage(node: Node): string {
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
export function requiredViolationCause(value: Node | undefined): "absent" | "null" | undefined {
  if (value === undefined) {
    return "absent";
  }
  if (value.type === "scalar" && value.kind === "null") {
    return "null";
  }
  return undefined;
}
