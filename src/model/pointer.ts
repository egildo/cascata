/**
 * RFC 6901 JSON Pointers — SPEC.md §10 ("Machine-readable error output uses
 * RFC 6901 pointers throughout — do not invent a path syntax"), research D2,
 * tasks.md T003/T004.
 *
 * **Promoted, not written**: escaping, unescaping, and resolution already
 * existed in `tests/corpus/runner.ts`, correct including the unescape
 * ordering the v0.3 probe re-verified (`~01` must decode to `~1`, not `/`).
 * That module now imports from here rather than keeping its own copy —
 * writing a second implementation would repeat exactly the defect commit
 * `f9aa900` was spent undoing for `Reference` and `DocumentIdentity` (two
 * structurally identical shapes with no single source of truth).
 *
 * `pointerFromPath` (generation — a node path to its pointer) is new: only
 * resolution existed before, because only tests needed a pointer *in*.
 * Provenance (v0.3) is keyed by pointer, so `src/merge/` needs one *out*.
 *
 * This module is format-blind (Principle IV): it imports only `./node.js`
 * and knows nothing about YAML, schemas, or merge policy.
 */

import type { Node } from "./node.js";
import type { SourceSpan } from "./span.js";

/**
 * Escape one path segment for inclusion in a pointer (RFC 6901 §4): `~`
 * first, then `/`. Order matters — reversing it would turn a literal `/`
 * in a key into `~1` and then corrupt that very escape by re-escaping its
 * `~`.
 */
export function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Unescape one pointer segment (RFC 6901 §4): `~1` **before** `~0`. This
 * order is load-bearing, not arbitrary — reversing it corrupts a literal
 * `~1` written by a key that itself contained a tilde: `~01` must decode to
 * `~1` (the key `~1`, i.e. one literal tilde followed by the digit 1... no —
 * concretely, escaping the key `~1` produces `~01` per `escapePointerSegment`
 * above (`~` → `~0`, then that value has no more `/`), so unescaping `~01`
 * must recover `~1`. Doing `~0`→`~` first would instead turn `~01` into
 * `~1` and then (wrongly) into `/` on a second pass — RFC 6901 forbids a
 * second pass for exactly this reason. This ordering was re-verified by the
 * v0.3 probe (research.md) and is covered by `tests/unit/pointer.test.ts`.
 */
export function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

/**
 * Build an RFC 6901 pointer from a sequence of path segments — mapping
 * keys as strings, sequence indices as numbers. An empty path is the root
 * pointer, `""` (RFC 6901 §5).
 */
export function pointerFromPath(path: readonly (string | number)[]): string {
  if (path.length === 0) {
    return "";
  }
  return "/" + path.map((segment) => escapePointerSegment(String(segment))).join("/");
}

/**
 * Resolve an RFC 6901 pointer against a `Node` tree. `""` selects the root.
 * Returns `undefined` when the pointer names nothing in this tree — never
 * throws for that case, since "the pointer names nothing" is an ordinary,
 * expected outcome (`why`'s `unknown-pointer`, v0.3 FR-021), not a
 * programmer error. Throws only on a malformed pointer string itself
 * (non-empty and not starting with `/`), which is a caller bug.
 */
export function resolvePointer(root: Node, pointer: string): Node | undefined {
  if (pointer === "") {
    return root;
  }
  if (!pointer.startsWith("/")) {
    throw new Error(`Malformed JSON Pointer '${pointer}': must be empty or start with '/'`);
  }
  const segments = pointer.slice(1).split("/").map(unescapePointerSegment);

  let current: Node | undefined = root;
  for (const segment of segments) {
    if (current === undefined) {
      return undefined;
    }
    if (current.type === "mapping") {
      current = current.entries.get(segment);
    } else if (current.type === "sequence") {
      if (!/^\d+$/.test(segment)) {
        return undefined;
      }
      current = current.items[Number(segment)];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * The pointer, inside its own document, of the node in `root` whose span is `target`
 * (same origin id, same bytes) — or `undefined` when no node has it (v1.11 FR-001).
 *
 * `root` is a layer's whole tree, which holds the nodes of any fragment grafted into it
 * (v0.6): a fragment's nodes carry their own origin, and their pointer restarts at the
 * fragment's root, so the answer is the pointer in the document that wrote the value —
 * never the pointer in `root`. It is derived by walking the tree, not by trimming a
 * pointer into the merged result.
 *
 * Several nodes can share one span: an alias or a merge key expands to a copy that
 * keeps the anchor's span (SPEC.md §4.2). Among equal spans, the one whose pointer is
 * `hint` is chosen, and otherwise the first in walk order (sorted keys, items in order).
 * The walk is iterative and visits each node once.
 */
export function pointerInDocument(root: Node, target: SourceSpan, hint?: string): string | undefined {
  const id = target.origin.id;
  let first: string | undefined;
  const stack: { readonly node: Node; readonly pointer: string }[] = [{ node: root, pointer: "" }];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { node, pointer } = item;
    const own = node.span.origin.id === id;
    if (own && node.span.start === target.start && node.span.end === target.end) {
      if (pointer === hint) return pointer;
      first ??= pointer;
    }
    // A child of a node of another document restarts at its own root, so only a node of this document extends the pointer.
    const children: { readonly node: Node; readonly pointer: string }[] = [];
    if (node.type === "mapping") {
      for (const [key, child] of node.entries) children.push({ node: child, pointer: own ? `${pointer}/${escapePointerSegment(key)}` : "" });
    } else if (node.type === "sequence") {
      node.items.forEach((child, index) => children.push({ node: child, pointer: own ? `${pointer}/${index}` : "" }));
    }
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child !== undefined) stack.push(child);
    }
  }
  return first;
}
