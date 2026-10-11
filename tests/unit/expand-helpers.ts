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

/** Expand `patterns` in `world` through the memory host (optionally `wrap`ped, e.g. in `folding`); `options` overrides the defaults (sandbox /v). */
export async function expandPatterns(world: World, patterns: readonly string[], options: Partial<ExpandOptions> = {}, schema: string = SCHEMA_LIST, wrap?: (host: Host, stored: readonly string[]) => Host): Promise<{ readonly result: ExpandResult; readonly lists: string[]; readonly configuration: MergedConfiguration }> {
  const withDocuments = { ...world.files, "/v/proj/schema.yaml": schema, "/v/proj/config.yaml": `$schema: ./schema.yaml\ninclude:\n${quoted(patterns)}` };
  const memory = createMemoryHost({ files: withDocuments as Record<string, string>, ...(world.links === undefined ? {} : { links: world.links as Record<string, string> }) });
  const stored = [...Object.keys(withDocuments), ...Object.keys(world.links ?? {})];
  const { host, lists } = counted(wrap === undefined ? memory : wrap(memory, stored));
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

/**
 * A host over a disk that FOLDS Unicode normalization, as APFS does: any spelling of a stored name finds it (`canonicalize`,
 * `list` and `read` map the asked location to the stored one by NFC), and a listing hands names back as stored. `stored` is every
 * stored path that exists. The memory host is exact, so this is how a folding disk is modelled in the main suite.
 */
export function folding(host: Host, stored: readonly string[]): Host {
  const known = new Map<string, string>();
  for (const path of stored) {
    const parts = path.split("/");
    for (let end = 2; end <= parts.length; end += 1) {
      const prefix = parts.slice(0, end).join("/");
      known.set(prefix.normalize("NFC"), prefix);
    }
  }
  const fold = (location: string): string => {
    const parts = location.split("/");
    for (let end = parts.length; end >= 2; end -= 1) {
      const hit = known.get(parts.slice(0, end).join("/").normalize("NFC"));
      if (hit !== undefined) return [hit, ...parts.slice(end)].join("/");
    }
    return location;
  };
  const list = host.list;
  return {
    ...host,
    read: (location: string) => host.read(fold(location)),
    canonicalize: (location: string) => host.canonicalize(fold(location)),
    ...(list === undefined ? {} : { list: (location: string) => list.call(host, fold(location)) }),
  };
}

/** Files `f.md` in every directory of a tree `depth` levels deep with `fanout` subdirectories each, rooted at `root`: (fanout^(depth+1) - 1)/(fanout - 1) directories. */
export function fanTree(root: string, depth: number, fanout: number): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (dir: string, level: number): void => {
    files[`${dir}/f.md`] = "";
    if (level < depth) {
      for (let child = 0; child < fanout; child += 1) visit(`${dir}/d${child}`, level + 1);
    }
  };
  visit(root, 0);
  return files;
}
