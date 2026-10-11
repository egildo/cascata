/**
 * v1.14 FR-012 to FR-019, FR-022 -- `expand()`: a stage of its own that walks a `glob` value through the host.
 *
 * Written from the spec, before `expand()` existed. The memory host is the default world (nothing here touches a disk; the
 * real disk is `expand-disk.test.ts`). Every expected list is derived by hand from the tree in `expand-helpers.ts` and sorted
 * by code point as FR-016 says; a `list` call is counted, never timed.
 */

import { describe, expect, it } from "vitest";
import { expand, load, merge, resolve, type Host } from "../../src/index.js";
import { createMemoryHost } from "../../src/host/memory.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { counted, expandPatterns, locations, quoted, SCHEMA_LIST, TREE, type World } from "./expand-helpers.js";

const P = "/v/proj/";
const under = (...names: string[]): string[] => names.map((name) => `${P}${name}`);

/** `host` that lists its entries in the opposite order: the host's order means nothing (FR-009), so nothing may depend on it. */
function reversing(host: Host): Host {
  return {
    ...host,
    list: async (location: string) => {
      const answer = await host.list?.(location);
      if (answer === undefined) throw new Error("cannot list");
      return answer.ok ? { ok: true as const, entries: [...answer.entries].reverse() } : answer;
    },
  };
}

describe("v1.14 FR-012/FR-013 -- the walk: literal segments, * and ?, ** , and what each returns", () => {
  const world: World = { files: TREE };
  const matches = async (pattern: string): Promise<string[]> => locations((await expandPatterns(world, [pattern])).result.expansions[0]);

  it("`*.md` is the markdown files of the anchored directory, and not its dotfile, its subdirectories' files, or c.txt", async () => {
    expect(await matches("*.md")).toEqual(under("a.md", "b.md", "café.md", "日本.md"));
  });

  it("`**/*.md` is zero or more directories deep: the root's own files too", async () => {
    // Sorted by code point on the whole path: `sub/d.md` before `sub/deep/f.md` because '.' (0x2e) < 'e' (0x65).
    expect(await matches("**/*.md")).toEqual(under("a.md", "b.md", "café.md", "sub/d.md", "sub/deep/f.md", "日本.md"));
  });

  it("a lone `**` is every file, any depth, except dotfiles and what is under a dot directory", async () => {
    expect(await matches("**")).toEqual(under("a.md", "b.md", "c.txt", "café.md", "config.yaml", "schema.yaml", "sub/d.md", "sub/deep/f.md", "sub/e.txt", "日本.md"));
  });

  it("`?` is exactly one code point", async () => {
    expect(await matches("?.md")).toEqual(under("a.md", "b.md"));
    expect(await matches("日?.md")).toEqual(under("日本.md"));
    expect(await matches("????.md")).toEqual(under("café.md")); // c a f é
  });

  it("a literal segment after a wildcard is a direct child, and `*` as a directory name skips dot directories", async () => {
    expect(await matches("*/e.txt")).toEqual(under("sub/e.txt"));
    expect(await matches("*/*.md")).toEqual(under("sub/d.md")); // not .git/g.md
  });

  it("a double star between literals: zero levels or more", async () => {
    expect(await matches("sub/**/*.md")).toEqual(under("sub/d.md", "sub/deep/f.md"));
    expect(await matches("sub/**/f.md")).toEqual(under("sub/deep/f.md"));
  });

  it("a prefix that climbs and returns is lexical: `../proj/a.md` is /v/proj/a.md", async () => {
    expect(await matches("../proj/a.md")).toEqual(under("a.md"));
  });

  it("returns files only: a pattern naming a directory matches nothing", async () => {
    expect(await matches("sub/deep")).toEqual([]);
    expect(await matches("sub/*")).toEqual(under("sub/d.md", "sub/e.txt")); // `deep` is a directory
  });

  it("an empty match is an empty list, ok, with no diagnostic", async () => {
    const { result } = await expandPatterns(world, ["*.zzz"]);
    expect(result.expansions).toHaveLength(1);
    expect(result.expansions[0]).toMatchObject({ ok: true, matches: [] });
    expect(result.diagnostics).toEqual([]);
  });

  it("a value with no wildcard names one file: it matches that file if it exists, and nothing if it does not", async () => {
    expect(await matches("sub/e.txt")).toEqual(under("sub/e.txt"));
    expect(await matches("sub/nope.txt")).toEqual([]);
    expect(await matches("c.txt")).toEqual(under("c.txt")); // a one-segment pattern is anchored at its own directory
  });

  it("segments that are `.` are the directory itself", async () => {
    expect(await matches("./a.md")).toEqual(under("a.md"));
    expect(await matches("sub/./e.txt")).toEqual(under("sub/e.txt"));
  });

  it("collapses nothing it should not: `**/**/*.md` is `**/*.md`", async () => {
    expect(await matches("**/**/*.md")).toEqual(await matches("**/*.md"));
  });
});

describe("v1.14 FR-014 -- a wildcard never matches a leading dot, and ** never descends into a dot directory", () => {
  const world: World = { files: TREE };
  const matches = async (pattern: string): Promise<string[]> => locations((await expandPatterns(world, [pattern])).result.expansions[0]);

  it("`*` skips `.hidden.md`; a literal dot finds it", async () => {
    expect(await matches("*")).toEqual(under("a.md", "b.md", "c.txt", "café.md", "config.yaml", "schema.yaml", "日本.md"));
    expect(await matches(".hidden.md")).toEqual(under(".hidden.md"));
  });

  it("`.*` is a literal dot then anything: it finds the dotfile (and not the directory .git)", async () => {
    expect(await matches(".*")).toEqual(under(".hidden.md"));
  });

  it("a literal dot directory is entered, and what is in it matches ordinarily", async () => {
    expect(await matches(".git/*.md")).toEqual(under(".git/g.md"));
    expect(await matches(".git/**")).toEqual(under(".git/g.md"));
  });

  it("`**/*.md` does not find .git/g.md", async () => {
    expect(await matches("**/*.md")).not.toContain(`${P}.git/g.md`);
  });

  it("`**/.hidden.md` -- a literal dot name below a double star -- is found where it sits", async () => {
    expect(await matches("**/.hidden.md")).toEqual(under(".hidden.md"));
  });

  it("`?` does not match a leading dot either: `?hidden.md` is not `.hidden.md`", async () => {
    expect(await matches("?hidden.md")).toEqual([]);
  });
});

describe("v1.14 FR-015 -- names are compared exactly, by code point, as the host lists them", () => {
  it("a composed name is not a decomposed one: each spelling finds only itself", async () => {
    const world: World = { files: { "/v/proj/n1/café.md": "", "/v/proj/n2/café.md": "" } };
    const matches = async (pattern: string): Promise<string[]> => locations((await expandPatterns(world, [pattern])).result.expansions[0]);
    expect(await matches("n1/café.md")).toEqual(under("n1/café.md"));
    expect(await matches("n1/café.md")).toEqual([]);
    expect(await matches("n2/café.md")).toEqual(under("n2/café.md"));
    expect(await matches("n2/café.md")).toEqual([]);
    // `?` counts code points: the decomposed name has five before the dot, the composed four.
    expect(await matches("n1/????.md")).toEqual(under("n1/café.md"));
    expect(await matches("n2/?????.md")).toEqual(under("n2/café.md"));
    expect(await matches("n2/????.md")).toEqual([]);
  });

  it("`?` is one code point above the BMP (two UTF-16 units)", async () => {
    const world: World = { files: { "/v/proj/\u{1F600}.md": "", "/v/proj/ab.md": "" } };
    const matches = async (pattern: string): Promise<string[]> => locations((await expandPatterns(world, [pattern])).result.expansions[0]);
    expect(await matches("?.md")).toEqual(under("\u{1F600}.md"));
    expect(await matches("??.md")).toEqual(under("ab.md"));
  });

  it("there is no case folding: a.md is not A.md", async () => {
    const world: World = { files: { "/v/proj/Readme.md": "" } };
    const matches = async (pattern: string): Promise<string[]> => locations((await expandPatterns(world, [pattern])).result.expansions[0]);
    expect(await matches("readme.md")).toEqual([]);
    expect(await matches("Readme.md")).toEqual(under("Readme.md"));
    expect(await matches("r*.md")).toEqual([]);
  });
});

describe("v1.14 FR-016 -- one list whatever order the host lists in, sorted by code point, one match per physical file", () => {
  it("the same files given in two orders give one result, whole", async () => {
    const entries = Object.entries(TREE);
    const forward = await expandPatterns({ files: Object.fromEntries(entries) }, ["**/*.md", "*"]);
    const backward = await expandPatterns({ files: Object.fromEntries([...entries].reverse()) }, ["**/*.md", "*"]);
    expect(backward.result).toEqual(forward.result);
    expect(forward.result.expansions).toHaveLength(2);
  });

  it("sorts by code point, not UTF-16: U+FF5E (one unit) before U+10000 (two, the first of which is lower)", async () => {
    const world: World = { files: { "/v/proj/\u{10000}.md": "", "/v/proj/～.md": "" } };
    // By code point: U+FF5E < U+10000. By UTF-16 unit: 0xD800 (the lead surrogate of U+10000) < 0xFF5E, the other way round.
    expect(locations((await expandPatterns(world, ["*.md"])).result.expansions[0])).toEqual(under("～.md", "\u{10000}.md"));
  });

  it("two routes to one file by file links are one match, named by the smaller logical path, with its physical path beside it", async () => {
    const world: World = { files: { "/v/proj/real.md": "" }, links: { "/v/proj/a.md": "/v/proj/real.md", "/v/proj/z.md": "/v/proj/real.md" } };
    const { result } = await expandPatterns(world, ["*.md"]);
    const expansion = result.expansions[0];
    expect(locations(expansion)).toEqual(under("a.md"));
    expect(expansion?.ok && expansion.matches[0]).toMatchObject({ location: `${P}a.md`, physical: `${P}real.md` });
  });

  it("two routes by a linked directory are one match, named by the route that is smaller as a whole path: a-b/ before a/ ('-' < '/')", async () => {
    // `a` is the real directory and `a-b` links to it. Sorted by directory *name* a comes first; the smaller *path* is a-b/x.md,
    // because 0x2d ('-') < 0x2f ('/'). The match must be named a-b/x.md whichever the host lists first.
    const files = { "/v/proj/a/x.md": "" };
    const links = { "/v/proj/a-b": "/v/proj/a" };
    for (const order of [(host: Host) => host, reversing]) {
      const memory = createMemoryHost({ files: { ...files, "/v/proj/schema.yaml": SCHEMA_LIST, "/v/proj/config.yaml": `$schema: ./schema.yaml\ninclude:\n${quoted(["**/*.md"])}` }, links });
      const loaded = await load("/v/proj/config.yaml", { host: memory, sandboxRoot: "/v" });
      if (!loaded.ok) throw new Error("does not load");
      const result = await expand(loaded.configuration, { host: order(memory), sandboxRoot: "/v" });
      expect(locations(result.expansions[0])).toEqual(under("a-b/x.md"));
      const first = result.expansions[0];
      expect(first?.ok && first.matches[0]?.physical).toBe(`${P}a/x.md`);
    }
  });

  it("and a link that sorts after the real directory loses to it", async () => {
    const world: World = { files: { "/v/proj/real/x.md": "" }, links: { "/v/proj/zlink": "/v/proj/real" } };
    const { result } = await expandPatterns(world, ["**/*.md"]);
    expect(locations(result.expansions[0])).toEqual(under("real/x.md"));
  });

  it("a match through a linked directory carries its physical path; a plain match carries none", async () => {
    const world: World = { files: { "/v/lib/docs/x.md": "", "/v/proj/plain.md": "" }, links: { "/v/proj/docs": "/v/lib/docs" } };
    const { result } = await expandPatterns(world, ["docs/*.md", "*.md"]);
    const linked = result.expansions[0];
    expect(linked?.ok && linked.matches).toEqual([{ location: `${P}docs/x.md`, physical: "/v/lib/docs/x.md", span: linked?.span }]);
    const plain = result.expansions[1];
    expect(plain?.ok && plain.matches).toHaveLength(1);
    expect(plain?.ok && plain.matches[0]).not.toHaveProperty("physical");
  });

  it("each match carries the pattern's span: the value, in the document that wrote it", async () => {
    const { result } = await expandPatterns({ files: TREE }, ["*.md"]);
    const expansion = result.expansions[0];
    // `$schema: ./schema.yaml\n` is 23 bytes and `include:\n` 9, so `  - "*.md"` starts at 32 and its value at 36; `"*.md"` is 6 bytes.
    expect(expansion).toMatchObject({ ok: true, pointer: "/include/0", pattern: "*.md", span: { start: 36, end: 42, line: 3, column: 5 } });
    expect(expansion?.ok && expansion.matches.every((match) => match.span === expansion.span)).toBe(true);
    expect(expansion?.span.origin.id).toBe("/v/proj/config.yaml");
  });
});

describe("v1.14 FR-013 -- a directory is listed once under one physical path; a link cycle ends", () => {
  it("lists each directory once even though `**` asks about it at two places in the pattern", async () => {
    const { result, lists } = await expandPatterns({ files: TREE }, ["**/*.md"]);
    expect(locations(result.expansions[0])).toHaveLength(6);
    // /v/proj, /v/proj/sub, /v/proj/sub/deep -- and not /v/proj/.git (a dot directory) nor any of them twice.
    expect([...lists].sort()).toEqual(["/v/proj", "/v/proj/sub", "/v/proj/sub/deep"]);
  });

  it("terminates on a link to an ancestor, finding what is really there once", async () => {
    const world: World = { files: TREE, links: { "/v/proj/loop": "/v/proj", "/v/proj/sub/up": "/v/proj/sub" } };
    const { result, lists } = await expandPatterns(world, ["**/*.md"]);
    expect(locations(result.expansions[0])).toEqual(under("a.md", "b.md", "café.md", "sub/d.md", "sub/deep/f.md", "日本.md"));
    expect([...lists].sort()).toEqual(["/v/proj", "/v/proj/sub", "/v/proj/sub/deep"]);
  });

  it("two links to each other (a loop with no files) are not entered and not an error", async () => {
    const world: World = { files: { "/v/proj/a.md": "" }, links: { "/v/proj/l1": "/v/proj/l2", "/v/proj/l2": "/v/proj/l1" } };
    const { result } = await expandPatterns(world, ["**/*.md"]);
    expect(locations(result.expansions[0])).toEqual(under("a.md"));
  });
});

describe("v1.14 FR-017 -- confinement: every listed directory and every returned file is judged through its physical path", () => {
  const OUTSIDE: World = {
    files: { "/v/proj/ok.md": "", "/v/proj/sub/s.md": "", "/outside/secret.md": "", "/outside/dir/x.md": "" },
    links: { "/v/proj/out.md": "/outside/secret.md" },
  };
  const OUTSIDE_DIR: World = {
    files: { "/v/proj/ok.md": "", "/outside/secret.md": "", "/outside/dir/x.md": "" },
    links: { "/v/proj/ld": "/outside/dir" },
  };

  it("a file link that leads out refuses that value, with sandbox-escape at the value, naming both paths; the next value still expands", async () => {
    const { result } = await expandPatterns(OUTSIDE, ["*.md", "sub/*.md"]);
    const [first, second] = result.expansions;
    expect(first).toMatchObject({ ok: false, pointer: "/include/0" });
    expect(locations(second)).toEqual(under("sub/s.md"));
    const [diagnostic, ...rest] = result.diagnostics;
    expect(rest).toEqual([]);
    expect(diagnostic).toMatchObject({ code: "sandbox-escape", level: "error", pointer: "/include/0", primary: { line: 3, column: 5, start: 36 } });
    expect(diagnostic?.message).toContain(`'${P}out.md' (the file '/outside/secret.md')`);
    expect(diagnostic?.message).toContain("'/v'");
    expect(first?.ok === false && first.diagnostics).toEqual([diagnostic]);
  });

  it("a directory link that leads out refuses the value the walk would have entered it for, even a `**` that would not have matched in it", async () => {
    const { result } = await expandPatterns(OUTSIDE_DIR, ["**/*.md"]);
    expect(result.expansions[0]).toMatchObject({ ok: false });
    expect(result.diagnostics.map((d) => d.code)).toEqual(["sandbox-escape"]);
    expect(result.diagnostics[0]?.message).toContain(`'${P}ld' (the file '/outside/dir')`);
  });

  it("a literal prefix that is itself a link out is refused before it is listed", async () => {
    const { result, lists } = await expandPatterns(OUTSIDE_DIR, ["ld/*.md"]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["sandbox-escape"]);
    expect(lists).toEqual([]);
  });

  it("a literal prefix that climbs out is refused before it is listed", async () => {
    const { result, lists } = await expandPatterns(OUTSIDE_DIR, ["../../outside/*.md", "/outside/dir/x.md"]);
    expect(result.diagnostics.map((d) => [d.code, d.pointer])).toEqual([
      ["sandbox-escape", "/include/0"],
      ["sandbox-escape", "/include/1"],
    ]);
    expect(lists).toEqual([]);
  });

  it("with the other root granted, the same link is inside: roots are a list, as for resolve()", async () => {
    const { result } = await expandPatterns(OUTSIDE_DIR, ["ld/*.md"], { sandboxRoot: ["/v", "/outside"] });
    expect(locations(result.expansions[0])).toEqual(under("ld/x.md"));
    const expansion = result.expansions[0];
    expect(expansion?.ok && expansion.matches[0]?.physical).toBe("/outside/dir/x.md");
  });

  it("a root that is the root of the file system admits everything", async () => {
    const { result } = await expandPatterns(OUTSIDE_DIR, ["../../outside/*.md"], { sandboxRoot: "/" });
    expect(locations(result.expansions[0])).toEqual(["/outside/secret.md"]);
  });
});

describe("v1.14 FR-018 -- refusals are data, positioned at the value, one reason each", () => {
  const world: World = { files: TREE };

  it("host-cannot-list: a host without `list` loads and validates, and expand() refuses each value by name", async () => {
    const memory = createMemoryHost({ files: { ...TREE, "/v/proj/schema.yaml": SCHEMA_LIST, "/v/proj/config.yaml": `$schema: ./schema.yaml\ninclude:\n${quoted(["*.md", "sub/*.md"])}` } });
    const { list: _list, ...withoutList } = memory;
    expect(withoutList).not.toHaveProperty("list");
    const loaded = await load("/v/proj/config.yaml", { host: withoutList, sandboxRoot: "/v" });
    expect(loaded.ok).toBe(true); // FR-019: every stage before expand() is unchanged
    if (!loaded.ok) return;
    const result = await expand(loaded.configuration, { host: withoutList, sandboxRoot: "/v" });
    expect(result.diagnostics.map((d) => [d.code, d.pointer])).toEqual([
      ["host-cannot-list", "/include/0"],
      ["host-cannot-list", "/include/1"],
    ]);
    expect(result.diagnostics[0]).toMatchObject({ level: "error", primary: { line: 3, column: 5 } });
    expect(result.expansions.map((e) => e.ok)).toEqual([false, false]);
  });

  it("directory-unlistable: the host said no for a directory the walk needed; its reason is in the message; other values expand", async () => {
    const memory = createMemoryHost({ files: { ...TREE, "/v/proj/schema.yaml": SCHEMA_LIST, "/v/proj/config.yaml": `$schema: ./schema.yaml\ninclude:\n${quoted(["sub/*.md", "*.md"])}` } });
    const { host } = counted(memory, { "/v/proj/sub": "permission denied (a test)" });
    const loaded = await load("/v/proj/config.yaml", { host: memory, sandboxRoot: "/v" });
    if (!loaded.ok) throw new Error("does not load");
    const result = await expand(loaded.configuration, { host, sandboxRoot: "/v" });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: "directory-unlistable", level: "error", pointer: "/include/0", primary: { line: 3, column: 5 } });
    expect(result.diagnostics[0]?.message).toContain("'/v/proj/sub'");
    expect(result.diagnostics[0]?.message).toContain("permission denied (a test)");
    expect(locations(result.expansions[1])).toEqual(under("a.md", "b.md", "café.md", "日本.md"));
  });

  it("directory-unlistable: a literal prefix naming a directory that is not there", async () => {
    const { result } = await expandPatterns(world, ["nodir/x.md"]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["directory-unlistable"]);
    expect(result.diagnostics[0]?.message).toContain("'/v/proj/nodir'");
  });

  it("glob-in-remote-document: a pattern a remote document wrote is never expanded, and the host is never asked", async () => {
    const schema = "keys:\n  include:\n    demand:\n      type: glob[]\n    cascade: append\n    provide: ['assets/*.css']\n";
    const recording: Recording = { url: "https://example.test/s.yaml", method: "GET", outcome: { kind: "response", response: { status: 200, headers: { "cache-control": "immutable" }, body: new TextEncoder().encode(schema) } } };
    const memory = createMemoryHost({ files: { ...TREE, "/v/proj/config.yaml": `$schema: https://example.test/s.yaml\ninclude:\n${quoted(["*.md"])}` } });
    const { host, lists } = counted(memory);
    const loaded = await load("/v/proj/config.yaml", { host: memory, sandboxRoot: "/v", transport: new RecordedTransport([recording]) });
    if (!loaded.ok) throw new Error(loaded.diagnostics.map((d) => d.message).join("; "));
    const result = await expand(loaded.configuration, { host, sandboxRoot: "/v" });
    // The merged list is [the remote document's pattern, the config's own], in layer order.
    expect(result.expansions.map((e) => [e.pointer, e.ok])).toEqual([
      ["/include/0", false],
      ["/include/1", true],
    ]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: "glob-in-remote-document", pointer: "/include/0" });
    expect(result.diagnostics[0]?.primary.origin.id).toBe("https://example.test/s.yaml");
    expect(result.diagnostics[0]?.message).toContain("https://example.test/s.yaml");
    expect(lists).toEqual(["/v/proj"]); // only the local pattern's directory
  });

  it("glob-limit-exceeded: more entries than limits.maxEntriesVisited -- exactly at the cap is fine, one over is not", async () => {
    // /v/proj holds x/, schema.yaml, config.yaml (3 names) and /v/proj/x holds 1.md 2.md 3.md (3 names).
    const small: World = { files: { "/v/proj/x/1.md": "", "/v/proj/x/2.md": "", "/v/proj/x/3.md": "" } };
    const atCap = await expandPatterns(small, ["x/*.md"], { limits: { maxEntriesVisited: 3 } });
    expect(locations(atCap.result.expansions[0])).toEqual(under("x/1.md", "x/2.md", "x/3.md"));
    const over = await expandPatterns(small, ["x/*.md"], { limits: { maxEntriesVisited: 2 } });
    expect(over.result.diagnostics.map((d) => d.code)).toEqual(["glob-limit-exceeded"]);
    expect(over.result.diagnostics[0]).toMatchObject({ pointer: "/include/0", primary: { line: 3, column: 5 } });
    expect(over.result.diagnostics[0]?.message).toContain("2");
    // `**/*.md` lists both directories: 3 + 3 = 6 names.
    expect(locations((await expandPatterns(small, ["**/*.md"], { limits: { maxEntriesVisited: 6 } })).result.expansions[0])).toHaveLength(3);
    expect((await expandPatterns(small, ["**/*.md"], { limits: { maxEntriesVisited: 5 } })).result.diagnostics.map((d) => d.code)).toEqual(["glob-limit-exceeded"]);
  });

  it("the cap is per value: one value over it does not starve the next", async () => {
    const small: World = { files: { "/v/proj/x/1.md": "", "/v/proj/x/2.md": "", "/v/proj/x/3.md": "" } };
    const { result } = await expandPatterns(small, ["**/*.md", "x/*.md"], { limits: { maxEntriesVisited: 3 } });
    expect(result.expansions.map((e) => e.ok)).toEqual([false, true]);
  });

  it("the default cap is 100,000 entries", async () => {
    const { DEFAULT_MAX_ENTRIES_VISITED } = await import("../../src/expand/expand.js");
    expect(DEFAULT_MAX_ENTRIES_VISITED).toBe(100_000);
  });

  it("expand() throws for programmer error only: no host, a host that cannot canonicalize, no sandbox root", async () => {
    const { configuration } = await expandPatterns(world, ["*.md"]);
    await expect(expand(configuration, { sandboxRoot: "/v" } as never)).rejects.toThrow(/requires 'host'/);
    await expect(expand(configuration, { host: {} as never, sandboxRoot: "/v" })).rejects.toThrow(/requires 'host'/);
    await expect(expand(configuration, { host: createMemoryHost() } as never)).rejects.toThrow(/requires 'sandboxRoot'/);
    await expect(expand(configuration, { host: createMemoryHost(), sandboxRoot: [] })).rejects.toThrow(/requires 'sandboxRoot'/);
  });
});

describe("v1.14 FR-012 -- which values are expanded: every value at a position whose accumulated type admits glob", () => {
  const FILES: World = { files: { ...TREE, "/v/proj/docs/readme.md": "", "/v/proj/docs/more.md": "" } };

  it("glob[] under cascade: append -- each match names its own layer", async () => {
    const files = {
      ...TREE,
      "/v/house/assets/theme.css": "",
      "/v/house/schema.yaml": "keys:\n  include:\n    demand:\n      type: glob[]\n    cascade: append\n    provide: ['assets/*.css']\n",
      "/v/proj/config.yaml": `$schema: ../house/schema.yaml\ninclude:\n${quoted(["*.md"])}`,
    };
    const memory = createMemoryHost({ files });
    const loaded = await load("/v/proj/config.yaml", { host: memory, sandboxRoot: "/v" });
    if (!loaded.ok) throw new Error(loaded.diagnostics.map((d) => d.message).join("; "));
    const result = await expand(loaded.configuration, { host: memory, sandboxRoot: "/v" });
    expect(result.expansions.map((e) => [e.pointer, e.pattern, e.span.origin.id])).toEqual([
      ["/include/0", "assets/*.css", "/v/house/schema.yaml"],
      ["/include/1", "*.md", "/v/proj/config.yaml"],
    ]);
    expect(locations(result.expansions[0])).toEqual(["/v/house/assets/theme.css"]); // anchored at the schema's own directory
    expect(locations(result.expansions[1])).toEqual(under("a.md", "b.md", "café.md", "日本.md"));
    expect(result.expansions[0]?.span.line).toBe(6);
    expect(result.expansions[1]?.span.line).toBe(3);
  });

  it("a `path | glob` position: a value there is expanded as a pattern, a one-file pattern if it has no wildcard; a path that is no glob is left alone", async () => {
    const schema = "keys:\n  include:\n    demand:\n      type: '(path | glob)[]'\n";
    const { result } = await expandPatterns(FILES, ["docs/readme.md", "docs/*.md", "[x]"], {}, schema);
    expect(result.expansions.map((e) => e.pointer)).toEqual(["/include/0", "/include/1"]); // `[x]` is a path, not a glob: untouched
    expect(locations(result.expansions[0])).toEqual(under("docs/readme.md"));
    expect(locations(result.expansions[1])).toEqual(under("docs/more.md", "docs/readme.md"));
  });

  it("a single glob (not a list)", async () => {
    const memory = createMemoryHost({ files: { ...TREE, "/v/proj/schema.yaml": "keys:\n  one:\n    demand: { type: glob }\n", "/v/proj/config.yaml": "$schema: ./schema.yaml\none: '*.md'\n" } });
    const loaded = await load("/v/proj/config.yaml", { host: memory, sandboxRoot: "/v" });
    if (!loaded.ok) throw new Error("does not load");
    const result = await expand(loaded.configuration, { host: memory, sandboxRoot: "/v" });
    expect(result.expansions.map((e) => e.pointer)).toEqual(["/one"]);
  });

  it("a value at a position that does not admit glob is untouched, even if it looks like a pattern", async () => {
    const schema = "keys:\n  include:\n    demand:\n      type: glob[]\n  title:\n    demand: { type: string }\n";
    const memory = createMemoryHost({ files: { ...TREE, "/v/proj/schema.yaml": schema, "/v/proj/config.yaml": `$schema: ./schema.yaml\ninclude:\n${quoted(["*.md"])}title: '*.md'\nextra: '*.md'\n` } });
    const loaded = await load("/v/proj/config.yaml", { host: memory, sandboxRoot: "/v" });
    if (!loaded.ok) throw new Error(loaded.diagnostics.map((d) => d.message).join("; "));
    const result = await expand(loaded.configuration, { host: memory, sandboxRoot: "/v" });
    expect(result.expansions.map((e) => e.pointer)).toEqual(["/include/0"]);
  });

  it("globs nested under `values`, and under a mapping's named keys", async () => {
    const schema = "keys:\n  sources:\n    demand:\n      type: mapping\n      values:\n        type: glob[]\n  release:\n    demand:\n      type: mapping\n      keys:\n        files:\n          demand: { type: 'glob[]' }\n";
    const memory = createMemoryHost({ files: { ...TREE, "/v/proj/schema.yaml": schema, "/v/proj/config.yaml": "$schema: ./schema.yaml\nsources:\n  docs: ['*.md']\n  code: ['sub/*.md']\nrelease:\n  files: ['*.md']\n" } });
    const loaded = await load("/v/proj/config.yaml", { host: memory, sandboxRoot: "/v" });
    if (!loaded.ok) throw new Error(loaded.diagnostics.map((d) => d.message).join("; "));
    const result = await expand(loaded.configuration, { host: memory, sandboxRoot: "/v" });
    expect(result.expansions.map((e) => e.pointer)).toEqual(["/release/files/0", "/sources/code/0", "/sources/docs/0"]);
  });

  it("through a named type: a type that is glob[], and a type that is a mapping with a glob key", async () => {
    const schema = "types:\n  fileset:\n    demand: { type: 'glob[]' }\n  bundle:\n    demand:\n      type: mapping\n      keys:\n        files:\n          demand: { type: fileset }\nkeys:\n  include:\n    demand: { type: fileset }\n  release:\n    demand: { type: bundle }\n";
    const memory = createMemoryHost({ files: { ...TREE, "/v/proj/schema.yaml": schema, "/v/proj/config.yaml": "$schema: ./schema.yaml\ninclude: ['*.md']\nrelease:\n  files: ['sub/*.md']\n" } });
    const loaded = await load("/v/proj/config.yaml", { host: memory, sandboxRoot: "/v" });
    if (!loaded.ok) throw new Error(loaded.diagnostics.map((d) => d.message).join("; "));
    const result = await expand(loaded.configuration, { host: memory, sandboxRoot: "/v" });
    expect(result.expansions.map((e) => e.pointer)).toEqual(["/include/0", "/release/files/0"]);
  });

  it("a configuration that was never validated: a value outside the grammar is simply not a pattern", async () => {
    const memory = createMemoryHost({ files: { ...TREE, "/v/proj/schema.yaml": "keys:\n  include:\n    demand: { type: 'glob[]' }\n", "/v/proj/config.yaml": "$schema: ./schema.yaml\ninclude: ['[ab].md', '*.md']\n" } });
    const resolved = await resolve("/v/proj/config.yaml", { host: memory, sandboxRoot: "/v" });
    if (!resolved.ok) throw new Error("does not resolve");
    const merged = merge(resolved);
    if (!merged.ok) throw new Error("does not merge");
    const result = await expand(merged.configuration, { host: memory, sandboxRoot: "/v" });
    expect(result.expansions.map((e) => e.pointer)).toEqual(["/include/1"]);
  });

  it("a configuration with no schema layer has no position that admits glob: nothing is expanded", async () => {
    const memory = createMemoryHost({ files: { "/v/proj/config.yaml": "include: ['*.md']\n" } });
    const loaded = await load("/v/proj/config.yaml", { host: memory, sandboxRoot: "/v" });
    if (!loaded.ok) throw new Error("does not load");
    expect(await expand(loaded.configuration, { host: memory, sandboxRoot: "/v" })).toEqual({ expansions: [], diagnostics: [] });
  });
});

describe("v1.14 FR-012 -- expand() is a stage of its own: load() never calls it", () => {
  it("load() with a counting host never lists a directory", async () => {
    const memory = createMemoryHost({ files: { ...TREE, "/v/proj/schema.yaml": SCHEMA_LIST, "/v/proj/config.yaml": `$schema: ./schema.yaml\ninclude:\n${quoted(["**/*.md"])}` } });
    const { host, lists } = counted(memory);
    const loaded = await load("/v/proj/config.yaml", { host, sandboxRoot: "/v" });
    expect(loaded.ok).toBe(true);
    expect(lists).toEqual([]);
  });
});

