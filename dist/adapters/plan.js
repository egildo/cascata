/**
 * What a format's writer answers when asked to replace, add or remove (v1.15): the bytes to put in a range of the
 * document as opened, or the refusal. The format-blind part (`edit.ts`) turns a plan into an `Edit` and reads it back.
 */
export const edit = (start, end, text) => ({ ok: true, start, end, text });
export const refusal = (code, message, span, related) => ({
    ok: false,
    code,
    message,
    ...(span !== undefined ? { span } : {}),
    ...(related !== undefined ? { related } : {}),
});
//# sourceMappingURL=plan.js.map