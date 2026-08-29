/**
 * Confirms totality (contracts/parse-api.md point 2, point 1): bad input
 * always yields diagnostics, never an exception. "Total" means every
 * input produces one of the two `ParseResult` outcomes — this test is
 * that property checked directly, over every corpus fixture (so a future
 * case is covered automatically) plus a handful of adversarial inputs no
 * fixture happens to already be.
 */

import { describe, expect, it } from "vitest";
import { parse } from "../../src/index.js";
import type { Expect } from "../corpus/case.js";
import { loadCases } from "../corpus/runner.js";

const CASES_DIR = new URL("../corpus/cases", import.meta.url).pathname;

function equalToOf(expect: Expect): string | undefined {
  return "equalTo" in expect ? expect.equalTo : undefined;
}

describe("totality: parse() never throws for bad input", () => {
  const cases = loadCases(CASES_DIR);

  it("loaded at least one case (guards against this test vacuously passing)", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const testCase of cases) {
    it(`does not throw on ${testCase.name}`, () => {
      const origin = { id: testCase.name, label: testCase.name };
      expect(() => parse(testCase.input, { origin, limits: testCase.limits })).not.toThrow();
      const equalTo = equalToOf(testCase.expect);
      if (equalTo !== undefined) {
        expect(() => parse(equalTo, { origin, limits: testCase.limits })).not.toThrow();
      }
    });
  }

  const adversarialInputs: readonly (readonly [name: string, input: string])[] = [
    ["empty string", ""],
    ["only a BOM", "﻿"],
    ["only whitespace", "   "],
    ["deeply nested flow sequences", "a: " + "[".repeat(2000) + "]".repeat(2000) + "\n"],
    ["a single very long line", "a: " + "x".repeat(200000) + "\n"],
    ["many sibling keys", Array.from({ length: 5000 }, (_, i) => "k" + String(i) + ": " + String(i)).join("\n") + "\n"],
    ["nothing but an alias to itself", "a: &x *x\n"],
    ["unpaired low surrogate", "a: " + "\uDC00" + "\n"],
    ["unpaired high surrogate at end of input", "a: " + "\uD800"],
  ];

  for (const [name, input] of adversarialInputs) {
    it("does not throw on adversarial input: " + name, () => {
      const origin = { id: "totality-adversarial", label: "<totality-adversarial>" };
      expect(() => parse(input, { origin })).not.toThrow();
    });
  }

  it("does not throw on input past the default 8 MiB size cap", () => {
    const oversized = "a: " + "x".repeat(9 * 1024 * 1024) + "\n";
    const origin = { id: "totality-oversized", label: "<totality-oversized>" };
    let result: ReturnType<typeof parse> | undefined;
    expect(() => {
      result = parse(oversized, { origin });
    }).not.toThrow();
    expect(result?.ok).toBe(false);
  });

  it("does not throw on nesting past the default depth cap of 64", () => {
    let input = "leaf: 1\n";
    for (let i = 0; i < 80; i += 1) {
      input =
        "level" +
        String(i) +
        ":\n" +
        input
          .split("\n")
          .map((line) => (line.length > 0 ? "  " + line : line))
          .join("\n");
    }
    const origin = { id: "totality-deep", label: "<totality-deep>" };
    let result: ReturnType<typeof parse> | undefined;
    expect(() => {
      result = parse(input, { origin });
    }).not.toThrow();
    expect(result?.ok).toBe(false);
  });
});
