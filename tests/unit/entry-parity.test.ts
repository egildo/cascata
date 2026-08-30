/**
 * Confirms FR-004: given valid UTF-8 bytes, `parse()` produces a tree
 * identical to what `parseText()` produces from the equivalent text —
 * spans included, not just values (`nodesEqual` alone would pass even if
 * every position were wrong, since it deliberately ignores spans).
 *
 * Runs over every accepting, text-sourced case in the whole corpus (so a
 * future case is covered automatically), UTF-8 encoding each one's input
 * before feeding it to `parse`. This is deliberately broader than
 * tests/corpus/cases/bytes-parity/'s two hand-picked cases: T018 asks for
 * a dedicated proof of the *general* property, not just confirmation that
 * the two cases built for it happen to agree.
 */

import { describe, expect, it } from "vitest";
import { parse, parseText } from "../../src/index.js";
import { loadCases } from "../corpus/runner.js";
import { identicalTrees } from "./tree-equality.js";

const CASES_DIR = new URL("../corpus/cases", import.meta.url).pathname;

describe("entry parity (FR-004): parse(bytes) === parseText(text) for valid UTF-8", () => {
  const textAcceptingCases = loadCases(CASES_DIR).filter((testCase) => testCase.input !== undefined && "tree" in testCase.expect);

  it("found at least one text-sourced accepting case to compare (guards against this test vacuously passing)", () => {
    expect(textAcceptingCases.length).toBeGreaterThan(0);
  });

  for (const testCase of textAcceptingCases) {
    it(`produces an identical tree, spans included, for ${testCase.name}`, () => {
      const text = testCase.input;
      if (text === undefined) {
        throw new Error("unreachable — filtered above");
      }
      const origin = { id: testCase.name, label: testCase.name };
      const bytes = new TextEncoder().encode(text);

      const fromText = parseText(text, { origin, limits: testCase.limits });
      const fromBytes = parse(bytes, { origin, limits: testCase.limits });

      expect(fromText.ok).toBe(true);
      expect(fromBytes.ok).toBe(true);
      if (!fromText.ok || !fromBytes.ok) {
        throw new Error("unreachable — checked above");
      }
      expect(identicalTrees(fromText.tree, fromBytes.tree)).toBe(true);
    });
  }

  it("also holds for a document with astral characters, quoting, merges, and canonical reordering all at once", () => {
    const text = 'greeting: "héllo 🎉"\nbase: &b\n  z: 1\n  a: 2\nchild:\n  <<: *b\n  a: 99\n';
    const origin = { id: "entry-parity-combined", label: "<entry-parity-combined>" };
    const bytes = new TextEncoder().encode(text);
    const fromText = parseText(text, { origin });
    const fromBytes = parse(bytes, { origin });
    expect(fromText.ok).toBe(true);
    expect(fromBytes.ok).toBe(true);
    if (!fromText.ok || !fromBytes.ok) {
      throw new Error("unreachable — checked above");
    }
    expect(identicalTrees(fromText.tree, fromBytes.tree)).toBe(true);
  });
});
