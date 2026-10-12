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
/**
 * Escape one path segment for inclusion in a pointer (RFC 6901 §4): `~`
 * first, then `/`. Order matters — reversing it would turn a literal `/`
 * in a key into `~1` and then corrupt that very escape by re-escaping its
 * `~`.
 */
export function escapePointerSegment(segment) {
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
export function unescapePointerSegment(segment) {
    return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}
/**
 * Build an RFC 6901 pointer from a sequence of path segments — mapping
 * keys as strings, sequence indices as numbers. An empty path is the root
 * pointer, `""` (RFC 6901 §5).
 */
export function pointerFromPath(path) {
    if (path.length === 0) {
        return "";
    }
    return "/" + path.map((segment) => escapePointerSegment(String(segment))).join("/");
}
/** RFC 6901 §4: an array index is `0` or digits with no leading zero. Shared by every pointer walk. */
export const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/;
/**
 * Resolve an RFC 6901 pointer against a `Node` tree. `""` selects the root.
 * Returns `undefined` when the pointer names nothing in this tree — never
 * throws for that case, since "the pointer names nothing" is an ordinary,
 * expected outcome (`why`'s `unknown-pointer`, v0.3 FR-021), not a
 * programmer error. Throws only on a malformed pointer string itself
 * (non-empty and not starting with `/`), which is a caller bug.
 */
export function resolvePointer(root, pointer) {
    if (pointer === "") {
        return root;
    }
    if (!pointer.startsWith("/")) {
        throw new Error(`Malformed JSON Pointer '${pointer}': must be empty or start with '/'`);
    }
    const segments = pointer.slice(1).split("/").map(unescapePointerSegment);
    let current = root;
    for (const segment of segments) {
        if (current === undefined) {
            return undefined;
        }
        if (current.type === "mapping") {
            current = current.entries.get(segment);
        }
        else if (current.type === "sequence") {
            // RFC 6901's array index: `0`, or digits with no leading zero (v1.12.1); `01` names no item.
            if (!ARRAY_INDEX.test(segment)) {
                return undefined;
            }
            current = current.items[Number(segment)];
        }
        else {
            return undefined;
        }
    }
    return current;
}
const indexes = new WeakMap();
let indexBuilds = 0;
/** How many pointer indexes have been built since the module loaded — the witness that asking twice builds once (v1.12 FR-004). */
export function pointerIndexBuilds() {
    return indexBuilds;
}
/**
 * One iterative walk in the order `pointersInDocument` has always answered in (sorted keys, items
 * in order). A child of a node of another document restarts at its own root, so only a child of a
 * node of the same document extends its parent's pointer.
 */
function buildPointerIndex(root) {
    indexBuilds += 1;
    const labels = new Map();
    const physicals = new Map();
    const bySpan = new Map();
    const stack = [{ node: root, pointer: "" }];
    for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
        const { node, pointer } = item;
        const id = node.span.origin.id;
        labels.set(id, node.span.origin.label);
        physicals.set(id, node.span.origin.physical ?? node.span.origin.label);
        let spans = bySpan.get(id);
        if (spans === undefined) {
            spans = new Map();
            bySpan.set(id, spans);
        }
        const key = `${node.span.start}:${node.span.end}`;
        const pointers = spans.get(key);
        if (pointers === undefined)
            spans.set(key, [pointer]);
        else
            pointers.push(pointer);
        const childPointer = (child, segment) => (child.span.origin.id === id ? `${pointer}/${segment}` : "");
        if (node.type === "mapping") {
            const children = [...node.entries];
            for (let i = children.length - 1; i >= 0; i--) {
                const entry = children[i];
                if (entry !== undefined)
                    stack.push({ node: entry[1], pointer: childPointer(entry[1], escapePointerSegment(entry[0])) });
            }
        }
        else if (node.type === "sequence") {
            for (let i = node.items.length - 1; i >= 0; i--) {
                const child = node.items[i];
                if (child !== undefined)
                    stack.push({ node: child, pointer: childPointer(child, String(i)) });
            }
        }
    }
    return { labels, physicals, bySpan };
}
function indexOf(root) {
    let index = indexes.get(root);
    if (index === undefined) {
        index = buildPointerIndex(root);
        indexes.set(root, index);
    }
    return index;
}
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
 * anchor's span (SPEC.md §4.2). The walk is done once per tree, on first use, and every
 * later call is a lookup (v1.12 FR-003: asking about every value was quadratic, issue #10).
 */
export function pointersInDocument(root, target, limit = Number.POSITIVE_INFINITY) {
    return pointersAt(root, target.origin.id, target.start, target.end).slice(0, limit);
}
/** `pointersInDocument` by origin id and bytes, for a caller asking about every graft of one location (v1.12 FR-006). */
export function pointersAt(root, originId, start, end) {
    return indexOf(root).bySpan.get(originId)?.get(`${start}:${end}`) ?? [];
}
/**
 * Every origin of a node in `root` with its label, in the order first met — so a caller can find
 * every graft of one location (a fragment's origin id is unique per graft; its label is the
 * location, v1.12 FR-006). Read from the same index as `pointersInDocument`.
 */
export function originsInTree(root) {
    return indexOf(root).labels;
}
/**
 * Every origin of a node in `root` with where its document really is (v1.13 FR-008): `origin.physical`,
 * or the label where nothing differs. Two origins with one physical path are one file, whatever they were
 * called. Read from the same index as `originsInTree`.
 */
export function physicalsInTree(root) {
    return indexOf(root).physicals;
}
/**
 * One pointer for `target`, for a caller that reports rather than acts (`why()`). When
 * copies share the span the choice is a convention, not a fact: the one equal to `hint`
 * (the merged pointer being asked about); else the first whose last segment is the
 * hint's (a fragment's pointer is not the merged one); else the first in walk order.
 * A caller that writes under the default `sharedEdits: "refuse"` must not use this: it uses `pointersInDocument`
 * and refuses copies. `editTarget` uses it under `"warn"`/`"allow"`, where answering one copy is the point (v1.12 FR-007).
 */
export function pointerInDocument(root, target, hint) {
    const candidates = pointersInDocument(root, target);
    const tail = (p) => p.slice(p.lastIndexOf("/") + 1);
    return candidates.find((p) => p === hint) ?? (hint === undefined ? undefined : candidates.find((p) => tail(p) === tail(hint))) ?? candidates[0];
}
//# sourceMappingURL=pointer.js.map