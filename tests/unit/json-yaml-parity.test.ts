/**
 * Adapter parity — v1.2 (specs/011-json-adapter FR-021, SC-003).
 *
 * §3 has said since v0.1 that everything from graph-build onward is
 * format-blind, and that "a fragment may be in a different format than its
 * parent" is therefore trivially true rather than a feature someone has to
 * build. With one adapter that was an architectural claim nobody could
 * check. This file is the check: three documents, each written twice, once
 * as `.json` and once as `.yaml`, resolved through the **real**
 * `resolve()` — extension selection, host seam and all — and asserted
 * model-equal.
 *
 * `nodesEqual` and not `identicalTrees` is the right comparison, and the
 * distinction is the whole point: the two documents are *different bytes*,
 * so their spans differ and must. §4.2's single definition of equality is
 * exactly the one that ignores spans, quoting style and authored key
 * order, which is what "the same configuration in two formats" means.
 *
 * Hermetic: an `InMemoryHost`, no filesystem, no network.
 */

import { describe, expect, it } from "vitest";
import { resolve, nodesEqual, type Node } from "../../src/index.js";
import { InMemoryHost } from "./host-test-double.js";

const ENCODER = new TextEncoder();

/**
 * The three documents. Each pair says the same thing twice — deliberately
 * chosen so that the *hard* parts of the model are exercised rather than
 * the easy ones:
 *
 * 1. **scalars of every kind**, with the numbers spelled so that lexical
 *    kind decides: `2` int and `2.0` float in both grammars, `1e2` a float
 *    in both, and an integer far past 2^53 that only a `bigint` path can
 *    carry.
 * 2. **nesting and sequences**, with the JSON written in a different key
 *    order from the YAML, so a match proves canonical ordering rather than
 *    coincidence.
 * 3. **strings that are not plain**: non-ASCII, an astral character, an
 *    embedded newline and quote, and text YAML would be tempted to
 *    re-interpret (`no`, `on`, `~`, `1.0`) but §4.2 forbids it from
 *    touching — the Norway problem, checked from both sides at once.
 */
const PAIRS: readonly { readonly name: string; readonly json: string; readonly yaml: string }[] = [
  {
    name: "scalars of every kind, numbers by lexical kind",
    json: '{"b":true,"big":123456789012345678901234567890,"e":1e2,"f":2.0,"i":2,"n":null,"s":"plain"}',
    yaml: 'i: 2\nf: 2.0\ne: 1e2\nbig: 123456789012345678901234567890\nb: true\nn: null\ns: plain\n',
  },
  {
    name: "nesting and sequences, written in a different key order",
    json: '{"z":{"inner":[1,[2,3],{"k":"v"}],"also":{}},"a":[]}',
    yaml: 'a: []\nz:\n  also: {}\n  inner:\n    - 1\n    - [2, 3]\n    - k: v\n',
  },
  {
    name: "strings the Norway problem would spoil, plus non-ASCII and an astral character",
    json: '{"astral":"caffè \\ud83d\\ude00","country":"no","multi":"one\\ntwo","quote":"she said \\"yes\\"","switch":"on","tilde":"~","version":"1.0"}',
    yaml: 'country: "no"\nswitch: "on"\ntilde: "~"\nversion: "1.0"\nquote: \'she said "yes"\'\nmulti: "one\\ntwo"\nastral: "caffè \\U0001F600"\n',
  },
];

async function resolveOne(location: string, text: string): Promise<Node> {
  const host = new InMemoryHost({ files: new Map([[location, ENCODER.encode(text)]]), canonicalizeIsIdentity: true });
  const result = await resolve(location, { host, sandboxRoot: "/" });
  if (!result.ok) {
    throw new Error(`${location} was refused: ${result.diagnostics.map((d) => `${d.code} at ${d.primary.line}:${d.primary.column} — ${d.message}`).join("; ")}`);
  }
  const document = result.graph.documents[0];
  if (document === undefined) {
    throw new Error(`${location} resolved to no documents`);
  }
  return document.tree;
}

describe("v1.2 FR-021 — a .json entry document and the equivalent .yaml resolve to the same tree", () => {
  for (const pair of PAIRS) {
    it(`${pair.name}: the two trees are model-equal`, async () => {
      const fromJson = await resolveOne("/doc.json", pair.json);
      const fromYaml = await resolveOne("/doc.yaml", pair.yaml);
      expect(nodesEqual(fromJson, fromYaml), "the same configuration written in two formats must mean the same thing").toBe(true);
    });

    it(`${pair.name}: and their spans differ, which is what makes the equality above a real claim`, async () => {
      const fromJson = await resolveOne("/doc.json", pair.json);
      const fromYaml = await resolveOne("/doc.yaml", pair.yaml);
      // If the two documents somehow produced identical positions, they
      // would be the same bytes and the test above would be comparing a
      // thing with itself.
      expect(fromJson.span.end).not.toBe(fromYaml.span.end);
    });
  }

  it("goes through the registry, not through a hard-wired format — an unregistered extension is still unreachable", async () => {
    const host = new InMemoryHost({ files: new Map([["/doc.toml", ENCODER.encode("a = 1\n")]]), canonicalizeIsIdentity: true });
    const result = await resolve("/doc.toml", { host, sandboxRoot: "/" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable — asserted above");
    expect(result.diagnostics.map((d) => d.code)).toContain("document-unreachable");
  });
});
