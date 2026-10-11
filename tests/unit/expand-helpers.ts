/**
 * Scaffolding for the v1.14 expansion cases: a world of files and links in the memory host, a config whose `include` list
 * holds the patterns under test, and a counting wrapper around `list`.
 */
import { expand, load, type ExpandedGlob, type ExpandOptions, type ExpandResult, type Host, type MergedConfiguration } from "../../src/index.js";
import { createMemoryHost } from "../../src/host/memory.js";

export const SCHEMA_LIST = "keys:\n  include:\n    demand:\n      type: glob[]\n";

/** Under /v/proj: the files an expansion walks. (schema.yaml and config.yaml are files in /v/proj too.) */
export const TREE: Readonly<Record<string, string>> = {
  "/v/proj/a.md": "",
  "/v/proj/b.md": "",
  "/v/proj/c.txt": "",
  "/v/proj/.hidden.md": "",
  "/v/proj/sub/d.md": "",
  "/v/proj/sub/e.txt": "",
  "/v/proj/sub/deep/f.md": "",
  "/v/proj/.git/g.md": "",
  "/v/proj/café.md": "",
  "/v/proj/日本.md": "",
};

export interface World {
  readonly files: Readonly<Record<string, string>>;
  readonly links?: Readonly<Record<string, string>>;
}

export interface Counted {
  readonly host: Host;
  /** Every location `list` was asked about, in order. */
  readonly lists: string[];
}

/** `host` with `list` counted (and, where `refuse` names a location, refused with that reason). */
export function counted(host: Host, refuse: Readonly<Record<string, string>> = {}): Counted {
  const lists: string[] = [];
  const list = host.list;
  return {
    lists,
    host: {
      ...host,
      list: async (location: string) => {
        lists.push(location);
        const reason = refuse[location];
        if (reason !== undefined) return { ok: false as const, reason };
        if (list === undefined) throw new Error("the wrapped host cannot list");
        return list.call(host, location);
      },
    },
  };
}

export function quoted(patterns: readonly string[]): string {
  return patterns.map((pattern) => `  - ${JSON.stringify(pattern)}\n`).join("");
}

/** Expand `patterns` in `world` through the memory host; `options` overrides the defaults (sandbox /v). */
export async function expandPatterns(world: World, patterns: readonly string[], options: Partial<ExpandOptions> = {}, schema: string = SCHEMA_LIST): Promise<{ readonly result: ExpandResult; readonly lists: string[]; readonly configuration: MergedConfiguration }> {
  const withDocuments = { ...world.files, "/v/proj/schema.yaml": schema, "/v/proj/config.yaml": `$schema: ./schema.yaml\ninclude:\n${quoted(patterns)}` };
  const memory = createMemoryHost({ files: withDocuments as Record<string, string>, ...(world.links === undefined ? {} : { links: world.links as Record<string, string> }) });
  const { host, lists } = counted(memory);
  const loaded = await load("/v/proj/config.yaml", { host: memory, sandboxRoot: "/v" });
  if (!loaded.ok) throw new Error(`the world does not load: ${loaded.diagnostics.map((d) => d.message).join("; ")}`);
  const result = await expand(loaded.configuration, { host, sandboxRoot: "/v", ...options });
  return { result, lists, configuration: loaded.configuration };
}

/** The logical locations of an expansion that must have succeeded. */
export function locations(expansion: ExpandedGlob | undefined): string[] {
  if (expansion === undefined) throw new Error("no such expansion");
  if (!expansion.ok) throw new Error(`the expansion was refused: ${expansion.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; ")}`);
  return expansion.matches.map((match) => match.location);
}
