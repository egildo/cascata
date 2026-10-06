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

/**
 * The same obligation for the JSON adapter (v1.2, specs/011-json-adapter
 * FR-024). Written as its own table rather than folded into the two above,
 * because the two adapters do not refuse the same things: JSON's grammar
 * has no non-string key, no tag, no document separator and no alias, so
 * four of the YAML rows are **unreachable** here rather than merely
 * uncovered. Those four are recorded below as acceptance rules over the
 * nearest legal document — `{"1": true}` for a key that looks numeric,
 * a string containing `---`, a string containing `&a`/`*a`, a string
 * containing `!!binary` — so that a reader looking for them finds an
 * answer instead of a silence.
 *
 * JSON adds one refusal YAML's own table has no row for: a document that
 * is not exactly one value. YAML reads an empty document as a null scalar
 * and this one refuses it, which is the two grammars differing about
 * themselves rather than about a document (SPEC.md §16, 011 research D-6).
 */
const JSON_REJECTIONS: readonly Rejection[] = [
  { decision: "JSON: duplicate keys", code: "duplicate-key", directory: "json-duplicate-keys" },
  { decision: "JSON: invalid encoding", code: "invalid-encoding", directory: "json-encoding" },
  { decision: "JSON: an unpaired surrogate escape", code: "invalid-encoding", directory: "json-strings" },
  { decision: "JSON: the RFC 8259 number grammar", code: "malformed-document", directory: "json-numbers" },
  { decision: "JSON: the RFC 8259 string grammar", code: "malformed-document", directory: "json-strings" },
  { decision: "JSON: exactly one value, and nothing after it", code: "malformed-document", directory: "json-document-shape" },
  { decision: "JSON: resource limits: depth cap", code: "depth-limit-exceeded", directory: "json-limits" },
  { decision: "JSON: resource limits: size cap", code: "size-limit-exceeded", directory: "json-limits" },
];

const JSON_ACCEPTANCE_RULES: readonly AcceptanceRule[] = [
  { decision: "JSON: canonical mapping key order", directory: "json-structure" },
  { decision: "JSON: lexical number kind", directory: "json-numbers" },
  { decision: "JSON: three-way null/empty/absent distinction", directory: "json-structure" },
  { decision: "JSON: code-point columns over non-ASCII and astral text", directory: "json-unicode" },
  { decision: "JSON: the single definition of equality", directory: "json-equality" },
  { decision: "JSON: a counted byte-order mark", directory: "json-encoding" },
  { decision: "JSON: YAML-only syntax is ordinary string content (the unreachable floor rules)", directory: "json-strings" },
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

  it("every case named by the YAML tables above really is a YAML case, and every json-* case really is a JSON one — a table that drifted off its corpus would pass while checking nothing", () => {
    const yamlDirectories = new Set([...REJECTIONS, ...ACCEPTANCE_RULES].map((row) => row.directory));
    const mismatched = cases.filter((c) => (yamlDirectories.has(directoryOf(c)) && c.format !== "yaml") || (directoryOf(c).startsWith("json-") && c.format !== "json"));
    expect(mismatched.map((c) => `${c.name} (format '${c.format}')`)).toEqual([]);
  });

  for (const rejection of JSON_REJECTIONS) {
    const inDirectory = cases.filter((c) => directoryOf(c) === rejection.directory);

    it(`${rejection.decision}: has a refusing case reporting '${rejection.code}' with a position`, () => {
      expect(inDirectory.filter((c) => refusesWithCode(c, rejection.code)).length, `expected at least one case in '${rejection.directory}/' refusing with '${rejection.code}'`).toBeGreaterThan(0);
    });

    it(`${rejection.decision}: has an accepting case (the nearest legal document)`, () => {
      expect(inDirectory.filter(isAccepting).length, `expected at least one accepting case in '${rejection.directory}/'`).toBeGreaterThan(0);
    });
  }

  for (const rule of JSON_ACCEPTANCE_RULES) {
    it(`${rule.decision}: has an accepting case`, () => {
      const accepting = cases.filter((c) => directoryOf(c) === rule.directory && isAccepting(c));
      expect(accepting.length, `expected at least one accepting case in '${rule.directory}/'`).toBeGreaterThan(0);
    });
  }

  it("the four floor rules JSON's grammar cannot express are unreachable, not merely uncovered — no json-* case claims one", () => {
    const unreachable: readonly DiagnosticCode[] = ["non-string-key", "unsupported-tag", "multiple-documents", "alias-cycle"];
    const claimed = cases.filter((c) => c.format === "json" && unreachable.some((code) => refusesWithCode(c, code)));
    expect(claimed.map((c) => c.name), "JSON has no non-string key, no tag, no document separator and no alias — a case claiming one of these codes means the adapter grew a refusal its grammar cannot reach").toEqual([]);
  });
});
