/**
 * Adding to and removing from a bracketed, comma-separated list -- v1.15 FR-010, FR-012, FR-016.
 *
 * A JSON array or object and a YAML flow collection are one shape to a writer that works on bytes: an opening
 * bracket, entries separated by commas, a closing bracket. This module knows nothing else: not what an entry
 * means, not how its text is spelled (the caller does that), only where the bytes between entries are and which
 * of them is the one comma an entry takes with it. Style is copied from the neighbours: the gap an existing pair
 * of entries has (`, ` or `,\n  `) is the gap a new entry gets.
 */
import { breakLengthAt, indentationOf, isBlank, isBreak, lineStartOf, skipBlanksForward, startsItsLine } from "./text.js";
/** The gap between two entries when it is only blanks, line breaks and exactly one comma. */
function pureGap(bytes, from, to) {
    let commas = 0;
    for (let i = from; i < to; i += 1) {
        const byte = bytes[i];
        if (byte === 0x2c)
            commas += 1;
        else if (!isBlank(byte) && !isBreak(byte))
            return undefined;
    }
    return commas === 1 ? new TextDecoder().decode(bytes.subarray(from, to)) : undefined;
}
/** The indentation a line break inside the box should be followed by to put an entry where `entry` is. */
function indentOfEntry(bytes, entry) {
    if (startsItsLine(bytes, entry.start))
        return indentationOf(bytes, entry.start);
    return " ".repeat(entry.start - lineStartOf(bytes, entry.start));
}
/**
 * The separator -- a comma and the whitespace around it -- a new entry beside `neighbour` takes. Copied from the gap
 * between `neighbour` and the entry before it or after it; else from any gap in the box; else, with one entry, from
 * whether it sits on its own line (a comma, a line break, its indentation); else `fallback`.
 */
function separatorFor(bytes, box, neighbour, eol, fallback) {
    const { entries } = box;
    const gapAfter = (index) => {
        const left = entries[index];
        const right = entries[index + 1];
        return left === undefined || right === undefined ? undefined : pureGap(bytes, left.end, right.start);
    };
    const near = gapAfter(neighbour - 1) ?? gapAfter(neighbour);
    if (near !== undefined)
        return near;
    for (let index = 0; index + 1 < entries.length; index += 1) {
        const any = gapAfter(index);
        if (any !== undefined)
            return any;
    }
    const first = entries[0];
    if (first !== undefined && entries.length === 1) {
        let broke = false;
        for (let i = box.open + 1; i < first.start; i += 1)
            broke ||= isBreak(bytes[i]);
        if (broke)
            return `,${eol}${indentOfEntry(bytes, first)}`;
    }
    return fallback;
}
/**
 * Add an entry whose text is `entryText` at `index` (0 to the number of entries) of a box that has entries. A new last
 * entry goes after the old last, with the box's own separator; a new entry before an old one goes just ahead of it.
 * `fallback` is the separator when the box offers none to copy (one entry on one line).
 */
export function flowAdd(bytes, box, index, entryText, eol, fallback) {
    const { entries } = box;
    if (index >= entries.length) {
        const last = entries[entries.length - 1];
        if (last === undefined)
            throw new Error("Internal error: flowAdd() on a box with no entries");
        return { start: last.end, end: last.end, text: separatorFor(bytes, box, entries.length - 1, eol, fallback) + entryText };
    }
    const before = entries[index];
    if (before === undefined)
        throw new Error("Internal error: flowAdd() index out of range");
    return { start: before.start, end: before.start, text: entryText + separatorFor(bytes, box, index, eol, fallback) };
}
/**
 * Remove the entry at `index`, and exactly one comma with its spacing: the following comma, or the preceding one for the
 * last entry. The only entry takes the whole interior with it, so `{ "a": 1 }` becomes `{}`.
 */
export function flowRemove(bytes, box, index) {
    const { entries } = box;
    const entry = entries[index];
    if (entry === undefined)
        throw new Error("Internal error: flowRemove() index out of range");
    if (entries.length === 1) {
        // Blanks, line breaks and at most a trailing comma around the entry go with it; anything else (a comment) stays.
        let tidy = true;
        for (let i = box.open + 1; i < box.close; i += 1) {
            if (i >= entry.start && i < entry.end)
                continue;
            if (!isBlank(bytes[i]) && !isBreak(bytes[i]) && bytes[i] !== 0x2c)
                tidy = false;
        }
        if (tidy)
            return { start: box.open + 1, end: box.close, text: "" };
        let end = skipBlanksForward(bytes, entry.end);
        if (bytes[end] === 0x2c)
            end += 1;
        return { start: entry.start, end, text: "" };
    }
    const next = entries[index + 1];
    if (next !== undefined) {
        if (pureGap(bytes, entry.end, next.start) !== undefined)
            return { start: entry.start, end: next.start, text: "" };
        // Something else (a comment) sits between: take the entry and its comma and leave the rest.
        let comma = entry.end;
        while (comma < next.start && bytes[comma] !== 0x2c)
            comma += 1;
        let end = comma + 1;
        end = skipBlanksForward(bytes, end);
        return { start: entry.start, end, text: "" };
    }
    const previous = entries[index - 1];
    if (previous === undefined)
        throw new Error("Internal error: flowRemove() found no neighbour");
    if (pureGap(bytes, previous.end, entry.start) !== undefined)
        return { start: previous.end, end: entry.end, text: "" };
    let comma = entry.start;
    while (comma > previous.end && bytes[comma] !== 0x2c)
        comma -= 1;
    return { start: comma, end: entry.end, text: "" };
}
/** The break that follows `at`, if any (used to keep a line ending whole). */
export function breakAfter(bytes, at) {
    const length = breakLengthAt(bytes, at);
    return length === 0 ? "" : new TextDecoder().decode(bytes.subarray(at, at + length));
}
//# sourceMappingURL=flow.js.map