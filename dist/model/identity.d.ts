/**
 * What makes two fetches the same document — `SPEC.md` §6.1;
 * data-model.md "Document Identity".
 *
 * Here rather than in `src/resolve/` for the reason given in
 * `reference.ts`: `graph/` needs the shape and may not import `resolve/`.
 * Computing a hash is `resolve/identity.ts`'s job; this module is the
 * shape alone and pulls in no crypto.
 */
/**
 * Location plus content hash.
 *
 * Two documents are the same when their **hashes** match, whatever their locations. Dedup *before*
 * reading uses `location` alone, because `hash` does not exist yet — research D5 splits the two
 * deliberately, and cycle detection depends on the location half being answerable first.
 *
 * The hash is over the document's **exact bytes**, not a canonical form (`SPEC.md` §6.1, amended:
 * RFC 8785/JCS cannot represent this model's exact integers or its int/float distinction, and would
 * collide on values the model holds unequal).
 */
export interface DocumentIdentity {
    /** The absolute resolved location — the **logical** path (v1.13): the route taken, no link followed; or a normalized URL as written. */
    readonly location: string;
    /**
     * Where the document really is (v1.13 FR-004): the host's canonical path for a file, the URL after
     * redirects for a remote document. Always present, and equal to `location` when nothing differs.
     * **Identity is physical** (Article VI): two documents with one `physical` are one document.
     */
    readonly physical: string;
    /** Lowercase hex SHA-256 over the exact bytes; 64 characters. */
    readonly hash: string;
}
//# sourceMappingURL=identity.d.ts.map