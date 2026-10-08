/**
 * Resource limits — SPEC.md §11, contracts/parse-api.md's "Limits" table,
 * research D7.
 *
 * Written for the YAML adapter in v0.1 and living in `yaml/limits.ts` until
 * v1.2, when the JSON adapter needed the identical caps. SPEC.md §11 is
 * about *documents*, not about YAML, so the module moved up one level
 * beside `encoding.ts` rather than being imported across from one adapter
 * into its sibling (specs/011-json-adapter research P-2 makes the same
 * argument for the UTF-8 validator). Not a line of it changed.
 *
 * §4.2/§11 mandate that depth and size be capped but name no numbers; the
 * defaults here are research D7's proposals, generous against real
 * configuration documents and hostile to pathological ones. Both are
 * public options (contracts/parse-api.md), surfaced through
 * `src/index.ts`'s `ParseOptions.limits`.
 */
import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { createSourceSpan } from "../model/span.js";
export const DEFAULT_LIMITS = {
    maxDepth: 64,
    maxBytes: 8 * 1024 * 1024,
    expansionRatio: 10,
    expansionAllowance: 10_000,
};
/** Fill in any limit a caller did not specify with the default. */
export function resolveLimits(overrides) {
    return {
        maxDepth: overrides?.maxDepth ?? DEFAULT_LIMITS.maxDepth,
        maxBytes: overrides?.maxBytes ?? DEFAULT_LIMITS.maxBytes,
        expansionRatio: overrides?.expansionRatio ?? DEFAULT_LIMITS.expansionRatio,
        expansionAllowance: overrides?.expansionAllowance ?? DEFAULT_LIMITS.expansionAllowance,
    };
}
/**
 * `size-limit-exceeded` if `byteLength` (the *raw* input's byte length,
 * measured before any processing) exceeds `limits.maxBytes`. Checked
 * before parsing (contracts/parse-api.md), so a hostile document is
 * refused without being parsed at all — the span is zero-width at offset
 * 0, since "nothing was parsed" (contracts/diagnostics.md).
 */
export function checkSizeLimit(byteLength, limits, origin) {
    if (byteLength <= limits.maxBytes) {
        return undefined;
    }
    const primary = createSourceSpan({ origin, start: 0, end: 0, line: 1, column: 1, documentLength: byteLength });
    return createDiagnostic({ level: "error",
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
export function checkDepthLimit(depth, limits, span) {
    if (depth <= limits.maxDepth) {
        return undefined;
    }
    return createDiagnostic({ level: "error",
        code: "depth-limit-exceeded",
        message: `Nesting depth ${depth} exceeds the ${limits.maxDepth}-level limit`,
        primary: span,
    });
}
/**
 * `expansion-limit-exceeded` (v1.10, SPEC.md §11): expanding the alias at
 * `span` took the tree past `limits.expansionRatio x written +
 * limits.expansionAllowance` nodes. `built` is the count at the moment the
 * budget was crossed — the first node past it, because the count is kept as
 * the expansion proceeds and the read stops there.
 */
export function expansionLimitDiagnostic(built, written, limits, span) {
    const budget = limits.expansionRatio * written + limits.expansionAllowance;
    return createDiagnostic({
        level: "error",
        code: "expansion-limit-exceeded",
        message: `Expanding this alias builds more of the document than it is allowed to: it writes ${written} nodes, so the expanded tree may hold at most ${limits.expansionRatio} x ${written} + ${limits.expansionAllowance} = ${budget}, and it had reached ${built}`,
        primary: span,
    });
}
//# sourceMappingURL=limits.js.map