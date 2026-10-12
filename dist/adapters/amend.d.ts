/**
 * An operation inside a staged value (v1.16, specs/026-shift-and-amend FR-002; SPEC.md Article IX).
 *
 * A caller that stages edits against a base cannot say "change the height of the wall I am inserting":
 * the wall is not in the base. It amends the staged value instead, and the path language that says
 * where is the format's, so the format answers it. For Cascata's formats that language is RFC 6901,
 * and the operation is RFC 6902's on the staged `EditData`, with Cascata's meanings: `add` only
 * creates, `set` only changes. Pure: no bytes, no parse; the staged value is never changed.
 */
import type { EditData } from "./edit-data.js";
/** An operation at `path`: `value` for `set` and `add`, none for `remove`. */
export type AmendOperation = {
    readonly op: "set" | "add";
    readonly path: string;
    readonly value: EditData;
} | {
    readonly op: "remove";
    readonly path: string;
};
/** Not inside the staged path (at it, beside it, or above it); or inside, and the amended value or why not. */
export type AmendResult = {
    readonly inside: false;
} | {
    readonly inside: true;
    readonly ok: true;
    readonly value: EditData;
} | {
    readonly inside: true;
    readonly ok: false;
    readonly reason: string;
};
/** Whether `path` is strictly below `within`: an RFC 6901 prefix followed by `/` (`/walls/W30` is not inside `/walls/W3`). */
export declare function isInside(path: string, within: string): boolean;
export declare function amendValue(staged: {
    readonly path: string;
    readonly value: EditData;
}, operation: AmendOperation): AmendResult;
//# sourceMappingURL=amend.d.ts.map