/**
 * What a caller may write -- SPEC.md Article IX (v1.15), specs/025-open-insert-delete FR-007.
 *
 * `EditData` is a scalar, a sequence of `EditData`, or an ordered `Map` of string keys to `EditData`.
 * A mapping is a `Map` and never a plain object, because a plain object reorders array-index keys
 * (`{ b: 1, 2: 1 }` lists `2` first) and swallows `__proto__` (CLAUDE.md, Known traps). Anything else
 * is programmer error and throws, naming what it found and where.
 *
 * Everything here is format-blind: validation, the node count and depth that bound the work a render
 * may do, and the one definition of "this data is that node" the read-back and the nothing-changed
 * law share. Scalar kinds follow Article IX: a number inside a container has no scalar to inherit a
 * kind from, so a whole number is an integer and any other number a float.
 */
import type { Node, ScalarKind } from "../model/node.js";
/** A scalar the caller can set: `string`, `number`, `bigint`, `boolean` or `null`. */
export type EditValue = string | number | bigint | boolean | null;
/** A value a caller can set or add (v1.15): a scalar, or a mapping or sequence, nested, of them. */
export type EditData = EditValue | readonly EditData[] | ReadonlyMap<string, EditData>;
export declare function isContainerData(value: EditData): value is readonly EditData[] | ReadonlyMap<string, EditData>;
/** Whether a container holds nothing. */
export declare function isEmptyData(value: readonly EditData[] | ReadonlyMap<string, EditData>): boolean;
/** What a walk of the data found. `depth` is the nesting of the deepest node below the root: a scalar is 0, `[1]` is 1, `[[1]]` is 2. */
export interface DataFacts {
    readonly depth: number;
    readonly nodes: number;
    /** The walk stopped: deeper than `maxDepth` allows. The document would be refused for the same reason. */
    readonly tooDeep: boolean;
    /** The walk stopped: more nodes than the byte cap lets a document hold at one byte each. */
    readonly tooBig: boolean;
}
/**
 * Check `value` is `EditData` and measure it, iteratively (a hostile depth must not overflow the stack) and with
 * a budget (a shared sub-structure written twice at every level is a cheap way to ask for a billion nodes). Throws
 * a `TypeError` for anything that is not in the type: a plain object, a `Map` with a key that is not a string, a
 * cycle, a sparse array, `undefined`, a `Set`, a function. It does not throw for a value past the document's limits:
 * that is the document's refusal to give, not a mistake of the caller's.
 */
export declare function inspectData(value: unknown, fnName: string, maxDepth: number, maxNodes: number): DataFacts;
/** Whether `text` has a UTF-16 surrogate with no partner, which no UTF-8 document can hold (v1.12 `edit-unrepresentable`). */
export declare function hasLoneSurrogate(text: string): boolean;
/** The shortest round-trip spelling with a decimal point or an exponent guaranteed (FR-006): `3` is `3.0`, `-0` is `-0.0`, `1e21` is `1e+21`. */
export declare function floatText(value: number): string;
/**
 * The spelling of a scalar that is not a string, the same in both formats but for a float that is not finite, which
 * `nonFinite` spells (YAML) or is `undefined` for (JSON has none): `undefined` back means the format cannot say it.
 */
export declare function plainScalarText(value: EditValue, kind: ScalarKind, nonFinite: ((value: number) => string) | undefined): string | undefined;
/** The kind a scalar written where no scalar was (inside a container, or over a container) reads back as. */
export declare function kindOfNew(value: EditValue): ScalarKind;
/** §4.2's equality of a model scalar and a value of the given kind; `NaN` equals `NaN` here, because setting it again must write nothing new. */
export declare function equalsValue(node: Node, kind: ScalarKind, value: EditValue): boolean;
/**
 * Whether `data` is `node` under §4.2's equality: the same kinds, the same values, a mapping's key order no part of it.
 * Spans take no part. Recursion is bounded by the nesting `inspectData` has already measured.
 */
export declare function dataEqualsNode(data: EditData, node: Node): boolean;
//# sourceMappingURL=edit-data.d.ts.map