/**
 * Wires the write-conformance corpus (`write-case.ts`, `write-runner.ts`)
 * into Vitest — v1.10, specs/018-write-value.
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadWriteCase } from "./write-case.js";
import { runWriteCase } from "./write-runner.js";

const WRITE_CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "write-cases");

describe("write conformance corpus (v1.10)", () => {
  const files = readdirSync(WRITE_CASES_DIR).filter((name) => name.endsWith(".json")).sort();

  it("discovers write cases", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const testCase = loadWriteCase(join(WRITE_CASES_DIR, file));
    it(testCase.name, () => {
      const result = runWriteCase(testCase);
      expect(result.failures, result.failures.join("\n")).toEqual([]);
    });
  }
});
