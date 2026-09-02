/**
 * The real JSON adapter as one function, dispatching on whether it is
 * given decoded text or raw bytes — the exact shape of
 * `tests/corpus/yaml-adapter.ts`, and for the same reason: the runner
 * stays format-agnostic, and the format-specific wiring lives in the
 * tests that build an `AdapterRegistry`.
 *
 * Unlike the YAML shim, this one calls the adapter's own two entry points
 * rather than `src/index.ts`'s `parse`/`parseText`: those two are
 * hard-wired to YAML (v1.2 spec.md, Out of Scope — giving them a `format`
 * option would be a surface addition with its own §15 entry, and the
 * motivating consumer reaches JSON through `load()`). The adapter is
 * still the real one; only the wrapper differs.
 */

import { parseJsonBytes, parseJsonText, type ParseOutcome } from "../../src/adapters/json/parse.js";
import type { ParseLimits } from "../../src/adapters/limits.js";
import type { Origin } from "../../src/model/span.js";

export function parseJsonInput(input: string | Uint8Array, options: { origin: Origin; limits?: Partial<ParseLimits> }): ParseOutcome {
  return typeof input === "string" ? parseJsonText(input, options.origin, options.limits) : parseJsonBytes(input, options.origin, options.limits);
}
