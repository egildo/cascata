/**
 * Entities for the fold — data-model.md "Layer", "Merge Strategy",
 * "Provenance Entry", "Provenance Record", "Merged Configuration"; tasks.md
 * T007 (Foundational), T044–T049 (Phase 5, User Story 3).
 *
 * **`Layer.tree` is not in data-model.md's own field table.** That table
 * lists only `identity`, `role`, and `rank` — but the fold cannot merge
 * anything without each layer's actual parsed tree, and `Pedigree`
 * (v0.2, `src/graph/pedigree.ts`) deliberately omits it (a `PedigreeEntry`
 * carries only `identity`, `via`, and `verified`). This is resolved
 * pragmatically by carrying `tree` on `Layer` too; see the milestone report.
 *
 * ## Building the record during the fold (T044, FR-017, FR-022)
 *
 * `createProvenanceBuilder()` is the mechanism `src/merge/fold.ts` calls
 * into, at every merge decision, to keep the provenance record and the
 * merged tree growing together — never by inspecting a finished tree
 * afterward. That distinction is not cosmetic: an **overridden**
 * contribution is gone from the tree the instant a nearer layer replaces
 * it, so anything built by walking the *result* can only ever see winners.
 * §10's "nearly impossible to retrofit" is exactly this — see the
 * milestone report for the sabotage run that confirms it (T039 is the
 * guard: a rebuild-from-the-result implementation passes every other case
 * here and fails only that one).
 *
 * The builder records at exactly the granularity the fold's own recursion
 * visits: every **mapping key** pointer, arbitrarily deep through nested
 * mappings — never inside a sequence's items, which the fold itself never
 * addresses individually (`cascade: append` accumulates a whole layer's
 * sequence at once, never element by element; an ordinary `replace`
 * replaces a sequence wholesale). This module's own granularity guarantee
 * (every mapping key the fold visits gets an entry) is exactly SC-002's
 * "100% of values in a merged result have a provenance chain" — for every
 * position *this* granularity covers. A pointer that reaches inside a
 * sequence (a numeric index segment) resolves in the tree but was never
 * recorded directly; `why()` answers it by walking up to the nearest
 * ancestor pointer that *was* recorded (the containing sequence's own
 * pointer, at the latest) — see `why()`'s own doc comment. This still
 * resolves every such pointer to `chain` or `synthesized`, never
 * `unknown-pointer`, which `tests/unit/provenance-consistency.test.ts`
 * (T048) checks by walking real merged trees exhaustively, sequence items
 * included.
 *
 * ## Ordering (FR-019, FR-020) — built chronologically, presented winner-first
 *
 * Every array in the builder's internal map is appended to, root layer to
 * leaf layer, in exactly the order `fold()` itself processes layers —
 * never `unshift`. That single, uniform rule handles both of §5.2's
 * shapes at once:
 *
 * - A **replace**-terminated chain (its last-pushed entry is `"won"`) is
 *   *presented* winner-first: `finish()` reverses exactly those chains
 *   once, at the very end, into the order data-model.md specifies. Every
 *   entry an earlier layer contributed and later lost stays in the chain
 *   as `"overridden"` (FR-022) — including one that agreed byte-for-byte
 *   with the layer that displaced it (T043: agreement is not silence,
 *   because nothing here ever skips recording on value equality).
 * - An **append**-terminated chain (its last-pushed entry is
 *   `"accumulated"`) is left exactly as built: root-first, matching the
 *   physical order of the accumulated sequence itself, and matching
 *   FR-020's "no winner" — there is nothing to front-load. The one entry
 *   that was `"won"` before the strategy tightened to `append` (T034,
 *   v0.3 FR-026: a strategy governs from its declaring layer downward, so
 *   whatever the fold had already produced up to that point is exactly
 *   what accumulation onto it began with) is relabelled `"accumulated"`
 *   the moment accumulation starts, since that value's items are now
 *   genuinely part of the accumulated whole rather than a displaced
 *   single winner (T046).
 *
 * ## `synthesized` (v0.3 FR-021, T042)
 *
 * A mapping pointer that **≥2 distinct layers each independently
 * contributed a mapping to** — deep merge actually combined them, whether
 * or not their keys overlapped — never gets an entry of its own at all:
 * `recordSynthesized` deletes one if an earlier, single-layer contribution
 * had put one there. `why()` treats a resolvable mapping pointer with no
 * stored chain as exactly this case, and computes `contributors` by
 * reading each *direct child's own* winning entry (recursing through a
 * child that is itself synthesized) rather than storing a second, parallel
 * structure — the merged tree's own shape *is* the list of "descendants
 * that were supplied" FR-021 describes.
 *
 * This is a **judgment call** the contract and data-model.md do not fully
 * settle, and the milestone report says so plainly: nothing in this
 * engine's mechanics can produce a mapping pointer that literally no
 * layer ever wrote *at all* — every mapping-vs-mapping recursion point
 * exists in that shape in both contributing layers' own raw trees, by
 * construction (deep merge only recurses where both sides already are
 * mappings). "No layer wrote it" is read here as "no *single* layer wrote
 * what is actually there" — contrasted, in the contract's own words, with
 * "a container **one** layer wrote, which answers with a chain". Under
 * that reading `synthesized` is genuinely reachable (T042's own
 * obligation), and a single-contributor mapping — including one that
 * later got wholesale-replaced by a different single contributor —
 * answers as an ordinary chain, exactly like a scalar.
 */
import { escapePointerSegment, pointerFromPath, pointerInDocument, resolvePointer } from "../model/pointer.js";
/** Append `entry` to `pointer`'s chain, demoting whatever was previously last (if anything, and if it was `"won"`) to `outcome`. Shared by `recordReplacement` (demotes to `"overridden"`) and `recordAccumulation` (demotes to `"accumulated"`) — the only difference between an ordinary replace and an append transition, provenance-wise, is what the *previous* winner becomes once it stops being the sole answer. */
function appendDemoting(record, pointer, entry, demoteTo) {
    const existing = record.get(pointer);
    if (existing === undefined) {
        record.set(pointer, [entry]);
        return;
    }
    const last = existing[existing.length - 1];
    if (last !== undefined && last.outcome === "won") {
        existing[existing.length - 1] = { ...last, outcome: demoteTo };
    }
    existing.push(entry);
}
/** Construct a fresh `ProvenanceBuilder` — one per `fold()` call, never shared or reused across calls (its internal map is mutated in place as the fold proceeds). */
export function createProvenanceBuilder() {
    const record = new Map();
    function recordFreshContribution(path, node, layer) {
        const pointer = pointerFromPath(path);
        record.set(pointer, [{ layer, span: node.span, outcome: "won" }]);
        if (node.type === "mapping") {
            for (const [key, child] of node.entries) {
                recordFreshContribution([...path, key], child, layer);
            }
        }
    }
    function purgeDescendants(path) {
        const prefix = `${pointerFromPath(path)}/`;
        for (const key of record.keys()) {
            if (key.startsWith(prefix)) {
                record.delete(key);
            }
        }
    }
    function recordReplacement(path, discarded, winner, layer) {
        const pointer = pointerFromPath(path);
        appendDemoting(record, pointer, { layer, span: winner.span, outcome: "won" }, "overridden");
        if (discarded !== undefined && discarded.type === "mapping") {
            purgeDescendants(path);
        }
        if (winner.type === "mapping") {
            for (const [key, child] of winner.entries) {
                recordFreshContribution([...path, key], child, layer);
            }
        }
    }
    function recordAccumulation(path, span, layer) {
        appendDemoting(record, pointerFromPath(path), { layer, span, outcome: "accumulated" }, "accumulated");
    }
    function recordSynthesized(path) {
        record.delete(pointerFromPath(path));
    }
    function finish() {
        const result = new Map();
        for (const [pointer, entries] of record) {
            const last = entries[entries.length - 1];
            const ordered = last !== undefined && last.outcome === "won" ? [...entries].reverse() : entries;
            result.set(pointer, ordered);
        }
        return result;
    }
    return { recordFreshContribution, recordReplacement, recordAccumulation, recordSynthesized, finish };
}
/** Build `parentPointer`'s child pointer for `key` without re-parsing `parentPointer` — the inverse of `resolvePointer`'s own per-segment walk, needed here because `why()` walks the merged **tree**, not a path array, once it starts computing `synthesized` contributors. */
function childPointer(parentPointer, key) {
    return `${parentPointer}/${escapePointerSegment(key)}`;
}
/**
 * Contributors of a `synthesized` container (FR-021, T042): for each
 * direct child key, the winning entry of that child's own chain if it has
 * one, or — if the child is itself `synthesized` (no chain of its own) —
 * that child's own contributors, recursively. Deduplicated by layer
 * (`Map` keyed on the `Layer` object itself — the same instances are
 * threaded through the whole fold, so reference equality is exact
 * identity here), in the order each layer is first encountered walking
 * the container's own canonically-ordered keys.
 */
function synthesizedContributors(record, containerPointer, container) {
    const byLayer = new Map();
    for (const [key, child] of container.entries) {
        const pointer = childPointer(containerPointer, key);
        const chain = record.get(pointer);
        if (chain !== undefined && chain.length > 0) {
            const winner = chain[0];
            if (winner !== undefined && !byLayer.has(winner.layer)) {
                byLayer.set(winner.layer, [winner, pointer]);
            }
        }
        else if (child.type === "mapping") {
            for (const contributor of synthesizedContributors(record, pointer, child)) {
                if (!byLayer.has(contributor[0].layer)) {
                    byLayer.set(contributor[0].layer, contributor);
                }
            }
        }
        // A child that is neither chained nor a mapping "shouldn't" happen —
        // this builder's own recording discipline gives every leaf an entry —
        // but `why()` must never throw for a pointer that resolves, so this is
        // silently skipped rather than asserted, same posture `resolvePointer`
        // takes for a pointer that resolves to nothing.
    }
    return [...byLayer.values()];
}
/**
 * `pointer` with its last segment dropped — `"/items/0"` → `"/items"`,
 * `"/items"` → `""` (the root). Safe to compute by string surgery alone:
 * RFC 6901 segments are separated by literal, unescaped `/` characters
 * (a literal `/` *inside* a key is always `~1`, never a bare `/` —
 * `src/model/pointer.ts`'s own escaping guarantees that), so the last
 * unescaped `/` in the string is always a genuine segment boundary.
 */
function ancestorPointer(pointer) {
    return pointer.slice(0, pointer.lastIndexOf("/"));
}
/**
 * Answer where `pointer`'s value in `configuration.tree` came from — the
 * `git config --show-origin` question (SPEC.md §10). A library function in
 * v0.3 (research D3); no CLI ships here.
 */
/** v0.6 FR-020: attach `entry`'s own delegation breadcrumb, if `configuration.delegationBreadcrumbs` has one for `entry.span.origin.id` — a plain lookup, never a fold-time decision (`why()`'s own doc, `ProvenanceEntry.delegatedFrom`'s own doc). */
function withBreadcrumb(configuration, entry) {
    const breadcrumb = configuration.delegationBreadcrumbs.get(entry.span.origin.id);
    return breadcrumb === undefined ? entry : { ...entry, delegatedFrom: breadcrumb };
}
/**
 * v1.11 FR-001: `entry`'s value's pointer inside its own document, from that document's own
 * tree. `mergedPointer` is only the tie-break between nodes that share a span (aliases, merge
 * keys); the fallback to it, for an entry whose span the layer's tree does not hold, is
 * defensive — the fold records spans of the nodes of `layer.tree`, so it is not reachable.
 */
function withPointer(entry, mergedPointer) {
    // `?? mergedPointer` is a guard, kept on purpose (v1.12 FR-012): unreachable, because every entry's span is
    // the span of a node of its own layer's tree (the fold records the node it was handed), so the index always
    // finds at least one pointer; were that ever false, the merged pointer is the least wrong answer.
    return { ...entry, pointer: pointerInDocument(entry.layer.tree, entry.span, mergedPointer) ?? mergedPointer };
}
export function why(configuration, pointer) {
    const node = resolvePointer(configuration.tree, pointer);
    if (node === undefined) {
        return { kind: "unknown-pointer" };
    }
    const chain = configuration.provenance.get(pointer);
    if (chain !== undefined) {
        return { kind: "chain", entries: chain.map((entry) => withPointer(withBreadcrumb(configuration, entry), pointer)) };
    }
    if (node.type === "mapping") {
        const contributors = synthesizedContributors(configuration.provenance, pointer, node).map(([entry, entryPointer]) => withPointer(withBreadcrumb(configuration, entry), entryPointer));
        return { kind: "synthesized", contributors };
    }
    // `pointer` resolves, but to a position this module's own recording
    // never addresses directly: the builder records at mapping-key
    // granularity only (this file's module doc) — a scalar or mapping
    // sitting *inside* a sequence's own items (a numeric index segment) has
    // no entry of its own, because `replace`/`append` both apply to the
    // whole sequence at once, never to one item individually. The nearest
    // ancestor pointer that DOES have an entry — the containing sequence's
    // own pointer, or a mapping key further up — answers "why is this item
    // here" faithfully: an item exists because the sequence it lives in won
    // or accumulated, never for a reason of its own. This recursion always
    // terminates: `recordSynthesized` (the only way a chain goes missing)
    // fires only for a mapping, so a non-mapping ancestor always has a
    // direct chain, and the walk toward `""` (the root) can shrink at most
    // as many times as `pointer` has segments.
    return why(configuration, ancestorPointer(pointer));
}
//# sourceMappingURL=provenance.js.map