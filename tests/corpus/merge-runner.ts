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
import { merge, resolve, type MergedConfiguration } from "../../src/index.js";
import { resolvePointer } from "../../src/model/pointer.js";
import { compareNode } from "./runner.js";
import type { ExpectedMergeDiagnostic, ExpectedMergeSpan, MergeCase } from "./merge-case.js";

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
  } else {
    if (result.ok) {
      failures.push("expected ok:false, got ok:true");
      return { name: testCase.name, passed: false, failures };
    }
    checkDiagnostics(failures, testCase.fixtureDir, result.diagnostics, testCase.expect.diagnostics);
  }

  return { name: testCase.name, passed: failures.length === 0, failures };
}
