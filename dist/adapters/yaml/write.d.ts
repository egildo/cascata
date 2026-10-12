/**
 * The YAML half of writing a value back — SPEC.md Article IX (§19, v1.10);
 * specs/018-write-value.
 *
 * `findYaml` walks the pointer through the `yaml` document the reader parsed
 * (`parseYamlBytes`' `onDocument` hook: ranges already in stored indices,
 * v1.9) rather than through Cascata's model, because the model has forgotten
 * what a writer needs: that a value arrived through an alias or a merge key,
 * what style the scalar was written in, and whether it sits in a flow
 * collection. Spans still come from the reader's own `toSourceSpan`, so a
 * located range is exactly the span `parse` reports.
 *
 * `renderYamlString` is FR-008. A plain scalar is the nicest spelling and the
 * easiest to get wrong, so the rule is conservative on purpose: **plain only
 * if it reads back as the same string under Cascata's reader and under YAML
 * 1.1's** (`yes`, `no`, `on`, `off`, `y`, `n` are strings to Cascata and
 * booleans to a reader that has not heard of YAML 1.2). Whatever is not
 * plainly safe is quoted — in the style the replaced scalar used where that
 * style can hold the text, double-quoted with YAML escapes where it cannot.
 * The probe behind each clause is in `specs/018-write-value/plan.md`.
 */
import type { Diagnostic } from "../../diagnostics/diagnostic.js";
import type { Node } from "../../model/node.js";
import type { Origin, SourceSpan } from "../../model/span.js";
import { type Found, type FormatOpened } from "../edit.js";
import type { ParseLimits } from "../limits.js";
import { type Facts } from "./facts.js";
/** The span of the key `key` of the mapping `container` is, whether the pair is its own or a merge key supplies it (v1.15 FR-013). */
export declare function yamlKeySpan(facts: Facts, container: Found, key: string): SourceSpan | undefined;
/**
 * Whether the pair `target` is, in a mapping whose merge keys supply the same key, overrides a merged value (v1.15 FR-018):
 * removing it would let the merged value show through. Answers the key's span and the merged value's.
 */
export declare function yamlMergedUnder(facts: Facts, target: Found): {
    readonly key: SourceSpan;
    readonly merged: SourceSpan;
} | undefined;
type OpenOutcome<T> = {
    readonly ok: true;
    readonly opened: T;
} | {
    readonly ok: false;
    readonly diagnostics: Diagnostic[];
};
/** Every document is parsed once (v1.15 FR-004); what the writer keeps of the parse is in `facts.ts`. */
export declare function openYaml(bytes: Uint8Array, origin: Origin, limits: Partial<ParseLimits> | undefined): OpenOutcome<FormatOpened>;
/** Parse bytes the way the reader does, for the read-back; `undefined` if they do not parse. */
export declare function parseBack(bytes: Uint8Array, origin: Origin, limits: Partial<ParseLimits> | undefined): Node | undefined;
export { renderYamlString, yamlNonFinite, yamlPadding } from "./spell.js";
//# sourceMappingURL=write.d.ts.map