/**
 * v1.14 FR-009, FR-010, FR-011, FR-022 -- `Host.list`, one suite run against both shipped hosts.
 *
 * The Node host on a temporary directory (a real disk: that is what the probe gate of FR-021 measured) and the memory host
 * must answer the same questions the same way, whatever order they happen to list in. Kinds are what an entry is **after
 * following a link**; a link to nowhere and a loop of links are `other`; a missing directory and a file are refusals.
 * The temporary directory is made under `os.tmpdir()` and not canonicalized, as in the graph-identity disk tests.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Host, HostListEntry } from "../../src/index.js";
import { createMemoryHost } from "../../src/host/memory.js";
import { createNodeHost } from "../../src/host/node.js";

interface Scene {
  readonly host: Host;
  readonly root: string;
}
/** `files` and `links` are keyed by path below the scene's root; a link's target is a path below it too (or a name that is not there). */
interface Spec {
  readonly files: Readonly<Record<string, string>>;
  readonly links?: Readonly<Record<string, string>>;
}
type Make = (spec: Spec) => Scene;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const makeNode: Make = (spec) => {
  const root = mkdtempSync(join(tmpdir(), "cascata-list-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(spec.files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  for (const [path, target] of Object.entries(spec.links ?? {})) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(join(root, target), join(root, path));
  }
  return { host: createNodeHost(), root };
};

const makeMemory: Make = (spec) => {
  const root = "/m";
  const files = Object.fromEntries(Object.entries(spec.files).map(([path, content]) => [`${root}/${path}`, content]));
  const links = Object.fromEntries(Object.entries(spec.links ?? {}).map(([path, target]) => [`${root}/${path}`, `${root}/${target}`]));
  return { host: createMemoryHost({ files, links }), root };
};

const SPEC: Spec = {
  files: { "f.txt": "f", "d/inner.txt": "i", ".dot": "x", "caf\u00e9/x.md": "c" },
  links: { lf: "f.txt", ld: "d", dangling: "nowhere", loopa: "loopb", loopb: "loopa" },
};

const byName = (entries: readonly HostListEntry[]): HostListEntry[] => [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

for (const [hostName, make] of [
  ["the Node host on a temporary directory", makeNode],
  ["the memory host", makeMemory],
] as const) {
  describe(`v1.14 FR-009/FR-022 -- Host.list on ${hostName}`, () => {
    it("lists every entry with its kind, links followed; a missing target and a loop are `other`; a dotfile is just a name", async () => {
      const { host, root } = make(SPEC);
      const result = await host.list?.(root);
      expect(result?.ok).toBe(true);
      if (result === undefined || !result.ok) return;
      expect(byName(result.entries)).toEqual(
        byName([
          { name: "f.txt", kind: "file" },
          { name: "d", kind: "directory" },
          { name: ".dot", kind: "file" },
          { name: "caf\u00e9", kind: "directory" },
          { name: "lf", kind: "file" }, // a link to a file
          { name: "ld", kind: "directory" }, // a link to a directory
          { name: "dangling", kind: "other" }, // a link whose target is missing
          { name: "loopa", kind: "other" }, // a loop of links
          { name: "loopb", kind: "other" },
        ]),
      );
    });

    it("lists through a link to a directory: the target's entries", async () => {
      const { host, root } = make(SPEC);
      const viaLink = await host.list?.(`${root}/ld`);
      const direct = await host.list?.(`${root}/d`);
      expect(viaLink).toEqual(direct);
      expect(viaLink?.ok && viaLink.entries).toEqual([{ name: "inner.txt", kind: "file" }]);
    });

    it("refuses with a reason: a directory that is not there, a file, a dangling link and a loop", async () => {
      const { host, root } = make(SPEC);
      for (const path of ["nowhere", "f.txt", "lf", "dangling", "loopa", "d/inner.txt"]) {
        const result = await host.list?.(`${root}/${path}`);
        expect(result?.ok, path).toBe(false);
        expect(result !== undefined && !result.ok && result.reason.length > 0, path).toBe(true);
      }
    });

    it("hands names over as stored, exactly: a composed name and a decomposed one, each in its own directory", async () => {
      const { host, root } = make({ files: { "n1/caf\u00e9.md": "", "n2/cafe\u0301.md": "" } });
      const first = await host.list?.(`${root}/n1`);
      const second = await host.list?.(`${root}/n2`);
      const codePoints = (name: string): number[] => [...name].map((c) => c.codePointAt(0) ?? -1);
      // 0x63 0x61 0x66 then U+00E9 (composed), against 0x65 U+0301 (decomposed): not normalized by the host.
      expect(first?.ok && first.entries.map((e) => codePoints(e.name))).toEqual([[0x63, 0x61, 0x66, 0xe9, 0x2e, 0x6d, 0x64]]);
      expect(second?.ok && second.entries.map((e) => codePoints(e.name))).toEqual([[0x63, 0x61, 0x66, 0x65, 0x301, 0x2e, 0x6d, 0x64]]);
    });

    it("lists a name above the BMP whole", async () => {
      const { host, root } = make({ files: { "\u{1F600}.md": "" } });
      const result = await host.list?.(root);
      expect(result?.ok && result.entries).toEqual([{ name: "\u{1F600}.md", kind: "file" }]);
    });
  });
}

describe("v1.14 FR-021 -- on the real disk only: an unreadable directory is a refusal, not a throw", () => {
  it.skipIf(process.getuid?.() === 0)("EACCES comes back as ok:false with the system's reason", async () => {
    const { root } = makeNode({ files: { "locked/f": "f" } });
    chmodSync(join(root, "locked"), 0o000);
    try {
      const result = await createNodeHost().list?.(join(root, "locked"));
      expect(result?.ok).toBe(false);
      expect(result !== undefined && !result.ok && result.reason).toContain("EACCES");
    } finally {
      chmodSync(join(root, "locked"), 0o755);
    }
  });
});
