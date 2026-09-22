/**
 * HTTPS-only fetching — data-model.md "Resolved Document" (remote case);
 * v0.2 FR-013, FR-014, FR-015, FR-018, FR-019, FR-027, FR-028; research
 * D4, D7; tasks.md T043-T045, T048.
 *
 * **The trap this file exists to avoid (CLAUDE.md, T044)**: the response
 * size cap must be enforced against bytes actually received, never
 * against a `Content-Length` header alone — a server (or a hostile
 * fixture) can advertise a small header and still deliver an unbounded
 * body. `checkSizeCap` below is called on `response.body.length` (the
 * bytes the transport actually handed back), never on a header value.
 * `createNetworkTransport`'s own request loop additionally reads the
 * real response body in chunks and aborts the underlying HTTP request as
 * soon as the running total crosses the cap, so a hostile *live* server
 * is cut off mid-stream rather than fully buffered into memory first —
 * see that function's doc for why this half cannot be exercised by a
 * hermetic test, and the milestone report for the full account.
 *
 * **The trap this file exists to avoid (CLAUDE.md, T041 redirects)**: a
 * redirect is followed **one hop at a time** (research D4), and every
 * hop's scheme is checked *before* that hop's request is issued — not
 * just the final destination, which is the exact bypass v0.2 FR-013
 * exists to prevent (an insecure request would already have been made by
 * the time only the final URL is inspected). `fetchDocument`'s loop below
 * re-checks the scheme on every iteration, including the first, so
 * `unsupported-scheme` (hop 0) and `insecure-redirect` (hop > 0) share
 * one check with two names for where in the chain it fired.
 *
 * `src/resolve/` must never import from `src/adapters/` — enforced by
 * tests/unit/layering.test.ts.
 */
import type { Transport } from "./transport.js";
import type { DocumentCache } from "./cache.js";
/** contracts/resolve-api.md's "Limits" table — the subset this file enforces (`maxChainLength` is User Story 4's `graph/build.ts`, out of scope here). */
export interface FetchLimits {
    readonly maxRedirects: number;
    readonly requestTimeoutMs: number;
    readonly maxBytes: number;
}
/** contracts/resolve-api.md's documented defaults. */
export declare const DEFAULT_FETCH_LIMITS: FetchLimits;
/** Fill in any limit a caller did not specify with the default, the same shape `resolveLimits` (v0.1, adapters/limits.ts) uses. */
export declare function resolveFetchLimits(overrides: Partial<FetchLimits> | undefined): FetchLimits;
/** Every way a single-hop-aware HTTPS fetch can fail, before any pin is considered — contracts/diagnostics.md's fetching codes, minus the two (`pin-mismatch`, `malformed-pin`) that only apply once bytes exist. */
export type FetchFailure = {
    readonly kind: "unsupported-scheme";
    readonly scheme: string;
} | {
    readonly kind: "insecure-redirect";
    readonly location: string;
} | {
    readonly kind: "too-many-redirects";
} | {
    readonly kind: "unreachable";
    readonly detail: string;
} | {
    readonly kind: "size-limit-exceeded";
    readonly actualBytes: number;
};
export type FetchOutcome = {
    readonly ok: true;
    readonly bytes: Uint8Array;
    readonly headers: Readonly<Record<string, string>>;
    readonly status: number;
    readonly finalUrl: string;
} | {
    readonly ok: false;
    readonly failure: FetchFailure;
};
/**
 * Fetch `url` over HTTPS, following redirects manually one hop at a time
 * (research D4) through `transport`. Every hop's scheme is checked before
 * that hop's request is made (v0.2 FR-013, FR-027); the hop count is
 * capped at `limits.maxRedirects` (FR-028); the response body is size-capped
 * against actual bytes received, not any advertised length (T044).
 *
 * Does not know about `$pin` — that is `resolveRemoteDocument`'s job,
 * layered on top, once bytes exist to verify.
 */
export declare function fetchDocument(url: string, transport: Transport, limits: FetchLimits): Promise<FetchOutcome>;
export interface RemoteResolveContext {
    readonly transport: Transport;
    readonly cache: DocumentCache;
    readonly limits: FetchLimits;
}
/** Everything `resolveRemoteDocument` can refuse with, once fetch-layer failures and pin verification are both considered — contracts/diagnostics.md's fetching-and-integrity codes, plus `document-not-cached` (offline with nothing usable in cache). `"unreachable"` never appears here: `resolveRemoteDocument` always resolves it into either a stale-cache fallback (FR-018) or `"not-cached"`. */
export type RemoteDocumentFailure = Exclude<FetchFailure, {
    kind: "unreachable";
}> | {
    readonly kind: "not-cached";
} | {
    readonly kind: "pin-mismatch";
    readonly expected: string;
    readonly actual: string;
} | {
    readonly kind: "malformed-pin";
};
export type RemoteDocumentOutcome = {
    readonly ok: true;
    readonly bytes: Uint8Array;
    readonly hash: string;
    readonly verified: boolean;
} | {
    readonly ok: false;
    readonly failure: RemoteDocumentFailure;
};
/**
 * Resolve one remote reference to verified bytes: consult the cache
 * first (v0.2 FR-016, FR-017 — a fresh entry is used with **no** network
 * request at all); if stale or absent, fetch; on a network failure with
 * a stale cache entry already present, fall back to it rather than
 * refusing (FR-018 — a content-addressed body cannot silently drift, so
 * staleness alone is not grounds for refusal); on 304, keep the cached
 * bytes and refresh freshness metadata; on a genuine new body, store it.
 * A `$pin`, when present, is verified against whichever bytes are about
 * to be used — cached or freshly fetched alike (`SPEC.md` §11: "a pin is
 * verified whenever present, absolutely") — and **discarded, not
 * returned**, on mismatch (T048): the `ok:false` branch below carries no
 * bytes field at all, so there is no way for a caller to accidentally
 * thread mismatching bytes into the graph even by a coding mistake — the
 * type does not allow it.
 */
export declare function resolveRemoteDocument(url: string, pin: string | undefined, context: RemoteResolveContext): Promise<RemoteDocumentOutcome>;
//# sourceMappingURL=fetch.d.ts.map