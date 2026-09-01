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

import { hashBytes, verifyPin } from "./identity.js";
import { getHeader } from "./headers.js";
import type { RecordedResponse, RecordingOutcome, Transport } from "./transport.js";
import type { DocumentCache } from "./cache.js";

/** contracts/resolve-api.md's "Limits" table — the subset this file enforces (`maxChainLength` is User Story 4's `graph/build.ts`, out of scope here). */
export interface FetchLimits {
  readonly maxRedirects: number;
  readonly requestTimeoutMs: number;
  readonly maxBytes: number;
}

/** contracts/resolve-api.md's documented defaults. */
export const DEFAULT_FETCH_LIMITS: FetchLimits = {
  maxRedirects: 5,
  requestTimeoutMs: 10000,
  maxBytes: 8 * 1024 * 1024,
};

/** Fill in any limit a caller did not specify with the default, the same shape `resolveLimits` (v0.1, adapters/yaml/limits.ts) uses. */
export function resolveFetchLimits(overrides: Partial<FetchLimits> | undefined): FetchLimits {
  return {
    maxRedirects: overrides?.maxRedirects ?? DEFAULT_FETCH_LIMITS.maxRedirects,
    requestTimeoutMs: overrides?.requestTimeoutMs ?? DEFAULT_FETCH_LIMITS.requestTimeoutMs,
    maxBytes: overrides?.maxBytes ?? DEFAULT_FETCH_LIMITS.maxBytes,
  };
}

/** Every way a single-hop-aware HTTPS fetch can fail, before any pin is considered — contracts/diagnostics.md's fetching codes, minus the two (`pin-mismatch`, `malformed-pin`) that only apply once bytes exist. */
export type FetchFailure =
  | { readonly kind: "unsupported-scheme"; readonly scheme: string }
  | { readonly kind: "insecure-redirect"; readonly location: string }
  | { readonly kind: "too-many-redirects" }
  | { readonly kind: "unreachable"; readonly detail: string }
  | { readonly kind: "size-limit-exceeded"; readonly actualBytes: number };

export type FetchOutcome =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly headers: Readonly<Record<string, string>>; readonly status: number; readonly finalUrl: string }
  | { readonly ok: false; readonly failure: FetchFailure };

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** `true` iff `text` parses as an absolute URL whose scheme is exactly `https:`. `false` (with the actual scheme, sans trailing `:`) for anything else — including text that is not a URL at all, reported as scheme `""`. */
function classifyScheme(text: string): { readonly https: true } | { readonly https: false; readonly scheme: string } {
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { https: false, scheme: "" };
  }
  if (parsed.protocol === "https:") {
    return { https: true };
  }
  return { https: false, scheme: parsed.protocol.replace(/:$/, "") };
}

/**
 * `transport.request`, bounded by `timeoutMs` even for a `Transport`
 * that never resolves (a real network stall is exactly this — the
 * recorded `{kind:"failure", failure:{kind:"timeout"}}` outcome models
 * it hermetically, but this bound exists so a caller supplying a
 * misbehaving custom transport still terminates, matching
 * contracts/resolve-api.md point 2, "Total").
 */
function requestWithTimeout(transport: Transport, url: string, method: string, timeoutMs: number): Promise<RecordingOutcome> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolvePromise({ kind: "failure", failure: { kind: "timeout" } });
      }
    }, timeoutMs);
    transport.request(url, method).then(
      (outcome) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolvePromise(outcome);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolvePromise({ kind: "failure", failure: { kind: "connection-refused" } });
        }
      },
    );
  });
}

/**
 * `size-limit-exceeded` (v0.1's existing code, reused: an oversized
 * document is the same failure whether it came from disk or the wire) if
 * `response.body.length` — the bytes the transport actually returned —
 * exceeds `limits.maxBytes`. Deliberately never consults
 * `response.headers["content-length"]`: that header is exactly what a
 * hostile server can lie about (T044's whole point), so the only number
 * this function trusts is the array it was actually handed.
 */
function checkSizeCap(response: RecordedResponse, limits: FetchLimits): boolean {
  return response.body.length <= limits.maxBytes;
}

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
export async function fetchDocument(url: string, transport: Transport, limits: FetchLimits): Promise<FetchOutcome> {
  let currentUrl = url;
  let redirectsFollowed = 0;

  for (;;) {
    const scheme = classifyScheme(currentUrl);
    if (!scheme.https) {
      return {
        ok: false,
        failure: redirectsFollowed === 0 ? { kind: "unsupported-scheme", scheme: scheme.scheme } : { kind: "insecure-redirect", location: currentUrl },
      };
    }

    const outcome = await requestWithTimeout(transport, currentUrl, "GET", limits.requestTimeoutMs);
    if (outcome.kind === "failure") {
      return { ok: false, failure: { kind: "unreachable", detail: outcome.failure.kind } };
    }

    const response = outcome.response;
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = getHeader(response.headers, "location");
      if (location === undefined) {
        return { ok: false, failure: { kind: "unreachable", detail: `redirect status ${response.status} carried no Location header` } };
      }
      redirectsFollowed += 1;
      if (redirectsFollowed > limits.maxRedirects) {
        return { ok: false, failure: { kind: "too-many-redirects" } };
      }
      // Resolved against the current URL, per Location's own semantics
      // (RFC 9110 §10.2.2) — a relative Location is legal and common.
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!checkSizeCap(response, limits)) {
      // A cap violation is refused outright, exactly like an insecure
      // redirect or an exhausted hop count — never folded into
      // "unreachable" (which `resolveRemoteDocument` treats as grounds
      // to fall back to a stale cache entry, FR-018). An oversized body
      // is not "offline"; masking it behind a stale-cache fallback would
      // hide the very condition this cap exists to catch.
      return { ok: false, failure: { kind: "size-limit-exceeded", actualBytes: response.body.length } };
    }

    return { ok: true, bytes: response.body, headers: response.headers, status: response.status, finalUrl: currentUrl };
  }
}

// --- Remote document resolution: fetch + cache + pin, combined (T045, T048) ---

export interface RemoteResolveContext {
  readonly transport: Transport;
  readonly cache: DocumentCache;
  readonly limits: FetchLimits;
}

/** Everything `resolveRemoteDocument` can refuse with, once fetch-layer failures and pin verification are both considered — contracts/diagnostics.md's fetching-and-integrity codes, plus `document-not-cached` (offline with nothing usable in cache). `"unreachable"` never appears here: `resolveRemoteDocument` always resolves it into either a stale-cache fallback (FR-018) or `"not-cached"`. */
export type RemoteDocumentFailure =
  | Exclude<FetchFailure, { kind: "unreachable" }>
  | { readonly kind: "not-cached" }
  | { readonly kind: "pin-mismatch"; readonly expected: string; readonly actual: string }
  | { readonly kind: "malformed-pin" };

export type RemoteDocumentOutcome =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly hash: string; readonly verified: boolean }
  | { readonly ok: false; readonly failure: RemoteDocumentFailure };

function verifyAgainstPin(bytes: Uint8Array, pin: string | undefined): RemoteDocumentOutcome {
  const hash = hashBytes(bytes);
  if (pin === undefined) {
    return { ok: true, bytes, hash, verified: false };
  }
  const verification = verifyPin(pin, { location: "", hash });
  if (!verification.ok) {
    if (verification.reason === "malformed") {
      return { ok: false, failure: { kind: "malformed-pin" } };
    }
    // T048: the mismatching bytes are not threaded into the returned
    // outcome at all past this point — only `expected`/`actual` hashes
    // are. There is no path from here back into the graph.
    return { ok: false, failure: { kind: "pin-mismatch", expected: verification.expected, actual: verification.actual } };
  }
  return { ok: true, bytes, hash, verified: true };
}

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
export async function resolveRemoteDocument(url: string, pin: string | undefined, context: RemoteResolveContext): Promise<RemoteDocumentOutcome> {
  const cached = await context.cache.read(url);
  const now = Date.now();

  if (cached !== undefined && context.cache.isFresh(cached.freshness, now)) {
    return verifyAgainstPin(cached.bytes, pin);
  }

  const fetched = await fetchDocument(url, context.transport, context.limits);

  if (!fetched.ok) {
    if (fetched.failure.kind === "unreachable") {
      if (cached !== undefined) {
        // FR-018: a stale-but-cached document still resolves offline.
        return verifyAgainstPin(cached.bytes, pin);
      }
      return { ok: false, failure: { kind: "not-cached" } };
    }
    // A protocol violation (insecure-redirect, too-many-redirects,
    // unsupported-scheme) is refused outright, never masked by falling
    // back to a stale cache entry — those are not "offline," they are
    // "the server (or the reference) is doing something FR-013/FR-027/
    // FR-028 forbid," which stays a refusal regardless of cache state.
    return { ok: false, failure: fetched.failure };
  }

  if (fetched.status === 304) {
    if (cached === undefined) {
      return { ok: false, failure: { kind: "not-cached" } };
    }
    await context.cache.write(url, cached.bytes, fetched.headers, now);
    return verifyAgainstPin(cached.bytes, pin);
  }

  await context.cache.write(url, fetched.bytes, fetched.headers, now);
  return verifyAgainstPin(fetched.bytes, pin);
}

// --- Production transport ---
//
// v0.7: `createNetworkTransport` — the `Transport` backed by the platform
// `fetch` — moved to `src/host/node.ts` (`createNodeTransport`), the
// shipped host's own separate entry point. This file may no longer call
// the global `fetch` at all (`tests/unit/layering.test.ts`'s host-boundary
// sweep, SPEC.md Article VI, FR-023): `src/resolve/` performs no I/O of
// its own, and the real network is I/O. `resolveRemoteDocument` above is
// unaffected — it never called `fetch` directly, only through the
// injectable `Transport` seam, which is exactly what let this move cost
// nothing at every call site.
