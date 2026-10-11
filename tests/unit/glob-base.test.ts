/**
 * v1.14 FR-007 -- `globBase(configuration, pointer)`, the base query beside `resource()`.
 *
 * Everything runs in an in-memory host with POSIX locations written out by hand. The one span asserted is counted
 * in the test that asserts it.
 */

import { describe, expect, it } from "vitest";
import { globBase, load, type MergedConfiguration } from "../../src/index.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { vhost } from "./graph-identity-helpers.js";

const ENCODER = new TextEncoder();
const SCHEMA = "keys:\n  include:\n    demand:\n      type: glob[]\n";

async function configurationOf(files: Record<string, string>, entry: string, canonical: Record<string, string> = {}): Promise<MergedConfiguration> {
  const result = await load(entry, { host: vhost(files, canonical), sandboxRoot: "/v" });
  if (!result.ok) throw new Error(`load refused: ${result.diagnostics.map((d) => d.message).join("; ")}`);
  return result.configuration;
}

/** A project whose config says `include: [<pattern>]`. */
async function baseOf(pattern: string, pointer = "/include/0") {
  const configuration = await configurationOf({ "/v/proj/schema.yaml": SCHEMA, "/v/proj/config.yaml": `$schema: ./schema.yaml\ninclude:\n  - '${pattern}'\n` }, "/v/proj/config.yaml");
  return globBase(configuration, pointer);
}

describe("v1.14 FR-007 -- the literal prefix and the anchored directory", () => {
  const rows: readonly (readonly [string, string, string, string])[] = [
    // pattern, literalPrefix, directory (the config is /v/proj/config.yaml, so its directory is /v/proj)
    ["a wildcard first: the prefix is empty", "*.md", "", "/v/proj"],
    ["a literal prefix before a double star", "content/**/*.md", "content", "/v/proj/content"],
    ["two literal segments", "docs/guide/?.md", "docs/guide", "/v/proj/docs/guide"],
    ["a climbing prefix", "../shared/*.md", "../shared", "/v/shared"],
    ["an absolute pattern", "/abs/*.md", "/abs", "/abs"],
    ["an absolute pattern at the root", "/*.md", "/", "/"],
    ["no wildcard: all but the last segment", "docs/a/readme.md", "docs/a", "/v/proj/docs/a"],
    ["no wildcard, one segment: the prefix is empty, the directory is the document's", "readme.md", "", "/v/proj"],
    ["a lone double star", "**", "", "/v/proj"],
    ["a dot segment is part of the prefix and is normalized away", "./*.md", ".", "/v/proj"],
    ["a dot-dot before the wildcard is part of the prefix", "a/../b/*.md", "a/../b", "/v/proj/b"],
  ];
  for (const [name, pattern, literalPrefix, directory] of rows) {
    it(`${pattern}: ${name}`, async () => {
      const base = await baseOf(pattern);
      expect(base).toMatchObject({ kind: "glob", pattern, literalPrefix, directory });
    });
  }

  it("carries the value's own span: line 4, the quote at column 5 of `  - '*.md'`", async () => {
    // Bytes: `$schema: ./schema.yaml\n` is 23, `include:\n` is 9, `  - ` is 4, so the quoted value starts at 36 and `'*.md'` is 6 bytes.
    const base = await baseOf("*.md");
    expect(base.kind).toBe("glob");
    if (base.kind !== "glob") return;
    expect(base.span).toMatchObject({ start: 36, end: 42, line: 3, column: 5 });
    expect(base.span.origin.id).toBe("/v/proj/config.yaml");
  });

  it("is a query: no otherDirectory where the document is not behind a link", async () => {
    const base = await baseOf("content/*.md");
    expect(base).not.toHaveProperty("otherDirectory");
  });
});

describe("v1.14 FR-007 -- the declaring document decides, as for resource()", () => {
  it("a pattern provided by a schema in another directory is anchored at that schema's directory", async () => {
    const configuration = await configurationOf(
      {
        "/v/house/schema.yaml": "keys:\n  include:\n    demand:\n      type: glob[]\n    provide: ['assets/*.css']\n",
        "/v/proj/config.yaml": "$schema: ../house/schema.yaml\n",
      },
      "/v/proj/config.yaml",
    );
    expect(globBase(configuration, "/include/0")).toMatchObject({ kind: "glob", pattern: "assets/*.css", directory: "/v/house/assets" });
  });

  it("a document behind a link is anchored from its logical directory, with the physical one beside it (v1.13)", async () => {
    const configuration = await configurationOf(
      { "/v/link/schema.yaml": SCHEMA, "/v/link/config.yaml": "$schema: ./schema.yaml\ninclude: ['x/*.md']\n" },
      "/v/link/config.yaml",
      { "/v/link/config.yaml": "/v/real/config.yaml" },
    );
    expect(globBase(configuration, "/include/0")).toMatchObject({ kind: "glob", directory: "/v/link/x", otherDirectory: "/v/real/x" });
  });

  it("a remote document is anchored from its physical URL, with the requested URL beside it", async () => {
    const ok = (url: string, text: string): Recording => ({ url, method: "GET", outcome: { kind: "response", response: { status: 200, headers: { "cache-control": "immutable" }, body: ENCODER.encode(text) } } });
    const redirect = (from: string, to: string): Recording => ({ url: from, method: "GET", outcome: { kind: "response", response: { status: 302, headers: { location: to }, body: new Uint8Array() } } });
    const schema = "keys:\n  include:\n    demand:\n      type: glob[]\n    provide: ['assets/**/*.css']\n";
    const result = await load("/v/config.yaml", {
      host: vhost({ "/v/config.yaml": "$schema: https://example.test/old/s.yaml\n" }),
      sandboxRoot: "/v",
      transport: new RecordedTransport([redirect("https://example.test/old/s.yaml", "https://example.test/new/s.yaml"), ok("https://example.test/new/s.yaml", schema)]),
    });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join("; "));
    expect(globBase(result.configuration, "/include/0")).toMatchObject({
      kind: "glob",
      literalPrefix: "assets",
      directory: "https://example.test/new/assets/",
      otherDirectory: "https://example.test/old/assets/",
    });
  });
});

describe("v1.14 FR-007 -- not a glob, or not there", () => {
  it("a pointer naming nothing is unknown-pointer", async () => {
    expect(await baseOf("*.md", "/nothing")).toEqual({ kind: "unknown-pointer" });
  });

  it("a container, a number and a string outside the grammar are not-a-glob (it is a query: it never throws, never refuses)", async () => {
    expect(await baseOf("*.md", "/include")).toEqual({ kind: "not-a-glob" });
    const configuration = await configurationOf({ "/v/s.yaml": "", "/v/config.yaml": "n: 7\ntext: '[x]'\n" }, "/v/config.yaml");
    expect(globBase(configuration, "/n")).toEqual({ kind: "not-a-glob" });
    expect(globBase(configuration, "/text")).toEqual({ kind: "not-a-glob" });
  });
});
