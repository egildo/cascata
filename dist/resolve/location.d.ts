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
import { type Diagnostic } from "../diagnostics/diagnostic.js";
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
}
/** v1.13 FR-020: an `https://` URL that carries a fragment (`"#x"`; `""` for a bare `#`). Refused by the caller as `reference-fragment`; never fetched. */
 | {
    readonly kind: "fragment";
    readonly url: string;
    readonly fragment: string;
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
/** A document that writes references: its logical location, and where it really is (v1.13). */
export interface Referrer {
    readonly location: string;
    readonly physical: string;
}
/**
 * Where a relative reference starts (v1.13 FR-010, FR-011), and where the other rule would have started it.
 * In a **file** it starts from the logical path (as the shell's default `cd` resolves `..`, Pike's *Getting
 * Dot-Dot Right*), in a **remote** document from the physical URL (as a browser resolves against a response's
 * final URL). `other` is the base the other rule would have used: `link-changes-reference` (FR-012) is
 * raised where the two name different documents.
 */
export declare function referenceBases(referrer: Referrer): {
    readonly used: string;
    readonly other: string;
};
/** v1.13 FR-013: `'<logical>'`, and `(the file '<physical>')` after it where they differ. */
export declare function namedDocument(location: string, physical: string): string;
/**
 * v1.13 FR-012: the `info` notice for a relative reference whose document is behind a link or a redirect and
 * whose two readings — from the logical path and from the physical one — are **different documents**; or
 * `undefined`. `loaded` is the document the reference loaded (by the rule `referenceBases` names), as
 * `classifyReferenceLocation` answered it and, for a file, with its physical path. Only a document whose
 * logical and physical paths differ pays for the second resolution, and for a file it costs one question to
 * the host per distinct path (`PhysicalPaths` remembers).
 *
 * A file is judged by physical identity: the other answer is the same document when it is the same physical
 * path, however it is spelled; one that does not exist counts as different (`PhysicalPaths.of` judges it
 * through its nearest existing ancestor, so it can never equal a file that is there). A remote document's
 * other answer is not fetched: two URLs are different documents here when they are different URLs, which can
 * only be too many notices (a redirect that leads both to one file), never too few.
 *
 * The notice never refuses and is positioned at the reference. The host answers where a path ends, not which
 * link it crossed, so the message names the two ends -- the referring document's logical and physical paths --
 * rather than the link.
 */
export declare function linkNotice(physical: PhysicalPaths, paths: PathFacility, candidate: Reference, referrer: Referrer, loaded: {
    readonly kind: "local";
    readonly location: string;
    readonly physical: string;
} | {
    readonly kind: "https";
    readonly url: string;
}): Promise<Diagnostic | undefined>;
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
/**
 * Resolve the caller-supplied sandbox root — or, as of v1.7 FR-004, roots
 * — to absolute paths, the same way `toAbsoluteEntryLocation` does for the
 * entry document: relative to `process.cwd()` if not already absolute. A
 * second legitimate use of the working directory: `sandboxRoot` (v0.2
 * FR-022) has no "referring document" either, being supplied directly by
 * the caller rather than written by any document.
 *
 * A bare string is the one-element list, which is the whole of the
 * widening: every door that was shut stays shut to a caller who grants one
 * root. Validation of the members themselves (v1.7 FR-005 — none absent,
 * none empty, none a non-string) happens in `src/index.ts` before this is
 * called, because it *throws* rather than diagnosing and that posture
 * belongs at the API surface.
 */
export declare function toAbsoluteSandboxRoots(sandboxRoot: string | readonly string[], paths: PathFacility): readonly string[];
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
 * **v0.7**: canonicalization is the **host's** answer (`host.canonicalize`,
 * FR-026) for both `location` and `sandboxRoot` — `sandboxRoot` too, in
 * case the root itself is (or sits under) a symlink, so both sides of the
 * comparison are canonicalized consistently.
 *
 * **v1.7 FR-001, a correction: absent is not outside.** "Cannot be
 * canonicalized" must be a sandbox verdict in neither direction — that is
 * this function's own stated rule, and until v1.7 it was not kept. The
 * host answers `undefined` for a location that does not exist, and
 * `safeCanonicalize` fell back to the *lexical* path for it. The root
 * exists, so it was canonicalized; under a root that is or sits beneath a
 * symbolic link the two sides were then compared **in different spaces**
 * (`/private/var/…/venue` against `/var/…/venue/missing.yaml`), the
 * prefixes disagreed, and a file that was merely **absent** was refused as
 * `sandbox-escape` — with a message naming as outside the root a path that
 * was inside it. On macOS that is the ordinary case, not a corner: `/tmp`
 * and `/var` are links, so every venue under `os.tmpdir()` is behind one.
 * Reported from outside as issue #2, measured on v1.6.0.
 *
 * `safeCanonicalize` now judges a location that does not exist through its
 * **nearest existing ancestor** (see its own doc), so both sides stand in
 * the same space and the two verdicts separate cleanly: an absent file
 * inside the root is `document-unreachable`, an absent file outside it is
 * `sandbox-escape`. The judgment call v0.7 recorded here survives intact
 * and is now actually implemented — a target that does not exist poses no
 * exfiltration risk (nothing can be read from it), and the downstream
 * `document-unreachable` check already reports exactly that failure with
 * its own diagnostic; conflating the two blurs two distinct failures into
 * one. A `sandboxRoot` that does not exist gets the same treatment, so a
 * caller misconfiguration still cannot crash `resolve()`
 * (contracts/resolve-api.md point 1, "Never throws for bad input").
 *
 * **What this deliberately does not close** (v1.7, "Out of scope"): a
 * dangling link *inside* the root whose target is outside it cannot be
 * canonicalized, is judged through its ancestor as inside, and then fails
 * to read — `document-unreachable`. If its target appears between the
 * check and the read, the read succeeds. v0.2 through v1.6 judged it
 * identically (the lexical fallback put it inside too); closing the window
 * needs a host verb that reads *and* reports the real path together, which
 * is a different amendment.
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
export declare function isWithinSandbox(physical: PhysicalPaths, location: string, sandboxRoots: readonly string[]): Promise<boolean>;
/**
 * The **physical path** of a local location (v1.13 FR-002, FR-003; `SPEC.md` Article VI): where the
 * document really is, as the host's `canonicalize` answers it — and the one place in a resolution that
 * asks the host. Built once per `resolve()` call, so a path is put to the host once however many
 * questions (identity, the sandbox, a diagnostic's wording) are asked of it. The sandbox and the graph
 * therefore read one answer and can never disagree about where a path is.
 *
 * `host.canonicalize(path)`, and — when the host cannot answer, i.e. when `path` does not exist — the
 * canonical path of its **nearest existing ancestor** with the remaining segments appended (v1.7
 * FR-001, now stated for the graph as well as the sandbox).
 *
 * The walk is lexical and upward: `dirname` until the host answers. The segments below that ancestor
 * need no canonicalization of their own, which is the point — they do not exist, so none of them is a
 * link, and there is nothing for a link to hide behind. They are taken as a **slice of the very string
 * they came from** (`resolved.slice(current.length)`) rather than re-joined segment by segment, so a
 * non-ASCII or oddly normalized name passes through untouched.
 *
 * Where no ancestor canonicalizes at all — a host that answers `canonicalize` for documents only, or
 * one with no notion of canonicalization — the already-normalized lexical path stands, exactly as it
 * did from v0.2 through v1.6. `paths.resolve` has already collapsed `.`/`..`, so the remainder never
 * contains either and re-resolving it against the canonical ancestor cannot move it; the leading
 * separator is stripped first because an absolute second argument to `resolve` would discard the
 * ancestor entirely.
 *
 * See `isWithinSandbox`'s own doc for why "cannot be canonicalized" is a sandbox verdict in neither
 * direction, and for the bug v1.7 fixed in this very walk.
 */
export declare class PhysicalPaths {
    private readonly host;
    private readonly paths;
    /** Every question put to the host, answered once: a path, however many documents ask, however many ancestors are walked. */
    private readonly asked;
    constructor(host: Host);
    get separator(): string;
    private canonicalize;
    /** The physical path of `path`. */
    of(path: string): Promise<string>;
}
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
export declare function isSandboxEscape(physical: PhysicalPaths, candidate: Reference, location: string, sandboxRoots: readonly string[]): Promise<boolean>;
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
/** Build a `ResolvedDocument` from a location already read into bytes. `location` is used as `DocumentIdentity.location` verbatim — the lexically-resolved, logical path (`resolveReferenceLocation`'s output); `physical` (v1.13) is where the document really is, defaulting to the location. */
export declare function createResolvedDocument(location: string, bytes: Uint8Array, via: Reference | undefined, physical?: string): ResolvedDocument;
//# sourceMappingURL=location.d.ts.map