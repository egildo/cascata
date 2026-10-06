/**
 * The YAML adapter's conversion layer — SPEC.md §4.1, §4.2; plan.md's D1
 * ("a strict conversion layer over `yaml`'s AST, not a parser").
 *
 * `src/adapters/yaml/` is the one format-aware directory in the codebase
 * (Principle IV) — this file is where `yaml` (eemeli's) is imported.
 * Everything below turns its AST into Cascata's format-blind model,
 * computing every span itself rather than trusting the library's ranges
 * verbatim: two empirical findings (recorded in the Phase 3 report, and
 * confirmed independently by re-probing before Phase 4 began) meant
 * `research.md`'s probe table was not quite right about what `yaml` hands
 * back:
 *
 *   1. `range`/`.pos` offsets are **UTF-16 code-unit indices** into the JS
 *      string, not UTF-8 byte offsets, despite research.md's original probe
 *      table calling them "byte offsets". They diverge for any character
 *      above U+007F. `SourceSpan.start`/`.end` are contractually bytes
 *      (data-model.md), so this file converts, via a single-pass byte
 *      offset table built once per document (`buildByteOffsetTable`) —
 *      not by re-encoding a growing prefix per node, which would be
 *      quadratic in document size.
 *   2. `LineCounter#linePos().col` is also UTF-16-code-unit-based, not
 *      code-point-based, so it disagrees with data-model.md's "column is
 *      code points" for any line containing an astral character (one
 *      requiring a UTF-16 surrogate pair) before the position in
 *      question. `LineCounter` is trusted for the *line* number only
 *      (newlines are never surrogate halves, so line-counting is
 *      unaffected); column is recomputed by counting actual Unicode code
 *      points from that line's start.
 *
 * A leading byte-order mark is **kept** (v1.9, SPEC.md §4.2): it is three
 * stored bytes, so `byteOffsetTable` counts it in every offset after it,
 * and a mark at the very start of the stored bytes is never a column
 * (`codePointColumn`; any other U+FEFF is a character). Prefix marks are
 * removed from the text `yaml` reads and its indices mapped back (`marks.ts`).
 *
 * Revised for User Story 2 (Phase 4): FR-019 requires one read to report
 * every floor violation it can detect, not the first. Every conversion
 * function below now returns `Node | undefined` and *records* a
 * diagnostic rather than throwing one, so a violation anywhere does not
 * stop the walk from finding others elsewhere in the document (SC-003).
 * The only two checks that still short-circuit the whole read are the
 * size cap (checked before parsing at all, per contracts/parse-api.md —
 * "nothing was parsed") and an internal-consistency guard that should
 * never fire on real input.
 */
import { type Diagnostic } from "../../diagnostics/diagnostic.js";
import { type Node } from "../../model/node.js";
import { type Origin } from "../../model/span.js";
import { type ParseLimits } from "../limits.js";
/** Mirrors contracts/parse-api.md's `ParseResult` shape; re-exported (as `ParseResult`) from `src/index.ts`. */
export type ParseOutcome = {
    ok: true;
    tree: Node;
} | {
    ok: false;
    diagnostics: Diagnostic[];
};
/**
 * Parse YAML text into a Cascata tree or a non-empty, position-ordered
 * list of diagnostics — never both (research D5). Does not freeze the
 * returned tree — that is `src/index.ts`'s job, so the adapter itself
 * stays reusable by anything that wants the raw walk.
 */
export declare function parseYaml(rawText: string, origin: Origin, limitOverrides?: Partial<ParseLimits>): ParseOutcome;
/**
 * Parse YAML bytes into a Cascata tree or a non-empty diagnostic list.
 * The primary v0.2 entry point (contracts/resolve-api.md): validates
 * UTF-8 on the bytes themselves, then decodes and delegates to
 * `parseYaml`, so a valid document produces byte-for-byte the same tree
 * (spans included) `parseYaml` would from the equivalent text (FR-004) —
 * they are, after this point, literally the same function call.
 *
 * `TextDecoder`'s `ignoreBOM` option is set to `true` here — the
 * WHATWG-spec-confusing name means "do not silently strip a leading BOM
 * yourself": `ignoreBOM: false` (the default) makes the decoder strip it,
 * which would hide the mark from every offset after it. Since v1.9 the mark
 * is stored bytes and must reach `parseYaml` intact (sabotage-testing the
 * v0.2 form of this function is what first exposed the double negative).
 */
export declare function parseYamlBytes(bytes: Uint8Array, origin: Origin, limitOverrides?: Partial<ParseLimits>): ParseOutcome;
//# sourceMappingURL=parse.d.ts.map