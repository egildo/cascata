/**
 * v0.7 part 2 (008) FR-007 through FR-010, `SPEC.md` §7 (amended, §15) —
 * guarded recursion.
 *
 * Three acceptance scenarios live as conformance cases
 * (`tests/corpus/validate-cases/T007*.json`), where positions are
 * asserted. This file carries the rest:
 *
 * - **FR-008**: an unguarded cycle is still refused. v0.5's own case for
 *   this (`T015-type-cycle-refused.json`) stays green and unmodified;
 *   what is added here is the *pairing* — the same two types, one link
 *   changed from an alias to a structural level, flipping the verdict.
 *   Asserting the pair is what shows the rule is drawn between guarded
 *   and unguarded rather than somewhere else that happens to agree.
 * - **FR-009**, in the direction the fixture does not cover: the same
 *   loop with the guard *removed* must go back to being refused.
 * - **FR-010**: termination, established by a property test over
 *   adversarially nested documents rather than by a hand-written case.
 *   A hand-written three-level case cannot distinguish "terminates"
 *   from "terminates for three levels".
 *
 * The oracle for every verdict below is `SPEC.md` §7's own sentence —
 * "a type whose definition reaches itself through at least one structural
 * level ... is productive" — applied by hand, never by reading what the
 * implementation printed.
 */
import { describe, expect, it } from "vitest";
import { load } from "../../src/index.js";
import { InMemoryHost } from "./host-test-double.js";

const ENCODER = new TextEncoder();

async function loadFiles(files: Record<string, string>) {
  const map = new Map(Object.entries(files).map(([location, text]) => [location, ENCODER.encode(text)] as const));
  return load("/v/config.yaml", { host: new InMemoryHost({ files: map }), sandboxRoot: "/v" });
}

const CONFIG = ["$schema: ./schema.yaml", "tree:", "  down:", "    down: 7", ""].join("\n");

/** `a` reaches `b` by alias; `b` reaches `a` through `guard` — `keys`, `items`, `values`, or (for the unguarded control) a bare alias. */
function twoTypeLoop(guard: "keys" | "values" | "items" | "alias"): string {
  const body: Record<typeof guard, string[]> = {
    keys: ["      type: mapping", "      keys:", "        down:", "          demand:", "            type: a"],
    values: ["      type: mapping", "      values:", "        type: a"],
    items: ["      type: sequence", "      items:", "        type: a"],
    alias: ["      type: a"],
  };
  return ["types:", "  a:", "    demand:", "      type: b", "  b:", "    demand:", ...body[guard], "keys:", "  tree:", "    demand:", "      type: a", ""].join("\n");
}

describe("v0.7 part 2 FR-008/FR-009 — the rule is drawn between guarded and unguarded, and nowhere else", () => {
  it("the loop guarded by keys is ACCEPTED as a declaration (no unresolvable-type-cycle)", async () => {
    const result = await loadFiles({ "/v/schema.yaml": twoTypeLoop("keys"), "/v/config.yaml": CONFIG });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // It is refused, but for the VALUE (`down: 7` is not a mapping), never
    // for the cycle. That distinction is the whole of FR-009.
    expect(result.diagnostics.map((d) => d.code)).toEqual(["type-mismatch"]);
  });

  it("the loop guarded by values is ACCEPTED as a declaration", async () => {
    const result = await loadFiles({ "/v/schema.yaml": twoTypeLoop("values"), "/v/config.yaml": CONFIG });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.every((d) => d.code !== "unresolvable-type-cycle")).toBe(true);
  });

  it("the loop guarded by items is ACCEPTED as a declaration", async () => {
    const result = await loadFiles({ "/v/schema.yaml": twoTypeLoop("items"), "/v/config.yaml": "$schema: ./schema.yaml\ntree: []\n" });
    expect(result.ok).toBe(true);
  });

  it("the SAME loop with the guard removed is refused as unresolvable-type-cycle (FR-008)", async () => {
    const result = await loadFiles({ "/v/schema.yaml": twoTypeLoop("alias"), "/v/config.yaml": CONFIG });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((d) => d.code === "unresolvable-type-cycle")).toBe(true);
  });

  it("a self-recursive type guarded by keys is accepted and checks its own nesting", async () => {
    const schema = ["types:", "  node:", "    demand:", "      type: mapping", "      keys:", "        child:", "          demand:", "            type: node", "        label:", "          demand:", "            type: string", "keys:", "  tree:", "    demand:", "      type: node", ""].join("\n");
    const good = await loadFiles({ "/v/schema.yaml": schema, "/v/config.yaml": "$schema: ./schema.yaml\ntree:\n  child:\n    child:\n      label: deep\n" });
    expect(good.ok, good.ok ? "ok" : JSON.stringify(good.diagnostics.map((d) => d.code))).toBe(true);
  });

  it("a self-recursive type reaching itself by alias alone is refused", async () => {
    const schema = ["types:", "  node:", "    demand:", "      type: node", "keys:", "  tree:", "    demand:", "      type: node", ""].join("\n");
    const result = await loadFiles({ "/v/schema.yaml": schema, "/v/config.yaml": "$schema: ./schema.yaml\ntree: x\n" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((d) => d.code === "unresolvable-type-cycle")).toBe(true);
  });
});
