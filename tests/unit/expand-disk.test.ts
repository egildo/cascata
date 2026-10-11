/**
 * v1.14 FR-021/FR-022 -- `expand()` over the real disk with the Node host.
 *
 * The same walk as the memory host's cases, on a temporary directory made under `os.tmpdir()` and not canonicalized (on macOS
 * `/var` is a link, so a logical path and its physical one differ before any test link is made). Expectations are taken from
 * `realpathSync.native`, never from the library.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expand, load } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function venue(files: Record<string, string>, links: Record<string, string>, patterns: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), "cascata-expand-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const all = { ...files, "proj/schema.yaml": "keys:\n  include:\n    demand:\n      type: glob[]\n", "proj/config.yaml": `$schema: ./schema.yaml\ninclude:\n${patterns.map((p) => `  - ${JSON.stringify(p)}\n`).join("")}` };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  for (const [path, target] of Object.entries(links)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(join(root, target), join(root, path));
  }
  return root;
}

async function expandAt(root: string, sandbox: string = root) {
  const host = createNodeHost();
  const loaded = await load(join(root, "proj/config.yaml"), { host, sandboxRoot: sandbox });
  if (!loaded.ok) throw new Error(loaded.diagnostics.map((d) => d.message).join("; "));
  return expand(loaded.configuration, { host, sandboxRoot: sandbox });
}

describe("v1.14 FR-022 -- expand() on a real disk", () => {
  it("walks, skips dot names, and names matches by the route taken, with the physical path beside it where a link lies between", async () => {
    const root = venue(
      { "proj/a.md": "", "proj/.hidden.md": "", "proj/sub/b.md": "", "proj/.git/c.md": "", "lib/docs/d.md": "", "proj/café/e.md": "" },
      { "proj/docs": "lib/docs", "proj/loop": "proj", "proj/sub/up": "proj/sub" },
      ["**/*.md"],
    );
    const result = await expandAt(root);
    expect(result.diagnostics).toEqual([]);
    const expansion = result.expansions[0];
    expect(expansion?.ok && expansion.matches.map((m) => m.location)).toEqual([
      join(root, "proj/a.md"),
      join(root, "proj/café/e.md"),
      join(root, "proj/docs/d.md"),
      join(root, "proj/sub/b.md"),
    ]);
    // Only the match behind a link says so -- and its physical path is the disk's own answer.
    const linked = expansion?.ok ? expansion.matches.find((m) => m.location === join(root, "proj/docs/d.md")) : undefined;
    expect(linked?.physical).toBe(realpathSync.native(join(root, "lib/docs/d.md")));
    // The plain matches are physically elsewhere than their logical path too, if the temp dir is behind a link (macOS); either way the disk decides.
    for (const match of expansion?.ok ? expansion.matches : []) {
      const real = realpathSync.native(match.location);
      expect(match.physical ?? match.location).toBe(real);
    }
  });

  it("a link out of the sandbox is refused at the value, with the disk's own physical path in the message", async () => {
    const root = venue({ "proj/ok.md": "", "outside/secret.md": "" }, { "proj/out.md": "outside/secret.md" }, ["*.md"]);
    const result = await expandAt(root, join(root, "proj"));
    expect(result.diagnostics.map((d) => d.code)).toEqual(["sandbox-escape"]);
    expect(result.diagnostics[0]?.message).toContain(realpathSync.native(join(root, "outside/secret.md")));
    expect(result.diagnostics[0]?.message).toContain(join(root, "proj/out.md"));
  });

  it("a name that is not UTF-8-clean on the page: a composed and a decomposed spelling in different directories each find only themselves", async () => {
    const root = venue({ "proj/n1/café.md": "", "proj/n2/café.md": "" }, {}, ["n1/café.md", "n1/café.md", "n2/café.md", "n2/café.md"]);
    const result = await expandAt(root);
    // The disk (APFS, ext4: stores names as given; HFS+ would normalize them to decomposed) lists what it stores; matching is exact.
    expect(result.expansions.map((e) => e.ok && e.matches.length)).toEqual([1, 0, 1, 0]);
  });

  it("an unlistable directory is a diagnostic naming the system's reason, not a throw", async () => {
    const root = venue({ "proj/a.md": "" }, {}, ["nodir/*.md"]);
    const result = await expandAt(root);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["directory-unlistable"]);
    expect(result.diagnostics[0]?.message).toContain("ENOENT");
  });
});
