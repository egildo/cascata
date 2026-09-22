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
import { type Diagnostic } from "../../diagnostics/diagnostic.js";
import { type Node } from "../../model/node.js";
import { type Origin } from "../../model/span.js";
import { type ParseLimits } from "../limits.js";
/** Mirrors the YAML adapter's `ParseOutcome` and `src/adapters/registry.ts`'s `AdapterParseOutcome`. Never both a tree and diagnostics. */
export type ParseOutcome = {
    ok: true;
    tree: Node;
} | {
    ok: false;
    diagnostics: Diagnostic[];
};
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
export declare function parseJsonBytes(bytes: Uint8Array, origin: Origin, limitOverrides?: Partial<ParseLimits>): ParseOutcome;
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
export declare function parseJsonText(text: string, origin: Origin, limitOverrides?: Partial<ParseLimits>): ParseOutcome;
//# sourceMappingURL=parse.d.ts.map