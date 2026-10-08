/**
 * v1.12 FR-003, FR-004 — the pointers of a tree are indexed once, on first use, and every later
 * question is a lookup. Counted, not timed: the wall-clock witness is in
 * `tests/timing/after-the-review.timing.test.ts`.
 *
 * Every pointer and span below is counted by hand from the text beside it.
 */
import { describe, expect, it } from "vitest";
import { editTarget, parse, why } from "../../src/index.js";
import { originsInTree, pointerIndexBuilds, pointerInDocument, pointersInDocument } from "../../src/model/pointer.js";
import { build } from "./edit-target-fixture.js";

const origin = { id: "index", label: "<index>" };

function tree(text: string) {
  const result = parse(new TextEncoder().encode(text), { origin });
  if (!result.ok) throw new Error(result.diagnostics.map((d) => d.code).join(", "));
  return result.tree;
}

// b0 :1 sp2 &3 x4 sp5 1(6) — the anchored `1` is bytes 6-7; `a: *x` and `c: *x` copy it, span and all.
// Document order is b, a, c; the model's keys are canonical (a, b, c), and so is the walk.
const TEXT = "b: &x 1\na: *x\nc: *x\n";
const span = (start: number, end: number) => ({ origin, start, end, line: 1, column: 7, documentLength: TEXT.length });

describe("v1.12 FR-003 — the index answers what the walk answered", () => {
  it("an anchor and two aliases: the three pointers, in walk order (sorted keys)", () => {
    expect(pointersInDocument(tree(TEXT), span(6, 7))).toEqual(["/a", "/b", "/c"]);
  });

  it("limit keeps the first ones in walk order", () => {
    const root = tree(TEXT);
    expect(pointersInDocument(root, span(6, 7), 2)).toEqual(["/a", "/b"]);
    expect(pointersInDocument(root, span(6, 7), 1)).toEqual(["/a"]);
  });

  it("no node at a span: none", () => {
    expect(pointersInDocument(tree(TEXT), span(6, 8))).toEqual([]);
    expect(pointersInDocument(tree(TEXT), { ...span(6, 7), origin: { id: "other", label: "<index>" } })).toEqual([]);
  });

  it("the tie-break is unchanged: the hint, else the hint's last segment, else the first", () => {
    const root = tree(TEXT);
    expect(pointerInDocument(root, span(6, 7), "/c")).toBe("/c");
    expect(pointerInDocument(root, span(6, 7), "/x/b")).toBe("/b");
    expect(pointerInDocument(root, span(6, 7), "/x/y")).toBe("/a");
    expect(pointerInDocument(root, span(6, 7))).toBe("/a");
  });

  it("records each origin's label", () => {
    expect([...originsInTree(tree(TEXT))]).toEqual([["index", "<index>"]]);
  });
});

describe("v1.12 FR-004 — asking twice builds once", () => {
  it("one tree, many questions: one build", () => {
    const root = tree(TEXT);
    const before = pointerIndexBuilds();
    pointersInDocument(root, span(6, 7));
    pointersInDocument(root, span(6, 7), 2);
    pointerInDocument(root, span(6, 7), "/b");
    originsInTree(root);
    expect(pointerIndexBuilds() - before).toBe(1);
  });

  it("another tree: its own build", () => {
    const before = pointerIndexBuilds();
    pointersInDocument(tree(TEXT), span(6, 7));
    pointersInDocument(tree(TEXT), span(6, 7));
    expect(pointerIndexBuilds() - before).toBe(2);
  });

  it("why() and editTarget() on every key of a configuration build one index per layer, however many keys", async () => {
    const keys = 200;
    const text = Array.from({ length: keys }, (_, i) => `k${i}: ${i}`).join("\n") + "\n";
    const configuration = await build("/virtual/many.yaml", { "/virtual/many.yaml": text });
    const before = pointerIndexBuilds();
    for (let i = 0; i < keys; i += 1) {
      expect(why(configuration, `/k${i}`).kind).toBe("chain");
      expect(editTarget(configuration, `/k${i}`).ok).toBe(true);
    }
    expect(pointerIndexBuilds() - before).toBe(configuration.layers.length);
  });
});
