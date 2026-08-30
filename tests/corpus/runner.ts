/**
 * The conformance corpus runner — contracts/conformance-case.md "Runner
 * contract", FR-021–FR-024.
 *
 * This is the Phase 2 "minimum viable" runner (tasks.md T015): it can
 * discover, load, execute, and report every case, generically over
 * whichever adapters are registered. No adapter is registered yet — the
 * YAML adapter arrives with User Story 1 (`src/adapters/yaml/parse.ts`),
 * and the runner is written now so registering it later requires no
 * change here, only an entry in the `AdapterRegistry` a caller builds.
 *
 * `ParseOutcome`/`Adapter` mirror contracts/parse-api.md's public shape
 * (`{ ok: true, tree } | { ok: false, diagnostics }`) rather than importing
 * it from `src/index.ts`, because the public entry point is User Story 1
 * work and did not exist at the time this file was first written. The
 * shapes are structurally identical by construction, so wiring the real
 * `parse()` in needs no change to this file.
 *
 * Revised once User Story 1 cases were actually being authored against it
 * (see tests/corpus/case.ts's revision note): tree comparison is now
 * order-sensitive for mappings, span assertions can carry byte extent
 * (`start`/`end`), and diagnostic comparison also checks `related` spans.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Diagnostic, RelatedSpan } from "../../src/diagnostics/diagnostic.js";
import { nodesEqual } from "../../src/model/equality.js";
import type { Node } from "../../src/model/node.js";
import type { Origin } from "../../src/model/span.js";
import { createOrigin } from "../../src/model/span.js";
import type { ConformanceCase, ExpectedDiagnostic, ExpectedLimits, ExpectedNode, ExpectedRelatedSpan } from "./case.js";
import { loadCase, sourceOf } from "./case.js";

/** Mirrors contracts/parse-api.md's `ParseResult` — see module doc for why this is not imported. */
export type ParseOutcome = { ok: true; tree: Node } | { ok: false; diagnostics: readonly Diagnostic[] };

/**
 * One format adapter under test, e.g. the YAML adapter. `input` is either
 * decoded text or raw bytes — v0.2's bytes entry point (contracts/
 * resolve-api.md) needs cases exercising both, and an adapter registered
 * here is expected to dispatch on which one it was given. `limits` is
 * optional — a case omitting it gets the adapter's own defaults.
 */
export type Adapter = (input: string | Uint8Array, origin: Origin, limits?: ExpectedLimits) => ParseOutcome;

/** Format name -> adapter. Selecting by `format` is what keeps this runner itself format-agnostic. */
export type AdapterRegistry = Readonly<Record<string, Adapter>>;

/** Pass/fail for one named case, with human-readable detail on failure (runner contract point 2). */
export interface CaseResult {
  readonly name: string;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

const CASE_FILE_PATTERN = /\.json$/;

/** Recursively find every case file under `rootDir`, in a stable sorted order. */
export function discoverCaseFiles(rootDir: string): string[] {
  const found: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile() && CASE_FILE_PATTERN.test(entry.name)) {
        found.push(entryPath);
      }
    }
  }

  walk(rootDir);
  return found;
}

/** Discover every case file under `rootDir` and load (and validate) each one. */
export function loadCases(rootDir: string): ConformanceCase[] {
  return discoverCaseFiles(rootDir).map((file) => loadCase(file));
}

// --- RFC 6901 JSON Pointer resolution, for selective span assertions ---

function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Resolve an RFC 6901 pointer against a Node tree. `""` (or `"/"`... no, exactly `""`) selects the root. */
function resolvePointer(root: Node, pointer: string): Node | undefined {
  if (pointer === "") {
    return root;
  }
  if (!pointer.startsWith("/")) {
    throw new Error(`Malformed JSON Pointer '${pointer}': must be empty or start with '/'`);
  }
  const segments = pointer.slice(1).split("/").map(unescapePointerSegment);

  let current: Node | undefined = root;
  for (const segment of segments) {
    if (current === undefined) {
      return undefined;
    }
    if (current.type === "mapping") {
      current = current.entries.get(segment);
    } else if (current.type === "sequence") {
      if (!/^\d+$/.test(segment)) {
        return undefined;
      }
      current = current.items[Number(segment)];
    } else {
      return undefined;
    }
  }
  return current;
}

// --- Tree comparison -----------------------------------------------------

function describeExpected(expected: ExpectedNode): string {
  if ("kind" in expected) {
    return expected.kind === "null" ? "null" : `${expected.kind} ${JSON.stringify(expected.value)}`;
  }
  if ("mapping" in expected) {
    return "a mapping";
  }
  return "a sequence";
}

function describeActual(actual: Node): string {
  if (actual.type === "scalar") {
    const value = actual.kind === "int" ? actual.value.toString() : actual.value;
    return actual.kind === "null" ? "null" : `${actual.kind} ${JSON.stringify(value)}`;
  }
  return actual.type === "mapping" ? "a mapping" : "a sequence";
}

function compareNode(actual: Node, expected: ExpectedNode, path: string, failures: string[]): void {
  if ("kind" in expected) {
    if (actual.type !== "scalar") {
      failures.push(`${path || "(root)"}: expected ${describeExpected(expected)}, got ${describeActual(actual)}`);
      return;
    }
    if (actual.kind !== expected.kind) {
      failures.push(`${path || "(root)"}: expected kind '${expected.kind}', got kind '${actual.kind}'`);
      return;
    }
    const matches =
      expected.kind === "null"
        ? true
        : expected.kind === "int"
          ? actual.value === BigInt(expected.value)
          : actual.value === expected.value;
    if (!matches) {
      failures.push(`${path || "(root)"}: expected value ${describeExpected(expected)}, got ${describeActual(actual)}`);
    }
    return;
  }

  if ("mapping" in expected) {
    if (actual.type !== "mapping") {
      failures.push(`${path || "(root)"}: expected ${describeExpected(expected)}, got ${describeActual(actual)}`);
      return;
    }
    const expectedKeysInOrder = expected.mapping.map(([key]) => key);
    const actualKeysInOrder = [...actual.entries.keys()];
    const expectedKeys = new Set(expectedKeysInOrder);
    const actualKeys = new Set(actualKeysInOrder);

    const beforeKeySetChecks = failures.length;
    for (const key of expectedKeys) {
      if (!actualKeys.has(key)) {
        failures.push(`${path || "(root)"}: missing expected key '${key}'`);
      }
    }
    for (const key of actualKeys) {
      if (!expectedKeys.has(key)) {
        failures.push(`${path || "(root)"}: unexpected key '${key}'`);
      }
    }

    // Order is significant here (FR-003) but only worth reporting once the
    // key sets already agree — otherwise this would just restate the
    // missing/unexpected-key failures above in a more confusing shape.
    if (
      failures.length === beforeKeySetChecks &&
      expectedKeysInOrder.some((key, index) => key !== actualKeysInOrder[index])
    ) {
      failures.push(
        `${path || "(root)"}: entry order does not match — expected [${expectedKeysInOrder.join(", ")}], got [${actualKeysInOrder.join(", ")}]`,
      );
    }

    for (const [key, expectedChild] of expected.mapping) {
      const actualChild = actual.entries.get(key);
      if (actualChild !== undefined) {
        compareNode(actualChild, expectedChild, `${path}/${escapePointer(key)}`, failures);
      }
    }
    return;
  }

  // "sequence" in expected
  if (actual.type !== "sequence") {
    failures.push(`${path || "(root)"}: expected ${describeExpected(expected)}, got ${describeActual(actual)}`);
    return;
  }
  if (actual.items.length !== expected.sequence.length) {
    failures.push(
      `${path || "(root)"}: expected a sequence of length ${expected.sequence.length}, got length ${actual.items.length}`,
    );
  }
  const shared = Math.min(actual.items.length, expected.sequence.length);
  for (let index = 0; index < shared; index += 1) {
    const actualItem = actual.items[index];
    const expectedItem = expected.sequence[index];
    if (actualItem !== undefined && expectedItem !== undefined) {
      compareNode(actualItem, expectedItem, `${path}/${index}`, failures);
    }
  }
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Compares one diagnostic's `related` spans against what a case expects, in order. */
function compareRelatedSpans(actual: readonly RelatedSpan[], expected: readonly ExpectedRelatedSpan[], failures: string[]): void {
  if (actual.length !== expected.length) {
    failures.push(`expected ${expected.length} related span(s), got ${actual.length}`);
    return;
  }
  for (let index = 0; index < expected.length; index += 1) {
    const exp = expected[index];
    const act = actual[index];
    if (exp === undefined || act === undefined) {
      continue; // unreachable given the length check above; satisfies noUncheckedIndexedAccess.
    }
    if (act.span.line !== exp.line || act.span.column !== exp.column) {
      failures.push(`related[${index}]: expected ${exp.line}:${exp.column}, got ${act.span.line}:${act.span.column}`);
    }
    if (exp.start !== undefined && act.span.start !== exp.start) {
      failures.push(`related[${index}]: expected start ${exp.start}, got ${act.span.start}`);
    }
    if (exp.end !== undefined && act.span.end !== exp.end) {
      failures.push(`related[${index}]: expected end ${exp.end}, got ${act.span.end}`);
    }
    if (exp.label !== undefined && act.label !== exp.label) {
      failures.push(`related[${index}]: expected label '${exp.label}', got '${act.label}'`);
    }
  }
}

/**
 * Diagnostics are compared as a **set** of {code, line, column}
 * (contracts/conformance-case.md), reporting both missing and unexpected
 * entries. Once a primary-position match is found, its `start`/`end` and
 * `related` spans (when the case asserts them) are checked against that
 * specific matched diagnostic — a mismatch there is reported as its own
 * failure rather than as "missing", since the diagnostic itself was found.
 */
function compareDiagnostics(actual: readonly Diagnostic[], expected: readonly ExpectedDiagnostic[], failures: string[]): void {
  const remainingActual = actual.map((diagnostic) => ({ diagnostic, claimed: false }));

  for (const exp of expected) {
    const match = remainingActual.find(
      (entry) => !entry.claimed && entry.diagnostic.code === exp.code && entry.diagnostic.primary.line === exp.line && entry.diagnostic.primary.column === exp.column,
    );
    if (match === undefined) {
      failures.push(`missing expected diagnostic ${exp.code} at ${exp.line}:${exp.column}`);
      continue;
    }
    match.claimed = true;
    const primary = match.diagnostic.primary;
    if (exp.start !== undefined && primary.start !== exp.start) {
      failures.push(`diagnostic ${exp.code} at ${exp.line}:${exp.column}: expected start ${exp.start}, got ${primary.start}`);
    }
    if (exp.end !== undefined && primary.end !== exp.end) {
      failures.push(`diagnostic ${exp.code} at ${exp.line}:${exp.column}: expected end ${exp.end}, got ${primary.end}`);
    }
    if (exp.related !== undefined) {
      compareRelatedSpans(match.diagnostic.related, exp.related, failures);
    }
  }
  for (const entry of remainingActual) {
    if (!entry.claimed) {
      failures.push(`unexpected diagnostic ${entry.diagnostic.code} at ${entry.diagnostic.primary.line}:${entry.diagnostic.primary.column}`);
    }
  }
}

/** Execute one case against the registered adapters, returning its pass/fail result. */
export function runCase(testCase: ConformanceCase, adapters: AdapterRegistry): CaseResult {
  const adapter = adapters[testCase.format];
  if (adapter === undefined) {
    // Fails loudly rather than being reported as a soft test failure: an
    // unregistered format is a corpus/harness wiring problem, not a
    // legitimate case outcome (runner contract point 5).
    throw new Error(`Conformance case '${testCase.name}' names format '${testCase.format}', which has no registered adapter`);
  }

  const origin = createOrigin(testCase.name, testCase.name);
  const outcome = adapter(sourceOf(testCase), origin, testCase.limits);
  const failures: string[] = [];

  if ("tree" in testCase.expect) {
    if (!outcome.ok) {
      const codes = outcome.diagnostics.map((d) => `${d.code} at ${d.primary.line}:${d.primary.column}`).join(", ");
      failures.push(`expected an accepted tree, but parsing produced diagnostics: [${codes}]`);
    } else {
      compareNode(outcome.tree, testCase.expect.tree, "", failures);
      for (const span of testCase.expect.spans ?? []) {
        const node = resolvePointer(outcome.tree, span.pointer);
        if (node === undefined) {
          failures.push(`span assertion at '${span.pointer}': no node at that pointer`);
          continue;
        }
        if (node.span.line !== span.line || node.span.column !== span.column) {
          failures.push(
            `span assertion at '${span.pointer}': expected ${span.line}:${span.column}, got ${node.span.line}:${node.span.column}`,
          );
        }
        if (span.start !== undefined && node.span.start !== span.start) {
          failures.push(`span assertion at '${span.pointer}': expected start ${span.start}, got ${node.span.start}`);
        }
        if (span.end !== undefined && node.span.end !== span.end) {
          failures.push(`span assertion at '${span.pointer}': expected end ${span.end}, got ${node.span.end}`);
        }
      }
    }
  } else if ("equalTo" in testCase.expect) {
    if (!outcome.ok) {
      const codes = outcome.diagnostics.map((d) => `${d.code} at ${d.primary.line}:${d.primary.column}`).join(", ");
      failures.push(`expected the first document to parse, but it produced diagnostics: [${codes}]`);
    } else {
      const otherOutcome = adapter(testCase.expect.equalTo, origin, testCase.limits);
      if (!otherOutcome.ok) {
        const codes = otherOutcome.diagnostics.map((d) => `${d.code} at ${d.primary.line}:${d.primary.column}`).join(", ");
        failures.push(`expected the second ('equalTo') document to parse, but it produced diagnostics: [${codes}]`);
      } else if (!nodesEqual(outcome.tree, otherOutcome.tree)) {
        failures.push("expected the two documents to produce model-equal trees (nodesEqual), but they did not");
      }
    }
  } else {
    if (outcome.ok) {
      failures.push("expected diagnostics, but parsing produced an accepted tree");
    } else {
      compareDiagnostics(outcome.diagnostics, testCase.expect.diagnostics, failures);
    }
  }

  return { name: testCase.name, passed: failures.length === 0, failures };
}

/** Execute every case. One failure never prevents another from running (runner contract point 1). */
export function runCases(cases: readonly ConformanceCase[], adapters: AdapterRegistry): CaseResult[] {
  return cases.map((testCase) => runCase(testCase, adapters));
}
