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
 * arriving. `GraphBuilder.beginVisit` therefore operates on `location`
 * strings alone (research D5) — it never sees a byte, a hash, or a
 * parsed tree. The orchestrator calls it *before* attempting to read
 * anything at that location.
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
 * single-parent, so the pedigree is a chain); `registerContent`'s
 * content-hash dedup above remains exactly as written because it is
 * real machinery for delegation and future multi-adoption (research D5,
 * corrected), just not something this milestone's `$schema`/`$adopts`
 * chain alone can exercise end-to-end — see `tests/unit/
 * graph-content-dedup.test.ts` and the milestone report.
 */
import { extend } from "../extend.js";
/** contracts/resolve-api.md's "Limits" table default for `maxChainLength` (v0.2 FR-010, T056/T063). */
export const DEFAULT_MAX_CHAIN_LENGTH = 32;
/**
 * Bookkeeping for one `resolve()` call's traversal. Holds no bytes, no
 * IO handle, and no adapter — it only ever sees `location` strings (for
 * cycle detection and pre-fetch dedup, research D5) and, once a document
 * has actually been read and parsed elsewhere, the resulting
 * `GraphDocument` (for post-read content-hash dedup, same decision).
 *
 * The orchestrator (`src/index.ts`) drives every state transition:
 * `beginVisit` before touching the filesystem, then `registerContent`
 * once the document has been read and parsed — **while `location` stays
 * on the active path** — then, only after recursing into that document's
 * *own* further references has itself returned, `finishVisit` to pop it
 * off. `abandonVisit` closes out a visit that failed before a document
 * could even be built.
 *
 * **Why `registerContent` and `finishVisit` are two separate calls, not
 * one (a defect this implementation actually hit and is recorded here
 * rather than silently fixed)**: an earlier version of this class popped
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
export class GraphBuilder {
    resolvedByLocation = new Map();
    canonicalByHash = new Map();
    stack = [];
    maxChainLength;
    /** `maxChainLength` (v0.2 FR-010) defaults to `DEFAULT_MAX_CHAIN_LENGTH`, matching contracts/resolve-api.md's documented default of 32. */
    constructor(maxChainLength = DEFAULT_MAX_CHAIN_LENGTH) {
        this.maxChainLength = maxChainLength;
    }
    /**
     * Decide what to do about `location` before any byte of it has been
     * read (T030). Four outcomes:
     *
     * - `"cycle"` — `location` is already on the active path: refuse,
     *   naming every reference from where the cycle starts back to the one
     *   that just closed it, in chain order.
     * - `"duplicate"` — `location` was already fully resolved (including
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
     *   call `registerContent`, recurse into its own references, and only
     *   then call `finishVisit` (or `abandonVisit` if the read/parse
     *   itself failed).
     */
    beginVisit(location, incoming) {
        const cycleStart = this.stack.findIndex((frame) => frame.location === location);
        if (cycleStart !== -1) {
            return { kind: "cycle", chain: [...this.stack.slice(cycleStart), { location, incoming }] };
        }
        const existing = this.resolvedByLocation.get(location);
        if (existing !== undefined) {
            return { kind: "duplicate", document: existing };
        }
        if (this.stack.length - 1 >= this.maxChainLength) {
            return { kind: "chain-limit-exceeded" };
        }
        this.stack.push({ location, incoming });
        return { kind: "new" };
    }
    /**
     * Record a successfully read-and-parsed document for the visit
     * `beginVisit` started at `location`. Does **not** pop the active
     * stack — `location` remains "active" (so a self-reference or a
     * further cycle through its own descendants is still caught) until
     * `finishVisit` is called, after the caller has finished recursing
     * into whatever this document itself references.
     *
     * Returns the **canonical** `GraphDocument` to use from here on: the
     * one just built, unless another location already produced
     * byte-identical content, in which case the earlier one wins
     * (content-hash dedup, research D5 — "two locations serving identical
     * bytes converge to one graph node"). When a different document is
     * canonical, the caller should still recurse into `document`'s own
     * references before calling `finishVisit` for *this* location — a
     * hash match does not exempt an already-active location from cycle
     * detection.
     */
    registerContent(location, document) {
        const top = this.stack[this.stack.length - 1];
        if (top === undefined || top.location !== location) {
            throw new Error(`Internal error: registerContent(${location}) does not match the active visit (${top?.location ?? "<empty stack>"})`);
        }
        return this.canonicalByHash.get(document.identity.hash) ?? (this.canonicalByHash.set(document.identity.hash, document), document);
    }
    /**
     * Close out the visit `beginVisit` started at `location`, after
     * `registerContent` and after every reference this document itself
     * makes has finished being resolved (successfully or not). Pops the
     * active stack and memoizes `canonical` so a later reference to the
     * same `location` is answered as `"duplicate"` rather than re-walked.
     */
    finishVisit(location, canonical) {
        const top = this.stack[this.stack.length - 1];
        if (top === undefined || top.location !== location) {
            throw new Error(`Internal error: finishVisit(${location}) does not match the active visit (${top?.location ?? "<empty stack>"})`);
        }
        this.stack.pop();
        this.resolvedByLocation.set(location, canonical);
    }
    /** Close out a visit that failed before a document could be built (e.g. the file could not be read) — pops the active path without memoizing anything at `location`, so it is not mistaken for a resolved duplicate later. */
    abandonVisit(location) {
        const top = this.stack[this.stack.length - 1];
        if (top === undefined || top.location !== location) {
            throw new Error(`Internal error: abandonVisit(${location}) does not match the active visit (${top?.location ?? "<empty stack>"})`);
        }
        this.stack.pop();
    }
}
/** Assemble the final `Graph` from the entry document and every other document discovered, in discovery order (leaf-to-root along the chain). Pure — no IO, no cycle/dedup logic of its own (that is `GraphBuilder`'s job, already applied by the time the orchestrator calls this). */
export function buildGraph(entry, restInDiscoveryOrder) {
    return { entry, documents: [entry, ...restInDiscoveryOrder] };
}
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
export async function resolveAllBranches(candidates, resolveOne) {
    const values = [];
    const failures = [];
    for (const candidate of candidates) {
        const outcome = await resolveOne(candidate);
        if (outcome.ok) {
            values.push(outcome.value);
        }
        else {
            extend(failures, outcome.failures);
        }
    }
    if (failures.length > 0) {
        return { ok: false, failures };
    }
    return { ok: true, value: values };
}
//# sourceMappingURL=build.js.map