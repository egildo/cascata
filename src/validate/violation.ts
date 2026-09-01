/**
 * The `Demand`/`Violation` entities and §10's canonical sentence —
 * specs/004-constraint-checker/data-model.md "Demand", "Violation";
 * v0.4 FR-022 through FR-026.
 *
 * §10: "Canonical error sentence: `constraint from house.yaml:7
 * (/keys/styles/demand) rejected value from conf.network.yaml:3`." FR-025
 * requires this to be renderable from a `Violation`'s structured fields
 * alone, with no string assembly at any call site — `canonicalSentence`
 * below is the one place that assembly happens.
 */

import type { SourceSpan } from "../model/span.js";
import type { DelegationHop } from "../model/reference.js";
import type { Layer } from "../merge/provenance.js";
import { createDiagnostic, type Diagnostic } from "../diagnostics/diagnostic.js";
import type { DiagnosticCode } from "../diagnostics/codes.js";

/**
 * One constraint declared on one key by one schema layer
 * (data-model.md "Demand"). `pointer` is into the **declaring** document —
 * e.g. `/keys/styles/demand/type` — distinct from a `Violation`'s
 * `mergedPointer`, which is into the merged configuration.
 *
 * **v0.5**: dropped the v0.4-era `keyword`/`value` fields — neither was
 * ever read by anything downstream (`renderViolation`/`canonicalSentence`
 * consume only `layer`/`layerRank`/`pointer`/`span`), and both became
 * awkward to populate honestly once a violation could be attributed to a
 * *resolved named type's own* demand rather than only a usage's — every
 * caller that built one was fabricating a placeholder `value` no reader
 * ever looked at. `pointer`'s own last segment already names the keyword
 * for anyone who wants it, so nothing is lost.
 */
export interface Demand {
  readonly layer: Layer;
  readonly layerRank: number;
  readonly pointer: string;
  readonly span: SourceSpan;
}

export type ViolationReason =
  | { readonly kind: "type-mismatch"; readonly expectedDescription: string; readonly actualDescription: string }
  | { readonly kind: "range-violated"; readonly bound: "min" | "max"; readonly boundDescription: string; readonly actualDescription: string }
  | { readonly kind: "length-violated"; readonly bound: "minLength" | "maxLength"; readonly boundValue: bigint; readonly actualLength: number }
  | { readonly kind: "pattern-mismatch"; readonly pattern: string }
  | { readonly kind: "enum-violated"; readonly allowedDescription: string }
  | { readonly kind: "required-violated"; readonly cause: "absent" | "null" }
  | { readonly kind: "depth-limit-exceeded"; readonly maxDepth: number }
  | { readonly kind: "seal-violated"; readonly childKey: string };

/**
 * The pairing of one violated `Demand` with the value that broke it, at
 * one pointer into the merged configuration (data-model.md "Violation").
 *
 * `valueSpan`/`valueLayer` are the offending value's own — read directly
 * off the merged tree's node (`value.span`) and matched against
 * `MergedConfiguration.layers` by `identity.location === span.origin.id`
 * (v0.4 FR-023; plan.md's finding 3), never looked up via the provenance
 * record.
 */
export interface Violation {
  readonly demand: Demand;
  readonly mergedPointer: string;
  readonly valueSpan: SourceSpan;
  readonly valueLayer: Layer;
  readonly reason: ViolationReason;
  /**
   * v0.6: the delegation chain that reached `valueSpan`, outermost
   * first — absent, never empty, when the value was never delegated
   * (v0.4 FR-026's rule, v0.6 FR-018).
   */
  readonly delegatedFrom?: readonly DelegationHop[];
}

const CODE_FOR_REASON: { readonly [K in ViolationReason["kind"]]: DiagnosticCode } = {
  "type-mismatch": "type-mismatch",
  "range-violated": "range-violated",
  "length-violated": "length-violated",
  "pattern-mismatch": "pattern-mismatch",
  "enum-violated": "enum-violated",
  "required-violated": "required-violated",
  "depth-limit-exceeded": "depth-limit-exceeded",
  "seal-violated": "seal-violation",
};

/**
 * §10's **identity** of a violation — "one violated demand at one position
 * is one diagnostic" (amended v1.0, §15).
 *
 * Three components, and every one of them is something §10 already names:
 *
 * - **the code**, which is what a machine branches on;
 * - **the violated demand**, which §10 defines as "its declaring layer +
 *   span, as a JSON Pointer per RFC 6901 into that document" — so the
 *   pointer alone is *not* the demand. Two layers may legitimately declare
 *   the identical pointer and both fire under whole-chain validation
 *   (§5.4); collapsing those would delete a real diagnostic. `layerRank`
 *   is the component that keeps them apart, and it is exactly what
 *   `renderViolation` publishes as `pedigreePosition`;
 * - **the offending value's position**, its merged-configuration pointer.
 *
 * Deliberately *not* the message, the spans, or the reason's own payload.
 * Keying on those would make the rule "collapse things that are already
 * equal", which is unfalsifiable — the point is that a diagnostic is
 * identified by what §10 says identifies it, and
 * `tests/unit/composition-bound.test.ts` separately asserts that the
 * duplicates this collapses are in fact identical in every readable field,
 * so a future field that legitimately varied could not be silently lost.
 *
 * Lives here, beside `canonicalSentence`, because both are §10's own
 * statements about a diagnostic and neither belongs to the walk that
 * happens to produce one.
 */
export function violationIdentity(violation: Violation): string {
  // U+0000 separates: it cannot occur in an RFC 6901 pointer or in a
  // diagnostic code, so no two distinct triples render to one string.
  return `${CODE_FOR_REASON[violation.reason.kind]}\u0000${violation.demand.pointer}\u0000${violation.demand.layerRank}\u0000${violation.mergedPointer}`;
}

/**
 * Collapse violations sharing §10's identity, keeping the **first**
 * occurrence — first, so the surviving diagnostic's order is the order the
 * walk produced (v1.0 FR-005's "same order").
 *
 * **This is called as results accumulate, not only at the end**, and the
 * distinction is the whole fix. Where §9's `keys` and `values` both cover
 * an entry and both recurse into one shared type, each arm returns the
 * same violation and the list doubles at every level up: a 296-byte
 * configuration at depth 24 produced 2^24 copies and exhausted memory
 * *while the lists were being assembled*, long before any final pass could
 * run. `src/validate/check.ts` collapses inside `checkNamedType`, before
 * caching, so every level hands its caller a bounded list; it collapses
 * once more over the whole set afterwards, which is what makes §10's rule
 * total rather than a property of the named-type path alone.
 */
export function dedupeViolations(violations: readonly Violation[]): Violation[] {
  const seen = new Set<string>();
  const kept: Violation[] = [];
  for (const violation of violations) {
    const identity = violationIdentity(violation);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    kept.push(violation);
  }
  return kept;
}

/** One human sentence describing `reason` — the `Diagnostic.message`, distinct from `canonicalSentence` below (§10's own, separately specified, machine-checked format). */
function describeReason(reason: ViolationReason): string {
  switch (reason.kind) {
    case "type-mismatch":
      return `expected ${reason.expectedDescription}, got ${reason.actualDescription}`;
    case "range-violated":
      return `expected ${reason.bound} ${reason.boundDescription}, got ${reason.actualDescription}`;
    case "length-violated":
      return `expected ${reason.bound} ${reason.boundValue}, got length ${reason.actualLength}`;
    case "pattern-mismatch":
      return `value does not match pattern /${reason.pattern}/`;
    case "enum-violated":
      return `value is not one of ${reason.allowedDescription}`;
    case "required-violated":
      return reason.cause === "absent" ? "required key is absent" : "required key is explicitly null, which required forbids (SPEC.md §5.5)";
    case "depth-limit-exceeded":
      return `nested demand exceeds the ${reason.maxDepth}-level limit (v0.5 FR-025)`;
    case "seal-violated":
      return `key '${reason.childKey}' is not declared by this demand's own 'keys' vocabulary, and this position is sealed 'seal: closed' — a closed struct refuses any key the declared vocabulary does not name (SPEC.md §6.3, v0.7 FR-007)`;
  }
}

/**
 * §10's canonical sentence, assembled from `violation`'s structured
 * fields alone (FR-025) — no call site anywhere else in this codebase may
 * build this string itself.
 *
 * `constraint from <demand's document>:<line> (<demand's pointer>)
 * rejected value from <value's document>:<line>`
 */
export function canonicalSentence(violation: Violation): string {
  const demandDoc = violation.demand.span.origin.label;
  const demandLine = violation.demand.span.line;
  const valueDoc = violation.valueSpan.origin.label;
  const valueLine = violation.valueSpan.line;
  const base = `constraint from ${demandDoc}:${demandLine} (${violation.demand.pointer}) rejected value from ${valueDoc}:${valueLine}`;
  if (violation.delegatedFrom === undefined || violation.delegatedFrom.length === 0) {
    return base;
  }
  const chain = violation.delegatedFrom.map((hop) => `${hop.span.origin.label}:${hop.span.line}`).join(" -> ");
  return `${base} (delegated from ${chain})`;
}

/**
 * Render one `Violation` into a `Diagnostic` — every v0.4 additive field
 * populated (gate 5 at full strength), `message` combining
 * `describeReason` with the canonical sentence so a reader gets both the
 * specific reason and the standard cross-reference in one place.
 *
 * **v0.7 part 2: `options.omitMergedPointer`.** `Diagnostic.pointer` is a
 * pointer into the *merged configuration*, and one kind of violation has
 * no position there at all: a `directives:` violation. Reserved keys are
 * directives rather than data and never enter a configuration (§9), so a
 * pointer naming one would name something that does not exist — worse
 * than absent, because a consumer would resolve it and get nothing. The
 * field is therefore left off, which is the posture `vocabulary.ts` has
 * always taken for a problem found in a schema document rather than at a
 * merged position. Optional, so no existing call site changes and no
 * existing assertion moves.
 */
export function renderViolation(violation: Violation, options?: { readonly omitMergedPointer?: boolean }): Diagnostic {
  return createDiagnostic({ level: "error",
    code: CODE_FOR_REASON[violation.reason.kind],
    message: `${describeReason(violation.reason)} — ${canonicalSentence(violation)}`,
    primary: violation.valueSpan,
    ...(options?.omitMergedPointer === true ? {} : { pointer: violation.mergedPointer }),
    demand: { pointer: violation.demand.pointer, span: violation.demand.span },
    pedigreePosition: violation.demand.layerRank,
    ...(violation.delegatedFrom !== undefined ? { delegatedFrom: violation.delegatedFrom } : {}),
  });
}
