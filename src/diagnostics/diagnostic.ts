/**
 * The Diagnostic shape — SPEC.md §10, data-model.md "Diagnostic", FR-018.
 *
 * `related` is what lets a duplicate key report **both** occurrences: the
 * underlying reader reports only the second, and the first is recoverable
 * by scanning key positions (research D6), so this field is load-bearing,
 * not decorative.
 *
 * **v0.4 additive fields** (specs/004-constraint-checker/data-model.md
 * "Diagnostic — additive fields"): `pointer`, `demand`, and
 * `pedigreePosition` are what constitution Principle III's gate 5 names as
 * arriving with the constraint checker — an RFC 6901 pointer, the violated
 * demand, and a pedigree position, on top of the never-phasing
 * code+sentence+primary-span floor every earlier milestone already
 * satisfies. All three are **optional**, so every pre-v0.4 construction
 * site in this codebase keeps compiling and keeps its existing assertions
 * valid with no edits — the floor never narrows, it only grows the ceiling
 * a `src/validate/`-produced diagnostic is held to.
 *
 * `demand` is typed in primitives (`pointer: string` + `SourceSpan`),
 * never in `src/merge/`'s `Layer` — `src/diagnostics/` may not import
 * `src/merge/` (`tests/unit/layering.test.ts`), and a `Layer`-typed field
 * here would invert that dependency direction for the sake of one caller.
 */

import type { SourceSpan } from "../model/span.js";
import type { DiagnosticCode } from "./codes.js";

/** An additional position relevant to a diagnostic, with a label explaining why. */
export interface RelatedSpan {
  /** What this span is, e.g. "first occurrence". */
  readonly label: string;
  readonly span: SourceSpan;
}

/**
 * The violated demand's own position (v0.4, FR-022) — a pointer into its
 * **declaring** document, distinct from `Diagnostic.pointer`, which is
 * into the **merged** configuration. Primitives only; see this module's
 * doc comment for why `Layer` may not appear here.
 */
export interface ViolatedDemand {
  /** RFC 6901 pointer into the declaring schema document, e.g. `/keys/styles/demand`. */
  readonly pointer: string;
  /** Where in that document. */
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
  /** RFC 6901 pointer into the **merged** configuration (v0.4 FR-024). Absent before v0.4. */
  readonly pointer?: string;
  /** The violated demand's own pointer and span (v0.4 FR-022). Absent before v0.4. */
  readonly demand?: ViolatedDemand;
  /** The declaring layer's rank in precedence order, 0 = root schema (v0.4). Absent before v0.4. */
  readonly pedigreePosition?: number;
}

/** Construct a Diagnostic. `related` defaults to the empty list; `pointer`/`demand`/`pedigreePosition` default to absent. */
export function createDiagnostic(fields: {
  code: DiagnosticCode;
  message: string;
  primary: SourceSpan;
  related?: readonly RelatedSpan[];
  pointer?: string;
  demand?: ViolatedDemand;
  pedigreePosition?: number;
}): Diagnostic {
  return {
    code: fields.code,
    message: fields.message,
    primary: fields.primary,
    related: fields.related ?? [],
    ...(fields.pointer !== undefined ? { pointer: fields.pointer } : {}),
    ...(fields.demand !== undefined ? { demand: fields.demand } : {}),
    ...(fields.pedigreePosition !== undefined ? { pedigreePosition: fields.pedigreePosition } : {}),
  };
}
