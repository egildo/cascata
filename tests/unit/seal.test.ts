/**
 * v0.7 FR-006 through FR-009, SPEC.md §6.3 — `seal: open | closed`, per
 * key. Fixture-driven, end to end through `resolve()` -> `merge()` ->
 * `validate()`, since `seal: closed`'s own refusal (FR-007) needs a real
 * merged tree to check child keys against — `src/merge/seal.ts`'s own
 * unit tests (`tests/unit/seal-resolution.test.ts`) already cover the
 * whole-stack tightening/weakening resolution in isolation; this file
 * covers what only the full pipeline can exercise.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { merge, resolve, validate, type Diagnostic } from "../../src/index.js";

const CASES_DIR = join(__dirname, "..", "corpus", "cases", "seal");

type PipelineResult = { readonly ok: true; readonly diagnostics: readonly Diagnostic[] } | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

async function runPipeline(caseName: string): Promise<PipelineResult> {
  const dir = join(CASES_DIR, caseName);
  const resolved = await resolve(join(dir, "config.yaml"), { sandboxRoot: dir });
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
  });
});

describe("v0.7 FR-008 — seal: open (the default) admits the same undeclared child", () => {
  it("open-admits-undeclared-child: ok:true", async () => {
    const result = await runPipeline("open-admits-undeclared-child");
    expect(result.ok).toBe(true);
  });
});

describe("v0.7 FR-009 — seal tightens legally from the declaring layer downward; weakening is refused", () => {
  it("tighten-open-to-closed: ancestor open, descendant closed -- legal, takes effect", async () => {
    const result = await runPipeline("tighten-open-to-closed");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe("seal-violation");
  });

  it("weaken-closed-to-open: ancestor closed, descendant open -- refused as seal-weakened, at merge time", async () => {
    const dir = join(CASES_DIR, "weaken-closed-to-open");
    const resolved = await resolve(join(dir, "config.yaml"), { sandboxRoot: dir });
    if (!resolved.ok) throw new Error("expected resolve() ok:true");
    const merged = merge(resolved);
    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.diagnostics.some((d) => d.code === "seal-weakened")).toBe(true);
    expect(merged.diagnostics.every((d) => d.level === "error")).toBe(true);
  });
});

describe("Edge Cases — seal: closed on a key whose demand is not a mapping is accepted and inert", () => {
  it("closed-on-non-mapping: ok:true", async () => {
    const result = await runPipeline("closed-on-non-mapping");
    expect(result.ok).toBe(true);
  });
});
