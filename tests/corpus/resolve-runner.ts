/**
 * Executes one resolve-conformance case (`resolve-case.ts`) against the
 * real `resolve()` (src/index.ts) and reports pass/fail with
 * human-readable detail — the resolution analogue of `runner.ts`'s
 * `runCase` for parse conformance.
 */

import { join, relative } from "node:path";
import { resolve, type Graph, type GraphDocument, type Pedigree } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";
import type { ExpectedGraphDocument, ExpectedPedigreeEntry, ExpectedResolveDiagnostic, ExpectedResolveSpan, ResolveCase } from "./resolve-case.js";

export interface ResolveCaseResult {
  readonly name: string;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

function relativeLocation(fixtureDir: string, absoluteLocation: string): string {
  return relative(fixtureDir, absoluteLocation).split("\\").join("/");
}

function checkSpan(failures: string[], label: string, fixtureDir: string, actual: { readonly origin: { readonly id: string }; readonly line: number; readonly column: number; readonly start: number; readonly end: number }, expected: ExpectedResolveSpan): void {
  const actualDocument = relativeLocation(fixtureDir, actual.origin.id);
  if (actualDocument !== expected.document) {
    failures.push(`${label}: expected document '${expected.document}', got '${actualDocument}'`);
  }
  if (actual.line !== expected.line || actual.column !== expected.column) {
    failures.push(`${label}: expected position ${expected.line}:${expected.column}, got ${actual.line}:${actual.column}`);
  }
  if (expected.start !== undefined && actual.start !== expected.start) {
    failures.push(`${label}: expected byte start ${expected.start}, got ${actual.start}`);
  }
  if (expected.end !== undefined && actual.end !== expected.end) {
    failures.push(`${label}: expected byte end ${expected.end}, got ${actual.end}`);
  }
}

function checkGraph(failures: string[], fixtureDir: string, graph: Graph, expected: readonly ExpectedGraphDocument[]): void {
  if (graph.documents.length !== expected.length) {
    failures.push(`graph: expected ${expected.length} document(s), got ${graph.documents.length}`);
    return;
  }
  const actualByLocation = new Map<string, GraphDocument>(graph.documents.map((doc) => [relativeLocation(fixtureDir, doc.identity.location), doc]));
  for (const expectedDoc of expected) {
    const actualDoc = actualByLocation.get(expectedDoc.location);
    if (actualDoc === undefined) {
      failures.push(`graph: expected a document at '${expectedDoc.location}', found none (graph has: ${[...actualByLocation.keys()].join(", ")})`);
      continue;
    }
    if (actualDoc.identity.hash !== expectedDoc.hash) {
      failures.push(`graph document '${expectedDoc.location}': expected hash ${expectedDoc.hash}, got ${actualDoc.identity.hash}`);
    }
  }
}

function checkPedigree(failures: string[], fixtureDir: string, pedigree: Pedigree, expected: readonly ExpectedPedigreeEntry[]): void {
  if (pedigree.length !== expected.length) {
    failures.push(`pedigree: expected ${expected.length} entrie(s) in root-to-leaf order, got ${pedigree.length} (locations: ${pedigree.map((e) => relativeLocation(fixtureDir, e.identity.location)).join(", ")})`);
    return;
  }
  pedigree.forEach((actual, index) => {
    const expectedEntry = expected[index];
    if (expectedEntry === undefined) {
      return;
    }
    const label = `pedigree[${index}]`;
    const actualLocation = relativeLocation(fixtureDir, actual.identity.location);
    if (actualLocation !== expectedEntry.location) {
      failures.push(`${label}: expected location '${expectedEntry.location}', got '${actualLocation}'`);
    }
    if (actual.identity.hash !== expectedEntry.hash) {
      failures.push(`${label}: expected hash ${expectedEntry.hash}, got ${actual.identity.hash}`);
    }
    if (actual.via.kind !== expectedEntry.kind) {
      failures.push(`${label}: expected kind '${expectedEntry.kind}', got '${actual.via.kind}'`);
    }
    if (actual.via.authority !== expectedEntry.authority) {
      failures.push(`${label}: expected authority '${expectedEntry.authority}', got '${actual.via.authority}'`);
    }
    if (actual.verified !== expectedEntry.verified) {
      failures.push(`${label}: expected verified=${String(expectedEntry.verified)}, got ${String(actual.verified)}`);
    }
    checkSpan(failures, `${label}.via`, fixtureDir, actual.via.span, expectedEntry.via);
  });
}

function checkDiagnostics(failures: string[], fixtureDir: string, actual: readonly { readonly code: string; readonly primary: { readonly origin: { readonly id: string }; readonly line: number; readonly column: number; readonly start: number; readonly end: number }; readonly related: readonly { readonly label: string; readonly span: { readonly origin: { readonly id: string }; readonly line: number; readonly column: number; readonly start: number; readonly end: number } }[] }[], expected: readonly ExpectedResolveDiagnostic[]): void {
  if (actual.length !== expected.length) {
    failures.push(`diagnostics: expected ${expected.length}, got ${actual.length} (codes: ${actual.map((d) => d.code).join(", ")})`);
    return;
  }
  actual.forEach((actualDiag, index) => {
    const expectedDiag = expected[index];
    if (expectedDiag === undefined) {
      return;
    }
    const label = `diagnostics[${index}]`;
    if (actualDiag.code !== expectedDiag.code) {
      failures.push(`${label}: expected code '${expectedDiag.code}', got '${actualDiag.code}'`);
    }
    checkSpan(failures, `${label}.primary`, fixtureDir, actualDiag.primary, expectedDiag.primary);
    const expectedRelated = expectedDiag.related ?? [];
    if (actualDiag.related.length !== expectedRelated.length) {
      failures.push(`${label}.related: expected ${expectedRelated.length}, got ${actualDiag.related.length}`);
      return;
    }
    actualDiag.related.forEach((actualRelated, relatedIndex) => {
      const expectedRelatedSpan = expectedRelated[relatedIndex];
      if (expectedRelatedSpan === undefined) {
        return;
      }
      checkSpan(failures, `${label}.related[${relatedIndex}]`, fixtureDir, actualRelated.span, expectedRelatedSpan);
      if (expectedRelatedSpan.label !== undefined && actualRelated.label !== expectedRelatedSpan.label) {
        failures.push(`${label}.related[${relatedIndex}]: expected label '${expectedRelatedSpan.label}', got '${actualRelated.label}'`);
      }
    });
  });
}

/**
 * Run `resolve()` for one case, temporarily pointing `$HOME` at
 * `testCase.homeDir` (relative to `fixtureDir`) if the case sets one —
 * `os.homedir()` (which `src/resolve/location.ts` calls for tilde
 * expansion, v0.2 FR-029) honors `$HOME` on POSIX. Restored in a
 * `finally` even if `resolve()` throws, so one case's override can never
 * leak into another's — cases can run in the same process/worker.
 */
async function resolveWithHomeOverride(entryPath: string, sandboxRoot: string, homeDir: string | undefined, maxChainLength: number | undefined): Promise<Awaited<ReturnType<typeof resolve>>> {
  const options = { host: createNodeHost(), sandboxRoot, ...(maxChainLength === undefined ? {} : { maxChainLength }) };
  if (homeDir === undefined) {
    return resolve(entryPath, options);
  }
  const previousHome = process.env["HOME"];
  process.env["HOME"] = homeDir;
  try {
    return await resolve(entryPath, options);
  } finally {
    if (previousHome === undefined) {
      delete process.env["HOME"];
    } else {
      process.env["HOME"] = previousHome;
    }
  }
}

export async function runResolveCase(testCase: ResolveCase): Promise<ResolveCaseResult> {
  const failures: string[] = [];
  const entryPath = join(testCase.fixtureDir, testCase.entry);
  const sandboxRoot = join(testCase.fixtureDir, testCase.sandboxRoot);
  const homeDir = testCase.homeDir === undefined ? undefined : join(testCase.fixtureDir, testCase.homeDir);

  const result = await resolveWithHomeOverride(entryPath, sandboxRoot, homeDir, testCase.maxChainLength);

  if (testCase.expect.ok) {
    if (!result.ok) {
      failures.push(`expected ok:true, got ok:false with diagnostics: ${result.diagnostics.map((d) => `${d.code} @ ${d.primary.origin.label}:${d.primary.line}:${d.primary.column}`).join("; ")}`);
      return { name: testCase.name, passed: false, failures };
    }
    checkGraph(failures, testCase.fixtureDir, result.graph, testCase.expect.graph);
    checkPedigree(failures, testCase.fixtureDir, result.pedigree, testCase.expect.pedigree);
  } else {
    if (result.ok) {
      failures.push(`expected ok:false, got ok:true with a graph of ${result.graph.documents.length} document(s)`);
      return { name: testCase.name, passed: false, failures };
    }
    checkDiagnostics(failures, testCase.fixtureDir, result.diagnostics, testCase.expect.diagnostics);
  }

  return { name: testCase.name, passed: failures.length === 0, failures };
}
