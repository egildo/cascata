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
import { parse } from "../../src/index.js";
import type { Node } from "../../src/model/node.js";

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases");

function loadInput(relativePath: string): string {
  return JSON.parse(readFileSync(join(CORPUS_ROOT, relativePath), "utf-8")).input;
}

/** Structural equality including span and canonical order — stricter than model equality (nodesEqual), which deliberately ignores both. */
function identicalTrees(a: Node, b: Node): boolean {
  if (a.type !== b.type) return false;
  const spanEqual =
    a.span.origin.id === b.span.origin.id &&
    a.span.start === b.span.start &&
    a.span.end === b.span.end &&
    a.span.line === b.span.line &&
    a.span.column === b.span.column;
  if (!spanEqual) return false;

  if (a.type === "scalar" && b.type === "scalar") {
    return a.kind === b.kind && a.value === b.value;
  }
  if (a.type === "mapping" && b.type === "mapping") {
    const keysA = [...a.entries.keys()];
    const keysB = [...b.entries.keys()];
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i += 1) {
      if (keysA[i] !== keysB[i]) return false; // order must match too — canonical order is deterministic
    }
    for (const key of keysA) {
      const valueA = a.entries.get(key);
      const valueB = b.entries.get(key);
      if (valueA === undefined || valueB === undefined || !identicalTrees(valueA, valueB)) return false;
    }
    return true;
  }
  if (a.type === "sequence" && b.type === "sequence") {
    if (a.items.length !== b.items.length) return false;
    for (let i = 0; i < a.items.length; i += 1) {
      const itemA = a.items[i];
      const itemB = b.items[i];
      if (itemA === undefined || itemB === undefined || !identicalTrees(itemA, itemB)) return false;
    }
    return true;
  }
  return false;
}

describe("determinism (SC-008)", () => {
  it("produces an identical (value- and position-wise) tree across repeated parses of an accepting document", () => {
    const input = loadInput("expansion/merge-key-multiple-sources-precedence.json");
    const origin = { id: "determinism-tree", label: "<determinism-tree>" };
    const first = parse(input, { origin });
    const second = parse(input, { origin });
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
    const first = parse(input, { origin });
    const second = parse(input, { origin });
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
    const results = Array.from({ length: 10 }, () => parse(input, { origin }));
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
