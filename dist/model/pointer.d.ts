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
export declare function escapePointerSegment(segment: string): string;
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
export declare function unescapePointerSegment(segment: string): string;
/**
 * Build an RFC 6901 pointer from a sequence of path segments — mapping
 * keys as strings, sequence indices as numbers. An empty path is the root
 * pointer, `""` (RFC 6901 §5).
 */
export declare function pointerFromPath(path: readonly (string | number)[]): string;
/**
 * Resolve an RFC 6901 pointer against a `Node` tree. `""` selects the root.
 * Returns `undefined` when the pointer names nothing in this tree — never
 * throws for that case, since "the pointer names nothing" is an ordinary,
 * expected outcome (`why`'s `unknown-pointer`, v0.3 FR-021), not a
 * programmer error. Throws only on a malformed pointer string itself
 * (non-empty and not starting with `/`), which is a caller bug.
 */
export declare function resolvePointer(root: Node, pointer: string): Node | undefined;
/**
 * Every pointer, inside its own document, of a node in `root` whose span is `target`
 * (same origin id, same bytes), in walk order (sorted keys, items in order) — at most
 * `limit` of them (v1.11 FR-001).
 *
 * `root` is a layer's whole tree, which holds the nodes of any fragment grafted into it
 * (v0.6): a fragment's nodes carry their own origin, and their pointer restarts at the
 * fragment's root, so the answers are pointers in the document that wrote the value —
 * never in `root`. They are derived by walking the tree, not by trimming a pointer into
 * the merged result.
 *
 * More than one means copies: an alias or a merge key expands to a node that keeps the
 * anchor's span (SPEC.md §4.2). The walk is iterative and visits each node once.
 */
export declare function pointersInDocument(root: Node, target: SourceSpan, limit?: number): string[];
/**
 * One pointer for `target`, for a caller that reports rather than acts (`why()`). When
 * copies share the span the choice is a convention, not a fact: the one equal to `hint`
 * (the merged pointer being asked about); else the first whose last segment is the
 * hint's (a fragment's pointer is not the merged one); else the first in walk order.
 * A caller that writes must not use this: it uses `pointersInDocument` and refuses copies.
 */
export declare function pointerInDocument(root: Node, target: SourceSpan, hint?: string): string | undefined;
//# sourceMappingURL=pointer.d.ts.map