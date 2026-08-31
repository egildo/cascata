/**
 * Executes one merge-conformance case (`merge-case.ts`) against the real
 * `resolve()` and `merge()` (`src/index.ts`) and reports pass/fail — the
 * merge analogue of `resolve-runner.ts`'s `runResolveCase`.
 *
 * `resolve()` first (User Story 2's machinery, unchanged), then `merge()`
 * on the result — a merge case is genuinely a two-stage pipeline, and this
 * runner is what exercises both stages together rather than hand-building
 * a `Graph`/`Pedigree` in TypeScript, which would test the fold against
 * fixtures nothing ever actually produced.
 */

import { join, relative } from "node:path";
import { merge, resolve, why, type MergedConfiguration, type ProvenanceEntry } from "../../src/index.js";
import { resolvePointer } from "../../src/model/pointer.js";
import { compareNode } from "./runner.js";
import type { ExpectedMergeDiagnostic, ExpectedMergeSpan, ExpectedProvenanceEntry, ExpectedWhy, MergeCase } from "./merge-case.js";

export interface MergeCaseResult {
  readonly name: string;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

function relativeLocation(fixtureDir: string, absoluteLocation: string): string {
  return relative(fixtureDir, absoluteLocation).split("\\").join("/");
}

function checkSpans(failures: string[], fixtureDir: string, configuration: MergedConfiguration, expectedSpans: readonly ExpectedMergeSpan[]): void {
  for (const expected of expectedSpans) {
    const node = resolvePointer(configuration.tree, expected.pointer);
    if (node === undefined) {
      failures.push(`span assertion at '${expected.pointer}': no node at that pointer in the merged tree`);
      continue;
    }
    const actualDocument = relativeLocation(fixtureDir, node.span.origin.id);
    if (actualDocument !== expected.document) {
      failures.push(`span assertion at '${expected.pointer}': expected document '${expected.document}', got '${actualDocument}'`);
    }
    if (node.span.line !== expected.line || node.span.column !== expected.column) {
      failures.push(`span assertion at '${expected.pointer}': expected ${expected.line}:${expected.column}, got ${node.span.line}:${node.span.column}`);
    }
    if (expected.start !== undefined && node.span.start !== expected.start) {
      failures.push(`span assertion at '${expected.pointer}': expected start ${expected.start}, got ${node.span.start}`);
    }
    if (expected.end !== undefined && node.span.end !== expected.end) {
      failures.push(`span assertion at '${expected.pointer}': expected end ${expected.end}, got ${node.span.end}`);
    }
  }
}

/** Compare an actual `readonly ProvenanceEntry[]` against `expected`, checking length, each entry's contributing document (relative to `fixtureDir`, same convention `checkSpans` uses), and each entry's `outcome`, in order — order matters for a chain (winner-first) and is asserted the same way for `synthesized` contributors (this file's own deterministic, canonically-ordered construction, `src/merge/provenance.ts`'s `synthesizedContributors`). */
function checkEntries(failures: string[], fixtureDir: string, label: string, actual: readonly ProvenanceEntry[], expected: readonly ExpectedProvenanceEntry[]): void {
  if (actual.length !== expected.length) {
    failures.push(`${label}: expected ${expected.length} entries, got ${actual.length} (outcomes: ${actual.map((e) => e.outcome).join(", ")})`);
    return;
  }
  actual.forEach((entry, index) => {
    const expectedEntry = expected[index];
    if (expectedEntry === undefined) {
      return;
    }
    const actualDocument = relativeLocation(fixtureDir, entry.layer.identity.location);
    if (actualDocument !== expectedEntry.document) {
      failures.push(`${label}[${index}]: expected document '${expectedEntry.document}', got '${actualDocument}'`);
    }
    if (entry.outcome !== expectedEntry.outcome) {
      failures.push(`${label}[${index}]: expected outcome '${expectedEntry.outcome}', got '${entry.outcome}'`);
    }
  });
}

function checkWhy(failures: string[], fixtureDir: string, configuration: MergedConfiguration, expectedWhys: readonly ExpectedWhy[]): void {
  for (const expected of expectedWhys) {
    const actual = why(configuration, expected.pointer);
    const label = `why('${expected.pointer}')`;
    if (actual.kind !== expected.kind) {
      failures.push(`${label}: expected kind '${expected.kind}', got '${actual.kind}'`);
      continue;
    }
    if (expected.kind === "chain" && actual.kind === "chain") {
      checkEntries(failures, fixtureDir, label, actual.entries, expected.entries);
    } else if (expected.kind === "synthesized" && actual.kind === "synthesized") {
      checkEntries(failures, fixtureDir, label, actual.contributors, expected.contributors);
    }
    // "unknown-pointer" needs no further comparison — the kind match above is the whole assertion.
  }
}

function checkDiagnostics(
  failures: string[],
  fixtureDir: string,
  actual: readonly { readonly code: string; readonly primary: { readonly origin: { readonly id: string }; readonly line: number; readonly column: number } }[],
  expected: readonly ExpectedMergeDiagnostic[],
): void {
  if (actual.length !== expected.length) {
    failures.push(`diagnostics: expected ${expected.length}, got ${actual.length} (codes: ${actual.map((d) => d.code).join(", ")})`);
    return;
  }
  actual.forEach((actualDiagnostic, index) => {
    const expectedDiagnostic = expected[index];
    if (expectedDiagnostic === undefined) {
      return;
    }
    const label = `diagnostics[${index}]`;
    if (actualDiagnostic.code !== expectedDiagnostic.code) {
      failures.push(`${label}: expected code '${expectedDiagnostic.code}', got '${actualDiagnostic.code}'`);
    }
    const actualDocument = relativeLocation(fixtureDir, actualDiagnostic.primary.origin.id);
    if (actualDocument !== expectedDiagnostic.document) {
      failures.push(`${label}: expected document '${expectedDiagnostic.document}', got '${actualDocument}'`);
    }
    if (actualDiagnostic.primary.line !== expectedDiagnostic.line || actualDiagnostic.primary.column !== expectedDiagnostic.column) {
      failures.push(`${label}: expected position ${expectedDiagnostic.line}:${expectedDiagnostic.column}, got ${actualDiagnostic.primary.line}:${actualDiagnostic.primary.column}`);
    }
  });
}

export async function runMergeCase(testCase: MergeCase): Promise<MergeCaseResult> {
  const failures: string[] = [];
  const entryPath = join(testCase.fixtureDir, testCase.entry);
  const sandboxRoot = join(testCase.fixtureDir, testCase.sandboxRoot);

  const resolved = await resolve(entryPath, { sandboxRoot });
  if (!resolved.ok) {
    failures.push(`resolve() failed before merge() could run: ${resolved.diagnostics.map((d) => `${d.code} @ ${d.primary.origin.label}:${d.primary.line}:${d.primary.column}`).join("; ")}`);
    return { name: testCase.name, passed: false, failures };
  }

  const result = merge({ graph: resolved.graph, pedigree: resolved.pedigree });

  if (testCase.expect.ok) {
    if (!result.ok) {
      failures.push(`expected ok:true, got ok:false with diagnostics: ${result.diagnostics.map((d) => `${d.code} @ ${d.primary.origin.label}:${d.primary.line}:${d.primary.column}`).join("; ")}`);
      return { name: testCase.name, passed: false, failures };
    }
    compareNode(result.configuration.tree, testCase.expect.tree, "", failures);
    if (testCase.expect.spans !== undefined) {
      checkSpans(failures, testCase.fixtureDir, result.configuration, testCase.expect.spans);
    }
    if (testCase.expect.why !== undefined) {
      checkWhy(failures, testCase.fixtureDir, result.configuration, testCase.expect.why);
    }
  } else {
    if (result.ok) {
      failures.push("expected ok:false, got ok:true");
      return { name: testCase.name, passed: false, failures };
    }
    checkDiagnostics(failures, testCase.fixtureDir, result.diagnostics, testCase.expect.diagnostics);
  }

  return { name: testCase.name, passed: failures.length === 0, failures };
}
