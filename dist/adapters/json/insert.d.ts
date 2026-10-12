/**
 * Replacing, adding and removing in a JSON document -- SPEC.md Article IX (v1.15); specs/025-open-insert-delete FR-010.
 *
 * JSON has no styles to speak of beyond layout, so a writer's style is whitespace: whether a container is on one line or
 * one member per line, the indentation (spaces or tabs, how many), the blanks after `:` and `,`. They are copied from the
 * nearest sibling, then from the document: its first indentation increase is its step, and a document in which no
 * container spans a line break stays on one line. Member positions are scanned from the bytes (the model's mappings
 * are sorted by key, so their order says nothing about the document's); the model supplies where each value ends.
 */
import type { Node } from "../../model/node.js";
import type { SourceSpan } from "../../model/span.js";
import { type EditData } from "../edit-data.js";
import type { Found } from "../edit.js";
import { type Plan } from "../plan.js";
/** What one parse of a JSON document leaves for its writer, and what is worked out about it once. */
export interface JsonFacts {
    readonly bytes: Uint8Array;
    readonly tree: Node;
    multiline: boolean | undefined;
    unit: string | undefined;
    eol: string | undefined;
}
export declare function newJsonFacts(bytes: Uint8Array, tree: Node): JsonFacts;
export type AddAt = {
    readonly key: string;
} | {
    readonly index: number;
};
/** The plan that makes the value at `found` (pointer `pointer`) equal `data` where either is a container (v1.15 FR-008). */
export declare function planJsonReplace(facts: JsonFacts, found: Found, pointer: string, data: EditData, parent: Found | undefined): Plan;
/** The plan that adds `data` at `at` to the container at `container` (v1.15 FR-012). */
export declare function planJsonAdd(facts: JsonFacts, container: Found, at: AddAt, data: EditData): Plan;
/** The plan that removes the member `at` names, with one comma (v1.15 FR-016, FR-017). */
export declare function planJsonRemove(facts: JsonFacts, container: Found, at: AddAt): Plan;
/** The span of the key `key` of the object `container` (v1.15 FR-013): for a diagnostic, so it needs the reader's line and column. */
export declare function jsonKeyRange(facts: JsonFacts, container: Found, key: string): {
    readonly start: number;
    readonly end: number;
} | undefined;
export declare function isIndex(segment: string): boolean;
export type { SourceSpan };
//# sourceMappingURL=insert.d.ts.map