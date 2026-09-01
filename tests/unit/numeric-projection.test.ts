/**
 * v1.0 (009) FR-015 through FR-021 / SC-005, SC-006 — **the accumulated
 * demand decides the numeric type, never the document.**
 *
 * `SPEC.md` §17's sharpest rule, and the one place a config author could
 * otherwise reach into the consuming application's type system. `kind` is
 * lexical (§4.2) — `30` is an int and `30.0` is a float — so a *faithful*
 * projection would let punctuation decide whether the application sees a
 * `bigint` or a `number`, under an unchanged schema. That is this
 * project's own thesis inverted.
 *
 * The oracle is `contracts/numeric-projection.md`, written before this file
 * and before `src/validate/numeric.ts`. Every expected value below is
 * derived from §17's table by hand.
 *
 * **The discriminating case is `30` versus `30.0`**, run end to end through
 * the real `load()` against two documents on disk that differ in exactly
 * one character (`tests/corpus/cases/numeric/int-vs-float-lexical/`). If
 * those two ever project different JS types, the schema has stopped being
 * the thing that decides.
 *
 * **FR-020's absence case is not optional.** A lint that fires on the shape
 * rather than on the value "would be ignored within a week" (§17). Without
 * a case asserting that an *exact* normalization emits nothing, the
 * firing case proves only that the code can produce a diagnostic — not that
 * it is narrow. It is also the case that catches `Number.isSafeInteger`,
 * which is the obvious implementation and is wrong: 2^53, 3·2^52 and 2^60
 * are all exactly representable and all fail it.
 */
import { describe, expect, it } from "vitest";
import { load, project, type ConfigValue } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";
import { join } from "node:path";
import { createFloatScalar, createIntScalar, createMapping, createSequence, createStringScalar, type Node } from "../../src/model/node.js";
import { createOrigin, createSourceSpan, type SourceSpan } from "../../src/model/span.js";
import { fold } from "../../src/merge/fold.js";
import type { Layer, MergedConfiguration } from "../../src/merge/provenance.js";

const CASES = join(__dirname, "..", "corpus", "cases", "numeric");

/** The lexical `kind` of a top-level scalar in a merged tree — the fact the projection deliberately does not impose. */
function kindAt(tree: Node, key: string): string | undefined {
  if (tree.type !== "mapping") return undefined;
  const child = tree.entries.get(key);
  return child !== undefined && child.type === "scalar" ? child.kind : undefined;
}

const ORIGIN_SCHEMA = createOrigin("numeric-schema", "numeric-schema");
const ORIGIN_HOUSE = createOrigin("numeric-house", "numeric-house");
const ORIGIN_CONFIG = createOrigin("numeric-config", "numeric-config");

let offset = 0;
function span(origin: ReturnType<typeof createOrigin>): SourceSpan {
  offset += 1;
  return createSourceSpan({ origin, start: offset, end: offset + 1, line: 1, column: offset, documentLength: 10_000_000 });
}

const s = (value: string): Node => createStringScalar(value, span(ORIGIN_SCHEMA));
const m = (entries: readonly (readonly [string, Node])[]): Node => createMapping(entries, span(ORIGIN_SCHEMA));

/** A schema whose single key `n` carries `demand`. */
function schemaFor(demand: Node, extraSections: readonly (readonly [string, Node])[] = []): Node {
  return m([...extraSections, ["keys", m([["n", m([["demand", demand]])]])]]);
}

function configurationOf(schemaTrees: readonly Node[], configTree: Node): MergedConfiguration {
  const layers: Layer[] = schemaTrees.map((tree, index) => ({ identity: { location: `numeric-schema-${index}`, hash: String(index).repeat(64) }, role: "schema" as const, rank: index, tree }));
  layers.push({ identity: { location: "numeric-config", hash: "c".repeat(64) }, role: "config" as const, rank: schemaTrees.length, tree: configTree });
  return { tree: fold(layers), provenance: new Map(), pedigree: [], layers, delegationBreadcrumbs: new Map(), finalState: new Map() };
}

/** Project a config `{ n: <value> }` under `demand` and hand back the projected `n` plus whatever lints the projection earned. */
function projectN(demand: Node, value: Node, extraSections: readonly (readonly [string, Node])[] = []): { readonly n: ConfigValue; readonly codes: readonly string[] } {
  const configuration = configurationOf([schemaFor(demand, extraSections)], createMapping([["n", value]], span(ORIGIN_CONFIG)));
  const result = project<{ readonly [key: string]: ConfigValue }>(configuration);
  const n = result.value["n"];
  if (n === undefined) {
    throw new Error("the fixture lost its own key");
  }
  return { n, codes: result.diagnostics.map((d) => d.code) };
}

describe("v1.0 FR-015 — accumulated `type: int` projects `bigint`, at every magnitude, exactly", () => {
  const cases: readonly bigint[] = [
    0n,
    42n,
    9007199254740991n, // 2^53 - 1
    9007199254740993n, // 2^53 + 1 — the first integer a double cannot hold
    1152921504606846977n, // 2^60 + 1
    123456789012345678901234567890n,
    -9007199254740993n,
  ];
  for (const value of cases) {
    it(`${value} stays exactly ${value}`, () => {
      const { n, codes } = projectN(m([["type", s("int")]]), createIntScalar(value, span(ORIGIN_CONFIG)));
      expect(typeof n).toBe("bigint");
      expect(n).toBe(value);
      // Nothing is narrowed, so nothing is linted — under `int` there is
      // no normalization to be inexact about.
      expect(codes).toEqual([]);
    });
  }
});

describe("v1.0 FR-016 / FR-017 — `float` and `int | float` both project `number`", () => {
  it("`type: float` with a float value is a number", () => {
    const { n } = projectN(m([["type", s("float")]]), createFloatScalar(1.5, span(ORIGIN_CONFIG)));
    expect(typeof n).toBe("number");
    expect(n).toBe(1.5);
  });

  it("`type: float` with an int-kind value is still a number — the demand decides, not the punctuation", () => {
    // Under §4.2 a document writing `3` produces an int-kind scalar even
    // where the schema demands a float; whether that is a *validation*
    // refusal is §5.4's business, and the projection's job is only to
    // apply the accumulated demand it was given.
    const { n } = projectN(m([["type", s("float")]]), createIntScalar(3n, span(ORIGIN_CONFIG)));
    expect(typeof n).toBe("number");
    expect(n).toBe(3);
  });

  it("`type: int | float` projects a number whichever lexical form the author wrote", () => {
    const asInt = projectN(m([["type", s("int | float")]]), createIntScalar(30n, span(ORIGIN_CONFIG)));
    const asFloat = projectN(m([["type", s("int | float")]]), createFloatScalar(30, span(ORIGIN_CONFIG)));
    expect(typeof asInt.n).toBe("number");
    expect(typeof asFloat.n).toBe("number");
    expect(asInt.n).toBe(asFloat.n);
    expect(asInt.n).toBe(30);
  });

  it("the union's order does not matter — `float | int` is the same demand", () => {
    const { n } = projectN(m([["type", s("float | int")]]), createIntScalar(30n, span(ORIGIN_CONFIG)));
    expect(typeof n).toBe("number");
  });
});

describe("v1.0 FR-018 — a key with no numeric demand is projected faithfully by lexical kind", () => {
  it("no `type:` at all: an int stays a bigint and a float stays a number", () => {
    expect(typeof projectN(m([["required", createStringScalar("", span(ORIGIN_SCHEMA))]]), createIntScalar(5n, span(ORIGIN_CONFIG))).n).toBe("bigint");
    expect(typeof projectN(m([]), createFloatScalar(5, span(ORIGIN_CONFIG))).n).toBe("number");
  });

  it("a key the schema never mentions is faithful too", () => {
    const configuration = configurationOf([schemaFor(m([["type", s("int | float")]]))], createMapping([["n", createIntScalar(1n, span(ORIGIN_CONFIG))], ["undeclared", createIntScalar(2n, span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG)));
    const value = project<{ readonly [key: string]: ConfigValue }>(configuration).value;
    expect(typeof value["n"]).toBe("number");
    expect(typeof value["undeclared"]).toBe("bigint");
  });

  it("a non-numeric demand is not a numeric demand: `type: string` leaves an int faithful", () => {
    // The value is refused by validate(); the projection has no contract
    // to consult here and promises nothing, which is §17's fourth row.
    expect(typeof projectN(m([["type", s("string")]]), createIntScalar(5n, span(ORIGIN_CONFIG))).n).toBe("bigint");
  });
});

describe("v1.0 FR-019 / FR-020 — the precision lint fires on a lost digit and on nothing else", () => {
  it("an integer that is NOT exactly representable lints, names the key and both values, and the result stays successful", () => {
    const configuration = configurationOf([schemaFor(m([["type", s("int | float")]]))], createMapping([["n", createIntScalar(9007199254740993n, span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG)));
    const result = project(configuration);
    expect(result.diagnostics).toHaveLength(1);
    const lint = result.diagnostics[0];
    expect(lint?.code).toBe("precision-narrowed");
    // §10: an `info` is a lint, never a refusal — there is no `ok: false`
    // here to begin with, and `load()` still succeeds (see load-typed).
    expect(lint?.level).toBe("info");
    // "naming the key and both values" (§17).
    expect(lint?.pointer).toBe("/n");
    expect(lint?.message).toContain("9007199254740993");
    expect(lint?.message).toContain("9007199254740992");
    // Principle III's never-phasing obligation: the position is the
    // offending construct's own — the value's, not the demand's.
    expect(lint?.primary.origin.id).toBe("numeric-config");
  });

  it("2^53 exactly — representable — emits NOTHING (this is the case `Number.isSafeInteger` gets wrong)", () => {
    const { n, codes } = projectN(m([["type", s("int | float")]]), createIntScalar(9007199254740992n, span(ORIGIN_CONFIG)));
    expect(codes).toEqual([]);
    expect(n).toBe(9007199254740992);
  });

  it("2^60 and 3·2^52 — both representable, both outside the safe-integer range — emit NOTHING either", () => {
    for (const value of [1152921504606846976n, 13510798882111488n]) {
      const { n, codes } = projectN(m([["type", s("int | float")]]), createIntScalar(value, span(ORIGIN_CONFIG)));
      expect(codes, `${value}`).toEqual([]);
      expect(n, `${value}`).toBe(Number(value));
    }
  });

  it("an ordinary small integer emits nothing", () => {
    expect(projectN(m([["type", s("int | float")]]), createIntScalar(30n, span(ORIGIN_CONFIG))).codes).toEqual([]);
  });

  it("a value already a float has nothing to normalize and is never linted", () => {
    expect(projectN(m([["type", s("int | float")]]), createFloatScalar(30.5, span(ORIGIN_CONFIG))).codes).toEqual([]);
  });

  it("a magnitude past Number.MAX_VALUE lints rather than throwing — Number() gives Infinity and BigInt(Infinity) throws", () => {
    const enormous = 2n ** 1024n;
    const { n, codes } = projectN(m([["type", s("int | float")]]), createIntScalar(enormous, span(ORIGIN_CONFIG)));
    expect(codes).toEqual(["precision-narrowed"]);
    expect(n).toBe(Number.POSITIVE_INFINITY);
  });

  it("`type: int` never lints, at any magnitude — there is no normalization under it", () => {
    expect(projectN(m([["type", s("int")]]), createIntScalar(2n ** 200n, span(ORIGIN_CONFIG))).codes).toEqual([]);
  });
});

describe("v1.0 FR-021 — decided from the ACCUMULATED demand, never the nearest layer's", () => {
  function twoLayers(rootType: string, houseType: string, value: Node): { readonly n: ConfigValue; readonly codes: readonly string[] } {
    const root = schemaFor(m([["type", s(rootType)]]));
    const house = createMapping([["keys", createMapping([["n", createMapping([["demand", createMapping([["type", createStringScalar(houseType, span(ORIGIN_HOUSE))]], span(ORIGIN_HOUSE))]], span(ORIGIN_HOUSE))]], span(ORIGIN_HOUSE))]], span(ORIGIN_HOUSE));
    const configuration = configurationOf([root, house], createMapping([["n", value]], span(ORIGIN_CONFIG)));
    const result = project<{ readonly [key: string]: ConfigValue }>(configuration);
    const n = result.value["n"];
    if (n === undefined) throw new Error("the fixture lost its own key");
    return { n, codes: result.diagnostics.map((d) => d.code) };
  }

  it("root says `int | float`, a descendant narrows to `int`: the accumulated demand is `int`, so `bigint`", () => {
    const { n, codes } = twoLayers("int | float", "int", createIntScalar(9007199254740993n, span(ORIGIN_CONFIG)));
    expect(typeof n).toBe("bigint");
    expect(n).toBe(9007199254740993n);
    // And nothing is narrowed, so nothing is linted — which is the whole
    // point of the narrowing: exactness was demanded and is delivered.
    expect(codes).toEqual([]);
  });

  it("and the answer does not depend on which layer is nearer — intersection is commutative (§5.1)", () => {
    const narrowFirst = twoLayers("int", "int | float", createIntScalar(9007199254740993n, span(ORIGIN_CONFIG)));
    expect(typeof narrowFirst.n).toBe("bigint");
    expect(narrowFirst.codes).toEqual([]);
  });

  it("two layers that both say `int | float` still say `int | float`", () => {
    const { n } = twoLayers("int | float", "int | float", createIntScalar(30n, span(ORIGIN_CONFIG)));
    expect(typeof n).toBe("number");
  });
});

describe("v1.0 — the gap Article VII's table does not cover: a demand mixing numeric and non-numeric types", () => {
  /**
   * `int | string` is **not in §17's table**. The rule that generalizes is
   * "did the accumulated demand declare a float acceptable here?", not
   * "which of these three spellings did the author use" — so a non-numeric
   * alternative says nothing about floats and must not change what happens
   * to integers. Reported as a gap in the article; under §15's freeze rule
   * the fix is an *addition*, which stays permitted. See research D-5.
   */
  it("`int | string` projects an int as `bigint` — adding a non-numeric alternative must not cost exactness", () => {
    const { n, codes } = projectN(m([["type", s("int | string")]]), createIntScalar(9007199254740993n, span(ORIGIN_CONFIG)));
    expect(typeof n).toBe("bigint");
    expect(n).toBe(9007199254740993n);
    expect(codes).toEqual([]);
  });

  it("`int | string` leaves a string value a string, untouched", () => {
    const { n } = projectN(m([["type", s("int | string")]]), createStringScalar("hello", span(ORIGIN_CONFIG)));
    expect(n).toBe("hello");
  });

  it("`float | null` still projects a number — the float alternative is what decides", () => {
    const { n } = projectN(m([["type", s("float | null")]]), createIntScalar(3n, span(ORIGIN_CONFIG)));
    expect(typeof n).toBe("number");
  });

  it("`int | float | string` projects a number — a float is admitted, so IEEE-754 was declared acceptable", () => {
    const { n } = projectN(m([["type", s("int | float | string")]]), createIntScalar(30n, span(ORIGIN_CONFIG)));
    expect(typeof n).toBe("number");
  });
});

describe("v1.0 — the rule reaches everywhere a demand does", () => {
  it("through an array: `int[]` makes every element a bigint, `float[]` a number", () => {
    const ints = configurationOf([schemaFor(m([["type", s("int[]")]]))], createMapping([["n", createSequence([createIntScalar(9007199254740993n, span(ORIGIN_CONFIG))], span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG)));
    const intValue = project<{ readonly [key: string]: readonly ConfigValue[] }>(ints).value["n"];
    expect(typeof intValue?.[0]).toBe("bigint");

    const floats = configurationOf([schemaFor(m([["type", s("float[]")]]))], createMapping([["n", createSequence([createIntScalar(30n, span(ORIGIN_CONFIG))], span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG)));
    const floatValue = project<{ readonly [key: string]: readonly ConfigValue[] }>(floats).value["n"];
    expect(typeof floatValue?.[0]).toBe("number");
  });

  it("through `items`", () => {
    const configuration = configurationOf([schemaFor(m([["items", m([["type", s("int | float")]])], ["type", s("sequence")]]))], createMapping([["n", createSequence([createIntScalar(30n, span(ORIGIN_CONFIG))], span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG)));
    const value = project<{ readonly [key: string]: readonly ConfigValue[] }>(configuration).value["n"];
    expect(typeof value?.[0]).toBe("number");
  });

  it("through nested `keys`", () => {
    const demand = m([["keys", m([["inner", m([["demand", m([["type", s("int | float")]])]])]])], ["type", s("mapping")]]);
    const configuration = configurationOf([schemaFor(demand)], createMapping([["n", createMapping([["inner", createIntScalar(30n, span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG)));
    const value = project<{ readonly [key: string]: { readonly [key: string]: ConfigValue } }>(configuration).value["n"];
    expect(typeof value?.["inner"]).toBe("number");
  });

  it("through `values`, which covers entries the schema never names", () => {
    const demand = m([["type", s("mapping")], ["values", m([["type", s("int | float")]])]]);
    const configuration = configurationOf([schemaFor(demand)], createMapping([["n", createMapping([["whatever", createIntScalar(30n, span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG))]], span(ORIGIN_CONFIG)));
    const value = project<{ readonly [key: string]: { readonly [key: string]: ConfigValue } }>(configuration).value["n"];
    expect(typeof value?.["whatever"]).toBe("number");
  });

  it("through a named type, resolved in its own declaring layer's scope (§7)", () => {
    const types = m([["exact", m([["demand", m([["type", s("int")]])]])], ["loose", m([["demand", m([["type", s("int | float")]])]])]]);
    const exact = projectN(m([["type", s("exact")]]), createIntScalar(9007199254740993n, span(ORIGIN_CONFIG)), [["types", types]]);
    expect(typeof exact.n).toBe("bigint");
    const loose = projectN(m([["type", s("loose")]]), createIntScalar(30n, span(ORIGIN_CONFIG)), [["types", types]]);
    expect(typeof loose.n).toBe("number");
  });

  it("through a named type that itself names another named type", () => {
    const types = m([["inner", m([["demand", m([["type", s("int | float")]])]])], ["outer", m([["demand", m([["type", s("inner")]])]])]]);
    const { n } = projectN(m([["type", s("outer")]]), createIntScalar(30n, span(ORIGIN_CONFIG)), [["types", types]]);
    expect(typeof n).toBe("number");
  });

  it("an unguarded type cycle in the numeric walk terminates rather than hanging", () => {
    // `a -> b -> a` by type expression alone. `types.ts` refuses the
    // declaration; this walk must still return, for the same reason
    // `check.ts`'s does (SPEC.md §7's guarded-recursion rule).
    const types = m([["a", m([["demand", m([["type", s("b")]])]])], ["b", m([["demand", m([["type", s("a")]])]])]]);
    const { n } = projectN(m([["type", s("a")]]), createIntScalar(1n, span(ORIGIN_CONFIG)), [["types", types]]);
    expect(typeof n).toBe("bigint");
  });
});

describe("v1.0 SC-005 — the discriminating case, end to end, on two documents that differ in one character", () => {
  it("`30` and `30.0` under one `int | float` demand project the SAME JS type", async () => {
    const host = createNodeHost();
    const root = join(CASES, "int-vs-float-lexical");
    const asInt = await load(join(root, "config-int.yaml"), { host, sandboxRoot: root });
    const asFloat = await load(join(root, "config-float.yaml"), { host, sandboxRoot: root });
    expect(asInt.ok, asInt.ok ? "" : JSON.stringify(asInt.diagnostics.map((d) => d.code))).toBe(true);
    expect(asFloat.ok).toBe(true);
    if (!asInt.ok || !asFloat.ok) return;
    const intPort = project<{ readonly port: ConfigValue }>(asInt.configuration).value.port;
    const floatPort = project<{ readonly port: ConfigValue }>(asFloat.configuration).value.port;
    expect(typeof intPort).toBe("number");
    expect(typeof floatPort).toBe("number");
    expect(intPort).toBe(floatPort);
    // The node tree still remembers what was written — the projection is a
    // projection, and the lexical kind is not lost, only not imposed.
    expect(kindAt(asInt.configuration.tree, "port")).toBe("int");
    expect(kindAt(asFloat.configuration.tree, "port")).toBe("float");
  });

  it("a real document demanding `type: int` keeps 2^53+1 exactly, through load()", async () => {
    const host = createNodeHost();
    const root = join(CASES, "demanded-int");
    const result = await load(join(root, "config.yaml"), { host, sandboxRoot: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const projected = project<{ readonly id: ConfigValue }>(result.configuration);
    expect(projected.value.id).toBe(9007199254740993n);
    expect(projected.diagnostics).toEqual([]);
  });
});
