/**
 * v0.6 FR-012a — recursive delegation is depth-bounded, `MAX_DELEGATION_DEPTH`
 * (research.md D5).
 *
 * **Why this is a unit test of `DelegationCycleTracker` directly, not a
 * `tests/corpus/` fixture through `resolve()` (Acceptance Scenario left
 * otherwise untested end to end — flagged in the milestone report, not
 * papered over).** research.md D5, as first written, claimed the bound
 * was "verified reachable... each hop needs a distinct real file, never
 * bounded by any single parse call's own depth cap" — this was
 * **checked, and found wrong**, while building this very test.
 * Delegation's own grant-continuation is schema-structure-bound (a
 * fragment's own further delegation is governed by whatever the
 * *schema* nests beneath the position that was just grafted, v0.6
 * FR-012), so reaching semantic delegation-hop depth D through
 * schema-declared named-key recursion costs the schema document itself
 * roughly `3D` raw YAML nesting levels (a `keys:`/`<name>:`/`demand:`
 * triple per hop) — the identical "named nesting costs raw YAML depth"
 * fact v0.5's own `MAX_DEMAND_DEPTH` finding already established, now
 * rediscovered for a second, structurally different guard. Built and
 * ran a schema with 25 self-nested `network` levels to confirm this
 * directly (not assumed): it fails to parse at YAML depth 65 — v0.1's
 * own cap — reached at semantic delegation depth ~21, twenty-nine
 * fewer than `MAX_DELEGATION_DEPTH` (64). There is therefore no schema
 * `resolve()` will even accept that could exercise the delegation depth
 * guard through named-key recursion at all.
 *
 * `DelegationCycleTracker` (`src/index.ts`) is exported specifically so
 * its own depth/cycle logic can be tested directly, bypassing both
 * `resolve()`'s file-reading (which the real algorithm genuinely needs,
 * unlike v0.5's `validate()`, which could take a hand-built
 * `MergedConfiguration` with no I/O at all) and the schema-parse
 * ceiling above. This proves the *mechanism* is correct; it does not,
 * and cannot currently, prove it is reachable end to end — that
 * negative finding is the point of this file's own header.
 */

import { describe, expect, it } from "vitest";
import { DelegationCycleTracker, MAX_DELEGATION_DEPTH } from "../../src/index.js";

describe("v0.6 FR-012a — DelegationCycleTracker's own depth/cycle boundary", () => {
  it("accepts exactly MAX_DELEGATION_DEPTH nested locations, refusing the next", () => {
    const tracker = new DelegationCycleTracker(MAX_DELEGATION_DEPTH);
    for (let i = 0; i < MAX_DELEGATION_DEPTH; i += 1) {
      const outcome = tracker.enter(`fragment-${i}.yaml`);
      expect(outcome, `entry ${i} of ${MAX_DELEGATION_DEPTH} should be accepted`).toBe("ok");
    }
    const overflow = tracker.enter(`fragment-${MAX_DELEGATION_DEPTH}.yaml`);
    expect(overflow).toBe("depth-limit-exceeded");
  });

  it("detects a cycle: a location already on the active stack refuses, distinct from a depth overflow", () => {
    const tracker = new DelegationCycleTracker(MAX_DELEGATION_DEPTH);
    expect(tracker.enter("a.yaml")).toBe("ok");
    expect(tracker.enter("b.yaml")).toBe("ok");
    expect(tracker.enter("a.yaml")).toBe("cycle");
  });

  it("exit() pops the active stack, so a location fully resolved and exited can be entered again without being mistaken for a cycle", () => {
    const tracker = new DelegationCycleTracker(MAX_DELEGATION_DEPTH);
    expect(tracker.enter("a.yaml")).toBe("ok");
    tracker.exit();
    expect(tracker.enter("a.yaml"), "a.yaml is no longer active once its own visit has closed").toBe("ok");
  });
});
