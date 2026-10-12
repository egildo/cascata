/**
 * Spelling a whole value in YAML -- SPEC.md Article IX (v1.15); specs/025-open-insert-delete FR-009.
 *
 * A mapping or sequence of scalars, nested, written as the lines a document would hold: block by default,
 * flow where the style says so or where the place is already flow. Scalars and keys follow Article IX's one
 * spelling rule (`spell.ts`): plain only where Cascata *and* YAML 1.1 read it back as that string, so a key
 * `"1"` or `"yes"` is quoted and a multi-line string is double-quoted, never a block scalar. Nothing here
 * writes an anchor, a tag or an alias, and nothing here reads a document: the style it is given is the
 * whole of what it knows (`insert.ts` copies it from the neighbours).
 */
import { hasLoneSurrogate, isContainerData, isEmptyData, kindOfNew, plainScalarText } from "../edit-data.js";
import { renderYamlString, yamlNonFinite } from "./spell.js";
/** The format cannot spell this value: a string with an unpaired surrogate. */
export class Unrepresentable extends Error {
}
export function scalarSpelling(value, inFlow) {
    const kind = kindOfNew(value);
    if (kind === "string") {
        if (hasLoneSurrogate(value))
            throw new Unrepresentable("A string with an unpaired UTF-16 surrogate cannot be encoded as UTF-8");
        return renderYamlString(value, { style: "plain", inFlow });
    }
    const text = plainScalarText(value, kind, yamlNonFinite);
    if (text === undefined)
        throw new Unrepresentable("YAML has no spelling for this value");
    return text;
}
export function keySpelling(key, inFlow) {
    if (hasLoneSurrogate(key))
        throw new Unrepresentable("A key with an unpaired UTF-16 surrogate cannot be encoded as UTF-8");
    return renderYamlString(key, { style: "plain", inFlow });
}
/** `[a, b]` and `{k: v}`, the whole value on one line. */
export function flowText(data) {
    if (!isContainerData(data))
        return scalarSpelling(data, true);
    if (Array.isArray(data))
        return `[${data.map(flowText).join(", ")}]`;
    const map = data;
    return `{${[...map].map(([key, value]) => `${keySpelling(key, true)}: ${flowText(value)}`).join(", ")}}`;
}
const spaces = (count) => " ".repeat(count);
/** The lines of one mapping entry, `indent` being the column of its key. */
function entryLines(key, value, indent, style) {
    const head = `${indent}${keySpelling(key, false)}:`;
    if (!isContainerData(value))
        return [`${head}${style.colon}${scalarSpelling(value, false)}`];
    if (isEmptyData(value))
        return [`${head}${style.colon}${Array.isArray(value) ? "[]" : "{}"}`];
    if (style.flow)
        return [`${head}${style.colon}${flowText(value)}`];
    const inner = { ...style, flow: false };
    if (Array.isArray(value))
        return [head, ...sequenceLines(value, indent + spaces(style.dashIndented ? style.step : 0), inner)];
    return [head, ...mappingLines(value, indent + spaces(style.step), inner)];
}
/** The lines of one sequence item, `indent` being the column of its dash. */
function itemLines(value, indent, style) {
    if (!isContainerData(value))
        return [`${indent}- ${scalarSpelling(value, false)}`];
    if (isEmptyData(value))
        return [`${indent}- ${Array.isArray(value) ? "[]" : "{}"}`];
    if (style.flow)
        return [`${indent}- ${flowText(value)}`];
    const inner = { ...style, flow: false };
    const lines = Array.isArray(value) ? sequenceLines(value, `${indent}  `, inner) : mappingLines(value, `${indent}  `, inner);
    // The first entry of a nested collection rides on the dash's line: its own indentation is the dash and a blank.
    return lines.map((line, index) => (index === 0 ? `${indent}- ${line.slice(indent.length + 2)}` : line));
}
export function mappingLines(map, indent, style) {
    return [...map].flatMap(([key, value]) => entryLines(key, value, indent, style));
}
export function sequenceLines(items, indent, style) {
    return items.flatMap((item) => itemLines(item, indent, style));
}
/** One mapping entry as lines at `indent`. */
export function entryAt(key, value, indent, style) {
    return entryLines(key, value, indent, style);
}
/** One sequence item as lines at `indent`. */
export function itemAt(value, indent, style) {
    return itemLines(value, indent, style);
}
/** A whole block container (nonempty) as lines at `indent`; a scalar or an empty container is not block-shaped. */
export function blockLines(data, indent, style) {
    const inner = { ...style, flow: false };
    if (Array.isArray(data))
        return sequenceLines(data, indent, inner);
    return mappingLines(data, indent, inner);
}
/** Whether `data` is written inline after `key:` or `- ` (a scalar, an empty container, or any container in a flow style), rather than as lines below. */
export function isInline(data, style) {
    return !isContainerData(data) || isEmptyData(data) || style.flow;
}
/** The inline spelling of a value for which `isInline` holds. */
export function inlineText(data) {
    if (!isContainerData(data))
        return scalarSpelling(data, false);
    if (isEmptyData(data))
        return Array.isArray(data) ? "[]" : "{}";
    return flowText(data);
}
//# sourceMappingURL=render.js.map