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

import type { Node } from "../model/node.js";
import type { SourceSpan } from "../model/span.js";
import type { DocumentIdentity } from "../model/identity.js";
import type { Reference, ReferenceAuthority, ReferenceKind } from "../model/reference.js";

// These were four structurally identical redeclarations until model/reference.ts and
// model/identity.ts gave both layers one source of truth. The aliases are kept so this
// module's existing callers need no churn; they name the same types, not copies of them.
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
}

/** One frame of the active resolution path — what `GraphBuilder` needs to name every reference in a cycle, in chain order (contracts/diagnostics.md's `reference-cycle`). */
interface StackFrame {
  readonly location: string;
  /** The reference that discovered this location. Absent only for the entry document, which cannot itself be part of a cycle (nothing points back at an unreached root). */
  readonly incoming?: GraphReference;
}

export type VisitDecision =
  | { readonly kind: "new" }
  | { readonly kind: "duplicate"; readonly document: GraphDocument }
  | { readonly kind: "cycle"; readonly chain: readonly StackFrame[] };

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
  private readonly resolvedByLocation = new Map<string, GraphDocument>();
  private readonly canonicalByHash = new Map<string, GraphDocument>();
  private readonly stack: StackFrame[] = [];

  /**
   * Decide what to do about `location` before any byte of it has been
   * read (T030). Three outcomes:
   *
   * - `"cycle"` — `location` is already on the active path: refuse,
   *   naming every reference from where the cycle starts back to the one
   *   that just closed it, in chain order.
   * - `"duplicate"` — `location` was already fully resolved (including
   *   its own descendants) earlier in this same traversal (FR-009):
   *   reuse that `GraphDocument`, read nothing, recurse into nothing.
   * - `"new"` — genuinely unseen: the caller should read and parse it,
   *   call `registerContent`, recurse into its own references, and only
   *   then call `finishVisit` (or `abandonVisit` if the read/parse
   *   itself failed).
   */
  beginVisit(location: string, incoming: GraphReference | undefined): VisitDecision {
    const cycleStart = this.stack.findIndex((frame) => frame.location === location);
    if (cycleStart !== -1) {
      return { kind: "cycle", chain: [...this.stack.slice(cycleStart), { location, incoming }] };
    }
    const existing = this.resolvedByLocation.get(location);
    if (existing !== undefined) {
      return { kind: "duplicate", document: existing };
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
  registerContent(location: string, document: GraphDocument): GraphDocument {
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
  finishVisit(location: string, canonical: GraphDocument): void {
    const top = this.stack[this.stack.length - 1];
    if (top === undefined || top.location !== location) {
      throw new Error(`Internal error: finishVisit(${location}) does not match the active visit (${top?.location ?? "<empty stack>"})`);
    }
    this.stack.pop();
    this.resolvedByLocation.set(location, canonical);
  }

  /** Close out a visit that failed before a document could be built (e.g. the file could not be read) — pops the active path without memoizing anything at `location`, so it is not mistaken for a resolved duplicate later. */
  abandonVisit(location: string): void {
    const top = this.stack[this.stack.length - 1];
    if (top === undefined || top.location !== location) {
      throw new Error(`Internal error: abandonVisit(${location}) does not match the active visit (${top?.location ?? "<empty stack>"})`);
    }
    this.stack.pop();
  }
}

/** Assemble the final `Graph` from the entry document and every other document discovered, in discovery order (leaf-to-root along the chain). Pure — no IO, no cycle/dedup logic of its own (that is `GraphBuilder`'s job, already applied by the time the orchestrator calls this). */
export function buildGraph(entry: GraphDocument, restInDiscoveryOrder: readonly GraphDocument[]): Graph {
  return { entry, documents: [entry, ...restInDiscoveryOrder] };
}

