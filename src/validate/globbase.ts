/**
 * `globBase` -- the base query for a `glob` value, beside `resource()` (SPEC.md §7, v1.14 FR-007).
 *
 * A **query, not a check**: no diagnostic at any level, no host, nothing read or confined (FR-005). It answers where a
 * pattern is anchored: the directory of the document that declared the value, joined with the pattern's literal prefix, by
 * the same medium rule `resource()` follows (v1.13: a file's logical directory, a remote document's physical URL, with
 * `otherDirectory` where the other rule would anchor it elsewhere). `expand()` starts its walk from `directory`.
 */

import type { MergedConfiguration } from "../merge/provenance.js";
import { resolvePointer } from "../model/pointer.js";
import type { SourceSpan } from "../model/span.js";
import { checkGlobPattern, splitGlob } from "./glob.js";
import { locateFromDocument } from "./resource.js";

export type GlobBase =
  | {
      readonly kind: "glob";
      /** The pattern, exactly as written. */
      readonly pattern: string;
      /** The segments before the first one containing a wildcard, joined by `/` (a leading `/` kept; `""` when there are none and the pattern is relative). For a pattern with no wildcard, all but its last segment. */
      readonly literalPrefix: string;
      /** The declaring document's directory joined with the literal prefix. */
      readonly directory: string;
      /** Present only when the declaring document is behind a link or a redirect and the other rule would anchor the pattern in a lexically different directory (as `resource()`'s `otherLocation`). */
      readonly otherDirectory?: string;
      /** The value's own span. */
      readonly span: SourceSpan;
    }
  | { readonly kind: "not-a-glob" }
  | { readonly kind: "unknown-pointer" };

/** Where the `glob` value at `pointer` is anchored. `not-a-glob` for anything that is not a string the grammar accepts. */
export function globBase(configuration: MergedConfiguration, pointer: string): GlobBase {
  const node = resolvePointer(configuration.tree, pointer);
  if (node === undefined) {
    return { kind: "unknown-pointer" };
  }
  if (node.type !== "scalar" || node.kind !== "string" || !checkGlobPattern(node.value).ok) {
    return { kind: "not-a-glob" };
  }
  const { absolute, literal } = splitGlob(node.value);
  const literalPrefix = `${absolute ? "/" : ""}${literal.join("/")}`;
  const where = locateFromDocument(configuration, node.span.origin, literalPrefix, true);
  return {
    kind: "glob",
    pattern: node.value,
    literalPrefix,
    directory: where.location,
    ...(where.otherLocation === undefined ? {} : { otherDirectory: where.otherLocation }),
    span: node.span,
  };
}
