/**
 * v0.7 FR-001 through FR-004, SPEC.md §10 — every diagnostic carries a
 * `level`; a result whose diagnostics are all `info` is still `ok: true`;
 * an `info` carries every field an `error` of this milestone carries;
 * every diagnostic that existed before this milestone is `level: "error"`
 * — no reclassification.
 *
 * Sampled across three independent stages (parse, resolve, delegation
 * grant-collection) rather than exhaustively re-walking the whole
 * pre-existing corpus: FR-004's mechanical guarantee (every pre-v0.7
 * `createDiagnostic()` call site now passes `level: "error"` explicitly)
 * is enforced by TypeScript itself — `createDiagnostic()`'s own input type
 * requires `level`, so a call site missing it is a compile error, not a
 * runtime one this test could catch that `pnpm typecheck` does not already
 * catch more cheaply. What this file adds beyond that mechanical guarantee
 * is behavioral: that `level` actually reaches the caller unmangled
 * through each stage's own result type, and that the ok:true-with-lints
 * shape (FR-002) is real.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { parseText, resolve } from "../../src/index.js";
import { createOrigin } from "../../src/model/span.js";

describe("v0.7 FR-001/FR-004 — every diagnostic carries level, and pre-existing diagnostics are error", () => {
  it("parseText: a duplicate key is level:error", () => {
    const result = parseText("a: 1\na: 2\n", { origin: createOrigin("dup.yaml", "dup.yaml") });
    if (result.ok) {
      throw new Error("expected ok:false for a duplicate key");
    }
    expect(result.diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.level).toBe("error");
    }
  });

  it("resolve: a sandbox escape is level:error", async () => {
    const dir = join(__dirname, "..", "corpus", "cases", "sandbox-escape");
    const result = await resolve(join(dir, "config.yaml"), { sandboxRoot: join(dir, "sandbox") });
    if (result.ok) {
      throw new Error("expected ok:false for a sandbox escape");
    }
    expect(result.diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.level).toBe("error");
    }
  });
});

describe("v0.7 FR-002 — a result whose diagnostics are all info is ok:true, with both the value and the lints", () => {
  it("resolve() carrying only an info lint is ok:true and both the graph and the diagnostics are present", async () => {
    const dir = join(__dirname, "..", "corpus", "cases", "validate-delegation", "delegate-leaf-shape-lint");
    const result = await resolve(join(dir, "config.yaml"), { sandboxRoot: dir });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.graph.documents.length).toBeGreaterThan(0);
    expect(result.diagnostics.every((d) => d.level === "info")).toBe(true);
    expect(result.diagnostics.length).toBe(1);
  });
});

describe("v0.7 FR-003 — an info diagnostic carries every field an error of this milestone carries", () => {
  it("delegate-inline-string-loaded (info) and delegate-value-unimplemented (error) carry the identical field shape", async () => {
    const infoDir = join(__dirname, "..", "corpus", "cases", "validate-delegation", "delegate-leaf-shape-lint");
    const infoResult = await resolve(join(infoDir, "config.yaml"), { sandboxRoot: infoDir });
    if (!infoResult.ok) {
      throw new Error("expected ok:true");
    }
    const infoDiagnostic = infoResult.diagnostics[0];
    if (infoDiagnostic === undefined) {
      throw new Error("expected exactly one info diagnostic");
    }

    const errorDir = join(__dirname, "..", "corpus", "cases", "validate-delegation", "delegate-value-unimplemented");
    const errorResult = await resolve(join(errorDir, "config.yaml"), { sandboxRoot: errorDir });
    if (errorResult.ok) {
      throw new Error("expected ok:false");
    }
    const errorDiagnostic = errorResult.diagnostics[0];
    if (errorDiagnostic === undefined) {
      throw new Error("expected at least one error diagnostic");
    }

    // Both are produced by the identical grant-collection code path (one
    // branch of readEntry() in src/resolve/delegate.ts), so both carry:
    // code, level, message, primary (with origin/line/column), demand
    // (pointer+span), pedigreePosition. Neither carries pointer (a
    // vocabulary-level diagnostic, not a merged-tree one) or delegatedFrom
    // (neither diagnostic concerns a delegated value).
    for (const diagnostic of [infoDiagnostic, errorDiagnostic]) {
      expect(typeof diagnostic.code).toBe("string");
      expect(["error", "info"]).toContain(diagnostic.level);
      expect(typeof diagnostic.message).toBe("string");
      expect(diagnostic.primary.origin.id).toEqual(expect.any(String));
      expect(typeof diagnostic.primary.line).toBe("number");
      expect(typeof diagnostic.primary.column).toBe("number");
      expect(diagnostic.demand).toBeDefined();
      expect(typeof diagnostic.demand?.pointer).toBe("string");
      expect(typeof diagnostic.pedigreePosition).toBe("number");
      expect(diagnostic.pointer).toBeUndefined();
      expect(diagnostic.delegatedFrom).toBeUndefined();
    }
    expect(infoDiagnostic.level).toBe("info");
    expect(errorDiagnostic.level).toBe("error");
  });
});
