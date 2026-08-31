/**
 * Wires the validate-conformance corpus (`validate-case.ts`,
 * `validate-runner.ts`) into Vitest — the validate analogue of
 * `merge-corpus.test.ts`. No network; no filesystem writes — every case
 * reads fixture `.yaml` files already committed under the
 * `tests/corpus/cases/validate-` prefixed directories.
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadValidateCase } from "./validate-case.js";
import { runValidateCase } from "./validate-runner.js";

const VALIDATE_CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "validate-cases");

function discoverValidateCaseFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

describe("validate conformance corpus", () => {
  const caseFiles = discoverValidateCaseFiles(VALIDATE_CASES_DIR);

  it("discovers validate cases", () => {
    expect(caseFiles.length).toBeGreaterThan(0);
  });

  const cases = caseFiles.map((file) => loadValidateCase(file));

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const result = await runValidateCase(testCase);
      expect(result.failures, result.failures.join("\n")).toEqual([]);
      expect(result.passed).toBe(true);
    });
  }
});
