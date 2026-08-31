/**
 * Entities for the fold — data-model.md "Layer", "Merge Strategy",
 * "Provenance Entry", "Provenance Record", "Merged Configuration"; tasks.md
 * T007 (Foundational).
 *
 * **Scope note for this slice (T001–T024, Phase 3 checkpoint)**: this file
 * defines the shapes data-model.md specifies. *Populating* a
 * `ProvenanceRecord` during the fold — recording every contributing layer
 * per pointer, including the ones that lost — is tasks.md T041, Phase 5
 * (User Story 3), explicitly out of this slice's scope. `src/merge/fold.ts`
 * (T018–T023) therefore returns an **empty** `ProvenanceRecord` for now; see
 * that file's own doc comment and the milestone report for why this is a
 * deliberate, documented boundary rather than an oversight.
 *
 * **`Layer.tree` is not in data-model.md's own field table.** That table
 * lists only `identity`, `role`, and `rank` — but the fold cannot merge
 * anything without each layer's actual parsed tree, and `Pedigree`
 * (v0.2, `src/graph/pedigree.ts`) deliberately omits it (a `PedigreeEntry`
 * carries only `identity`, `via`, and `verified`). This is resolved
 * pragmatically by carrying `tree` on `Layer` too; see the milestone report.
 */

import type { Node } from "../model/node.js";
import type { DocumentIdentity } from "../model/identity.js";
import type { SourceSpan } from "../model/span.js";
import type { Pedigree } from "../graph/pedigree.js";

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
}

/**
 * RFC 6901 pointer → ordered chain of entries, winner first (data-model.md
 * "Provenance Record"). Every pointer that resolves to a value in the
 * merged tree has a chain, and every chain's pointer resolves in the tree
 * (research D1) — an invariant this slice's `fold.ts` does not yet
 * populate enough to test meaningfully; see this file's module doc.
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
}
