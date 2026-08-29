/**
 * Unit tests for the single definition of model equality — SPEC.md §4.2,
 * data-model.md "Equality", FR-007. Covers order-insensitive mappings,
 * ordered sequences, and the `int 2` vs `float 2.0` distinction that
 * lexical-kind preservation exists to protect.
 */

import { describe, expect, it } from "vitest";
import { nodesEqual } from "../../src/model/equality.js";
import {
  createBoolScalar,
  createFloatScalar,
  createIntScalar,
  createMapping,
  createNullScalar,
  createSequence,
  createStringScalar,
  type Node,
} from "../../src/model/node.js";
import { createOrigin, createSourceSpan, type SourceSpan } from "../../src/model/span.js";

const origin = createOrigin("test", "<test>");

/** A span at a distinct, arbitrary position. Spans never affect equality. */
function spanAt(start: number): SourceSpan {
  return createSourceSpan({ origin, start, end: start + 1, line: 1, column: start + 1, documentLength: 1000 });
}

describe("nodesEqual", () => {
  it("compares scalars by kind and value", () => {
    expect(nodesEqual(createStringScalar("a", spanAt(0)), createStringScalar("a", spanAt(50)))).toBe(true);
    expect(nodesEqual(createStringScalar("a", spanAt(0)), createStringScalar("b", spanAt(0)))).toBe(false);
  });

  it("treats int 2 and float 2.0 as unequal — different kinds, never coerced", () => {
    const intTwo = createIntScalar(2n, spanAt(0));
    const floatTwo = createFloatScalar(2.0, spanAt(0));
    expect(nodesEqual(intTwo, floatTwo)).toBe(false);
    expect(nodesEqual(intTwo, createIntScalar(2n, spanAt(10)))).toBe(true);
    expect(nodesEqual(floatTwo, createFloatScalar(2.0, spanAt(10)))).toBe(true);
  });

  it("compares bool and null scalars", () => {
    expect(nodesEqual(createBoolScalar(true, spanAt(0)), createBoolScalar(true, spanAt(1)))).toBe(true);
    expect(nodesEqual(createBoolScalar(true, spanAt(0)), createBoolScalar(false, spanAt(0)))).toBe(false);
    expect(nodesEqual(createNullScalar(spanAt(0)), createNullScalar(spanAt(1)))).toBe(true);
  });

  it("compares mappings by key set and value, ignoring entry order", () => {
    const a: Node = createMapping(
      [
        ["host", createStringScalar("localhost", spanAt(0))],
        ["port", createIntScalar(80n, spanAt(10))],
      ],
      spanAt(0),
    );
    const b: Node = createMapping(
      [
        ["port", createIntScalar(80n, spanAt(99))],
        ["host", createStringScalar("localhost", spanAt(199))],
      ],
      spanAt(50),
    );
    expect(nodesEqual(a, b)).toBe(true);
  });

  it("rejects mappings with a different key set or a differing value", () => {
    const base: Node = createMapping([["a", createIntScalar(1n, spanAt(0))]], spanAt(0));
    const extraKey: Node = createMapping(
      [
        ["a", createIntScalar(1n, spanAt(0))],
        ["b", createIntScalar(2n, spanAt(0))],
      ],
      spanAt(0),
    );
    const differingValue: Node = createMapping([["a", createIntScalar(2n, spanAt(0))]], spanAt(0));
    expect(nodesEqual(base, extraKey)).toBe(false);
    expect(nodesEqual(base, differingValue)).toBe(false);
  });

  it("compares sequences by length, item equality, and order", () => {
    const a: Node = createSequence([createIntScalar(1n, spanAt(0)), createIntScalar(2n, spanAt(1))], spanAt(0));
    const sameOrder: Node = createSequence([createIntScalar(1n, spanAt(5)), createIntScalar(2n, spanAt(6))], spanAt(5));
    const reversed: Node = createSequence([createIntScalar(2n, spanAt(5)), createIntScalar(1n, spanAt(6))], spanAt(5));
    expect(nodesEqual(a, sameOrder)).toBe(true);
    expect(nodesEqual(a, reversed)).toBe(false);
  });

  it("treats nodes of different shapes as unequal", () => {
    const scalar: Node = createIntScalar(1n, spanAt(0));
    const sequence: Node = createSequence([createIntScalar(1n, spanAt(0))], spanAt(0));
    const mapping: Node = createMapping([["a", createIntScalar(1n, spanAt(0))]], spanAt(0));
    expect(nodesEqual(scalar, sequence)).toBe(false);
    expect(nodesEqual(scalar, mapping)).toBe(false);
    expect(nodesEqual(sequence, mapping)).toBe(false);
  });

  it("compares strings by code point sequence with no Unicode normalization", () => {
    const precomposed = createStringScalar("é", spanAt(0)); // é, NFC
    const decomposed = createStringScalar("é", spanAt(0)); // e + combining acute, NFD
    expect(nodesEqual(precomposed, decomposed)).toBe(false);
  });
});
