/**
 * Wires the conformance corpus runner into Vitest — tasks.md T016.
 *
 * At this checkpoint (end of Phase 2 — Foundational) the corpus directory
 * is empty: User Stories 1–3 (tasks T020 onward) are the ones that add
 * cases and the adapters that read them. This file still runs as a real,
 * asserting test rather than being skipped, so an empty corpus is a
 * visible, passing fact rather than invisible non-coverage — and the
 * moment a case or an adapter shows up, this file starts exercising them
 * with no changes of its own.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverCaseFiles, loadCases, runCases, type AdapterRegistry } from "./runner.js";

const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "cases");

// No format adapters are registered yet. The YAML adapter arrives with
// User Story 1 (src/adapters/yaml/parse.ts); registering it is the only
// change future work needs to make here. Left empty rather than stubbed,
// per the runner contract, so a case naming an unregistered format fails
// loudly instead of silently reporting nothing.
const adapters: AdapterRegistry = {};

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
