/**
 * One document's pointer at another — `SPEC.md` §3, §6.1;
 * data-model.md "Reference".
 *
 * This type lives in `src/model/` rather than in `src/resolve/` because
 * both `resolve/` (which produces references) and `graph/` (which
 * consumes them) need it, and Principle IV forbids `graph/` importing
 * `resolve/`. Declaring it in each place instead — which an earlier
 * revision did — left two structurally identical shapes with no single
 * source of truth, kept in step only by the orchestrator failing to
 * compile. `model/` is the format-blind core both layers may depend on,
 * so it is the honest home.
 *
 * Behaviour stays where it belongs: constructing a `Reference` and
 * extracting one from a parsed tree are both `resolve/reference.ts`'s
 * job, and this module knows nothing about `$schema`, `$adopts`, or
 * documents. It declares shapes and imports nothing but `SourceSpan`.
 */

import type { SourceSpan } from "./span.js";

/** Which keyword produced this reference. Every distinction costs a keyword (`SPEC.md` §2.4). `"delegate"` (v0.6): a granted key's string value, resolved as a reference to a fragment (`SPEC.md` §8). `"override"` (v1.6): the embedder's `overrides` option, one text per config document ranked after the entry (`SPEC.md` Article VI) — no keyword produced it, which is the distinction: it is the one reference kind no document can write. */
export type ReferenceKind = "schema" | "adopts" | "delegate" | "override";

/**
 * Who wrote the reference, which decides how far it may reach (§8.1's razor).
 *
 * Derived from the document *carrying* the reference, never from the reference's own text — a
 * schema must not be able to claim config authority. v0.2 FR-020 and FR-021 rest entirely on
 * this asymmetry: a config's own reference is author consent and may leave the sandbox; a
 * schema's may not.
 */
export type ReferenceAuthority = "config-authored" | "schema-authored";

/**
 * One link in a delegation breadcrumb (v0.6, `SPEC.md` §10, Principle
 * III's last phased diagnostic field) — the delegating value's own
 * position, in its own document. A chain of these, outermost-inward
 * (v0.6 FR-012b), describes how a fragment was reached; absent
 * altogether for a value that was never delegated (v0.4 FR-026's "absent
 * rather than faked", now applied to delegation).
 */
export interface DelegationHop {
  readonly span: SourceSpan;
}

/** A pointer at another document, always positioned (Principle III). */
export interface Reference {
  /** What was written — a relative path, a `~/`-prefixed path, or an absolute URL. */
  readonly text: string;
  /** Where it was written, in the document that wrote it. */
  readonly span: SourceSpan;
  readonly kind: ReferenceKind;
  readonly authority: ReferenceAuthority;
  /** The stated `$pin` content hash, if any — raw text; parsing and verification are identity's job. */
  readonly pin?: string;
}
