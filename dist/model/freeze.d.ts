/**
 * Deep immutability of returned trees — SPEC.md §4.1, FR-026,
 * contracts/parse-api.md ("The tree is deeply frozen before being
 * returned. Mutation attempts do not succeed.").
 *
 * `Object.freeze` alone is not sufficient here: it makes a plain object's
 * own properties non-writable (so `node.span = ...` throws under ESM's
 * automatic strict mode, and a frozen array's `.push()` throws because the
 * array becomes non-extensible) but it does **not** stop `Map.prototype.set`
 * or `.delete()` on a frozen `Map` instance — those operate on the Map's
 * internal slot, not on an enumerable property, so freezing the Map object
 * itself is silently ineffective. `Mapping.entries` is therefore wrapped in
 * a `Proxy` that forwards every read-only operation to a frozen backing
 * `Map` and throws on every mutating one.
 */
import type { Node } from "./node.js";
/**
 * Recursively freeze a Node tree and return the frozen tree.
 *
 * Reference identity is NOT preserved for mappings: guarding `entries`
 * requires wrapping it in a Proxy, which means a new `Mapping` object is
 * built and returned. `freeze(m) !== m` when `m` is a mapping, while
 * scalars and sequences are frozen in place and handed back. Always use
 * the return value — never assume the argument was frozen where it stood.
 */
export declare function freeze(node: Node): Node;
//# sourceMappingURL=freeze.d.ts.map