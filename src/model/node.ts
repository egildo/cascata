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
export type ScalarValueOf<K extends ScalarKind> = K extends "string"
  ? string
  : K extends "int"
    ? bigint
    : K extends "float"
      ? number
      : K extends "bool"
        ? boolean
        : K extends "null"
          ? null
          : never;

interface ScalarOf<K extends ScalarKind> {
  readonly type: "scalar";
  readonly kind: K;
  readonly value: ScalarValueOf<K>;
  readonly span: SourceSpan;
}

/** A leaf node. `kind` is decided lexically by the adapter, never by JS `typeof`. */
export type Scalar =
  | ScalarOf<"string">
  | ScalarOf<"int">
  | ScalarOf<"float">
  | ScalarOf<"bool">
  | ScalarOf<"null">;

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

// --- Span-requiring factories -----------------------------------------
//
// These are the *only* way to produce a Node. Each one takes a span as a
// required parameter; none has a default, an overload without one, or a
// mutator that could attach one after the fact.

export function createStringScalar(value: string, span: SourceSpan): Scalar {
  return { type: "scalar", kind: "string", value, span };
}

export function createIntScalar(value: bigint, span: SourceSpan): Scalar {
  return { type: "scalar", kind: "int", value, span };
}

export function createFloatScalar(value: number, span: SourceSpan): Scalar {
  return { type: "scalar", kind: "float", value, span };
}

export function createBoolScalar(value: boolean, span: SourceSpan): Scalar {
  return { type: "scalar", kind: "bool", value, span };
}

export function createNullScalar(span: SourceSpan): Scalar {
  return { type: "scalar", kind: "null", value: null, span };
}

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
export function compareByCodePoint(a: string, b: string): number {
  const codePointsA = Array.from(a, (char) => char.codePointAt(0) ?? 0);
  const codePointsB = Array.from(b, (char) => char.codePointAt(0) ?? 0);
  const sharedLength = Math.min(codePointsA.length, codePointsB.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const codeA = codePointsA[index] ?? 0;
    const codeB = codePointsB[index] ?? 0;
    if (codeA !== codeB) {
      return codeA - codeB;
    }
  }
  return codePointsA.length - codePointsB.length;
}

/**
 * Construct a Mapping. `entries` is copied and sorted by key (canonical
 * order, by code point) into a fresh `Map`, so the factory owns the
 * storage — a caller mutating the array or Map it passed in cannot reach
 * back into the tree afterward — and so the returned Mapping's iteration
 * order is canonical regardless of what order the caller supplied.
 */
export function createMapping(entries: Iterable<readonly [string, Node]>, span: SourceSpan): Mapping {
  const sorted = [...entries].sort((a, b) => compareByCodePoint(a[0], b[0]));
  return { type: "mapping", entries: new Map(sorted), span };
}

/**
 * Construct a Sequence. `items` is copied into a fresh array for the same
 * reason `createMapping` copies its entries.
 */
export function createSequence(items: readonly Node[], span: SourceSpan): Sequence {
  return { type: "sequence", items: [...items], span };
}
