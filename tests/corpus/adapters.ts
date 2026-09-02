/**
 * The one adapter registry every corpus-wide test shares — v1.2
 * (specs/011-json-adapter T013, research P-6).
 *
 * Before this file, `tests/corpus/corpus.test.ts` built its own registry
 * and three whole-corpus property tests (`totality`, `hermetic`,
 * `entry-parity`) each reached for `parseYamlInput` directly, feeding
 * **every** case to the YAML adapter whatever its own `format` field
 * said. With one format that was invisible; with two it would have fed
 * JSON documents to a YAML parser, which `entry-parity` — the one of the
 * three that asserts a parse *succeeds* — would have failed on.
 *
 * One registry, consulted by format, keeps each of those properties
 * meaning what its own doc comment says it means, for every adapter
 * rather than for one.
 */

import type { AdapterRegistry } from "./runner.js";
import { parseYamlInput } from "./yaml-adapter.js";
import { parseJsonInput } from "./json-adapter.js";
import type { ConformanceCase } from "./case.js";
import type { ParseOutcome } from "./runner.js";
import type { ExpectedLimits } from "./case.js";
import type { Origin } from "../../src/model/span.js";

export const ADAPTERS: AdapterRegistry = {
  yaml: (input, origin, limits) => parseYamlInput(input, { origin, limits }),
  json: (input, origin, limits) => parseJsonInput(input, { origin, limits }),
};

/** The adapter a case names, or a loud failure — an unregistered format is a harness wiring problem, never a case outcome (the runner takes the same posture). */
export function adapterForCase(testCase: ConformanceCase): (input: string | Uint8Array, origin: Origin, limits?: ExpectedLimits) => ParseOutcome {
  const adapter = ADAPTERS[testCase.format];
  if (adapter === undefined) {
    throw new Error(`Conformance case '${testCase.name}' names format '${testCase.format}', which has no registered adapter`);
  }
  return adapter;
}
