/**
 * The shipped in-memory host -- SPEC.md Article VI (§16); specs/024-glob FR-011.
 *
 * ```ts
 * import { createMemoryHost } from "@egildo/cascata/host/memory";
 *
 * const host = createMemoryHost({
 *   files: { "/project/cascata.yaml": "...", "/project/docs/a.md": "..." },
 *   links: { "/project/shared": "/library/shared" }, // a location -> its target: a file or a directory
 * });
 * ```
 *
 * For tests and for embedders with no disk (a browser tab, a virtual file system). It answers `read`, `canonicalize`
 * (following `links`, in the path and at its end), `paths` (POSIX), and `list`, and has **no cache**: `cacheRead` finds
 * nothing and `cacheWrite` keeps nothing, so a remote document is fetched each time. It imports nothing platform-specific
 * -- only `src/paths.ts`'s POSIX facility -- so unlike `host/node.ts` it is not exempt from the realm sweep in
 * `tests/unit/layering.test.ts`: it is policed like the library proper. Shipping a host is not the library performing I/O,
 * as the Node host never was.
 *
 * **The model**, small on purpose. A location is a POSIX path, resolved against `/` (so `a/b` is `/a/b`). A directory exists
 * when something is in it (a file, or a link) -- there are no empty directories. A link's target is resolved against the
 * link's own directory, as a real symbolic link's is; a chain of links is followed (forty hops, then it is a loop and
 * answers like a missing target), and so is a link met in the middle of a path. Links are listed as the kind of what they
 * lead to; one that leads nowhere is `other`. A link's own location must not itself sit below another link.
 * Entries are listed in the order the files were given, which is arbitrary on purpose.
 */

import { posixPaths } from "../paths.js";
import type { Host, HostListEntry, HostListResult, HostReadResult } from "../resolve/host.js";

export interface MemoryHostOptions {
  /** location -> content. Text is held as UTF-8. */
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
  /** location of a link -> its target (a file or a directory; absolute, or relative to the link's directory). */
  readonly links?: Readonly<Record<string, string>>;
}

const MAX_LINK_HOPS = 40;

export function createMemoryHost(options: MemoryHostOptions = {}): Host {
  const at = (location: string): string => posixPaths.resolve("/", location);
  const files = new Map<string, Uint8Array>();
  for (const [location, content] of Object.entries(options.files ?? {})) {
    files.set(at(location), typeof content === "string" ? new TextEncoder().encode(content) : content);
  }
  const links = new Map<string, string>();
  for (const [location, target] of Object.entries(options.links ?? {})) {
    const key = at(location);
    links.set(key, posixPaths.resolve(posixPaths.dirname(key), target));
  }
  const directories = new Set<string>(["/"]);
  for (const key of [...files.keys(), ...links.keys()]) {
    for (let parent = posixPaths.dirname(key); !directories.has(parent); parent = posixPaths.dirname(parent)) {
      directories.add(parent);
    }
  }

  /** `location` with every link in it followed, or `undefined` if it leads nowhere (missing, or a loop). */
  function real(location: string): string | undefined {
    let current = at(location);
    for (let hops = 0; hops <= MAX_LINK_HOPS; hops += 1) {
      const segments = current.split("/").filter((segment) => segment.length > 0);
      let prefix = "";
      let followed = false;
      for (let index = 0; index < segments.length; index += 1) {
        prefix += `/${segments[index]}`;
        const target = links.get(prefix);
        if (target !== undefined) {
          current = posixPaths.resolve(target, segments.slice(index + 1).join("/"));
          followed = true;
          break;
        }
      }
      if (!followed) {
        return files.has(current) || directories.has(current) ? current : undefined;
      }
    }
    return undefined;
  }

  function kindOf(location: string): HostListEntry["kind"] {
    const target = real(location);
    return target === undefined ? "other" : files.has(target) ? "file" : "directory";
  }

  return {
    paths: posixPaths,

    async read(location: string): Promise<HostReadResult> {
      const target = real(location);
      const bytes = target === undefined ? undefined : files.get(target);
      return bytes === undefined ? { ok: false, reason: `MemoryHost: no file at '${location}'` } : { ok: true, bytes };
    },

    async canonicalize(location: string): Promise<string | undefined> {
      return real(location);
    },

    async list(location: string): Promise<HostListResult> {
      const target = real(location);
      if (target === undefined) {
        return { ok: false, reason: `MemoryHost: no such directory '${location}'` };
      }
      if (!directories.has(target)) {
        return { ok: false, reason: `MemoryHost: '${location}' is not a directory` };
      }
      const prefix = target === "/" ? "/" : `${target}/`;
      const names = new Set<string>();
      for (const key of [...files.keys(), ...links.keys()]) {
        if (key.startsWith(prefix)) {
          names.add(key.slice(prefix.length).split("/")[0] ?? "");
        }
      }
      return { ok: true, entries: [...names].map((name) => ({ name, kind: kindOf(`${prefix}${name}`) })) };
    },

    async cacheRead(): Promise<Uint8Array | undefined> {
      return undefined;
    },

    async cacheWrite(): Promise<void> {
      // No cache: nothing is kept.
    },
  };
}
