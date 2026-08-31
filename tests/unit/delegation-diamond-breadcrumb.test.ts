/**
 * v0.6 FR-013a — one fragment grafted at two points must carry two
 * independent breadcrumbs, never one shared between them ("a single
 * shared graph node would be wrong precisely because it could carry
 * only one breadcrumb", spec.md's own Key Entities section).
 *
 * `tests/corpus/validate-cases/T013-diamond-fragment.json` already
 * exercises this fixture, but the corpus harness's own expectation
 * schema (`tests/corpus/validate-case.ts`) has no field for asserting a
 * diagnostic's own `delegatedFrom` chain — only `code`/`document`/
 * `line`/`column`/`pointer`/`demand`/`pedigreePosition`. The offending
 * *value*'s own primary span never moves when the breadcrumb is wrong
 * (only the breadcrumb's own reported position does), so the corpus
 * case alone cannot catch the mandated sabotage (dropping the per-graft
 * breadcrumb) even though it is the fixture built for exactly that —
 * this file asserts the field the corpus harness cannot.
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
