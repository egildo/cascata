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
 * confined to `sandboxRoot`, config-authored ones exempt) is User Story 4.
 *
 * **v0.7 (SPEC.md Article VI, FR-022, FR-025 through FR-027)**: every
 * function here that used to touch the filesystem directly —
 * `readLocalDocument` (a local read) and `isWithinSandbox`/`safeRealpath`
 * (canonicalization for the sandbox check) — now asks a `Host`
 * (`resolve/host.ts`) instead, and is `async` accordingly. This is a
 * **move, not a change** (FR-027): `isWithinSandbox`'s own fallback
 * behaviour when a location cannot be canonicalized — the lexical path
 * stands in, and "cannot be canonicalized" is a sandbox verdict in
 * neither direction — is preserved exactly, just now sourced from
 * `host.canonicalize()` returning `undefined` instead of a caught
 * `realpathSync` exception. This file no longer imports `node:fs` at
 * all — enforced by `tests/unit/layering.test.ts`'s host-boundary sweep.
 *
 * `src/resolve/` must never import from `src/adapters/` — enforced by
 * tests/unit/layering.test.ts.
 */
import { type PathFacility } from "../paths.js";
import { type DocumentIdentity } from "./identity.js";
import type { Reference } from "./reference.js";
import type { Host } from "./host.js";
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
export type ReferenceLocationKind = {
    readonly kind: "local";
    readonly location: string;
} | {
    readonly kind: "https";
    readonly url: string;
} | {
    readonly kind: "unsupported-scheme";
    readonly scheme: string;
};
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
export declare function classifyReferenceLocation(reference: Reference, referringDocumentLocation: string, paths: PathFacility): ReferenceLocationKind;
/**
 * Classify a location the **host** supplied for a reference in a scheme
 * it owns (v1.4 FR-001/FR-002, `Host.locate`). The host has already done
 * the resolving; this only reads what kind of location came back, so that
 * the same downstream code handles it as it handles any other:
 * `https://` is a remote document (fetched, cached, pin-verified through
 * the transport that has existed since v0.2), anything else an absolute
 * local path.
 *
 * Deliberately **not** `classifyReferenceLocation`: there is no referring
 * document to resolve against — the host answered with a location, not
 * with more reference text — and a returned string carrying some third
 * scheme is not re-offered to the host. One hop is the whole contract.
 * `resolvePath` is applied to the local case only so that an already
 * absolute path is normalized the same way every other local location in
 * this module is (`.`/`..` segments collapsed, so location-based dedup
 * still agrees with a path-named reference to the same document).
 */
export declare function classifyLocatedDocument(location: string, paths: PathFacility): ReferenceLocationKind;
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
export declare function resolveReferenceLocation(reference: Reference, referringDocumentLocation: string, paths: PathFacility): string;
/** Resolve a caller-supplied entry path to an absolute location, the same way every other reference is resolved — relative to `process.cwd()` if not already absolute. This is the *one* legitimate use of the working directory in this module: there is no "referring document" for the entry itself. */
export declare function toAbsoluteEntryLocation(entryPath: string, paths: PathFacility): string;
/** Resolve a caller-supplied sandbox root to an absolute path, the same way `toAbsoluteEntryLocation` does for the entry document — relative to `process.cwd()` if not already absolute. A second legitimate use of the working directory: `sandboxRoot` (v0.2 FR-022) has no "referring document" either, being supplied directly by the caller rather than written by any document. */
export declare function toAbsoluteSandboxRoot(sandboxRoot: string, paths: PathFacility): string;
/**
 * Whether `location` — already lexically resolved (`classifyReferenceLocation`'s
 * `"local"` output) — lies within `sandboxRoot`, **judged on the resolved
 * real path, following symbolic links** (v0.2 FR-021; research D6; `SPEC.md`
 * §8.4). This is the security boundary the whole milestone exists to
 * enforce: a check against the *lexical* path is bypassed the moment a
 * symlink sitting inside the root points somewhere outside it — a schema
 * that can read arbitrary files on the reader's machine is exactly the
 * failure §8.4 exists to prevent, and a symlink is a completely ordinary
 * way to arrange that.
 *
 * **v0.7**: canonicalization is now the **host's** answer (`host.canonicalize`,
 * FR-026) for both `location` and `sandboxRoot` — `sandboxRoot` too, in
 * case the root itself is (or sits under) a symlink, so both sides of the
 * comparison are canonicalized consistently. If `location` does not exist
 * at all, `host.canonicalize` returns `undefined`; this function then
 * falls back to the already-normalized *lexical* path
 * (`classifyReferenceLocation`'s output has already resolved `.`/`..`
 * segments) rather than treating "does not exist" as either an automatic
 * pass or an automatic sandbox-escape refusal — **moved, not changed**
 * (FR-027) from v0.2's `realpathSync`-catches-and-falls-back shape. This
 * is a deliberate judgment call, recorded here and in the milestone
 * report: a target that does not exist poses no exfiltration risk
 * (nothing can be read from it), and the ordinary `document-unreachable`
 * check downstream already reports "this reference does not resolve to a
 * readable document" with its own clear diagnostic — conflating that
 * with `sandbox-escape` would blur two distinct failures into one. If
 * `sandboxRoot` itself cannot be canonicalized (rare — a caller-supplied
 * root that does not exist), the same fallback applies to it, so a
 * caller misconfiguration here still cannot crash `resolve()`
 * (contracts/resolve-api.md point 1, "Never throws for bad input").
 *
 * String-prefix comparison, not `path.relative`, because it is the
 * simplest check that is still exactly right once both sides are
 * absolute and normalized: equal to the root, or the root followed by a
 * path separator, never a bare prefix match (`/sandboxfoo` must not be
 * read as inside `/sandbox`).
 *
 * **v1.4 FR-007, a correction.** The separator is *appended* only where
 * the root does not already end in one. A filesystem root already does —
 * `/` on POSIX, `C:\` on Windows — and appending a second one produced
 * `startsWith("//")`, which no absolute path satisfies. `sandboxRoot:
 * "/"`, the one value that plainly means "contain nothing, admit
 * everything", therefore refused every reference except the root itself.
 * The `/sandboxfoo` case is why the separator is there at all and is
 * unaffected: a root that does not end in one still gets one.
 */
export declare function isWithinSandbox(host: Host, location: string, sandboxRoot: string): Promise<boolean>;
/**
 * Whether `candidate`'s **schema-authored** local target escapes
 * `sandboxRoot` (v0.2 FR-021) — always `false` for a **config-authored**
 * reference (v0.2 FR-020, `SPEC.md` §8.1's razor: the author wrote it,
 * which is consent; `SPEC.md` §9's own worked chain, `$schema:
 * ~/.config/house.yaml`, depends on this exemption). `authority` is read
 * from `candidate` itself, never inferred from `location`'s text — the
 * same invariant `Reference.authority` documents on itself (D6: a schema
 * cannot claim config authority to escape the sandbox).
 */
export declare function isSandboxEscape(host: Host, candidate: Reference, location: string, sandboxRoot: string): Promise<boolean>;
export type ReadOutcome = {
    readonly ok: true;
    readonly bytes: Uint8Array;
} | {
    readonly ok: false;
    readonly reason: string;
};
/**
 * Read the bytes at `location` via `host.read` (v0.7 FR-022a), distinguishing
 * success from any failure (missing file, permission denied, a directory
 * instead of a file, a host that simply declines, …) — the caller turns a
 * failure into a `document-unreachable` diagnostic anchored to the
 * reference, not to this read (FR-023, FR-028). Never throws.
 */
export declare function readLocalDocument(host: Host, location: string): Promise<ReadOutcome>;
/** Build a `ResolvedDocument` from a location already read into bytes. `location` is used as `DocumentIdentity.location` verbatim — see the report for why this is the lexically-resolved path (`resolveReferenceLocation`'s output) rather than a symlink-following real path: identity/dedup in this slice operates on the lexical location, and `fs.realpathSync` canonicalization is reserved for the sandbox-escape check (User Story 4). */
export declare function createResolvedDocument(location: string, bytes: Uint8Array, via: Reference | undefined): ResolvedDocument;
//# sourceMappingURL=location.d.ts.map