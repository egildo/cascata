/**
 * Wires the resolution-conformance corpus (`resolve-case.ts`,
 * `resolve-runner.ts`) into Vitest — the resolution analogue of
 * `corpus.test.ts`. User Story 2 (tasks.md T019-T023): local `$schema`/
 * `$adopts` chains only. No network, no filesystem writes — every case
 * reads fixture `.yaml` files already committed under
 * `tests/corpus/cases/`.
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadResolveCase } from "./resolve-case.js";
import { runResolveCase } from "./resolve-runner.js";

const RESOLVE_CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "resolve-cases");

function discoverResolveCaseFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

describe("resolution conformance corpus (User Story 2)", () => {
  const caseFiles = discoverResolveCaseFiles(RESOLVE_CASES_DIR);

  it("discovers resolve cases", () => {
    expect(caseFiles.length).toBeGreaterThan(0);
  });

  const cases = caseFiles.map((file) => loadResolveCase(file));

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const result = await runResolveCase(testCase);
      expect(result.failures, result.failures.join("\n")).toEqual([]);
      expect(result.passed).toBe(true);
    });
  }
});
