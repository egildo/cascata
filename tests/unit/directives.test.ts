/**
 * v0.7 part 2 (008) FR-011 through FR-014, `SPEC.md` §9/§6.1 (amended,
 * §15) — the `directives:` section.
 *
 * The five acceptance scenarios live as conformance cases
 * (`tests/corpus/validate-cases/T011*.json`), where positions are
 * asserted. This file carries what a fixture cannot say:
 *
 * - **US3 Scenario 1's own example**, `$pin` matching
 *   `^sha256:[0-9a-f]{64}$` — a rule §6.1 has stated normatively since it
 *   was written and that no schema has ever been able to *declare*.
 * - **FR-012**: an entry takes a `keys:` entry's whole vocabulary.
 *   `provide`, `cascade`, `final` and `delegate` are accepted and inert.
 * - **FR-013 in both directions**: the reserved key is checked *and* stays
 *   out of the merged configuration. The corpus case asserts the tree; this
 *   one asserts it holds when the directive **fires**, which is the case
 *   where a careless implementation would have had to fetch the key from
 *   somewhere and might have fetched it from the wrong tree.
 * - **`required` against an absent directive** — the one demand keyword
 *   whose behaviour depends on a value *not* being there.
 */
import { describe, expect, it } from "vitest";
import { load } from "../../src/index.js";
import { InMemoryHost } from "./host-test-double.js";

const ENCODER = new TextEncoder();

async function loadFiles(files: Record<string, string>) {
  const map = new Map(Object.entries(files).map(([location, text]) => [location, ENCODER.encode(text)] as const));
  return load("/v/config.yaml", { host: new InMemoryHost({ files: map }), sandboxRoot: "/v" });
}

const PIN_SCHEMA = ["directives:", "  $version:", "    demand:", "      type: int", "      min: 1", "keys:", "  title:", "    demand:", "      type: string", ""].join("\n");

describe("v0.7 part 2 FR-011 — a rule §6.1 has stated since it was written, now declarable", () => {
  it("refuses a $version below the declared minimum, positioned at that $version in the document that carries it", async () => {
    const result = await loadFiles({ "/v/schema.yaml": PIN_SCHEMA, "/v/config.yaml": "$schema: ./schema.yaml\n$version: 0\ntitle: x\n" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.code).toBe("range-violated");
    expect(diagnostic?.primary.origin.label).toBe("/v/config.yaml");
    expect(diagnostic?.primary.line).toBe(2);
    expect(diagnostic?.demand?.pointer).toBe("/directives/$version/demand/min");
    // A directive has no position in the merged configuration, and saying
    // it had one would name something that does not exist.
    expect(diagnostic?.pointer).toBeUndefined();
  });

  it("accepts a $version that satisfies it", async () => {
    const result = await loadFiles({ "/v/schema.yaml": PIN_SCHEMA, "/v/config.yaml": "$schema: ./schema.yaml\n$version: 3\ntitle: x\n" });
    expect(result.ok, result.ok ? "ok" : JSON.stringify(result.diagnostics.map((d) => d.code))).toBe(true);
  });

  it("$pin matching §6.1's own sha256:<64 hex> syntax — the rule that only ever existed as hand-written code", async () => {
    // The subject document carries a malformed `$pin`. It is checked as
    // *data about that document*, which is what a meta-schema does.
    const schema = ["directives:", "  $pin:", "    demand:", "      type: string", "      pattern: '^sha256:[0-9a-f]{64}$'", "keys:", "  title:", "    demand:", "      type: string", ""].join("\n");
    const bad = await loadFiles({ "/v/schema.yaml": schema, "/v/config.yaml": "$schema: ./schema.yaml\n$pin: sha256:NOTAHASH\ntitle: x\n" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.diagnostics.some((d) => d.code === "pattern-mismatch" && d.demand?.pointer === "/directives/$pin/demand/pattern")).toBe(true);

    const good = await loadFiles({ "/v/schema.yaml": schema, "/v/config.yaml": `$schema: ./schema.yaml\n$pin: sha256:${"a".repeat(64)}\ntitle: x\n` });
    expect(good.ok, good.ok ? "ok" : JSON.stringify(good.diagnostics.map((d) => `${d.code}: ${d.message}`))).toBe(true);
  });
});

describe("v0.7 part 2 FR-012 — a directives: entry takes the same per-key vocabulary a keys: entry takes", () => {
  it("provide, cascade, final and delegate are accepted and inert", async () => {
    const schema = ["directives:", "  $version:", "    demand:", "      type: int", "    provide: 9", "    cascade: replace", "    final: true", "    delegate: allow", "keys:", "  title:", "    demand:", "      type: string", ""].join("\n");
    const result = await loadFiles({ "/v/schema.yaml": schema, "/v/config.yaml": "$schema: ./schema.yaml\n$version: 2\ntitle: x\n" });
    expect(result.ok, result.ok ? "ok" : JSON.stringify(result.diagnostics.map((d) => `${d.code}: ${d.message}`))).toBe(true);
    if (!result.ok) return;
    // Inert means inert: `provide: 9` injected nothing, and `$version` is
    // still nowhere in the configuration.
    expect(result.configuration.tree.type).toBe("mapping");
    if (result.configuration.tree.type !== "mapping") return;
    expect([...result.configuration.tree.entries.keys()]).toEqual(["title"]);
  });

  it("a malformed demand inside a directives: entry is refused by the same schema-shape pass keys: entries get", async () => {
    const schema = ["directives:", "  $version:", "    demand:", "      type: int", "      nonsense: 1", "keys:", "  title:", "    demand:", "      type: string", ""].join("\n");
    const result = await loadFiles({ "/v/schema.yaml": schema, "/v/config.yaml": "$schema: ./schema.yaml\n$version: 2\ntitle: x\n" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => [d.code, d.demand?.pointer])).toEqual([["unknown-demand-keyword", "/directives/$version/demand/nonsense"]]);
  });
});

describe("v0.7 part 2 FR-013 — directives: constrains directives; it never promotes one to data", () => {
  it("no reserved key reaches the merged configuration, in the case where the directive FIRES", async () => {
    const result = await loadFiles({ "/v/schema.yaml": PIN_SCHEMA, "/v/config.yaml": "$schema: ./schema.yaml\n$version: 0\ntitle: x\n" });
    // It refused — so it read the key. The question is where from.
    expect(result.ok).toBe(false);
    // And with a satisfying value, the merged tree carries `title` alone:
    // no `$schema`, no `$version`. The fold's stripping rule is untouched.
    const clean = await loadFiles({ "/v/schema.yaml": PIN_SCHEMA, "/v/config.yaml": "$schema: ./schema.yaml\n$version: 1\ntitle: x\n" });
    expect(clean.ok).toBe(true);
    if (!clean.ok) return;
    expect(clean.configuration.tree.type).toBe("mapping");
    if (clean.configuration.tree.type !== "mapping") return;
    expect([...clean.configuration.tree.entries.keys()]).toEqual(["title"]);
  });

  it("required: true against an absent directive refuses — the one keyword whose behaviour needs the value NOT to be there", async () => {
    const schema = ["directives:", "  $id:", "    demand:", "      type: string", "      required: true", "keys:", "  title:", "    demand:", "      type: string", ""].join("\n");
    const result = await loadFiles({ "/v/schema.yaml": schema, "/v/config.yaml": "$schema: ./schema.yaml\ntitle: x\n" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => [d.code, d.demand?.pointer])).toEqual([["required-violated", "/directives/$id/demand/required"]]);
  });
});
