/**
 * v0.4 FR-018, SC-005 (tasks.md T030, User Story 2): "the same
 * configuration and pedigree produce the same diagnostics in the same
 * order on every run."
 *
 * Modeled on `tests/unit/merge-determinism.test.ts`'s pattern: run the
 * real `resolve()` → `merge()` → `validate()` pipeline several times
 * against the same fixture and compare a structural projection of the
 * result — Diagnostic objects carry fresh `Origin` objects per parse, so
 * reference identity is never what should be compared, only value
 * equality of the fields §10's contract actually specifies.
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { merge, resolve, validate } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";
import type { Diagnostic } from "../../src/index.js";

const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases");

function projectDiagnostics(diagnostics: readonly Diagnostic[]): unknown {
  return diagnostics.map((d) => ({
    code: d.code,
    primary: { originId: d.primary.origin.id, line: d.primary.line, column: d.primary.column },
    pointer: d.pointer,
    demand: d.demand === undefined ? undefined : { pointer: d.demand.pointer, originId: d.demand.span.origin.id, line: d.demand.span.line, column: d.demand.span.column },
    pedigreePosition: d.pedigreePosition,
  }));
}

async function validateFixture(relativeDir: string): Promise<{ readonly ok: boolean; readonly diagnostics: readonly Diagnostic[] }> {
  const fixtureDir = join(CASES_DIR, relativeDir);
  const resolved = await resolve(join(fixtureDir, "config.yaml"), { host: createNodeHost(), sandboxRoot: fixtureDir });
  if (!resolved.ok) {
    throw new Error(`fixture failed to resolve: ${resolved.diagnostics.map((d) => d.code).join(", ")}`);
  }
  const merged = merge({ graph: resolved.graph, pedigree: resolved.pedigree });
  if (!merged.ok) {
    throw new Error(`fixture failed to merge: ${merged.diagnostics.map((d) => d.code).join(", ")}`);
  }
  const result = validate(merged.configuration);
  return result.ok ? { ok: true, diagnostics: [] } : { ok: false, diagnostics: result.diagnostics };
}

describe("validate() determinism (v0.4 FR-018, SC-005)", () => {
  it("a two-violation, two-layer chain produces identical diagnostics in identical order across repeated runs", async () => {
    const first = await validateFixture("validate-whole-chain/two-violations");
    const second = await validateFixture("validate-whole-chain/two-violations");

    expect(first.ok).toBe(false);
    expect(first.diagnostics.length).toBe(2); // guards against the equality below holding vacuously
    expect(projectDiagnostics(second.diagnostics)).toEqual(projectDiagnostics(first.diagnostics));
  });

  it("running the same validation five times in a row never diverges, including diagnostic order", async () => {
    const fixtureDir = join(CASES_DIR, "validate-whole-chain/two-violations");
    const runs = await Promise.all(
      Array.from({ length: 5 }, async () => {
        const resolved = await resolve(join(fixtureDir, "config.yaml"), { host: createNodeHost(), sandboxRoot: fixtureDir });
        if (!resolved.ok) throw new Error("unreachable — fixture is known-good");
        const merged = merge({ graph: resolved.graph, pedigree: resolved.pedigree });
        if (!merged.ok) throw new Error("unreachable — fixture is known-good");
        const result = validate(merged.configuration);
        if (result.ok) throw new Error("unreachable — fixture is known-invalid");
        return result.diagnostics;
      }),
    );
    const [first, ...rest] = runs;
    if (first === undefined) throw new Error("unreachable");
    const firstProjection = projectDiagnostics(first);
    for (const diagnostics of rest) {
      expect(projectDiagnostics(diagnostics)).toEqual(firstProjection);
    }
  });

  it("a valid configuration validates identically (ok:true, no diagnostics) across repeated runs", async () => {
    const first = await validateFixture("validate-whole-chain/all-satisfied");
    const second = await validateFixture("validate-whole-chain/all-satisfied");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });
});
