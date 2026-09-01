/**
 * v1.1 (010) US1 — **the accumulated demand is a stage of its own.**
 *
 * Every expected value below is derived by hand from
 * `specs/010-type-generator/contracts/accumulated-demand.md` — §1's rows 1
 * through 18 and §3's edge-case table — and from `SPEC.md` Article VIII's
 * "Intersection is defined per keyword" law. **None of it was read off the
 * implementation's output**: this file was written and run (red) before
 * `src/generate/accumulate.ts` existed, which is what Principle V's
 * "conformance cases before the code that judges them" means here.
 *
 * The tree is asserted **without any emitter** (FR-008, contract row 16):
 * nothing in this file imports `src/generate/emit.ts`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../../src/index.js";
import { createOrigin } from "../../src/model/span.js";
import type { Layer } from "../../src/merge/provenance.js";
import type { Node } from "../../src/model/node.js";
import { cycleDiagnostics, readTypeDeclarations } from "../../src/validate/types.js";
import { accumulate, type AccumulateResult, type AccumulatedKey, type AccumulatedPosition, type AccumulatedTree } from "../../src/generate/accumulate.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENCODER = new TextEncoder();

/** One schema layer from YAML text. `rank` is precedence order — 0 is the root schema, highest is the leaf. */
function schemaLayer(location: string, rank: number, text: string): Layer {
  const origin = createOrigin(location, location);
  const parsed = parse(ENCODER.encode(text), { origin });
  if (!parsed.ok) {
    throw new Error(`fixture '${location}' does not parse: ${parsed.diagnostics.map((d) => d.message).join("; ")}`);
  }
  return { identity: { location, hash: String(rank).repeat(64).slice(0, 64) }, role: "schema", rank, tree: parsed.tree };
}

/** The chain, root first. Each entry is one document's text; ranks are assigned by position. */
function chain(...texts: readonly string[]): readonly Layer[] {
  return texts.map((text, index) => schemaLayer(`layer${index}.yaml`, index, text));
}

function run(...texts: readonly string[]): AccumulateResult {
  return accumulate(chain(...texts));
}

function keyOf(position: AccumulatedPosition, name: string): AccumulatedKey {
  const found = position.keys.get(name);
  if (found === undefined) {
    throw new Error(`no key '${name}' at this position; present: [${[...position.keys.keys()].join(", ")}]`);
  }
  return found;
}

function at(position: AccumulatedPosition, ...path: readonly string[]): AccumulatedPosition {
  let current = position;
  for (const segment of path) {
    current = keyOf(current, segment).position;
  }
  return current;
}

/**
 * A total, order-insensitive rendering of a tree, for the determinism
 * obligation (contract row 15). Declarations are rendered by name and
 * declaring rank rather than by object identity, so two runs over two
 * separately-parsed copies of one chain are comparable.
 */
function fingerprint(tree: AccumulatedTree): string {
  const seen = new Set<AccumulatedPosition>();
  function renderPosition(position: AccumulatedPosition): unknown {
    if (seen.has(position)) {
      return "<cycle>";
    }
    seen.add(position);
    const rendered = {
      type: renderType(position.type),
      required: position.required,
      seal: position.seal,
      accept: position.accept ?? null,
      enum: position.enum === undefined ? null : position.enum.map(renderNode),
      numeric: position.numeric ?? null,
      constraints: position.constraints.map((c) => `${c.keyword}=${c.value}@${c.layer.rank}${c.pointer}`),
      sources: position.sources.map((s) => `${s.layer.rank}${s.pointer}`),
      keys: [...position.keys].map(([name, key]) => [name, { provided: key.provided, constant: key.constant === undefined ? null : renderNode(key.constant), position: renderPosition(key.position) }]),
      values: position.values === undefined ? null : renderPosition(position.values),
      items: position.items === undefined ? null : renderPosition(position.items),
    };
    seen.delete(position);
    return rendered;
  }
  function renderType(type: AccumulatedPosition["type"]): unknown {
    if (type === undefined || type === "empty") {
      return type ?? null;
    }
    if (type.kind === "builtin") {
      return `builtin:${type.name}@${type.depth}`;
    }
    if (type.kind === "ref") {
      return `ref:[${type.declarations.map((d) => `${d.name}#${d.layerRank}`).join(",")}]@${type.depth}`;
    }
    return type.alternatives.map(renderType);
  }
  function renderNode(node: Node): unknown {
    if (node.type === "scalar") {
      return `${node.kind}:${String(node.value)}`;
    }
    if (node.type === "sequence") {
      return node.items.map(renderNode);
    }
    return [...node.entries].map(([k, v]) => [k, renderNode(v)]);
  }
  return JSON.stringify({ rootName: tree.rootName, root: renderPosition(tree.root), declarations: tree.declarations.map((d) => ({ name: d.declaration.name, rank: d.declaration.layerRank, qualifier: d.qualifier, emittedName: d.emittedName, body: renderPosition(d.body) })) });
}

// --- §1 row 1: schema layers only; no configuration -----------------------

describe("contract §1 row 1 — schema layers root to leaf, no configuration", () => {
  it("accumulates with no document in hand at all", () => {
    const result = run(`keys:\n  a:\n    demand: { type: string }\n`);
    expect(result.tree.root.keys.has("a")).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("throws on a `config` layer — a programmer error, not a fact about the world", () => {
    const layers = chain(`keys:\n  a:\n    demand: { type: string }\n`);
    const asConfig = layers.map((layer) => ({ ...layer, role: "config" as const }));
    expect(() => accumulate(asConfig)).toThrow(/config/i);
  });

  it("accepts an empty chain — no layers, no keys, no diagnostics", () => {
    const result = accumulate([]);
    expect(result.tree.root.keys.size).toBe(0);
    expect(result.tree.rootName).toBe("Configuration");
  });
});

// --- §1 row 2: keyed by structural position -------------------------------

describe("contract §1 row 2 — positions are shapes, keyed structurally", () => {
  it("`values` and `items` are children of the position, never pointers with a wildcard", () => {
    const result = run(`keys:\n  m:\n    demand:\n      type: mapping\n      values: { type: string }\n  s:\n    demand:\n      type: sequence\n      items: { type: int }\n`);
    const m = at(result.tree.root, "m");
    const s = at(result.tree.root, "s");
    expect(m.values?.type).toEqual({ kind: "builtin", name: "string", depth: 0 });
    expect(m.items).toBeUndefined();
    expect(s.items?.type).toEqual({ kind: "builtin", name: "int", depth: 0 });
    expect(s.values).toBeUndefined();
  });
});

// --- §1 row 3 / §7: a named type resolves in the using layer's scope -------

const ROOT_WITH_RESOURCE = `$id: site-builder/core
types:
  resource:
    accept: [url, path]
    demand: { type: string }
keys:
  styles:
    demand: { type: "resource[]" }
`;

describe("contract §1 row 3 / §3 — a named type resolves at the layer that used it (SPEC.md §7)", () => {
  it("the house narrows `resource` WITHOUT restating the key: the root's own declaration governs", () => {
    const result = run(ROOT_WITH_RESOURCE, `$id: house\ntypes:\n  resource:\n    accept: [url]\n`);
    const styles = at(result.tree.root, "styles");
    expect(styles.type).toMatchObject({ kind: "ref", depth: 1 });
    const type = styles.type;
    if (type === undefined || type === "empty" || type.kind !== "ref") {
      throw new Error("expected a ref");
    }
    expect(type.declarations.map((d) => d.layerRank)).toEqual([0]);
  });

  it("the house restates the key too: both declarations, as a ref carrying both", () => {
    const result = run(ROOT_WITH_RESOURCE, `$id: house\ntypes:\n  resource:\n    accept: [url]\nkeys:\n  styles:\n    demand: { type: "resource[]" }\n`);
    const type = at(result.tree.root, "styles").type;
    if (type === undefined || type === "empty" || type.kind !== "ref") {
      throw new Error("expected a ref");
    }
    expect(type.depth).toBe(1);
    expect(type.declarations.map((d) => d.layerRank)).toEqual([0, 1]);
  });

  it("an ancestor's demand never resolves a descendant's redeclaration — the two usages name two declarations", () => {
    const result = run(ROOT_WITH_RESOURCE, `$id: house\ntypes:\n  resource:\n    accept: [url]\nkeys:\n  other:\n    demand: { type: resource }\n`);
    const other = at(result.tree.root, "other").type;
    if (other === undefined || other === "empty" || other.kind !== "ref") {
      throw new Error("expected a ref");
    }
    expect(other.declarations.map((d) => d.layerRank)).toEqual([1]);
  });
});

// --- §1 row 4: type intersection ------------------------------------------

describe("contract §1 row 4 — alternatives intersect pairwise at equal depth", () => {
  it("US1's independent test: root `string | string[]`, house `string[]` ⇒ exactly `string[]`", () => {
    const result = run(`keys:\n  a:\n    demand: { type: "string | string[]" }\n`, `keys:\n  a:\n    demand: { type: "string[]" }\n`);
    expect(at(result.tree.root, "a").type).toEqual({ kind: "builtin", name: "string", depth: 1 });
  });

  it("alternatives of unequal depth do not intersect: `string` ∩ `string[]` is empty", () => {
    const result = run(`keys:\n  a:\n    demand: { type: string }\n`, `keys:\n  a:\n    demand: { type: "string[]" }\n`);
    expect(at(result.tree.root, "a").type).toBe("empty");
  });

  it("a union survives where both layers admit both alternatives", () => {
    const result = run(`keys:\n  a:\n    demand: { type: "string | int" }\n`, `keys:\n  a:\n    demand: { type: "int | string" }\n`);
    expect(at(result.tree.root, "a").type).toEqual({
      kind: "union",
      alternatives: [
        { kind: "builtin", name: "int", depth: 0 },
        { kind: "builtin", name: "string", depth: 0 },
      ],
    });
  });

  it("a built-in intersects only with itself: `int` ∩ `float` is empty", () => {
    const result = run(`keys:\n  a:\n    demand: { type: int }\n`, `keys:\n  a:\n    demand: { type: float }\n`);
    expect(at(result.tree.root, "a").type).toBe("empty");
  });

  it("`A[] ∩ B[]` is `(A ∩ B)[]` — one array level survives, the elements intersect", () => {
    const result = run(`keys:\n  a:\n    demand: { type: "string[] | int[]" }\n`, `keys:\n  a:\n    demand: { type: "int[]" }\n`);
    expect(at(result.tree.root, "a").type).toEqual({ kind: "builtin", name: "int", depth: 1 });
  });

  it("root `int | float` + house `int` ⇒ numeric { int: true, float: false } (§3's row)", () => {
    const result = run(`keys:\n  a:\n    demand: { type: "int | float" }\n`, `keys:\n  a:\n    demand: { type: int }\n`);
    const a = at(result.tree.root, "a");
    expect(a.type).toEqual({ kind: "builtin", name: "int", depth: 0 });
    expect(a.numeric).toEqual({ int: true, float: false });
  });

  it("root `int | float` alone ⇒ numeric { int: true, float: true }", () => {
    expect(at(run(`keys:\n  a:\n    demand: { type: "int | float" }\n`).tree.root, "a").numeric).toEqual({ int: true, float: true });
  });

  it("`int | string` admits no float, so the numeric class is int-only — §17's generalized rule", () => {
    expect(at(run(`keys:\n  a:\n    demand: { type: "int | string" }\n`).tree.root, "a").numeric).toEqual({ int: true, float: false });
  });

  it("a position mentioning no number carries no numeric admission at all", () => {
    expect(at(run(`keys:\n  a:\n    demand: { type: string }\n`).tree.root, "a").numeric).toBeUndefined();
  });
});

// --- §1 row 5: declarations ------------------------------------------------

describe("contract §1 row 5 — two references to one declaration are that declaration", () => {
  it("both layers naming one undisputed declaration yield a single-declaration ref", () => {
    const result = run(`$id: core\ntypes:\n  t:\n    demand: { type: string }\nkeys:\n  a:\n    demand: { type: t }\n`, `$id: house\nkeys:\n  a:\n    demand: { type: t }\n`);
    const type = at(result.tree.root, "a").type;
    if (type === undefined || type === "empty" || type.kind !== "ref") {
      throw new Error("expected a ref");
    }
    expect(type.declarations).toHaveLength(1);
    expect(type.declarations[0]?.layerRank).toBe(0);
  });
});

// --- §1 row 6: keys --------------------------------------------------------

describe("contract §1 row 6 — `keys` unites the names and intersects each", () => {
  it("the union of names across layers, each name's demand intersected", () => {
    const result = run(`keys:\n  a:\n    demand: { type: "string | int" }\n  b:\n    demand: { type: string }\n`, `keys:\n  b:\n    demand: { type: "string | int" }\n  c:\n    demand: { type: bool }\n`);
    expect([...result.tree.root.keys.keys()]).toEqual(["a", "b", "c"]);
    expect(at(result.tree.root, "b").type).toEqual({ kind: "builtin", name: "string", depth: 0 });
  });

  it("`keys` and `values` both covering one name compose by intersection (FR-011)", () => {
    const result = run(`keys:\n  m:\n    demand:\n      type: mapping\n      keys: { k: { demand: { type: "string | int" } } }\n      values: { type: string }\n`);
    const m = at(result.tree.root, "m");
    expect(at(m, "k").type).toEqual({ kind: "builtin", name: "string", depth: 0 });
    expect(m.values?.type).toEqual({ kind: "builtin", name: "string", depth: 0 });
  });

  it("nested `keys` recurse to arbitrary depth", () => {
    const result = run(`keys:\n  a:\n    demand:\n      type: mapping\n      keys:\n        b:\n          demand:\n            type: mapping\n            keys:\n              c: { demand: { type: int } }\n`);
    expect(at(result.tree.root, "a", "b", "c").type).toEqual({ kind: "builtin", name: "int", depth: 0 });
  });
});

// --- §1 row 7: values / items ---------------------------------------------

describe("contract §1 row 7 — `values` and `items` intersect", () => {
  it("two layers' `values` intersect", () => {
    const result = run(`keys:\n  m:\n    demand: { type: mapping, values: { type: "string | int" } }\n`, `keys:\n  m:\n    demand: { type: mapping, values: { type: int } }\n`);
    expect(at(result.tree.root, "m").values?.type).toEqual({ kind: "builtin", name: "int", depth: 0 });
  });

  it("two layers' `items` intersect", () => {
    const result = run(`keys:\n  s:\n    demand: { type: sequence, items: { type: "string | int" } }\n`, `keys:\n  s:\n    demand: { type: sequence, items: { type: string } }\n`);
    expect(at(result.tree.root, "s").items?.type).toEqual({ kind: "builtin", name: "string", depth: 0 });
  });

  it("§3 — `values` whose demand is itself `values` nests", () => {
    const result = run(`keys:\n  m:\n    demand:\n      type: mapping\n      values: { type: mapping, values: { type: string } }\n`);
    expect(at(result.tree.root, "m").values?.values?.type).toEqual({ kind: "builtin", name: "string", depth: 0 });
  });
});

// --- §1 row 8: required / provided ----------------------------------------

describe("contract §1 row 8 — `required` ORs; `provided` is recorded separately", () => {
  it("`required: true` in any layer makes the position required", () => {
    const result = run(`keys:\n  a:\n    demand: { type: string, required: true }\n`, `keys:\n  a:\n    demand: { type: string }\n`);
    expect(at(result.tree.root, "a").required).toBe(true);
    expect(keyOf(result.tree.root, "a").provided).toBe(false);
  });

  it("`required` in the LEAF alone is enough too — the OR is order-blind", () => {
    const result = run(`keys:\n  a:\n    demand: { type: string }\n`, `keys:\n  a:\n    demand: { type: string, required: true }\n`);
    expect(at(result.tree.root, "a").required).toBe(true);
  });

  it("a `provide` in any layer records `provided`, and does not make the position `required`", () => {
    const result = run(`keys:\n  a:\n    demand: { type: string }\n`, `keys:\n  a:\n    provide: "x"\n`);
    expect(keyOf(result.tree.root, "a").provided).toBe(true);
    expect(at(result.tree.root, "a").required).toBe(false);
  });

  it("neither required nor provided: both false", () => {
    const result = run(`keys:\n  a:\n    demand: { type: string }\n`);
    expect(at(result.tree.root, "a").required).toBe(false);
    expect(keyOf(result.tree.root, "a").provided).toBe(false);
  });
});

// --- §1 row 9: enum --------------------------------------------------------

describe("contract §1 row 9 — `enum` intersects as a set under §4.2's equality", () => {
  it("two layers' enums intersect, keeping the first-declaring layer's order", () => {
    const result = run(`keys:\n  a:\n    demand: { enum: [1, 2, 3] }\n`, `keys:\n  a:\n    demand: { enum: [3, 2, 4] }\n`);
    const members = at(result.tree.root, "a").enum;
    expect(members?.map((n) => (n.type === "scalar" ? String(n.value) : "?"))).toEqual(["2", "3"]);
  });

  it("kind is part of membership: `1` and `1.0` are different members (§4.2)", () => {
    const result = run(`keys:\n  a:\n    demand: { enum: [1, 1.0] }\n`, `keys:\n  a:\n    demand: { enum: [1.0] }\n`);
    const members = at(result.tree.root, "a").enum;
    expect(members).toHaveLength(1);
    expect(members?.[0]?.type === "scalar" ? members[0].kind : "?").toBe("float");
  });

  it("an `enum` in one layer alone yields an `enum` at the position", () => {
    const result = run(`keys:\n  a:\n    demand: { enum: ["x", "y"] }\n`, `keys:\n  a:\n    demand: { type: string }\n`);
    expect(at(result.tree.root, "a").enum).toHaveLength(2);
  });

  it("no `enum` anywhere leaves the position without one", () => {
    expect(at(run(`keys:\n  a:\n    demand: { type: string }\n`).tree.root, "a").enum).toBeUndefined();
  });

  it("two disjoint enums intersect to the empty set — recorded as an empty list, not as absence", () => {
    const result = run(`keys:\n  a:\n    demand: { enum: [1] }\n`, `keys:\n  a:\n    demand: { enum: [2] }\n`);
    expect(at(result.tree.root, "a").enum).toEqual([]);
  });
});

// --- §1 row 10: bounds, lengths, pattern, accept --------------------------

describe("contract §1 row 10 — bounds narrow, patterns accumulate, `accept` intersects", () => {
  it("`min`/`minLength` take the largest bound and `max`/`maxLength` the smallest", () => {
    const result = run(`keys:\n  a:\n    demand: { type: int, min: 1, max: 10, minLength: 1, maxLength: 10 }\n`, `keys:\n  a:\n    demand: { type: int, min: 5, max: 8, minLength: 3, maxLength: 7 }\n`);
    const constraints = at(result.tree.root, "a").constraints;
    const byKeyword = new Map(constraints.map((c) => [c.keyword, c]));
    expect(byKeyword.get("min")?.value).toBe("5");
    expect(byKeyword.get("max")?.value).toBe("8");
    expect(byKeyword.get("minLength")?.value).toBe("3");
    expect(byKeyword.get("maxLength")?.value).toBe("7");
    expect(byKeyword.get("min")?.layer.rank).toBe(1);
    expect(byKeyword.get("min")?.pointer).toBe("/keys/a/demand/min");
  });

  it("the winning bound may be the root's — the largest `min`, not the nearest layer's", () => {
    const result = run(`keys:\n  a:\n    demand: { type: int, min: 9 }\n`, `keys:\n  a:\n    demand: { type: int, min: 2 }\n`);
    const min = at(result.tree.root, "a").constraints.find((c) => c.keyword === "min");
    expect(min?.value).toBe("9");
    expect(min?.layer.rank).toBe(0);
  });

  it("every `pattern` is kept, in layer order", () => {
    const result = run(`keys:\n  a:\n    demand: { type: string, pattern: "^a" }\n`, `keys:\n  a:\n    demand: { type: string, pattern: "b$" }\n`);
    const patterns = at(result.tree.root, "a").constraints.filter((c) => c.keyword === "pattern");
    expect(patterns.map((c) => c.value)).toEqual(["^a", "b$"]);
    expect(patterns.map((c) => c.layer.rank)).toEqual([0, 1]);
  });

  it("`accept` intersects as a set of alternatives", () => {
    const result = run(`$id: core\ntypes:\n  r:\n    accept: [url, path]\n    demand: { type: string }\nkeys:\n  a:\n    demand: { type: r, accept: [url, path] }\n`, `keys:\n  a:\n    demand: { type: r, accept: [url] }\n`);
    expect(at(result.tree.root, "a").accept).toEqual(["url"]);
  });

  it("each constraint carries its declaring layer, its pointer, and its span", () => {
    const result = run(`keys:\n  a:\n    demand: { type: string, pattern: "^a" }\n`);
    const pattern = at(result.tree.root, "a").constraints.find((c) => c.keyword === "pattern");
    expect(pattern?.layer.identity.location).toBe("layer0.yaml");
    expect(pattern?.pointer).toBe("/keys/a/demand/pattern");
    expect(pattern?.span.origin.label).toBe("layer0.yaml");
    expect(pattern?.span.line).toBeGreaterThan(0);
  });
});

// --- §1 row 11: seal -------------------------------------------------------

describe("contract §1 row 11 — `seal` is closed if any layer closes the position", () => {
  it("closed in the root, open in the house: closed", () => {
    const result = run(`keys:\n  m:\n    demand: { type: mapping, seal: closed }\n`, `keys:\n  m:\n    demand: { type: mapping, seal: open }\n`);
    expect(at(result.tree.root, "m").seal).toBe("closed");
  });

  it("closed in the house, absent in the root: closed", () => {
    const result = run(`keys:\n  m:\n    demand: { type: mapping }\n`, `keys:\n  m:\n    demand: { type: mapping, seal: closed }\n`);
    expect(at(result.tree.root, "m").seal).toBe("closed");
  });

  it("declared nowhere: open", () => {
    expect(at(run(`keys:\n  m:\n    demand: { type: mapping }\n`).tree.root, "m").seal).toBe("open");
  });

  it("a schema's TOP-LEVEL `seal` governs the root position (FR-014)", () => {
    const result = run(`seal: closed\nkeys:\n  a:\n    demand: { type: string }\n`);
    expect(result.tree.root.seal).toBe("closed");
  });

  it("the top-level seal is closed if ANY layer closes it", () => {
    expect(run(`keys:\n  a:\n    demand: { type: string }\n`, `seal: closed\n`).tree.root.seal).toBe("closed");
    expect(run(`keys:\n  a:\n    demand: { type: string }\n`).tree.root.seal).toBe("open");
  });

  it("`seal` reaches a nested position too", () => {
    const result = run(`keys:\n  a:\n    demand:\n      type: mapping\n      keys:\n        b: { demand: { type: mapping, seal: closed } }\n`);
    expect(at(result.tree.root, "a", "b").seal).toBe("closed");
  });
});

// --- §1 row 12: the empty intersection and its lint -----------------------

describe("contract §1 row 12 / §2 — an empty intersection is recorded and reported", () => {
  const EMPTY = run(`keys:\n  a:\n    demand: { type: string }\n`, `keys:\n  a:\n    demand: { type: int }\n`);

  it("§3 — root `string`, house `int` ⇒ `type: \"empty\"`", () => {
    expect(at(EMPTY.tree.root, "a").type).toBe("empty");
  });

  it("exactly one `demand-unsatisfiable`, at `info` level", () => {
    expect(EMPTY.diagnostics).toHaveLength(1);
    expect(EMPTY.diagnostics[0]?.code).toBe("demand-unsatisfiable");
    expect(EMPTY.diagnostics[0]?.level).toBe("info");
  });

  it("it carries both demands' pointers, spans and layers (contract §2)", () => {
    const diagnostic = EMPTY.diagnostics[0];
    // The NEARER demand is the house's (rank 1); the FARTHER is the root's (rank 0).
    expect(diagnostic?.primary.origin.label).toBe("layer1.yaml");
    expect(diagnostic?.demand?.pointer).toBe("/keys/a/demand");
    expect(diagnostic?.demand?.span.origin.label).toBe("layer0.yaml");
    expect(diagnostic?.pedigreePosition).toBe(0);
    expect(diagnostic?.pointer).toBe("/keys/a/demand");
    expect(diagnostic?.related).toHaveLength(1);
    expect(diagnostic?.related[0]?.label).toBe("and this demand");
    expect(diagnostic?.related[0]?.span.origin.label).toBe("layer1.yaml");
  });

  it("a single layer that contradicts nothing raises no lint", () => {
    expect(run(`keys:\n  a:\n    demand: { type: string }\n`).diagnostics).toEqual([]);
  });

  it("the lint fires at a nested position too, and names that position's demands", () => {
    const result = run(`keys:\n  a:\n    demand: { type: mapping, keys: { b: { demand: { type: string } } } }\n`, `keys:\n  a:\n    demand: { type: mapping, keys: { b: { demand: { type: bool } } } }\n`);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["demand-unsatisfiable"]);
    expect(result.diagnostics[0]?.demand?.pointer).toBe("/keys/a/demand/keys/b/demand");
    expect(at(result.tree.root, "a", "b").type).toBe("empty");
  });
});

// --- §1 row 13: recursion --------------------------------------------------

describe("contract §1 row 13 — guarded recursion is a reference, never an unrolled body", () => {
  const RECURSIVE = `$id: core
types:
  node:
    demand:
      type: mapping
      keys: { child: { demand: { type: node } } }
      values: { type: node }
keys:
  root:
    demand: { type: node }
`;

  it("the recursive type terminates and the recursion is a ref back to the declaration", () => {
    const result = run(RECURSIVE);
    const declaration = result.tree.declarations.find((d) => d.declaration.name === "node");
    expect(declaration).toBeDefined();
    const childType = at(declaration?.body ?? result.tree.root, "child").type;
    if (childType === undefined || childType === "empty" || childType.kind !== "ref") {
      throw new Error("expected a ref");
    }
    expect(childType.declarations[0]).toBe(declaration?.declaration);
  });

  it("the body is not unrolled: the child's position is the SAME object the ref names, not a copy", () => {
    const result = run(RECURSIVE);
    const declaration = result.tree.declarations.find((d) => d.declaration.name === "node");
    const child = at(declaration?.body ?? result.tree.root, "child");
    // A ref, so the child position carries no `keys` of its own — an
    // unrolled body would have `child` and a `values` beneath it.
    expect(child.keys.size).toBe(0);
    expect(child.values).toBeUndefined();
  });

  it("an UNGUARDED cycle is refused by v0.5's `unresolvable-type-cycle` before this stage ever runs (FR-005)", () => {
    const layers = chain(`types:\n  a:\n    demand: { type: b }\n  b:\n    demand: { type: a }\nkeys:\n  k:\n    demand: { type: a }\n`);
    const declarations = layers.flatMap((layer) => [...readTypeDeclarations(layer).declarations]);
    const cycles = cycleDiagnostics(declarations);
    expect(cycles.map((d) => d.code)).toEqual(["unresolvable-type-cycle"]);
    // And, belt and braces, accumulate() itself still terminates on it.
    expect(() => accumulate(layers)).not.toThrow();
  });
});

// --- §1 row 15: determinism ------------------------------------------------

describe("contract §1 row 15 — the tree is deterministic", () => {
  const A = `$id: core
types:
  alpha: { demand: { type: string } }
  beta: { demand: { type: int } }
keys:
  one: { demand: { type: alpha } }
  two: { demand: { type: beta } }
`;
  const B = `$id: core
types:
  beta: { demand: { type: int } }
  alpha: { demand: { type: string } }
keys:
  two: { demand: { type: beta } }
  one: { demand: { type: alpha } }
`;

  it("reordering the declarations within a layer changes nothing (FR-007)", () => {
    expect(fingerprint(run(B).tree)).toBe(fingerprint(run(A).tree));
  });

  it("accumulating the same chain twice yields the identical tree", () => {
    expect(fingerprint(run(A).tree)).toBe(fingerprint(run(A).tree));
  });
});

// --- §1 row 17: the pinned constant ---------------------------------------

describe("contract §1 row 17 — `final: true` with a scalar `provide` records the constant", () => {
  it("a scalar provide under `final` is the pinned constant", () => {
    const result = run(`keys:\n  k:\n    final: true\n    provide: "x"\n    demand: { type: string }\n`);
    const key = keyOf(result.tree.root, "k");
    expect(key.provided).toBe(true);
    expect(key.constant?.type).toBe("scalar");
    expect(key.constant?.value).toBe("x");
  });

  it("a NON-scalar provide under `final` records `provided` only, never a constant", () => {
    const result = run(`keys:\n  k:\n    final: true\n    provide: { a: 1 }\n    demand: { type: mapping }\n`);
    const key = keyOf(result.tree.root, "k");
    expect(key.provided).toBe(true);
    expect(key.constant).toBeUndefined();
  });

  it("a scalar provide WITHOUT `final` is not a constant — it is a default the config may replace", () => {
    const result = run(`keys:\n  k:\n    provide: "x"\n    demand: { type: string }\n`);
    expect(keyOf(result.tree.root, "k").constant).toBeUndefined();
    expect(keyOf(result.tree.root, "k").provided).toBe(true);
  });
});

// --- §3: the edge-case table ----------------------------------------------

describe("contract §3 — the edge cases", () => {
  it("one layer: that layer's demands, no intersection performed", () => {
    const result = run(`keys:\n  a:\n    demand: { type: "string | int" }\n`);
    expect(at(result.tree.root, "a").type).toEqual({
      kind: "union",
      alternatives: [
        { kind: "builtin", name: "int", depth: 0 },
        { kind: "builtin", name: "string", depth: 0 },
      ],
    });
  });

  it("a leaf schema declaring nothing: the ancestors' demands, `rootName` from the leaf's `$id`", () => {
    const result = run(`$id: vendor/core\nkeys:\n  a:\n    demand: { type: string }\n`, `$id: acme/house\n`);
    expect(at(result.tree.root, "a").type).toEqual({ kind: "builtin", name: "string", depth: 0 });
    expect(result.tree.rootName).toBe("house");
  });

  it("a leaf with no `$id` at all: the root is named `Configuration` (FR-031)", () => {
    expect(run(`keys:\n  a:\n    demand: { type: string }\n`).tree.rootName).toBe("Configuration");
  });

  it("an explicit `rootName` option wins over both", () => {
    expect(accumulate(chain(`$id: vendor/core\n`), { rootName: "MyConfig" }).tree.rootName).toBe("MyConfig");
  });

  it("`keys: {}`: a position with no keys, `seal` as declared", () => {
    const open = run(`keys:\n  m:\n    demand: { type: mapping, keys: {} }\n`);
    const closed = run(`keys:\n  m:\n    demand: { type: mapping, keys: {}, seal: closed }\n`);
    expect(at(open.tree.root, "m").keys.size).toBe(0);
    expect(at(open.tree.root, "m").seal).toBe("open");
    expect(at(closed.tree.root, "m").keys.size).toBe(0);
    expect(at(closed.tree.root, "m").seal).toBe("closed");
  });

  it("`seal: closed` with no `keys` at all: closed, no keys", () => {
    const result = run(`keys:\n  m:\n    demand: { type: mapping, seal: closed }\n`);
    expect(at(result.tree.root, "m").seal).toBe("closed");
    expect(at(result.tree.root, "m").keys.size).toBe(0);
  });

  it("`provide` with no demand: the key is present, `type` undefined, `provided` true", () => {
    const result = run(`keys:\n  k:\n    provide: "x"\n`);
    const key = keyOf(result.tree.root, "k");
    expect(key.provided).toBe(true);
    expect(key.position.type).toBeUndefined();
    expect(key.position.required).toBe(false);
  });

  it("`required: true` with no `type`: required, `type` undefined", () => {
    const result = run(`keys:\n  a:\n    demand: { required: true }\n`);
    expect(at(result.tree.root, "a").required).toBe(true);
    expect(at(result.tree.root, "a").type).toBeUndefined();
  });

  it("a key neither demanded nor provided by any layer is absent from the tree", () => {
    const result = run(`keys:\n  a:\n    demand: { type: string }\n`);
    expect(result.tree.root.keys.has("nowhere")).toBe(false);
  });
});

// --- §3: the meta-schema ---------------------------------------------------

describe("contract §3 — the meta-schema accumulates to six declarations with mutual recursion", () => {
  const META = accumulate([schemaLayer("cascata.meta.yaml", 0, readFileSync(join(REPO_ROOT, "meta", "cascata.meta.yaml"), "utf-8"))]);

  it("six declarations, in a deterministic order", () => {
    expect(META.tree.declarations.map((d) => d.declaration.name)).toEqual(["demand", "keyDecl", "nestedKeyDecl", "typeDecl", "typeExpr", "typeName"]);
  });

  it("each is declared once in the chain, so each keeps its bare name", () => {
    expect(META.tree.declarations.map((d) => d.emittedName)).toEqual(["demand", "keyDecl", "nestedKeyDecl", "typeDecl", "typeExpr", "typeName"]);
  });

  it("`demand` reaches `nestedKeyDecl`, and `nestedKeyDecl` reaches `demand` — a mutual, guarded recursion carried as refs", () => {
    const demand = META.tree.declarations.find((d) => d.declaration.name === "demand");
    const nested = META.tree.declarations.find((d) => d.declaration.name === "nestedKeyDecl");
    if (demand === undefined || nested === undefined) {
      throw new Error("expected both declarations");
    }
    // demand.keys.keys is `{ type: mapping, values: { type: nestedKeyDecl } }`
    const demandKeysValues = at(demand.body, "keys").values;
    expect(demandKeysValues?.type).toMatchObject({ kind: "ref", depth: 0 });
    const toNested = demandKeysValues?.type;
    if (toNested === undefined || toNested === "empty" || toNested.kind !== "ref") {
      throw new Error("expected a ref to nestedKeyDecl");
    }
    expect(toNested.declarations[0]?.name).toBe("nestedKeyDecl");
    // nestedKeyDecl.keys.demand is `{ type: demand }`
    const backToDemand = at(nested.body, "demand").type;
    if (backToDemand === undefined || backToDemand === "empty" || backToDemand.kind !== "ref") {
      throw new Error("expected a ref to demand");
    }
    expect(backToDemand.declarations[0]?.name).toBe("demand");
  });

  it("`demand` is self-recursive through `items` and `values`", () => {
    const demand = META.tree.declarations.find((d) => d.declaration.name === "demand");
    if (demand === undefined) {
      throw new Error("expected the demand declaration");
    }
    for (const keyName of ["items", "values"]) {
      const type = at(demand.body, keyName).type;
      if (type === undefined || type === "empty" || type.kind !== "ref") {
        throw new Error(`expected a ref at ${keyName}`);
      }
      expect(type.declarations[0]).toBe(demand.declaration);
    }
  });

  it("the meta-schema's own top level is sealed closed, with five keys", () => {
    expect(META.tree.root.seal).toBe("closed");
    expect([...META.tree.root.keys.keys()]).toEqual(["authority", "directives", "keys", "seal", "types"]);
  });

  it("the meta-schema's root name comes from its `$id` qualifier", () => {
    expect(META.tree.rootName).toBe("meta");
  });

  it("accumulating the meta-schema raises no lint", () => {
    expect(META.diagnostics).toEqual([]);
  });
});

// --- §1 row 14 / FR-006: the composition bound (T005) ---------------------

describe("contract §1 row 14 / FR-006 — `keys` + `values` over a shared type is polynomial", () => {
  /**
   * The shape v1.0's own `composition-bound.test.ts` found exponential in
   * the *value* walk, restated with no value at all: at every level, `keys`
   * names one child and `values` covers every entry, and **both** name the
   * same type. Two positions per level (the named child and the index
   * signature) each reach the next declaration, so an implementation that
   * expands a reference instead of recording one is 2^depth.
   *
   * Two layers, not one, and deliberately: a reference to a *single*
   * declaration is a leaf (it emits an alias), so the only shape that can
   * blow up is a reference to a declaration **set**, which is what a
   * narrowing chain produces. Every level here is a two-declaration set.
   *
   * A **ratio** across depths, never a wall-clock threshold: scaling is a
   * fact about the algorithm, milliseconds a fact about the machine.
   */
  function nestedChain(depth: number): string {
    const lines: string[] = ["types:"];
    for (let level = 0; level < depth; level += 1) {
      lines.push(`  n${level}:`);
      lines.push("    demand:");
      lines.push("      type: mapping");
      lines.push(`      keys: { child: { demand: { type: n${level + 1} } } }`);
      lines.push(`      values: { type: n${level + 1} }`);
    }
    lines.push(`  n${depth}:`);
    lines.push("    demand: { type: string }");
    lines.push("keys:");
    lines.push("  root: { demand: { type: n0 } }");
    return `${lines.join("\n")}\n`;
  }

  function timeOf(depth: number, runs: number): number {
    let best = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const text = nestedChain(depth);
      const layerSets = Array.from({ length: runs }, () => chain(text, text));
      const start = performance.now();
      for (const layers of layerSets) {
        accumulate(layers);
      }
      best = Math.min(best, performance.now() - start);
    }
    return best;
  }

  it("depths 10, 15, 18 and 24 scale by a ratio, not by a power", () => {
    const d10 = timeOf(10, 20);
    const d15 = timeOf(15, 20);
    const d18 = timeOf(18, 20);
    const d24 = timeOf(24, 20);
    // 10 → 24 is fourteen extra levels. Exponentially that is 2^14 = 16384×.
    // Polynomially it is a small multiple of the depth ratio (2.4×). The
    // bound asserted is 40× — well over two orders of magnitude of headroom
    // for a loaded machine, and still two orders below the exponential.
    expect(d24 / Math.max(d10, 0.01), `d10=${d10.toFixed(1)}ms d15=${d15.toFixed(1)}ms d18=${d18.toFixed(1)}ms d24=${d24.toFixed(1)}ms`).toBeLessThan(40);
    expect(d18 / Math.max(d10, 0.01)).toBeLessThan(40);
  }, 120_000);

  it("the deep chain terminates and produces one declaration per named type", () => {
    const text = nestedChain(24);
    const result = accumulate(chain(text, text));
    // 25 names × 2 layers = 50 declarations, every one emitted.
    expect(result.tree.declarations).toHaveLength(50);
  }, 60_000);

  it("a two-declaration set that re-enters itself terminates and stays a reference", () => {
    const text = `types:
  node:
    demand:
      type: mapping
      keys: { child: { demand: { type: node } } }
      values: { type: node }
keys:
  root: { demand: { type: node } }
`;
    const result = accumulate(chain(text, text));
    const rootType = at(result.tree.root, "root").type;
    if (rootType === undefined || rootType === "empty" || rootType.kind !== "ref") {
      throw new Error("expected a ref");
    }
    // Both layers restate `root`, and each resolves `node` in its own
    // scope, so the set carries both declarations (contract §1 row 5).
    expect(rootType.declarations.map((d) => d.layerRank)).toEqual([0, 1]);
    const intersection = result.tree.intersections.get(rootType.declarations.map((d) => `${d.layerRank}:${d.name}`).join("&"));
    expect(intersection).toBeDefined();
    expect(intersection?.recursive).toBe(true);
  }, 60_000);
});
