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
import { extractAdoptsReferences, extractSchemaReference, type Reference } from "./resolve/reference.js";
import { createResolvedDocument, readLocalDocument, resolveReferenceLocation, toAbsoluteEntryLocation } from "./resolve/location.js";
import { createDocumentIdentity } from "./resolve/identity.js";
import {
  buildGraph,
  GraphBuilder,
  resolveAdoptsCandidates,
  type AdoptsCandidate,
  type Graph,
  type GraphDocument,
  type GraphReference,
} from "./graph/build.js";
import { buildPedigree, type Pedigree } from "./graph/pedigree.js";

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
// **Scope of this slice (User Story 2 only, Phase 4's checkpoint)**:
// local files only. `ResolveOptions` deliberately omits `cacheDir`,
// `transport`, and `limits` from contracts/resolve-api.md's full shape —
// none of them has anything to consume yet (fetching, caching, and
// chain-length enforcement are User Story 3/4, out of scope here per the
// milestone assignment) and accepting an option with zero effect would
// be dishonest scaffolding. See the milestone report for the complete
// list of what contracts/resolve-api.md describes that this slice does
// not implement.

export interface ResolveOptions {
  /**
   * Required — no default, none inferred from the entry document's
   * location (v0.2 FR-022). Not yet **enforced** in this slice (the
   * sandbox-escape check is User Story 4's `src/resolve/location.ts`
   * work, T056-T057) — only required and validated for presence, the
   * same partial-implementation posture `parse()`'s `origin` has always
   * had for a different field. See the milestone report.
   */
  readonly sandboxRoot: string;
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

/** contracts/diagnostics.md's `reference-cycle`: primary is the reference that just closed the loop; `related` names every other reference in the loop, in chain order, labelled by position. Full precision here (exact labelling conventions) is User Story 4's conformance obligation (T048) — this slice implements the mechanism termination depends on (T029) and a reasonable rendering of it, not a polished one. See the milestone report. */
function cycleDiagnostic(chain: readonly { readonly location: string; readonly incoming?: GraphReference }[]): Diagnostic {
  const closing = chain[chain.length - 1];
  if (closing?.incoming === undefined) {
    throw new Error("Internal error: a cycle's closing frame has no incoming reference");
  }
  const related = chain
    .slice(0, -1)
    .map((frame, index) => (frame.incoming === undefined ? undefined : { label: `cycle position ${index + 1}`, span: frame.incoming.span }))
    .filter((entry): entry is { label: string; span: ReturnType<typeof createSourceSpan> } => entry !== undefined);
  return createDiagnostic({
    code: "reference-cycle",
    message: `Reference '${closing.incoming.text}' closes a cycle back to an already-visited document`,
    primary: closing.incoming.span,
    related,
  });
}

type ChainWalkResult = { readonly ok: true; readonly documentsLeafToRoot: GraphDocument[] } | { readonly ok: false; readonly diagnostics: Diagnostic[] };

/**
 * Walk one `$adopts` step: resolve `candidate`'s location against
 * `referringLocation` (T026 — never against the entry or the working
 * directory), check it against the builder **before** reading anything
 * (T029), read and parse it if genuinely new, then recurse into its own
 * `$adopts`. Returns every schema document from `candidate` down to the
 * chain's root, in discovery (leaf-to-root) order — `graph/build.ts` and
 * `graph/pedigree.ts`'s shared contract for that order.
 */
async function walkAdoptsChain(candidate: Reference, referringLocation: string, builder: GraphBuilder): Promise<ChainWalkResult> {
  const location = resolveReferenceLocation(candidate.text, referringLocation);
  const decision = builder.beginVisit(location, candidate);

  if (decision.kind === "cycle") {
    return { ok: false, diagnostics: [cycleDiagnostic(decision.chain)] };
  }
  if (decision.kind === "duplicate") {
    // Already fully resolved (and its own $adopts chain already walked)
    // earlier in this same traversal — FR-009. Nothing further to do.
    return { ok: true, documentsLeafToRoot: [decision.document] };
  }

  const read = readLocalDocument(location);
  if (!read.ok) {
    builder.abandonVisit(location);
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          code: "document-unreachable",
          message: `Cannot read '${location}' (referenced as '${candidate.text}'): ${read.reason}`,
          primary: candidate.span,
        }),
      ],
    };
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

  const resolvedDoc = createResolvedDocument(location, read.bytes, candidate);
  const document: GraphDocument = { identity: resolvedDoc.identity, tree: freeze(parsed.tree), via: candidate, verified: resolvedDoc.verified };
  // `location` stays on the active stack past this point (T029's fix —
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

  const adoptsCandidates = extractAdoptsReferences(canonical.tree);
  const withLocations: AdoptsCandidate[] = adoptsCandidates.map((reference) => ({
    reference,
    location: resolveReferenceLocation(reference.text, location),
  }));
  const resolution = resolveAdoptsCandidates(withLocations);

  if (resolution.kind === "multiple-adoption") {
    builder.abandonVisit(location);
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          code: "multiple-adoption",
          message: `Schema at '${location}' declares more than one '$adopts' parent`,
          primary: resolution.second.span,
          related: [{ label: "first parent", span: resolution.first.span }],
        }),
      ],
    };
  }
  if (resolution.kind === "none") {
    builder.finishVisit(location, canonical);
    return { ok: true, documentsLeafToRoot: [canonical] };
  }

  // Find the original Reference (not the structurally-equal GraphReference
  // copy) so recursion keeps working in resolve/reference.ts's own type.
  const parentReference = adoptsCandidates.find((reference) => reference === resolution.reference);
  if (parentReference === undefined) {
    throw new Error("Internal error: resolveAdoptsCandidates returned a reference not among its own candidates");
  }
  const parentResult = await walkAdoptsChain(parentReference, location, builder);
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
 * root-to-leaf pedigree — local files only in this slice (User Story 2;
 * User Story 3 adds HTTPS fetching to the same traversal without
 * changing this function's shape). Never throws for bad *documents*
 * (contracts/resolve-api.md point 1) — a missing sandbox root is the one
 * programmer error that still throws, matching `parse()`'s `origin`.
 */
export async function resolve(entryPath: string, options: ResolveOptions): Promise<ResolveResult> {
  requireSandboxRoot(options);

  const builder = new GraphBuilder();
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

  const schemaReference = extractSchemaReference(canonicalEntry.tree);
  if (schemaReference === undefined) {
    // Legal: no $schema at all (spec.md's Edge Cases; T023) — a
    // single-document graph and an empty pedigree.
    builder.finishVisit(entryLocation, canonicalEntry);
    const graph = buildGraph(canonicalEntry, []);
    return { ok: true, graph, pedigree: buildPedigree(graph) };
  }

  const chainResult = await walkAdoptsChain(schemaReference, entryLocation, builder);
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
