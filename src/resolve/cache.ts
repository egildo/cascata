/**
 * The content-addressed cache — data-model.md "Cache Entry"; v0.2
 * FR-016, FR-017; research D3 (the named RFC 9111 subset); tasks.md
 * T046-T047.
 *
 * **Scope, named explicitly (research D3)**: freshness lifetime
 * (`Cache-Control: max-age`, `immutable`, `Expires`), revalidation
 * (`ETag`, `Last-Modified` — stored so a real network transport can send
 * `If-None-Match`/`If-Modified-Since`, though this milestone's frozen
 * `Transport` contract has no request-header channel to carry them
 * through — see the milestone report), and `no-store`/`no-cache`.
 * Deliberately **not** implemented: `Vary` negotiation, range requests,
 * shared-proxy semantics, `stale-while-revalidate` — none of which any
 * code path here can reach (Cascata is a single client fetching
 * immutable, content-addressed documents).
 *
 * **On disk layout**: two directories under the caller-supplied
 * `cacheDir` —
 *   `entries/<sha256(url)>.json` — one small metadata file per fetched
 *     *URL* (not content hash — an entry must be found by the URL a
 *     reference names, before its content hash is known), holding the
 *     document's content hash and freshness metadata.
 *   `blobs/<content-hash>` — the document's exact bytes, named by their
 *     own SHA-256 (`resolve/identity.ts`'s `hashBytes`) — the actual
 *     "content-addressed" half FR-016 asks for, and what lets two
 *     different URLs serving byte-identical content share one blob on
 *     disk.
 *
 * `src/resolve/` must never import from `src/adapters/` — enforced by
 * tests/unit/layering.test.ts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hashBytes } from "./identity.js";
import { getHeader } from "./headers.js";

/** The subset of RFC 9111 freshness/revalidation metadata this cache tracks for one entry (research D3). */
export interface CacheFreshness {
  /** When this entry was stored or last successfully revalidated, epoch milliseconds. */
  readonly fetchedAt: number;
  readonly maxAgeSeconds?: number;
  /** From an `Expires` header, epoch milliseconds — consulted only when `maxAgeSeconds` is absent (`Cache-Control` takes precedence over `Expires` per RFC 9111 §5.3). */
  readonly expiresAt?: number;
  /** `Cache-Control: immutable` — always fresh, no revalidation ever needed once fetched (RFC 8246). */
  readonly immutable: boolean;
  readonly etag?: string;
  readonly lastModified?: string;
  /** `Cache-Control: no-cache` — usable only after revalidation, even before any computed expiry (distinct from `no-store`, which means "do not persist at all"). */
  readonly noCache: boolean;
}

export interface CacheEntry {
  readonly url: string;
  readonly bytes: Uint8Array;
  readonly hash: string;
  readonly freshness: CacheFreshness;
}

interface StoredMeta {
  readonly hash: string;
  readonly freshness: CacheFreshness;
}

interface ParsedCacheControl {
  readonly maxAgeSeconds?: number;
  readonly noStore: boolean;
  readonly noCache: boolean;
  readonly immutable: boolean;
}

/** Parse `Cache-Control`'s comma-separated directive list (RFC 9111 §5.2). Unknown directives are ignored, per the RFC's own extensibility rule — this is the named subset (research D3), not a general parser. */
function parseCacheControl(value: string | undefined): ParsedCacheControl {
  const result: { maxAgeSeconds?: number; noStore: boolean; noCache: boolean; immutable: boolean } = { noStore: false, noCache: false, immutable: false };
  if (value === undefined) {
    return result;
  }
  for (const rawDirective of value.split(",")) {
    const directive = rawDirective.trim().toLowerCase();
    if (directive === "no-store") {
      result.noStore = true;
    } else if (directive === "no-cache") {
      result.noCache = true;
    } else if (directive === "immutable") {
      result.immutable = true;
    } else if (directive.startsWith("max-age=")) {
      const seconds = Number(directive.slice("max-age=".length));
      if (Number.isFinite(seconds) && seconds >= 0) {
        result.maxAgeSeconds = seconds;
      }
    }
  }
  return result;
}

/** Parse an HTTP-date header (`Expires`) into epoch milliseconds, or `undefined` if absent or unparseable — an invalid `Expires` value is treated the same as an absent one (RFC 9111 §5.3: "A cache recipient MUST interpret invalid date formats... as representing a time in the past"), which `isFresh` already does correctly for `undefined`. */
function parseHttpDate(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

function urlKey(url: string): string {
  return hashBytes(new TextEncoder().encode(url));
}

/** A caller-supplied, on-disk, content-addressed store for fetched remote documents (FR-016) — reused across separate `resolve()` calls (and separate process runs) that point `cacheDir` at the same directory, which is what makes offline resolution of a previously-resolved chain possible. */
export class DocumentCache {
  private readonly cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  private entriesDir(): string {
    return join(this.cacheDir, "entries");
  }

  private blobsDir(): string {
    return join(this.cacheDir, "blobs");
  }

  private metaPath(url: string): string {
    return join(this.entriesDir(), `${urlKey(url)}.json`);
  }

  private blobPath(hash: string): string {
    return join(this.blobsDir(), hash);
  }

  /** The cached entry for `url`, or `undefined` if nothing was ever stored for it (or its metadata/blob is missing or unreadable — treated as a cache miss, never a crash: a corrupted cache degrades to "must refetch," not a thrown error). */
  read(url: string): CacheEntry | undefined {
    const metaFile = this.metaPath(url);
    if (!existsSync(metaFile)) {
      return undefined;
    }
    let meta: StoredMeta;
    try {
      meta = JSON.parse(readFileSync(metaFile, "utf-8")) as StoredMeta;
    } catch {
      return undefined;
    }
    const blobFile = this.blobPath(meta.hash);
    if (!existsSync(blobFile)) {
      return undefined;
    }
    let buffer: Buffer;
    try {
      buffer = readFileSync(blobFile);
    } catch {
      return undefined;
    }
    return { url, bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), hash: meta.hash, freshness: meta.freshness };
  }

  /**
   * Store `bytes` for `url`, deriving freshness metadata from `headers`
   * (a response's headers — `Cache-Control`, `ETag`, `Last-Modified`,
   * `Expires`) and `fetchedAt` (epoch milliseconds; the caller's clock,
   * not this method's, so a revalidation and an original fetch can share
   * one `now` value). A `Cache-Control: no-store` response is **not**
   * persisted at all — nothing is written to either directory, and a
   * previously-cached entry for the same URL (if any) is left as-is
   * rather than being overwritten with an unstorable response.
   */
  write(url: string, bytes: Uint8Array, headers: Readonly<Record<string, string>>, fetchedAt: number): void {
    const cacheControl = parseCacheControl(getHeader(headers, "cache-control"));
    if (cacheControl.noStore) {
      return;
    }
    const hash = hashBytes(bytes);
    const etag = getHeader(headers, "etag");
    const lastModified = getHeader(headers, "last-modified");
    const expiresAt = parseHttpDate(getHeader(headers, "expires"));

    mkdirSync(this.entriesDir(), { recursive: true });
    mkdirSync(this.blobsDir(), { recursive: true });
    writeFileSync(this.blobPath(hash), bytes);

    const freshness: CacheFreshness = {
      fetchedAt,
      ...(cacheControl.maxAgeSeconds !== undefined ? { maxAgeSeconds: cacheControl.maxAgeSeconds } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      immutable: cacheControl.immutable,
      ...(etag !== undefined ? { etag } : {}),
      ...(lastModified !== undefined ? { lastModified } : {}),
      noCache: cacheControl.noCache,
    };
    const meta: StoredMeta = { hash, freshness };
    writeFileSync(this.metaPath(url), JSON.stringify(meta));
  }

  /**
   * Whether `freshness` is usable **without** revalidation, as of `now`
   * (epoch milliseconds) — research D3's named subset of RFC 9111 §4.2:
   *
   * - `no-cache` is never fresh: it must be revalidated before use even
   *   if its computed lifetime has not elapsed (distinct from staleness
   *   after expiry — this is "always ask first").
   * - `immutable` is always fresh (RFC 8246): once fetched, never
   *   revalidated again.
   * - Otherwise, fresh while `now - fetchedAt < maxAgeSeconds * 1000`
   *   (`Cache-Control` takes precedence over `Expires` per RFC 9111
   *   §5.3), or while `now < expiresAt` when only `Expires` was given.
   * - With **no** freshness signal at all (no `max-age`, no `Expires`),
   *   the entry is stale immediately — conservative by design: silence
   *   is not consent to reuse without asking.
   */
  isFresh(freshness: CacheFreshness, now: number): boolean {
    if (freshness.noCache) {
      return false;
    }
    if (freshness.immutable) {
      return true;
    }
    if (freshness.maxAgeSeconds !== undefined) {
      return now - freshness.fetchedAt < freshness.maxAgeSeconds * 1000;
    }
    if (freshness.expiresAt !== undefined) {
      return now < freshness.expiresAt;
    }
    return false;
  }
}
