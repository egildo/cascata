/**
 * The root→leaf walk — SPEC.md §5.4, §10; v0.4 FR-013 through FR-021,
 * FR-027 through FR-031; specs/004-constraint-checker/contracts/
 * validate-api.md.
 *
 * **Foundational-phase stub** (tasks.md T012): checks nothing yet. Every
 * user story phase fills this in — User Story 1 adds single-layer leaf
 * checking, User Story 2 extends it to every layer root-to-leaf, User
 * Story 3 adds `required`'s post-merge timing, User Story 4 adds
 * closed-vocabulary refusal. Kept as its own file from the start (rather
 * than inlined into `src/index.ts`) so `validate()` stays a thin
 * orchestrator, matching `merge()`'s own relationship to
 * `foldConfiguration`.
 */

import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { MergedConfiguration } from "../merge/provenance.js";

export type CheckOutcome = { readonly ok: true } | { readonly ok: false; readonly diagnostics: Diagnostic[] };

/** Check `configuration` against every schema layer's `demand`. Stub: always succeeds. */
export function checkConfiguration(configuration: MergedConfiguration): CheckOutcome {
  void configuration;
  return { ok: true };
}
