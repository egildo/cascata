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

import { escapePointerSegment, pointerFromPath, resolvePointer } from "../model/pointer.js";
import type { Mapping, Node } from "../model/node.js";
import type { DocumentIdentity } from "../model/identity.js";
import type { SourceSpan } from "../model/span.js";
import type { Pedigree } from "../graph/pedigree.js";
import type { DelegationHop } from "../model/reference.js";
import type { KeyFinalState } from "./final.js";

/**
 * One document participating in the fold, with its place in precedence
 * order (data-model.md "Layer", contracts/precedence.md rule 1).
 */
export interface Layer {
  /** Which document — v0.2's `DocumentIdentity`. */
  readonly identity: DocumentIdentity;
  /** `schema` (from the pedigree) or `config` (the entry document). */
  readonly role: "schema" | "config";
  /** Position in precedence order: 0 is the root schema; highest is the config. Dense, total, never assigned ad hoc. */
  readonly rank: number;
  /** This layer's own parsed tree — see this file's module doc for why it is here despite data-model.md's table omitting it. */
  readonly tree: Node;
}

/** `replace` or `append`, declared per key by a schema (SPEC.md §5.3, data-model.md "Merge Strategy"). `merge-by-key` is reserved and refused as unimplemented (v0.3 FR-014) — not a member of this type, since this milestone does not build it. */
export type MergeStrategy = "replace" | "append";

/**
 * One layer's contribution to one pointer (data-model.md "Provenance
 * Entry"). `overridden` is the entry that cannot be reconstructed after
 * the fold finishes — the losing value is gone from the merged tree, and
 * nothing downstream can recover it (FR-022).
 */
export interface ProvenanceEntry {
  readonly layer: Layer;
  /** Where in that layer's real document — so an author can open the file and see the line (FR-018). */
  readonly span: SourceSpan;
  readonly outcome: "won" | "overridden" | "accumulated";
  /**
   * v0.6 FR-020: the delegation chain that reached `span`, if any —
   * **absent** for a value that was never delegated. Never set by the
   * fold itself (which does not know `delegate` exists, v0.6 FR-008a) —
   * `why()` below attaches it lazily, at answer time, by checking
   * `configuration.delegationBreadcrumbs` against `span.origin.id`. A
   * stored `ProvenanceRecord` entry therefore never carries this field;
   * only `why()`'s own returned entries do.
   */
  readonly delegatedFrom?: readonly DelegationHop[];
}

/**
 * RFC 6901 pointer → ordered chain of entries, winner first (data-model.md
 * "Provenance Record"). Built during the fold (T044) by
 * `createProvenanceBuilder()`, below.
 *
 * **Not every resolvable pointer has an entry here** — a mapping pointer
 * `why()` answers `synthesized` for (this file's module doc) deliberately
 * has none. `tests/unit/provenance-consistency.test.ts` (T048) is what
 * keeps the two structures honest: it asserts against `why()`'s own
 * chain-or-synthesized-vs-unknown-pointer distinction, which is the real
 * invariant research D1 accepted the risk of losing — not against this raw
 * map's own key set, which by design does not cover every resolvable
 * pointer.
 */
export type ProvenanceRecord = ReadonlyMap<string, readonly ProvenanceEntry[]>;

/**
 * The folded tree plus its provenance record plus the pedigree it was
 * bound by (data-model.md "Merged Configuration").
 */
export interface MergedConfiguration {
  /** The folded `Node` tree — frozen, canonically ordered, every node positioned. */
  readonly tree: Node;
  readonly provenance: ProvenanceRecord;
  /** Carried through from v0.2, so a consumer can still ask what it is bound by. */
  readonly pedigree: Pedigree;
  /**
   * **v0.4 additive field** (specs/004-constraint-checker/data-model.md
   * "MergedConfiguration — additive field"). Root-to-leaf, exactly what
   * `foldConfiguration` (`src/merge/fold.ts`) already computes internally
   * via `deriveLayers(graph)` — stashed onto the result rather than
   * recomputed, so `validate()` can read each schema layer's own `tree`
   * (where `demand` lives) while still consuming only the previous
   * stage's output (Principle IV), with no `Graph` passed alongside.
   */
  readonly layers: readonly Layer[];
  /**
   * **v0.6 additive field** — every value reached through delegation, at
   * any hop depth, keyed by its own node's synthesized per-graft
   * `Origin.id` (research.md D3/D4). A value's origin never matches any
   * `Layer.identity.location` when it does (fragments are not layers,
   * v0.6 FR-010); `src/validate/check.ts`'s `layerForSpanOrigin` checks
   * this map as its fallback, attributing the value to the config layer
   * and carrying the breadcrumb on every diagnostic built from it.
   */
  readonly delegationBreadcrumbs: ReadonlyMap<string, readonly DelegationHop[]>;
  /**
   * **v0.7 additive field** — the whole-stack `final` resolution
   * (`src/merge/final.ts`'s `resolveFinal`, SPEC.md §6.3), keyed by RFC
   * 6901 pointer path (top-level or nested). `src/validate/check.ts`
   * consumes this to refuse a config setting a `final`+`provide` key —
   * a check that needs the **merged** tree, so it cannot run inside
   * `resolveFinal` itself (which only ever sees schema trees). `seal`
   * (v0.7, moved into the `demand` vocabulary — see
   * `src/validate/vocabulary.ts`'s own doc) needs no equivalent
   * whole-stack field: it is checked per-layer, per-position, entirely
   * within `src/validate/check.ts`'s existing demand walk.
   */
  readonly finalState: ReadonlyMap<string, KeyFinalState>;
}

// --- Building the record during the fold — User Story 3 (T044–T046) -------

/**
 * `src/merge/fold.ts`'s own interface into this file — every hook the
 * fold's recursive merge needs, called at the exact moment each merge
 * decision is made (this file's module doc explains why "during", not
 * "after", is load-bearing here, not a style preference).
 */
export interface ProvenanceBuilder {
  /**
   * The very first time any layer contributes at `path` — either the
   * fold's first layer overall, or a key no earlier layer touched. Records
   * a single-layer chain (`"won"`, T044/FR-017) at `path` itself and, if
   * `node` is a mapping, recursively at every descendant key too (SC-002:
   * every value in the tree ends up with a chain, not only the ones later
   * merge steps happen to touch again).
   */
  recordFreshContribution(path: readonly string[], node: Node, layer: Layer): void;
  /**
   * `winner` replaces whatever was at `path` wholesale (not a deep merge —
   * `fold.ts`'s rule 3): demotes the existing entry there to `"overridden"`
   * (FR-022) and records `winner` as the new `"won"` entry. If the
   * discarded value (`discarded`) was itself a mapping, every one of its
   * descendant pointers stops resolving in the tree, so their entries are
   * purged (research D1 / T048: a pointer with an entry here but nothing
   * at that position in the tree is exactly the disagreement that
   * invariant exists to catch). If `winner` is itself a mapping, its own
   * descendants are fresh contributions, recorded the same way
   * `recordFreshContribution` would.
   */
  recordReplacement(path: readonly string[], discarded: Node | undefined, winner: Node, layer: Layer): void;
  /**
   * One more layer accumulates onto a `cascade: append` key (top-level
   * only, FR-027) at `path`. No winner is ever nominated (FR-020, T046):
   * every entry recorded here, including one recorded before the strategy
   * tightened to `append` (v0.3 FR-026), is `"accumulated"`.
   */
  recordAccumulation(path: readonly string[], span: SourceSpan, layer: Layer): void;
  /**
   * `path` is a mapping ≥2 distinct layers both contributed a mapping to —
   * deep merge actually combined them. Removes any chain recorded there
   * (from when only one layer had contributed so far), so `why()` answers
   * `synthesized` for it rather than a stale single-layer chain (T042).
   * Idempotent: a third, fourth, ... contributing layer calls this again
   * on a `path` that is already absent, which is a no-op.
   */
  recordSynthesized(path: readonly string[]): void;
  /**
   * Finish building: reverse every chain that ended on a `"won"` entry
   * into winner-first order (this file's module doc, "Ordering"), leave
   * every chain that ended on `"accumulated"` exactly as built, and freeze
   * the result into the `ProvenanceRecord` `MergedConfiguration` carries.
   */
  finish(): ProvenanceRecord;
}

/** Append `entry` to `pointer`'s chain, demoting whatever was previously last (if anything, and if it was `"won"`) to `outcome`. Shared by `recordReplacement` (demotes to `"overridden"`) and `recordAccumulation` (demotes to `"accumulated"`) — the only difference between an ordinary replace and an append transition, provenance-wise, is what the *previous* winner becomes once it stops being the sole answer. */
function appendDemoting(record: Map<string, ProvenanceEntry[]>, pointer: string, entry: ProvenanceEntry, demoteTo: "overridden" | "accumulated"): void {
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
export function createProvenanceBuilder(): ProvenanceBuilder {
  const record = new Map<string, ProvenanceEntry[]>();

  function recordFreshContribution(path: readonly string[], node: Node, layer: Layer): void {
    const pointer = pointerFromPath(path);
    record.set(pointer, [{ layer, span: node.span, outcome: "won" }]);
    if (node.type === "mapping") {
      for (const [key, child] of node.entries) {
        recordFreshContribution([...path, key], child, layer);
      }
    }
  }

  function purgeDescendants(path: readonly string[]): void {
    const prefix = `${pointerFromPath(path)}/`;
    for (const key of record.keys()) {
      if (key.startsWith(prefix)) {
        record.delete(key);
      }
    }
  }

  function recordReplacement(path: readonly string[], discarded: Node | undefined, winner: Node, layer: Layer): void {
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

  function recordAccumulation(path: readonly string[], span: SourceSpan, layer: Layer): void {
    appendDemoting(record, pointerFromPath(path), { layer, span, outcome: "accumulated" }, "accumulated");
  }

  function recordSynthesized(path: readonly string[]): void {
    record.delete(pointerFromPath(path));
  }

  function finish(): ProvenanceRecord {
    const result = new Map<string, readonly ProvenanceEntry[]>();
    for (const [pointer, entries] of record) {
      const last = entries[entries.length - 1];
      const ordered = last !== undefined && last.outcome === "won" ? [...entries].reverse() : entries;
      result.set(pointer, ordered);
    }
    return result;
  }

  return { recordFreshContribution, recordReplacement, recordAccumulation, recordSynthesized, finish };
}

// --- why() — User Story 3 (T047, v0.3 FR-021) ------------------------------

/**
 * `why()`'s result — contracts/merge-api.md's `WhyResult`. All three
 * outcomes are reachable and deliberately distinct (that contract's own
 * words): a **chain** for a value or a container exactly one layer wrote
 * (or that had a single evolving identity across replacements);
 * **synthesized** for a container ≥2 layers each independently
 * contributed a mapping to, naming its contributors rather than a winner;
 * and **unknown-pointer** for a pointer that names nothing in the tree at
 * all — distinct from both, since research D1's whole risk is a pointer
 * disagreeing between the tree and the record, and this is where that
 * would become observable rather than silent.
 */
export type WhyResult =
  | { readonly kind: "chain"; readonly entries: readonly ProvenanceEntry[] }
  | { readonly kind: "synthesized"; readonly contributors: readonly ProvenanceEntry[] }
  | { readonly kind: "unknown-pointer" };

/** Build `parentPointer`'s child pointer for `key` without re-parsing `parentPointer` — the inverse of `resolvePointer`'s own per-segment walk, needed here because `why()` walks the merged **tree**, not a path array, once it starts computing `synthesized` contributors. */
function childPointer(parentPointer: string, key: string): string {
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
function synthesizedContributors(record: ProvenanceRecord, containerPointer: string, container: Mapping): readonly ProvenanceEntry[] {
  const byLayer = new Map<Layer, ProvenanceEntry>();
  for (const [key, child] of container.entries) {
    const pointer = childPointer(containerPointer, key);
    const chain = record.get(pointer);
    if (chain !== undefined && chain.length > 0) {
      const winner = chain[0];
      if (winner !== undefined && !byLayer.has(winner.layer)) {
        byLayer.set(winner.layer, winner);
      }
    } else if (child.type === "mapping") {
      for (const contributor of synthesizedContributors(record, pointer, child)) {
        if (!byLayer.has(contributor.layer)) {
          byLayer.set(contributor.layer, contributor);
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
function ancestorPointer(pointer: string): string {
  return pointer.slice(0, pointer.lastIndexOf("/"));
}

/**
 * Answer where `pointer`'s value in `configuration.tree` came from — the
 * `git config --show-origin` question (SPEC.md §10). A library function in
 * v0.3 (research D3); no CLI ships here.
 */
/** v0.6 FR-020: attach `entry`'s own delegation breadcrumb, if `configuration.delegationBreadcrumbs` has one for `entry.span.origin.id` — a plain lookup, never a fold-time decision (`why()`'s own doc, `ProvenanceEntry.delegatedFrom`'s own doc). */
function withBreadcrumb(configuration: MergedConfiguration, entry: ProvenanceEntry): ProvenanceEntry {
  const breadcrumb = configuration.delegationBreadcrumbs.get(entry.span.origin.id);
  return breadcrumb === undefined ? entry : { ...entry, delegatedFrom: breadcrumb };
}

export function why(configuration: MergedConfiguration, pointer: string): WhyResult {
  const node = resolvePointer(configuration.tree, pointer);
  if (node === undefined) {
    return { kind: "unknown-pointer" };
  }
  const chain = configuration.provenance.get(pointer);
  if (chain !== undefined) {
    return { kind: "chain", entries: chain.map((entry) => withBreadcrumb(configuration, entry)) };
  }
  if (node.type === "mapping") {
    const contributors = synthesizedContributors(configuration.provenance, pointer, node).map((entry) => withBreadcrumb(configuration, entry));
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
