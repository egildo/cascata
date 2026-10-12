/**
 * How a YAML scalar is spelled -- SPEC.md Article IX (§19, v1.10); specs/018-write-value FR-008.
 *
 * A plain scalar is the nicest spelling and the easiest to get wrong, so the rule is conservative on
 * purpose: **plain only if it reads back as the same string under Cascata's reader and under YAML
 * 1.1's** (`yes`, `no`, `on`, `off`, `y`, `n` are strings to Cascata and booleans to a reader that
 * has not heard of YAML 1.2). Whatever is not plainly safe is quoted -- in the style the replaced
 * scalar used where that style can hold the text, double-quoted with YAML escapes where it cannot.
 * The probe behind each clause is in `specs/018-write-value/plan.md`. Since v1.15 the same rule
 * spells a mapping's keys and the strings of a container written whole.
 */
import type { Found } from "../edit.js";
/** YAML spells the three non-finite floats `.nan`, `.inf`, `-.inf`. */
export declare function yamlNonFinite(value: number): string;
/**
 * A value that has no bytes yet (`a:` followed by a line break, `a: # c`) is
 * replaced at an empty range, so the text needs the space the colon wanted
 * before it, and the space a comment needs after it. Both are inside the
 * edit; no byte outside it moves.
 */
export declare function yamlPadding(bytes: Uint8Array, at: number, text: string): string;
export declare function renderYamlString(text: string, found: Pick<Found, "style" | "inFlow">): string;
//# sourceMappingURL=spell.d.ts.map