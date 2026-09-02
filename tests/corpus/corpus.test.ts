/**
 * Wires the conformance corpus runner into Vitest — tasks.md T016.
 *
 * Originally written at the end of Phase 2 (Foundational) against an
 * empty corpus directory and an empty adapter registry, exactly so that
 * User Story 1 (T020 onward) could add both cases and the YAML adapter
 * with no change to this file beyond registering the adapter itself —
 * which is the one line Phase 3 adds below.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverCaseFiles, loadCases, runCases } from "./runner.js";
import { ADAPTERS } from "./adapters.js";

const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "cases");

// format -> adapter, selected by each case's `format` field (runner
// contract point 3). The registry moved to `./adapters.js` at v1.2, when
// the JSON adapter joined it and three other whole-corpus tests turned out
// to need the same map (specs/011-json-adapter research P-6). The runner
// itself is still format-blind, exactly as User Story 3 (T051) intended:
// the TOML adapter joins by adding one line to that file.
const adapters = ADAPTERS;

describe("conformance corpus", () => {
  const caseFiles = discoverCaseFiles(CASES_DIR);

  it("discovers cases by scanning the corpus directory", () => {
    // Not a placeholder assertion: it fails the moment discovery breaks,
    // and it is what proves the empty-corpus state below is a real
    // (currently vacuous) fact about the directory, not an untested claim.
    expect(Array.isArray(caseFiles)).toBe(true);
  });

  if (caseFiles.length === 0) {
    it("has no cases yet — User Stories 1-3 add them", () => {
      expect(caseFiles).toEqual([]);
    });
    return;
  }

  const cases = loadCases(CASES_DIR);
  const results = runCases(cases, adapters);

  for (const result of results) {
    it(result.name, () => {
      expect(result.failures, result.failures.join("\n")).toEqual([]);
      expect(result.passed).toBe(true);
    });
  }
});
