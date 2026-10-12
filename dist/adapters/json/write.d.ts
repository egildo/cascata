/**
 * The JSON half of writing a value back — SPEC.md Article IX (§19, v1.10);
 * specs/018-write-value.
 *
 * JSON has no aliases, no styles and no flow/block split, so a located value
 * is just the node the scanner built at the pointer, with the span it
 * measured. A string is a JSON string (RFC 8259 §7) — escapes where it
 * demands them, every other character, non-ASCII included, as itself.
 */
import type { Diagnostic } from "../../diagnostics/diagnostic.js";
import { type FormatOpened } from "../edit.js";
import type { ParseLimits } from "../limits.js";
import type { Node } from "../../model/node.js";
import { type Origin } from "../../model/span.js";
/** A JSON document parsed once (v1.15 FR-004): its tree, which `find` answers any number of pointers from. */
export declare function openJson(bytes: Uint8Array, origin: Origin, limits: Partial<ParseLimits> | undefined): {
    readonly ok: true;
    readonly opened: FormatOpened;
} | {
    readonly ok: false;
    readonly diagnostics: Diagnostic[];
};
export declare function parseBack(bytes: Uint8Array, origin: Origin, limits: Partial<ParseLimits> | undefined): Node | undefined;
export { renderJsonString } from "./spell.js";
//# sourceMappingURL=write.d.ts.map