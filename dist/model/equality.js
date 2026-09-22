/**
 * The single definition of model equality — SPEC.md §4.2 ("Equality is
 * defined once, on the model"), data-model.md "Equality", FR-007.
 *
 * - Scalars: equal when `kind` **and** value are equal. `int 2` is not
 *   `float 2.0` — different kinds, never coerced toward each other.
 * - Mappings: equal when they have the same key set and equal values per
 *   key, **regardless of order**.
 * - Sequences: equal when the same length and equal items **in order**.
 * - Spans and origins take **no part** in equality.
 * - Strings compare by JS string equality, which compares UTF-16 code
 *   units — the code-point sequence for any string this model can hold,
 *   since scalar strings come from valid UTF-8 input (FR-016) and so never
 *   contain lone surrogates. No Unicode normalization is applied (FR-006):
 *   precomposed `é` is not equal to `e` + combining acute.
 *
 * Everything else in the system — the corpus, merge, diamond dedup —
 * consumes this one definition rather than rolling its own.
 */
function isScalar(node) {
    return node.type === "scalar";
}
function isMapping(node) {
    return node.type === "mapping";
}
function isSequence(node) {
    return node.type === "sequence";
}
function scalarsEqual(a, b) {
    if (a.kind !== b.kind) {
        return false;
    }
    switch (a.kind) {
        case "string":
            return typeof b.value === "string" && a.value === b.value;
        case "int":
            return typeof b.value === "bigint" && a.value === b.value;
        case "float":
            return typeof b.value === "number" && a.value === b.value;
        case "bool":
            return typeof b.value === "boolean" && a.value === b.value;
        case "null":
            return b.value === null;
    }
}
function mappingsEqual(a, b) {
    if (a.entries.size !== b.entries.size) {
        return false;
    }
    for (const [key, valueA] of a.entries) {
        if (!b.entries.has(key)) {
            return false;
        }
        const valueB = b.entries.get(key);
        if (valueB === undefined || !nodesEqual(valueA, valueB)) {
            return false;
        }
    }
    return true;
}
function sequencesEqual(a, b) {
    if (a.items.length !== b.items.length) {
        return false;
    }
    for (let index = 0; index < a.items.length; index += 1) {
        const itemA = a.items[index];
        const itemB = b.items[index];
        if (itemA === undefined || itemB === undefined || !nodesEqual(itemA, itemB)) {
            return false;
        }
    }
    return true;
}
/** The one definition of Node equality. Spans and origins are ignored throughout. */
export function nodesEqual(a, b) {
    if (isScalar(a)) {
        return isScalar(b) && scalarsEqual(a, b);
    }
    if (isMapping(a)) {
        return isMapping(b) && mappingsEqual(a, b);
    }
    return isSequence(b) && sequencesEqual(a, b);
}
//# sourceMappingURL=equality.js.map