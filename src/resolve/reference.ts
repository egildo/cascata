/**
 * `Reference` — data-model.md "Reference"; SPEC.md §3, §6.1.
 *
 * One document's pointer at another: a `$schema` a config names, or an
 * `$adopts` a schema names. Constructible only with a span, exactly as a
 * `Node` is (Principle III) — there is no path by which a reference can
 * exist without a position to blame a resolution failure on (v0.2 FR-023).
 *
 * This is Foundational scaffolding (tasks.md Phase 2): nothing in this
 * milestone's slice (T001-T018) extracts a `Reference` from a parsed tree
 * yet — that is User Story 2 (T024), out of scope here. The type and its
 * factory exist now so US2 has somewhere to put what it builds, the same
 * way v0.1's `SourceSpan`/`Origin` existed before any adapter used them.
 *
 * `src/resolve/` is one of the two new format-blind boundaries this
 * milestone adds (plan.md, Principle IV): it deals in bytes and locations
 * and must never import from `src/adapters/` — enforced mechanically by
 * tests/unit/layering.test.ts (T012).
 */

import type { SourceSpan } from "../model/span.js";

/** A config names its governing schema; a schema names exactly one parent (v0.2 FR-005). */
export type ReferenceKind = "schema" | "adopts";

/**
 * Which document carries the reference — decided by *where the reference
 * was written*, never by the reference's own text (data-model.md's
 * invariant), so a schema cannot claim config authority to escape the
 * sandbox (D6). Config-authored references are exempt from the sandbox;
 * schema-authored ones are confined to it (v0.2 FR-020, FR-021 — User Story 4,
 * out of scope for this slice, but the distinction is recorded here where
 * the `Reference` itself is defined).
 */
export type ReferenceAuthority = "config-authored" | "schema-authored";

/** One document's pointer at another, with everything a resolution diagnostic needs to blame it. */
export interface Reference {
  /** What was written — a relative path or an absolute URL. */
  readonly text: string;
  /** Where it was written, in the document that wrote it. */
  readonly span: SourceSpan;
  readonly kind: ReferenceKind;
  readonly authority: ReferenceAuthority;
  /** The stated `$pin` content hash, if any — raw text; parsing and verification are identity.ts's job. */
  readonly pin?: string;
}

/**
 * Construct a Reference. `span` is required, matching every other
 * span-carrying entity in this codebase (`Node`, and now `Reference`) —
 * there is no optional-span overload and no setter.
 */
export function createReference(fields: {
  text: string;
  span: SourceSpan;
  kind: ReferenceKind;
  authority: ReferenceAuthority;
  pin?: string;
}): Reference {
  return {
    text: fields.text,
    span: fields.span,
    kind: fields.kind,
    authority: fields.authority,
    ...(fields.pin !== undefined ? { pin: fields.pin } : {}),
  };
}
