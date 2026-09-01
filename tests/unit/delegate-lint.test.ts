/**
 * v0.7 FR-005, SPEC.md §8.1 — closing v0.6's own unanswered Edge Case: a key
 * granted `delegate: allow` whose own `demand` is a leaf shape an inline
 * string would satisfy must produce an `info` lint, not a refusal, naming
 * that an inline string there is loaded, not matched.
 *
 * Hand-derived expectation, not copied from a first implementation run:
 * `delegate-inline-string-loaded` at `level: "info"`, positioned at the
 * `delegate: allow` value's own span, on schema.yaml's fifth line (`keys:`
 * is line 1, `note:` line 2, `demand:` line 3, `type: string` line 4,
 * `delegate: allow` line 5). Resolution succeeds (`ok: true`) because the config never touches
 * `note` at all — the lint fires purely from the schema's own declaration
 * at grant-collection time, independent of any config value (US1
 * Acceptance Scenario 4's own framing: "a schema granting delegate: allow
 * on a key demanding type: string").
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { resolve } from "../../src/index.js";

const FIXTURE_DIR = join(__dirname, "..", "corpus", "cases", "validate-delegation", "delegate-leaf-shape-lint");

describe("v0.7 FR-005 — delegate: allow at a leaf-shaped demand lints, does not refuse", () => {
  it("resolves ok:true and carries exactly one info diagnostic naming the ambiguity", async () => {
    const result = await resolve(join(FIXTURE_DIR, "config.yaml"), { sandboxRoot: FIXTURE_DIR });
    if (!result.ok) {
      throw new Error(`expected ok:true, got diagnostics: ${result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; ")}`);
    }
    expect(result.diagnostics).toHaveLength(1);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.code).toBe("delegate-inline-string-loaded");
    expect(diagnostic?.level).toBe("info");
    expect(diagnostic?.primary.line).toBe(5);
    expect(diagnostic?.primary.origin.id).toBe(join(FIXTURE_DIR, "schema.yaml"));
  });

  it("a key granted delegate: allow demanding type: mapping (not a leaf shape) produces no lint", async () => {
    // Reuses v0.6's own basic-grant fixture — `network` demands `type: mapping`, not a leaf shape a string would satisfy.
    const dir = join(__dirname, "..", "corpus", "cases", "validate-delegation", "basic-grant");
    const result = await resolve(join(dir, "config.yaml"), { sandboxRoot: dir });
    if (!result.ok) {
      throw new Error(`expected ok:true, got diagnostics: ${result.diagnostics.map((d) => d.code).join(", ")}`);
    }
    expect(result.diagnostics).toEqual([]);
  });
});
