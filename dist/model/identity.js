/**
 * What makes two fetches the same document — `SPEC.md` §6.1;
 * data-model.md "Document Identity".
 *
 * Here rather than in `src/resolve/` for the reason given in
 * `reference.ts`: `graph/` needs the shape and may not import `resolve/`.
 * Computing a hash is `resolve/identity.ts`'s job; this module is the
 * shape alone and pulls in no crypto.
 */
export {};
//# sourceMappingURL=identity.js.map