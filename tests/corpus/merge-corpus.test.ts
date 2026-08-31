/**
 * Wires the merge-conformance corpus (`merge-case.ts`, `merge-runner.ts`)
 * into Vitest — the merge analogue of `resolve-corpus.test.ts`. User
 * Story 1 (tasks.md T012-T017): the fold, `provide`, deep merge, replace,
 * nullability, single-layer identity, and inert vocabulary. No network; no
 * filesystem writes — every case reads fixture `.yaml` files already
 * committed under the `tests/corpus/cases/merge-fold/` etc. directories.
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMergeCase } from "./merge-case.js";
import { runMergeCase } from "./merge-runner.js";

const MERGE_CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "merge-cases");

function discoverMergeCaseFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

describe("merge conformance corpus (User Story 1)", () => {
  const caseFiles = discoverMergeCaseFiles(MERGE_CASES_DIR);

  it("discovers merge cases", () => {
    expect(caseFiles.length).toBeGreaterThan(0);
  });

  const cases = caseFiles.map((file) => loadMergeCase(file));

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const result = await runMergeCase(testCase);
      expect(result.failures, result.failures.join("\n")).toEqual([]);
      expect(result.passed).toBe(true);
    });
  }
});
