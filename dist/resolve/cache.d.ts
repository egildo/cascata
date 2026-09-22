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
 * **Storage layout — two logical namespaces, opaque keys** (v0.7, SPEC.md
 * Article VI, FR-025): `"meta/<sha256(url)>"` — one small metadata blob
 * per fetched *URL* (not content hash — an entry must be found by the URL
 * a reference names, before its content hash is known), holding the
 * document's content hash and freshness metadata as JSON bytes.
 * `"blob/<content-hash>"` — the document's exact bytes, named by their own
 * SHA-256 (`resolve/identity.ts`'s `hashBytes`) — the actual
 * "content-addressed" half FR-016 asks for, and what lets two different
 * URLs serving byte-identical content share one blob.
 *
 * **v0.7**: the *storage* moved behind the `Host` seam (`host.cacheRead`/
 * `host.cacheWrite`) — this class no longer touches `node:fs` at all,
 * enforced by `tests/unit/layering.test.ts`'s host-boundary sweep. The
 * caching *policy* (this file's whole reason to exist: content
 * addressing, the RFC 9111 subset below, `no-store` handling) is
 * unchanged — FR-025's "the library's caching policy... stays in the
 * library; the storage does not."
 *
 * `src/resolve/` must never import from `src/adapters/` — enforced by
 * tests/unit/layering.test.ts.
 */
import type { Host } from "./host.js";
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
/** A `Host`-backed, content-addressed store for fetched remote documents (FR-016, FR-025) — reused across separate `resolve()` calls (and separate process runs, for a `Host` whose cache storage persists, e.g. `createNodeHost`'s) that share a `Host`, which is what makes offline resolution of a previously-resolved chain possible. */
export declare class DocumentCache {
    private readonly host;
    constructor(host: Host);
    private metaKey;
    private blobKey;
    /** The cached entry for `url`, or `undefined` if nothing was ever stored for it (or its metadata/blob is missing or unreadable — treated as a cache miss, never a crash: a corrupted cache degrades to "must refetch," not a thrown error). */
    read(url: string): Promise<CacheEntry | undefined>;
    /**
     * Store `bytes` for `url`, deriving freshness metadata from `headers`
     * (a response's headers — `Cache-Control`, `ETag`, `Last-Modified`,
     * `Expires`) and `fetchedAt` (epoch milliseconds; the caller's clock,
     * not this method's, so a revalidation and an original fetch can share
     * one `now` value). A `Cache-Control: no-store` response is **not**
     * persisted at all — nothing is written under either key, and a
     * previously-cached entry for the same URL (if any) is left as-is
     * rather than being overwritten with an unstorable response.
     */
    write(url: string, bytes: Uint8Array, headers: Readonly<Record<string, string>>, fetchedAt: number): Promise<void>;
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
    isFresh(freshness: CacheFreshness, now: number): boolean;
}
//# sourceMappingURL=cache.d.ts.map