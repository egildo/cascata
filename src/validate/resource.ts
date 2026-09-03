/**
 * `resource` resolution — SPEC.md §7 ("Path relativity: resolved relative
 * to the declaring file's directory"), §16, §8.1's razor; v0.7 FR-035
 * through FR-039; specs/007-sealing-and-embedding/research.md D6.
 *
 * `resource(configuration, pointer)` reports where a `path`/`url` value
 * *denotes*, resolved against the directory of the document that
 * **declared** the value (FR-035) — never the entry document's directory
 * and never the demanding schema's. A query, not a check: it can never
 * fail a `load()` call, produces no diagnostic of any level, and never
 * refuses a location outside the sandbox root (FR-038 — "a resource is
 * data about a file, never an instruction to load one", §8.1's razor
 * read from the other side).
 *
 * **Purely lexical** (FR-039): nothing is read, existence is never
 * checked. This is what makes it possible to answer with no `Host` in
 * scope at all — `resource` needs only the already-merged tree and pure
 * string algebra (`node:path` for a local declaring document, WHATWG
 * `URL` for a remote one — see the Edge Case below; the identical
 * posture `src/resolve/location.ts` already holds for lexical
 * resolution — neither is I/O, and neither is one of the two primitives
 * `tests/unit/layering.test.ts`'s host-boundary sweep polices).
 *
 * **Edge Case: the declaring document was itself reached over
 * `https://`.** `dirname()` on a URL string and `path.resolve()`'s own
 * "the first argument that is not absolute is joined against
 * `process.cwd()`" rule combine to silently corrupt a relative path
 * resolved against a remote base — verified, not assumed, by trying it:
 * `path.resolve("https://example.com", "./x")` does **not** produce
 * `"https://example.com/x"`. A declaring document whose own location
 * matches the HTTPS pattern is therefore resolved with WHATWG `URL`'s
 * own relative-resolution instead — the identical fork
 * `src/resolve/location.ts`'s `classifyReferenceLocation` already makes
 * for the same reason, applied here to `resource` values rather than
 * `$adopts`/`$schema` references. The `kind` reported is still `"path"`
 * (the *value itself* was written as relative text, not as a URL — only
 * how it resolves differs), even though the resolved `location` is
 * itself a URL string in this case.
 *
 * **Why `span.origin.id` alone is sufficient, delegation included**
 * (FR-037): every span's `origin.id` is already the exact location
 * string of the document that produced that node — the entry document's
 * own absolute path, a schema's own location, or (v0.6) a delegated
 * fragment's own per-graft synthetic id
 * (`"<fragment-location> #graft=<n>"`, `src/index.ts`'s `performGraft`).
 * `path.dirname` on that synthetic string still yields the fragment's
 * real directory: the `" #graft=<n>"` suffix contains no path separator,
 * so the last `/` in the string is still the one separating the
 * fragment's real directory from its real filename. No new provenance
 * field was needed to make this true — the span already carried what
 * this function needs, the same property `src/validate/check.ts`'s
 * `layerForSpanOrigin` already exploits for a different purpose.
 */

import type { MergedConfiguration } from "../merge/provenance.js";
import { posixPaths } from "../paths.js";
import { resolvePointer } from "../model/pointer.js";
import { isValidPath, isValidUrl } from "./check.js";

export type ResolvedResource =
  | { readonly kind: "url"; readonly location: string }
  | { readonly kind: "path"; readonly location: string }
  | { readonly kind: "not-a-resource" }
  | { readonly kind: "unknown-pointer" };

/** Whether `location` (already resolved — a declaring document's own `span.origin.id`) is itself an `https://` location — the identical predicate `src/resolve/location.ts` uses to decide whether a *reference* resolves against a remote base; reused here for the identical reason, applied to `resource` values. */
const HTTPS_LOCATION_PATTERN = /^https:\/\//i;

/**
 * Resolve the value at `pointer` in `configuration.tree` as a `resource`
 * (FR-035 through FR-039):
 *
 * 1. `pointer` names nothing in the tree → `unknown-pointer` (mirrors
 *    `why()`'s own outcome for the identical case).
 * 2. Not a string scalar → `not-a-resource`.
 * 3. Parses as an absolute URL (`url`'s own built-in-type predicate,
 *    `isValidUrl` — WHATWG `URL`) → resolves to itself (FR-036).
 * 4. A `path`-shaped string (`path`'s own predicate, `isValidPath`) →
 *    resolved against `dirname(node.span.origin.id)` — using the path
 *    facility the resolution recorded on the configuration (v1.5, issue
 *    #1: `dirname` is a platform fact, and importing `node:path` here is
 *    what stopped the library loading in a browser realm) — the directory of
 *    the document that declared *this value*, never the entry document's
 *    (FR-035) and never confined to the sandbox root (FR-038).
 * 5. Neither shape → `not-a-resource`.
 */
export function resource(configuration: MergedConfiguration, pointer: string): ResolvedResource {
  const node = resolvePointer(configuration.tree, pointer);
  if (node === undefined) {
    return { kind: "unknown-pointer" };
  }
  if (node.type !== "scalar" || node.kind !== "string") {
    return { kind: "not-a-resource" };
  }
  if (isValidUrl(node.value)) {
    return { kind: "url", location: node.value };
  }
  if (isValidPath(node.value)) {
    const declaringDocument = node.span.origin.id;
    const paths = configuration.paths ?? posixPaths;
    const location = HTTPS_LOCATION_PATTERN.test(declaringDocument) ? new URL(node.value, declaringDocument).toString() : paths.resolve(paths.dirname(declaringDocument), node.value);
    return { kind: "path", location };
  }
  return { kind: "not-a-resource" };
}
