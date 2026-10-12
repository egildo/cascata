/**
 * What a caller may write -- SPEC.md Article IX (v1.15), specs/025-open-insert-delete FR-007.
 *
 * `EditData` is a scalar, a sequence of `EditData`, or an ordered `Map` of string keys to `EditData`.
 * A mapping is a `Map` and never a plain object, because a plain object reorders array-index keys
 * (`{ b: 1, 2: 1 }` lists `2` first) and swallows `__proto__` (CLAUDE.md, Known traps). Anything else
 * is programmer error and throws, naming what it found and where.
 *
 * Everything here is format-blind: validation, the node count and depth that bound the work a render
 * may do, and the one definition of "this data is that node" the read-back and the nothing-changed
 * law share. Scalar kinds follow Article IX: a number inside a container has no scalar to inherit a
 * kind from, so a whole number is an integer and any other number a float.
 */
export function isContainerData(value) {
    return Array.isArray(value) || value instanceof Map;
}
/** Whether a container holds nothing. */
export function isEmptyData(value) {
    return Array.isArray(value) ? value.length === 0 : value.size === 0;
}
function describeFound(value) {
    if (value === undefined)
        return "undefined";
    if (typeof value === "symbol")
        return "a symbol";
    if (typeof value === "function")
        return "a function";
    if (value === null || typeof value !== "object")
        return typeof value;
    const name = Object.getPrototypeOf(value)?.constructor?.name;
    return Array.isArray(value) ? "an array" : name === "Object" || name === undefined ? "a plain object (a mapping is a Map, which keeps its order)" : `a ${String(name)}`;
}
function isScalarData(value) {
    return typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean" || value === null;
}
/**
 * Check `value` is `EditData` and measure it, iteratively (a hostile depth must not overflow the stack) and with
 * a budget (a shared sub-structure written twice at every level is a cheap way to ask for a billion nodes). Throws
 * a `TypeError` for anything that is not in the type: a plain object, a `Map` with a key that is not a string, a
 * cycle, a sparse array, `undefined`, a `Set`, a function. It does not throw for a value past the document's limits:
 * that is the document's refusal to give, not a mistake of the caller's.
 */
export function inspectData(value, fnName, maxDepth, maxNodes) {
    let nodes = 0;
    let depth = 0;
    const where = (stack, last) => {
        const path = stack.map((frame) => frame.kids[frame.at - 1]?.[0]).filter((key) => key !== undefined);
        if (last !== undefined)
            path.push(last);
        return path.length === 0 ? "the value" : `the value at ${path.map((key) => (typeof key === "number" ? `[${key}]` : `[${JSON.stringify(key)}]`)).join("")}`;
    };
    const open = (container, stack) => {
        if (Array.isArray(container)) {
            const kids = [];
            for (let index = 0; index < container.length; index += 1) {
                if (!Object.hasOwn(container, index))
                    throw new TypeError(`${fnName}(): ${where(stack, index)} is a hole in a sparse array; every item must be written`);
                kids.push([index, container[index]]);
            }
            return { container, kids, at: 0 };
        }
        if (container instanceof Map) {
            const kids = [];
            for (const [key, child] of container) {
                if (typeof key !== "string")
                    throw new TypeError(`${fnName}(): ${where(stack)} is a Map with a key that is ${describeFound(key)}, not a string`);
                kids.push([key, child]);
            }
            return { container, kids, at: 0 };
        }
        return undefined;
    };
    const onPath = new Set();
    const stack = [];
    let current = value;
    for (;;) {
        // Visit `current`: a scalar ends here, a container opens a frame.
        nodes += 1;
        if (nodes > maxNodes)
            return { depth, nodes, tooDeep: false, tooBig: true };
        if (!isScalarData(current)) {
            if (!Array.isArray(current) && !(current instanceof Map))
                throw new TypeError(`${fnName}(): ${where(stack)} is ${describeFound(current)}; a value is a string, number, bigint, boolean, null, an array, or a Map of string keys`);
            if (onPath.has(current))
                throw new TypeError(`${fnName}(): ${where(stack)} contains itself; a value cannot hold a cycle`);
            if (stack.length > maxDepth)
                return { depth: stack.length, nodes, tooDeep: true, tooBig: false };
            const frame = open(current, stack);
            if (frame === undefined)
                throw new Error("Internal error: a container was neither array nor Map");
            onPath.add(frame.container);
            stack.push(frame);
            depth = Math.max(depth, stack.length);
        }
        // Next: the next unvisited child of the innermost open frame.
        let next;
        let found = false;
        while (stack.length > 0 && !found) {
            const top = stack[stack.length - 1];
            if (top === undefined)
                break;
            const kid = top.kids[top.at];
            if (kid === undefined) {
                onPath.delete(top.container);
                stack.pop();
            }
            else {
                top.at += 1;
                next = kid[1];
                found = true;
            }
        }
        if (!found)
            return { depth, nodes, tooDeep: false, tooBig: false };
        current = next;
    }
}
// --- kinds, and equality with a model node -----------------------------------
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** Whether `text` has a UTF-16 surrogate with no partner, which no UTF-8 document can hold (v1.12 `edit-unrepresentable`). */
export function hasLoneSurrogate(text) {
    return LONE_SURROGATE.test(text);
}
/** The shortest round-trip spelling with a decimal point or an exponent guaranteed (FR-006): `3` is `3.0`, `-0` is `-0.0`, `1e21` is `1e+21`. */
export function floatText(value) {
    if (Object.is(value, -0))
        return "-0.0";
    const text = String(value);
    return /^-?\d+$/.test(text) ? `${text}.0` : text;
}
/**
 * The spelling of a scalar that is not a string, the same in both formats but for a float that is not finite, which
 * `nonFinite` spells (YAML) or is `undefined` for (JSON has none): `undefined` back means the format cannot say it.
 */
export function plainScalarText(value, kind, nonFinite) {
    switch (kind) {
        case "bool":
            return value === true ? "true" : "false";
        case "null":
            return "null";
        case "int":
            return BigInt(value).toString();
        case "float": {
            const number = value;
            return Number.isFinite(number) ? floatText(number) : nonFinite?.(number);
        }
        case "string":
            throw new Error("Internal error: plainScalarText() spells no string");
    }
}
/** The kind a scalar written where no scalar was (inside a container, or over a container) reads back as. */
export function kindOfNew(value) {
    if (typeof value === "string")
        return "string";
    if (typeof value === "boolean")
        return "bool";
    if (value === null)
        return "null";
    if (typeof value === "bigint")
        return "int";
    // v1.15 (the owner's ruling): with no number to keep the kind of, a `number` is a decimal (`3` is written `3.0`) and
    // a `bigint` an integer — the value view's own convention, so a value read and written back keeps its kind.
    return "float";
}
/** §4.2's equality of a model scalar and a value of the given kind; `NaN` equals `NaN` here, because setting it again must write nothing new. */
export function equalsValue(node, kind, value) {
    if (node.type !== "scalar" || node.kind !== kind)
        return false;
    switch (node.kind) {
        case "string":
        case "bool":
            return node.value === value;
        case "int":
            return typeof value !== "string" && typeof value !== "boolean" && value !== null && node.value === BigInt(value);
        case "float":
            return typeof value === "number" && (node.value === value || (Number.isNaN(node.value) && Number.isNaN(value)));
        case "null":
            return true;
    }
}
/**
 * Whether `data` is `node` under §4.2's equality: the same kinds, the same values, a mapping's key order no part of it.
 * Spans take no part. Recursion is bounded by the nesting `inspectData` has already measured.
 */
export function dataEqualsNode(data, node) {
    if (isScalarData(data))
        return equalsValue(node, kindOfNew(data), data);
    if (Array.isArray(data)) {
        return node.type === "sequence" && node.items.length === data.length && data.every((item, index) => {
            const child = node.items[index];
            return child !== undefined && dataEqualsNode(item, child);
        });
    }
    const map = data;
    if (node.type !== "mapping" || node.entries.size !== map.size)
        return false;
    for (const [key, item] of map) {
        const child = node.entries.get(key);
        if (child === undefined || !dataEqualsNode(item, child))
            return false;
    }
    return true;
}
//# sourceMappingURL=edit-data.js.map