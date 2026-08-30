/**
 * The real YAML adapter as one function, dispatching on whether it is
 * given decoded text or raw bytes (`src/index.ts`'s `parseText`/`parse`).
 *
 * `tests/corpus/runner.ts` stays format-agnostic by design (T051: "the
 * runner contains no format-specific logic itself") — the format-specific
 * wiring belongs in the test files that build an `AdapterRegistry`, not
 * in the runner. This file is that wiring, factored out once so
 * `corpus.test.ts` (registering it), `totality.test.ts`, `hermetic.test.ts`,
 * and `determinism.test.ts` (calling it directly, bypassing the full
 * case-comparison machinery `runCase` provides) share one dispatch rather
 * than four copies of `typeof input === "string" ? parseText(...) : parse(...)`.
 */

import { parse, parseText, type ParseOptions, type ParseResult } from "../../src/index.js";

export function parseYamlInput(input: string | Uint8Array, options: ParseOptions): ParseResult {
  return typeof input === "string" ? parseText(input, options) : parse(input, options);
}
