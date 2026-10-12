/**
 * Which values of a configuration `expand()` expands -- specs/024-glob FR-012.
 *
 * "Every value at a position whose accumulated type admits `glob` (alone, in a list, or in a union)". The accumulated demand
 * (SPEC.md Article VIII, `src/generate/accumulate.ts`) is the schema chain's own answer to "what may sit here", computed from
 * the schema layers alone: this module walks the merged tree beside it, key by key and item by item, and reports the string
 * scalars that land where `glob` is admitted. A value that fails the grammar is not a pattern and is left alone (a
 * configuration that was never validated may hold one; so may a `path | glob` position, where a string that is a path and
 * not a glob is meant as the path).
 *
 * **A frame** is the demand that applies to one value: the alternatives its position's type names, and the position's
 * structure. A named type is a frame of its own -- its body, taken from the tree's declarations -- and applies to the same
 * value (`closure`). Descending into a sequence lowers every alternative by one array level and adds the position's `items`;
 * into a mapping, the position's named key, else its `values`. Nothing here reads a host or the world.
 */
import type { MergedConfiguration } from "../merge/provenance.js";
import type { Scalar } from "../model/node.js";
export interface GlobValue {
    readonly pointer: string;
    readonly node: Scalar & {
        readonly kind: "string";
    };
}
/** Every string value in `configuration` at a position whose accumulated type admits `glob`, in the tree's canonical order. */
export declare function globValues(configuration: MergedConfiguration): GlobValue[];
//# sourceMappingURL=positions.d.ts.map