/**
 * Round-trip and adversarial coverage for src/model/pointer.ts — tasks.md
 * T005, research D2 and the v0.3 probe ("Does RFC 6901 escaping round-trip
 * correctly?" — yes, including the unescape-ordering subtlety).
 *
 * This is the sabotage-tested guard for the promotion (T003/T004): if the
 * move from tests/corpus/runner.ts introduced any regression, or if a
 * future edit reverses the unescape order, this file is what catches it.
 */

import { describe, expect, it } from "vitest";
import { escapePointerSegment, pointerFromPath, resolvePointer, unescapePointerSegment } from "../../src/model/pointer.js";
import { createMapping, createSequence, createStringScalar } from "../../src/model/node.js";
import { createOrigin, createSourceSpan } from "../../src/model/span.js";

const origin = createOrigin("pointer-test", "pointer-test");

function span(start: number, end: number): ReturnType<typeof createSourceSpan> {
  return createSourceSpan({ origin, start, end, line: 1, column: 1, documentLength: 1000 });
}

describe("pointer segment escape/unescape round-trips (T005)", () => {
  const adversarialKeys = [
    "~0",
    "~1",
    "a~1b",
    "a//b",
    "",
    "café",
    "🎉",
    "~",
    "/",
    "~~",
    "//",
  ];

  for (const key of adversarialKeys) {
    it(`round-trips the key ${JSON.stringify(key)}`, () => {
      const escaped = escapePointerSegment(key);
      const unescaped = unescapePointerSegment(escaped);
      expect(unescaped).toBe(key);
    });
  }

  it("escapes '~' before '/': a literal '/' does not get folded into an escape sequence for '~'", () => {
    // "a/b" -> "a~1b" (only the '/' is escaped; no '~' present to confuse this case)
    expect(escapePointerSegment("a/b")).toBe("a~1b");
    // "a~b" -> "a~0b"
    expect(escapePointerSegment("a~b")).toBe("a~0b");
  });

  it("unescapes '~1' before '~0': '~01' decodes to '~1', never to '/' (the ordering subtlety)", () => {
    // This is the load-bearing case: escaping the key "~1" produces "~01"
    // (escape order: '~' -> '~0' first, so the sole '~' in "~1" becomes
    // "~0", giving "~01"; there was no '/' to escape). Decoding "~01" must
    // therefore recover "~1", not "/" — which is what a naive
    // '~0' -> '~' first, then '~1' -> '/' ordering would (wrongly) produce:
    // "~01" -> (wrong order) "~" + "1" via ~0->~ = "~1" -> then ~1->/ = "/".
    expect(escapePointerSegment("~1")).toBe("~01");
    expect(unescapePointerSegment("~01")).toBe("~1");
    expect(unescapePointerSegment("~01")).not.toBe("/");
  });
});

describe("resolvePointer (T003, promoted from tests/corpus/runner.ts)", () => {
  it("resolves the root with the empty pointer", () => {
    const leaf = createStringScalar("hello", span(0, 5));
    expect(resolvePointer(leaf, "")).toBe(leaf);
  });

  it("resolves through a mapping with an adversarial key", () => {
    const value = createStringScalar("v", span(0, 1));
    const tree = createMapping([["a/b~c", value]], span(0, 10));
    expect(resolvePointer(tree, `/${escapePointerSegment("a/b~c")}`)).toBe(value);
  });

  it("resolves through a sequence by numeric index", () => {
    const item0 = createStringScalar("zero", span(0, 4));
    const item1 = createStringScalar("one", span(5, 8));
    const tree = createSequence([item0, item1], span(0, 8));
    expect(resolvePointer(tree, "/0")).toBe(item0);
    expect(resolvePointer(tree, "/1")).toBe(item1);
  });

  it("returns undefined for a pointer naming nothing (out-of-range index, missing key, indexing into a scalar)", () => {
    const tree = createSequence([createStringScalar("only", span(0, 4))], span(0, 4));
    expect(resolvePointer(tree, "/5")).toBeUndefined();
    expect(resolvePointer(tree, "/not-a-number")).toBeUndefined();

    const mapping = createMapping([["k", createStringScalar("v", span(0, 1))]], span(0, 3));
    expect(resolvePointer(mapping, "/missing")).toBeUndefined();

    const scalar = createStringScalar("leaf", span(0, 4));
    expect(resolvePointer(scalar, "/anything")).toBeUndefined();
  });

  it("resolves an astral (non-BMP) key", () => {
    const value = createStringScalar("emoji-value", span(0, 11));
    const tree = createMapping([["🎉", value]], span(0, 20));
    expect(resolvePointer(tree, "/🎉")).toBe(value);
  });

  it("throws on a malformed pointer (non-empty, not starting with '/')", () => {
    const tree = createStringScalar("x", span(0, 1));
    expect(() => resolvePointer(tree, "no-leading-slash")).toThrow();
  });
});

describe("pointerFromPath (T004 — generation)", () => {
  it("produces the root pointer for an empty path", () => {
    expect(pointerFromPath([])).toBe("");
  });

  it("builds a pointer from mixed string and numeric segments", () => {
    expect(pointerFromPath(["a", "b", 0])).toBe("/a/b/0");
  });

  it("escapes segments needing it", () => {
    expect(pointerFromPath(["a/b", "~c"])).toBe("/a~1b/~0c");
  });

  it("round-trips through resolvePointer for an adversarial key", () => {
    const value = createStringScalar("v", span(0, 1));
    const tree = createMapping([["a~1b", value]], span(0, 10));
    const pointer = pointerFromPath(["a~1b"]);
    expect(resolvePointer(tree, pointer)).toBe(value);
  });
});
