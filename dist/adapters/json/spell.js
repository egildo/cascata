/**
 * How a JSON string is spelled -- SPEC.md Article IX (§19, v1.10): a JSON string (RFC 8259 §7), escapes where it
 * demands them, every other character, non-ASCII included, as itself.
 */
export function renderJsonString(text) {
    return JSON.stringify(text);
}
//# sourceMappingURL=spell.js.map