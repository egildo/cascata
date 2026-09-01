/**
 * v0.7 FR-006 through FR-009, SPEC.md §6.3/§9 (amended) — `seal: open |
 * closed`. Fixture-driven, end to end through `resolve()` -> `merge()`
 * -> `validate()`.
 *
 * **`seal` lives in the `demand` vocabulary**, not as a per-key sibling
 * of `provide`/`cascade`/`final`/`delegate` — a mid-implementation
 * correction (see the milestone report for the full reasoning: `seal`
 * constrains shape and composes by intersection, exactly like
 * `required`/`type`, so it needs to nest and to work inside a named
 * type, neither of which a per-key keyword can do). Its enforcement is
 * **entirely local, per schema layer, per position** — no whole-stack
 * pre-resolution, and no dedicated "weakening" diagnostic: whole-chain
 * validation's own redundancy (SPEC.md §5.4) makes a descendant's
 * attempt to reopen an ancestor's `closed` struct inert by construction,
 * the identical "a widening needs no refusal" precedent SPEC.md §15
 * already established for named-type narrowing. A descendant that wants
 * `seal: closed` to actually admit different children than an ancestor's
 * own closed declaration must **fully restate** that position's demand
 * (type, keys, and seal together) — redeclaring a demand is whole-layer
 * replacement, not an incremental patch, matching how named types
 * already redeclare (`src/validate/types.ts`).
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { merge, resolve, validate, type Diagnostic } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";

const CASES_DIR = join(__dirname, "..", "corpus", "cases", "seal");

type PipelineResult = { readonly ok: true; readonly diagnostics: readonly Diagnostic[] } | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

async function runPipeline(caseName: string): Promise<PipelineResult> {
  const dir = join(CASES_DIR, caseName);
  const resolved = await resolve(join(dir, "config.yaml"), { host: createNodeHost(), sandboxRoot: dir });
  if (!resolved.ok) {
    return { ok: false, diagnostics: resolved.diagnostics };
  }
  const merged = merge(resolved);
  if (!merged.ok) {
    return { ok: false, diagnostics: merged.diagnostics };
  }
  const validated = validate(merged.configuration);
  return { ok: validated.ok, diagnostics: validated.diagnostics };
}

describe("v0.7 FR-007 — seal: closed refuses an undeclared child key, positioned at the child", () => {
  it("closed-refuses-undeclared-child: 'network.port' is refused, 'network.host' (declared) is fine", async () => {
    const result = await runPipeline("closed-refuses-undeclared-child");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("seal-violation");
    expect(result.diagnostics[0]?.level).toBe("error");
    expect(result.diagnostics[0]?.pointer).toBe("/network/port");
  });
});

describe("v0.7 FR-008 — seal: open (the default) admits the same undeclared child", () => {
  it("open-admits-undeclared-child: ok:true", async () => {
    const result = await runPipeline("open-admits-undeclared-child");
    expect(result.ok).toBe(true);
  });
});

describe("v0.7 — seal nests to arbitrary depth (SPEC.md §15's nested-demands amendment names this as v0.7 seal's own subject to govern)", () => {
  it("closed-refuses-undeclared-nested-child: 'network.connection.port' (two levels deep) is refused, 'network.connection.host' is fine", async () => {
    const result = await runPipeline("closed-refuses-undeclared-nested-child");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("seal-violation");
    expect(result.diagnostics[0]?.pointer).toBe("/network/connection/port");
  });
});

describe("v0.7 — seal works inside a named type (the decisive reason it moved into the demand vocabulary)", () => {
  it("seal-closed-in-named-type: 'config.b' is refused because the resolved type's own demand is sealed closed", async () => {
    const result = await runPipeline("seal-closed-in-named-type");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("seal-violation");
    expect(result.diagnostics[0]?.pointer).toBe("/config/b");
  });
});

describe("v0.7 — a schema's own top-level seal governs the config's own top level, the mate to top-level keys:", () => {
  it("top-level-seal-closed: an undeclared top-level config key is refused", async () => {
    const result = await runPipeline("top-level-seal-closed");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("seal-violation");
    expect(result.diagnostics[0]?.pointer).toBe("/extra");
  });
});

describe("v0.7 FR-009 — closed -> open is inert (whole-chain validation's own redundancy, not a dedicated refusal)", () => {
  it("tighten-open-to-closed: ancestor open, descendant fully restates closed -- legal, takes effect", async () => {
    const result = await runPipeline("tighten-open-to-closed");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe("seal-violation");
  });

  it("weaken-closed-to-open: ancestor closed, descendant restates open -- the ancestor's OWN closed check still independently fires; the config is still refused despite the descendant's own declaration", async () => {
    const result = await runPipeline("weaken-closed-to-open");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Two independent findings expected: the ANCESTOR's own seal:closed
    // check (using its own view: {host}) and the DESCENDANT's own check
    // (open, contributes nothing) -- only the ancestor's fires.
    expect(result.diagnostics.every((d) => d.code === "seal-violation")).toBe(true);
    expect(result.diagnostics.every((d) => d.level === "error")).toBe(true);
  });
});

describe("Edge Cases — seal: closed on a key whose demand is not a mapping is accepted and inert", () => {
  it("closed-on-non-mapping: ok:true", async () => {
    const result = await runPipeline("closed-on-non-mapping");
    expect(result.ok).toBe(true);
  });
});
