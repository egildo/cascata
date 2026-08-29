/**
 * Unit tests that returned trees resist mutation — FR-026,
 * contracts/parse-api.md ("The tree is deeply frozen before being
 * returned. Mutation attempts do not succeed.").
 *
 * `Object.freeze` alone does not stop `Map#set`/`Map#delete` on a frozen
 * `Map` instance (verified empirically against the Node runtime this
 * project targets — freezing a Map's own properties does not touch its
 * internal slot), so these tests specifically exercise the Mapping.entries
 * case that a naive `Object.freeze(tree)` would silently fail to protect.
 *
 * No `as` assertion casts are used against the node model here (the
 * constitution bans them): narrowing a `Node` to `Mapping` or `Sequence`
 * goes through an explicit runtime check on `.type` instead, the same
 * discriminant the model itself uses.
 */

import { describe, expect, it } from "vitest";
import { freeze } from "../../src/model/freeze.js";
import {
  createIntScalar,
  createMapping,
  createSequence,
  createStringScalar,
  type Mapping,
  type Node,
  type Sequence,
} from "../../src/model/node.js";
import { createOrigin, createSourceSpan, type SourceSpan } from "../../src/model/span.js";

const origin = createOrigin("test", "<test>");

function spanAt(start: number): SourceSpan {
  return createSourceSpan({ origin, start, end: start + 1, line: 1, column: start + 1, documentLength: 1000 });
}

function expectMapping(node: Node): Mapping {
  if (node.type !== "mapping") {
    throw new Error(`expected a mapping, got ${node.type}`);
  }
  return node;
}

function expectSequence(node: Node): Sequence {
  if (node.type !== "sequence") {
    throw new Error(`expected a sequence, got ${node.type}`);
  }
  return node;
}

describe("freeze", () => {
  it("prevents reassigning a scalar's own properties", () => {
    const scalar = freeze(createIntScalar(1n, spanAt(0)));
    expect(() => {
      // @ts-expect-error — `value` is readonly; this is exactly the mutation this test guards against.
      scalar.value = 2n;
    }).toThrow(TypeError);
  });

  it("freezes a sequence's items array against push and index assignment", () => {
    const sequence = expectSequence(freeze(createSequence([createIntScalar(1n, spanAt(0))], spanAt(0))));
    expect(() => {
      // @ts-expect-error — items is a readonly array; push must not be reachable at the type level either.
      sequence.items.push(createIntScalar(2n, spanAt(1)));
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error — same, for direct index assignment.
      sequence.items[0] = createIntScalar(99n, spanAt(1));
    }).toThrow(TypeError);
    expect(sequence.items.length).toBe(1);
  });

  it("freezes nested items inside a sequence, not only the top level", () => {
    const sequence = expectSequence(freeze(createSequence([createIntScalar(1n, spanAt(0))], spanAt(0))));
    const nested = sequence.items[0];
    expect(nested).toBeDefined();
    expect(() => {
      // @ts-expect-error — deliberately mutating a nested (frozen) node.
      nested!.value = 42n;
    }).toThrow(TypeError);
  });

  it("blocks Map#set on a frozen Mapping's entries, which Object.freeze alone cannot", () => {
    const mapping = expectMapping(freeze(createMapping([["a", createStringScalar("x", spanAt(0))]], spanAt(0))));
    expect(() => {
      // @ts-expect-error — entries is a ReadonlyMap at the type level; set() must also be unreachable at runtime.
      mapping.entries.set("b", createStringScalar("y", spanAt(1)));
    }).toThrow(TypeError);
    expect(mapping.entries.has("b")).toBe(false);
  });

  it("blocks Map#delete and Map#clear on a frozen Mapping's entries", () => {
    const mapping = expectMapping(freeze(createMapping([["a", createStringScalar("x", spanAt(0))]], spanAt(0))));
    expect(() => {
      // @ts-expect-error — same rationale as #set above.
      mapping.entries.delete("a");
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error — same rationale as #set above.
      mapping.entries.clear();
    }).toThrow(TypeError);
    expect(mapping.entries.has("a")).toBe(true);
    expect(mapping.entries.size).toBe(1);
  });

  it("still allows reading a frozen Mapping through get/has/keys/forEach", () => {
    const mapping = expectMapping(freeze(createMapping([["a", createStringScalar("x", spanAt(0))]], spanAt(0))));
    expect(mapping.entries.get("a")).toBeDefined();
    expect(mapping.entries.has("a")).toBe(true);
    expect([...mapping.entries.keys()]).toEqual(["a"]);
    const seen: string[] = [];
    mapping.entries.forEach((_value, key) => seen.push(key));
    expect(seen).toEqual(["a"]);
  });

  it("freezes nested mappings inside a mapping's values", () => {
    const inner = createMapping([["b", createIntScalar(1n, spanAt(0))]], spanAt(0));
    const outer = expectMapping(freeze(createMapping([["a", inner]], spanAt(0))));
    const nestedNode = outer.entries.get("a");
    expect(nestedNode).toBeDefined();
    const nested = expectMapping(nestedNode!);
    expect(() => {
      // @ts-expect-error — same rationale as the top-level #set test above.
      nested.entries.set("c", createIntScalar(2n, spanAt(1)));
    }).toThrow(TypeError);
  });
});
