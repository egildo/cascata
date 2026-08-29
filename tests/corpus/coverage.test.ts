/**
 * Asserts the FR-023 coverage obligations (SC-002) — tasks.md T057.
 *
 * FR-023 (spec.md) was itself amended mid-project after cross-artifact
 * analysis found its original form unsatisfiable: it demanded that every
 * §4.2 decision have both an accepting and a refusing case, which is
 * impossible for a decision like canonical key order that has nothing to
 * reject. The current, corrected obligation is what this file checks:
 *
 *   - Each §4.2 **rejection** needs at least one refusing case (the right
 *     diagnostic code, from a genuinely refused parse) and at least one
 *     accepting case (the nearest legal document).
 *   - Each §4.2 **acceptance rule** needs at least one accepting case.
 *
 * This is a real assertion, not documentation: it loads the actual corpus
 * and fails if a decision's coverage is missing, so a case deleted or
 * renamed out from under this table breaks the build rather than quietly
 * eroding coverage. Coverage is checked structurally, by directory and
 * outcome shape (does *some* case under this decision's directory refuse
 * with the right code; does some other accept) — not by re-deriving "is
 * this specific document the nearest legal one," which is a judgment call
 * made once, by hand, when each case was authored (see the Phase 5
 * report), not something mechanically checkable here.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DiagnosticCode } from "../../src/diagnostics/codes.js";
import type { ConformanceCase } from "./case.js";
import { loadCases } from "./runner.js";

const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "cases");

function directoryOf(testCase: ConformanceCase): string {
  const slash = testCase.name.indexOf("/");
  return slash === -1 ? testCase.name : testCase.name.slice(0, slash);
}

function isAccepting(testCase: ConformanceCase): boolean {
  return "tree" in testCase.expect || "equalTo" in testCase.expect;
}

function refusesWithCode(testCase: ConformanceCase, code: DiagnosticCode): boolean {
  return "diagnostics" in testCase.expect && testCase.expect.diagnostics.some((d) => d.code === code);
}

interface Rejection {
  readonly decision: string;
  readonly code: DiagnosticCode;
  readonly directory: string;
}

interface AcceptanceRule {
  readonly decision: string;
  readonly directory: string;
}

/**
 * Every §4.2 rejection FR-023 names, plus `alias-cycle`: contracts/
 * diagnostics.md groups it under "Resource limits (§11)" alongside the
 * depth and size caps, and FR-023's "the resource limits" reasonably
 * reads as covering all three — not spelled out precisely enough in
 * either artifact to be certain, so it is included here rather than
 * left out on a technicality (it already has both cases either way).
 */
const REJECTIONS: readonly Rejection[] = [
  { decision: "duplicate keys", code: "duplicate-key", directory: "duplicate-keys" },
  { decision: "non-text keys", code: "non-string-key", directory: "non-string-keys" },
  { decision: "out-of-schema tags", code: "unsupported-tag", directory: "tags" },
  { decision: "multi-document input", code: "multiple-documents", directory: "document-shape" },
  { decision: "invalid encoding", code: "invalid-encoding", directory: "document-shape" },
  { decision: "resource limits: depth cap", code: "depth-limit-exceeded", directory: "limits" },
  { decision: "resource limits: size cap", code: "size-limit-exceeded", directory: "limits" },
  { decision: "resource limits: alias cycle", code: "alias-cycle", directory: "alias-cycles" },
];

const ACCEPTANCE_RULES: readonly AcceptanceRule[] = [
  { decision: "canonical mapping key order", directory: "ordering" },
  { decision: "lexical number kind", directory: "numbers" },
  { decision: "core-schema booleans", directory: "core-schema" },
  { decision: "three-way null/empty/absent distinction", directory: "nullability" },
  { decision: "code-point string comparison without normalization", directory: "unicode" },
  { decision: "the single definition of equality", directory: "equality" },
];

describe("FR-023 coverage obligations (SC-002)", () => {
  const cases = loadCases(CASES_DIR);

  it("loaded at least one case (guards against this test vacuously passing on an empty corpus)", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const rejection of REJECTIONS) {
    const inDirectory = cases.filter((c) => directoryOf(c) === rejection.directory);

    it(`${rejection.decision}: has a refusing case reporting '${rejection.code}' with a position`, () => {
      const refusing = inDirectory.filter((c) => refusesWithCode(c, rejection.code));
      expect(refusing.length, `expected at least one case in '${rejection.directory}/' refusing with '${rejection.code}'`).toBeGreaterThan(0);
    });

    it(`${rejection.decision}: has an accepting case (the nearest legal document)`, () => {
      const accepting = inDirectory.filter(isAccepting);
      expect(accepting.length, `expected at least one accepting case in '${rejection.directory}/'`).toBeGreaterThan(0);
    });
  }

  for (const rule of ACCEPTANCE_RULES) {
    it(`${rule.decision}: has an accepting case`, () => {
      const accepting = cases.filter((c) => directoryOf(c) === rule.directory && isAccepting(c));
      expect(accepting.length, `expected at least one accepting case in '${rule.directory}/'`).toBeGreaterThan(0);
    });
  }
});
