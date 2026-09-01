/**
 * v1.1 (010) US3 — **leaves emit as the types §17 promised.**
 *
 * Rows 1–5 and 15–21 of `contracts/emitted-type.md` §1, and the `enum`,
 * `final` and numeric rows of its §6. Written by hand from the contract and
 * from `SPEC.md` §17's own table, before the printer that satisfies them.
 *
 * The row that matters most is the numeric one, because it is the row where
 * the design that suggests itself is unsound: emitting each layer's type
 * and joining them with `&` makes a root `int | float` narrowed to `int` by
 * a house into `number & bigint`, which is `never` (research F-2). The
 * emitted type must come from the **accumulated** demand, and it must agree
 * with `project()` — which it does by construction, since both ask
 * `numeric.ts` the same question.
 */

import { describe, expect, it } from "vitest";
import { parse } from "../../src/index.js";
import { createOrigin } from "../../src/model/span.js";
import type { Layer } from "../../src/merge/provenance.js";
import { accumulate } from "../../src/generate/accumulate.js";
import { generate } from "../../src/generate/emit.js";
import { compileInMemory, renderProblems } from "./generate-literal.js";

const ENCODER = new TextEncoder();

function schemaLayer(location: string, rank: number, text: string): Layer {
  const origin = createOrigin(location, location);
  const parsed = parse(ENCODER.encode(text), { origin });
  if (!parsed.ok) {
    throw new Error(`fixture '${location}' does not parse: ${parsed.diagnostics.map((d) => d.message).join("; ")}`);
  }
  return { identity: { location, hash: String(rank).repeat(64).slice(0, 64) }, role: "schema", rank, tree: parsed.tree };
}

function emit(...texts: readonly string[]): string {
  const layers = texts.map((text, index) => schemaLayer(`layer${index}.yaml`, index, text));
  return generate(accumulate(layers).tree).source;
}

/** The emitted type of the single key `a`, with the surrounding module compiled. */
function typeOfA(...texts: readonly string[]): string {
  const source = emit(...texts);
  const problems = compileInMemory(source);
  expect(problems, `the emitted module does not compile:\n${renderProblems(problems)}\n---\n${source}`).toEqual([]);
  const match = /^ {2}readonly a\??: (.*);$/m.exec(source);
  if (match?.[1] === undefined) {
    throw new Error(`no property 'a' in:\n${source}`);
  }
  return match[1];
}

/** A key `a` whose demand is written inline. */
function keyA(demand: string): string {
  return `keys:\n  a:\n    demand: ${demand}\n`;
}

// --- rows 1–4: the built-in leaves -----------------------------------------

describe("contract rows 1, 4 — the non-numeric built-ins", () => {
  it("`string`, `url` and `path` all emit `string`; the selector survives only in JSDoc", () => {
    expect(typeOfA(keyA("{ type: string }"))).toBe("string");
    expect(typeOfA(keyA("{ type: url }"))).toBe("string");
    expect(typeOfA(keyA("{ type: path }"))).toBe("string");
  });

  it("`bool` emits `boolean` and `null` emits `null`", () => {
    expect(typeOfA(keyA("{ type: bool }"))).toBe("boolean");
    expect(typeOfA(keyA("{ type: 'null' }"))).toBe("null");
  });
});

// --- rows 2–3: the numeric rule --------------------------------------------

describe("contract rows 2–3 / SC-001 — the numeric class comes from the ACCUMULATED demand", () => {
  it("SC-001, narrower layer LAST: root `int | float`, house `int` ⇒ `bigint`", () => {
    expect(typeOfA(keyA('{ type: "int | float" }'), keyA("{ type: int }"))).toBe("bigint");
  });

  it("SC-001, narrower layer FIRST: root `int`, house `int | float` ⇒ `bigint` — intersection is commutative", () => {
    expect(typeOfA(keyA("{ type: int }"), keyA('{ type: "int | float" }'))).toBe("bigint");
  });

  it("and neither is `never`, which is what per-layer emission joined by `&` would have produced (research F-2)", () => {
    const joined = compileInMemory(`type R = { n: number }; type H = { n: bigint }; export const v: R & H = { n: 1n };`);
    expect(joined.length, "`number & bigint` is `never` — the rejected design, kept here as the reason").toBeGreaterThan(0);
  });

  it("a demand admitting `float` emits `number`; one admitting `int` alone emits `bigint`", () => {
    expect(typeOfA(keyA('{ type: "int | float" }'))).toBe("number");
    expect(typeOfA(keyA("{ type: float }"))).toBe("number");
    expect(typeOfA(keyA("{ type: int }"))).toBe("bigint");
  });

  it("§17's generalized rule: `int | string` admits no float, so the numeric alternative stays exact", () => {
    expect(typeOfA(keyA('{ type: "int | string" }'))).toBe("bigint | string");
  });

  it("`float | null` admits a float, so its numeric alternative is `number`", () => {
    // Alternatives print in §9.1's own canonical order — depth, then name
    // by code point — so `float` precedes `null` and the emitted union is
    // `number | null`. The contract does not fix a union order; this is the
    // rule the emitter states, and it is the parser's own.
    expect(typeOfA(keyA('{ type: "float | null" }'))).toBe("number | null");
  });

  it("an array of ints is `readonly bigint[]`; of floats, `readonly number[]`", () => {
    expect(typeOfA(keyA('{ type: "int[]" }'))).toBe("readonly bigint[]");
    expect(typeOfA(keyA('{ type: "float[]" }'))).toBe("readonly number[]");
  });

  it("`int[] | float[]` promises nothing about the element, so each alternative keeps its lexical kind — the answer `project()` gives", () => {
    // `numeric.ts` records an element's admission once per alternative and
    // **intersects**, so this element has no numeric demand at all and is
    // projected faithfully: an `int`-kind scalar stays `bigint`, a
    // `float`-kind one stays `number`. The emitted type has to say the same
    // thing, or FR-016 is a claim rather than a construction.
    // Canonical alternative order is (depth, then name by code point), so
    // `float[]` precedes `int[]`.
    expect(typeOfA(keyA('{ type: "int[] | float[]" }'))).toBe("readonly number[] | readonly bigint[]");
  });

  it("an `items:` element carries its own accumulated numeric class", () => {
    expect(typeOfA(keyA('{ type: sequence, items: { type: "int | float" } }'))).toBe("readonly number[]");
    expect(typeOfA(keyA('{ type: sequence, items: { type: "int | float" } }'), keyA("{ type: sequence, items: { type: int } }"))).toBe("readonly bigint[]");
  });
});

// --- rows 5, 17–18: unions, `null`, and the empty intersection --------------

describe("contract rows 5, 17–18 — unions, `null`, and `never`", () => {
  it("a union of alternatives emits a TypeScript union", () => {
    expect(typeOfA(keyA('{ type: "string | bool" }'))).toBe("boolean | string");
  });

  it("row 18 / FR-022 — an empty intersection emits `never`", () => {
    expect(typeOfA(keyA("{ type: string }"), keyA("{ type: int }"))).toBe("never");
  });

  it("FR-018 — a `null` comes only from a `null` alternative, and `undefined` never appears in a value type", () => {
    const source = emit(keyA("{ type: string, required: true }"));
    expect(source).not.toContain("null");
    expect(source).not.toContain("undefined");
    expect(typeOfA(keyA('{ type: "string | null" }'))).toBe("null | string");
  });
});

// --- rows 19–20: `enum` ----------------------------------------------------

describe("contract rows 19–20 / §6 — `enum` emits a kind-aware literal union", () => {
  it("`[1, 2.5]` under `int | float` emits `1 | 2.5` — the position admits a float", () => {
    expect(typeOfA(keyA('{ type: "int | float", enum: [1, 2.5] }'))).toBe("1 | 2.5");
  });

  it("`[1, 1.0]` under `int | float` emits `1` once: the two members project to one literal", () => {
    expect(typeOfA(keyA('{ type: "int | float", enum: [1, 1.0] }'))).toBe("1");
  });

  it("`[1]` under `int` emits `1n` — a bigint literal, because the projection is a bigint", () => {
    expect(typeOfA(keyA("{ type: int, enum: [1] }"))).toBe("1n");
  });

  it("a member of 2^64 emits exactly, because a bigint literal has no magnitude limit", () => {
    expect(typeOfA(keyA("{ type: int, enum: [18446744073709551616] }"))).toBe("18446744073709551616n");
  });

  it("strings, booleans and null emit as their own literals", () => {
    expect(typeOfA(keyA(`{ enum: ["a", "b"] }`))).toBe('"a" | "b"');
    expect(typeOfA(keyA("{ enum: [true, false] }"))).toBe("true | false");
    expect(typeOfA(keyA("{ enum: [null] }"))).toBe("null");
  });

  it("two layers' enums intersect before the literals are written", () => {
    expect(typeOfA(keyA(`{ enum: ["a", "b", "c"] }`), keyA(`{ enum: ["c", "b"] }`))).toBe('"b" | "c"');
  });

  it("row 20 — a non-scalar member yields the accumulated type, and the members go to JSDoc", () => {
    const source = emit(`keys:\n  a:\n    demand:\n      type: mapping\n      enum:\n        - { k: 1 }\n`);
    expect(source).toContain("@enum");
    expect(source).toMatch(/readonly a\?: \{\n {4}readonly \[key: string\]: unknown;\n {2}\};/);
    const problems = compileInMemory(source);
    expect(problems, renderProblems(problems)).toEqual([]);
  });

  it("an enum whose members are all intersected away admits nothing, and says so", () => {
    expect(typeOfA(keyA(`{ enum: ["a"] }`), keyA(`{ enum: ["b"] }`))).toBe("never");
  });
});

// --- row 21: the pinned constant -------------------------------------------

describe("contract row 21 / §6 — `final: true` with a scalar `provide` emits the literal type", () => {
  it("a scalar constant emits its literal, and the property is non-optional", () => {
    const source = emit(`keys:\n  k:\n    final: true\n    provide: "pinned"\n    demand: { type: string }\n`);
    expect(source).toContain(`readonly k: "pinned";`);
    const problems = compileInMemory(source);
    expect(problems, renderProblems(problems)).toEqual([]);
  });

  it("an int constant under `type: int` emits a bigint literal", () => {
    const source = emit(`keys:\n  k:\n    final: true\n    provide: 42\n    demand: { type: int }\n`);
    expect(source).toContain("readonly k: 42n;");
  });

  it("a NON-scalar `provide` under `final` emits the accumulated type, never a literal", () => {
    const source = emit(`keys:\n  k:\n    final: true\n    provide: { a: 1 }\n    demand: { type: mapping, seal: closed }\n`);
    expect(source).toMatch(/readonly k: \{\n {4}readonly \[key: string\]: never;\n {2}\};/);
    const problems = compileInMemory(source);
    expect(problems, renderProblems(problems)).toEqual([]);
  });

  it("a scalar `provide` WITHOUT `final` is a default, not a constant — the type stays open", () => {
    expect(emit(`keys:\n  k:\n    provide: "x"\n    demand: { type: string }\n`)).toContain("readonly k: string;");
  });
});

// --- row 23 (JSDoc): the constraints that have no type ---------------------

describe("FR-023 — `min`, `max`, lengths and `pattern` change no type and reach JSDoc", () => {
  it("the type is exactly what it would be without them", () => {
    expect(typeOfA(keyA('{ type: int, min: 1, max: 10 }'))).toBe("bigint");
    expect(typeOfA(keyA('{ type: string, minLength: 1, pattern: "^a" }'))).toBe("string");
  });

  it("and each names the constraint and its declaring layer", () => {
    const source = emit(`$id: vendor/core\nkeys:\n  a:\n    demand: { type: int, min: 5 }\n`);
    expect(source).toContain("@demand min: 5 (core:");
    const problems = compileInMemory(source);
    expect(problems, renderProblems(problems)).toEqual([]);
  });

  it("the winning bound is the accumulated one, not the nearest layer's", () => {
    const source = emit(`$id: vendor/core\nkeys:\n  a:\n    demand: { type: int, min: 9 }\n`, `$id: acme/house\nkeys:\n  a:\n    demand: { type: int, min: 2 }\n`);
    expect(source).toContain("@demand min: 9 (core:");
    expect(source).not.toContain("@demand min: 2");
  });
});
