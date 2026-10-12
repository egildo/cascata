/**
 * The read-back's comparison -- v1.15 FR-014, FR-019: the edited document's tree is the original tree with the operation
 * applied at the pointer, **whole**: every sibling, every ancestor, every key survives, not just the place that was
 * edited. Format-blind. The operation is a list of `Op`s -- one per place that held the bytes (a value and its alias and
 * merge-key copies, v1.12 FR-007) -- and the original tree is never rebuilt: a path nothing touches is compared with
 * §4.2's one definition of equality, and the places the operations touch are compared with what they should hold.
 */
import type { Node } from "../model/node.js";
import { type EditData } from "./edit-data.js";
export type At = {
    readonly key: string;
} | {
    readonly index: number;
};
/**
 * `tolerant` is a mapping that merges the one being edited (v1.15 FR-020, `<<: *base`): it gains or loses the key too, unless it
 * overrides it or another source supplies it, so its value for that one key is not checked -- and every other key of it is.
 */
export type Op = {
    readonly kind: "replace";
    readonly path: readonly string[];
    readonly data: EditData;
} | {
    readonly kind: "add";
    readonly parent: readonly string[];
    readonly at: At;
    readonly data: EditData;
    readonly tolerant?: true;
} | {
    readonly kind: "remove";
    readonly parent: readonly string[];
    readonly at: At;
    readonly tolerant?: true;
};
/** Whether `after` is `original` with every operation applied. */
export declare function treeMatches(original: Node, after: Node, ops: readonly Op[]): boolean;
//# sourceMappingURL=readback.d.ts.map