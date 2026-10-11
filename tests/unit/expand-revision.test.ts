/**
 * v1.14 FR-024 to FR-027 -- the owner's rulings after the coordinator's review (specs/024-glob, Part B').
 *
 * Written before the code that satisfies them. Every list is derived by hand from the world in the test; work is counted, never timed.
 *
 *   FR-024  a literal segment is found as a path is (canonicalize, then the kind), not by exact name in a listing;
 *           only `*`, `?` and `**` compare names, by code point, as listed.
 *   FR-025  resolve() records its sandbox roots, merge() carries them, expand()'s `sandboxRoot` is optional.
 *   FR-026  a missing directory matches nothing; directory-unlistable is for one that exists and is refused.
 *   FR-027  the limit counts work: each (directory, pattern position) entered plus each entry examined there.
 */

import { describe, expect, it } from "vitest";
import { expand, load, merge, resolve } from "../../src/index.js";
import { createMemoryHost } from "../../src/host/memory.js";
import { counted, expandPatterns, fanTree, folding, locations, quoted, SCHEMA_LIST, TREE, type World } from "./expand-helpers.js";

const P = "/v/proj/";
const under = (...names: string[]): string[] => names.map((name) => `${P}${name}`);
const COMPOSED = "café";
const DECOMPOSED = "café";

describe("v1.14 FR-024 -- literal segments are found as a path is; wildcard segments compare names exactly", () => {
  // n1 holds a composed name, n2 a decomposed one; a disk that folds normalization finds either through the other spelling.
  const world: World = { files: { [`/v/proj/n1/${COMPOSED}.md`]: "", [`/v/proj/n2/${DECOMPOSED}.md`]: "", [`/v/proj/${COMPOSED}/in.md`]: "", "/v/proj/plain/x.md": "" } };
  const onFolding = async (...patterns: string[]) => (await expandPatterns(world, patterns, {}, SCHEMA_LIST, folding)).result.expansions;

  it("the last literal: `café.md` written decomposed finds the file stored composed -- named as written, with the stored name as physical", async () => {
    const [found] = await onFolding(`n1/${DECOMPOSED}.md`);
    expect(locations(found)).toEqual([`${P}n1/${DECOMPOSED}.md`]);
    expect(found?.ok && found.matches[0]?.physical).toBe(`${P}n1/${COMPOSED}.md`);
  });

  it("and the other way round", async () => {
    const [found] = await onFolding(`n2/${COMPOSED}.md`);
    expect(locations(found)).toEqual([`${P}n2/${COMPOSED}.md`]);
    expect(found?.ok && found.matches[0]?.physical).toBe(`${P}n2/${DECOMPOSED}.md`);
  });

  it("a literal after a wildcard is a literal: `*/café.md` finds the decomposed-stored file in n2 (and the composed one in n1, as itself)", async () => {
    const [found] = await onFolding(`*/${COMPOSED}.md`);
    expect(locations(found)).toEqual([`${P}n1/${COMPOSED}.md`, `${P}n2/${COMPOSED}.md`]);
    const matches = found?.ok ? found.matches : [];
    expect(matches[0]).not.toHaveProperty("physical");
    expect(matches[1]?.physical).toBe(`${P}n2/${DECOMPOSED}.md`);
  });

  it("the literal prefix too: `café/` written decomposed enters the directory stored composed", async () => {
    const [found] = await onFolding(`${DECOMPOSED}/in.md`, `${DECOMPOSED}/*.md`);
    expect(locations(found)).toEqual([`${P}${DECOMPOSED}/in.md`]);
    // The wildcard under that directory lists it as stored: its names are the listing's.
    expect(locations((await onFolding(`${DECOMPOSED}/*.md`))[0])).toEqual([`${P}${DECOMPOSED}/in.md`]);
  });

  it("wildcard matching stays exact on the same disk: `?` counts the stored code points, and a name is matched as listed", async () => {
    expect(locations((await onFolding("n2/????.md"))[0])).toEqual([]); // the stored name has five code points before the dot
    expect(locations((await onFolding("n2/?????.md"))[0])).toEqual([`${P}n2/${DECOMPOSED}.md`]);
    expect(locations((await onFolding("n1/caf?.md"))[0])).toEqual([`${P}n1/${COMPOSED}.md`]);
    expect(locations((await onFolding(`n2/${COMPOSED.slice(0, 3)}*.md`))[0])).toEqual([`${P}n2/${DECOMPOSED}.md`]);
  });

  it("on a disk that is exact (the memory host) a literal in the other spelling finds nothing: FR-024 asks the host, and the host says no", async () => {
    const [found] = (await expandPatterns(world, [`n1/${DECOMPOSED}.md`])).result.expansions;
    expect(locations(found)).toEqual([]);
  });

  it("a literal last segment costs the host two questions and no scan: canonicalize it, then ask its stored parent what it is", async () => {
    const { result, lists } = await expandPatterns({ files: TREE }, ["sub/e.txt"]);
    expect(locations(result.expansions[0])).toEqual(under("sub/e.txt"));
    expect(lists).toEqual(["/v/proj/sub"]);
  });

  it("a literal that is a directory is not a file; one that is a file is not a directory", async () => {
    const { result } = await expandPatterns({ files: TREE }, ["sub/deep", "a.md/x.md", "a.md/*.md", "*/a.md"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.expansions.map((e) => e.ok && e.matches)).toEqual([[], [], [], []]);
  });

  it("a literal that is a link to a file inside the sandbox: named as written, physical is the target", async () => {
    const w: World = { files: { "/v/lib/real.md": "" }, links: { "/v/proj/alias.md": "/v/lib/real.md" } };
    const { result } = await expandPatterns(w, ["alias.md"]);
    const found = result.expansions[0];
    expect(locations(found)).toEqual([`${P}alias.md`]);
    expect(found?.ok && found.matches[0]?.physical).toBe("/v/lib/real.md");
  });

  it("a literal that leads out of the sandbox is refused as any other file is (v1.14 FR-017)", async () => {
    const w: World = { files: { "/outside/secret.md": "" }, links: { "/v/proj/out.md": "/outside/secret.md" } };
    const { result } = await expandPatterns(w, ["out.md"]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["sandbox-escape"]);
  });
});

describe("v1.14 FR-026 -- a missing directory matches nothing; unlistable is only for one that exists and is refused", () => {
  const world: World = { files: TREE };

  it("a literal after a wildcard that is not there: that branch matches nothing, the others still match", async () => {
    const { result } = await expandPatterns(world, ["*/e.txt", "*/nodir/x.md", "**/nodir/x.md"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.expansions.map((e) => e.ok && e.matches.map((m) => m.location))).toEqual([[`${P}sub/e.txt`], [], []]);
  });

  it("a value whose every branch is missing has an empty list, not a diagnostic", async () => {
    const { result } = await expandPatterns(world, ["x/y/z/*.md"]);
    expect(result.expansions[0]).toMatchObject({ ok: true, matches: [] });
    expect(result.diagnostics).toEqual([]);
  });

  it("a directory link to nowhere is missing", async () => {
    const w: World = { files: { "/v/proj/a.md": "" }, links: { "/v/proj/gone": "/v/proj/nowhere" } };
    const { result } = await expandPatterns(w, ["gone/*.md", "**/*.md"]);
    expect(result.diagnostics).toEqual([]);
    expect(locations(result.expansions[1])).toEqual(under("a.md"));
  });

  it("an existing directory the host refuses is still directory-unlistable -- and a file where a directory was wanted is not that", async () => {
    const memory = createMemoryHost({ files: { ...TREE, "/v/proj/schema.yaml": SCHEMA_LIST, "/v/proj/config.yaml": `$schema: ./schema.yaml\ninclude:\n${quoted(["sub/*.md", "a.md/*.md"])}` } });
    const { host } = counted(memory, { "/v/proj/sub": "permission denied (a test)", "/v/proj/a.md": "not a directory (a test)" });
    const loaded = await load("/v/proj/config.yaml", { host: memory, sandboxRoot: "/v" });
    if (!loaded.ok) throw new Error("does not load");
    const result = await expand(loaded.configuration, { host, sandboxRoot: "/v" });
    expect(result.diagnostics.map((d) => [d.code, d.pointer])).toEqual([["directory-unlistable", "/include/0"]]);
    expect(result.expansions[1]).toMatchObject({ ok: true, matches: [] });
  });

  it("a missing directory outside the sandbox is still a sandbox-escape, not an empty list: confinement is judged first", async () => {
    const { result } = await expandPatterns(world, ["../../nowhere/*.md"]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["sandbox-escape"]);
  });
});

describe("v1.14 FR-025 -- the configuration remembers its sandbox roots", () => {
  const files = { ...TREE, "/outside/dir/x.md": "", "/v/proj/schema.yaml": SCHEMA_LIST, "/v/proj/config.yaml": `$schema: ./schema.yaml\ninclude:\n${quoted(["ld/*.md", "a.md"])}` };
  const links = { "/v/proj/ld": "/outside/dir" };

  it("resolve() records the roots as granted, absolute, in order; merge() carries them to the configuration", async () => {
    const host = createMemoryHost({ files, links });
    const resolved = await resolve("/v/proj/config.yaml", { host, sandboxRoot: ["/v", "/outside"] });
    if (!resolved.ok) throw new Error("does not resolve");
    expect(resolved.sandboxRoots).toEqual(["/v", "/outside"]);
    const merged = merge(resolved);
    if (!merged.ok) throw new Error("does not merge");
    expect(merged.configuration.sandboxRoots).toEqual(["/v", "/outside"]);
    const single = await resolve("/v/proj/config.yaml", { host, sandboxRoot: "/v" });
    expect(single.ok && single.sandboxRoots).toEqual(["/v"]);
  });

  it("expand() with no sandboxRoot uses them: the same refusal, and the same match, as passing them", async () => {
    const host = createMemoryHost({ files, links });
    const narrow = await load("/v/proj/config.yaml", { host, sandboxRoot: "/v" });
    const wide = await load("/v/proj/config.yaml", { host, sandboxRoot: ["/v", "/outside"] });
    if (!narrow.ok || !wide.ok) throw new Error("does not load");
    const refused = await expand(narrow.configuration, { host });
    expect(refused.diagnostics.map((d) => d.code)).toEqual(["sandbox-escape"]);
    expect(refused.expansions[1] && locations(refused.expansions[1])).toEqual(under("a.md"));
    expect(locations((await expand(wide.configuration, { host })).expansions[0])).toEqual(under("ld/x.md"));
  });

  it("an explicit sandboxRoot replaces them for that call", async () => {
    const host = createMemoryHost({ files, links });
    const narrow = await load("/v/proj/config.yaml", { host, sandboxRoot: "/v" });
    const wide = await load("/v/proj/config.yaml", { host, sandboxRoot: ["/v", "/outside"] });
    if (!narrow.ok || !wide.ok) throw new Error("does not load");
    expect(locations((await expand(narrow.configuration, { host, sandboxRoot: ["/v", "/outside"] })).expansions[0])).toEqual(under("ld/x.md"));
    expect((await expand(wide.configuration, { host, sandboxRoot: "/v" })).diagnostics.map((d) => d.code)).toEqual(["sandbox-escape"]);
  });

  it("a configuration that did not come from resolve() records none: with no option either, it is a programmer error", async () => {
    const host = createMemoryHost({ files, links });
    const resolved = await resolve("/v/proj/config.yaml", { host, sandboxRoot: "/v" });
    if (!resolved.ok) throw new Error("does not resolve");
    const merged = merge({ graph: resolved.graph, pedigree: resolved.pedigree });
    if (!merged.ok) throw new Error("does not merge");
    expect(merged.configuration.sandboxRoots).toBeUndefined();
    await expect(expand(merged.configuration, { host })).rejects.toThrow(/requires 'sandboxRoot'/);
  });
});

describe("v1.14 FR-027 -- the frontier's comparison is code point order", () => {
  it("compareRoutes agrees in sign with compareByCodePoint, including across the surrogate range", async () => {
    const { compareRoutes } = await import("../../src/expand/expand.js");
    const { compareByCodePoint } = await import("../../src/model/node.js");
    const samples = ["", "a", "a/", "a-b/", "a/b", "\uff5e", "\u{10000}", "\u{1F600}", "\u{1F601}", "a\u{10000}", "a\uff5e", "\ue000", "\ud7ff", "caf\u00e9/", "cafe\u0301/"];
    for (const a of samples) {
      for (const b of samples) {
        expect(Math.sign(compareRoutes(a, b)), JSON.stringify([a, b])).toBe(Math.sign(compareByCodePoint(a, b)));
      }
    }
  });
});

describe("v1.14 FR-027 -- the limit counts work, not names", () => {
  const schemaAndConfig = (patterns: readonly string[]) => ({ "/v/proj/schema.yaml": SCHEMA_LIST, "/v/proj/config.yaml": `$schema: ./schema.yaml\ninclude:\n${quoted(patterns)}` });

  it("sixty `**` over 5,461 directories is refused at the default limit -- by counting, and without walking the tree", async () => {
    // depth 6, fan-out 4: (4^7 - 1) / 3 = 5,461 directories, an f.md in each. The first build listed each once and never hit its cap (19 s).
    const files = fanTree("/v/proj/t", 6, 4);
    expect(Object.keys(files)).toHaveLength(5_461);
    const pattern = `t/${"**/".repeat(60)}*.md`;
    const { result, lists } = await expandPatterns({ files }, [pattern]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["glob-limit-exceeded"]);
    expect(result.diagnostics[0]?.message).toContain("100000");
    // Refused near 100,000 units of work, so at most that many directories were put to the host.
    expect(lists.length).toBeLessThan(100_000);
  });

  it("and `**/*/` repeated is bounded the same way", async () => {
    const files = fanTree("/v/proj/t", 6, 4);
    const { result } = await expandPatterns({ files }, [`t/${"**/*/".repeat(3)}*.md`]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["glob-limit-exceeded"]);
  });

  it("the same pattern shape is accepted when the limit is raised; the work is derived by hand: (k + 1) x (directories + entries) = 119 (k + 1)", async () => {
    // depth 3, fan-out 3: 1 + 3 + 9 + 27 = 40 directories; the 13 that are not leaves hold 3 subdirectories and an f.md (4 entries),
    // the 27 leaves an f.md (1): 79 entries. Each directory is entered at each of the k `**` positions and the `*.md` position.
    const files = fanTree("/v/proj/t", 3, 3);
    const k = 10;
    const pattern = `t/${"**/".repeat(k)}*.md`;
    const exact = 119 * (k + 1);
    expect(exact).toBe(1_309);
    const at = await expandPatterns({ files }, [pattern], { limits: { maxEntriesVisited: exact } });
    expect(at.result.diagnostics).toEqual([]);
    expect(locations(at.result.expansions[0])).toHaveLength(40);
    const over = await expandPatterns({ files }, [pattern], { limits: { maxEntriesVisited: exact - 1 } });
    expect(over.result.diagnostics.map((d) => d.code)).toEqual(["glob-limit-exceeded"]);
  });

  it("a literal costs one unit and no scan: ten directories in the prefix and a name are 2 -- the state entered (1) and the kind lookup (1)", async () => {
    const dirs = "a/b/c/d/e/f/g/h/i/j";
    const world: World = { files: { [`/v/proj/${dirs}/x.md`]: "" } };
    const at = await expandPatterns(world, [`${dirs}/x.md`], { limits: { maxEntriesVisited: 2 } });
    expect(locations(at.result.expansions[0])).toEqual([`${P}${dirs}/x.md`]);
    expect(at.lists).toEqual([`/v/proj/${dirs}`]);
    expect((await expandPatterns(world, [`${dirs}/x.md`], { limits: { maxEntriesVisited: 1 } })).result.diagnostics.map((d) => d.code)).toEqual(["glob-limit-exceeded"]);
  });
});

