/**
 * v0.6 FR-014, spec.md US2 Acceptance Scenario 2 -- a demand violated in
 * a fragment is violated identically to the same value written inline:
 * same code, same merged pointer, same reason. Only the *position* (and,
 * for the fragment, the breadcrumb) differ, since those genuinely do
 * differ between "this file" and "that file at that line" -- the outcome
 * itself must not.
 *
 * `tests/corpus/cases/validate-delegation/violation-in-fragment/` (T028)
 * and `.../violation-inline-counterpart/` share the identical schema and
 * the identical offending value ("ab", 2 code points, against
 * minLength: 5) -- one delegated, one written directly.
 */

import { describe, expect, it } from "vitest";
import { resolve, merge, validate } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";
import path from "node:path";

describe("v0.6 FR-014 -- a violation inside a fragment is identical in outcome to the same value inline", () => {
  it("produces the same code, pointer, and reason -- only position and breadcrumb differ", async () => {
    const fragmentDir = path.join(__dirname, "../corpus/cases/validate-delegation/violation-in-fragment");
    const inlineDir = path.join(__dirname, "../corpus/cases/validate-delegation/violation-inline-counterpart");

    const fragmentResolved = await resolve(path.join(fragmentDir, "config.yaml"), { host: createNodeHost(), sandboxRoot: fragmentDir });
    const inlineResolved = await resolve(path.join(inlineDir, "config.yaml"), { host: createNodeHost(), sandboxRoot: inlineDir });
    expect(fragmentResolved.ok).toBe(true);
    expect(inlineResolved.ok).toBe(true);
    if (!fragmentResolved.ok || !inlineResolved.ok) return;

    const fragmentMerged = merge(fragmentResolved);
    const inlineMerged = merge(inlineResolved);
    expect(fragmentMerged.ok).toBe(true);
    expect(inlineMerged.ok).toBe(true);
    if (!fragmentMerged.ok || !inlineMerged.ok) return;

    const fragmentResult = validate(fragmentMerged.configuration);
    const inlineResult = validate(inlineMerged.configuration);
    expect(fragmentResult.ok).toBe(false);
    expect(inlineResult.ok).toBe(false);
    if (fragmentResult.ok || inlineResult.ok) return;

    expect(fragmentResult.diagnostics).toHaveLength(1);
    expect(inlineResult.diagnostics).toHaveLength(1);
    const fragmentDiagnostic = fragmentResult.diagnostics[0];
    const inlineDiagnostic = inlineResult.diagnostics[0];

    // The outcome: identical.
    expect(fragmentDiagnostic?.code).toBe(inlineDiagnostic?.code);
    expect(fragmentDiagnostic?.pointer).toBe(inlineDiagnostic?.pointer);
    expect(fragmentDiagnostic?.message.split(" — ")[0]).toBe(inlineDiagnostic?.message.split(" — ")[0]); // the reason clause, before the canonical sentence
    expect(fragmentDiagnostic?.demand?.pointer).toBe(inlineDiagnostic?.demand?.pointer);

    // What differs: the fragment's own diagnostic carries a breadcrumb; the inline one carries none at all (FR-018).
    expect(fragmentDiagnostic?.delegatedFrom).toBeDefined();
    expect(inlineDiagnostic?.delegatedFrom).toBeUndefined();
  });
});
