/**
 * `Reference` — data-model.md "Reference"; SPEC.md §3, §6.1, §9.
 *
 * One document's pointer at another: a `$schema` a config names, or an
 * `$adopts` a schema names. Constructible only with a span, exactly as a
 * `Node` is (Principle III) — there is no path by which a reference can
 * exist without a position to blame a resolution failure on (v0.2 FR-023).
 *
 * `extractSchemaReference`/`extractAdoptsReference` (User Story 2, T025)
 * read `$schema`/`$adopts` out of a parsed tree. SPEC.md §9 settles the
 * value's shape explicitly: **a single string scalar**. A sequence is
 * always refused with `multiple-adoption` (T032) — this was originally
 * an implementer-invented reading (a sequence accepted when its items
 * collapsed to one distinct location, refused otherwise) written before
 * §9 said anything about the shape at all; §9 now settles it the other
 * way, and that reading is withdrawn. See the milestone report.
 *
 * `src/resolve/` is one of the two new format-blind boundaries this
 * milestone adds (plan.md, Principle IV): it deals in bytes and locations
 * and must never import from `src/adapters/` — enforced mechanically by
 * tests/unit/layering.test.ts (T012).
 */
import type { Node } from "../model/node.js";
import type { SourceSpan } from "../model/span.js";
import type { Reference, ReferenceAuthority, ReferenceKind } from "../model/reference.js";
import { type Diagnostic, type RelatedSpan } from "../diagnostics/diagnostic.js";
import type { DiagnosticCode } from "../diagnostics/codes.js";
export type { Reference, ReferenceAuthority, ReferenceKind };
/** A config names its governing schema; a schema names exactly one parent (v0.2 FR-005). */
/**
 * Which document carries the reference — decided by *where the reference
 * was written*, never by the reference's own text (data-model.md's
 * invariant), so a schema cannot claim config authority to escape the
 * sandbox (D6). Config-authored references are exempt from the sandbox;
 * schema-authored ones are confined to it (v0.2 FR-020, FR-021 — User Story 4,
 * out of scope for this slice, but the distinction is recorded here where
 * the `Reference` itself is defined).
 */
/** One document's pointer at another, with everything a resolution diagnostic needs to blame it. */
/**
 * Construct a Reference. `span` is required, matching every other
 * span-carrying entity in this codebase (`Node`, and now `Reference`) —
 * there is no optional-span overload and no setter.
 */
export declare function createReference(fields: {
    text: string;
    span: SourceSpan;
    kind: ReferenceKind;
    authority: ReferenceAuthority;
    pin?: string;
}): Reference;
/**
 * Build a resolution `Diagnostic` anchored to `reference`'s own span
 * (v0.2 FR-023, FR-024; tasks.md T064; contracts/diagnostics.md's rule:
 * "a resolution code MUST anchor to a reference, never to a fetched
 * document alone"). Not the only place a resolution diagnostic is built
 * in this codebase — most of `src/index.ts`'s call sites predate this
 * helper and already pass `candidate.span` as `primary` directly, which
 * satisfies the identical invariant by construction (verified by
 * inspection, not refactored wholesale here to avoid churning already-
 * conformance-tested call sites — see the milestone report) — but every
 * *new* resolution diagnostic this milestone slice adds (`sandbox-escape`,
 * `chain-limit-exceeded`) goes through this one function, so there is
 * exactly one place in `src/resolve/` that can construct one, and it
 * cannot be constructed without a `Reference` to anchor it to.
 */
export declare function referenceDiagnostic(code: DiagnosticCode, reference: Reference, message: string, related?: readonly RelatedSpan[]): Diagnostic;
/**
 * The result of reading `$schema`/`$adopts` out of a document
 * (SPEC.md §9: "`$adopts` and `$schema` are single string scalars").
 *
 * - `"none"` — the key is absent (legal: a config need not have a
 *   `$schema` — chain-none, T023 — the same way a root schema need not
 *   have an `$adopts`), or present but not a string scalar and not a
 *   sequence (treated as absent; see the report — no diagnostic in this
 *   milestone's catalogue covers a malformed reference *value*).
 * - `"single"` — the ordinary, legal case: exactly one reference.
 * - `"sequence"` — the key's value is a YAML sequence. **Always refused**
 *   (SPEC.md §9, amended after an earlier version of this file read a
 *   sequence as legal multi-item syntax to disambiguate from
 *   `multiple-adoption` — that reading is withdrawn; see the report).
 *   `entries` holds a `Reference` for every string-scalar item found (0,
 *   1, or more — even a one-item sequence is refused, because the
 *   *shape* is what's illegal, not the count), so the caller can still
 *   anchor a diagnostic to real spans; `sequenceSpan` is the fallback
 *   anchor when `entries` is empty.
 */
export type ExtractedReference = {
    readonly kind: "none";
} | {
    readonly kind: "single";
    readonly reference: Reference;
} | {
    readonly kind: "sequence";
    readonly sequenceSpan: SourceSpan;
    readonly entries: readonly Reference[];
};
/**
 * A config's `$schema` — kind `"schema"`, authority `"config-authored"`
 * (FR-020: the config author wrote it, which is consent).
 */
export declare function extractSchemaReference(tree: Node): ExtractedReference;
/**
 * A schema's `$adopts` — kind `"adopts"`, authority `"schema-authored"`
 * (FR-021: confined to the sandbox, out of scope this slice, but the
 * authority is fixed here regardless).
 *
 * A sequence value is refused with `multiple-adoption` (SPEC.md §9,
 * FR-005) — not because it names more than one *distinct* parent, but
 * because the shape itself is illegal in v1: it is what multi-adoption
 * will look like once C3 linearization lands, so an author writing it
 * now is ahead of the version, not merely wrong. The caller
 * (`src/index.ts`) turns an `ExtractedReference` of kind `"sequence"`
 * into that diagnostic.
 */
export declare function extractAdoptsReference(tree: Node): ExtractedReference;
//# sourceMappingURL=reference.d.ts.map