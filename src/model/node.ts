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

/** Ordered entries keyed by string. Order is preserved but insignificant for equality (FR-003, FR-007). */
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
 * Construct a Mapping. `entries` is copied into a fresh `Map` so the
 * factory owns the storage — a caller mutating the array or Map it passed
 * in cannot reach back into the tree afterward.
 */
export function createMapping(entries: Iterable<readonly [string, Node]>, span: SourceSpan): Mapping {
  return { type: "mapping", entries: new Map(entries), span };
}

/**
 * Construct a Sequence. `items` is copied into a fresh array for the same
 * reason `createMapping` copies its entries.
 */
export function createSequence(items: readonly Node[], span: SourceSpan): Sequence {
  return { type: "sequence", items: [...items], span };
}
