/**
 * v1.10 (specs/019-bounded-cost) FR-001, FR-002 — the anchor table answers
 * what `yaml`'s own `Alias#resolve` answers, for every alias.
 *
 * `Alias#resolve` is the oracle and is called **here only**. The table is
 * what `src/` uses; calling the oracle there is what made reading a document
 * quadratic in its aliases (4,000 aliases, ten seconds), and the layering
 * sweep below forbids it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDocument, visit } from "yaml";
import type { Alias, Document } from "yaml";
import { buildAnchorTable } from "../../src/adapters/yaml/anchors.js";
import { parse } from "../../src/index.js";
import { loadCases } from "../corpus/runner.js";

const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases");
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

/** Every alias in `doc`, in `visit`'s order. */
function aliasesOf(doc: Document): Alias[] {
  const found: Alias[] = [];
  visit(doc, { Alias: (_key, alias) => void found.push(alias) });
  return found;
}

function expectSameAnswers(text: string): number {
  const doc = parseDocument(text, { merge: true });
  const table = buildAnchorTable(doc);
  const aliases = aliasesOf(doc);
  for (const alias of aliases) {
    expect(table.targetOf(alias), `*${alias.source} in ${JSON.stringify(text)}`).toBe(alias.resolve(doc));
  }
  return aliases.length;
}

describe("FR-002: the table's target is the node Alias#resolve returns", () => {
  const HAND: readonly [string, string][] = [
    ["a plain anchor and alias", "a: &x 1\nb: *x\n"],
    ["a redefined anchor: each alias sees the nearest one before it", "a: &x 1\nb: *x\nc: &x 2\nd: *x\n"],
    ["an alias before its anchor is dangling", "a: *x\nb: &x 1\n"],
    ["an alias with no anchor at all", "a: *nope\n"],
    ["an alias inside its own anchored node sees that node", "a: &x [1, *x]\n"],
    ["an alias inside a different anchored node", "a: &x 1\nb: &y [*x, 2]\nc: *y\n"],
    ["a merge key with one alias", "base: &b {k: 1}\nw:\n  <<: *b\n"],
    ["a merge key with a list of aliases", "a: &a {x: 1}\nb: &b {y: 2}\nw:\n  <<: [*a, *b]\n"],
    ["a merge key whose anchor is redefined between two merges", "a: &m {x: 1}\nw1: {<<: *m}\nb: &m {x: 2}\nw2: {<<: *m}\n"],
    ["non-ASCII anchor names", "a: &é 1\nb: &日本 2\nc: [*é, *日本]\n"],
    ["an anchor on a key and an alias as a key", "&k a: 1\n*k : 2\n"],
    ["an alias in a pair's value to an anchor on the same pair's key (the key is walked first)", "&k a: *k\n"],
    ["an anchor on a mapping, redefined on a nested node", "a: &x {b: &x 1, c: *x}\nd: *x\n"],
    ["an anchor on a sequence item and a scalar value", "- &i 1\n- *i\n- &j [*i]\n- *j\n"],
    ["names that are prefixes of one another", "a: &x 1\nb: &xy 2\nc: [*x, *xy]\n"],
    ["an empty document and a document with no aliases", "a: 1\n"],
  ];
  for (const [name, text] of HAND) {
    it(name, () => {
      expectSameAnswers(text);
    });
  }

  it("the hand set really contains aliases (a vacuous pass would be silent)", () => {
    expect(HAND.reduce((sum, [, text]) => sum + aliasesOf(parseDocument(text, { merge: true })).length, 0)).toBeGreaterThan(20);
  });

  it("every YAML document of the conformance corpus", () => {
    const yamlInputs = loadCases(CASES_DIR).filter((c) => c.format === "yaml" && c.input !== undefined).map((c) => c.input ?? "");
    let aliases = 0;
    for (const text of yamlInputs) aliases += expectSameAnswers(text);
    expect(yamlInputs.length).toBeGreaterThan(50);
    expect(aliases).toBeGreaterThan(5);
  });

  it("every .yaml fixture under the corpus", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.ya?ml$/.test(e.name) ? [join(dir, e.name)] : []));
    for (const file of walk(join(dirname(CASES_DIR), "cases"))) expectSameAnswers(readFileSync(file, "utf-8"));
  });

  it("a generated set: random nesting, redefinition, merge keys, non-ASCII names (seeded)", () => {
    let seed = 20261008;
    const next = (n: number): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return Math.floor((seed / 4294967296) * n);
    };
    const names = ["a", "b", "é", "日本", "x1"];
    const node = (depth: number): string => {
      const pick = next(depth > 3 ? 4 : 8);
      const name = names[next(names.length)] ?? "a";
      switch (pick) {
        case 0:
          return String(next(100));
        case 1:
        case 2:
          return `*${name}`;
        case 3:
          return `&${name} ${next(100)}`;
        case 4:
          return `&${name} [${node(depth + 1)}, ${node(depth + 1)}]`;
        case 5:
          return `[${node(depth + 1)}, ${node(depth + 1)}]`;
        case 6:
          return `&${name} {k${next(3)}: ${node(depth + 1)}, <<: *${name}}`;
        default:
          return `{k: ${node(depth + 1)}, j: &${name} ${node(depth + 1)}}`;
      }
    };
    let aliases = 0;
    for (let i = 0; i < 400; i += 1) {
      aliases += expectSameAnswers(`root: ${node(0)}\nmore: ${node(0)}\n`);
    }
    expect(aliases).toBeGreaterThan(300);
  });
});

describe("FR-001: nothing under src/ calls Alias#resolve", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));

  it("no file under src/adapters/ contains a `.resolve(` call at all", () => {
    const offenders = files(join(SRC_DIR, "adapters")).filter((f) => /\.resolve\(/.test(readFileSync(f, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
    expect(offenders).toEqual([]);
  });

  it("no file anywhere under src/ calls `.resolve(` with a yaml document as its argument", () => {
    const offenders = files(SRC_DIR).filter((f) => /\.resolve\(\s*(this\.|ctx\.)?doc\b/.test(readFileSync(f, "utf-8")));
    expect(offenders).toEqual([]);
  });
});

describe("linear time: the witness (the sweep above is the guarantee)", () => {
  const lines = (n: number): string => {
    const out: string[] = [];
    for (let i = 0; i < n; i += 1) out.push(`a${i}: &a${i} ${i}`, `b${i}: *a${i}`);
    return `${out.join("\n")}\n`;
  };
  const fastest = (run: () => void): number => {
    let best = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const start = performance.now();
      run();
      best = Math.min(best, performance.now() - start);
    }
    return best;
  };
  /**
   * Cascata's read against `yaml`'s own `parseDocument` of the same text. The
   * whole read alone is not the thing to time: `yaml`'s composer is itself
   * superlinear in anchors (4,000 anchors and aliases in 0.4 s, 8,000 in
   * 1.7 s, no Cascata code involved), which is upstream's and which nothing
   * in this library can reach. The 9.6 s v1.10 removed was all on this side
   * of the line, so the witness is the read relative to the parse beneath it.
   */
  const times = (n: number): { library: number; whole: number } => {
    const text = lines(n);
    const bytes = new TextEncoder().encode(text);
    const origin = { id: "t", label: "t" };
    return {
      library: fastest(() => void parseDocument(text, { merge: true })),
      whole: fastest(() => expect(parse(bytes, { origin }).ok).toBe(true)),
    };
  };
  it("reading 4,000 and 8,000 aliases costs a small multiple of yaml's own parse of them, not tens of times it", { timeout: 60_000 }, () => {
    for (const n of [4000, 8000]) {
      const { library, whole } = times(n);
      // Before v1.10: 9.6 s over a 0.3 s parse at 4,000 (32x), and growing with the square. Now ~1.1x.
      expect(whole, `${n} aliases: yaml ${library.toFixed(0)} ms, whole read ${whole.toFixed(0)} ms`).toBeLessThan(3 * library + 500);
    }
  });
});
