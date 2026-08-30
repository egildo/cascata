/**
 * Confirms determinism (SC-008, contracts/parse-api.md point 3): identical
 * input yields identical trees and identical, identically-ordered
 * diagnostic lists on every run.
 *
 * `parse()` is a pure function of (text, origin, limits) — no clock, no
 * randomness, no environment-dependent branching anywhere in the walk —
 * so determinism should hold by construction. This test is the backstop
 * confirming that empirically, over both an accepting document (tree
 * determinism, including span/position, not just value — `nodesEqual`
 * alone would not catch a position regression, since it deliberately
 * ignores spans) and a multi-violation document (diagnostic-order
 * determinism).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseText } from "../../src/index.js";
import { identicalTrees } from "./tree-equality.js";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases");

function loadInput(relativePath: string): string {
  return JSON.parse(readFileSync(join(CORPUS_ROOT, relativePath), "utf-8")).input;
}

describe("determinism (SC-008)", () => {
  it("produces an identical (value- and position-wise) tree across repeated parses of an accepting document", () => {
    const input = loadInput("expansion/merge-key-multiple-sources-precedence.json");
    const origin = { id: "determinism-tree", label: "<determinism-tree>" };
    const first = parseText(input, { origin });
    const second = parseText(input, { origin });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error("unreachable — checked above");
    }
    expect(identicalTrees(first.tree, second.tree)).toBe(true);
  });

  it("produces an identical, identically-ordered diagnostic list across repeated parses of a refusing document", () => {
    const input = loadInput("multi-violation/three-violations-far-apart-all-reported.json");
    const origin = { id: "determinism-diagnostics", label: "<determinism-diagnostics>" };
    const first = parseText(input, { origin });
    const second = parseText(input, { origin });
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (first.ok || second.ok) {
      throw new Error("unreachable — checked above");
    }
    expect(first.diagnostics.map((d) => [d.code, d.primary.line, d.primary.column])).toEqual(
      second.diagnostics.map((d) => [d.code, d.primary.line, d.primary.column]),
    );
    expect(first.diagnostics.length).toBeGreaterThan(1); // guards against this test vacuously holding for zero or one diagnostic
  });

  it("running the same accepting document ten times in a row never diverges", () => {
    const input = loadInput("numbers/lexical-kind-and-big-integers.json");
    const origin = { id: "determinism-repeat", label: "<determinism-repeat>" };
    const results = Array.from({ length: 10 }, () => parseText(input, { origin }));
    for (const result of results) {
      expect(result.ok).toBe(true);
    }
    const [first, ...rest] = results;
    if (first === undefined || !first.ok) {
      throw new Error("unreachable — checked above");
    }
    for (const result of rest) {
      if (!result.ok) {
        throw new Error("unreachable — checked above");
      }
      expect(identicalTrees(first.tree, result.tree)).toBe(true);
    }
  });
});
