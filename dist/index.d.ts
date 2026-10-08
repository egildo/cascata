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
import type { ParseLimits } from "./adapters/limits.js";
import { type Diagnostic } from "./diagnostics/diagnostic.js";
import type { Node } from "./model/node.js";
import { type Origin } from "./model/span.js";
import { type AccumulatedTree } from "./generate/index.js";
import { type PathFacility } from "./paths.js";
import { type FetchLimits } from "./resolve/fetch.js";
import type { Transport } from "./resolve/transport.js";
import type { Host } from "./resolve/host.js";
import { type Graph } from "./graph/build.js";
import { type Pedigree } from "./graph/pedigree.js";
import { why as whyImpl } from "./merge/provenance.js";
import type { MergedConfiguration } from "./merge/provenance.js";
import { resource as resourceImpl } from "./validate/resource.js";
import { project as projectImpl } from "./project/value.js";
import type { DelegationHop } from "./model/reference.js";
export type { Diagnostic, RelatedSpan } from "./diagnostics/diagnostic.js";
export type { DiagnosticCode } from "./diagnostics/codes.js";
export { nodesEqual } from "./model/equality.js";
export type { Mapping, Node, Scalar, ScalarKind, ScalarValueOf, Sequence } from "./model/node.js";
export { createOrigin, createSourceSpan } from "./model/span.js";
export type { Origin, SourceSpan } from "./model/span.js";
export type { ParseLimits } from "./adapters/limits.js";
export type { Reference, ReferenceAuthority, ReferenceKind } from "./resolve/reference.js";
export type { Graph, GraphDocument, GraphDocumentIdentity, GraphReference } from "./graph/build.js";
export type { Pedigree, PedigreeEntry } from "./graph/pedigree.js";
export type { FetchLimits } from "./resolve/fetch.js";
export type { Recording, RecordedFailure, RecordedFailureKind, RecordedResponse, RecordingOutcome, Transport } from "./resolve/transport.js";
/**
 * The host seam (SPEC.md Article VI, §16), exported at v1.2 as a
 * **correction** (§15). Both types have existed since v0.7 and `Host`
 * already appears in `LoadOptions`, but neither name was reachable from
 * the package: a consumer writing the host Article VI obliges them to
 * write could not say what they were implementing. Measured against the
 * published surface with `deno check`, which reported
 * "declares 'Host' locally, but it is not exported". Nothing about either
 * type changed; only its reachability.
 */
export type { Host, HostReadResult } from "./resolve/host.js";
export type { Layer, MergeStrategy, MergedConfiguration, ProvenanceEntry, ProvenanceRecord, WhyEntry, WhyResult } from "./merge/provenance.js";
export { locate, setValue } from "./adapters/edit.js";
export type { Edit, EditFormat, EditOptions, EditValue, LocatedKind, LocateResult, SetValueResult, SharedEdits } from "./adapters/edit.js";
export { editTarget } from "./edit-target.js";
export type { EditTargetOptions, EditTargetResult } from "./edit-target.js";
/** The result of one `parse()`/`parseText()` call. Never both a tree and diagnostics. */
export type ParseResult = {
    readonly ok: true;
    readonly tree: Node;
} | {
    readonly ok: false;
    readonly diagnostics: Diagnostic[];
};
export interface ParseOptions {
    /** Which document this text/these bytes came from. Required — see the module doc. */
    readonly origin: Origin;
    /** `maxDepth`/`maxBytes` overrides (contracts/parse-api.md's "Limits"). Absent fields use the adapter's defaults. */
    readonly limits?: Partial<ParseLimits>;
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
export declare function parse(bytes: Uint8Array, options: ParseOptions): ParseResult;
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
export declare function parseText(text: string, options: ParseOptions): ParseResult;
export interface ResolveOptions {
    /**
     * Required — no default, none inferred from the entry document's
     * location (v0.2 FR-022). **Enforced** as of User Story 4: a
     * schema-authored local reference resolving outside this root — judged
     * on the real, symlink-resolved path (`src/resolve/location.ts`'s
     * `isSandboxEscape`, FR-021, research D6) — is refused as
     * `sandbox-escape`. A config-authored reference is exempt (FR-020).
     *
     * **v1.7 FR-004, an addition: a location, or a list of them.** A bare
     * string is the one-element list, and a location is inside the sandbox
     * when it is inside **any** granted root — so every door shut to a
     * caller granting one root stays shut. It exists for the document that
     * is lawfully outside every project because it is shared by all of
     * them: a house schema under the user's home directory, which a venue
     * schema names and which no single project directory can contain.
     *
     * The posture does not move: **granted, never ambient** (v0.2 FR-022,
     * v1.7 FR-005). No root is inferred, none is read from a document,
     * nothing a document says can add one, and a refusal tells a document
     * nothing but that it was refused. `undefined`, `null`, `""`, `[]`, and
     * a list with a member that is not a non-empty string all throw — a
     * programmer error, not a fact about the world. Delegation (§8.4) is
     * confined by this same set; there is one sandbox, not one per
     * mechanism (v1.7 FR-006).
     */
    readonly sandboxRoot: string | readonly string[];
    /**
     * The maximum number of **schema** documents (the pedigree, not
     * counting the entry/config document) a chain may contain before being
     * refused as `chain-limit-exceeded` (v0.2 FR-010). Defaults to
     * `graph/build.ts`'s `DEFAULT_MAX_CHAIN_LENGTH` (32), matching
     * contracts/resolve-api.md's documented default.
     */
    readonly maxChainLength?: number;
    /**
     * The library's **only** route to local bytes, canonical identity, and
     * cache storage (v0.7, SPEC.md Article VI, FR-022, FR-028). **Required
     * — no default, none inferred.** A caller wanting the ordinary local
     * filesystem passes `createNodeHost()` (`@egildo/cascata/host/node.js`); a test
     * passes an in-memory double. Missing or malformed throws, the same
     * "granted, never ambient" posture `sandboxRoot` has always had.
     *
     * **Where `cacheDir` went**: v0.2–v0.6 had a `cacheDir?: string` field
     * here. As of v0.7 the on-disk cache's *storage* moved behind the host
     * (FR-025) — `createNodeHost({ cacheDir })` is where that setting now
     * lives; `resolve()`/`load()` no longer know what "a directory" means
     * at all.
     */
    readonly host: Host;
    /**
     * Injection point for the HTTP transport (research D7). **No default as
     * of v0.7**: the library itself may not call `fetch` (Article VI), so
     * it cannot silently construct a real-network transport the way v0.2–
     * v0.6 did. Omitting this means "no remote resolution is possible" — a
     * remote reference reached with it `undefined` throws, the same
     * "required exactly when needed" posture `cacheDir` used to have. An
     * embedder wanting the real network passes `createNodeTransport()`
     * (`@egildo/cascata/host/node.js`) explicitly; a test always supplies a
     * `RecordedTransport` (constitution, Technology & Security Constraints
     * — no test in this codebase ever omits this field, and now no
     * production caller gets it for free either).
     */
    readonly transport?: Transport;
    /** Overrides for `resolve/fetch.ts`'s `FetchLimits` (`maxRedirects`, `requestTimeoutMs`, `maxBytes`). `maxChainLength` is a top-level field on this interface, not part of `FetchLimits` — it bounds the schema chain (`src/graph/build.ts`), not any one HTTP fetch. */
    readonly limits?: Partial<FetchLimits>;
    /**
     * The **caller's** own opt-in to remote delegation targets (v0.6
     * FR-024) — distinct from remote *schema* fetching, which supplying a
     * `transport` alone already permits (research.md's Assumptions: a
     * caller who permits remote schemas has not thereby permitted remote
     * fragments). Never expressible by any document, only by the caller.
     * Defaults to `false`.
     */
    readonly allowRemoteDelegation?: boolean;
    /**
     * **v1.3 FR-001 — the launching schema.** Consulted only when the entry
     * document names no `$schema` of its own; an authored `$schema` always
     * wins (FR-002). Read exactly as if the entry had written
     * `$schema: <schema>`: a relative text resolves against the entry
     * document's directory, a leading `~/` expands, an `https://` text is
     * fetched through `transport`, and the reference counts as
     * **config-authored** — the embedder supplying it is the same consent
     * §8.1 reads into a config's own reference — so it is exempt from the
     * sandbox (FR-003). A launching schema that cannot be read is a
     * `document-unreachable` anchored at the entry document, never a throw
     * (FR-004). Ignored by `generateTypes()`, whose entry is a schema and
     * whose "no `$adopts`" case is simply the root of the chain. Omitted,
     * an entry with no `$schema` is what it has always been: a
     * single-document graph with an empty pedigree (v0.2 FR-011).
     *
     * Exists for an embedder whose documents are not written by Cascata's
     * authors at all — a Markdown file's frontmatter, which may well name
     * nothing — and whose tool knows which schema governs such a document.
     * The alternative was rewriting the entry's bytes to insert a line,
     * which breaks every span the embedder relies on for diagnostics.
     */
    readonly schema?: string;
    /**
     * **v1.6 FR-001 — overrides.** Config documents the embedder names,
     * read after the entry's chain and ranked after the entry in this
     * order, so the last outranks everything. Each text is read as a
     * **config-authored** reference anchored at a phantom span in the
     * entry document — the launching schema's own posture: relative to
     * the entry's directory, `~/` expanded, a scheme offered to `locate`,
     * `https://` through `transport`, and exempt from the sandbox because
     * the embedder chose it. Every rule of the cascade then applies to it
     * as to the entry: a demand, a `final`, a seal refuses its value at its
     * own span (FR-003), `append` accumulates it (FR-004), delegation
     * grafts into it (FR-009), and `why()` names it (FR-006). It carries
     * no `$`-key (`override-reserved-key`, FR-005): the pedigree is the
     * entry's and an override starts none. Never registered with the graph
     * builder — an override is a layer, not a node of the adoption graph,
     * so two with identical bytes are two layers (FR-010). Ignored by
     * `generateTypes()`. Absent or empty, v1.5 exactly.
     *
     * Exists for the embedder whose operator sets a key from a command
     * line — `--set title=Draft`, `-c ci.yaml` — and whose venue's
     * contract must bind those values like any others. Merging them over
     * the projected value after `load()` returned is what this replaces:
     * that merge saw no demand, no `final`, and left `why()` naming the
     * document that lost.
     */
    readonly overrides?: readonly string[];
}
export type ResolveResult = {
    readonly ok: true;
    readonly graph: Graph;
    readonly pedigree: Pedigree;
    readonly delegationBreadcrumbs: ReadonlyMap<string, readonly DelegationHop[]>;
    /**
     * v1.5 additive field (issue #1): the path facility this resolution
     * used — the host's, or `posixPaths` where the host supplied none.
     * Carried so that `merge()` can stamp it onto the configuration and
     * `resource()` can resolve a `path` value with the same semantics
     * the resolution itself used. A caller passing `resolved` through to
     * `merge()` in full gets it threaded automatically, exactly as v0.6's
     * `delegationBreadcrumbs` is.
     */
    readonly paths: PathFacility;
    /** v0.7 FR-002: `info`-level lints found during resolution (e.g. §8.1's delegate-leaf-shape lint). Never `error`-level — an `error` anywhere makes the whole call `ok: false` instead. Possibly empty. */
    readonly diagnostics: readonly Diagnostic[];
} | {
    readonly ok: false;
    readonly diagnostics: Diagnostic[];
};
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
/** Same hazard class as v0.1's parse depth and v0.5's `MAX_DEMAND_DEPTH` — a resource limit against a hostile fragment chain, not an unbounded promise (v0.6 FR-012a, research.md D5). Verified reachable through the real pipeline (unlike v0.5's own depth guard): each hop needs a distinct real file, never bounded by any single parse call's own depth cap. */
export declare const MAX_DELEGATION_DEPTH = 64;
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
export declare class DelegationCycleTracker {
    private readonly stack;
    private readonly maxDepth;
    constructor(maxDepth: number);
    enter(location: string): "ok" | "cycle" | "depth-limit-exceeded";
    exit(): void;
    chain(): readonly string[];
}
/**
 * Resolve a configuration's whole pedigree from its launching point
 * (contracts/resolve-api.md), unchanged from v0.2 in behaviour and in
 * signature: the entry is the configuration, its `$schema` starts the
 * chain, and delegation grafts.
 */
export declare function resolve(entryPath: string, options: ResolveOptions): Promise<ResolveResult>;
/** What `merge()` takes: exactly the `ok: true` shape `resolve()` produces. */
export interface MergeInput {
    readonly graph: Graph;
    readonly pedigree: Pedigree;
    /**
     * v0.6 additive field — every existing call site (`merge({graph,
     * pedigree})`, dropping this field explicitly, is unchanged and still
     * compiles) gets an empty map, exactly as if delegation had never
     * touched this configuration. `resolve()`'s own `ok: true` result
     * already carries the real map when delegation occurred; a caller
     * passing `resolved` through in full (rather than picking two fields
     * out of it) gets it threaded automatically.
     */
    readonly delegationBreadcrumbs?: ReadonlyMap<string, readonly DelegationHop[]>;
    /**
     * v1.5 additive field (issue #1), on the same terms as the one above:
     * the path facility the resolution used, stamped onto the merged
     * configuration so `resource()` resolves a `path` value the way the
     * resolution did. Omitted → `posixPaths`. A caller passing `resolved`
     * through in full gets the host's own facility threaded automatically.
     */
    readonly paths?: PathFacility;
}
/**
 * `merge()`'s verdict — `src/merge/fold.ts`'s `FoldOutcome`, restated here
 * as the public name `contracts/merge-api.md` gives it.
 *
 * **v1.8 additive field**: the `ok: true` branch carries `diagnostics`,
 * the fold's own `info` lints (today: `append-scalar-wrapped`). Always
 * `info`-only, possibly empty; an `error` anywhere still makes the call
 * `ok: false` with no configuration, exactly as before. `load()`
 * concatenates them into its own list, on the failure path as well as the
 * success one (v1.8 FR-006).
 */
export type MergeResult = {
    readonly ok: true;
    readonly configuration: MergedConfiguration;
    readonly diagnostics: readonly Diagnostic[];
} | {
    readonly ok: false;
    readonly diagnostics: Diagnostic[];
};
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
export declare function merge(resolved: MergeInput): MergeResult;
/**
 * Answer where a merged value came from — `merge-api.md`'s three
 * outcomes: an ordered `chain`, `synthesized` for a container no single
 * layer wrote, or `unknown-pointer` for a pointer that names nothing in
 * `configuration.tree`. A library function, not a command (research D3) —
 * `SPEC.md` §10 writes `tool why`, but no CLI ships in this milestone.
 */
export declare const why: typeof whyImpl;
export type { ResolvedResource } from "./validate/resource.js";
/**
 * Where a `path`/`url` value at `pointer` denotes, resolved against the
 * directory of the document that **declared** it (FR-035 through
 * FR-039) — never the entry document's, never confined to the sandbox
 * root (§8.1's razor from the other side, FR-038), and purely lexical
 * (nothing is read, existence is never checked, FR-039). A query, not a
 * check: it produces no diagnostic and cannot fail a `load()` call.
 */
export declare const resource: typeof resourceImpl;
export type { ConfigValue, ProjectionResult } from "./project/value.js";
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
export declare const project: typeof projectImpl;
export type ValidateResult = {
    readonly ok: true;
    readonly certified: MergedConfiguration;
    readonly diagnostics: readonly Diagnostic[];
} | {
    readonly ok: false;
    readonly diagnostics: Diagnostic[];
};
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
export declare function validate(configuration: MergedConfiguration): ValidateResult;
/**
 * `resolve()`'s options are exactly what `load()` needs — `merge()` takes
 * only `resolve()`'s own output, and `validate()` takes only `merge()`'s;
 * neither stage has an option of its own. Named separately from
 * `ResolveOptions` anyway, matching contracts/host-api.md and this
 * milestone's own vocabulary, so a future option belonging to a *later*
 * stage does not retroactively rename what `resolve()` itself accepts.
 */
export type LoadOptions = ResolveOptions;
/**
 * §16's "one call": a validated configuration with any `info` lints, or a
 * set of `error`s — **never** a configuration together with errors
 * (v0.7 FR-032). `ok: true`'s `diagnostics` is the union of every `info`
 * lint any stage produced, in the order the staged calls would produce
 * them — `resolve()`'s own (§8.1's delegate-leaf-shape lint), then
 * `validate()`'s own (§5.5's `required-vacuous`), then, from v1.0,
 * `project()`'s own (§17's `precision-narrowed`). `merge()` produces no
 * diagnostic of any level in this vocabulary, so nothing from it is
 * threaded in, not even an empty gap in the ordering.
 *
 * **v1.0**: `ok: true` also carries `value`, the value view (Article VII).
 * `T` defaults to `unknown` — the honest default, since nothing is known
 * about an arbitrary schema — and is never checked. Every pre-v1.0 call
 * site is unchanged: it infers `unknown`, and every reference to the bare
 * type name `LoadResult` still resolves.
 */
export type LoadResult<T = unknown> = {
    readonly ok: true;
    /** The node tree, spans, provenance and pedigree — unchanged, and still where `why()` reads them. Article VII: "the value view is a projection, never a replacement". */
    readonly configuration: MergedConfiguration;
    /**
     * **v1.0** — the value view (Article VII): the configuration as
     * ordinary JS data. `T` is the **caller's claim** and the library
     * performs no check of it whatsoever; validation enforces the schema
     * against the value and cannot enforce a belief about what the schema
     * says. Deriving `T` from the schema chain is the generator's job
     * (§14, §18), and from v1.1 `generateTypes()` does it — but `load()`
     * still checks nothing, so a `T` the generator wrote is, here, a
     * claim like any other.
     */
    readonly value: T;
    readonly diagnostics: readonly Diagnostic[];
} | {
    readonly ok: false;
    readonly diagnostics: Diagnostic[];
};
/**
 * The ordinary embedding (§16): `resolve()` → `merge()` → `validate()` in
 * sequence, composed — **not** a second implementation of the pipeline
 * (FR-033). Throws exactly where the staged calls would (a missing/
 * malformed `host` or `sandboxRoot`); returns diagnostics, never throws,
 * for every fact about the world (an unreachable document, a cycle, a
 * merge refusal, a constraint violation). The staged functions (`parse`,
 * `resolve`, `merge`, `validate`, `why`) remain public (FR-034) — this
 * function is the ordinary path, not the only one.
 */
/** What `metaValidate` needs: a host, and two locations it reads through that host. */
export interface MetaValidateOptions {
    /** The seam. Both documents are read through it and no other way (FR-019). */
    readonly host: Host;
    /** Location of the document under test — a schema, judged as a config. */
    readonly subject: string;
    /** Location of the meta-schema. `@egildo/cascata/host/node`'s `nodeMetaSchemaLocation()` is where the shipped one lives; a caller with its own storage passes its own location, which is the point of the seam. */
    readonly metaSchema: string;
}
/** A verdict, with any `info` lints alongside a successful one — `LoadResult`'s own contract (§10, v0.7 FR-002). */
export type MetaValidateResult = {
    readonly ok: true;
    readonly diagnostics: readonly Diagnostic[];
} | {
    readonly ok: false;
    readonly diagnostics: readonly Diagnostic[];
};
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
export declare function metaValidate(options: MetaValidateOptions): Promise<MetaValidateResult>;
export { accumulate, generate } from "./generate/index.js";
export type { AccumulateOptions, AccumulateResult, AccumulatedConstraint, AccumulatedDeclaration, AccumulatedIntersection, AccumulatedKey, AccumulatedPosition, AccumulatedTree, AccumulatedType, DemandSource, GenerateResult, } from "./generate/index.js";
/** `resolve()`'s options plus the one the generator adds: the root alias's name (FR-031). */
export interface GenerateTypesOptions extends ResolveOptions {
    readonly rootName?: string;
}
/**
 * `ok: true` carries the **tree** beside the source, the way `load()`
 * carries the configuration beside the value: a projection, never a
 * replacement. A caller wanting a second emitter has the artifact both are
 * translations of.
 */
export type GenerateTypesResult = {
    readonly ok: true;
    readonly source: string;
    readonly tree: AccumulatedTree;
    readonly diagnostics: readonly Diagnostic[];
} | {
    readonly ok: false;
    readonly diagnostics: readonly Diagnostic[];
};
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
export declare function generateTypes(schemaLocation: string, options: GenerateTypesOptions): Promise<GenerateTypesResult>;
export declare function load<T = unknown>(entryPath: string, options: LoadOptions): Promise<LoadResult<T>>;
//# sourceMappingURL=index.d.ts.map