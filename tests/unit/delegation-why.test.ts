/**
 * v0.6 FR-020, spec.md US3 Acceptance Scenario 3 -- `why()` on a pointer
 * inside a fragment carries the delegation breadcrumb alongside the
 * contributing layer, exactly as a diagnostic does. Reuses
 * `tests/corpus/cases/validate-delegation/violation-in-fragment/` (T028's
 * own fixture): `/network/host` is delegated from `config.yaml:2`.
 */

import { describe, expect, it } from "vitest";
import { resolve, merge, why } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";
import path from "node:path";

describe("v0.6 FR-020 -- why() carries the breadcrumb for a value inside a fragment", () => {
  it("answers with a chain entry whose delegatedFrom names the delegating position", async () => {
    const dir = path.join(__dirname, "../corpus/cases/validate-delegation/violation-in-fragment");
    const resolved = await resolve(path.join(dir, "config.yaml"), { host: createNodeHost(), sandboxRoot: dir });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const merged = merge(resolved);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;

    const result = why(merged.configuration, "/network/host");
    expect(result.kind).toBe("chain");
    if (result.kind !== "chain") return;
    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0];
    expect(entry?.delegatedFrom).toBeDefined();
    expect(entry?.delegatedFrom?.[0]?.span.line).toBe(2);
    expect(entry?.delegatedFrom?.[0]?.span.column).toBe(10);

    // A pointer that was never delegated carries no breadcrumb at all
    // (FR-018's rule, applied here too) -- /other is config-authored,
    // written directly, never through a fragment.
    const otherResult = why(merged.configuration, "/other");
    expect(otherResult.kind).toBe("chain");
    if (otherResult.kind !== "chain") return;
    expect(otherResult.entries[0]?.delegatedFrom).toBeUndefined();
  });
});
