/**
 * The ordered root-to-leaf pedigree — data-model.md "Pedigree"; SPEC.md
 * §6.1 ("Pedigree is a first-class, queryable ordered chain of schema
 * identities... from root to leaf"); v0.2 FR-011, FR-012; tasks.md T031.
 *
 * **Scope note, settled here because two clauses of spec.md disagree on
 * it (see the milestone report in full)**: FR-011 says the pedigree
 * lists "the schema identities" root to leaf, and data-model.md's own
 * "Pedigree" entry agrees ("the ordered chain of schema identities, root
 * to leaf") — neither mentions the config/entry document. SC-001 and
 * Acceptance Scenario 1's prose, read carelessly, could be taken to
 * include it ("all three documents are read and the pedigree lists
 * their identities"; "a config three schemas deep... a pedigree listing
 * all four identities"). This implementation follows the two precise,
 * structural statements (FR-011, data-model.md) over the loosely-worded
 * ones: **the pedigree never includes the entry/config document.** The
 * `Graph` does include it (as `graph.entry`) — that is where "all
 * documents were read" is actually asserted.
 */
import type { Graph, GraphDocumentIdentity, GraphReference } from "./build.js";
/** One entry in the pedigree: a schema's identity, the reference that adopted/named it, and whether that reference was hash-verified (FR-026). */
export interface PedigreeEntry {
    readonly identity: GraphDocumentIdentity;
    /** The reference that brought this schema into the chain. Never absent for a pedigree entry — only the entry/config document (never itself in the pedigree) can lack one. */
    readonly via: GraphReference;
    readonly verified: boolean;
    /**
     * **v0.7 additive field** (SPEC.md §6.3, v0.7 FR-020): whether *this*
     * schema declared itself `authority.finalAgainstForking: true`.
     * Recorded and queryable; consulted by nothing in v1 — `$extends` does
     * not exist yet (§6.2). Defaults `false` when no `authority:` section
     * declared it. Populated by `src/index.ts`'s `resolve()` from
     * `src/graph/authority.ts`'s own reading, index-aligned with this array
     * by construction (both walk the same root-to-leaf schema documents).
     */
    readonly finalAgainstForking: boolean;
}
/** Root-to-leaf order: index 0 is the ultimate ancestor with no further `$adopts`; the last entry is the schema the config names directly with `$schema`. A chain, never a tree (`$adopts` takes exactly one parent in v1 — SPEC.md §6.1) — this type is a plain array for exactly that reason, not a graph structure. */
export type Pedigree = readonly PedigreeEntry[];
/**
 * Derive the pedigree from an assembled `Graph`. Pure — no traversal
 * logic of its own; `graph.documents` already holds every schema
 * document in **discovery order** (`graph/build.ts`'s contract: entry
 * first, then leaf-to-root — the schema the config names directly is
 * discovered before its ancestors). Reversing everything after the entry
 * turns that into root-to-leaf.
 *
 * `finalAgainstForkingByLocation` (v0.7, SPEC.md §6.3) is an optional,
 * caller-supplied lookup from a schema document's own location to
 * whether it declared `authority.finalAgainstForking: true` — computed by
 * `src/graph/authority.ts`'s `checkPinningDemand`, which this function
 * deliberately stays independent of (it would otherwise need to carry
 * `Diagnostic`s, and `buildPedigree` has never had a diagnostics channel).
 * Absent entries (including every entry when the map itself is omitted)
 * default `false` — the same "declared nothing, so nothing is true"
 * reading every other per-key vocabulary in this codebase gives absence.
 */
export declare function buildPedigree(graph: Graph, finalAgainstForkingByLocation?: ReadonlyMap<string, boolean>): Pedigree;
//# sourceMappingURL=pedigree.d.ts.map