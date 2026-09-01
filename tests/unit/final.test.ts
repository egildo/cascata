/**
 * v0.7 FR-010 through FR-014, FR-021, SPEC.md §6.3, §5.5 — `final`. Two
 * halves: refusing further schema declarations (FR-010, checked in
 * `resolveSeal` — `tests/unit/seal-resolution.test.ts` already covers the
 * discriminating narrowing case in isolation) and the config-facing
 * `final provide` pinned-constant pattern (FR-011/FR-012/FR-013), which
 * needs a real merged tree. Fixture-driven, end to end.
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

describe("v0.7 FR-010 — final closes the question, refusing even a narrower redeclaration, at merge time", () => {
  it("final-refuses-narrowing: a strictly narrower descendant demand is still refused", async () => {
    const dir = join(CASES_DIR, "final-refuses-narrowing");
    const resolved = await resolve(join(dir, "config.yaml"), { sandboxRoot: dir });
    if (!resolved.ok) throw new Error("expected resolve() ok:true");
    const merged = merge(resolved);
    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.diagnostics.some((d) => d.code === "final-key-redeclared")).toBe(true);
  });

  it("final-on-already-final: a redundant restatement of final itself is still refused", async () => {
    const dir = join(CASES_DIR, "final-on-already-final");
    const resolved = await resolve(join(dir, "config.yaml"), { sandboxRoot: dir });
    if (!resolved.ok) throw new Error("expected resolve() ok:true");
    const merged = merge(resolved);
    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.diagnostics.some((d) => d.code === "final-key-redeclared")).toBe(true);
  });
});

describe("v0.7 FR-011 — final with provide refuses a config setting the key", () => {
  it("final-provide-refuses-config-set: refused, even though only the key's identity — not any missing constraint — is at issue", async () => {
    const result = await runPipeline("final-provide-refuses-config-set");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("final-key-set");
    expect(result.diagnostics[0]?.level).toBe("error");
  });
});

describe("v0.7 FR-012 — final without provide admits a config setting the key", () => {
  it("final-no-provide-admits-config-set: ok:true, 'mode' is the config's own value", async () => {
    const dir = join(CASES_DIR, "final-no-provide-admits-config-set");
    const resolved = await resolve(join(dir, "config.yaml"), { sandboxRoot: dir });
    if (!resolved.ok) throw new Error("expected resolve() ok:true");
    const merged = merge(resolved);
    if (!merged.ok) throw new Error("expected merge() ok:true");
    const validated = validate(merged.configuration);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const modeNode = validated.certified.tree.type === "mapping" ? validated.certified.tree.entries.get("mode") : undefined;
    expect(modeNode?.type === "scalar" && modeNode.kind === "string" ? modeNode.value : undefined).toBe("staging");
  });
});

describe("v0.7 FR-013 — required is vacuous under final provide (SPEC.md §5.5, verbatim)", () => {
  it("final-provide-required-vacuous: ok:true, one info diagnostic 'required-vacuous'", async () => {
    const result = await runPipeline("final-provide-required-vacuous");
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("required-vacuous");
    expect(result.diagnostics[0]?.level).toBe("info");
  });
});

describe("v0.7 FR-014 — seal/final declared by a config has no effect", () => {
  it("config-seal-final-ignored: the config's own 'keys:' mapping is ordinary data, not a seal declaration", async () => {
    const result = await runPipeline("config-seal-final-ignored");
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("Edge Cases — final declared in the entry (leaf) schema is vacuous but legal", () => {
  it("final-in-leaf-schema: ok:true, no descendant exists to violate it", async () => {
    const result = await runPipeline("final-in-leaf-schema");
    expect(result.ok).toBe(true);
  });
});
