/**
 * `target.push(...source)`, written as a loop — the only way this codebase
 * appends one list to another.
 *
 * **This is not a style preference, it is Article VI.** A spread call
 * passes one argument per element, and V8 throws
 * `RangeError: Maximum call stack size exceeded` past roughly 125,000 of
 * them. Every accumulation in the pipeline is over *a document's own*
 * contents — diagnostics, type declarations, `accept:` alternatives — and a
 * document is allowed to be 8 MB (`ParseLimits.maxBytes`, `SPEC.md` §11).
 * So a **legal, cap-obeying document** could make `validate()`/`load()`
 * **throw**:
 *
 * - a 3 MB schema whose named type carries a 200,000-entry `accept:` list
 *   (`src/validate/types.ts`'s `referencedNames`) — demonstrated;
 * - a 200,000-item sequence each element of which fails one `items` demand
 *   (`src/validate/check.ts`'s own accumulation) — demonstrated.
 *
 * §16 draws the line exactly here: *"Nothing about the state of the world
 * throws."* A programmer error throws; a fact about the world returns
 * diagnostics. A legal document is a fact about the world, so a
 * `RangeError` escaping `validate()` is a violation of the article, not a
 * rough edge — which is why the fix is one shared helper and a **mechanical
 * sweep** (`tests/unit/validate-totality.test.ts`) rather than a fix at
 * each site as it is found. The first pass at this defect, in v0.7 part 2,
 * fixed the two instances a property test happened to reach and left four
 * siblings standing; the sweep is what makes that failure unrepeatable.
 *
 * Note that an **array-literal** spread (`[...a, ...b]`) is unaffected: it
 * has no argument limit and is used freely throughout. Only a *call-site*
 * spread is dangerous, and only where the length is bounded by document
 * size rather than by a constant.
 *
 * Lives at the root of `src/` rather than inside any layer because every
 * layer needs it and it imports nothing — it crosses no boundary
 * `tests/unit/layering.test.ts` polices, in either direction.
 */
export function extend(target, source) {
    for (const item of source) {
        target.push(item);
    }
}
//# sourceMappingURL=extend.js.map