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
export function buildPedigree(graph, finalAgainstForkingByLocation = new Map()) {
    const schemaDocuments = graph.documents.slice(1);
    const rootToLeaf = [...schemaDocuments].reverse();
    return rootToLeaf.map((document) => {
        if (document.via === undefined) {
            // Unreachable given graph/build.ts's contract: every document
            // after `graph.documents[0]` (the entry) was added via
            // `GraphBuilder.completeVisit`, which the orchestrator only calls
            // with a document built from a `Reference` that discovered it.
            throw new Error(`Internal error: pedigree document at '${document.identity.location}' has no 'via' reference`);
        }
        return { identity: document.identity, via: document.via, verified: document.verified, finalAgainstForking: finalAgainstForkingByLocation.get(document.identity.location) ?? false };
    });
}
//# sourceMappingURL=pedigree.js.map