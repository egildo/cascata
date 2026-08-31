/**
 * v0.6 FR-014, SC-001, spec.md US2 Acceptance Scenario 1 — the
 * milestone's own central claim: a configuration split across fragments
 * produces a merged tree identical, in shape and value, to the same
 * configuration written inline. `tests/corpus/cases/validate-delegation/
 * inline-identity-{inline,split}/` are the same schema and the same
 * logical configuration, one written as a single file, the other split
 * at the one delegable key — this test resolves and merges both and
 * asserts `nodesEqual` on the resulting trees, which is `SPEC.md` §4.2's
 * own model-equality definition, not a hand-rolled comparison.
 */

import { describe, expect, it } from "vitest";
import { resolve, merge, nodesEqual } from "../../src/index.js";
import path from "node:path";

describe("v0.6 FR-014 — a split configuration is semantically identical to the inline original", () => {
  it("produces a byte-identical (nodesEqual) merged tree, inline vs. split", async () => {
    const inlineDir = path.join(__dirname, "../corpus/cases/validate-delegation/inline-identity-inline");
    const splitDir = path.join(__dirname, "../corpus/cases/validate-delegation/inline-identity-split");

    const inlineResolved = await resolve(path.join(inlineDir, "config.yaml"), { sandboxRoot: inlineDir });
    const splitResolved = await resolve(path.join(splitDir, "config.yaml"), { sandboxRoot: splitDir });
    expect(inlineResolved.ok, "inline resolve() should succeed").toBe(true);
    expect(splitResolved.ok, "split resolve() should succeed").toBe(true);
    if (!inlineResolved.ok || !splitResolved.ok) return;

    const inlineMerged = merge(inlineResolved);
    const splitMerged = merge(splitResolved);
    expect(inlineMerged.ok, "inline merge() should succeed").toBe(true);
    expect(splitMerged.ok, "split merge() should succeed").toBe(true);
    if (!inlineMerged.ok || !splitMerged.ok) return;

    expect(nodesEqual(inlineMerged.configuration.tree, splitMerged.configuration.tree), "the two merged trees must be model-equal (SPEC.md §4.2) despite one being assembled from a fragment").toBe(true);
  });
});
