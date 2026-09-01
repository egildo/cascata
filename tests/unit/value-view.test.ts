/**
 * v1.0 (009) FR-008 through FR-014 / SC-003, SC-004 — **the value view.**
 *
 * `SPEC.md` Article VII (§17), and §1's promise of "a validated
 * configuration object" kept seven milestones after it was made. Until now
 * a consumer wanting `config.server.host` had to walk a tagged union with
 * spans, `Map`s for mappings and `bigint`s for integers.
 *
 * The oracle is `contracts/value-view.md` §1 and §4, written before this
 * file and before `src/project/value.ts`. Every expected value here is
 * derived from the article and the contract, never from running the
 * projection.
 *
 * **Two of these cases are about JavaScript rather than about Cascata**,
 * and both are load-bearing:
 *
 *   - `__proto__` on a null-prototype object is an ordinary own property;
 *     on `{}` it sets the prototype and creates no own property at all.
 *     That is Article VII's stated reason for `Object.create(null)`, and
 *     the failure it prevents is silent. `constructor`, `toString` and
 *     `hasOwnProperty` get the same treatment, because `__proto__` is the
 *     famous one and not the only one.
 *   - **ECMA-262 hoists array-index keys.** A canonical numeric string in
 *     `[0, 2^32−2]` enumerates first, in ascending numeric order, ahead of
 *     every other key. No object can do otherwise. Article VII says keys
 *     are *inserted* in canonical order, which is met exactly; this
 *     milestone's own FR-009 says they *enumerate* canonically, which is
 *     not satisfiable. The limit is asserted here in both directions so it
 *     is a decision on the record rather than a surprise in someone's
 *     config. See the milestone report.
 */
import { describe, expect, it } from "vitest";
import { project, type ConfigValue } from "../../src/index.js";
import { compareByCodePoint, createBoolScalar, createFloatScalar, createIntScalar, createMapping, createNullScalar, createSequence, createStringScalar, type Node } from "../../src/model/node.js";
import { createOrigin, createSourceSpan, type SourceSpan } from "../../src/model/span.js";
import { freeze } from "../../src/model/freeze.js";
import type { Layer, MergedConfiguration } from "../../src/merge/provenance.js";

const ORIGIN = createOrigin("value-view", "value-view");

let offset = 0;
function span(): SourceSpan {
  offset += 1;
  return createSourceSpan({ origin: ORIGIN, start: offset, end: offset + 1, line: 1, column: offset, documentLength: 10_000_000 });
}

/** A configuration whose merged tree is exactly `tree` — the projection reads nothing else in this file's cases. */
function configurationOf(tree: Node): MergedConfiguration {
  const configLayer: Layer = { identity: { location: "value-view", hash: "1".repeat(64) }, role: "config", rank: 0, tree };
  return { tree, provenance: new Map(), pedigree: [], layers: [configLayer], delegationBreadcrumbs: new Map(), finalState: new Map() };
}

function valueOf(tree: Node): ConfigValue {
  return project<ConfigValue>(configurationOf(tree)).value;
}

/** Every value reachable in a projection, so a property can be asserted over all of them at once. */
function everyValue(value: ConfigValue, seen: ConfigValue[] = []): ConfigValue[] {
  seen.push(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      everyValue(item, seen);
    }
  } else if (typeof value === "object" && value !== null) {
    const record = value as { readonly [key: string]: ConfigValue };
    for (const key of Object.keys(record)) {
      const child = record[key];
      if (child !== undefined) {
        everyValue(child, seen);
      }
    }
  }
  return seen;
}

describe("v1.0 FR-008 — mappings project to null-prototype objects, sequences to arrays, scalars to their JS equivalents", () => {
  it("a mapping has a null prototype", () => {
    const value = valueOf(createMapping([["a", createStringScalar("x", span())]], span()));
    expect(Object.getPrototypeOf(value)).toBe(null);
    expect(value).not.toBeInstanceOf(Object);
  });

  it("a sequence is a real Array", () => {
    const value = valueOf(createSequence([createStringScalar("x", span())], span()));
    expect(Array.isArray(value)).toBe(true);
  });

  it("each scalar kind becomes its JS equivalent, and only that", () => {
    const value = valueOf(
      createMapping(
        [
          ["b", createBoolScalar(true, span())],
          ["f", createFloatScalar(1.5, span())],
          ["i", createIntScalar(42n, span())],
          ["n", createNullScalar(span())],
          ["s", createStringScalar("hello", span())],
        ],
        span(),
      ),
    );
    // Written out rather than compared with toEqual against an object
    // literal: `toEqual` would compare a null-prototype object against a
    // `{}`-prototype one and say nothing about the kinds.
    expect(value).toMatchObject({ b: true, f: 1.5, s: "hello" });
    const record = value as { readonly [key: string]: ConfigValue };
    expect(typeof record["b"]).toBe("boolean");
    expect(typeof record["f"]).toBe("number");
    expect(typeof record["i"]).toBe("bigint");
    expect(record["i"]).toBe(42n);
    expect(record["n"]).toBe(null);
    expect(typeof record["s"]).toBe("string");
  });

  it("an int with no numeric demand keeps every digit — the whole point of `bigint` (FR-015, FR-018)", () => {
    const huge = 123456789012345678901234567890n;
    const record = valueOf(createMapping([["big", createIntScalar(huge, span())]], span())) as { readonly [key: string]: ConfigValue };
    expect(record["big"]).toBe(huge);
  });

  it("no `Map` survives into the projection anywhere", () => {
    // Article VII mentions "the `Map`-shaped hazard src/model/freeze.ts
    // exists to close". It cannot arise here, because a mapping becomes an
    // object — and that is asserted rather than assumed.
    const tree = createMapping([["deep", createMapping([["items", createSequence([createMapping([["x", createIntScalar(1n, span())]], span())], span())]], span())]], span());
    for (const reachable of everyValue(valueOf(tree))) {
      expect(reachable).not.toBeInstanceOf(Map);
    }
  });
});

describe("v1.0 FR-009 — keys are inserted in §4.2's canonical (code point) order", () => {
  it("non-index keys, including one above the BMP, enumerate canonically", () => {
    // 😀 is U+1F600; � is U+FFFD. By code point U+FFFD sorts first, while
    // a UTF-16 code-unit comparison puts 😀 first (its lead surrogate is
    // 0xD83D). `src/model/node.ts` documents this pair as the
    // discriminating case, and the projection must not undo it.
    const names = ["zeta", "Alpha", "_under", "😀", "�", "a-b"];
    const tree = createMapping(
      names.map((name) => [name, createStringScalar(name, span())] as const),
      span(),
    );
    const expected = [...names].sort(compareByCodePoint);
    expect(Object.keys(valueOf(tree) as object)).toEqual(expected);
  });

  it("THE NAMED LIMIT: ECMA-262 hoists array-index keys, so enumeration is canonical only for non-index keys", () => {
    // Article VII says keys are *inserted* in canonical order, which is
    // exactly what happens. It does not — and no object could — promise
    // that they *enumerate* that way: `OrdinaryOwnPropertyKeys` returns
    // every canonical numeric string in [0, 2^32-2] first, ascending, then
    // everything else in insertion order. This case exists so the limit is
    // on the record. See contracts/value-view.md §1 and the report.
    const names = ["10", "2", "b", "a", "4294967295", "-0", "01"];
    const tree = createMapping(
      names.map((name) => [name, createStringScalar(name, span())] as const),
      span(),
    );
    const canonical = [...names].sort(compareByCodePoint);
    const enumerated = Object.keys(valueOf(tree) as object);
    // The two array indices come first, in numeric order. 4294967295 is one
    // past the last array index and is NOT hoisted; "-0" and "01" are not
    // canonical numeric strings and are not hoisted either.
    expect(enumerated.slice(0, 2)).toEqual(["2", "10"]);
    expect(enumerated).not.toEqual(canonical);
    // Everything that is not an array index is still in canonical order
    // relative to the others — the insertion order survives for them.
    expect(enumerated.filter((key) => key !== "2" && key !== "10")).toEqual(canonical.filter((key) => key !== "2" && key !== "10"));
    // And nothing is lost or renamed.
    expect([...enumerated].sort(compareByCodePoint)).toEqual(canonical);
  });

  it("sequence order is untouched — item order is semantically significant (§4.2)", () => {
    const items = ["c", "a", "b"].map((v) => createStringScalar(v, span()));
    expect(valueOf(createSequence(items, span()))).toEqual(["c", "a", "b"]);
  });
});

describe("v1.0 FR-010 — a key named __proto__ is an ordinary own property and pollutes nothing", () => {
  it("__proto__ is an own, enumerable property; the prototype is still null; Object.prototype is untouched", () => {
    const tree = createMapping([["__proto__", createMapping([["polluted", createBoolScalar(true, span())]], span())]], span());
    const value = valueOf(tree);
    expect(Object.getPrototypeOf(value)).toBe(null);
    expect(Object.prototype.hasOwnProperty.call(value, "__proto__")).toBe(true);
    expect(Object.keys(value as object)).toEqual(["__proto__"]);
    // The global prototype chain is untouched — the failure this case
    // exists for is exactly the one that would be silent.
    expect("polluted" in Object.prototype).toBe(false);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("and the projected value is reachable: the key holds what the document said", () => {
    const tree = createMapping([["__proto__", createStringScalar("just a key", span())]], span());
    const record = valueOf(tree) as { readonly [key: string]: ConfigValue };
    expect(record["__proto__"]).toBe("just a key");
  });

  it("constructor, toString and hasOwnProperty are ordinary own properties too — __proto__ is the famous one, not the only one", () => {
    const names = ["constructor", "hasOwnProperty", "toString", "valueOf"];
    const tree = createMapping(
      names.map((name) => [name, createStringScalar(name, span())] as const),
      span(),
    );
    const value = valueOf(tree);
    const record = value as { readonly [key: string]: ConfigValue };
    for (const name of names) {
      expect(Object.prototype.hasOwnProperty.call(value, name), name).toBe(true);
      expect(record[name], name).toBe(name);
    }
    // Nothing inherited is being shadowed, because nothing is inherited.
    expect(Object.getPrototypeOf(value)).toBe(null);
  });
});

describe("v1.0 FR-011 — the projection is deeply immutable", () => {
  const tree = createMapping(
    [
      ["list", createSequence([createMapping([["inner", createIntScalar(1n, span())]], span())], span())],
      ["nested", createMapping([["deep", createMapping([["deeper", createStringScalar("x", span())]], span())]], span())],
    ],
    span(),
  );

  it("every object and array in it is frozen, at every depth", () => {
    for (const reachable of everyValue(valueOf(tree))) {
      if (typeof reachable === "object" && reachable !== null) {
        expect(Object.isFrozen(reachable)).toBe(true);
      }
    }
  });

  it("a write at the top throws", () => {
    const value = valueOf(tree) as Record<string, ConfigValue>;
    expect(() => {
      value["list"] = "nope";
    }).toThrow(TypeError);
    expect(() => {
      value["brandNew"] = "nope";
    }).toThrow(TypeError);
  });

  it("a write three levels down throws, and a push onto a nested array throws", () => {
    const value = valueOf(tree) as { readonly [key: string]: ConfigValue };
    const nested = value["nested"] as { readonly [key: string]: ConfigValue };
    const deep = nested["deep"] as Record<string, ConfigValue>;
    expect(() => {
      deep["deeper"] = "nope";
    }).toThrow(TypeError);
    const list = value["list"] as ConfigValue[];
    expect(() => list.push("nope")).toThrow(TypeError);
  });
});

describe("v1.0 FR-013 — the projection is pure: the tree it read is unchanged", () => {
  it("a frozen tree survives projection, and its nodes are the same objects afterwards", () => {
    const tree = freeze(createMapping([["a", createSequence([createIntScalar(1n, span())], span())]], span()));
    const before = tree.type === "mapping" ? tree.entries.get("a") : undefined;
    project(configurationOf(tree));
    const after = tree.type === "mapping" ? tree.entries.get("a") : undefined;
    expect(after).toBe(before);
    expect(tree.type).toBe("mapping");
  });

  it("projecting twice yields equal values and does not share mutable state", () => {
    const tree = createMapping([["a", createStringScalar("x", span())]], span());
    const first = valueOf(tree);
    const second = valueOf(tree);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});

describe("v1.0 FR-014 — projection never throws on any legal document", () => {
  it("a 200,000-element sequence projects without a RangeError (no call-site spread — src/extend.ts's own reason for existing)", () => {
    const shared = span();
    const items: Node[] = [];
    for (let index = 0; index < 200_000; index += 1) {
      items.push(createIntScalar(BigInt(index), shared));
    }
    const value = valueOf(createSequence(items, span()));
    expect(Array.isArray(value)).toBe(true);
    expect((value as readonly ConfigValue[]).length).toBe(200_000);
  }, 60_000);

  it("a 5,000-level nesting projects without a stack overflow", () => {
    // Deeper than §11's parse-depth cap, and reachable the same way
    // `tests/unit/recursion-termination.test.ts`'s 400-level case is: a
    // configuration built by hand, which `validate()`'s and `project()`'s
    // contracts both accept from anywhere.
    let node: Node = createStringScalar("bottom", span());
    for (let level = 0; level < 5_000; level += 1) {
      node = createMapping([["child", node]], span());
    }
    let value = valueOf(node);
    let depth = 0;
    while (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const next = (value as { readonly [key: string]: ConfigValue })["child"];
      if (next === undefined) break;
      value = next;
      depth += 1;
    }
    expect(depth).toBe(5_000);
    expect(value).toBe("bottom");
  }, 60_000);

  it("a 5,000-level nesting of sequences projects too — the same guard on the other container", () => {
    let node: Node = createStringScalar("bottom", span());
    for (let level = 0; level < 5_000; level += 1) {
      node = createSequence([node], span());
    }
    let value = valueOf(node);
    let depth = 0;
    while (Array.isArray(value)) {
      const next: ConfigValue | undefined = value[0];
      if (next === undefined) break;
      value = next;
      depth += 1;
    }
    expect(depth).toBe(5_000);
    expect(value).toBe("bottom");
  }, 60_000);
});

describe("v1.0 — the Edge Cases the spec lists, each with its own case", () => {
  it("an empty mapping is {} with a null prototype, frozen", () => {
    const value = valueOf(createMapping([], span()));
    expect(Object.keys(value as object)).toEqual([]);
    expect(Object.getPrototypeOf(value)).toBe(null);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it("an empty sequence is [], frozen", () => {
    const value = valueOf(createSequence([], span()));
    expect(value).toEqual([]);
    expect(Array.isArray(value)).toBe(true);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it("a scalar at the configuration root projects to that scalar — the root need not be a mapping", () => {
    expect(valueOf(createStringScalar("just a string", span()))).toBe("just a string");
    expect(valueOf(createIntScalar(7n, span()))).toBe(7n);
    expect(valueOf(createNullScalar(span()))).toBe(null);
  });

  it("null is a present property; an absent key is an absent property — §4.2's three-way distinction survives", () => {
    const tree = createMapping([["present", createNullScalar(span())]], span());
    const value = valueOf(tree);
    expect(Object.prototype.hasOwnProperty.call(value, "present")).toBe(true);
    expect((value as { readonly [key: string]: ConfigValue })["present"]).toBe(null);
    expect(Object.prototype.hasOwnProperty.call(value, "absent")).toBe(false);
    expect(Object.keys(value as object)).toEqual(["present"]);
  });

  it("JSON.stringify throws on a bigint, and this milestone does not hide it (contracts/value-view.md §3)", () => {
    // Documented, never converted: converting would silently reintroduce
    // exactly the precision loss §4.2 and §6.1 exist to prevent — the
    // argument that withdrew RFC 8785 from `$pin`, one layer up.
    const value = valueOf(createMapping([["n", createIntScalar(1n, span())]], span()));
    expect(() => JSON.stringify(value)).toThrow(TypeError);
    // The two workarounds a consumer has, both one line, both asserted so
    // the documentation cannot rot.
    expect(JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item))).toBe('{"n":"1"}');
    expect(JSON.stringify(valueOf(createMapping([["n", createFloatScalar(1, span())]], span())))).toBe('{"n":1}');
  });
});

describe("v1.0 FR-012 / FR-023 — a projection, never a replacement", () => {
  it("project() leaves the configuration on the caller's hands, tree and all, and is reachable without load()", () => {
    const tree = createMapping([["a", createStringScalar("x", span())]], span());
    const configuration = configurationOf(tree);
    const result = project(configuration);
    expect(result.value).toBeDefined();
    // Nothing about the configuration moved: the same object, the same
    // tree, the same layers.
    expect(configuration.tree).toBe(tree);
    expect(configuration.layers).toHaveLength(1);
  });

  it("project() returns diagnostics alongside the value — empty when there is nothing to say", () => {
    const result = project(configurationOf(createMapping([["a", createStringScalar("x", span())]], span())));
    expect(result.diagnostics).toEqual([]);
  });
});
