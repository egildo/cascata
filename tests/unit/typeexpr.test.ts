/**
 * §9.1's leaf DSL grammar — src/validate/typeexpr.ts. v0.4 FR-008 through
 * FR-012. A dedicated unit test for the parser itself, the same role
 * tests/unit/pointer.test.ts plays for src/model/pointer.ts — the
 * end-to-end conformance corpus (tests/corpus/cases/validate-vocabulary/)
 * exercises this through validate(), this file exercises the grammar
 * directly, including cases too fiddly to justify their own fixture pair.
 *
 * Every expected value below is derived by hand against §9.1's own EBNF,
 * not by running the parser and copying its output (constitution
 * Principle V).
 */

import { describe, expect, it } from "vitest";
import { parseTypeExpression, resolvesToBuiltin, unresolvedAlternatives } from "../../src/validate/typeexpr.js";

describe("parseTypeExpression — well-formed expressions", () => {
  it("a bare name is one alternative at depth 0", () => {
    const result = parseTypeExpression("string");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alternatives).toEqual([{ name: "string", depth: 0 }]);
    }
  });

  it("[] binds tighter than | — 'string | string[]' is string-or-array-of-string, not array-of-(string-or-string)", () => {
    const result = parseTypeExpression("string | string[]");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Sorted by (depth, name): depth 0 'string' before depth 1 'string'.
      expect(result.value.alternatives).toEqual([
        { name: "string", depth: 0 },
        { name: "string", depth: 1 },
      ]);
    }
  });

  it("parens are required to apply [] to a union — '(string | int)[]' is an array of (string or int)", () => {
    const result = parseTypeExpression("(string | int)[]");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alternatives).toEqual([
        { name: "int", depth: 1 },
        { name: "string", depth: 1 },
      ]);
    }
  });

  it("multiple [] stack depth", () => {
    const result = parseTypeExpression("string[][]");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alternatives).toEqual([{ name: "string", depth: 2 }]);
    }
  });

  it("whitespace is insignificant between tokens", () => {
    const spaced = parseTypeExpression(" string  |  int ");
    const tight = parseTypeExpression("string|int");
    expect(spaced).toEqual(tight);
  });

  it("canonical form dedupes a repeated alternative", () => {
    const result = parseTypeExpression("string|string");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alternatives).toEqual([{ name: "string", depth: 0 }]);
    }
  });

  it("a qualified name parses under the grammar (Name := Ident ('/' Ident)?)", () => {
    const result = parseTypeExpression("core/resource");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alternatives).toEqual([{ name: "core/resource", depth: 0 }]);
    }
  });

  it("union order is insignificant for the canonical result — 'a|b' and 'b|a' produce the same sorted array", () => {
    const first = parseTypeExpression("mapping | sequence");
    const second = parseTypeExpression("sequence | mapping");
    expect(first).toEqual(second);
  });
});

describe("parseTypeExpression — malformed expressions", () => {
  it.each([
    ["empty string — Primary requires a name or '('", ""],
    ["a trailing '|' with nothing after it", "string |"],
    ["empty parens — Union requires at least one Array", "()"],
    ["an unmatched ']'", "string]"],
    ["an unmatched '['", "string["],
    ["'[]' with nothing preceding it", "[]"],
    ["a trailing '|' after a valid array suffix", "string[]|"],
  ])("rejects: %s (%s)", (_label, source) => {
    const result = parseTypeExpression(source);
    expect(result.ok).toBe(false);
  });
});

describe("resolvesToBuiltin / unresolvedAlternatives — FR-011's closed set, FR-012", () => {
  it("every FR-011 name resolves", () => {
    for (const name of ["string", "int", "float", "bool", "null", "mapping", "sequence", "url", "path", "glob"]) {
      expect(resolvesToBuiltin({ name, depth: 0 })).toBe(true);
    }
  });

  it("a qualified name does not resolve this milestone (no named types until v0.5)", () => {
    expect(resolvesToBuiltin({ name: "core/resource", depth: 0 })).toBe(false);
  });

  it("a typo does not resolve", () => {
    expect(resolvesToBuiltin({ name: "strnig", depth: 0 })).toBe(false);
  });

  it("unresolvedAlternatives finds exactly the unresolvable ones in a mixed expression", () => {
    const result = parseTypeExpression("string | strnig | int");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(unresolvedAlternatives(result.value)).toEqual([{ name: "strnig", depth: 0 }]);
    }
  });
});
