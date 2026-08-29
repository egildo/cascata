/**
 * Resource limits — SPEC.md §11, contracts/parse-api.md's "Limits" table,
 * research D7.
 *
 * §4.2/§11 mandate that depth and size be capped but name no numbers; the
 * defaults here are research D7's proposals, generous against real
 * configuration documents and hostile to pathological ones. Both are
 * public options (contracts/parse-api.md), surfaced through
 * `src/index.ts`'s `ParseOptions.limits`.
 */

import { createDiagnostic, type Diagnostic } from "../../diagnostics/diagnostic.js";
import { createSourceSpan, type Origin, type SourceSpan } from "../../model/span.js";

export interface ParseLimits {
  readonly maxDepth: number;
  readonly maxBytes: number;
}

export const DEFAULT_LIMITS: ParseLimits = {
  maxDepth: 64,
  maxBytes: 8 * 1024 * 1024,
};

/** Fill in any limit a caller did not specify with the default. */
export function resolveLimits(overrides: Partial<ParseLimits> | undefined): ParseLimits {
  return {
    maxDepth: overrides?.maxDepth ?? DEFAULT_LIMITS.maxDepth,
    maxBytes: overrides?.maxBytes ?? DEFAULT_LIMITS.maxBytes,
  };
}

/**
 * `size-limit-exceeded` if `byteLength` (the *raw* input's byte length,
 * measured before any processing) exceeds `limits.maxBytes`. Checked
 * before parsing (contracts/parse-api.md), so a hostile document is
 * refused without being parsed at all — the span is zero-width at offset
 * 0, since "nothing was parsed" (contracts/diagnostics.md).
 */
export function checkSizeLimit(byteLength: number, limits: ParseLimits, origin: Origin): Diagnostic | undefined {
  if (byteLength <= limits.maxBytes) {
    return undefined;
  }
  const primary: SourceSpan = createSourceSpan({ origin, start: 0, end: 0, line: 1, column: 1, documentLength: byteLength });
  return createDiagnostic({
    code: "size-limit-exceeded",
    message: `Input is ${byteLength} bytes, exceeding the ${limits.maxBytes}-byte limit`,
    primary,
  });
}

/**
 * `depth-limit-exceeded` if `depth` (the depth a node about to be walked
 * would sit at — the root is depth 0, each nested collection level below
 * it adds 1) exceeds `limits.maxDepth`. `span` is that node's own span —
 * "the node at which the limit was crossed" (contracts/diagnostics.md).
 */
export function checkDepthLimit(depth: number, limits: ParseLimits, span: SourceSpan): Diagnostic | undefined {
  if (depth <= limits.maxDepth) {
    return undefined;
  }
  return createDiagnostic({
    code: "depth-limit-exceeded",
    message: `Nesting depth ${depth} exceeds the ${limits.maxDepth}-level limit`,
    primary: span,
  });
}
