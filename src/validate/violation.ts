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
  | { readonly kind: "depth-limit-exceeded"; readonly maxDepth: number };

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
};

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

/** Render one `Violation` into a `Diagnostic` — every v0.4 additive field populated (gate 5 at full strength), `message` combining `describeReason` with the canonical sentence so a reader gets both the specific reason and the standard cross-reference in one place. */
export function renderViolation(violation: Violation): Diagnostic {
  return createDiagnostic({ level: "error",
    code: CODE_FOR_REASON[violation.reason.kind],
    message: `${describeReason(violation.reason)} — ${canonicalSentence(violation)}`,
    primary: violation.valueSpan,
    pointer: violation.mergedPointer,
    demand: { pointer: violation.demand.pointer, span: violation.demand.span },
    pedigreePosition: violation.demand.layerRank,
    ...(violation.delegatedFrom !== undefined ? { delegatedFrom: violation.delegatedFrom } : {}),
  });
}
