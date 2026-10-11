/**
 * Direct, hand-constructed coverage of src/merge/fold.ts — tasks.md
 * T018-T023. Complements tests/corpus/merge-corpus.test.ts (which drives
 * the fold through real `resolve()`d YAML documents) with cases built
 * straight from `src/model/node.ts` factories and hand-built `Layer`s, no
 * I/O at all — the same posture quickstart.md describes ("merge is a
 * function of what resolution already produced, so its own tests need
 * neither [network nor filesystem]").
 *
 * This is also the sabotage-tested guard for T019 (deep merge is for
 * mappings only) and T022 (merged node spans) — see the milestone report
 * for the actual sabotage runs performed against this file.
 */

import { describe, expect, it } from "vitest";
import { createBoolScalar, createIntScalar, createMapping, createNullScalar, createSequence, createStringScalar, type Node } from "../../src/model/node.js";
import { createOrigin, createSourceSpan, type SourceSpan } from "../../src/model/span.js";
import { deriveLayers, fold } from "../../src/merge/fold.js";
import { resolveStrategies } from "../../src/merge/strategy.js";
import type { Layer } from "../../src/merge/provenance.js";
import type { Graph, GraphDocument } from "../../src/graph/build.js";

function origin(id: string): ReturnType<typeof createOrigin> {
  return createOrigin(id, id);
}

function span(id: string, start: number, end: number, line = 1, column = 1): SourceSpan {
  return createSourceSpan({ origin: origin(id), start, end, line, column, documentLength: 10_000 });
}

/** Build a schema Layer from a hand-written `keys:` mapping (already shaped as a Node tree). */
function schemaLayer(id: string, rank: number, keysEntries: readonly (readonly [string, Node])[]): Layer {
  const tree = createMapping([["keys", createMapping(keysEntries, span(id, 0, 1))]], span(id, 0, 1));
  return { identity: { location: id, physical: id, hash: "0".repeat(64) }, role: "schema", rank, tree };
}

/** Build a config Layer directly from a Node (typically a mapping). */
function configLayer(id: string, rank: number, tree: Node): Layer {
  return { identity: { location: id, physical: id, hash: "0".repeat(64) }, role: "config", rank, tree };
}

/** A `keys.<name>: { provide: <value> }` entry, for building a schema's `keys:` mapping. */
function providing(name: string, value: Node, declSpan: SourceSpan): [string, Node] {
  return [name, createMapping([["provide", value]], declSpan)];
}

/** A `keys.<name>: { cascade: <strategy>[, provide: <value>] }` entry. `cascadeSpan` is the position asserted by `cascade-strategy-weakened` (contracts/diagnostics.md: "the descendant's declaration"). */
function declaringCascade(name: string, strategy: "append" | "replace", cascadeSpan: SourceSpan, provide?: readonly [Node, SourceSpan]): [string, Node] {
  const entries: [string, Node][] = [["cascade", createStringScalar(strategy, cascadeSpan)]];
  if (provide !== undefined) {
    entries.push(["provide", provide[0]]);
  }
  return [name, createMapping(entries, provide === undefined ? cascadeSpan : provide[1])];
}

describe("fold() — precedence rules (contracts/precedence.md), hand-constructed", () => {
  it("rule 1 + rule 6: a provide fills silence; a nearer explicit value beats it", () => {
    const schema = schemaLayer("schema", 0, [
      providing("a", createStringScalar("from-schema", span("schema", 10, 21)), span("schema", 5, 25)),
      providing("b", createStringScalar("also-from-schema", span("schema", 30, 47)), span("schema", 25, 50)),
    ]);
    const config = configLayer(
      "config",
      1,
      createMapping([["a", createStringScalar("from-config", span("config", 0, 11))]], span("config", 0, 11)),
    );

    const result = fold([schema, config]);
    expect(result.type).toBe("mapping");
    if (result.type !== "mapping") throw new Error("unreachable");
    expect(result.entries.get("a")).toMatchObject({ kind: "string", value: "from-config" });
    expect(result.entries.get("b")).toMatchObject({ kind: "string", value: "also-from-schema" });
  });

  it("rule 2: mappings on both sides merge deeply, key by key, and the merged mapping's OWN span is the nearer (contributing) layer's — not just its leaf values' spans", () => {
    const configNetSpan = span("config", 200, 240, 9, 1);
    const schema = schemaLayer("schema", 0, [
      providing(
        "net",
        createMapping(
          [
            ["host", createStringScalar("schema-host", span("schema", 0, 1))],
            ["timeout", createIntScalar(30n, span("schema", 1, 2))],
          ],
          span("schema", 0, 2),
        ),
        span("schema", 0, 2),
      ),
    ]);
    const config = configLayer(
      "config",
      1,
      createMapping(
        [
          [
            "net",
            createMapping(
              [
                ["timeout", createIntScalar(60n, span("config", 0, 1))],
                ["retries", createIntScalar(3n, span("config", 1, 2))],
              ],
              configNetSpan,
            ),
          ],
        ],
        span("config", 0, 2),
      ),
    );

    const result = fold([schema, config]);
    if (result.type !== "mapping") throw new Error("unreachable");
    const net = result.entries.get("net");
    if (net === undefined || net.type !== "mapping") throw new Error("expected /net to be a mapping");
    expect(net.entries.get("host")).toMatchObject({ kind: "string", value: "schema-host" });
    expect(net.entries.get("timeout")).toMatchObject({ kind: "int", value: 60n });
    expect(net.entries.get("retries")).toMatchObject({ kind: "int", value: 3n });
    // Research D4: the merged /net mapping's own span is config's (the
    // nearer, contributing layer) — not schema's, and not some synthetic
    // combination of both. This is the assertion the T022 sabotage run
    // (see the milestone report) found missing on the first pass: every
    // other assertion here only checks *leaf* spans, which a wrong
    // container-span rule cannot break.
    expect(net.span).toBe(configNetSpan);
  });

  it("rule 3: a sequence over a sequence replaces wholesale — never merges element-wise", () => {
    const schema = schemaLayer("schema", 0, [
      providing(
        "items",
        createSequence([createStringScalar("a", span("schema", 0, 1)), createStringScalar("b", span("schema", 1, 2))], span("schema", 0, 2)),
        span("schema", 0, 2),
      ),
    ]);
    const config = configLayer(
      "config",
      1,
      createMapping([["items", createSequence([createStringScalar("x", span("config", 0, 1))], span("config", 0, 1))]], span("config", 0, 1)),
    );

    const result = fold([schema, config]);
    if (result.type !== "mapping") throw new Error("unreachable");
    const items = result.entries.get("items");
    if (items === undefined || items.type !== "sequence") throw new Error("expected /items to be a sequence");
    // The defining assertion: length 1 (config's alone), NOT 3 (a, b concatenated with x)
    // and NOT 2 (element-wise merged) — wholesale replacement, full stop.
    expect(items.items).toHaveLength(1);
    expect(items.items[0]).toMatchObject({ kind: "string", value: "x" });
  });

  it("rule 3: a scalar over a mapping replaces wholesale, and a mapping over a scalar replaces wholesale (both directions)", () => {
    const schemaA = schemaLayer("schema-a", 0, [
      providing("k", createMapping([["x", createIntScalar(1n, span("schema-a", 0, 1))]], span("schema-a", 0, 1)), span("schema-a", 0, 1)),
    ]);
    const configA = configLayer("config-a", 1, createMapping([["k", createStringScalar("scalar-wins", span("config-a", 0, 1))]], span("config-a", 0, 1)));
    const resultA = fold([schemaA, configA]);
    if (resultA.type !== "mapping") throw new Error("unreachable");
    expect(resultA.entries.get("k")).toMatchObject({ kind: "string", value: "scalar-wins" });

    const schemaB = schemaLayer("schema-b", 0, [providing("k", createStringScalar("scalar-default", span("schema-b", 0, 1)), span("schema-b", 0, 1))]);
    const configB = configLayer(
      "config-b",
      1,
      createMapping([["k", createMapping([["y", createIntScalar(2n, span("config-b", 0, 1))]], span("config-b", 0, 1))]], span("config-b", 0, 1)),
    );
    const resultB = fold([schemaB, configB]);
    if (resultB.type !== "mapping") throw new Error("unreachable");
    const k = resultB.entries.get("k");
    if (k === undefined || k.type !== "mapping") throw new Error("expected mapping to win");
    expect(k.entries.get("y")).toMatchObject({ kind: "int", value: 2n });
  });

  it("rule 5: an explicit null replaces a provided value — it is a value, not an absence", () => {
    const schema = schemaLayer("schema", 0, [providing("title", createStringScalar("Default", span("schema", 0, 1)), span("schema", 0, 1))]);
    const config = configLayer("config", 1, createMapping([["title", createNullScalar(span("config", 0, 1))]], span("config", 0, 1)));
    const result = fold([schema, config]);
    if (result.type !== "mapping") throw new Error("unreachable");
    expect(result.entries.get("title")).toMatchObject({ kind: "null", value: null });
  });

  it("rule 6: a layer silent on a key neither overrides nor clears it — a middle schema contributing nothing does not erase the root's provide", () => {
    const root = schemaLayer("root", 0, [providing("a", createStringScalar("root-value", span("root", 0, 1)), span("root", 0, 1))]);
    const middle = schemaLayer("middle", 1, []); // declares no keys at all
    const config = configLayer("config", 2, createMapping([], span("config", 0, 1)));
    const result = fold([root, middle, config]);
    if (result.type !== "mapping") throw new Error("unreachable");
    expect(result.entries.get("a")).toMatchObject({ kind: "string", value: "root-value" });
  });

  it("FR-009: a single-layer fold (config alone) is the identity", () => {
    const tree = createMapping([["x", createBoolScalar(true, span("config", 0, 1))]], span("config", 0, 1));
    const config = configLayer("config", 0, tree);
    const result = fold([config]);
    expect(result).toBe(tree);
  });
});

describe("fold() — span rule (research D4): the nearest contributing layer's own span survives", () => {
  it("a key only one layer ever touches keeps that layer's own real span, however deep", () => {
    const providedSpan = span("root", 100, 120, 7, 3);
    const root = schemaLayer("root", 0, [providing("untouched", createStringScalar("v", providedSpan), span("root", 0, 1))]);
    const config = configLayer("config", 1, createMapping([], span("config", 0, 1)));
    const result = fold([root, config]);
    if (result.type !== "mapping") throw new Error("unreachable");
    const node = result.entries.get("untouched");
    expect(node?.span).toBe(providedSpan);
  });

  it("a wholesale-replaced value carries the winner's own span, not a synthetic one", () => {
    const configSpan = span("config", 55, 66, 4, 9);
    const schema = schemaLayer("schema", 0, [providing("k", createStringScalar("default", span("schema", 0, 1)), span("schema", 0, 1))]);
    const config = configLayer("config", 1, createMapping([["k", createStringScalar("override", configSpan)]], span("config", 0, 1)));
    const result = fold([schema, config]);
    if (result.type !== "mapping") throw new Error("unreachable");
    expect(result.entries.get("k")?.span).toBe(configSpan);
  });
});

describe("fold() — rule 4: cascade: append (T029-T032), hand-constructed", () => {
  it("accumulates root-first across three layers, and the appended sequence's own span is the nearest contributor's (research D4)", () => {
    const rootItemsSpan = span("root", 10, 20, 2, 3);
    const midItemsSpan = span("mid", 10, 20, 2, 3);
    const configItemsSpan = span("config", 10, 20, 2, 3);
    const root = schemaLayer("root", 0, [
      declaringCascade("items", "append", span("root", 0, 1), [createSequence([createStringScalar("root-a", span("root", 1, 2))], rootItemsSpan), rootItemsSpan]),
    ]);
    const mid = schemaLayer("mid", 1, [providing("items", createSequence([createStringScalar("mid-a", span("mid", 1, 2))], midItemsSpan), midItemsSpan)]);
    const config = configLayer("config", 2, createMapping([["items", createSequence([createStringScalar("config-a", span("config", 1, 2))], configItemsSpan)]], span("config", 0, 1)));

    const { diagnostics } = resolveStrategies([root, mid, config]);
    expect(diagnostics).toEqual([]);
    const result = fold([root, mid, config]);
    if (result.type !== "mapping") throw new Error("unreachable");
    const items = result.entries.get("items");
    if (items === undefined || items.type !== "sequence") throw new Error("expected /items to be a sequence");
    expect(items.items.map((n) => (n.type === "scalar" ? n.value : undefined))).toEqual(["root-a", "mid-a", "config-a"]);
    // D4: "for an appended sequence, the nearest contributor's" span — the
    // nearest (last) contributor here is config, not root and not some
    // synthetic combination.
    expect(items.span).toBe(configItemsSpan);
  });

  it("a layer contributing nothing to an append key removes nothing, and does not appear as a gap (FR-012)", () => {
    const root = schemaLayer("root", 0, [declaringCascade("items", "append", span("root", 0, 1), [createSequence([createStringScalar("root-a", span("root", 1, 2))], span("root", 1, 3)), span("root", 1, 3)])]);
    const silentMiddle = schemaLayer("middle", 1, []); // declares nothing about "items" at all
    const config = configLayer("config", 2, createMapping([["items", createSequence([createStringScalar("config-a", span("config", 1, 2))], span("config", 1, 3))]], span("config", 0, 1)));

    const result = fold([root, silentMiddle, config]);
    if (result.type !== "mapping") throw new Error("unreachable");
    const items = result.entries.get("items");
    if (items === undefined || items.type !== "sequence") throw new Error("expected /items to be a sequence");
    expect(items.items.map((n) => (n.type === "scalar" ? n.value : undefined))).toEqual(["root-a", "config-a"]);
  });

  it("a key with no declared strategy defaults to replace, even for sequence values (FR-011)", () => {
    const schema = schemaLayer("schema", 0, [providing("items", createSequence([createStringScalar("schema-a", span("schema", 1, 2))], span("schema", 1, 3)), span("schema", 1, 3))]);
    const config = configLayer("config", 1, createMapping([["items", createSequence([createStringScalar("config-a", span("config", 1, 2))], span("config", 1, 3))]], span("config", 0, 1)));

    const { strategies } = resolveStrategies([schema, config]);
    expect(strategies.size).toBe(0); // nothing declared cascade at all
    const result = fold([schema, config]);
    if (result.type !== "mapping") throw new Error("unreachable");
    const items = result.entries.get("items");
    if (items === undefined || items.type !== "sequence") throw new Error("expected /items to be a sequence");
    // Replace-wholesale: config's alone, length 1 — NOT accumulated to length 2.
    expect(items.items).toHaveLength(1);
    expect(items.items[0]).toMatchObject({ kind: "string", value: "config-a" });
  });

  it("tightening replace -> append at the SECOND layer includes the first (base) layer's item too — not because 'append governs the whole key uniformly' (that reading was superseded, v0.3 FR-026/T034), but because root is the fold's base case: nothing precedes it to be replaced before append ever takes effect", () => {
    const root = schemaLayer("root", 0, [declaringCascade("items", "replace", span("root", 0, 1), [createSequence([createStringScalar("root-a", span("root", 1, 2))], span("root", 1, 3)), span("root", 1, 3)])]);
    const mid = schemaLayer("mid", 1, [declaringCascade("items", "append", span("mid", 0, 1), [createSequence([createStringScalar("mid-a", span("mid", 1, 2))], span("mid", 1, 3)), span("mid", 1, 3)])]);
    const config = configLayer("config", 2, createMapping([["items", createSequence([createStringScalar("config-a", span("config", 1, 2))], span("config", 1, 3))]], span("config", 0, 1)));

    const { strategies, diagnostics } = resolveStrategies([root, mid, config]);
    expect(diagnostics).toEqual([]);
    expect(strategies.get("items")).toBe("append");
    const result = fold([root, mid, config]);
    if (result.type !== "mapping") throw new Error("unreachable");
    const items = result.entries.get("items");
    if (items === undefined || items.type !== "sequence") throw new Error("expected /items to be a sequence");
    // Root is the very first layer overall (the fold's base case — nothing
    // to merge against yet), so its item enters the accumulated result
    // unconditionally; mid tightens to append on its OWN turn, immediately
    // accumulating onto root's item rather than replacing it. Contrast
    // tasks.md T029's discriminating case (tests/corpus/merge-cases/
    // T029-late-append-declaration.json): there, TWO no-strategy layers
    // precede the append declaration, so the first is genuinely replaced
    // by the second before append ever applies, and is correctly absent
    // from the result.
    expect(items.items.map((n) => (n.type === "scalar" ? n.value : undefined))).toEqual(["root-a", "mid-a", "config-a"]);
  });

  it("T029/v0.3 FR-026: a leaf's late append declaration governs from itself downward, not back over a middle layer's settled replace — root [a], middle (no strategy) [b], leaf declares append and provides [c] folds to [b, c], not [a, b, c]", () => {
    const root = schemaLayer("root", 0, [providing("items", createSequence([createStringScalar("root-a", span("root", 1, 2))], span("root", 1, 3)), span("root", 1, 3))]);
    const middle = schemaLayer("mid", 1, [providing("items", createSequence([createStringScalar("mid-b", span("mid", 1, 2))], span("mid", 1, 3)), span("mid", 1, 3))]);
    const leaf = schemaLayer("leaf", 2, [
      declaringCascade("items", "append", span("leaf", 0, 1), [createSequence([createStringScalar("leaf-c", span("leaf", 1, 2))], span("leaf", 1, 3)), span("leaf", 1, 3)]),
    ]);
    const config = configLayer("config", 3, createMapping([], span("config", 0, 1))); // silent — the leaf schema's own provide is what contributes "c"

    const { diagnostics } = resolveStrategies([root, middle, leaf, config]);
    expect(diagnostics).toEqual([]);
    const result = fold([root, middle, leaf, config]);
    if (result.type !== "mapping") throw new Error("unreachable");
    const items = result.entries.get("items");
    if (items === undefined || items.type !== "sequence") throw new Error("expected /items to be a sequence");
    // Middle's own turn merges under the still-default "replace" (root
    // declared nothing), so root's "a" is genuinely discarded there —
    // BEFORE the leaf ever declares append. The leaf's declaration then
    // accumulates its own "c" onto whatever the fold had already produced
    // (middle's "b"), never reaching back over the replace that already
    // happened.
    expect(items.items.map((n) => (n.type === "scalar" ? n.value : undefined))).toEqual(["mid-b", "leaf-c"]);
  });

  it("weakening append -> replace is refused as cascade-strategy-weakened, at the descendant's own declared position (v0.3 FR-016)", () => {
    const declSpan = span("mid", 5, 12, 3, 5);
    const root = schemaLayer("root", 0, [declaringCascade("items", "append", span("root", 0, 1), [createSequence([createStringScalar("root-a", span("root", 1, 2))], span("root", 1, 3)), span("root", 1, 3)])]);
    const mid = schemaLayer("mid", 1, [declaringCascade("items", "replace", declSpan)]);

    const { strategies, diagnostics } = resolveStrategies([root, mid]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("cascade-strategy-weakened");
    expect(diagnostics[0]?.primary).toBe(declSpan);
    // strategies still resolves to "append" — the refusal does not silently
    // let the weakening declaration win.
    expect(strategies.get("items")).toBe("append");
  });

  it("restating the same strategy twice is legal and vacuous — no diagnostic, no change", () => {
    const root = schemaLayer("root", 0, [declaringCascade("items", "append", span("root", 0, 1))]);
    const mid = schemaLayer("mid", 1, [declaringCascade("items", "append", span("mid", 0, 1))]);
    const { strategies, diagnostics } = resolveStrategies([root, mid]);
    expect(diagnostics).toEqual([]);
    expect(strategies.get("items")).toBe("append");
  });

  it("a config's own cascade declaration is never read (FR-015) — even a config declaring append cannot make a key accumulate", () => {
    const schema = schemaLayer("schema", 0, [providing("items", createSequence([createStringScalar("schema-a", span("schema", 1, 2))], span("schema", 1, 3)), span("schema", 1, 3))]);
    const configTree = createMapping(
      [["keys", createMapping([declaringCascade("items", "append", span("config", 0, 1))], span("config", 0, 2))], ["items", createSequence([createStringScalar("config-a", span("config", 1, 2))], span("config", 1, 3))]],
      span("config", 0, 3),
    );
    const config = configLayer("config", 1, configTree);
    const { strategies, diagnostics } = resolveStrategies([schema, config]);
    expect(diagnostics).toEqual([]);
    expect(strategies.size).toBe(0); // the config's "keys.items.cascade: append" was never even read
  });
});

describe("deriveLayers() — ranking a Graph (T010, FR-005)", () => {
  function stubDocument(id: string, tree: Node): GraphDocument {
    return { identity: { location: id, physical: id, hash: "0".repeat(64) }, tree, verified: false };
  }

  it("ranks root schema lowest and config highest, with dense sequential ranks", () => {
    const entry = stubDocument("config.yaml", createMapping([], span("config.yaml", 0, 1)));
    // graph.documents is in discovery (leaf-to-root) order: entry, then the
    // nearest schema, then progressively further ancestors.
    const leafSchema = stubDocument("schema-leaf.yaml", createMapping([], span("schema-leaf.yaml", 0, 1)));
    const rootSchema = stubDocument("schema-root.yaml", createMapping([], span("schema-root.yaml", 0, 1)));
    const graph: Graph = { entry, documents: [entry, leafSchema, rootSchema] };

    const layers = deriveLayers(graph);
    expect(layers.map((l) => l.identity.location)).toEqual(["schema-root.yaml", "schema-leaf.yaml", "config.yaml"]);
    expect(layers.map((l) => l.rank)).toEqual([0, 1, 2]);
    expect(layers.map((l) => l.role)).toEqual(["schema", "schema", "config"]);
    expect(layers[layers.length - 1]?.role).toBe("config");
  });

  it("a single-document graph (no schema) produces exactly one, config-role layer", () => {
    const entry = stubDocument("config.yaml", createMapping([], span("config.yaml", 0, 1)));
    const graph: Graph = { entry, documents: [entry] };
    const layers = deriveLayers(graph);
    expect(layers).toHaveLength(1);
    expect(layers[0]?.role).toBe("config");
    expect(layers[0]?.rank).toBe(0);
  });
});
