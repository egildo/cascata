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
import { type Diagnostic } from "../diagnostics/diagnostic.js";
import { type Origin, type SourceSpan } from "../model/span.js";
export interface ParseLimits {
    readonly maxDepth: number;
    readonly maxBytes: number;
    /**
     * v1.10 (SPEC.md §4.2, §11, §15): the expanded tree may hold at most
     * `expansionRatio` times the model nodes the document writes, plus
     * `expansionAllowance`. YAML only — JSON has no aliases.
     */
    readonly expansionRatio: number;
    readonly expansionAllowance: number;
}
export declare const DEFAULT_LIMITS: ParseLimits;
/** Fill in any limit a caller did not specify with the default. */
export declare function resolveLimits(overrides: Partial<ParseLimits> | undefined): ParseLimits;
/**
 * `size-limit-exceeded` if `byteLength` (the *raw* input's byte length,
 * measured before any processing) exceeds `limits.maxBytes`. Checked
 * before parsing (contracts/parse-api.md), so a hostile document is
 * refused without being parsed at all — the span is zero-width at offset
 * 0, since "nothing was parsed" (contracts/diagnostics.md).
 */
export declare function checkSizeLimit(byteLength: number, limits: ParseLimits, origin: Origin): Diagnostic | undefined;
/**
 * `depth-limit-exceeded` if `depth` (the depth a node about to be walked
 * would sit at — the root is depth 0, each nested collection level below
 * it adds 1) exceeds `limits.maxDepth`. `span` is that node's own span —
 * "the node at which the limit was crossed" (contracts/diagnostics.md).
 */
export declare function checkDepthLimit(depth: number, limits: ParseLimits, span: SourceSpan): Diagnostic | undefined;
/**
 * `expansion-limit-exceeded` (v1.10, SPEC.md §11): expanding the alias at
 * `span` took the tree past `limits.expansionRatio x written +
 * limits.expansionAllowance` nodes. `built` is the count at the moment the
 * budget was crossed — the first node past it, because the count is kept as
 * the expansion proceeds and the read stops there.
 */
export declare function expansionLimitDiagnostic(built: number, written: number, limits: ParseLimits, span: SourceSpan): Diagnostic;
//# sourceMappingURL=limits.d.ts.map