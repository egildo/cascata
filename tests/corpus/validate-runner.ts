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
import { createNodeHost } from "../../src/host/node.js";
import { compareNode } from "./runner.js";
import type { ExpectedValidateDiagnostic, ValidateCase } from "./validate-case.js";

export interface ValidateCaseResult {
  readonly name: string;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

/**
 * v0.6: callers pass `origin.label`, not `origin.id` — a fragment's own
 * `Origin.id` is a synthesized per-graft string (research.md D3,
 * FR-013a's independent-provenance requirement), never a real path, so
 * comparing it against a fixture's own file path would always fail for
 * a delegation-sourced diagnostic. `origin.label` stays the real file
 * path for every kind of document, delegated or not — exactly what this
 * comparison has always wanted.
 */
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
    const actualDocument = relativeLocation(fixtureDir, actualDiagnostic.primary.origin.label);
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
        const actualDemandDocument = relativeLocation(fixtureDir, actualDemand.span.origin.label);
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
    if (expectedDiagnostic.delegatedFrom !== undefined) {
      const actualHops = actualDiagnostic.delegatedFrom ?? [];
      if (actualHops.length !== expectedDiagnostic.delegatedFrom.length) {
        failures.push(`${label}.delegatedFrom: expected ${expectedDiagnostic.delegatedFrom.length} hop(s), got ${actualHops.length}`);
      } else {
        expectedDiagnostic.delegatedFrom.forEach((expectedHop, hopIndex) => {
          const actualHop = actualHops[hopIndex];
          if (actualHop === undefined) {
            failures.push(`${label}.delegatedFrom[${hopIndex}]: missing`);
            return;
          }
          const actualHopDocument = relativeLocation(fixtureDir, actualHop.span.origin.label);
          if (actualHopDocument !== expectedHop.document) {
            failures.push(`${label}.delegatedFrom[${hopIndex}]: expected document '${expectedHop.document}', got '${actualHopDocument}'`);
          }
          if (actualHop.span.line !== expectedHop.line || actualHop.span.column !== expectedHop.column) {
            failures.push(`${label}.delegatedFrom[${hopIndex}]: expected position ${expectedHop.line}:${expectedHop.column}, got ${actualHop.span.line}:${actualHop.span.column}`);
          }
        });
      }
    }
  });
}

/**
 * v0.6: a case's own `expect.ok: false` may now legitimately originate
 * from `resolve()` itself, not only `validate()` — delegation failures
 * (a missing fragment, a sandbox escape, a cycle, ...) are resolve()-stage
 * diagnostics, the same way a `document-unreachable`/`sandbox-escape` for
 * `$schema`/`$adopts` always has been. Before v0.6 this runner treated
 * *any* resolve()/merge() failure as an automatic test failure, since no
 * validate-corpus case had ever needed to assert one — that assumption
 * no longer holds, so failure-checking against `testCase.expect` is now
 * unified across all three stages rather than special-cased at
 * validate()'s alone.
 */
export async function runValidateCase(testCase: ValidateCase): Promise<ValidateCaseResult> {
  const failures: string[] = [];
  const entryPath = join(testCase.fixtureDir, testCase.entry);
  const sandboxRoot = join(testCase.fixtureDir, testCase.sandboxRoot);

  const resolved = await resolve(entryPath, { host: createNodeHost(), sandboxRoot });
  if (!resolved.ok) {
    return checkStageFailure(testCase, resolved.diagnostics, "resolve()");
  }

  const merged = merge({ graph: resolved.graph, pedigree: resolved.pedigree, delegationBreadcrumbs: resolved.delegationBreadcrumbs });
  if (!merged.ok) {
    return checkStageFailure(testCase, merged.diagnostics, "merge()");
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

/** Shared by every stage that can fail before `validate()` ever runs (`resolve()`, `merge()`): the case's own `expect` is checked against *this* stage's diagnostics exactly as it would be against `validate()`'s. */
function checkStageFailure(testCase: ValidateCase, diagnostics: readonly Diagnostic[], stageName: string): ValidateCaseResult {
  const failures: string[] = [];
  if (testCase.expect.ok) {
    failures.push(`expected ok:true, but ${stageName} failed before validate() could run: ${diagnostics.map((d) => `${d.code} @ ${d.primary.origin.label}:${d.primary.line}:${d.primary.column}`).join("; ")}`);
    return { name: testCase.name, passed: false, failures };
  }
  checkDiagnostics(failures, testCase.fixtureDir, diagnostics, testCase.expect.diagnostics);
  return { name: testCase.name, passed: failures.length === 0, failures };
}
