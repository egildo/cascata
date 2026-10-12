/**
 * DAG assembly — data-model.md "Graph"; SPEC.md §3 ("Graph build:
 * Documents -> DAG"), §6.1; v0.2 FR-007, FR-008, FR-009; tasks.md
 * T029-T030 (dedup and cycle detection — `$adopts` multiplicity, T031's
 * original home, has since moved to src/resolve/reference.ts; see below).
 *
 * **Principle IV boundary (plan.md's Structure Decision)**: `src/graph/`
 * deals in already-parsed trees and never fetches, never touches a path,
 * and — the boundary `tests/unit/layering.test.ts` polices mechanically —
 * must not import `src/resolve/` or `src/adapters/`. This file therefore
 * declares its **own** structural types (`GraphReference`,
 * `GraphDocument`, …) rather than importing `Reference`/`ResolvedDocument`
 * from `src/resolve/`. They are shaped identically to their `resolve/`
 * counterparts by design: TypeScript's structural typing means the
 * orchestrator (`src/index.ts`, which *may* import both `resolve/` and
 * `graph/`) can pass a real `resolve/reference.ts` `Reference` or
 * `resolve/location.ts` `ResolvedDocument` straight into this module's
 * functions with no conversion step, because the field shapes match
 * exactly. See the milestone report for why this duplication (rather
 * than a shared type in `src/model/`) was the call made here.
 *
 * **The trap this file exists to avoid (CLAUDE.md, T030)**: cycle
 * detection that waits for a document's bytes/hash to exist never fires,
 * because the cycle is exactly what prevents those bytes from ever
 * arriving. `GraphBuilder.beginVisit` therefore operates on paths alone
 * (research D5) — it never sees a byte, a hash, or a parsed tree. The
 * orchestrator calls it *before* attempting to read anything at that
 * location.
 *
 * **Identity is physical (v1.13 FR-005, `SPEC.md` Article VI).** A
 * document is known by two paths: its *logical* location (the route
 * taken, which names it in every message) and its *physical* one (where it
 * really is). `beginVisit` is handed both and tells documents apart by
 * the physical, so a file reached under two spellings, through a link, or
 * (for a remote document) through a redirect is one document, and a
 * schema that adopts itself by any route is a cycle.
 *
 * **`$adopts` multiplicity no longer lives here.** An earlier version of
 * this file resolved every `$adopts` sequence-item's location and
 * refused `multiple-adoption` only when two *distinct* locations
 * resulted, reading a same-target sequence as legal (T021's "diamond").
 * `SPEC.md` §9 has since settled the question the other way: `$adopts`
 * and `$schema` are single string scalars, full stop, and *any* sequence
 * value is refused regardless of what its items resolve to. That check
 * is now a pure shape check on the parsed tree (`resolve/reference.ts`,
 * T032) needing no location resolution at all, so it moved there. A
 * genuine diamond — one node reached by two distinct edges — cannot
 * arise from `$schema`/`$adopts` in v1 at all (SPEC.md §6.1: adoption is
 * single-parent, so the pedigree is a chain). Content-hash dedup, which
 * this file once carried (research D5) for a diamond that cannot arise,
 * was removed in v1.13 (FR-006, revised): identity is the physical path
 * alone, and two documents with identical bytes are two documents — see
 * `tests/unit/graph-content-dedup.test.ts` and `specs/023-graph-identity`.
 */
import type { Node } from "../model/node.js";
import type { DocumentIdentity } from "../model/identity.js";
import type { Reference, ReferenceAuthority, ReferenceKind } from "../model/reference.js";
export type GraphReferenceKind = ReferenceKind;
export type GraphReferenceAuthority = ReferenceAuthority;
export type GraphReference = Reference;
export type GraphDocumentIdentity = DocumentIdentity;
/** One document in the graph: its identity, its parsed tree, and the reference that brought it in (absent only for the entry document). */
export interface GraphDocument {
    readonly identity: GraphDocumentIdentity;
    readonly tree: Node;
    readonly via?: GraphReference;
    readonly verified: boolean;
}
/**
 * Resolved documents and the reference edges between them (data-model.md
 * "Graph"). `documents[0]` is always the entry document; the rest follow
 * in **discovery order** (leaf-to-root along the `$adopts` chain — the
 * order the orchestrator reaches them in, config's `$schema` target
 * first, its ultimate ancestor last). `graph/pedigree.ts` reverses this
 * into root-to-leaf order, which is the pedigree's own contract, not the
 * graph's.
 *
 * Acyclic by construction: `GraphBuilder` refuses a cycle before a
 * document can be added at all (never a state this type can hold).
 */
export interface Graph {
    readonly entry: GraphDocument;
    readonly documents: readonly GraphDocument[];
    /**
     * v1.6 FR-011 — additive, optional: the embedder's overrides, in the
     * order given, which is their rank order after the entry. Absent means
     * none, so every graph built before this field existed — and every
     * hand-built one in the test suite — reads exactly as it did. Not in
     * `documents`, because `documents.slice(1)` is "the schema chain" at
     * every consumer, and an override is a layer of the fold, never a node
     * of the adoption graph: not deduplicated, not cycle-checked, not in
     * the pedigree.
     */
    readonly overrides?: readonly GraphDocument[];
}
/** One frame of the active resolution path — what `GraphBuilder` needs to name every reference in a cycle, in chain order (contracts/diagnostics.md's `reference-cycle`). */
export interface StackFrame {
    /** The logical location: the route taken to the document, which every message names. */
    readonly location: string;
    /** Where the document really is (v1.13 FR-005); equal to `location` when nothing differs. This is what identifies it. */
    readonly physical: string;
    /** The reference that discovered this location. Absent only for the entry document, which cannot itself be part of a cycle (nothing points back at an unreached root). */
    readonly incoming?: GraphReference;
}
export type VisitDecision = {
    readonly kind: "new";
} | {
    readonly kind: "duplicate";
    readonly document: GraphDocument;
} | {
    readonly kind: "cycle";
    readonly chain: readonly StackFrame[];
} | {
    readonly kind: "chain-limit-exceeded";
};
/** contracts/resolve-api.md's "Limits" table default for `maxChainLength` (v0.2 FR-010, T056/T063). */
export declare const DEFAULT_MAX_CHAIN_LENGTH = 32;
/**
 * Bookkeeping for one `resolve()` call's traversal. Holds no bytes, no
 * IO handle, and no adapter — it only ever sees `location` strings (for
 * cycle detection and pre-fetch dedup, research D5) and, once a document
 * has actually been read and parsed elsewhere, the resulting
 * `GraphDocument` (to memoize it).
 *
 * The orchestrator (`src/index.ts`) drives every state transition:
 * `beginVisit` before touching the filesystem, then — **while `location`
 * stays on the active path** — the recursion into that document's *own*
 * further references, and only after it returns, `finishVisit` to pop
 * it off. `abandonVisit` closes out a visit that failed before a
 * document could even be built.
 *
 * **Why the visit is closed only after the recursion, not as soon as the
 * bytes are read (a defect this implementation actually hit and is
 * recorded here rather than silently fixed)**: an earlier version of this class popped
 * `location` off the active stack as soon as its own bytes were read and
 * parsed, before the orchestrator recursed into *that document's own*
 * `$adopts`. That is exactly the T030 trap in a different costume: a
 * schema whose `$adopts` names itself was resolved as a `"duplicate"`
 * (already in `resolvedByLocation`) instead of a `"cycle"` (still on the
 * active stack), because the stack had already been popped by the time
 * the self-reference was checked. Caught by `tests/unit/cycle-detection.
 * test.ts` before this shipped — see the milestone report. `location`
 * must stay "active" for cycle-detection purposes for the entire
 * duration of resolving its own descendants, not merely for the
 * duration of reading its own bytes.
 */
export declare class GraphBuilder {
    /** Fully resolved documents by physical path (v1.13 FR-005). */
    private readonly resolvedByPhysical;
    /** The same by logical location: what answers a *remote* reference before its fetch has said where the document ended up (FR-016). */
    private readonly resolvedByLocation;
    /** The active path. A frame's `physical` is set once, except for a remote document's, which `learnPhysical` settles after its fetch. */
    private readonly stack;
    private readonly maxChainLength;
    /** `maxChainLength` (v0.2 FR-010) defaults to `DEFAULT_MAX_CHAIN_LENGTH`, matching contracts/resolve-api.md's documented default of 32. */
    constructor(maxChainLength?: number);
    /**
     * Decide what to do about `location` before any byte of it has been
     * read (T030). Four outcomes:
     *
     * - `"cycle"` — the document is already on the active path: refuse,
     *   naming every reference from where the cycle starts back to the one
     *   that just closed it, in chain order. "The same document" is the
     *   same **physical** path (v1.13 FR-005); the same logical location
     *   is the same document too, which only matters for a remote
     *   reference whose physical URL is not yet known (FR-016).
     * - `"duplicate"` — the document was already fully resolved (including
     *   its own descendants) earlier in this same traversal (FR-009):
     *   reuse that `GraphDocument`, read nothing, recurse into nothing.
     * - `"chain-limit-exceeded"` — `location` would be the
     *   `(maxChainLength + 1)`-th schema document in the pedigree (v0.2
     *   FR-010, T056/T063): refuse before reading it. The **entry**
     *   document's own `beginVisit` (`stack.length` is `0` at that point,
     *   always `< maxChainLength`) can never trip this — the limit bounds
     *   the *schema* chain (`stack.length - 1`, excluding the entry frame),
     *   matching data-model.md's "Pedigree" ("the ordered chain of schema
     *   identities... `$adopts` takes exactly one parent").
     * - `"new"` — genuinely unseen: the caller should read and parse it,
     *   recurse into its own references, and only then call `finishVisit` (or `abandonVisit` if the read/parse
     *   itself failed).
     */
    beginVisit(location: string, incoming: GraphReference | undefined, physical?: string): VisitDecision;
    /**
     * v1.13 FR-016: a **remote** visit's physical URL — where the fetch ended after redirects — is known only
     * after the fetch, so `beginVisit` started it under its logical URL. This settles it and judges it as
     * `beginVisit` judges a local document:
     *
     * - `"cycle"` — another document on the active path is at that URL: a schema that adopts itself through a
     *   redirect. The chain is the same shape a `"cycle"` from `beginVisit` carries, the current visit last.
     * - `"duplicate"` — a document already fully resolved is at that URL. The current visit is **closed** (its
     *   frame is popped) and `location` is remembered, so asking for it again is a pre-fetch duplicate.
     * - `"new"` — nothing else is there; the visit goes on under its physical URL.
     */
    learnPhysical(location: string, physical: string): VisitDecision;
    /**
     * Close out the visit `beginVisit` started at `location`, after
     * the document has been read and parsed, and after every reference it
     * itself makes has finished being resolved (successfully or not). Pops
     * the active stack and memoizes `document` so a later reference to the
     * same document is answered as `"duplicate"` rather than re-walked.
     *
     * **No content dedup (v1.13 FR-006, revised).** Identity is the
     * physical path alone; two documents with identical bytes are two
     * documents. Until v1.13 a content-hash match returned the earlier
     * document (`registerContent`), which on a legal chain whose copies
     * resolve their relative references from different places dropped a
     * real document, and when the earlier one was the entry (no `via`)
     * crashed `buildPedigree`. A chain is a single line, so a document can
     * only recur by a cycle, which the physical path already catches. The
     * hash stays on `DocumentIdentity` for `$pin`.
     */
    finishVisit(location: string, document: GraphDocument): void;
    /** Close out a visit that failed before a document could be built (e.g. the file could not be read) — pops the active path without memoizing anything at `location`, so it is not mistaken for a resolved duplicate later. */
    abandonVisit(location: string): void;
}
/** Assemble the final `Graph` from the entry document and every other document discovered, in discovery order (leaf-to-root along the chain). Pure — no IO, no cycle/dedup logic of its own (that is `GraphBuilder`'s job, already applied by the time the orchestrator calls this). */
export declare function buildGraph(entry: GraphDocument, restInDiscoveryOrder: readonly GraphDocument[], overrides?: readonly GraphDocument[]): Graph;
/** One branch's outcome, whatever `T` and `F` the caller resolves candidates into and fails with — deliberately generic (see `resolveAllBranches`'s own doc for why this file never names `Diagnostic`). */
export type BranchOutcome<T, F> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly failures: readonly F[];
};
/**
 * Resolve every candidate in `candidates` independently and collect
 * **every** failure, rather than stopping at the first (v0.2 FR-025,
 * contracts/resolve-api.md point 4: "Independent failures are all
 * reported from one attempt... as v0.1 does within a document"; tasks.md
 * T065).
 *
 * **Not reachable end-to-end from `resolve()` in this milestone — and,
 * unlike T021/T039's dedup machinery, not wired into the orchestrator's
 * production call sites at all.** `data-model.md`'s "Graph" entry is
 * explicit: with `$adopts`/`$schema` single string scalars (`SPEC.md`
 * §9), the pedigree "is a chain, never a tree... branching is a refusal
 * rather than a shape to handle." Concretely: at every point
 * `src/index.ts`'s `walkAdoptsChain` resolves a reference, there is
 * exactly one candidate — the current document's one outgoing edge — so
 * a resolve() call can never accumulate more than one reference-
 * resolution diagnostic from independent branches; each step's success
 * is a precondition for even discovering the next. Calling this function
 * with a length-1 array at that one call site would be real code but
 * inert theatre: it would never exercise the collect-vs-stop distinction
 * `T065`'s risk note names, because there is never a second candidate to
 * collect *from*. T021 and T039 record the identical structural finding
 * for dedup and remote-dedup and, for the same reason, test that
 * machinery directly against `GraphBuilder` rather than forcing it
 * through a `resolve()` fixture that cannot exercise it; this function
 * follows the same precedent, tested directly in
 * `tests/unit/resolve-collect-all.test.ts`. It is genuine, reusable
 * machinery for delegation (`SPEC.md` §8, v0.6), where a single document
 * can name several simultaneous `delegate` references — real independent
 * branches, which is exactly the shape this function exists to serve.
 *
 * Deliberately generic over `T`/`F` rather than hardcoding
 * `GraphDocument`/`Diagnostic`: every other function in this file is
 * diagnostic-agnostic (`VisitDecision` reports *kinds*, never messages),
 * and `src/graph/` has no reason to know `Diagnostic`'s shape any more
 * than it needs to know YAML's.
 */
export declare function resolveAllBranches<C, T, F>(candidates: readonly C[], resolveOne: (candidate: C) => Promise<BranchOutcome<T, F>>): Promise<BranchOutcome<readonly T[], F>>;
//# sourceMappingURL=build.d.ts.map