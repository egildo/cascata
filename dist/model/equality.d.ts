/**
 * The single definition of model equality — SPEC.md §4.2 ("Equality is
 * defined once, on the model"), data-model.md "Equality", FR-007.
 *
 * - Scalars: equal when `kind` **and** value are equal. `int 2` is not
 *   `float 2.0` — different kinds, never coerced toward each other.
 * - Mappings: equal when they have the same key set and equal values per
 *   key, **regardless of order**.
 * - Sequences: equal when the same length and equal items **in order**.
 * - Spans and origins take **no part** in equality.
 * - Strings compare by JS string equality, which compares UTF-16 code
 *   units — the code-point sequence for any string this model can hold,
 *   since scalar strings come from valid UTF-8 input (FR-016) and so never
 *   contain lone surrogates. No Unicode normalization is applied (FR-006):
 *   precomposed `é` is not equal to `e` + combining acute.
 *
 * Everything else in the system — the corpus, merge, diamond dedup —
 * consumes this one definition rather than rolling its own.
 */
import type { Node } from "./node.js";
/** The one definition of Node equality. Spans and origins are ignored throughout. */
export declare function nodesEqual(a: Node, b: Node): boolean;
//# sourceMappingURL=equality.d.ts.map