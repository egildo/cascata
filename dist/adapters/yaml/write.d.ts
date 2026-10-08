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
import type { Node } from "../../model/node.js";
import type { Origin } from "../../model/span.js";
import { type FindResult, type Found } from "../edit.js";
import type { ParseLimits } from "../limits.js";
export declare function findYaml(bytes: Uint8Array, origin: Origin, limits: Partial<ParseLimits> | undefined, pointer: string): FindResult;
/** Parse bytes the way the reader does, for the read-back; `undefined` if they do not parse. */
export declare function parseBack(bytes: Uint8Array, origin: Origin, limits: Partial<ParseLimits> | undefined): Node | undefined;
/** YAML spells the three non-finite floats `.nan`, `.inf`, `-.inf`. */
export declare function yamlNonFinite(value: number): string;
/**
 * A value that has no bytes yet (`a:` followed by a line break, `a: # c`) is
 * replaced at an empty range, so the text needs the space the colon wanted
 * before it, and the space a comment needs after it. Both are inside the
 * edit; no byte outside it moves.
 */
export declare function yamlPadding(bytes: Uint8Array, at: number, text: string): string;
export declare function renderYamlString(text: string, found: Found): string;
//# sourceMappingURL=write.d.ts.map