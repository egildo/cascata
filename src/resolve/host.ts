/**
 * The Host seam — SPEC.md Article VI (§16); v0.7 FR-022, FR-025, FR-026;
 * specs/007-sealing-and-embedding/contracts/host-api.md; research.md D1.
 *
 * The library's **only** route to local bytes, canonical identity, and
 * cache storage. Four methods, three capabilities (research.md D1):
 *
 * - `read` — bytes at a **local** location, or a refusal. Never called
 *   for an `https://` location; the network fetch stays behind
 *   `resolve/transport.ts`'s own, already-existing `Transport` seam
 *   (`SPEC.md` §15's own amendment: that half of the seam has existed
 *   since v0.2, and is not one of the three things this milestone moves).
 * - `canonicalize` — the canonical identity of a location (following
 *   symlinks, case-normalizing where the filesystem does), or `undefined`
 *   if none can be determined. **Supply, never a verdict** (§16: "the
 *   host answers *which thing is at this location*... it never answers
 *   *whether that thing is inside the sandbox*") — the library alone
 *   compares identities and reaches the confinement verdict.
 * - `cacheRead`/`cacheWrite` — an opaque byte store keyed by strings the
 *   library constructs (content hashes, hashed URLs) — the storage half
 *   of the on-disk cache (FR-025); the caching *policy* (content
 *   addressing, freshness, RFC 9111's applicable subset) stays in
 *   `resolve/cache.ts`.
 * - `locate` — **optional, v1.4 FR-001** — the location of a reference
 *   written in a URI scheme this host owns, or `undefined` for a scheme
 *   it does not. The same law as the three above: supply, never meaning.
 *   The host says *where `beltype:document` is*; the library alone
 *   decides what to do with the answer.
 *
 * This module itself performs no I/O and imports nothing — a pure
 * interface declaration, exactly like `resolve/transport.ts`'s own
 * `Transport`. The **implementation** lives on the far side of the seam,
 * at the separate entry point `src/host/node.ts` (`createNodeHost`).
 *
 * `src/resolve/` must never import from `src/adapters/`, and (as of
 * v0.7) no module under `src/` may import `node:fs` or call `fetch`,
 * except `src/host/node.ts` — both enforced by
 * `tests/unit/layering.test.ts`.
 */

/** Bytes at a location, or a refusal naming why (FR-022a). Never throws for "the world said no" — a nonexistent file, a permission error, and the like are all `{ok: false, reason}`. */
export type HostReadResult = { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly reason: string };

export interface Host {
  /** Bytes at a **local** location, or a refusal (FR-022a, FR-028). Never called for a remote (`https://`) location. */
  read(location: string): Promise<HostReadResult>;
  /**
   * The canonical identity of `location` (e.g. following symlinks), or
   * `undefined` if none can be determined — the location does not exist,
   * a permission error, or any other reason canonicalization cannot
   * proceed (FR-022b, FR-027). Never a policy verdict: the caller decides
   * confinement from the identities this returns, never asks this method
   * whether something is *permitted* (FR-026).
   */
  canonicalize(location: string): Promise<string | undefined>;
  /** Read a previously-cached blob by `key` (an opaque string the library constructs), or `undefined` if absent. */
  cacheRead(key: string): Promise<Uint8Array | undefined>;
  /** Store `bytes` under `key`, overwriting any previous value. A host with no cache configured may throw — the same "required exactly when needed, never ambient" posture `sandboxRoot` has always held (Principle VI). */
  cacheWrite(key: string, bytes: Uint8Array): Promise<void>;
  /**
   * **Optional (v1.4 FR-001, `SPEC.md` §16).** The location of
   * `reference` — a `$schema`/`$adopts` text carrying a URI scheme that
   * is not `https:` — if this host owns that scheme, or `undefined` if it
   * does not. A host that implements nothing here is the library exactly
   * as it was before v1.4: every such reference is `unsupported-scheme`.
   *
   * **Return an absolute location or `undefined`** — an absolute local
   * path, or an `https://` URL. What comes back is read as a *location*
   * and nothing else: it is classified once (remote or local), never
   * re-offered to this method, and everything downstream — reading,
   * parsing, dedup, cycle detection, and a relative `$adopts` written
   * inside the located document — proceeds against it unchanged
   * (v1.4 FR-002). A relative string is a host bug, not a second syntax.
   *
   * **Supply, never meaning.** The host answers *which document its
   * namespace names*, as it already answers which bytes are at a path. It
   * does not answer whether that document is permitted: a located
   * reference is not sandbox-checked (v1.4 FR-003) precisely because the
   * host, not a document, chose the location — which is the same
   * boundary Article VI already draws, applied where the location itself
   * comes from the host.
   */
  locate?(reference: string): Promise<string | undefined>;
}
