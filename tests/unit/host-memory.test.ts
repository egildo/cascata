/**
 * v1.14 FR-011 -- the memory host beyond `list`: `read`, `canonicalize` (links), `paths`, and no cache.
 */

import { describe, expect, it } from "vitest";
import { posixPaths } from "../../src/paths.js";
import { createMemoryHost } from "../../src/host/memory.js";
import { load } from "../../src/index.js";

const host = createMemoryHost({
  files: { "/p/a.yaml": "k: 1\n", "/p/dir/b.txt": new Uint8Array([104, 105]), "/lib/shared/c.txt": "c" },
  links: { "/p/shared": "/lib/shared", "/p/alias.yaml": "a.yaml", "/p/chain1": "chain2", "/p/chain2": "/p/dir/b.txt", "/p/loop1": "loop2", "/p/loop2": "loop1", "/p/gone": "/nowhere" },
});

describe("v1.14 FR-011 -- the memory host", () => {
  it("answers POSIX paths", () => {
    expect(host.paths).toBe(posixPaths);
  });

  it("reads files, text and bytes alike, and refuses a directory or a missing file with a reason", async () => {
    expect(await host.read("/p/a.yaml")).toEqual({ ok: true, bytes: new TextEncoder().encode("k: 1\n") });
    expect(await host.read("/p/dir/b.txt")).toEqual({ ok: true, bytes: new Uint8Array([104, 105]) });
    for (const location of ["/p/dir", "/p/missing", "/p/gone"]) {
      const result = await host.read(location);
      expect(result.ok, location).toBe(false);
    }
  });

  it("resolves a relative location against the root, like `/`", async () => {
    expect(await host.canonicalize("p/a.yaml")).toBe("/p/a.yaml");
  });

  it("canonicalizes through links: at the end, in the middle, relative targets, chains", async () => {
    expect(await host.canonicalize("/p/alias.yaml")).toBe("/p/a.yaml"); // a relative target is read from the link's directory
    expect(await host.canonicalize("/p/shared")).toBe("/lib/shared"); // a link to a directory
    expect(await host.canonicalize("/p/shared/c.txt")).toBe("/lib/shared/c.txt"); // a link in the middle of a path
    expect(await host.canonicalize("/p/chain1")).toBe("/p/dir/b.txt"); // a chain
    expect((await host.read("/p/shared/c.txt")).ok).toBe(true);
  });

  it("canonicalizes to undefined: a missing location, a link to nowhere, a loop", async () => {
    for (const location of ["/p/missing", "/p/gone", "/p/loop1", "/p/shared/missing"]) {
      expect(await host.canonicalize(location), location).toBeUndefined();
    }
  });

  it("canonicalizes a directory to itself", async () => {
    expect(await host.canonicalize("/p/dir")).toBe("/p/dir");
    expect(await host.canonicalize("/")).toBe("/");
  });

  it("has no cache: nothing found, nothing kept", async () => {
    await host.cacheWrite("blob/x", new Uint8Array([1]));
    expect(await host.cacheRead("blob/x")).toBeUndefined();
  });

  it("drives load() end to end, with no disk", async () => {
    const memory = createMemoryHost({ files: { "/v/s.yaml": "keys:\n  k:\n    demand: { type: int }\n", "/v/c.yaml": "$schema: ./s.yaml\nk: 5\n" } });
    const result = await load("/v/c.yaml", { host: memory, sandboxRoot: "/v" });
    expect(result.ok).toBe(true);
  });

  it("a root other than the filesystem root: `/` lists its children", async () => {
    const result = await host.list?.("/");
    expect(result?.ok && result.entries.map((e) => e.name).sort()).toEqual(["lib", "p"]);
  });
});
