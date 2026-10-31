/**
 * Cascata's writers against the stenographer contract (`@stenographers/stenography`, 0km's
 * `proposals/stenography-contract.md`): the suite's laws, one vitest test each, for `yamlWriter()`
 * and `jsonWriter()`. The host reads a document with the format's own parser, so a value is what
 * Cascata reads; its corpus is every input of the write cases that parses; its edits add one to
 * each integer, which every writer must accept, in every document with no YAML alias: a value an alias
 * or a merge key shares is refused by default, as Article IX lets it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { parseDocument, visit } from "yaml";
import { check, type Host } from "@stenographers/stenography/check";
import type { EditData } from "@stenographers/stenography";
import { parseJsonBytes } from "../../src/adapters/json/parse.js";
import { parseYamlBytes } from "../../src/adapters/yaml/parse.js";
import type { Node } from "../../src/model/node.js";
import { createOrigin } from "../../src/model/span.js";
import { jsonWriter, yamlWriter } from "../../src/writers.js";

const CASES = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "write-cases");
const ORIGIN = createOrigin("stenography", "stenography");
const ENCODER = new TextEncoder();

const data = (node: Node): EditData =>
  node.type === "mapping" ? new Map([...node.entries].map(([k, v]) => [k, data(v)])) : node.type === "sequence" ? node.items.map(data) : node.value;

const step = (key: string): string => key.replaceAll("~", "~0").replaceAll("/", "~1");

/** Every path in the tree, the root's `""` first, with its node. */
function paths(node: Node, at = "", into = new Map<string, Node>()): Map<string, Node> {
  into.set(at, node);
  if (node.type === "mapping") for (const [k, v] of node.entries) paths(v, `${at}/${step(k)}`, into);
  if (node.type === "sequence") node.items.forEach((v, i) => paths(v, `${at}/${i}`, into));
  return into;
}

function hasAlias(bytes: Uint8Array): boolean {
  let found = false;
  visit(parseDocument(new TextDecoder().decode(bytes)), { Alias: () => ((found = true), visit.BREAK) });
  return found;
}

function host(format: "yaml" | "json"): Host {
  const parse = format === "yaml" ? parseYamlBytes : parseJsonBytes;
  const read = (bytes: Uint8Array) => {
    const parsed = parse(bytes, ORIGIN);
    if (!parsed.ok) return undefined;
    const all = paths(parsed.tree);
    return { all, paths: [...all.keys()], at: (p: string) => (all.has(p) ? data(all.get(p)!) : undefined) };
  };
  const inputs = new Set<string>();
  for (const file of readdirSync(CASES).sort()) {
    const c = JSON.parse(readFileSync(join(CASES, file), "utf8")) as { format?: string; input?: string };
    if (c.format === format && typeof c.input === "string") inputs.add(c.input);
  }
  return {
    writer: format === "yaml" ? yamlWriter() : jsonWriter(),
    features: ["add", "remove", "inside", "amend", "shifted"],
    // The one gap left: the shared name for bytes `open` cannot read is still a candidate in the contract.
    known: { refusal: "open refuses with the parser's own code (invalid-encoding, malformed-document) until the contract rules on open-unreadable" },
    corpus: [...inputs].map((s) => ENCODER.encode(s)).filter((b) => read(b) !== undefined),
    read,
    edits(bytes) {
      const r = read(bytes);
      if (r === undefined) return [];
      if (format === "yaml" && hasAlias(bytes)) return [];
      return [...r.all].flatMap(([path, n]) => (n.type === "scalar" && n.kind === "int" ? [{ path, value: n.value + 1n }] : []));
    },
  };
}

for (const format of ["yaml", "json"] as const) {
  describe(`stenography: ${format}Writer()`, () => {
    for (const finding of check(host(format))) {
      it.skipIf(finding.skip !== undefined)(finding.law, () => {
        if (finding.failures.length) throw new Error(`${finding.failures.length} failure(s):\n${finding.failures.slice(0, 20).join("\n")}`);
      });
    }
  });
}
