/**
 * v0.6 FR-012b, spec.md US3 Acceptance Scenario 4 -- a fragment reached
 * through two delegation hops carries a two-hop breadcrumb, outermost
 * first: config.yaml -> hop-a.yaml -> hop-b.yaml (the violating value).
 */

import { describe, expect, it } from "vitest";
import { resolve, merge, validate } from "../../src/index.js";
import path from "node:path";

describe("v0.6 FR-012b -- a two-hop delegation chain carries a two-hop breadcrumb, outermost first", () => {
  it("names config.yaml then hop-a.yaml, in that order", async () => {
    const dir = path.join(__dirname, "../corpus/cases/validate-delegation/two-hop-breadcrumb");
    const resolved = await resolve(path.join(dir, "config.yaml"), { sandboxRoot: dir });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const merged = merge(resolved);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const result = validate(merged.configuration);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    const hops = result.diagnostics[0]?.delegatedFrom;
    expect(hops).toHaveLength(2);
    expect(hops?.[0]?.span.origin.label.endsWith("config.yaml")).toBe(true);
    expect(hops?.[0]?.span.line).toBe(2);
    expect(hops?.[0]?.span.column).toBe(10);
    expect(hops?.[1]?.span.origin.label.endsWith("hop-a.yaml")).toBe(true);
    expect(hops?.[1]?.span.line).toBe(1);
    expect(hops?.[1]?.span.column).toBe(10);
  });
});
