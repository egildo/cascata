/**
 * v0.6 FR-013a — one fragment grafted at two points must carry two
 * independent breadcrumbs, never one shared between them ("a single
 * shared graph node would be wrong precisely because it could carry
 * only one breadcrumb", spec.md's own Key Entities section).
 *
 * **History, kept rather than deleted once the gap it names closed.**
 * When this file was first written, `tests/corpus/validate-case.ts`'s
 * expectation schema had no field for asserting a diagnostic's own
 * `delegatedFrom` chain, so `tests/corpus/validate-cases/
 * T013-diamond-fragment.json` could not catch the mandated sabotage
 * (dropping the per-graft breadcrumb) even though it is the exact
 * fixture built for that — the offending *value*'s own primary span
 * never moves when the breadcrumb is wrong, only the breadcrumb's own
 * position does. `validate-case.ts`/`validate-runner.ts` have since
 * gained a `delegatedFrom` field and T013's own JSON now asserts it
 * directly, closing that gap in the harness itself rather than leaving
 * the breadcrumb permanently unit-test-only. This file is kept anyway:
 * it is a real, independent regression guard (a JSON-schema change to
 * `validate-case.ts` could reintroduce the same blind spot silently),
 * and it is the natural home for the "why a diamond, specifically"
 * reasoning above.
 */

import { describe, expect, it } from "vitest";
import { resolve, merge, validate } from "../../src/index.js";
import path from "node:path";

describe("v0.6 FR-013a — a diamond-grafted fragment carries independent breadcrumbs per graft", () => {
  it("attributes the violation to the graft that actually contains it (backup), not the other graft (primary) of the same fragment file", async () => {
    const dir = path.join(__dirname, "../corpus/cases/validate-delegation/diamond-fragment");
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
    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.pointer).toBe("/backup/host");
    expect(diagnostic?.delegatedFrom).toBeDefined();
    // "backup: ./shared.yaml" is config.yaml's own line 3 (hand-derived,
    // confirmed via a debug run before this assertion was written) --
    // "primary: ./shared.yaml" (line 2) is the *other* graft's own
    // delegating position, which the mandated sabotage (sharing one
    // Origin.id across both grafts) reports instead.
    expect(diagnostic?.delegatedFrom?.[0]?.span.line).toBe(3);
    expect(diagnostic?.delegatedFrom?.[0]?.span.column).toBe(9);
  });
});
