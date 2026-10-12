/**
 * Replacing, adding and removing in a YAML document -- SPEC.md Article IX (v1.15); specs/025-open-insert-delete.
 *
 * Everything here answers a **plan**: bytes to put in a range of the document as opened. The range is measured
 * from the `yaml` AST the reader already holds (ranges rewritten to stored indices, `facts.ts`) and from `yaml`'s own
 * CST tokens for the characters no AST range covers: a block sequence's `-`, a mapping's `:` and `?`, an anchor or
 * a tag. Style is copied from the nearest sibling, then from the document (`render.ts` spells the value):
 * block or flow, indentation, the blanks after `:` and `,`, a sequence's dash.
 *
 * Where a block entry ends (FR-023's probe, specs/025-open-insert-delete/report.md): `yaml`'s range for a value ends
 * at the value for a scalar, an alias or a flow collection -- a trailing comment and the line break are not in it --
 * and after the line break for a block scalar and a block collection. `entryLineEnd` (text.ts) turns either into
 * "the first byte after the line the entry ends on".
 */
import { type EditData } from "../edit-data.js";
import type { Found } from "../edit.js";
import { type Plan } from "../plan.js";
import { type Facts } from "./facts.js";
/**
 * The plan that makes the value at `found` equal `data` where either is a container (v1.15 FR-008): a scalar replaced by a
 * container, a container by either. `forceBlock` writes a new container as lines even where the neighbours or the replaced
 * value are flow (`add` into an empty `{}`, FR-011).
 */
export declare function planYamlReplace(facts: Facts, found: Found, data: EditData, forceBlock?: boolean): Plan;
export type AddAt = {
    readonly key: string;
} | {
    readonly index: number;
};
/** The plan that adds `data` at `at` to the container at `container` (v1.15 FR-012). */
export declare function planYamlAdd(facts: Facts, container: Found, at: AddAt, data: EditData): Plan;
/** The plan that removes the entry `target` is, with the comments attached to it (v1.15 FR-016, FR-017). */
export declare function planYamlRemove(facts: Facts, target: Found): Plan;
//# sourceMappingURL=insert.d.ts.map