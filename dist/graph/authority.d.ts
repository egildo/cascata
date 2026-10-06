/**
 * Per-schema `authority:` — SPEC.md §6.3, §11; specs/007-sealing-and-embedding,
 * v0.7 FR-016 through FR-020.
 *
 * Format-blind and IO-blind, exactly like the rest of `src/graph/` — reads
 * already-parsed schema trees and pure `GraphDocument`/`GraphReference`
 * shapes, never a byte or an adapter (`tests/unit/layering.test.ts`).
 * Runs during `resolve()`'s own pedigree assembly, before `merge()` ever
 * sees the graph — the pinning demand is a *resolution-time* policy, not a
 * merge-time one (SPEC.md §11: "the library verifies, the pedigree
 * legislates").
 *
 * **Presence, not verification** (research.md D5): `checkPinningDemand`
 * refuses an `$adopts`/`$schema` that *lacks* a `$pin` — a syntactic
 * check. Whether a **local** document's bytes actually match a stated
 * `$pin` is a pre-existing gap this milestone does not close: v0.2 never
 * wired `$pin` verification for local reads (only remote fetches verify
 * — `src/index.ts`'s `readAtTarget`, local branch, always returns
 * `verified: false`). `demandPinnedAdoption` therefore only ever
 * guarantees a pin is *written*, not that a local schema's bytes match
 * it — recorded here and in the milestone report, not silently assumed
 * away.
 */
import type { Node } from "../model/node.js";
import { type Diagnostic } from "../diagnostics/diagnostic.js";
import type { GraphDocument } from "./build.js";
/** §6.3's per-schema governance declarations — a closed vocabulary of two booleans (FR-016). */
export interface AuthoritySection {
    readonly demandPinnedAdoption?: boolean;
    readonly finalAgainstForking?: boolean;
}
/**
 * Read one schema layer's own top-level `authority:` mapping (FR-016). An
 * absent `authority:`, or one that is not a mapping, contributes nothing
 * — the same "not a mapping → nothing" reading `src/merge/strategy.ts`'s
 * `readKeysVocabulary` already gives `keys:`. A member outside the closed
 * vocabulary is refused (`unknown-authority-member`) at its own position,
 * naming what is supported — the same posture `delegate`/`cascade` each
 * already hold for their own closed vocabularies. A member present but
 * not `true` (a malformed shape, or an explicit `false`) is read as
 * simply not asserted — no FR in this milestone names a distinct
 * `malformed-authority-value` refusal, so this is a deliberate scope
 * decision (recorded in the milestone report), not an oversight.
 */
export declare function readAuthoritySection(schemaTree: Node, declaringRank: number): {
    readonly section: AuthoritySection;
    readonly diagnostics: readonly Diagnostic[];
};
export interface PinningDemandOutcome {
    /** Root-to-leaf, one `AuthoritySection` per schema document — index-aligned with `schemaDocumentsRootToLeaf` and, by construction, with `graph/pedigree.ts`'s own `Pedigree`. */
    readonly sections: readonly AuthoritySection[];
    readonly diagnostics: readonly Diagnostic[];
}
/**
 * Walk the pedigree once, root to leaf (§6.1's chain — no diamonds
 * possible, so one linear pass is exhaustive): for each schema document,
 * first check its own **incoming** reference (`document.via` — the
 * `$adopts`/`$schema` that named it) against whatever demand an earlier
 * (more rootward) document already armed, refusing `adoption-not-pinned`
 * if a demand is active and this reference carries no `$pin` (FR-017);
 * *then* read this document's own `authority.demandPinnedAdoption` and,
 * if `true`, arm the demand for every document after it.
 *
 * **Check-before-arm is what makes FR-018 and FR-019 true by
 * construction, not by a special case**: a document's own declaration is
 * read only *after* its own incoming reference has already been checked
 * against the *previous* state, so a root's demand can never protect its
 * own fetch (FR-019) — and there is no `false`-branch semantics to
 * retract a demand with (FR-018): `demandPinnedAdoption` is a boolean an
 * author can only ever assert `true`; anything else simply never arms
 * it, and once armed nothing in this vocabulary un-arms it.
 */
export declare function checkPinningDemand(schemaDocumentsRootToLeaf: readonly GraphDocument[]): PinningDemandOutcome;
//# sourceMappingURL=authority.d.ts.map