/**
 * The Diagnostic shape — SPEC.md §10, data-model.md "Diagnostic", FR-018.
 *
 * `related` is what lets a duplicate key report **both** occurrences: the
 * underlying reader reports only the second, and the first is recoverable
 * by scanning key positions (research D6), so this field is load-bearing,
 * not decorative.
 */

import type { SourceSpan } from "../model/span.js";
import type { DiagnosticCode } from "./codes.js";

/** An additional position relevant to a diagnostic, with a label explaining why. */
export interface RelatedSpan {
  /** What this span is, e.g. "first occurrence". */
  readonly label: string;
  readonly span: SourceSpan;
}

/** One refusal. Positions are the point (SPEC.md §10). */
export interface Diagnostic {
  /** Stable, machine-readable — see contracts/diagnostics.md. */
  readonly code: DiagnosticCode;
  /** One human sentence. */
  readonly message: string;
  /** The span the problem is at. Never absent. */
  readonly primary: SourceSpan;
  /** Zero or more additional labelled spans. */
  readonly related: readonly RelatedSpan[];
}

/** Construct a Diagnostic. `related` defaults to the empty list. */
export function createDiagnostic(fields: {
  code: DiagnosticCode;
  message: string;
  primary: SourceSpan;
  related?: readonly RelatedSpan[];
}): Diagnostic {
  return {
    code: fields.code,
    message: fields.message,
    primary: fields.primary,
    related: fields.related ?? [],
  };
}
