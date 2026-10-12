/**
 * Spelling a whole value in YAML -- SPEC.md Article IX (v1.15); specs/025-open-insert-delete FR-009.
 *
 * A mapping or sequence of scalars, nested, written as the lines a document would hold: block by default,
 * flow where the style says so or where the place is already flow. Scalars and keys follow Article IX's one
 * spelling rule (`spell.ts`): plain only where Cascata *and* YAML 1.1 read it back as that string, so a key
 * `"1"` or `"yes"` is quoted and a multi-line string is double-quoted, never a block scalar. Nothing here
 * writes an anchor, a tag or an alias, and nothing here reads a document: the style it is given is the
 * whole of what it knows (`insert.ts` copies it from the neighbours).
 */
import { type EditData, type EditValue } from "../edit-data.js";
/** What a new value is written in. */
export interface YamlStyle {
    /** The document's line ending. */
    readonly eol: string;
    /** Spaces per level inside the new value. */
    readonly step: number;
    /** The blanks after `:` in a block `key: value`. */
    readonly colon: string;
    /** Whether a block sequence's dash is indented under its key (`key:\n  - a`) or flush with it (`key:\n- a`). */
    readonly dashIndented: boolean;
    /** Whether the new container is written as a flow collection (`[a, b]`, `{k: v}`) rather than as lines. */
    readonly flow: boolean;
}
/** The format cannot spell this value: a string with an unpaired surrogate. */
export declare class Unrepresentable extends Error {
}
export declare function scalarSpelling(value: EditValue, inFlow: boolean): string;
export declare function keySpelling(key: string, inFlow: boolean): string;
/** `[a, b]` and `{k: v}`, the whole value on one line. */
export declare function flowText(data: EditData): string;
export declare function mappingLines(map: ReadonlyMap<string, EditData>, indent: string, style: YamlStyle): string[];
export declare function sequenceLines(items: readonly EditData[], indent: string, style: YamlStyle): string[];
/** One mapping entry as lines at `indent`. */
export declare function entryAt(key: string, value: EditData, indent: string, style: YamlStyle): string[];
/** One sequence item as lines at `indent`. */
export declare function itemAt(value: EditData, indent: string, style: YamlStyle): string[];
/** A whole block container (nonempty) as lines at `indent`; a scalar or an empty container is not block-shaped. */
export declare function blockLines(data: EditData, indent: string, style: YamlStyle): string[];
/** Whether `data` is written inline after `key:` or `- ` (a scalar, an empty container, or any container in a flow style), rather than as lines below. */
export declare function isInline(data: EditData, style: YamlStyle): boolean;
/** The inline spelling of a value for which `isInline` holds. */
export declare function inlineText(data: EditData): string;
//# sourceMappingURL=render.d.ts.map