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
const MUTATING_MAP_METHODS = new Set(["set", "delete", "clear"]);
/**
 * Wrap a `Map` so every mutating method throws, while every read-only
 * method and iterator behaves exactly as it would on the underlying Map.
 *
 * Methods must be forwarded to `target` (the real Map), not to the Proxy
 * itself — `Map.prototype.get` (and friends) check an internal slot that
 * only a genuine Map instance has, so calling them with the Proxy as
 * `this` throws "incompatible receiver". Binding to `target` sidesteps
 * that without needing to re-implement the Map interface.
 */
function guardedMap(target) {
    return new Proxy(target, {
        get(mapTarget, prop, _receiver) {
            if (MUTATING_MAP_METHODS.has(prop)) {
                return () => {
                    throw new TypeError(`Cannot mutate a frozen Mapping: '${String(prop)}' is not permitted on a Cascata node`);
                };
            }
            const value = Reflect.get(mapTarget, prop, mapTarget);
            return typeof value === "function" ? value.bind(mapTarget) : value;
        },
        set() {
            throw new TypeError("Cannot mutate a frozen Mapping: assignment is not permitted on a Cascata node");
        },
    });
}
function freezeOrigin(origin) {
    return Object.freeze(origin);
}
function freezeSpan(span) {
    freezeOrigin(span.origin);
    return Object.freeze(span);
}
/**
 * Recursively freeze a Node tree and return the frozen tree.
 *
 * Reference identity is NOT preserved for mappings: guarding `entries`
 * requires wrapping it in a Proxy, which means a new `Mapping` object is
 * built and returned. `freeze(m) !== m` when `m` is a mapping, while
 * scalars and sequences are frozen in place and handed back. Always use
 * the return value — never assume the argument was frozen where it stood.
 */
export function freeze(node) {
    freezeSpan(node.span);
    switch (node.type) {
        case "scalar":
            return Object.freeze(node);
        case "sequence": {
            const sequence = node;
            for (const item of sequence.items) {
                freeze(item);
            }
            Object.freeze(sequence.items);
            return Object.freeze(sequence);
        }
        case "mapping": {
            const mapping = node;
            const frozenEntries = new Map();
            for (const [key, value] of mapping.entries) {
                frozenEntries.set(key, freeze(value));
            }
            Object.freeze(frozenEntries);
            const guarded = guardedMap(frozenEntries);
            const replacement = { type: "mapping", entries: guarded, span: mapping.span };
            return Object.freeze(replacement);
        }
    }
}
//# sourceMappingURL=freeze.js.map