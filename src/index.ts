/**
 * Public surface — contracts/parse-api.md (v0.1), contracts/resolve-api.md
 * (v0.2), FR-025, FR-026, FR-014 (v0.1); FR-001-FR-004 (v0.2).
 *
 * `parse(bytes, options)` is the **primary** entry point (v0.2, research
 * D8): it accepts a document's exact bytes, so §4.2's UTF-8 mandate is
 * enforceable — verified, not assumed, that v0.1's text-only entry point
 * could not enforce it (invalid bytes had already become U+FFFD replacement
 * characters before Cascata ever saw them).
 *
 * `parseText(text, options)` is v0.1's original entry point, renamed but
 * behaviorally unchanged, retained for callers already holding decoded
 * text. It cannot enforce v0.2 FR-002 — documented here, not silently implied
 * otherwise, per the corollary constitution v1.1.0 added to Principle V
 * after v0.1 shipped that exact unenforceable requirement.
 *
 * Given valid UTF-8 bytes, both produce identical trees, spans included
 * (v0.2 FR-004) — mechanically true, not just in intent: `parse` decodes and
 * then calls the same underlying function `parseText` calls.
 */

import { parseYaml, parseYamlBytes } from "./adapters/yaml/parse.js";
import type { ParseLimits } from "./adapters/yaml/limits.js";
import type { Diagnostic } from "./diagnostics/diagnostic.js";
import type { Node } from "./model/node.js";
import { freeze } from "./model/freeze.js";
import type { Origin } from "./model/span.js";

export type { Diagnostic, RelatedSpan } from "./diagnostics/diagnostic.js";
export type { DiagnosticCode } from "./diagnostics/codes.js";
export { nodesEqual } from "./model/equality.js";
export type { Mapping, Node, Scalar, ScalarKind, ScalarValueOf, Sequence } from "./model/node.js";
export { createOrigin, createSourceSpan } from "./model/span.js";
export type { Origin, SourceSpan } from "./model/span.js";
export type { ParseLimits } from "./adapters/yaml/limits.js";

/** The result of one `parse()`/`parseText()` call. Never both a tree and diagnostics. */
export type ParseResult = { readonly ok: true; readonly tree: Node } | { readonly ok: false; readonly diagnostics: Diagnostic[] };

export interface ParseOptions {
  /** Which document this text/these bytes came from. Required — see the module doc. */
  readonly origin: Origin;
  /** `maxDepth`/`maxBytes` overrides (contracts/parse-api.md's "Limits"). Absent fields use the adapter's defaults. */
  readonly limits?: Partial<ParseLimits>;
}

function requireOrigin(options: ParseOptions, fnName: string): void {
  if (options.origin === undefined || options.origin === null) {
    throw new Error(`${fnName}() requires 'origin' identifying the document this input came from`);
  }
}

/**
 * Parse a document's exact bytes into a positioned, frozen tree, or a
 * non-empty, position-ordered list of diagnostics. The primary entry
 * point (contracts/resolve-api.md) — prefer this over `parseText` unless
 * the caller genuinely only has decoded text.
 *
 * Bytes that are not valid UTF-8 (RFC 3629) are refused with a diagnostic
 * naming the offending **byte** offset (v0.2 FR-002); they are never repaired
 * into replacement characters.
 *
 * Never throws for bad *documents* — a malformed, hostile, or unportable
 * document produces `{ ok: false, diagnostics }`. Throws only for
 * programmer error: a missing `origin` is exactly that.
 */
export function parse(bytes: Uint8Array, options: ParseOptions): ParseResult {
  requireOrigin(options, "parse");
  const outcome = parseYamlBytes(bytes, options.origin, options.limits);
  if (!outcome.ok) {
    return outcome;
  }
  return { ok: true, tree: freeze(outcome.tree) };
}

/**
 * Parse a document's already-decoded text into a positioned, frozen tree,
 * or a non-empty, position-ordered list of diagnostics.
 *
 * **Cannot enforce v0.2 FR-002.** By the time a caller holds a JS string,
 * bytes that were not valid UTF-8 have already been decoded — typically
 * into U+FFFD replacement characters — and this function cannot
 * distinguish that from a document that legitimately contains U+FFFD.
 * Prefer `parse(bytes, options)` whenever the caller can supply bytes
 * instead; this function exists for callers who genuinely cannot
 * (research D8).
 *
 * Never throws for bad *documents*, for the same reason `parse` does not.
 */
export function parseText(text: string, options: ParseOptions): ParseResult {
  requireOrigin(options, "parseText");
  const outcome = parseYaml(text, options.origin, options.limits);
  if (!outcome.ok) {
    return outcome;
  }
  return { ok: true, tree: freeze(outcome.tree) };
}
