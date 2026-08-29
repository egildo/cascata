/**
 * Public surface — contracts/parse-api.md, FR-025, FR-026, FR-014.
 *
 * One entry point. It accepts a document's text and the identity of where
 * that text came from, and returns either a positioned, frozen tree or a
 * non-empty list of diagnostics — never both, never a partial tree
 * (research D5).
 *
 * `limits` (`maxDepth`/`maxBytes`, per the contract) is deliberately not
 * part of `ParseOptions` yet: enforcing them is Phase 4 work (T046, in
 * `src/adapters/yaml/limits.ts`), and adding an option nothing reads would
 * be untested, dead surface. Adding it is a purely additive, non-breaking
 * change when Phase 4 lands it. See the Phase 3 report.
 */

import { parseYaml } from "./adapters/yaml/parse.js";
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

/** The result of one `parse()` call. Never both a tree and diagnostics. */
export type ParseResult = { readonly ok: true; readonly tree: Node } | { readonly ok: false; readonly diagnostics: Diagnostic[] };

export interface ParseOptions {
  /** Which document this text came from. Required — see the module doc. */
  readonly origin: Origin;
}

/**
 * Parse a document's text into a positioned, frozen tree, or a non-empty,
 * position-ordered list of diagnostics.
 *
 * Never throws for bad *documents* — a malformed, hostile, or unportable
 * document produces `{ ok: false, diagnostics }`. Throws only for
 * programmer error: a missing `origin` is exactly that (contracts/
 * parse-api.md point 1).
 */
export function parse(text: string, options: ParseOptions): ParseResult {
  if (options.origin === undefined || options.origin === null) {
    throw new Error("parse() requires 'origin' identifying the document this text came from");
  }
  const outcome = parseYaml(text, options.origin);
  if (!outcome.ok) {
    return outcome;
  }
  return { ok: true, tree: freeze(outcome.tree) };
}
