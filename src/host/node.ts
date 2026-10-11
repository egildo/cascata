/**
 * The shipped Node host — SPEC.md Article VI (§16); v0.7 FR-024, FR-025;
 * specs/007-sealing-and-embedding/contracts/host-api.md; research.md D2.
 *
 * **A separate entry point, deliberately.** Article VI: "the library
 * performs no I/O; a *host* is supposed to." This module does real I/O —
 * `node:fs` reads/writes, and the real network via the platform `fetch` —
 * and is the **one** file under `src/` permitted to (named explicitly by
 * `tests/unit/layering.test.ts`'s host-boundary sweep, FR-024). It is
 * never imported by anything under the library's own core (`src/index.ts`
 * and everything it transitively imports never reaches this file) — an
 * embedder opts in explicitly:
 *
 * ```ts
 * import { load } from "@egildo/cascata";
 * import { createNodeHost, createNodeTransport } from "@egildo/cascata/host/node.js";
 *
 * await load(entryPath, {
 *   sandboxRoot,
 *   host: createNodeHost({ cacheDir }),
 *   transport: createNodeTransport(), // omit for a purely local resolution
 * });
 * ```
 *
 * `createNodeHost`'s `read`/`canonicalize` are v0.2–v0.6's own
 * `readLocalDocument`/`safeRealpath`, moved verbatim (FR-027: "moved, not
 * changed"). `cacheRead`/`cacheWrite` are `DocumentCache`'s former direct
 * `node:fs` calls, moved the same way, now keyed by the opaque string the
 * library passes rather than computing their own file layout — see
 * `resolve/cache.ts`'s own module doc for the two-namespace key shape
 * (`"meta/…"`/`"blob/…"`). Both throw the identical "requires 'cacheDir'"
 * message `resolve()` itself threw before this milestone, now surfacing
 * from the host at the point caching is actually attempted rather than
 * eagerly at the top of `resolve()` — a deliberate, later-but-lazier
 * timing change, recorded in the milestone report.
 *
 * **v1.5 (issue #1)**: `createNodeHost` also answers `paths` — `node:path`'s
 * own `dirname`/`isAbsolute`/`resolve`/`sep` plus `os.homedir()`. Those
 * imports used to sit inside `src/resolve/` and `src/validate/`, where
 * they made the library fail to load in a browser realm; they live here
 * now for the same reason `node:fs` does. See `src/paths.ts`.
 *
 * `createNodeTransport` is v0.2's `createNetworkTransport`, moved
 * unchanged. **No test in this codebase ever performs I/O through
 * anything in this file** (`tests/unit/paths.test.ts` constructs a host
 * to check that its path facility is node's own, which touches nothing —
 * the I/O-performing members are still never called) — every test passes an explicit in-memory host
 * test double or `RecordedTransport` (CLAUDE.md's non-negotiable: "No
 * network access in tests, ever"), so this module's own behavior is
 * unverified by the suite; it exists to make the documented contract
 * true for real callers, not to be exercised hermetically — the same
 * posture `createNetworkTransport` always held.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve as resolvePath, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { Host, HostListEntry, HostListResult, HostReadResult } from "../resolve/host.js";
import type { PathFacility } from "../paths.js";
import type { RecordingOutcome, Transport } from "../resolve/transport.js";

export interface NodeHostOptions {
  /** Where fetched remote documents are cached on disk. Optional: a resolution that never reaches a remote reference never needs it. If a remote fetch's cache read/write IS attempted with none configured, `cacheRead`/`cacheWrite` throw. */
  readonly cacheDir?: string;
}

function requireCacheDir(cacheDir: string | undefined): string {
  if (cacheDir === undefined) {
    throw new Error("createNodeHost() requires 'cacheDir' to cache a fetched document — there is no default and none is inferred, the same 'granted, never ambient' posture as 'sandboxRoot' (SPEC.md Article VI)");
  }
  return cacheDir;
}

/**
 * The shipped host, backed by the real local filesystem. `read`/
 * `canonicalize` need no `cacheDir` at all — only `cacheRead`/`cacheWrite`
 * do, and only when actually called.
 */
/**
 * `node:path`'s own functions, handed to the library as its path facility
 * (issue #1). Nothing is reimplemented and nothing is wrapped: on Windows
 * these are `path.win32`'s rules — drive letters, UNC roots, a backslash
 * separator — exactly as every version before v1.5 got them by importing
 * `node:path` directly. That equivalence is the whole point of routing
 * them through the host rather than replacing them with lexical
 * arithmetic of our own.
 *
 * `homeDirectory` is a **getter**, read at each access rather than
 * captured when the host is made. `os.homedir()` honors `$HOME` on POSIX,
 * and `tests/corpus/resolve-runner.ts` sets `$HOME` around the call to
 * point a case at a fixture home — with a captured value that override
 * silently stops working, which is exactly what happened the first time
 * this was written as a plain field (three corpus cases went red). "Moved,
 * not changed" (FR-027) governs here: the expansion reads the environment
 * at expansion time, as it always has.
 */
export function createNodePathFacility(): PathFacility {
  return {
    separator: sep,
    get homeDirectory(): string {
      return homedir();
    },
    dirname,
    isAbsolute,
    resolve: resolvePath,
  };
}

function kindAfterLink(path: string): HostListEntry["kind"] {
  try {
    const target = statSync(path);
    return target.isFile() ? "file" : target.isDirectory() ? "directory" : "other";
  } catch {
    return "other";
  }
}

export function createNodeHost(options?: NodeHostOptions): Host {
  const cacheDir = options?.cacheDir;

  return {
    paths: createNodePathFacility(),

    async read(location: string): Promise<HostReadResult> {
      try {
        const buffer = readFileSync(location);
        return { ok: true, bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { ok: false, reason };
      }
    },

    async canonicalize(location: string): Promise<string | undefined> {
      try {
        // `.native` is the operating system's realpath(3): it follows links AND answers the path's true
        // spelling (case on a case-folding file system, Unicode normalization). The JavaScript
        // implementation keeps the spelling it was given, so two spellings of one file were two identities.
        return realpathSync.native(location);
      } catch {
        return undefined;
      }
    },

    /**
     * v1.14 FR-009/FR-010: `readdir` with file types, then `stat` for a link (which follows it). A link whose target is missing, or a
     * loop of links, or any entry `stat` cannot answer, is `other` -- the host reports kinds and never judges (FR-009).
     */
    async list(location: string): Promise<HostListResult> {
      try {
        const entries: HostListEntry[] = [];
        for (const entry of readdirSync(location, { withFileTypes: true })) {
          if (entry.isFile()) {
            entries.push({ name: entry.name, kind: "file" });
          } else if (entry.isDirectory()) {
            entries.push({ name: entry.name, kind: "directory" });
          } else if (entry.isSymbolicLink()) {
            entries.push({ name: entry.name, kind: kindAfterLink(join(location, entry.name)) });
          } else {
            entries.push({ name: entry.name, kind: "other" });
          }
        }
        return { ok: true, entries };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },

    async cacheRead(key: string): Promise<Uint8Array | undefined> {
      const dir = requireCacheDir(cacheDir);
      const path = join(dir, key);
      if (!existsSync(path)) {
        return undefined;
      }
      try {
        const buffer = readFileSync(path);
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      } catch {
        return undefined;
      }
    },

    async cacheWrite(key: string, bytes: Uint8Array): Promise<void> {
      const dir = requireCacheDir(cacheDir);
      const path = join(dir, key);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
    },
  };
}

/**
 * `Transport` backed by the platform `fetch` — used only when a caller of
 * `resolve()`/`load()` supplies it explicitly (there is no default network
 * transport as of v0.7: the library itself may not call `fetch`, so it
 * cannot silently construct one — an embedder wanting the real network
 * passes this).
 *
 * Reads the real response body **incrementally**, chunk by chunk via
 * `Response.body`'s reader, tracking the running total and aborting the
 * underlying request (via `AbortController`) the moment it would exceed
 * `maxBytes` — genuine mid-stream cutoff, not a check performed after
 * buffering a whole hostile body into memory. This is the production half
 * of v0.2 T044's requirement; `resolve/fetch.ts`'s `checkSizeCap` (the
 * half exercised by `RecordedTransport`-backed tests, since that seam
 * only ever hands over an already-fully-materialized body) is the other
 * half, checked against actual received bytes rather than any advertised
 * `Content-Length`. Both halves enforce the same rule; only one is
 * network-reachable to test.
 */
export function createNodeTransport(maxBytes: number = 8 * 1024 * 1024): Transport {
  return {
    async request(url: string, method: string): Promise<RecordingOutcome> {
      const controller = new AbortController();
      let response: Response;
      try {
        response = await fetch(url, { method, redirect: "manual", signal: controller.signal });
      } catch {
        return { kind: "failure", failure: { kind: "connection-refused" } };
      }

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const reader = response.body?.getReader();
      if (reader === undefined) {
        const body = new Uint8Array(await response.arrayBuffer());
        return { kind: "response", response: { status: response.status, headers, body } };
      }

      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        total += value.length;
        if (total > maxBytes) {
          controller.abort();
          // Deliberately not a distinguishable `RecordingOutcome` kind —
          // the recorded-response contract has no "too large" failure
          // kind, and this codebase does not amend a frozen contract to
          // accommodate one implementation's internal need. A caller of
          // this transport that hits this path gets an
          // unreachable-shaped failure; `resolve/fetch.ts`'s own
          // `checkSizeCap`, downstream, is what actually reports
          // `size-limit-exceeded` for the (much more common, and
          // hermetically testable) case of a body that arrives whole.
          return { kind: "failure", failure: { kind: "connection-refused" } };
        }
        chunks.push(value);
      }
      const body = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      return { kind: "response", response: { status: response.status, headers, body } };
    },
  };
}

// --- The shipped meta-schema's location (v0.7 part 2) -------------------

/**
 * Where the meta-schema this package ships sits on disk, as an absolute
 * path — pass it as `metaValidate`'s `metaSchema`.
 *
 * **Path resolution belongs on this side of the seam, and only this side.**
 * `SPEC.md` §16 forbids the *library* touching storage; the library
 * proper therefore takes a location string and asks its host for the
 * bytes, knowing nothing about where a package lives. Computing that
 * string means knowing this module's own URL, which is knowledge about
 * storage layout and belongs to the host — the same division as
 * `canonicalize`: the host says *which thing is at this location*, and
 * only the library decides what to do about it.
 *
 * This function reads nothing. It is a path, not a file, and a caller
 * with its own storage (a bundler, a browser, a VFS) is expected to pass
 * its own location instead — which is the point of `metaValidate` taking
 * one at all rather than defaulting to this.
 */
export function nodeMetaSchemaLocation(): string {
  return fileURLToPath(new URL("../../meta/cascata.meta.yaml", import.meta.url));
}
