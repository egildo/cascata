/**
 * Tiny shared helper for reading HTTP response headers case-insensitively
 * — HTTP header names are case-insensitive (RFC 9110 §5.1), but
 * `RecordedResponse.headers` (contracts/recorded-responses.md) is a plain
 * `Record<string, string>`, whose key lookup is not. Both `fetch.ts`
 * (redirect `Location`) and `cache.ts` (`Cache-Control`, `ETag`,
 * `Last-Modified`, `Expires`) need this, so it lives in its own tiny
 * module rather than being copied into each.
 *
 * `src/resolve/` must never import from `src/adapters/` — enforced by
 * tests/unit/layering.test.ts. This file imports nothing.
 */
/** The value of the header named `name` in `headers`, matched case-insensitively, or `undefined` if absent. The first case-insensitive match wins if a (malformed) response somehow repeats a header under two different cases. */
export function getHeader(headers, name) {
    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === lowerName) {
            return value;
        }
    }
    return undefined;
}
//# sourceMappingURL=headers.js.map