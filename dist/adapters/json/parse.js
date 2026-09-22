/**
 * The JSON adapter — SPEC.md §12's RFC 8259 row, §14 item 11;
 * specs/011-json-adapter/contracts/json-adapter.md.
 *
 * A hand-written recursive-descent parser over the raw bytes. `JSON.parse`
 * is not used and could not be: it yields no positions, and §4.1 makes an
 * unpositioned node unconstructible; it yields IEEE-754 doubles, and §4.2
 * makes integers exact `bigint`s at any magnitude. Attaching positions to a
 * `JSON.parse` tree afterwards means writing a second parser that has to
 * agree with the first about every token boundary, which is more code and
 * more risk than this file.
 *
 * `src/adapters/json/` is a format-aware directory (Principle IV), like
 * `src/adapters/yaml/`. Nothing outside `src/adapters/` and the
 * orchestrator in `src/index.ts` may reach it, and
 * `tests/unit/layering.test.ts` says so without needing to be told this
 * directory exists.
 *
 * **What is shared with the YAML adapter, and what is not.** The UTF-8
 * validator and the byte-offset locator are shared, in
 * `src/adapters/encoding.ts` — they are about bytes, not about a grammar
 * (research P-2). The diagnostic codes are shared: all five this file can
 * produce already existed, because every way a JSON document can be wrong
 * is a hazard something already had a name for (data-model.md). Nothing
 * else is: this adapter imports no YAML, no `yaml`, and no part of the
 * other adapter.
 *
 * **Two kinds of refusal.** A grammar violation is fatal and ends the
 * parse: JSON has no resynchronization point, and after `{"a": ,` there is
 * no honest way to say where the next value begins, so a "recovered"
 * second diagnostic would carry a position that means nothing. A duplicate
 * key and a depth-cap violation are *not* fatal: both are found at a point
 * where the scan knows exactly how to continue, so both accumulate and a
 * document with two duplicate keys reports two (research D-3). This is the
 * same split the YAML adapter has, where reader errors arrive from
 * `doc.errors` and floor violations from the walk.
 *
 * **The recursion is bounded by `maxDepth`, never by the input.** The depth
 * cap is checked *before* descending into a value, and a value refused for
 * depth is skipped by `skipValue`, which is iterative. A document of ten
 * thousand open brackets therefore produces a diagnostic rather than a
 * `RangeError` — asserted directly, not assumed (research D-4).
 */
import { createDiagnostic } from "../../diagnostics/diagnostic.js";
import { DiagnosticCollector } from "../../diagnostics/collector.js";
import { createBoolScalar, createFloatScalar, createIntScalar, createMapping, createNullScalar, createSequence, createStringScalar } from "../../model/node.js";
import { createSourceSpan } from "../../model/span.js";
import { findFirstInvalidUtf8ByteOffset, locateByteOffset } from "../encoding.js";
import { checkDepthLimit, checkSizeLimit, resolveLimits } from "../limits.js";
import { hexDigitValue, isDigit, Scanner } from "./scan.js";
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const LEFT_BRACE = 0x7b;
const RIGHT_BRACE = 0x7d;
const LEFT_BRACKET = 0x5b;
const RIGHT_BRACKET = 0x5d;
const COLON = 0x3a;
const COMMA = 0x2c;
const MINUS = 0x2d;
const PLUS = 0x2b;
const PERIOD = 0x2e;
const ZERO = 0x30;
const LOWER_E = 0x65;
const UPPER_E = 0x45;
const LITERAL_TRUE = [0x74, 0x72, 0x75, 0x65];
const LITERAL_FALSE = [0x66, 0x61, 0x6c, 0x73, 0x65];
const LITERAL_NULL = [0x6e, 0x75, 0x6c, 0x6c];
/** `EF BB BF`, the UTF-8 encoding of U+FEFF. RFC 8259 §8.1 forbids one and permits a parser to ignore it; Cascata ignores it, exactly as the YAML adapter does. */
const BOM = [0xef, 0xbb, 0xbf];
/** Every string in a JSON document is decoded through this one decoder. `fatal` because the bytes were already validated and a repair here would be a silent lie; `ignoreBOM: true` because BOM stripping happens in exactly one place (the YAML adapter's own hard-won finding — the option's name is a double negative). */
const DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
class JsonParser {
    scanner;
    origin;
    documentLength;
    limits;
    diagnostics = new DiagnosticCollector();
    /** Set once a grammar violation has been recorded. Every parse function returns immediately while it is set — see the module doc on why JSON cannot resynchronize. */
    failed = false;
    constructor(bytes, origin, limits) {
        this.scanner = new Scanner(bytes);
        this.origin = origin;
        this.documentLength = bytes.length;
        this.limits = limits;
    }
    // --- spans and diagnostics ---------------------------------------------
    spanFrom(start, endOffset) {
        return createSourceSpan({
            origin: this.origin,
            start: start.offset,
            end: endOffset,
            line: start.line,
            column: start.column,
            documentLength: this.documentLength,
        });
    }
    /** The span of the byte the cursor is on — or a zero-width span at the end of input, which is what "something was required and the document stopped" looks like. */
    spanHere() {
        const here = this.scanner.position;
        return this.spanFrom(here, Math.min(here.offset + 1, this.documentLength));
    }
    /** Record a grammar violation and stop. `message` names what was expected, because a position without an expectation is a puzzle. */
    fail(message, span) {
        if (!this.failed) {
            this.diagnostics.add(createDiagnostic({ level: "error", code: "malformed-document", message, primary: span ?? this.spanHere() }));
            this.failed = true;
        }
        return undefined;
    }
    failEncoding(message, span) {
        if (!this.failed) {
            this.diagnostics.add(createDiagnostic({ level: "error", code: "invalid-encoding", message, primary: span }));
            this.failed = true;
        }
        return undefined;
    }
    // --- the document -------------------------------------------------------
    /** RFC 8259 §2: `JSON-text = ws value ws`. Exactly one value, and nothing after it. */
    parseDocument() {
        this.scanner.skipWhitespace();
        if (this.scanner.atEnd) {
            // JSON has no production for an empty document. YAML does, and reads
            // one as a null scalar; the two adapters differ about their own
            // grammars, which is not two hosts differing about one document
            // (SPEC.md §16, research D-6).
            this.fail("A JSON document must contain exactly one value, and this one contains none");
            return { ok: false, diagnostics: this.diagnostics.all() };
        }
        const tree = this.parseValue(0);
        if (!this.failed) {
            this.scanner.skipWhitespace();
            if (!this.scanner.atEnd) {
                this.fail("A JSON document ends after its one value; this one continues");
            }
        }
        if (!this.diagnostics.isEmpty) {
            return { ok: false, diagnostics: this.diagnostics.all() };
        }
        if (tree === undefined) {
            throw new Error("Internal error: the JSON parse produced no tree despite recording no diagnostics");
        }
        return { ok: true, tree };
    }
    // --- values -------------------------------------------------------------
    /**
     * One value at `depth`. The root is depth 0 and a collection's members
     * are one deeper, matching the YAML adapter's convention exactly (v0.1
     * §11) — `{"a": 1}` puts the scalar at depth 1.
     *
     * The cap is checked here, **before** any descent, which is what bounds
     * the recursion by `maxDepth` rather than by the document.
     */
    parseValue(depth) {
        const start = this.scanner.position;
        const depthDiagnostic = checkDepthLimit(depth, this.limits, this.spanHere());
        if (depthDiagnostic !== undefined) {
            this.diagnostics.add(depthDiagnostic);
            this.skipValue();
            return undefined;
        }
        const byte = this.scanner.peek();
        switch (byte) {
            case LEFT_BRACE:
                return this.parseObject(depth);
            case LEFT_BRACKET:
                return this.parseArray(depth);
            case QUOTE: {
                const text = this.parseString();
                return text === undefined ? undefined : createStringScalar(text, this.spanFrom(start, this.scanner.offset));
            }
            case LITERAL_TRUE[0]:
                return this.parseLiteral(LITERAL_TRUE, () => createBoolScalar(true, this.spanFrom(start, this.scanner.offset)));
            case LITERAL_FALSE[0]:
                return this.parseLiteral(LITERAL_FALSE, () => createBoolScalar(false, this.spanFrom(start, this.scanner.offset)));
            case LITERAL_NULL[0]:
                return this.parseLiteral(LITERAL_NULL, () => createNullScalar(this.spanFrom(start, this.scanner.offset)));
            default:
                if (byte === MINUS || isDigit(byte)) {
                    return this.parseNumber();
                }
                return this.fail("Expected a JSON value here (an object, array, string, number, true, false, or null)");
        }
    }
    parseLiteral(literal, build) {
        for (const expected of literal) {
            if (this.scanner.peek() !== expected) {
                return this.fail(`Expected the literal '${DECODER.decode(Uint8Array.from(literal))}'`);
            }
            this.scanner.advance();
        }
        return build();
    }
    parseObject(depth) {
        const start = this.scanner.position;
        this.scanner.advance(); // '{'
        const entries = [];
        /** key -> the span of its first occurrence, for `duplicate-key`'s `related`. */
        const seen = new Map();
        this.scanner.skipWhitespace();
        if (this.scanner.peek() === RIGHT_BRACE) {
            this.scanner.advance();
            return createMapping(entries, this.spanFrom(start, this.scanner.offset));
        }
        for (;;) {
            this.scanner.skipWhitespace();
            const keyStart = this.scanner.position;
            if (this.scanner.peek() !== QUOTE) {
                return this.fail("Expected a quoted member name — JSON has no unquoted keys and no single-quoted strings");
            }
            const key = this.parseString();
            if (key === undefined) {
                return undefined;
            }
            const keySpan = this.spanFrom(keyStart, this.scanner.offset);
            const first = seen.get(key);
            if (first !== undefined) {
                // RFC 8259 §4 permits a repeated name; SPEC.md §4.2 refuses it,
                // never last-wins, and reports both positions. Not fatal: the scan
                // knows exactly where it is, so a second duplicate in the same
                // document is reported too.
                this.diagnostics.add(createDiagnostic({
                    level: "error",
                    code: "duplicate-key",
                    message: "The same key appears more than once in this mapping",
                    primary: keySpan,
                    related: [{ label: "first occurrence", span: first }],
                }));
            }
            else {
                seen.set(key, keySpan);
            }
            this.scanner.skipWhitespace();
            if (this.scanner.peek() !== COLON) {
                return this.fail("Expected ':' after a member name");
            }
            this.scanner.advance();
            this.scanner.skipWhitespace();
            const value = this.parseValue(depth + 1);
            if (this.failed) {
                return undefined;
            }
            if (value !== undefined && first === undefined) {
                entries.push([key, value]);
            }
            this.scanner.skipWhitespace();
            const next = this.scanner.peek();
            if (next === COMMA) {
                this.scanner.advance();
                continue;
            }
            if (next === RIGHT_BRACE) {
                this.scanner.advance();
                return createMapping(entries, this.spanFrom(start, this.scanner.offset));
            }
            return this.fail("Expected ',' or '}' after a member");
        }
    }
    parseArray(depth) {
        const start = this.scanner.position;
        this.scanner.advance(); // '['
        const items = [];
        this.scanner.skipWhitespace();
        if (this.scanner.peek() === RIGHT_BRACKET) {
            this.scanner.advance();
            return createSequence(items, this.spanFrom(start, this.scanner.offset));
        }
        for (;;) {
            this.scanner.skipWhitespace();
            const item = this.parseValue(depth + 1);
            if (this.failed) {
                return undefined;
            }
            if (item !== undefined) {
                items.push(item);
            }
            this.scanner.skipWhitespace();
            const next = this.scanner.peek();
            if (next === COMMA) {
                this.scanner.advance();
                continue;
            }
            if (next === RIGHT_BRACKET) {
                this.scanner.advance();
                return createSequence(items, this.spanFrom(start, this.scanner.offset));
            }
            return this.fail("Expected ',' or ']' after an array element");
        }
    }
    // --- strings ------------------------------------------------------------
    /**
     * RFC 8259 §7. Returns the **decoded** text — the model holds what a
     * string means, never how it was spelled (§4.3). The cursor is left one
     * byte past the closing quote.
     *
     * Bytes that are neither an escape nor a quote are accumulated as raw
     * runs and decoded in one go, so an ordinary string costs one
     * `TextDecoder` call and no per-character work.
     */
    parseString() {
        this.scanner.advance(); // opening '"'
        const pieces = [];
        let runStart = this.scanner.offset;
        const flushRun = () => {
            if (this.scanner.offset > runStart) {
                pieces.push(DECODER.decode(this.scanner.bytes.subarray(runStart, this.scanner.offset)));
            }
        };
        for (;;) {
            const byte = this.scanner.peek();
            if (byte === undefined) {
                return this.fail("A string was opened and the document ended before its closing '\"'");
            }
            if (byte === QUOTE) {
                flushRun();
                this.scanner.advance();
                return pieces.join("");
            }
            if (byte === BACKSLASH) {
                flushRun();
                const escaped = this.parseEscape();
                if (escaped === undefined) {
                    return undefined;
                }
                pieces.push(escaped);
                runStart = this.scanner.offset;
                continue;
            }
            if (byte < 0x20) {
                // RFC 8259 §7: an unescaped control character is not permitted in a
                // string. A real newline or tab inside quotes is a syntax error,
                // not content.
                return this.fail("A control character must be escaped inside a JSON string");
            }
            this.scanner.advance();
        }
    }
    /** One escape sequence, the cursor sitting on its backslash. Returns the text it denotes. */
    parseEscape() {
        const escapeStart = this.scanner.position;
        this.scanner.advance(); // '\'
        const byte = this.scanner.peek();
        switch (byte) {
            case QUOTE:
            case BACKSLASH:
            case 0x2f: // '/'
                this.scanner.advance();
                return String.fromCharCode(byte);
            case 0x62: // 'b'
                this.scanner.advance();
                return "\b";
            case 0x66: // 'f'
                this.scanner.advance();
                return "\f";
            case 0x6e: // 'n'
                this.scanner.advance();
                return "\n";
            case 0x72: // 'r'
                this.scanner.advance();
                return "\r";
            case 0x74: // 't'
                this.scanner.advance();
                return "\t";
            case 0x75: // 'u'
                return this.parseUnicodeEscape(escapeStart);
            default:
                return this.fail("Unknown string escape — JSON permits only \\\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX");
        }
    }
    /**
     * `\uXXXX`, with the surrogate rule. An unpaired surrogate is
     * `invalid-encoding`, not `malformed-document`: the escape is
     * syntactically fine and the *text* is the problem — a lone surrogate is
     * not a character and has no UTF-8 encoding. That is the identical
     * hazard v0.1 named when a lone surrogate reached the YAML adapter
     * through a JS string, so it keeps that hazard's code
     * (data-model.md's table).
     */
    parseUnicodeEscape(escapeStart) {
        const high = this.readFourHexDigits();
        if (high === undefined) {
            return undefined;
        }
        if (high >= 0xdc00 && high <= 0xdfff) {
            return this.failEncoding("A \\u escape names a low surrogate with no high surrogate before it, which is not a character", this.spanFrom(escapeStart, this.scanner.offset));
        }
        if (high < 0xd800 || high > 0xdbff) {
            return String.fromCharCode(high);
        }
        // A high surrogate must be followed immediately by a `\uXXXX` naming a
        // low surrogate; anything else leaves it unpaired.
        if (this.scanner.peek() !== BACKSLASH || this.scanner.peek(1) !== 0x75) {
            return this.failEncoding("A \\u escape names a high surrogate that is not followed by a low surrogate, which is not a character", this.spanFrom(escapeStart, this.scanner.offset));
        }
        // Only the backslash is consumed here: `readFourHexDigits` expects the
        // cursor to be sitting *on* the `u`, exactly as it is when `parseEscape`
        // hands over. Advancing past the `u` as well was this file's first
        // defect, and the corpus found it on the first run.
        this.scanner.advance(); // '\'
        const low = this.readFourHexDigits();
        if (low === undefined) {
            return undefined;
        }
        if (low < 0xdc00 || low > 0xdfff) {
            // The span covers both escapes: the pair is what is wrong, and
            // pointing at only the second would name the innocent half.
            return this.failEncoding("A \\u escape names a high surrogate that is not followed by a low surrogate, which is not a character", this.spanFrom(escapeStart, this.scanner.offset));
        }
        return String.fromCodePoint((high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000);
    }
    /** The four hex digits of a `\u` escape, the cursor sitting on the `u`. */
    readFourHexDigits() {
        this.scanner.advance(); // 'u'
        let value = 0;
        for (let index = 0; index < 4; index += 1) {
            const digit = hexDigitValue(this.scanner.peek());
            if (digit === undefined) {
                return this.fail("A \\u escape needs exactly four hexadecimal digits");
            }
            this.scanner.advance();
            value = value * 16 + digit;
        }
        return value;
    }
    // --- numbers ------------------------------------------------------------
    /**
     * RFC 8259 §6: `number = [ "-" ] int [ frac ] [ exp ]`, with
     * `int = "0" / ( digit1-9 *DIGIT )`.
     *
     * **The grammar check is this scan, never `BigInt()` or `Number()`.**
     * `BigInt("0007")` is `7n` — the host primitive accepts a leading zero
     * that RFC 8259 forbids (research P-3) — and `Number()` additionally
     * accepts `Infinity`, `0x10`, and surrounding whitespace. Both are used
     * only as converters, on a substring this scan has already proved to
     * match the grammar above.
     *
     * The kind is **lexical** (§4.2): the presence of a fraction or an
     * exponent makes the literal a float, whatever its value is. `1e2` is a
     * float; `100` is an int. `-0` is an int whose value is `0n`, which is
     * what the YAML adapter already does with the same spelling (research
     * P-4).
     */
    parseNumber() {
        const start = this.scanner.position;
        let isFloat = false;
        if (this.scanner.peek() === MINUS) {
            this.scanner.advance();
        }
        // int
        if (this.scanner.peek() === ZERO) {
            this.scanner.advance();
            // A second digit here is not part of this number: `01` is `0`
            // followed by a `1` that nothing can consume, and the caller reports
            // the `1` as unexpected. That is exactly what RFC 8259's `int`
            // production says, and it puts the diagnostic on the offending digit
            // rather than on the whole literal.
        }
        else if (isDigit(this.scanner.peek())) {
            while (isDigit(this.scanner.peek())) {
                this.scanner.advance();
            }
        }
        else {
            return this.fail("Expected a digit — a JSON number needs an integer part");
        }
        // frac
        if (this.scanner.peek() === PERIOD) {
            isFloat = true;
            this.scanner.advance();
            if (!isDigit(this.scanner.peek())) {
                return this.fail("Expected a digit after '.' — a JSON fraction needs at least one");
            }
            while (isDigit(this.scanner.peek())) {
                this.scanner.advance();
            }
        }
        // exp
        const exponent = this.scanner.peek();
        if (exponent === LOWER_E || exponent === UPPER_E) {
            isFloat = true;
            this.scanner.advance();
            const sign = this.scanner.peek();
            if (sign === PLUS || sign === MINUS) {
                this.scanner.advance();
            }
            if (!isDigit(this.scanner.peek())) {
                return this.fail("Expected a digit in the exponent — a JSON exponent needs at least one");
            }
            while (isDigit(this.scanner.peek())) {
                this.scanner.advance();
            }
        }
        const span = this.spanFrom(start, this.scanner.offset);
        const literal = DECODER.decode(this.scanner.bytes.subarray(start.offset, this.scanner.offset));
        // A number outside the double range converts to Infinity, which is what
        // the YAML adapter already does with `1e400` and with `.inf` (research
        // P-4, D-5). An *integer* of any size stays exact, so this is reachable
        // only by writing an exponent.
        return isFloat ? createFloatScalar(Number(literal), span) : createIntScalar(BigInt(literal), span);
    }
    // --- skipping, for a value refused by the depth cap ---------------------
    /**
     * Consume one complete value without building anything, **iteratively**.
     *
     * This is what makes the depth cap a real second line of defence rather
     * than a decoration: the recursive walk stops at `maxDepth`, and whatever
     * remains below is stepped over by a loop, so a document of ten thousand
     * open brackets costs a diagnostic and not the call stack.
     *
     * It is deliberately **not** a validating scan. A diagnostic has already
     * been recorded by the time this runs, so the tree is discarded whatever
     * happens; re-checking the syntax of a region nobody will read would only
     * add noise to a refusal that is already complete.
     */
    skipValue() {
        let containerDepth = 0;
        for (;;) {
            this.scanner.skipWhitespace();
            const byte = this.scanner.peek();
            if (byte === undefined) {
                this.fail("A value was refused for depth and the document ended before it was complete");
                return;
            }
            if (byte === LEFT_BRACE || byte === LEFT_BRACKET) {
                this.scanner.advance();
                containerDepth += 1;
                continue;
            }
            if (byte === RIGHT_BRACE || byte === RIGHT_BRACKET) {
                this.scanner.advance();
                containerDepth -= 1;
                if (containerDepth <= 0) {
                    return;
                }
                continue;
            }
            if (byte === COMMA || byte === COLON) {
                this.scanner.advance();
                continue;
            }
            if (byte === QUOTE) {
                if (!this.skipStringRaw()) {
                    return;
                }
            }
            else if (!this.skipBareToken()) {
                return;
            }
            if (containerDepth === 0) {
                return;
            }
        }
    }
    /** Step over a string without decoding it. `false` means a fatal diagnostic was recorded. */
    skipStringRaw() {
        this.scanner.advance(); // '"'
        for (;;) {
            const byte = this.scanner.peek();
            if (byte === undefined) {
                this.fail("A string was opened and the document ended before its closing '\"'");
                return false;
            }
            this.scanner.advance();
            if (byte === QUOTE) {
                return true;
            }
            if (byte === BACKSLASH) {
                if (this.scanner.peek() === undefined) {
                    this.fail("A string escape was opened and the document ended");
                    return false;
                }
                this.scanner.advance();
            }
        }
    }
    /** Step over a number or a literal — any run of the bytes those two can be made of. `false` means a fatal diagnostic was recorded. */
    skipBareToken() {
        let consumed = 0;
        for (;;) {
            const byte = this.scanner.peek();
            if (byte === undefined)
                break;
            const isTokenByte = isDigit(byte) ||
                (byte >= 0x41 && byte <= 0x5a) ||
                (byte >= 0x61 && byte <= 0x7a) ||
                byte === MINUS ||
                byte === PLUS ||
                byte === PERIOD;
            if (!isTokenByte)
                break;
            this.scanner.advance();
            consumed += 1;
        }
        if (consumed === 0) {
            this.fail("Expected a JSON value here (an object, array, string, number, true, false, or null)");
            return false;
        }
        return true;
    }
}
/** Whether `bytes` opens with the UTF-8 byte-order mark. */
function hasByteOrderMark(bytes) {
    return bytes.length >= 3 && bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2];
}
/**
 * Parse JSON bytes into a Cascata tree or a non-empty, position-ordered
 * list of diagnostics — never both. The registry's entry point.
 *
 * Order of business, and every step of it is load-bearing:
 *
 *   1. **Size, on the raw byte length, before anything else** — a hostile
 *      document is refused without being parsed at all, the same posture
 *      the YAML adapter holds.
 *   2. **UTF-8 well-formedness, on the bytes** — never by decoding and
 *      looking for U+FFFD afterwards, because a document may legitimately
 *      contain one and repairing is what §4.2 forbids
 *      (`src/adapters/encoding.ts`).
 *   3. **A leading BOM is removed**, so it contributes zero bytes and zero
 *      columns and every span equals the span the same document without one
 *      would have.
 *   4. The scan itself, over the remaining bytes.
 */
export function parseJsonBytes(bytes, origin, limitOverrides) {
    const limits = resolveLimits(limitOverrides);
    const sizeDiagnostic = checkSizeLimit(bytes.length, limits, origin);
    if (sizeDiagnostic !== undefined) {
        return { ok: false, diagnostics: [sizeDiagnostic] };
    }
    const invalidOffset = findFirstInvalidUtf8ByteOffset(bytes);
    if (invalidOffset !== undefined) {
        const location = locateByteOffset(bytes, invalidOffset);
        return {
            ok: false,
            diagnostics: [
                createDiagnostic({
                    level: "error",
                    code: "invalid-encoding",
                    message: `Byte ${invalidOffset} begins a sequence that is not well-formed UTF-8 (RFC 3629)`,
                    primary: createSourceSpan({ origin, start: invalidOffset, end: invalidOffset + 1, line: location.line, column: location.column, documentLength: bytes.length }),
                }),
            ],
        };
    }
    const body = hasByteOrderMark(bytes) ? bytes.subarray(BOM.length) : bytes;
    return new JsonParser(body, origin, limits).parseDocument();
}
/**
 * Parse JSON text. Encodes to UTF-8 and delegates, so the two entry points
 * agree by construction rather than by discipline (the property
 * `tests/unit/entry-parity.test.ts` asserts for both adapters).
 *
 * The lone-surrogate scan is the one thing this path must do for itself. A
 * JS string can fail to be text in exactly one way — an unpaired UTF-16
 * surrogate — and `TextEncoder` would silently replace one with U+FFFD,
 * which is the repair v0.1 FR-002 exists to forbid. Refused here, before
 * encoding, at the byte offset the surrogate would have occupied.
 */
export function parseJsonText(text, origin, limitOverrides) {
    const encoder = new TextEncoder();
    for (let index = 0; index < text.length; index += 1) {
        const unit = text.charCodeAt(index);
        if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = index + 1 < text.length ? text.charCodeAt(index + 1) : Number.NaN;
            if (next >= 0xdc00 && next <= 0xdfff) {
                index += 1;
                continue;
            }
        }
        else if (unit < 0xdc00 || unit > 0xdfff) {
            continue;
        }
        const before = encoder.encode(text.slice(0, index));
        const location = locateByteOffset(before, before.length);
        return {
            ok: false,
            diagnostics: [
                createDiagnostic({
                    level: "error",
                    code: "invalid-encoding",
                    message: "Input contains an unpaired UTF-16 surrogate, which cannot correspond to valid UTF-8",
                    primary: createSourceSpan({ origin, start: before.length, end: before.length, line: location.line, column: location.column, documentLength: before.length }),
                }),
            ],
        };
    }
    return parseJsonBytes(encoder.encode(text), origin, limitOverrides);
}
//# sourceMappingURL=parse.js.map