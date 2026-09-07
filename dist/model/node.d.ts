/**
 * The information model — SPEC.md §4.1, data-model.md "Node".
 *
 * Three node shapes, every one of them carrying a `span`. The construction
 * invariant (Principle III, data-model.md "Construction invariant"):
 *
 *   Nodes are constructible only through the factories below, and every
 *   factory requires a `SourceSpan`. There is no optional span field, no
 *   setter, and no path by which an unpositioned node can exist — the type
 *   itself makes the alternative unrepresentable, together with the
 *   constitution's ban on assertion casts against this module (no `as`
 *   may be used to fabricate a Node that skips a factory).
 *
 * This module is format-blind (Principle IV): it knows nothing about YAML,
 * JSON, or TOML, and it must never import from `src/adapters/`.
 */
import type { SourceSpan } from "./span.js";
/** The five scalar kinds, decided lexically by the adapter (SPEC.md §4.2). */
export type ScalarKind = "string" | "int" | "float" | "bool" | "null";
/** The JS value type that goes with each scalar kind. Integers are exact `bigint` at any magnitude. */
export type ScalarValueOf<K extends ScalarKind> = K extends "string" ? string : K extends "int" ? bigint : K extends "float" ? number : K extends "bool" ? boolean : K extends "null" ? null : never;
interface ScalarOf<K extends ScalarKind> {
    readonly type: "scalar";
    readonly kind: K;
    readonly value: ScalarValueOf<K>;
    readonly span: SourceSpan;
}
/** A leaf node. `kind` is decided lexically by the adapter, never by JS `typeof`. */
export type Scalar = ScalarOf<"string"> | ScalarOf<"int"> | ScalarOf<"float"> | ScalarOf<"bool"> | ScalarOf<"null">;
/**
 * Entries keyed by string, canonicalized by sorting on key at
 * construction (SPEC.md §4.2, amended after v0.1: mappings are
 * canonicalized rather than order-preserving). Iteration order is
 * therefore sorted-by-key, by Unicode code point, not insertion order —
 * there is no path by which a `Mapping` iterates in any other order, the
 * same way there is no path by which a node lacks a span.
 */
export interface Mapping {
    readonly type: "mapping";
    readonly entries: ReadonlyMap<string, Node>;
    readonly span: SourceSpan;
}
/** Ordered items. Order is significant for equality. */
export interface Sequence {
    readonly type: "sequence";
    readonly items: readonly Node[];
    readonly span: SourceSpan;
}
/** `Node = Scalar | Mapping | Sequence` (SPEC.md §4.1). */
export type Node = Scalar | Mapping | Sequence;
export declare function createStringScalar(value: string, span: SourceSpan): Scalar;
export declare function createIntScalar(value: bigint, span: SourceSpan): Scalar;
export declare function createFloatScalar(value: number, span: SourceSpan): Scalar;
export declare function createBoolScalar(value: boolean, span: SourceSpan): Scalar;
export declare function createNullScalar(span: SourceSpan): Scalar;
/**
 * Compare two strings by Unicode code point — the one ordering rule used
 * everywhere the model needs to order strings (currently: canonical
 * mapping key order).
 *
 * This is deliberately not `a < b`, `Array.prototype.sort()` with no
 * comparator, or `String#localeCompare` — all three compare UTF-16 *code
 * units*, which disagrees with code-point order above the BMP. Concrete
 * case: `"\u{1F600}"` (😀, U+1F600) vs `"�"` (�, U+FFFD). By code
 * point, U+FFFD (65533) sorts before U+1F600 (128512). But 😀's first
 * UTF-16 code unit is the surrogate 0xD83D (55357), which is less than
 * 0xFFFD (65533) — so a UTF-16-code-unit comparison puts 😀 first,
 * backwards from the code-point order §4.2 mandates. Iterating each
 * string with its default (code-point-aware) iterator, rather than
 * indexing into it, is what avoids this.
 */
export declare function compareByCodePoint(a: string, b: string): number;
/**
 * Construct a Mapping. `entries` is copied and sorted by key (canonical
 * order, by code point) into a fresh `Map`, so the factory owns the
 * storage — a caller mutating the array or Map it passed in cannot reach
 * back into the tree afterward — and so the returned Mapping's iteration
 * order is canonical regardless of what order the caller supplied.
 */
export declare function createMapping(entries: Iterable<readonly [string, Node]>, span: SourceSpan): Mapping;
/**
 * Construct a Sequence. `items` is copied into a fresh array for the same
 * reason `createMapping` copies its entries.
 */
export declare function createSequence(items: readonly Node[], span: SourceSpan): Sequence;
export {};
//# sourceMappingURL=node.d.ts.map