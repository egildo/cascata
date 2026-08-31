/**
 * Executes one validate-conformance case (`validate-case.ts`) against the
 * real `resolve()`, `merge()`, and `validate()` (`src/index.ts`) — the
 * validate analogue of `merge-runner.ts`'s `runMergeCase`.
 *
 * `resolve()` then `merge()` (unchanged machinery) then `validate()` on the
 * result — a validate case is genuinely a three-stage pipeline, and this
 * runner is what exercises all three together.
 */

import { join, relative } from "node:path";
import { merge, resolve, validate, type Diagnostic } from "../../src/index.js";
import { compareNode } from "./runner.js";
import type { ExpectedValidateDiagnostic, ValidateCase } from "./validate-case.js";

export interface ValidateCaseResult {
  readonly name: string;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

function relativeLocation(fixtureDir: string, absoluteLocation: string): string {
  return relative(fixtureDir, absoluteLocation).split("\\").join("/");
}

function checkDiagnostics(failures: string[], fixtureDir: string, actual: readonly Diagnostic[], expected: readonly ExpectedValidateDiagnostic[]): void {
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
    if (expectedDiagnostic.line !== undefined || expectedDiagnostic.column !== undefined) {
      if (actualDiagnostic.primary.line !== expectedDiagnostic.line || actualDiagnostic.primary.column !== expectedDiagnostic.column) {
        failures.push(`${label}: expected position ${expectedDiagnostic.line}:${expectedDiagnostic.column}, got ${actualDiagnostic.primary.line}:${actualDiagnostic.primary.column}`);
      }
    }
    if (expectedDiagnostic.start !== undefined && actualDiagnostic.primary.start !== expectedDiagnostic.start) {
      failures.push(`${label}: expected start ${expectedDiagnostic.start}, got ${actualDiagnostic.primary.start}`);
    }
    if (expectedDiagnostic.end !== undefined && actualDiagnostic.primary.end !== expectedDiagnostic.end) {
      failures.push(`${label}: expected end ${expectedDiagnostic.end}, got ${actualDiagnostic.primary.end}`);
    }
    if (expectedDiagnostic.pointer !== undefined) {
      if (actualDiagnostic.pointer !== expectedDiagnostic.pointer) {
        failures.push(`${label}: expected pointer '${expectedDiagnostic.pointer}', got ${JSON.stringify(actualDiagnostic.pointer)}`);
      }
    }
    if (expectedDiagnostic.demand !== undefined) {
      const actualDemand = actualDiagnostic.demand;
      if (actualDemand === undefined) {
        failures.push(`${label}: expected a 'demand' field, got none`);
      } else {
        if (actualDemand.pointer !== expectedDiagnostic.demand.pointer) {
          failures.push(`${label}.demand: expected pointer '${expectedDiagnostic.demand.pointer}', got '${actualDemand.pointer}'`);
        }
        const actualDemandDocument = relativeLocation(fixtureDir, actualDemand.span.origin.id);
        if (actualDemandDocument !== expectedDiagnostic.demand.document) {
          failures.push(`${label}.demand: expected document '${expectedDiagnostic.demand.document}', got '${actualDemandDocument}'`);
        }
        if (actualDemand.span.line !== expectedDiagnostic.demand.line || actualDemand.span.column !== expectedDiagnostic.demand.column) {
          failures.push(`${label}.demand: expected position ${expectedDiagnostic.demand.line}:${expectedDiagnostic.demand.column}, got ${actualDemand.span.line}:${actualDemand.span.column}`);
        }
      }
    }
    if (expectedDiagnostic.pedigreePosition !== undefined && actualDiagnostic.pedigreePosition !== expectedDiagnostic.pedigreePosition) {
      failures.push(`${label}: expected pedigreePosition ${expectedDiagnostic.pedigreePosition}, got ${JSON.stringify(actualDiagnostic.pedigreePosition)}`);
    }
  });
}

export async function runValidateCase(testCase: ValidateCase): Promise<ValidateCaseResult> {
  const failures: string[] = [];
  const entryPath = join(testCase.fixtureDir, testCase.entry);
  const sandboxRoot = join(testCase.fixtureDir, testCase.sandboxRoot);

  const resolved = await resolve(entryPath, { sandboxRoot });
  if (!resolved.ok) {
    failures.push(`resolve() failed before merge()/validate() could run: ${resolved.diagnostics.map((d) => `${d.code} @ ${d.primary.origin.label}:${d.primary.line}:${d.primary.column}`).join("; ")}`);
    return { name: testCase.name, passed: false, failures };
  }

  const merged = merge({ graph: resolved.graph, pedigree: resolved.pedigree });
  if (!merged.ok) {
    failures.push(`merge() failed before validate() could run: ${merged.diagnostics.map((d) => `${d.code} @ ${d.primary.origin.label}:${d.primary.line}:${d.primary.column}`).join("; ")}`);
    return { name: testCase.name, passed: false, failures };
  }

  const result = validate(merged.configuration);

  if (testCase.expect.ok) {
    if (!result.ok) {
      failures.push(`expected ok:true, got ok:false with diagnostics: ${result.diagnostics.map((d) => `${d.code} @ ${d.primary.origin.label}:${d.primary.line}:${d.primary.column}`).join("; ")}`);
      return { name: testCase.name, passed: false, failures };
    }
    if (testCase.expect.tree !== undefined) {
      compareNode(result.certified.tree, testCase.expect.tree, "", failures);
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
