/**
 * v1.14 FR-001, FR-004, FR-005, FR-006 -- `glob` as a built-in type.
 *
 * The grammar itself is `glob-grammar.test.ts`; this file is the type: how a refusal reads, that narrowing works
 * as for `url` and `path`, and what the generator emits. Values are chosen so the three string refinements
 * disagree: `[x]` is a fine path (no space) and not a glob; `a b` is a fine glob (a space is an ordinary character)
 * and not a path.
 */

import { describe, expect, it } from "vitest";
import { load, parse } from "../../src/index.js";
import { createOrigin } from "../../src/model/span.js";
import type { Layer } from "../../src/merge/provenance.js";
import { accumulate } from "../../src/generate/accumulate.js";
import { generate } from "../../src/generate/emit.js";
import { compileInMemory, renderProblems } from "./generate-literal.js";
import { vhost } from "./graph-identity-helpers.js";

async function loadFiles(files: Readonly<Record<string, string>>) {
  return load("/v/config.yaml", { host: vhost(files), sandboxRoot: "/v" });
}

const SCHEMA_GLOB = "keys:\n  include:\n    demand:\n      type: glob\n";

describe("v1.14 FR-004 -- a refused pattern is the existing type-mismatch, at the value, naming the offence", () => {
  it("names the character, its offset, and the pattern", async () => {
    const result = await loadFiles({ "/v/schema.yaml": SCHEMA_GLOB, "/v/config.yaml": "$schema: ./schema.yaml\ninclude: \"[ab].md\"\n" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.code)).toEqual(["type-mismatch"]);
    const [diagnostic] = result.diagnostics;
    expect(diagnostic?.message).toContain("expected glob, got the pattern \"[ab].md\"");
    expect(diagnostic?.message).toContain("'[' is not part of the glob grammar");
    expect(diagnostic?.message).toContain("at offset 0");
    // `include: ` is nine bytes, so the quoted value starts at line 2, column 10.
    expect([diagnostic?.primary.line, diagnostic?.primary.column]).toEqual([2, 10]);
  });

  it("names the rule for a double star inside a segment, at the element of a glob[]", async () => {
    const result = await loadFiles({ "/v/schema.yaml": "keys:\n  include:\n    demand:\n      type: glob[]\n", "/v/config.yaml": "$schema: ./schema.yaml\ninclude:\n  - '*.md'\n  - 'a**'\n" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const [diagnostic] = result.diagnostics;
    expect(result.diagnostics).toHaveLength(1);
    expect(diagnostic?.pointer).toBe("/include/1");
    expect(diagnostic?.message).toContain("'**' is only allowed as a whole segment");
    expect(diagnostic?.message).toContain("at offset 1");
  });

  it("a non-string says what it is, as for any other type, not a grammar offence", async () => {
    const result = await loadFiles({ "/v/schema.yaml": SCHEMA_GLOB, "/v/config.yaml": "$schema: ./schema.yaml\ninclude: 7\n" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.message).toContain("expected glob, got a int scalar");
  });
});

describe("v1.14 FR-005 -- checking confines nothing: no host call beyond reading the documents, and no existence check", () => {
  it("a pattern that climbs out of the sandbox, an absolute one and one naming nothing all load", async () => {
    const host = vhost({ "/v/schema.yaml": "keys:\n  include:\n    demand:\n      type: glob[]\n", "/v/config.yaml": "$schema: ./schema.yaml\ninclude:\n  - ../../outside/*.md\n  - /etc/*.conf\n  - nothing/here/*.zzz\n" });
    const result = await load("/v/config.yaml", { host, sandboxRoot: "/v" });
    expect(result.ok).toBe(true);
    // The only reads are the two documents; the patterns were never put to the host (v1.14 FR-005).
    expect([...host.reads].sort()).toEqual(["/v/config.yaml", "/v/schema.yaml"]);
  });
});

describe("v1.14 FR-001 -- glob refines string, as url and path do, and narrows", () => {
  const HOUSE = "$id: house\ntypes:\n  pattern:\n    accept: [path, glob]\n    demand: { type: string }\nkeys:\n  include:\n    demand:\n      type: pattern\n";
  const NARROW_TO_GLOB = "$id: venue\n$adopts: ./house.yaml\nkeys:\n  include:\n    demand:\n      type: pattern\n      accept: [glob]\n";

  it("a house type accepting `path | glob` takes both kinds of string", async () => {
    for (const value of ["[x]", "a b"]) {
      const result = await loadFiles({ "/v/house.yaml": HOUSE, "/v/config.yaml": `$schema: ./house.yaml\ninclude: '${value}'\n` });
      // `[x]` is a path (no space) and `a b` is a glob (a space is an ordinary character); each satisfies one alternative.
      expect(result.ok, value).toBe(true);
    }
  });

  it("narrowing the accept to `glob` refuses a string that is only a path", async () => {
    const files = { "/v/house.yaml": HOUSE, "/v/venue.yaml": NARROW_TO_GLOB };
    expect((await loadFiles({ ...files, "/v/config.yaml": "$schema: ./venue.yaml\ninclude: 'a b'\n" })).ok).toBe(true);
    const refused = await loadFiles({ ...files, "/v/config.yaml": "$schema: ./venue.yaml\ninclude: '[x]'\n" });
    expect(refused.ok).toBe(false);
  });

  it("string ∩ glob is glob: a root `string` and a house `glob` refuse a string outside the grammar", async () => {
    const files = { "/v/root.yaml": "$id: root\nkeys:\n  include:\n    demand: { type: string }\n", "/v/venue.yaml": "$id: venue\n$adopts: ./root.yaml\nkeys:\n  include:\n    demand: { type: glob }\n" };
    expect((await loadFiles({ ...files, "/v/config.yaml": "$schema: ./venue.yaml\ninclude: '*.md'\n" })).ok).toBe(true);
    expect((await loadFiles({ ...files, "/v/config.yaml": "$schema: ./venue.yaml\ninclude: '{a,b}'\n" })).ok).toBe(false);
  });
});

// --- FR-006: the generator ---------------------------------------------------

const ENCODER = new TextEncoder();
function schemaLayer(location: string, rank: number, text: string): Layer {
  const parsed = parse(ENCODER.encode(text), { origin: createOrigin(location, location) });
  if (!parsed.ok) throw new Error(`fixture '${location}' does not parse`);
  return { identity: { location, physical: location, hash: String(rank).repeat(64).slice(0, 64) }, role: "schema", rank, tree: parsed.tree };
}
function emit(...texts: readonly string[]): string {
  return generate(accumulate(texts.map((text, index) => schemaLayer(`layer${index}.yaml`, index, text))).tree).source;
}
function typeOfA(...texts: readonly string[]): string {
  const source = emit(...texts);
  expect(compileInMemory(source), renderProblems(compileInMemory(source))).toEqual([]);
  const match = /^ {2}readonly a\??: (.*);$/m.exec(source);
  if (match?.[1] === undefined) throw new Error(`no property 'a' in:\n${source}`);
  return match[1];
}
const key = (demand: string): string => `keys:\n  a:\n    demand: ${demand}\n`;

describe("v1.14 FR-006 -- the generator emits string for glob and a readonly array for glob[]", () => {
  it("glob is string; glob[] is readonly string[]", () => {
    expect(typeOfA(key("{ type: glob }"))).toBe("string");
    expect(typeOfA(key("{ type: 'glob[]' }"))).toBe("readonly string[]");
  });

  it("string ∩ glob accumulates to glob, not to nothing: neither side makes the position `never`", () => {
    expect(typeOfA(key("{ type: string }"), key("{ type: glob }"))).toBe("string");
    expect(typeOfA(key("{ type: glob }"), key("{ type: string }"))).toBe("string");
  });

  it("path | glob emits string once", () => {
    expect(typeOfA(key("{ type: 'path | glob' }"))).toBe("string");
  });
});
