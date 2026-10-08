/**
 * The JSON half of writing a value back — SPEC.md Article IX (§19, v1.10);
 * specs/018-write-value.
 *
 * JSON has no aliases, no styles and no flow/block split, so a located value
 * is just the node the scanner built at the pointer, with the span it
 * measured. A string is a JSON string (RFC 8259 §7) — escapes where it
 * demands them, every other character, non-ASCII included, as itself.
 */
import { type FindResult } from "../edit.js";
import type { ParseLimits } from "../limits.js";
import type { Node } from "../../model/node.js";
import { unescapePointerSegment } from "../../model/pointer.js";
import type { Origin } from "../../model/span.js";
export declare function findJson(bytes: Uint8Array, origin: Origin, limits: Partial<ParseLimits> | undefined, pointer: string): FindResult;
export declare function parseBack(bytes: Uint8Array, origin: Origin, limits: Partial<ParseLimits> | undefined): Node | undefined;
export declare function renderJsonString(text: string): string;
export { unescapePointerSegment };
//# sourceMappingURL=write.d.ts.map