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
import type { ParseLimits } from "./adapters/yaml/limits.js";
import { formatForLocation } from "./adapters/registry.js";
import { createDiagnostic, type Diagnostic } from "./diagnostics/diagnostic.js";
import type { Node } from "./model/node.js";
import { freeze } from "./model/freeze.js";
import { createOrigin, createSourceSpan, type Origin } from "./model/span.js";
import { extractAdoptsReference, extractSchemaReference, referenceDiagnostic, type ExtractedReference, type Reference } from "./resolve/reference.js";
import { classifyReferenceLocation, isSandboxEscape, readLocalDocument, toAbsoluteEntryLocation, toAbsoluteSandboxRoot, type ReferenceLocationKind } from "./resolve/location.js";
import { createDocumentIdentity } from "./resolve/identity.js";
import { DocumentCache } from "./resolve/cache.js";
import { createNetworkTransport, resolveFetchLimits, resolveRemoteDocument, type FetchLimits, type RemoteDocumentFailure } from "./resolve/fetch.js";
import type { Transport } from "./resolve/transport.js";
import { buildGraph, DEFAULT_MAX_CHAIN_LENGTH, GraphBuilder, type Graph, type GraphDocument, type GraphReference } from "./graph/build.js";
import { buildPedigree, type Pedigree } from "./graph/pedigree.js";
import { foldConfiguration } from "./merge/fold.js";
import type { MergedConfiguration } from "./merge/provenance.js";

export type { Diagnostic, RelatedSpan } from "./diagnostics/diagnostic.js";
export type { DiagnosticCode } from "./diagnostics/codes.js";
export { nodesEqual } from "./model/equality.js";
export type { Mapping, Node, Scalar, ScalarKind, ScalarValueOf, Sequence } from "./model/node.js";
export { createOrigin, createSourceSpan } from "./model/span.js";
export type { Origin, SourceSpan } from "./model/span.js";
export type { ParseLimits } from "./adapters/yaml/limits.js";
export type { Reference, ReferenceAuthority, ReferenceKind } from "./resolve/reference.js";
export type { Graph, GraphDocument, GraphDocumentIdentity, GraphReference } from "./graph/build.js";
export type { Pedigree, PedigreeEntry } from "./graph/pedigree.js";
export type { FetchLimits } from "./resolve/fetch.js";
export type { Recording, RecordedFailure, RecordedFailureKind, RecordedResponse, RecordingOutcome, Transport } from "./resolve/transport.js";
export type { Layer, MergeStrategy, MergedConfiguration, ProvenanceEntry, ProvenanceRecord } from "./merge/provenance.js";

/** The result of one `parse()`/`parseText()` call. Never both a tree and diagnostics. */
export type ParseResult = { readonly ok: true; readonly tree: Node } | { readonly ok: false; readonly diagnostics: Diagnostic[] };

export interface ParseOptions {
  /** Which document this text/these bytes came from. Required — see the module doc. */
  readonly origin: Origin;
  /** `maxDepth`/`maxBytes` overrides (contracts/parse-api.md's "Limits"). Absent fields use the adapter's defaults. */
  readonly limits?: Partial<ParseLimits>;
}

function requireOrigin(options: ParseOptions, fnName: string): void {
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
export function parse(bytes: Uint8Array, options: ParseOptions): ParseResult {
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
export function parseText(text: string, options: ParseOptions): ParseResult {
  requireOrigin(options, "parseText");
  const outcome = parseYaml(text, options.origin, options.limits);
  if (!outcome.ok) {
    return outcome;
  }
  return { ok: true, tree: freeze(outcome.tree) };
}

// --- resolve() — User Story 2 (v0.2, tasks.md T032) ---------------------
//
// This is the **orchestrator** plan.md's Structure Decision describes:
// the one place that consults `src/adapters/registry.ts` to cross from
// `src/resolve/` (bytes and locations) to `src/graph/` (parsed trees and
// DAG structure) — neither of which may import the other, or an adapter,
// directly (`tests/unit/layering.test.ts`, T012/T032). Every step below
// that needs both a location computation *and* a parsed tree — reading a
// referenced document, extracting its own further references, deciding
// whether it closes a cycle *before* any of that reading happens — is
// necessarily driven from here, because it is the one module allowed to
// see both sides of the boundary.
//
// **Scope, as of User Story 4 (Phase 6's checkpoint)**: local files,
// HTTPS fetching/pinning/caching, and precise refusal — cycles,
// unreachable documents, the sandbox (judged on the resolved real path,
// following symlinks — research D6), unsupported schemes,
// `chain-limit-exceeded`, and collect-all across independent branches
// (not exercisable end-to-end in this milestone's single-parent
// `$schema`/`$adopts` vocabulary — see `src/graph/build.ts`'s
// `resolveAllBranches` and the milestone report).

export interface ResolveOptions {
  /**
   * Required — no default, none inferred from the entry document's
   * location (v0.2 FR-022). **Enforced** as of User Story 4: a
   * schema-authored local reference resolving outside this root — judged
   * on the real, symlink-resolved path (`src/resolve/location.ts`'s
   * `isSandboxEscape`, FR-021, research D6) — is refused as
   * `sandbox-escape`. A config-authored reference is exempt (FR-020).
   */
  readonly sandboxRoot: string;
  /**
   * The maximum number of **schema** documents (the pedigree, not
   * counting the entry/config document) a chain may contain before being
   * refused as `chain-limit-exceeded` (v0.2 FR-010). Defaults to
   * `graph/build.ts`'s `DEFAULT_MAX_CHAIN_LENGTH` (32), matching
   * contracts/resolve-api.md's documented default.
   */
  readonly maxChainLength?: number;
  /**
   * Where fetched remote documents are cached on disk (v0.2 FR-016).
   * **Optional here**, deliberately narrower than
   * contracts/resolve-api.md, which marks it `cacheDir?`
   * and names it conditionally required: a resolution that never
   * reaches a remote reference has nothing to cache, and requiring it
   * unconditionally would gratuitously break every purely-local caller
   * (User Story 2's own tests among them) for a capability they cannot
   * possibly exercise. If resolution *does* reach an `https://`
   * reference and no `cacheDir` was supplied, `resolve()` throws — the
   * same "required exactly when needed, granted, never ambient"
   * posture `sandboxRoot` has always had (Principle VI) — rather than
   * inferring a default location. See the milestone report for this
   * judgment call.
   */
  readonly cacheDir?: string;
  /**
   * Injection point for the HTTP transport (research D7). Omit for the
   * real network; tests always supply a `RecordedTransport`
   * (constitution, Technology & Security Constraints — no test in this
   * codebase ever omits this field).
   */
  readonly transport?: Transport;
  /** Overrides for `resolve/fetch.ts`'s `FetchLimits` (`maxRedirects`, `requestTimeoutMs`, `maxBytes`). `maxChainLength` is a top-level field on this interface, not part of `FetchLimits` — it bounds the schema chain (`src/graph/build.ts`), not any one HTTP fetch. */
  readonly limits?: Partial<FetchLimits>;
}

/**
 * What `walkAdoptsChain` needs to resolve an `https://` reference — built
 * once per `resolve()` call from `ResolveOptions`, lazily (only
 * constructed if `cacheDir` was supplied), and threaded down rather than
 * reconstructed per reference. `undefined` when the caller supplied no
 * `cacheDir` at all; a remote reference reached with this `undefined`
 * throws (see `ResolveOptions.cacheDir`'s own doc).
 */
interface RemoteContext {
  readonly cache: DocumentCache;
  readonly transport: Transport;
  readonly limits: FetchLimits;
}

function buildRemoteContext(options: ResolveOptions): RemoteContext | undefined {
  if (options.cacheDir === undefined) {
    return undefined;
  }
  const limits = resolveFetchLimits(options.limits);
  return {
    cache: new DocumentCache(options.cacheDir),
    // Real network only when no test (or caller) supplies one — see
    // createNetworkTransport's own doc: never exercised by this suite.
    transport: options.transport ?? createNetworkTransport(limits.maxBytes),
    limits,
  };
}

export type ResolveResult = { readonly ok: true; readonly graph: Graph; readonly pedigree: Pedigree } | { readonly ok: false; readonly diagnostics: Diagnostic[] };

function requireSandboxRoot(options: ResolveOptions): void {
  if (options.sandboxRoot === undefined || options.sandboxRoot === null || options.sandboxRoot.length === 0) {
    throw new Error("resolve() requires 'sandboxRoot' (v0.2 FR-022) — there is no default and none is inferred from the entry document's location");
  }
}

/** A phantom, zero-width span at `documentLength: 0` — the same convention `checkSizeLimit` (v0.1) uses for "nothing was read/parsed at all yet". Used only when a document cannot even be read, so there is no real content to anchor a span inside. */
function phantomSpan(origin: Origin): ReturnType<typeof createSourceSpan> {
  return createSourceSpan({ origin, start: 0, end: 0, line: 1, column: 1, documentLength: 0 });
}

/** Parse `bytes` at `location` via whatever `src/adapters/registry.ts` selects for it — the one call in this file that crosses into `src/adapters/`. `undefined` format (an unrecognized extension) is folded into the same "cannot be used as a document" outcome as a read failure — see the milestone report: no diagnostic code in this milestone's catalogue distinguishes "wrong format" from "unreachable". */
function parseAtLocation(bytes: Uint8Array, location: string): ReturnType<typeof parseYamlBytes> {
  const origin = createOrigin(location, location);
  const format = formatForLocation(location);
  if (format === undefined || format !== "yaml") {
    return { ok: false, diagnostics: [createDiagnostic({ code: "document-unreachable", message: `No adapter recognizes the format of '${location}'`, primary: phantomSpan(origin) })] };
  }
  return parseYamlBytes(bytes, origin);
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
function cycleDiagnostic(chain: readonly { readonly location: string; readonly incoming?: GraphReference }[]): Diagnostic {
  const closing = chain[chain.length - 1];
  if (closing?.incoming === undefined) {
    throw new Error("Internal error: a cycle's closing frame has no incoming reference");
  }
  const related = chain
    .slice(1, -1)
    .map((frame, index) => (frame.incoming === undefined ? undefined : { label: `cycle position ${index + 1}`, span: frame.incoming.span }))
    .filter((entry): entry is { label: string; span: ReturnType<typeof createSourceSpan> } => entry !== undefined);
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
function multipleAdoptionDiagnostic(extraction: { readonly sequenceSpan: ReturnType<typeof createSourceSpan>; readonly entries: readonly GraphReference[] }): Diagnostic {
  const [first, second] = extraction.entries;
  if (second !== undefined) {
    return createDiagnostic({
      code: "multiple-adoption",
      message: "A sequence value is refused for '$adopts'/'$schema' — v1 adopts exactly one parent (SPEC.md §6.1, §9)",
      primary: second.span,
      related: first === undefined ? [] : [{ label: "first parent", span: first.span }],
    });
  }
  if (first !== undefined) {
    return createDiagnostic({
      code: "multiple-adoption",
      message: "A sequence value is refused for '$adopts'/'$schema', even with a single item — v1 adopts exactly one parent, written as a single string scalar (SPEC.md §6.1, §9)",
      primary: first.span,
      related: [],
    });
  }
  return createDiagnostic({
    code: "multiple-adoption",
    message: "A sequence value is refused for '$adopts'/'$schema' — v1 adopts exactly one parent, written as a single string scalar (SPEC.md §6.1, §9)",
    primary: extraction.sequenceSpan,
    related: [],
  });
}

type ChainWalkResult = { readonly ok: true; readonly documentsLeafToRoot: GraphDocument[] } | { readonly ok: false; readonly diagnostics: Diagnostic[] };

/** Bytes plus verification status, whatever their source (local read or remote fetch+cache+pin) — the one shape `walkAdoptsChain` needs past this point, so its parse/dedup/recurse logic below does not care which. */
type ReadOutcomeUnified = { readonly ok: true; readonly bytes: Uint8Array; readonly verified: boolean } | { readonly ok: false; readonly diagnostic: Diagnostic };

/**
 * contracts/diagnostics.md's fetching-and-integrity codes (T045, T048),
 * plus `document-not-cached` and v0.1's `size-limit-exceeded` reused for
 * an oversized remote body — every way `resolve/fetch.ts`'s
 * `resolveRemoteDocument` can refuse, translated into a `Diagnostic`
 * anchored to `candidate` (contracts/diagnostics.md: "a resolution code
 * MUST anchor to a reference, never to a fetched document alone").
 */
function remoteFailureDiagnostic(failure: RemoteDocumentFailure, candidate: Reference): Diagnostic {
  switch (failure.kind) {
    case "unsupported-scheme":
      return createDiagnostic({
        code: "unsupported-scheme",
        message: `Reference '${candidate.text}' redirected to an unsupported scheme '${failure.scheme}:' — only HTTPS is permitted (v0.2 FR-013)`,
        primary: candidate.span,
      });
    case "insecure-redirect":
      return createDiagnostic({
        code: "insecure-redirect",
        message: `Reference '${candidate.text}' redirected to a non-HTTPS location ('${failure.location}') — every redirect hop must satisfy v0.2 FR-013, and the insecure hop is refused before it is followed`,
        primary: candidate.span,
      });
    case "too-many-redirects":
      return createDiagnostic({
        code: "too-many-redirects",
        message: `Reference '${candidate.text}' exceeded the redirect hop limit (v0.2 FR-028)`,
        primary: candidate.span,
      });
    case "size-limit-exceeded":
      return createDiagnostic({
        code: "size-limit-exceeded",
        message: `Fetched document at '${candidate.text}' is at least ${failure.actualBytes} bytes, exceeding the size limit`,
        primary: candidate.span,
      });
    case "not-cached":
      return createDiagnostic({
        code: "document-not-cached",
        message: `Reference '${candidate.text}' is neither reachable nor already cached (v0.2 FR-018)`,
        primary: candidate.span,
      });
    case "pin-mismatch":
      return createDiagnostic({
        code: "pin-mismatch",
        message: `Fetched bytes for '${candidate.text}' do not match the stated $pin — expected sha256:${failure.expected}, got sha256:${failure.actual} (v0.2 FR-014)`,
        primary: candidate.span,
      });
    case "malformed-pin":
      return createDiagnostic({
        code: "malformed-pin",
        message: `'$pin' on the reference to '${candidate.text}' is not a well-formed 'sha256:<64 hex digits>' value (v0.2 FR-015)`,
        primary: candidate.span,
      });
  }
}

/**
 * Read `candidate`'s bytes, whichever kind of location it names —
 * dispatching to a local read or (via `remote`) a cache-aware HTTPS
 * fetch with `$pin` verification. `remote` is `undefined` exactly when
 * `ResolveOptions.cacheDir` was never supplied; reaching an `https`
 * target with no `remote` is a programmer error (see
 * `ResolveOptions.cacheDir`'s own doc), not a document-shaped refusal —
 * it throws, matching `sandboxRoot`'s and `origin`'s existing posture.
 */
async function readAtTarget(target: ReferenceLocationKind, candidate: Reference, remote: RemoteContext | undefined): Promise<ReadOutcomeUnified> {
  if (target.kind === "unsupported-scheme") {
    // Unreachable via walkAdoptsChain's own call site, which branches on
    // `target.kind` before ever calling this function — kept exhaustive
    // here defensively rather than asserted away.
    throw new Error(`Internal error: readAtTarget called with an unsupported-scheme target ('${target.scheme}:')`);
  }
  if (target.kind === "local") {
    const read = readLocalDocument(target.location);
    if (!read.ok) {
      return {
        ok: false,
        diagnostic: createDiagnostic({
          code: "document-unreachable",
          message: `Cannot read '${target.location}' (referenced as '${candidate.text}'): ${read.reason}`,
          primary: candidate.span,
        }),
      };
    }
    return { ok: true, bytes: read.bytes, verified: false };
  }
  if (remote === undefined) {
    throw new Error(
      `resolve() requires 'cacheDir' (v0.2 FR-016) to fetch the remote reference '${candidate.text}' — there is no default and none is inferred, the same "granted, never ambient" posture as 'sandboxRoot'`,
    );
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
async function walkAdoptsChain(candidate: Reference, referringLocation: string, builder: GraphBuilder, remote: RemoteContext | undefined, sandboxRoot: string): Promise<ChainWalkResult> {
  const target = classifyReferenceLocation(candidate, referringLocation);
  if (target.kind === "unsupported-scheme") {
    // Refused *before any request is made* (v0.2 FR-013) — this branch
    // never reaches resolve/fetch.ts at all.
    return {
      ok: false,
      diagnostics: [referenceDiagnostic("unsupported-scheme", candidate, `Reference '${candidate.text}' uses scheme '${target.scheme}:' — only HTTPS and local paths are supported (v0.2 FR-013)`)],
    };
  }
  if (target.kind === "local" && isSandboxEscape(candidate, target.location, sandboxRoot)) {
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

  const read = await readAtTarget(target, candidate, remote);
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
        createDiagnostic({
          code: "document-unreachable",
          message: `Document at '${location}' (referenced as '${candidate.text}') is not readable as a document`,
          primary: candidate.span,
          related: parsed.diagnostics.map((d) => ({ label: d.message, span: d.primary })),
        }),
      ],
    };
  }

  const identity = createDocumentIdentity(location, read.bytes);
  const document: GraphDocument = { identity, tree: freeze(parsed.tree), via: candidate, verified: read.verified };
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

  const adoptsExtraction: ExtractedReference = extractAdoptsReference(canonical.tree);

  if (adoptsExtraction.kind === "sequence") {
    builder.abandonVisit(location);
    return { ok: false, diagnostics: [multipleAdoptionDiagnostic(adoptsExtraction)] };
  }
  if (adoptsExtraction.kind === "none") {
    builder.finishVisit(location, canonical);
    return { ok: true, documentsLeafToRoot: [canonical] };
  }

  const parentResult = await walkAdoptsChain(adoptsExtraction.reference, location, builder, remote, sandboxRoot);
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
export async function resolve(entryPath: string, options: ResolveOptions): Promise<ResolveResult> {
  requireSandboxRoot(options);
  const remote = buildRemoteContext(options);
  const sandboxRoot = toAbsoluteSandboxRoot(options.sandboxRoot);
  const maxChainLength = options.maxChainLength ?? DEFAULT_MAX_CHAIN_LENGTH;

  const builder = new GraphBuilder(maxChainLength);
  const entryLocation = toAbsoluteEntryLocation(entryPath);
  const entryOrigin = createOrigin(entryLocation, entryLocation);

  const entryVisit = builder.beginVisit(entryLocation, undefined);
  if (entryVisit.kind !== "new") {
    throw new Error("Internal error: the entry document's first visit was not 'new'");
  }

  const entryRead = readLocalDocument(entryLocation);
  if (!entryRead.ok) {
    // No Reference exists to blame for the entry document itself — it is
    // the root of the whole resolution, reached by nothing. A phantom
    // zero-width span at its own (synthetic) origin is the closest fit
    // to contracts/diagnostics.md's "the reference" for every other code
    // in this catalogue; see the milestone report.
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
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
  const entryDocument: GraphDocument = { identity: entryIdentity, tree: freeze(entryParsed.tree), verified: false };
  // `entryLocation` stays on the active stack for the *entire* schema
  // chain below (finishVisit only after it returns) — the same
  // termination fix `walkAdoptsChain` needed applies here too: a schema
  // deep in the chain naming the entry document's own path back must
  // still be caught as a cycle.
  const canonicalEntry = builder.registerContent(entryLocation, entryDocument);

  const schemaExtraction: ExtractedReference = extractSchemaReference(canonicalEntry.tree);
  if (schemaExtraction.kind === "sequence") {
    // Not yet on the "aborting the whole call" path below — nothing has
    // recursed yet, so closing out the entry's own visit costs nothing
    // and keeps the builder's invariants honest even though this
    // instance is discarded either way.
    builder.abandonVisit(entryLocation);
    return { ok: false, diagnostics: [multipleAdoptionDiagnostic(schemaExtraction)] };
  }
  if (schemaExtraction.kind === "none") {
    // Legal: no $schema at all (spec.md's Edge Cases; T023) — a
    // single-document graph and an empty pedigree.
    builder.finishVisit(entryLocation, canonicalEntry);
    const graph = buildGraph(canonicalEntry, []);
    return { ok: true, graph, pedigree: buildPedigree(graph) };
  }

  const chainResult = await walkAdoptsChain(schemaExtraction.reference, entryLocation, builder, remote, sandboxRoot);
  if (!chainResult.ok) {
    // Aborting the whole call — no further use of `builder` follows, so
    // `entryLocation`'s frame is left on the (about to be discarded)
    // stack rather than explicitly closed out (same reasoning as
    // `walkAdoptsChain`'s own failure paths).
    return { ok: false, diagnostics: chainResult.diagnostics };
  }
  builder.finishVisit(entryLocation, canonicalEntry);

  const graph = buildGraph(canonicalEntry, chainResult.documentsLeafToRoot);
  return { ok: true, graph, pedigree: buildPedigree(graph) };
}

// --- merge() — User Story 1 (v0.3, tasks.md T024) ------------------------
//
// Fold a resolved graph and its pedigree into one configuration
// (contracts/merge-api.md: `merge(resolved) -> MergeResult`). Unlike
// `resolve()`, this crosses no boundary that needs an orchestrator: the
// fold itself lives entirely in `src/merge/`, which may see `graph/` but
// neither `adapters/` nor `resolve/` (`tests/unit/layering.test.ts`, T011)
// — merge is the first stage that is both format-blind *and*
// location-blind, so there is nothing here for this file to bridge.

/** What `merge()` takes: exactly the `ok: true` shape `resolve()` produces. */
export interface MergeInput {
  readonly graph: Graph;
  readonly pedigree: Pedigree;
}

export type MergeResult = { readonly ok: true; readonly configuration: MergedConfiguration } | { readonly ok: false; readonly diagnostics: Diagnostic[] };

/**
 * Fold `resolved.graph` and `resolved.pedigree` into a `MergedConfiguration`
 * — never both a configuration and diagnostics (contracts/merge-api.md
 * point 1). A schema's `provide` fills what the config leaves silent;
 * mappings merge deeply; everything else replaces
 * (contracts/precedence.md).
 *
 * **Scope, as of User Story 1 (Phase 3's checkpoint)**: this milestone's
 * merge policy validation (an unknown or non-string `cascade`, `append`
 * over a non-sequence, `merge-by-key`) is Phase 6 (User Story 4), not yet
 * implemented — so this function cannot yet produce the `ok: false` branch
 * contracts/merge-api.md describes; it always folds successfully. `why()`
 * (Phase 5, User Story 3) is not exported here either — see
 * `src/merge/provenance.ts`'s module doc.
 */
export function merge(resolved: MergeInput): MergeResult {
  const configuration = foldConfiguration(resolved.graph, resolved.pedigree);
  return { ok: true, configuration };
}
