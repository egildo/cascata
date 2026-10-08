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
import { hashBytes } from "./identity.js";
import { getHeader } from "./headers.js";
/** Parse `Cache-Control`'s comma-separated directive list (RFC 9111 §5.2). Unknown directives are ignored, per the RFC's own extensibility rule — this is the named subset (research D3), not a general parser. */
function parseCacheControl(value) {
    const result = { noStore: false, noCache: false, immutable: false };
    if (value === undefined) {
        return result;
    }
    for (const rawDirective of value.split(",")) {
        const directive = rawDirective.trim().toLowerCase();
        if (directive === "no-store") {
            result.noStore = true;
        }
        else if (directive === "no-cache") {
            result.noCache = true;
        }
        else if (directive === "immutable") {
            result.immutable = true;
        }
        else if (directive.startsWith("max-age=")) {
            const seconds = Number(directive.slice("max-age=".length));
            if (Number.isFinite(seconds) && seconds >= 0) {
                result.maxAgeSeconds = seconds;
            }
        }
    }
    return result;
}
/** Parse an HTTP-date header (`Expires`) into epoch milliseconds, or `undefined` if absent or unparseable — an invalid `Expires` value is treated the same as an absent one (RFC 9111 §5.3: "A cache recipient MUST interpret invalid date formats... as representing a time in the past"), which `isFresh` already does correctly for `undefined`. */
function parseHttpDate(value) {
    if (value === undefined) {
        return undefined;
    }
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : ms;
}
function urlKey(url) {
    return hashBytes(new TextEncoder().encode(url));
}
/** A `Host`-backed, content-addressed store for fetched remote documents (FR-016, FR-025) — reused across separate `resolve()` calls (and separate process runs, for a `Host` whose cache storage persists, e.g. `createNodeHost`'s) that share a `Host`, which is what makes offline resolution of a previously-resolved chain possible. */
export class DocumentCache {
    host;
    constructor(host) {
        this.host = host;
    }
    metaKey(url) {
        return `meta/${urlKey(url)}`;
    }
    blobKey(hash) {
        return `blob/${hash}`;
    }
    /** The cached entry for `url`, or `undefined` if nothing was ever stored for it (or its metadata/blob is missing or unreadable — treated as a cache miss, never a crash: a corrupted cache degrades to "must refetch," not a thrown error). */
    async read(url) {
        const metaBytes = await this.host.cacheRead(this.metaKey(url));
        if (metaBytes === undefined) {
            return undefined;
        }
        let meta;
        try {
            meta = JSON.parse(new TextDecoder("utf-8", { ignoreBOM: true }).decode(metaBytes));
        }
        catch {
            return undefined;
        }
        const blobBytes = await this.host.cacheRead(this.blobKey(meta.hash));
        if (blobBytes === undefined) {
            return undefined;
        }
        return { url, bytes: blobBytes, hash: meta.hash, freshness: meta.freshness };
    }
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
    async write(url, bytes, headers, fetchedAt) {
        const cacheControl = parseCacheControl(getHeader(headers, "cache-control"));
        if (cacheControl.noStore) {
            return;
        }
        const hash = hashBytes(bytes);
        const etag = getHeader(headers, "etag");
        const lastModified = getHeader(headers, "last-modified");
        const expiresAt = parseHttpDate(getHeader(headers, "expires"));
        await this.host.cacheWrite(this.blobKey(hash), bytes);
        const freshness = {
            fetchedAt,
            ...(cacheControl.maxAgeSeconds !== undefined ? { maxAgeSeconds: cacheControl.maxAgeSeconds } : {}),
            ...(expiresAt !== undefined ? { expiresAt } : {}),
            immutable: cacheControl.immutable,
            ...(etag !== undefined ? { etag } : {}),
            ...(lastModified !== undefined ? { lastModified } : {}),
            noCache: cacheControl.noCache,
        };
        const meta = { hash, freshness };
        await this.host.cacheWrite(this.metaKey(url), new TextEncoder().encode(JSON.stringify(meta)));
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
    isFresh(freshness, now) {
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
//# sourceMappingURL=cache.js.map