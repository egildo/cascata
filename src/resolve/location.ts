/**
 * Local-path resolution and file reads — data-model.md "Resolved
 * Document"; v0.2 FR-006, FR-007, FR-013, FR-029; tasks.md T027-T028,
 * T033, T043 (`classifyReferenceLocation`, User Story 3's routing point).
 *
 * **The trap this file exists to avoid (CLAUDE.md, T027)**: a relative
 * reference resolves against the directory of the document that
 * **contains** it — not the entry document's directory, and not the
 * process's working directory. `resolveReferenceLocation` takes the
 * *referring* document's own location as an explicit parameter for
 * exactly this reason; there is no function here that resolves against
 * `process.cwd()` implicitly. `classifyReferenceLocation` extends the
 * same principle to a referring document that is itself remote.
 *
 * Scheme-aware as of User Story 3: `classifyReferenceLocation` decides
 * local vs. HTTPS vs. refused-scheme, *before* `src/index.ts` ever calls
 * `resolve/fetch.ts`. Sandbox enforcement (schema-authored references
 * confined to `sandboxRoot`, config-authored ones exempt) is still User
 * Story 4, out of scope for this slice — see the milestone report.
 *
 * `src/resolve/` must never import from `src/adapters/` — enforced by
 * tests/unit/layering.test.ts.
 */

import { dirname, resolve as resolvePath } from "node:path";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createDocumentIdentity, type DocumentIdentity } from "./identity.js";
import type { Reference } from "./reference.js";

/**
 * A document read into the graph, together with the reference that
 * brought it in (data-model.md "Resolved Document"). `via` is absent
 * only for the entry document — every other document was reached through
 * exactly one `Reference`, which is what makes FR-024 possible (a
 * failure inside a fetched/read document is attributable to the
 * reference that reached it).
 */
export interface ResolvedDocument {
  readonly identity: DocumentIdentity;
  readonly bytes: Uint8Array;
  readonly via?: Reference;
  /**
   * Whether a pin was present and matched (FR-026). Always `false` in
   * this slice: local reads are never pin-verified here (see the
   * report) — `resolve/fetch.ts` (User Story 3) is where `$pin`
   * verification against fetched bytes is wired up (T048).
   */
  readonly verified: boolean;
}

/**
 * A leading `~/` in a **config-authored** reference expands to the
 * user's home directory (v0.2 FR-029, SPEC.md §9 — the worked chain's
 * own `$schema: ~/.config/house.yaml` depends on this). A
 * **schema-authored** reference beginning `~/` MUST NOT expand: FR-021
 * exists to confine a schema's local reach to the sandbox root, and
 * expanding `~/` for a schema would be a ready-made way around it.
 * Schema-authored `~/foo.yaml` is therefore judged as "the literal
 * relative path it is" (spec.md's own wording) — `~` is just an ordinary
 * first path segment, exactly as `resolvePath` would treat any other
 * directory name.
 *
 * `os.homedir()` is used, not a hardcoded/injected path — it already
 * honors `$HOME` on POSIX, which is what lets a test point it at a
 * fixture directory without touching the real user's home (see
 * tests/corpus/resolve-runner.ts's `homeDir` case field).
 */
function expandTilde(reference: Reference): string {
  if (reference.authority === "config-authored" && reference.text.startsWith("~/")) {
    return resolvePath(homedir(), reference.text.slice(2));
  }
  return reference.text;
}

/**
 * What a reference's location turns out to be, once its scheme (if any)
 * is considered — v0.2 User Story 3 (T043-T045), FR-013. Three outcomes:
 *
 * - `"local"` — no scheme prefix (a relative or absolute filesystem
 *   path, or the referring document is itself local and the text has no
 *   `scheme://` at all). Carries the same lexically-resolved location
 *   `resolveReferenceLocation` would have produced — this function is a
 *   superset of that one, not a replacement for it (see below).
 * - `"https"` — an absolute `https://` URL, or a schemeless reference
 *   resolved against a referring document that is *itself* remote
 *   (joined via WHATWG `URL`'s own relative-resolution rules, which is
 *   what makes a remote schema's own relative `$adopts` resolve against
 *   *its* location rather than the entry document's — the same FR-006
 *   principle `resolveReferenceLocation` applies locally, extended to
 *   the remote case).
 * - `"unsupported-scheme"` — an absolute URL whose scheme is anything
 *   else (`http:`, `file:`, `data:`, …). Refused with `unsupported-scheme`
 *   *before any request is made* (FR-013) — the caller never reaches
 *   `resolve/fetch.ts` for this outcome.
 */
export type ReferenceLocationKind =
  | { readonly kind: "local"; readonly location: string }
  | { readonly kind: "https"; readonly url: string }
  | { readonly kind: "unsupported-scheme"; readonly scheme: string };

/** An absolute-URL scheme prefix, e.g. `https://`, `http://`, `file://` — deliberately requires the double slash, so a Windows-style drive path (`C:\foo`) is never misread as scheme `c` (a single-letter scheme is technically legal URI grammar, but nothing in this codebase's fixtures or `SPEC.md` ever writes one, and treating `C:\` as local is the only reading that does not make an ordinary Windows absolute path unusable). */
const ABSOLUTE_URL_SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//;

/** Whether `location` (already resolved — a real local path or a URL string) is itself an `https://` location, i.e. the *referring* document was reached remotely. */
const HTTPS_LOCATION_PATTERN = /^https:\/\//i;

/**
 * Classify `reference`'s target before deciding how to read it (T043's
 * routing point in `src/index.ts`): a local filesystem path, an HTTPS
 * URL to fetch, or a scheme FR-013 refuses outright. Tilde-expands first
 * (`expandTilde`, FR-029), exactly as `resolveReferenceLocation` does,
 * so the two functions agree on every local case — see that function's
 * own doc; this one exists alongside it, not in place of it, because
 * `resolveReferenceLocation`'s local-only contract (documented on itself)
 * predates scheme-awareness and nothing outside this module depends on
 * it gaining a scheme argument.
 */
export function classifyReferenceLocation(reference: Reference, referringDocumentLocation: string): ReferenceLocationKind {
  const text = expandTilde(reference);
  const schemeMatch = ABSOLUTE_URL_SCHEME_PATTERN.exec(text);
  if (schemeMatch !== null) {
    const scheme = (schemeMatch[1] ?? "").toLowerCase();
    if (scheme === "https") {
      return { kind: "https", url: text };
    }
    return { kind: "unsupported-scheme", scheme };
  }
  if (HTTPS_LOCATION_PATTERN.test(referringDocumentLocation)) {
    return { kind: "https", url: new URL(text, referringDocumentLocation).toString() };
  }
  return { kind: "local", location: resolvePath(dirname(referringDocumentLocation), text) };
}

/**
 * Resolve `reference`'s text against the directory of the document that
 * wrote it (FR-006), first expanding a leading `~/` if `reference` is
 * config-authored (FR-029; `expandTilde` above). `path.resolve` handles
 * both relative text (joined against `referringDocumentLocation`'s
 * directory) and an absolute path (which overrides the base directory
 * entirely, per Node's documented `path.resolve` semantics — this is
 * also how an already-expanded `~/…` path, now absolute, is used as-is
 * rather than re-joined against the referring directory) in one call,
 * and normalizes `.`/`..` segments so two different spellings of the
 * same target agree (research D5's location-based dedup depends on
 * this).
 *
 * Does not follow symlinks and does not touch the filesystem — this is
 * lexical resolution only, so it can run before the target is known to
 * exist (T030's "cycle detection before bytes exist" needs exactly
 * this). Symlink-aware canonicalization is `src/resolve/location.ts`'s
 * future sandbox-escape check (FR-021, User Story 4, out of scope here) —
 * a deliberately different, later, IO-touching step over a *local* path
 * only after it has passed this lexical resolution.
 *
 * Not yet scheme-aware: `reference.text` is always treated as a local
 * path. Recognizing `https://`/`http://`/other schemes is User Story 3/4
 * work (FR-013, T062) and out of scope for this slice — see the report.
 */
export function resolveReferenceLocation(reference: Reference, referringDocumentLocation: string): string {
  const baseDir = dirname(referringDocumentLocation);
  return resolvePath(baseDir, expandTilde(reference));
}

/** Resolve a caller-supplied entry path to an absolute location, the same way every other reference is resolved — relative to `process.cwd()` if not already absolute. This is the *one* legitimate use of the working directory in this module: there is no "referring document" for the entry itself. */
export function toAbsoluteEntryLocation(entryPath: string): string {
  return resolvePath(entryPath);
}

export type ReadOutcome = { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly reason: string };

/**
 * Read the bytes at `location`, distinguishing success from any failure
 * (missing file, permission denied, a directory instead of a file, …) —
 * the caller turns a failure into a `document-unreachable` diagnostic
 * anchored to the reference, not to this read (FR-023). Never throws.
 */
export function readLocalDocument(location: string): ReadOutcome {
  try {
    const buffer = readFileSync(location);
    return { ok: true, bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }
}

/** Build a `ResolvedDocument` from a location already read into bytes. `location` is used as `DocumentIdentity.location` verbatim — see the report for why this is the lexically-resolved path (`resolveReferenceLocation`'s output) rather than a symlink-following real path: identity/dedup in this slice operates on the lexical location, and `fs.realpathSync` canonicalization is reserved for the sandbox-escape check (User Story 4). */
export function createResolvedDocument(location: string, bytes: Uint8Array, via: Reference | undefined): ResolvedDocument {
  return {
    identity: createDocumentIdentity(location, bytes),
    bytes,
    ...(via !== undefined ? { via } : {}),
    verified: false,
  };
}
