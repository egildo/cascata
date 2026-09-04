/**
 * Public surface — contracts/parse-api.md (v0.1), contracts/resolve-api.md
 * (v0.2), FR-025, FR-026, FR-014 (v0.1); FR-001-FR-004 (v0.2).
 *
 * `parse(bytes, options)` is the **primary** entry point (v0.2, research
 * D8): it accepts a document's exact bytes, so §4.2's UTF-8 mandate is
 * enforceable — verified, not assumed, that v0.1's text-only entry point
 * could not enforce it (invalid bytes had already become U+FFFD replacement
 * characters before Cascata ever saw them).
 *
 * `parseText(text, options)` is v0.1's original entry point, renamed but
 * behaviorally unchanged, retained for callers already holding decoded
 * text. It cannot enforce v0.2 FR-002 — documented here, not silently implied
 * otherwise, per the corollary constitution v1.1.0 added to Principle V
 * after v0.1 shipped that exact unenforceable requirement.
 *
 * Given valid UTF-8 bytes, both produce identical trees, spans included
 * (v0.2 FR-004) — mechanically true, not just in intent: `parse` decodes and
 * then calls the same underlying function `parseText` calls.
 */
import { parseYaml, parseYamlBytes } from "./adapters/yaml/parse.js";
import { adapterForFormat, formatForLocation } from "./adapters/registry.js";
import { createDiagnostic } from "./diagnostics/diagnostic.js";
import { freeze } from "./model/freeze.js";
import { createOrigin, createSourceSpan } from "./model/span.js";
import { createReference, extractAdoptsReference, extractSchemaReference, referenceDiagnostic } from "./resolve/reference.js";
import { accumulate as accumulateImpl, generate as generateImpl } from "./generate/index.js";
import { classifyLocatedDocument, classifyReferenceLocation, isSandboxEscape, readLocalDocument, toAbsoluteEntryLocation, toAbsoluteSandboxRoot } from "./resolve/location.js";
import { createDocumentIdentity } from "./resolve/identity.js";
import { posixPaths } from "./paths.js";
import { DocumentCache } from "./resolve/cache.js";
import { resolveFetchLimits, resolveRemoteDocument } from "./resolve/fetch.js";
import { buildGraph, DEFAULT_MAX_CHAIN_LENGTH, GraphBuilder, resolveAllBranches } from "./graph/build.js";
import { buildPedigree } from "./graph/pedigree.js";
import { checkPinningDemand } from "./graph/authority.js";
import { foldConfiguration } from "./merge/fold.js";
import { why as whyImpl } from "./merge/provenance.js";
import { checkConfiguration, schemaVocabularyProblems } from "./validate/check.js";
import { resource as resourceImpl } from "./validate/resource.js";
import { project as projectImpl } from "./project/value.js";
import { createMapping } from "./model/node.js";
import { collectDelegationGrants, isAbsoluteDelegatedPath, isDelegationSandboxEscape, mergeGrantTrees } from "./resolve/delegate.js";
import { extend } from "./extend.js";
export { nodesEqual } from "./model/equality.js";
export { createOrigin, createSourceSpan } from "./model/span.js";
function requireOrigin(options, fnName) {
    if (options.origin === undefined || options.origin === null) {
        throw new Error(`${fnName}() requires 'origin' identifying the document this input came from`);
    }
}
/**
 * Parse a document's exact bytes into a positioned, frozen tree, or a
 * non-empty, position-ordered list of diagnostics. The primary entry
 * point (contracts/resolve-api.md) — prefer this over `parseText` unless
 * the caller genuinely only has decoded text.
 *
 * Bytes that are not valid UTF-8 (RFC 3629) are refused with a diagnostic
 * naming the offending **byte** offset (v0.2 FR-002); they are never repaired
 * into replacement characters.
 *
 * Never throws for bad *documents* — a malformed, hostile, or unportable
 * document produces `{ ok: false, diagnostics }`. Throws only for
 * programmer error: a missing `origin` is exactly that.
 */
export function parse(bytes, options) {
    requireOrigin(options, "parse");
    const outcome = parseYamlBytes(bytes, options.origin, options.limits);
    if (!outcome.ok) {
        return outcome;
    }
    return { ok: true, tree: freeze(outcome.tree) };
}
/**
 * Parse a document's already-decoded text into a positioned, frozen tree,
 * or a non-empty, position-ordered list of diagnostics.
 *
 * **Cannot enforce v0.2 FR-002.** By the time a caller holds a JS string,
 * bytes that were not valid UTF-8 have already been decoded — typically
 * into U+FFFD replacement characters — and this function cannot
 * distinguish that from a document that legitimately contains U+FFFD.
 * Prefer `parse(bytes, options)` whenever the caller can supply bytes
 * instead; this function exists for callers who genuinely cannot
 * (research D8).
 *
 * Never throws for bad *documents*, for the same reason `parse` does not.
 */
export function parseText(text, options) {
    requireOrigin(options, "parseText");
    const outcome = parseYaml(text, options.origin, options.limits);
    if (!outcome.ok) {
        return outcome;
    }
    return { ok: true, tree: freeze(outcome.tree) };
}
function buildRemoteContext(options) {
    if (options.transport === undefined) {
        return undefined;
    }
    const limits = resolveFetchLimits(options.limits);
    return {
        cache: new DocumentCache(options.host),
        transport: options.transport,
        limits,
    };
}
function requireSandboxRoot(options) {
    if (options.sandboxRoot === undefined || options.sandboxRoot === null || options.sandboxRoot.length === 0) {
        throw new Error("resolve() requires 'sandboxRoot' (v0.2 FR-022) — there is no default and none is inferred from the entry document's location");
    }
}
/** v0.7 FR-028: a missing or malformed `host` throws — a programmer error, not a fact about the world (SPEC.md Article VI), the same posture `sandboxRoot` has always had. A basic shape check only (every method present) — not a promise that the methods actually work, which is what the rest of `resolve()` finds out by using them. */
function requireHost(options) {
    const host = options.host;
    if (host === undefined || host === null || typeof host.read !== "function" || typeof host.canonicalize !== "function" || typeof host.cacheRead !== "function" || typeof host.cacheWrite !== "function") {
        throw new Error("resolve() requires 'host' (v0.7 FR-022, FR-028, SPEC.md Article VI) — there is no default; pass createNodeHost() from 'cascata/host/node.js' for the ordinary local filesystem, or an in-memory host for tests");
    }
    // v1.4 FR-001: `locate` is optional — absent is the ordinary host and
    // needs no comment. Present-but-not-callable is a programmer error and
    // is named as one here rather than surfacing as a TypeError from the
    // one call site.
    if (host.locate !== undefined && typeof host.locate !== "function") {
        throw new Error("resolve() was given a 'host' whose 'locate' is not a function (v1.4 FR-001, SPEC.md Article VI) — omit the member entirely for a host that owns no namespace");
    }
}
/** A phantom, zero-width span at `documentLength: 0` — the same convention `checkSizeLimit` (v0.1) uses for "nothing was read/parsed at all yet". Used only when a document cannot even be read, so there is no real content to anchor a span inside. */
function phantomSpan(origin) {
    return createSourceSpan({ origin, start: 0, end: 0, line: 1, column: 1, documentLength: 0 });
}
/**
 * Parse `bytes` at `location` via whatever `src/adapters/registry.ts`
 * selects for it — the one call in this file that crosses into
 * `src/adapters/`. An unrecognized extension, or a recognized format with
 * no registered adapter, is folded into the same "cannot be used as a
 * document" outcome as a read failure — see the v0.2 milestone report: no
 * diagnostic code in the catalogue distinguishes "wrong format" from
 * "unreachable".
 *
 * **v1.2**: this looks the adapter up instead of comparing the format to
 * the literal `"yaml"`, which is what it did from v0.2 until the JSON
 * adapter arrived (specs/011-json-adapter research P-7). The registry
 * existed the whole time; nothing consulted it, so registering an adapter
 * changed nothing a caller could reach.
 */
function parseAtLocation(bytes, location) {
    const origin = createOrigin(location, location);
    const format = formatForLocation(location);
    const adapter = format === undefined ? undefined : adapterForFormat(format);
    if (adapter === undefined) {
        return { ok: false, diagnostics: [createDiagnostic({ level: "error", code: "document-unreachable", message: `No adapter recognizes the format of '${location}'`, primary: phantomSpan(origin) })] };
    }
    return adapter.parseBytes(bytes, origin);
}
/**
 * contracts/diagnostics.md's `reference-cycle`: primary is the reference
 * that just closed the loop; `related` names **every other reference in
 * the cycle itself**, in chain order (T051's conformance obligation,
 * settled here — an earlier version of this function, written before
 * T051 existed to judge it, over-included one reference; see below and
 * the milestone report for the full derivation).
 *
 * `chain` (from `GraphBuilder.beginVisit`'s `"cycle"` decision) is
 * `stack.slice(cycleStart)` plus the closing frame — which includes, at
 * index 0, the frame for the *first* time the repeated location was
 * visited. That frame's `incoming` is the reference that **originally
 * reached** the repeated location from *outside* the loop (e.g. a
 * config's `$schema` reaching a schema that later turns out to
 * self-`$adopts`) — not a reference *within* the loop at all,
 * graph-theoretically: a cycle beginning and ending at node X consists of
 * the edges from X back to X, not the edge that led into X in the first
 * place. Including it in `related` over-reports for a plain
 * self-reference (schema `$adopts` itself): the naive `chain.slice(0,-1)`
 * would name the edge that discovered the schema as if it were part of
 * the loop, when the loop is a single edge (the self-reference) with
 * *nothing* else in it. `chain.slice(1, -1)` — dropping both the
 * first-reached frame and the closing frame, which `primary` already
 * covers — is what actually walks the interior of the loop: empty for a
 * pure self-reference, and for a longer cycle (a → b → a), exactly the
 * other edges within it (a's own outgoing edge to b), in chain order.
 */
function cycleDiagnostic(chain) {
    const closing = chain[chain.length - 1];
    if (closing?.incoming === undefined) {
        throw new Error("Internal error: a cycle's closing frame has no incoming reference");
    }
    const related = chain
        .slice(1, -1)
        .map((frame, index) => (frame.incoming === undefined ? undefined : { label: `cycle position ${index + 1}`, span: frame.incoming.span }))
        .filter((entry) => entry !== undefined);
    return referenceDiagnostic("reference-cycle", closing.incoming, `Reference '${closing.incoming.text}' closes a cycle back to an already-visited document`, related);
}
/**
 * contracts/diagnostics.md's `multiple-adoption`, now (SPEC.md §9,
 * amended) refused purely on **shape** — any sequence value for
 * `$adopts`/`$schema` — rather than on how many *distinct* locations its
 * items name. `extraction.entries` holds a `Reference` per string-scalar
 * sequence item (T032):
 *
 * - 2+ entries: primary is the **second** entry's span, `related` names
 *   the first (contracts/diagnostics.md's table, applied literally).
 * - exactly 1 entry: no "second" exists — the sole entry's span is the
 *   only reasonable anchor, so it becomes primary with no `related`.
 * - 0 entries (every item was non-string, or the sequence was empty):
 *   nothing to anchor to but the sequence node itself.
 *
 * These last two cases aren't explicitly worked out in
 * contracts/diagnostics.md's table (which only shows the 2-entry case) —
 * a judgment call recorded in the milestone report, not a spec quotation.
 */
function multipleAdoptionDiagnostic(extraction) {
    const [first, second] = extraction.entries;
    if (second !== undefined) {
        return createDiagnostic({ level: "error",
            code: "multiple-adoption",
            message: "A sequence value is refused for '$adopts'/'$schema' — v1 adopts exactly one parent (SPEC.md §6.1, §9)",
            primary: second.span,
            related: first === undefined ? [] : [{ label: "first parent", span: first.span }],
        });
    }
    if (first !== undefined) {
        return createDiagnostic({ level: "error",
            code: "multiple-adoption",
            message: "A sequence value is refused for '$adopts'/'$schema', even with a single item — v1 adopts exactly one parent, written as a single string scalar (SPEC.md §6.1, §9)",
            primary: first.span,
            related: [],
        });
    }
    return createDiagnostic({ level: "error",
        code: "multiple-adoption",
        message: "A sequence value is refused for '$adopts'/'$schema' — v1 adopts exactly one parent, written as a single string scalar (SPEC.md §6.1, §9)",
        primary: extraction.sequenceSpan,
        related: [],
    });
}
/**
 * contracts/diagnostics.md's fetching-and-integrity codes (T045, T048),
 * plus `document-not-cached` and v0.1's `size-limit-exceeded` reused for
 * an oversized remote body — every way `resolve/fetch.ts`'s
 * `resolveRemoteDocument` can refuse, translated into a `Diagnostic`
 * anchored to `candidate` (contracts/diagnostics.md: "a resolution code
 * MUST anchor to a reference, never to a fetched document alone").
 */
function remoteFailureDiagnostic(failure, candidate) {
    switch (failure.kind) {
        case "unsupported-scheme":
            return createDiagnostic({ level: "error",
                code: "unsupported-scheme",
                message: `Reference '${candidate.text}' redirected to an unsupported scheme '${failure.scheme}:' — only HTTPS is permitted (v0.2 FR-013)`,
                primary: candidate.span,
            });
        case "insecure-redirect":
            return createDiagnostic({ level: "error",
                code: "insecure-redirect",
                message: `Reference '${candidate.text}' redirected to a non-HTTPS location ('${failure.location}') — every redirect hop must satisfy v0.2 FR-013, and the insecure hop is refused before it is followed`,
                primary: candidate.span,
            });
        case "too-many-redirects":
            return createDiagnostic({ level: "error",
                code: "too-many-redirects",
                message: `Reference '${candidate.text}' exceeded the redirect hop limit (v0.2 FR-028)`,
                primary: candidate.span,
            });
        case "size-limit-exceeded":
            return createDiagnostic({ level: "error",
                code: "size-limit-exceeded",
                message: `Fetched document at '${candidate.text}' is at least ${failure.actualBytes} bytes, exceeding the size limit`,
                primary: candidate.span,
            });
        case "not-cached":
            return createDiagnostic({ level: "error",
                code: "document-not-cached",
                message: `Reference '${candidate.text}' is neither reachable nor already cached (v0.2 FR-018)`,
                primary: candidate.span,
            });
        case "pin-mismatch":
            return createDiagnostic({ level: "error",
                code: "pin-mismatch",
                message: `Fetched bytes for '${candidate.text}' do not match the stated $pin — expected sha256:${failure.expected}, got sha256:${failure.actual} (v0.2 FR-014)`,
                primary: candidate.span,
            });
        case "malformed-pin":
            return createDiagnostic({ level: "error",
                code: "malformed-pin",
                message: `'$pin' on the reference to '${candidate.text}' is not a well-formed 'sha256:<64 hex digits>' value (v0.2 FR-015)`,
                primary: candidate.span,
            });
    }
}
/**
 * Read `candidate`'s bytes, whichever kind of location it names —
 * dispatching to a local read (via the `Host`, v0.7) or (via `remote`) a
 * cache-aware HTTPS fetch with `$pin` verification. `remote` is
 * `undefined` exactly when `ResolveOptions.transport` was never supplied
 * (v0.7: the opt-in for remote resolution — `cacheDir` moved to the host
 * itself); reaching an `https` target with no `remote` is a programmer
 * error (see `ResolveOptions.transport`'s own doc), not a document-shaped
 * refusal — it throws, matching `sandboxRoot`'s and `origin`'s existing
 * posture.
 */
async function readAtTarget(host, target, candidate, remote) {
    if (target.kind === "unsupported-scheme") {
        // Unreachable via walkAdoptsChain's own call site, which branches on
        // `target.kind` before ever calling this function — kept exhaustive
        // here defensively rather than asserted away.
        throw new Error(`Internal error: readAtTarget called with an unsupported-scheme target ('${target.scheme}:')`);
    }
    if (target.kind === "local") {
        const read = await readLocalDocument(host, target.location);
        if (!read.ok) {
            return {
                ok: false,
                diagnostic: createDiagnostic({ level: "error",
                    code: "document-unreachable",
                    message: `Cannot read '${target.location}' (referenced as '${candidate.text}'): ${read.reason}`,
                    primary: candidate.span,
                }),
            };
        }
        return { ok: true, bytes: read.bytes, verified: false };
    }
    if (remote === undefined) {
        throw new Error(`resolve() requires 'transport' (v0.7, SPEC.md Article VI) to fetch the remote reference '${candidate.text}' — there is no default and none is inferred, the same "granted, never ambient" posture as 'sandboxRoot'`);
    }
    const fetched = await resolveRemoteDocument(target.url, candidate.pin, remote);
    if (!fetched.ok) {
        return { ok: false, diagnostic: remoteFailureDiagnostic(fetched.failure, candidate) };
    }
    return { ok: true, bytes: fetched.bytes, verified: fetched.verified };
}
/**
 * Walk one `$adopts`/`$schema` step: classify `candidate`'s target
 * against `referringLocation` (T027/T043 — never against the entry or
 * the working directory, and scheme-aware since User Story 3), check it
 * against the builder **before** reading anything (T030), read (locally
 * or remotely) and parse it if genuinely new, then recurse into its own
 * `$adopts`. Returns every schema document from `candidate` down to the
 * chain's root, in discovery (leaf-to-root) order — `graph/build.ts` and
 * `graph/pedigree.ts`'s shared contract for that order.
 *
 * The builder's `location` key is the lexically-resolved local path or
 * the (already-redirect-resolved-to-nothing-yet) URL string, uniformly —
 * `GraphBuilder` only ever sees an opaque string (research D5), so
 * location-based pre-fetch dedup (v0.2 FR-019, T045) falls out of the
 * exact same mechanism v0.2 FR-009 already uses for local files, applied
 * to a URL. See the milestone report for why no fixture in this
 * milestone's `$schema`/`$adopts` vocabulary can exercise two references
 * converging on one *remote* identity end-to-end (the same structural
 * finding recorded for T021's local case) — the mechanism is tested
 * directly instead, in `tests/unit/graph-remote-dedup.test.ts`.
 */
async function walkAdoptsChain(host, candidate, referringLocation, builder, remote, sandboxRoot) {
    const paths = host.paths ?? posixPaths;
    const classified = classifyReferenceLocation(candidate, referringLocation, paths);
    // v1.4 FR-001: a scheme this library does not itself understand is
    // offered to the host before it is refused — the host may own that
    // namespace, and Article VI's whole premise is that the host answers
    // what is at a location. `undefined`, and a host with no `locate` at
    // all, both fall through to v0.2 FR-013's unchanged refusal (FR-004).
    const located = classified.kind === "unsupported-scheme" ? await host.locate?.(candidate.text) : undefined;
    const hostLocated = located !== undefined;
    const target = located === undefined ? classified : classifyLocatedDocument(located, paths);
    if (target.kind === "unsupported-scheme") {
        // Refused *before any request is made* (v0.2 FR-013) — this branch
        // never reaches resolve/fetch.ts at all.
        return {
            ok: false,
            diagnostics: [referenceDiagnostic("unsupported-scheme", candidate, `Reference '${candidate.text}' uses scheme '${target.scheme}:' — only HTTPS and local paths are supported (v0.2 FR-013)`)],
        };
    }
    // v1.4 FR-003: a located reference is not sandbox-checked. The sandbox
    // confines what a *document's own text* can reach; here the text named
    // a namespace and the host chose the location, which is the same
    // consent §8.1 reads into a config's own reference and v0.2 FR-020
    // already exempts. What the located document then writes for *itself*
    // is checked as usual — it is ordinary reference text in an ordinary
    // document, and this exemption does not travel down the chain.
    if (!hostLocated && target.kind === "local" && (await isSandboxEscape(host, candidate, target.location, sandboxRoot))) {
        // Refused *before any read is attempted* (v0.2 FR-021, research D6) —
        // judged on the resolved real path, following symlinks
        // (`isSandboxEscape`/`isWithinSandbox`, `src/resolve/location.ts`).
        // Config-authored references are exempt (FR-020) — `isSandboxEscape`
        // itself never returns `true` for one, so this branch is only ever
        // reached for a schema-authored reference.
        return {
            ok: false,
            diagnostics: [referenceDiagnostic("sandbox-escape", candidate, `Schema-authored reference '${candidate.text}' resolves outside the sandbox root '${sandboxRoot}' (v0.2 FR-021)`)],
        };
    }
    const location = target.kind === "local" ? target.location : target.url;
    const decision = builder.beginVisit(location, candidate);
    if (decision.kind === "cycle") {
        return { ok: false, diagnostics: [cycleDiagnostic(decision.chain)] };
    }
    if (decision.kind === "duplicate") {
        // Already fully resolved (and its own $adopts chain already walked)
        // earlier in this same traversal — FR-009, and (for a remote
        // location) FR-019: nothing further to do, and in particular no
        // second fetch is ever attempted.
        return { ok: true, documentsLeafToRoot: [decision.document] };
    }
    if (decision.kind === "chain-limit-exceeded") {
        // v0.2 FR-010, T056/T063: refused before `location` is read at all —
        // `candidate` is "the reference that crossed it" (contracts/
        // diagnostics.md's `chain-limit-exceeded` row).
        return {
            ok: false,
            diagnostics: [referenceDiagnostic("chain-limit-exceeded", candidate, `Reference '${candidate.text}' would extend the schema chain past the configured maxChainLength (v0.2 FR-010)`)],
        };
    }
    const read = await readAtTarget(host, target, candidate, remote);
    if (!read.ok) {
        builder.abandonVisit(location);
        return { ok: false, diagnostics: [read.diagnostic] };
    }
    const parsed = parseAtLocation(read.bytes, location);
    if (!parsed.ok) {
        builder.abandonVisit(location);
        // FR-024: a failure inside a document reached through a reference is
        // attributed to that reference, not reported as an anonymous parse
        // error inside the fetched/read document.
        return {
            ok: false,
            diagnostics: [
                createDiagnostic({ level: "error",
                    code: "document-unreachable",
                    message: `Document at '${location}' (referenced as '${candidate.text}') is not readable as a document`,
                    primary: candidate.span,
                    related: parsed.diagnostics.map((d) => ({ label: d.message, span: d.primary })),
                }),
            ],
        };
    }
    const identity = createDocumentIdentity(location, read.bytes);
    const document = { identity, tree: freeze(parsed.tree), via: candidate, verified: read.verified };
    // `location` stays on the active stack past this point (T030's fix —
    // see graph/build.ts's module doc): a self-reference in this exact
    // document's own $adopts must still be seen as a cycle, not a
    // duplicate, which requires `location` to still be "active" while its
    // own $adopts is walked below.
    const canonical = builder.registerContent(location, document);
    if (canonical !== document) {
        // Content-hash dedup (research D5): this location's bytes were
        // already seen (and its own $adopts chain already fully walked)
        // under a different location earlier in this traversal — nothing to
        // recurse into, but this location's own stack frame must still close.
        builder.finishVisit(location, canonical);
        return { ok: true, documentsLeafToRoot: [canonical] };
    }
    const adoptsExtraction = extractAdoptsReference(canonical.tree);
    if (adoptsExtraction.kind === "sequence") {
        builder.abandonVisit(location);
        return { ok: false, diagnostics: [multipleAdoptionDiagnostic(adoptsExtraction)] };
    }
    if (adoptsExtraction.kind === "none") {
        builder.finishVisit(location, canonical);
        return { ok: true, documentsLeafToRoot: [canonical] };
    }
    const parentResult = await walkAdoptsChain(host, adoptsExtraction.reference, location, builder, remote, sandboxRoot);
    if (!parentResult.ok) {
        // Aborting the whole resolve() call regardless — no further use of
        // `builder` follows, so `location`'s frame is left on the (about to
        // be discarded) stack rather than explicitly closed out.
        return parentResult;
    }
    builder.finishVisit(location, canonical);
    return { ok: true, documentsLeafToRoot: [canonical, ...parentResult.documentsLeafToRoot] };
}
/**
 * Follow `$schema` from `entryPath` through `$adopts` into a graph and a
 * root-to-leaf pedigree — local files and, as of User Story 3, `https://`
 * references too (fetched, cached, and pin-verified through the same
 * traversal, without changing this function's own shape). The entry
 * document itself is always local in this milestone (`entryPath` is a
 * caller-supplied path, never a URL). Never throws for bad *documents*
 * (contracts/resolve-api.md point 1) — a missing `sandboxRoot`, or a
 * remote reference reached with no `cacheDir` supplied, are the
 * programmer errors that still throw, matching `parse()`'s `origin`.
 */
// --- Delegation (v0.6, SPEC.md §8) -----------------------------------------
/** Same hazard class as v0.1's parse depth and v0.5's `MAX_DEMAND_DEPTH` — a resource limit against a hostile fragment chain, not an unbounded promise (v0.6 FR-012a, research.md D5). Verified reachable through the real pipeline (unlike v0.5's own depth guard): each hop needs a distinct real file, never bounded by any single parse call's own depth cap. */
export const MAX_DELEGATION_DEPTH = 64;
/**
 * Cycle/depth tracking for delegation, deliberately **not**
 * `GraphBuilder` (research.md D1's own revision, recorded here rather
 * than silently substituted): `GraphBuilder`'s `resolvedByLocation`
 * dedup is exactly right for `$schema`/`$adopts` (one schema document is
 * genuinely one shared node) but exactly wrong for delegation — v0.6
 * FR-013a requires two grafts of *one* fragment to be independent reads
 * with independent provenance, so a location already fully resolved by
 * an *earlier, non-overlapping* graft must still be revisited, not
 * shortcut to the earlier result. What *is* reused (FR-026) is the
 * technique `GraphBuilder` itself uses: an explicit active-path stack,
 * checked before any byte is read, so a cycle is caught even though the
 * document that would complete it can never be produced.
 */
export class DelegationCycleTracker {
    stack = [];
    maxDepth;
    constructor(maxDepth) {
        this.maxDepth = maxDepth;
    }
    enter(location) {
        if (this.stack.includes(location)) {
            return "cycle";
        }
        if (this.stack.length >= this.maxDepth) {
            return "depth-limit-exceeded";
        }
        this.stack.push(location);
        return "ok";
    }
    exit() {
        this.stack.pop();
    }
    chain() {
        return [...this.stack];
    }
}
/** FR-009: a fragment (at any depth within itself — nested mappings past its own root are ordinary data, never re-checked) carries no `$`-prefixed key. Checked only at a fragment's own **root** mapping, matching §8.2's "a fragment carries no `$schema`, starts no pedigree" — a fragment's own nested structure was never eligible to carry document-level directives in the first place, the same way an ordinary inline mapping never was. */
function fragmentReservedKeyDiagnostics(root) {
    if (root.type !== "mapping") {
        return [];
    }
    const problems = [];
    for (const [key, valueNode] of root.entries) {
        if (key.startsWith("$")) {
            problems.push(createDiagnostic({ level: "error",
                code: "fragment-reserved-key",
                message: `Fragment contains reserved key '${key}' — fragments carry no '$'-prefixed keys in v1 (SPEC.md §8.2, v0.6 FR-009)`,
                primary: valueNode.span,
            }));
        }
    }
    return problems;
}
/**
 * Resolve one delegated string value into its fragment (v0.6 FR-006,
 * FR-021-FR-026). `documentLocation` is the directory a *relative*
 * reference resolves against — the delegating document's own (FR-021),
 * whether that document is the config itself or, for a recursive hop, a
 * fragment that itself delegated further.
 */
async function performGraft(valueNode, documentLocation, breadcrumbChain, state) {
    if (valueNode.type !== "scalar" || valueNode.kind !== "string") {
        throw new Error("Internal error: performGraft called on a non-string node");
    }
    const text = valueNode.value;
    const paths = state.host.paths ?? posixPaths;
    if (isAbsoluteDelegatedPath(text, paths)) {
        return {
            ok: false,
            diagnostics: [createDiagnostic({ level: "error", code: "absolute-delegated-path", message: `Delegated path '${text}' is absolute — v1 opens no door for absolute delegated paths (SPEC.md §8.4, v0.6 FR-023)`, primary: valueNode.span })],
        };
    }
    // A `Reference` purely to reuse `classifyReferenceLocation`'s scheme
    // classification and local resolution (`~/`-expansion included, D6) —
    // `kind: "delegate"` and `authority: "config-authored"` are both
    // honest here: this string genuinely was written by whoever authored
    // the delegating document (a config, or a fragment several hops
    // in — never a schema, which only ever grants the *permission*).
    const reference = createReference({ text, span: valueNode.span, kind: "delegate", authority: "config-authored" });
    const target = classifyReferenceLocation(reference, documentLocation, paths);
    if (target.kind === "unsupported-scheme") {
        return { ok: false, diagnostics: [referenceDiagnostic("unsupported-scheme", reference, `Delegated reference '${text}' uses scheme '${target.scheme}:' — only HTTPS and local paths are supported (v0.6, mirroring v0.2 FR-013)`)] };
    }
    let location;
    let bytes;
    if (target.kind === "https") {
        if (!state.allowRemoteDelegation) {
            return {
                ok: false,
                diagnostics: [
                    referenceDiagnostic("remote-delegation-not-permitted", reference, `Delegated reference '${text}' names a remote target — remote delegation is refused unless the caller has opted in (never a schema — v0.6 FR-024); pass 'allowRemoteDelegation: true' to resolve() if this is intended`),
                ],
            };
        }
        location = target.url;
        const cached = state.byteCache.get(location);
        if (cached !== undefined) {
            bytes = cached;
        }
        else {
            if (state.remote === undefined) {
                throw new Error("resolve() requires 'cacheDir' to fetch a remote delegation target — the same 'granted, never ambient' posture as 'sandboxRoot'");
            }
            const fetched = await resolveRemoteDocument(target.url, reference.pin, state.remote);
            if (!fetched.ok) {
                return { ok: false, diagnostics: [remoteFailureDiagnostic(fetched.failure, reference)] };
            }
            bytes = fetched.bytes;
            state.byteCache.set(location, bytes);
        }
    }
    else {
        location = target.location;
        if (await isDelegationSandboxEscape(state.host, location, state.sandboxRoot)) {
            return {
                ok: false,
                diagnostics: [referenceDiagnostic("sandbox-escape", reference, `Delegated reference '${text}' resolves outside the sandbox root '${state.sandboxRoot}' (SPEC.md §8.4, v0.6 FR-022)`)],
            };
        }
        const cached = state.byteCache.get(location);
        if (cached !== undefined) {
            bytes = cached;
        }
        else {
            const read = await readLocalDocument(state.host, location);
            if (!read.ok) {
                return { ok: false, diagnostics: [createDiagnostic({ level: "error", code: "document-unreachable", message: `Cannot read '${location}' (delegated as '${text}'): ${read.reason}`, primary: valueNode.span })] };
            }
            bytes = read.bytes;
            state.byteCache.set(location, bytes);
        }
    }
    const entry = state.tracker.enter(location);
    if (entry === "cycle") {
        return {
            ok: false,
            diagnostics: [
                createDiagnostic({ level: "error",
                    code: "reference-cycle",
                    message: `Delegation cycle: '${text}' reaches a fragment already being resolved (${[...state.tracker.chain(), location].join(" -> ")}) — refused rather than followed (SPEC.md §8.3, v0.6 FR-015)`,
                    primary: valueNode.span,
                }),
            ],
        };
    }
    if (entry === "depth-limit-exceeded") {
        return {
            ok: false,
            diagnostics: [
                createDiagnostic({ level: "error", code: "depth-limit-exceeded", message: `Recursive delegation exceeds the ${MAX_DELEGATION_DEPTH}-level limit (SPEC.md §8.2, v0.6 FR-012a)`, primary: valueNode.span }),
            ],
        };
    }
    // Parsed fresh, with a per-graft-unique Origin (research.md D3): two
    // grafts of the identical fragment file must never share a node tree
    // or an Origin.id, so FR-013a's "no shared provenance" holds even
    // though the bytes were read/cached only once.
    state.graftCounter += 1;
    const graftId = `${location} #graft=${state.graftCounter}`;
    const origin = createOrigin(graftId, location);
    // Looked up in the registry rather than compared to `"yaml"` (v1.2,
    // specs/011-json-adapter research P-7) — a delegated fragment may be in
    // a different format than the document that grafts it, which is what
    // §3's format-blindness has promised since before there were two.
    const format = formatForLocation(location);
    const fragmentAdapter = format === undefined ? undefined : adapterForFormat(format);
    const reparsed = fragmentAdapter !== undefined
        ? fragmentAdapter.parseBytes(bytes, origin)
        : { ok: false, diagnostics: [createDiagnostic({ level: "error", code: "document-unreachable", message: `No adapter recognizes the format of '${location}'`, primary: phantomSpan(origin) })] };
    if (!reparsed.ok) {
        state.tracker.exit();
        return {
            ok: false,
            diagnostics: [
                createDiagnostic({ level: "error",
                    code: "document-unreachable",
                    message: `Fragment at '${location}' (delegated as '${text}') is not readable as a document`,
                    primary: valueNode.span,
                    related: reparsed.diagnostics.map((d) => ({ label: d.message, span: d.primary })),
                }),
            ],
        };
    }
    const fragmentRoot = freeze(reparsed.tree);
    const reservedKeyProblems = fragmentReservedKeyDiagnostics(fragmentRoot);
    if (reservedKeyProblems.length > 0) {
        state.tracker.exit();
        return { ok: false, diagnostics: reservedKeyProblems };
    }
    const hop = { span: valueNode.span };
    const newChain = [...breadcrumbChain, hop];
    state.breadcrumbs.set(graftId, newChain);
    // Deliberately **not** `state.tracker.exit()` here — `location` must
    // stay on the active stack until the caller has finished recursing
    // into this fragment's own further delegations (`walkForDelegation`
    // calls `exit()` itself, after that recursion returns). Popping here
    // would be the identical mistake `src/graph/build.ts`'s own module
    // doc records as a defect this codebase already hit once for
    // `$adopts` (T030's trap): a fragment whose own content delegates back
    // to itself would be read as a fresh "new" visit instead of a "cycle",
    // because the stack would already be empty by the time the
    // self-reference is checked.
    return { ok: true, node: fragmentRoot, fragmentLocation: location, breadcrumbChain: newChain };
}
/**
 * Walk `node` against `grantNode` (the grant tree rooted at this exact
 * position — the same subtree continues to govern a grafted fragment's
 * own top level, v0.6 FR-012), grafting every granted string-valued
 * position and recursing into what results. `resolveAllBranches`
 * (`src/graph/build.ts`) is what lets several granted siblings in one
 * mapping resolve independently and report every failure together
 * (v0.6 FR-027) — its first real, multi-branch caller since v0.2 wrote
 * it for exactly this milestone.
 */
async function walkForDelegation(node, grantNode, documentLocation, breadcrumbChain, state) {
    if (node.type !== "mapping" || grantNode.keys.size === 0) {
        return { ok: true, node };
    }
    const entries = [...node.entries];
    const outcome = await resolveAllBranches(entries, async ([key, childNode]) => {
        const childGrant = grantNode.keys.get(key);
        if (childGrant === undefined) {
            return { ok: true, value: [key, childNode] };
        }
        if (childGrant.grant !== undefined && childNode.type === "scalar" && childNode.kind === "string") {
            const grafted = await performGraft(childNode, documentLocation, breadcrumbChain, state);
            if (!grafted.ok) {
                return { ok: false, failures: grafted.diagnostics };
            }
            // `performGraft`'s own success path deliberately leaves
            // `grafted.fragmentLocation` on the tracker's active stack — it
            // must stay there for this recursion, so a self-reference inside
            // the fragment is still seen as a cycle. Popped here, once this
            // fragment's own further delegations have been fully resolved,
            // success or failure alike.
            const inner = await walkForDelegation(grafted.node, childGrant, grafted.fragmentLocation, grafted.breadcrumbChain, state);
            state.tracker.exit();
            if (!inner.ok) {
                return { ok: false, failures: inner.diagnostics };
            }
            return { ok: true, value: [key, inner.node] };
        }
        if (childNode.type === "mapping" && childGrant.keys.size > 0) {
            const inner = await walkForDelegation(childNode, childGrant, documentLocation, breadcrumbChain, state);
            if (!inner.ok) {
                return { ok: false, failures: inner.diagnostics };
            }
            return { ok: true, value: [key, inner.node] };
        }
        return { ok: true, value: [key, childNode] };
    });
    if (!outcome.ok) {
        return { ok: false, diagnostics: outcome.failures };
    }
    return { ok: true, node: createMapping(outcome.value, node.span) };
}
/** Union every schema layer's own `delegate:` grants, root to leaf, into one tree (v0.6 FR-008, research.md D1) — a pure `Node`-walk over each schema's own `tree`, never touching `src/validate/`. */
function collectAllDelegationGrants(schemaDocumentsRootToLeaf) {
    let tree = { keys: new Map() };
    const problems = [];
    schemaDocumentsRootToLeaf.forEach((document, rank) => {
        const collected = collectDelegationGrants(document.tree, document.identity.location, rank);
        tree = mergeGrantTrees(tree, collected.tree);
        extend(problems, collected.problems);
    });
    return { tree, problems };
}
/**
 * The last step of `resolve()` (v0.6, SPEC.md §8): collect every schema
 * layer's own `delegate:` grants (root to leaf), walk the config's own
 * tree against them, and graft every delegated string in place — so
 * everything from `merge()` onward sees a tree indistinguishable from
 * having been written inline (FR-007, FR-014). Grant-collection
 * problems (e.g. an unrecognized `delegate:` value, FR-002) are reported
 * before the config tree is ever walked, matching v0.5's own "vocabulary
 * problems first" precedent.
 *
 * **v0.7**: grant-collection can also produce `level: "info"` lints
 * (§8.1's delegate-leaf-shape lint, FR-005) alongside — never instead of —
 * any `error`s. Only an `error` aborts the call (v0.7 FR-002: a
 * result whose diagnostics are all `info` is still `ok: true`); every
 * `info` survives into the successful result's own `diagnostics` field.
 *
 * **v0.7**: also runs the `authority:` pinning-demand walk
 * (`src/graph/authority.ts`'s `checkPinningDemand`, SPEC.md §6.3/§11)
 * against the same `schemaDocumentsRootToLeaf` this function already
 * computes for delegation grants — one pass, two independent findings,
 * concatenated (v0.3 FR-028's precedent). The pedigree is built **here**,
 * not by the caller, because `PedigreeEntry.finalAgainstForking` needs
 * each schema's own resolved `AuthoritySection`, which only exists once
 * this walk has run.
 */
async function finalizeWithDelegation(host, graph, sandboxRoot, remote, allowRemoteDelegation, graftDelegation) {
    const paths = host.paths ?? posixPaths;
    const schemaDocumentsRootToLeaf = [...graph.documents.slice(1)].reverse();
    const { sections: authoritySections, diagnostics: authorityDiagnostics } = checkPinningDemand(schemaDocumentsRootToLeaf);
    const finalAgainstForkingByLocation = new Map();
    schemaDocumentsRootToLeaf.forEach((document, rank) => {
        finalAgainstForkingByLocation.set(document.identity.location, authoritySections[rank]?.finalAgainstForking === true);
    });
    const pedigree = buildPedigree(graph, finalAgainstForkingByLocation);
    const { tree: grantTree, problems } = collectAllDelegationGrants(schemaDocumentsRootToLeaf);
    const grantErrors = problems.filter((d) => d.level === "error");
    const grantInfos = problems.filter((d) => d.level === "info");
    // authorityDiagnostics are always level:"error" today (unknown-authority-member, adoption-not-pinned) — v0.7 defines no authority-related info lint.
    const errors = [...authorityDiagnostics, ...grantErrors];
    if (errors.length > 0) {
        return { ok: false, diagnostics: errors };
    }
    if (!graftDelegation) {
        // **v1.1**: a `generateTypes()` resolution's entry is a *schema*, and
        // §8's grants graft into a **configuration**. Walking a schema document
        // against them would be looking for delegated fragments in the wrong
        // document — and would perform I/O for a stage whose contract says it
        // performs none of its own. The grants are still *collected*, so an
        // unrecognized `delegate:` value is still refused above; nothing is
        // grafted.
        return { ok: true, graph, pedigree, delegationBreadcrumbs: new Map(), paths, diagnostics: grantInfos };
    }
    const state = {
        host,
        tracker: new DelegationCycleTracker(MAX_DELEGATION_DEPTH),
        byteCache: new Map(),
        sandboxRoot,
        remote,
        allowRemoteDelegation,
        breadcrumbs: new Map(),
        graftCounter: 0,
    };
    const walked = await walkForDelegation(graph.entry.tree, grantTree, graph.entry.identity.location, [], state);
    if (!walked.ok) {
        return { ok: false, diagnostics: [...walked.diagnostics] };
    }
    const graftedEntry = { ...graph.entry, tree: walked.node };
    const graftedGraph = { entry: graftedEntry, documents: [graftedEntry, ...graph.documents.slice(1)] };
    return { ok: true, graph: graftedGraph, pedigree, delegationBreadcrumbs: state.breadcrumbs, paths, diagnostics: grantInfos };
}
/**
 * `resolve()`'s body, with the two things that differ between a
 * **configuration** entry and a **schema** entry as parameters.
 *
 * `resolve()` treats its entry as the configuration: the chain starts at the
 * entry's own `$schema`, and the schema layers' delegation grants graft into
 * the entry's tree. `generateTypes()`'s entry is the leaf **schema** (plan
 * D-5): the chain starts at the entry's own `$adopts` — the key a schema
 * actually carries — and nothing grafts, because there is no configuration
 * to graft into.
 *
 * One body rather than two, so a schema chain and a config chain are read,
 * pinned, cycle-checked and sandbox-checked by the identical code (FR-033's
 * own posture, applied a stage earlier).
 */
async function resolveEntry(entryPath, options, entryReference, graftDelegation, launchingSchema) {
    requireSandboxRoot(options);
    requireHost(options);
    const host = options.host;
    const remote = buildRemoteContext(options);
    const paths = host.paths ?? posixPaths;
    const sandboxRoot = toAbsoluteSandboxRoot(options.sandboxRoot, paths);
    const maxChainLength = options.maxChainLength ?? DEFAULT_MAX_CHAIN_LENGTH;
    const builder = new GraphBuilder(maxChainLength);
    const entryLocation = toAbsoluteEntryLocation(entryPath, paths);
    const entryOrigin = createOrigin(entryLocation, entryLocation);
    const entryVisit = builder.beginVisit(entryLocation, undefined);
    if (entryVisit.kind !== "new") {
        throw new Error("Internal error: the entry document's first visit was not 'new'");
    }
    const entryRead = await readLocalDocument(host, entryLocation);
    if (!entryRead.ok) {
        // No Reference exists to blame for the entry document itself — it is
        // the root of the whole resolution, reached by nothing. A phantom
        // zero-width span at its own (synthetic) origin is the closest fit
        // to contracts/diagnostics.md's "the reference" for every other code
        // in this catalogue; see the milestone report.
        return {
            ok: false,
            diagnostics: [
                createDiagnostic({ level: "error",
                    code: "document-unreachable",
                    message: `Cannot read entry document '${entryLocation}': ${entryRead.reason}`,
                    primary: phantomSpan(entryOrigin),
                }),
            ],
        };
    }
    const entryParsed = parseAtLocation(entryRead.bytes, entryLocation);
    if (!entryParsed.ok) {
        return { ok: false, diagnostics: entryParsed.diagnostics };
    }
    const entryIdentity = createDocumentIdentity(entryLocation, entryRead.bytes);
    const entryDocument = { identity: entryIdentity, tree: freeze(entryParsed.tree), verified: false };
    // `entryLocation` stays on the active stack for the *entire* schema
    // chain below (finishVisit only after it returns) — the same
    // termination fix `walkAdoptsChain` needed applies here too: a schema
    // deep in the chain naming the entry document's own path back must
    // still be caught as a cycle.
    const canonicalEntry = builder.registerContent(entryLocation, entryDocument);
    const schemaExtraction = entryReference(canonicalEntry.tree);
    if (schemaExtraction.kind === "sequence") {
        // Not yet on the "aborting the whole call" path below — nothing has
        // recursed yet, so closing out the entry's own visit costs nothing
        // and keeps the builder's invariants honest even though this
        // instance is discarded either way.
        builder.abandonVisit(entryLocation);
        return { ok: false, diagnostics: [multipleAdoptionDiagnostic(schemaExtraction)] };
    }
    let candidate;
    if (schemaExtraction.kind === "none") {
        if (launchingSchema === undefined) {
            // Legal: no $schema at all (spec.md's Edge Cases; T023) — a
            // single-document graph and an empty pedigree.
            builder.finishVisit(entryLocation, canonicalEntry);
            const graph = buildGraph(canonicalEntry, []);
            return finalizeWithDelegation(host, graph, sandboxRoot, remote, options.allowRemoteDelegation ?? false, graftDelegation);
        }
        // v1.3 FR-001: the embedder's launching schema stands in for the
        // `$schema` line the entry did not write. Config-authored, because the
        // embedder's option is consent the way a config's own reference is
        // (§8.1); anchored at a phantom span in the entry document, because
        // no position in any document wrote it — the same convention the
        // unreadable-entry diagnostic above uses for "reached by nothing".
        candidate = createReference({ text: launchingSchema, span: phantomSpan(entryOrigin), kind: "schema", authority: "config-authored" });
    }
    else {
        candidate = schemaExtraction.reference;
    }
    const chainResult = await walkAdoptsChain(host, candidate, entryLocation, builder, remote, sandboxRoot);
    if (!chainResult.ok) {
        // Aborting the whole call — no further use of `builder` follows, so
        // `entryLocation`'s frame is left on the (about to be discarded)
        // stack rather than explicitly closed out (same reasoning as
        // `walkAdoptsChain`'s own failure paths).
        return { ok: false, diagnostics: chainResult.diagnostics };
    }
    builder.finishVisit(entryLocation, canonicalEntry);
    const graph = buildGraph(canonicalEntry, chainResult.documentsLeafToRoot);
    return finalizeWithDelegation(host, graph, sandboxRoot, remote, options.allowRemoteDelegation ?? false, graftDelegation);
}
/**
 * Resolve a configuration's whole pedigree from its launching point
 * (contracts/resolve-api.md), unchanged from v0.2 in behaviour and in
 * signature: the entry is the configuration, its `$schema` starts the
 * chain, and delegation grafts.
 */
export async function resolve(entryPath, options) {
    return resolveEntry(entryPath, options, extractSchemaReference, true, options.schema);
}
/**
 * Fold `resolved.graph` and `resolved.pedigree` into a `MergedConfiguration`
 * — never both a configuration and diagnostics (contracts/merge-api.md
 * point 1). A schema's `provide` fills what the config leaves silent;
 * mappings merge deeply; everything else replaces, unless a key resolves
 * to `cascade: append`, which accumulates root-first instead
 * (contracts/precedence.md).
 *
 * A strategy takes effect from the layer that declares it **downward**: it
 * does not reach back over a `replace` an ancestor had already settled
 * (v0.3 FR-026; `SPEC.md` §5.3's worked cascade spells the outcome out).
 *
 * All of this milestone's merge-policy validation is implemented: an unknown
 * or non-string `cascade`, the reserved `merge-by-key`, `append` over a
 * non-sequence, and a strategy weakened away from accumulation. Vocabulary
 * failures and data-shape failures are found by different passes and are
 * reported **together** (v0.3 FR-028) — reporting one category at a time was
 * a real gap, closed in T061.
 */
export function merge(resolved) {
    return foldConfiguration(resolved.graph, resolved.pedigree, resolved.delegationBreadcrumbs, resolved.paths);
}
// --- why() — User Story 3 (v0.3, tasks.md T049) --------------------------
/**
 * Answer where a merged value came from — `merge-api.md`'s three
 * outcomes: an ordered `chain`, `synthesized` for a container no single
 * layer wrote, or `unknown-pointer` for a pointer that names nothing in
 * `configuration.tree`. A library function, not a command (research D3) —
 * `SPEC.md` §10 writes `tool why`, but no CLI ships in this milestone.
 */
export const why = whyImpl;
/**
 * Where a `path`/`url` value at `pointer` denotes, resolved against the
 * directory of the document that **declared** it (FR-035 through
 * FR-039) — never the entry document's, never confined to the sandbox
 * root (§8.1's razor from the other side, FR-038), and purely lexical
 * (nothing is read, existence is never checked, FR-039). A query, not a
 * check: it produces no diagnostic and cannot fail a `load()` call.
 */
export const resource = resourceImpl;
/**
 * The value view (Article VII): a merged configuration as ordinary JS data
 * — null-prototype objects in §4.2's canonical key order, arrays, and
 * scalars — with whatever `info` lints the projection earned.
 *
 * **A projection, never a replacement.** The `MergedConfiguration` handed
 * in is untouched and keeps its tree, spans, provenance and pedigree, so a
 * consumer who needs a position has not lost one and `why()` still answers
 * by RFC 6901 pointer. A consumer who needs a value no longer pays for
 * positions they will not read.
 *
 * Reachable without `load()` (v1.0 FR-023, Principle IV): it is a pipeline
 * stage that consumes only the previous stage's output, and a tool stepping
 * through the stages by hand gets the same value `load()` puts on its own
 * result, from the same one implementation.
 *
 * `T` is the caller's claim and is **never checked** — see
 * `ProjectionResult.value`.
 */
export const project = projectImpl;
/**
 * Certify `configuration` against every layer's `demand`, or refuse with
 * diagnostics — never both (contracts/validate-api.md point-by-point
 * behavioral contract). Never mutates `configuration` (FR-034); never
 * performs I/O or reference resolution (FR-035) — every document it needs
 * is already on `configuration.layers`.
 *
 * **v0.7 FR-002**: `ok: true`'s own `diagnostics` carries whatever `info`
 * lints were found (e.g. §5.5's `required-vacuous`) — possibly empty. A
 * successful certification is never made to discard its own lints.
 */
export function validate(configuration) {
    const outcome = checkConfiguration(configuration);
    if (!outcome.ok) {
        return { ok: false, diagnostics: outcome.diagnostics };
    }
    return { ok: true, certified: configuration, diagnostics: outcome.diagnostics };
}
/**
 * Validate a schema document against a meta-schema — the self-hosting
 * call (§2.6: "publishing a schema = validating it as a config").
 *
 * **The meta-schema is obtained through the host seam, never as a bundled
 * constant** (FR-019). That is not ceremony: it is the one document that
 * would have been exempt from the article governing every other, and §16
 * names this bootstrap as `load()`'s reason for existing. A host with no
 * filesystem serves it exactly as well as one with a disk.
 *
 * **Available, not automatic** (research.md D-2). This is deliberately not
 * wired into `load()`. Running the meta-schema on every resolution would
 * double the work of every one of them and change the diagnostics of every
 * schema written in the last six milestones; §2.6 frames self-hosting as a
 * *publishing* act, and this is that act. Whether it becomes the default
 * is a v1.0 question, decided with the vocabulary freeze. **A judgment
 * call, not a citation** — flagged here rather than buried.
 *
 * **No reference resolution happens.** The subject's own `$schema` and
 * `$adopts` are inert data, not links to follow: a meta-schema judges one
 * document's *shape*, which is all a meta-schema can judge (research.md
 * W-3 — it cannot express that a `provide` satisfies its own key's
 * demands, nor any row of §5.2's monotonicity table, nor §7's namespace
 * resolution; all three stay hand-written checks). Following the subject's
 * links would also mean judging it against its own ancestors instead of
 * against the meta-schema, which is a different question entirely.
 *
 * The two documents become two layers — the meta-schema as the schema
 * layer, the subject as the config layer — folded by the real `fold()` and
 * judged by the real `validate()`. There is no second implementation of
 * anything (FR-033's own posture, applied here).
 */
export async function metaValidate(options) {
    if (options === null || typeof options !== "object" || typeof options.host !== "object" || options.host === null || typeof options.host.read !== "function") {
        throw new TypeError("metaValidate() requires 'host' (SPEC.md Article VI) — see cascata/host/node's createNodeHost()");
    }
    const documents = [];
    // Entry first, then the schema chain leaf-to-root — `Graph`'s own order
    // contract, which `deriveLayers` reverses into the root-to-leaf ranks
    // `validate()` walks. Building it this way rather than assembling
    // `Layer`s by hand is what keeps this one call site honest: it produces
    // the same shape `resolve()` produces, and `merge()` does the rest.
    for (const location of [options.subject, options.metaSchema]) {
        const read = await options.host.read(location);
        if (!read.ok) {
            return {
                ok: false,
                diagnostics: [
                    createDiagnostic({
                        level: "error",
                        code: "document-unreachable",
                        message: `Document at '${location}' is not readable: ${read.reason}`,
                        primary: createSourceSpan({ origin: createOrigin(location, location), start: 0, end: 0, line: 1, column: 1, documentLength: 0 }),
                    }),
                ],
            };
        }
        const parsed = parse(read.bytes, { origin: createOrigin(location, location) });
        if (!parsed.ok) {
            return { ok: false, diagnostics: parsed.diagnostics };
        }
        documents.push({ identity: createDocumentIdentity(location, read.bytes), tree: parsed.tree, verified: false });
    }
    const entry = documents[0];
    if (entry === undefined) {
        throw new Error("Internal error: metaValidate read no documents");
    }
    const merged = foldConfiguration({ entry, documents }, [], new Map());
    if (!merged.ok) {
        return { ok: false, diagnostics: merged.diagnostics };
    }
    const validated = validate(merged.configuration);
    return validated.ok ? { ok: true, diagnostics: validated.diagnostics } : { ok: false, diagnostics: validated.diagnostics };
}
// --- generateTypes() — User Story 5 (v1.1, SPEC.md Article VIII (§18)) ----
export { accumulate, generate } from "./generate/index.js";
/**
 * TypeScript declaration text for a schema chain — `SPEC.md` Article VIII's
 * "one call", and Article VI's laws unchanged.
 *
 * **The entry is the leaf schema, not a configuration** (plan D-5). That is
 * the one place this differs from `load()`, and it is a difference of role
 * rather than of machinery: `resolveEntry` reads the chain from the entry's
 * own `$adopts` instead of a `$schema` a schema does not have, and the same
 * pinning, cycle, sandbox and vocabulary rules apply to every document
 * reached. The pedigree becomes the schema layers root to leaf; the entry
 * becomes the leaf layer, at rank `pedigree.length`.
 *
 * **A schema the language refuses is never emitted from** (FR-030): the
 * closed-vocabulary pass `validate()` runs before any value check runs here
 * too, through the same functions, and any `error` is the whole answer.
 *
 * Performs no I/O of its own and writes nothing (Article VI): every
 * document is read through the host, and the caller decides where the text
 * goes. Throws only for programmer error — a missing `host` or
 * `sandboxRoot`, exactly as `load()` does.
 */
export async function generateTypes(schemaLocation, options) {
    const resolved = await resolveEntry(schemaLocation, options, extractAdoptsReference, false, undefined);
    if (!resolved.ok) {
        return { ok: false, diagnostics: resolved.diagnostics };
    }
    // `graph.documents` is [entry, ...ancestors leaf-to-root], so the
    // ancestors reversed are root-to-leaf and the entry is the leaf — the
    // same shape `deriveLayers` builds, with the entry labelled `schema`
    // rather than `config`, which is the whole of D-5.
    const ancestors = [...resolved.graph.documents.slice(1)].reverse();
    const layers = ancestors.map((document, index) => ({ identity: document.identity, role: "schema", rank: index, tree: document.tree }));
    layers.push({ identity: resolved.graph.entry.identity, role: "schema", rank: layers.length, tree: resolved.graph.entry.tree });
    const schemaProblems = schemaVocabularyProblems(layers);
    const schemaErrors = schemaProblems.filter((diagnostic) => diagnostic.level === "error");
    if (schemaErrors.length > 0) {
        return { ok: false, diagnostics: schemaErrors };
    }
    const accumulated = accumulateImpl(layers, options.rootName !== undefined ? { rootName: options.rootName } : {});
    const generated = generateImpl(accumulated.tree);
    const emitErrors = generated.diagnostics.filter((diagnostic) => diagnostic.level === "error");
    if (emitErrors.length > 0) {
        return { ok: false, diagnostics: emitErrors };
    }
    return {
        ok: true,
        source: generated.source,
        tree: accumulated.tree,
        diagnostics: [...resolved.diagnostics, ...schemaProblems.filter((diagnostic) => diagnostic.level === "info"), ...accumulated.diagnostics, ...generated.diagnostics],
    };
}
export async function load(entryPath, options) {
    const resolved = await resolve(entryPath, options);
    if (!resolved.ok) {
        return { ok: false, diagnostics: resolved.diagnostics };
    }
    const merged = merge(resolved);
    if (!merged.ok) {
        return { ok: false, diagnostics: merged.diagnostics };
    }
    const validated = validate(merged.configuration);
    if (!validated.ok) {
        return { ok: false, diagnostics: validated.diagnostics };
    }
    // v1.0: the last stage, composed like the others rather than
    // reimplemented — `project()` stays public and a tool stepping through
    // the pipeline by hand reaches the identical value from the identical
    // implementation (FR-023).
    const projected = projectImpl(validated.certified);
    return { ok: true, configuration: validated.certified, value: projected.value, diagnostics: [...resolved.diagnostics, ...validated.diagnostics, ...projected.diagnostics] };
}
//# sourceMappingURL=index.js.map