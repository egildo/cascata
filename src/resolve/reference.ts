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

// Re-exported so callers of this module keep one import path for "references"; the single
// declaration lives in model/ so graph/ can share it without crossing the Principle IV boundary.
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

// --- Extraction from a parsed tree (v0.2 User Story 2, T025-T026, T032) ---
//
// `$schema` and `$adopts` are reserved document keys (SPEC.md §9). A
// document plays exactly one of two roles when this milestone reads it:
// the **entry document** (a "config") names its governing schema with
// `$schema`; every document reached *through* that chain (a "schema")
// names its own parent, if any, with `$adopts` (SPEC.md §6.1's worked
// chain: `site.yaml` has `$schema`, `house.yaml` and `core.yaml` have
// `$adopts`). Which key a given document is read for is therefore a
// property of *how the caller reached it*, not something inferrable from
// the document's own content — so these two extraction entry points take
// the role as an explicit parameter (`extractSchemaReference` /
// `extractAdoptsReference`) rather than guessing from which key happens
// to be present.
//
// `authority` follows data-model.md's invariant: it is fixed by which
// extractor is called (config vs. schema role), never by anything the
// reference's own text says (D6) — a schema cannot claim config
// authority to escape the sandbox that FR-021 (User Story 4, out of
// scope for this slice) will enforce on schema-authored references only.

function lookupMappingEntry(tree: Node, key: string): Node | undefined {
  if (tree.type !== "mapping") {
    return undefined;
  }
  return tree.entries.get(key);
}

/** `undefined` unless `node` is a `Scalar` of kind `"string"` — every other shape (a mapping, a non-string scalar) is not a legal reference text and is treated as absent (see the report's note on malformed `$schema`/`$adopts` values, which this milestone's diagnostic catalogue does not cover). */
function asStringScalar(node: Node | undefined): { value: string; span: SourceSpan } | undefined {
  if (node === undefined || node.type !== "scalar" || node.kind !== "string") {
    return undefined;
  }
  return { value: node.value, span: node.span };
}

/**
 * `$pin`, if present as a sibling of `$schema`/`$adopts` in the same
 * document (SPEC.md §6.1's worked chain: `house.yaml` carries both
 * `$adopts` and `$pin`, naming the parent and pinning it). Raw text only
 * — parsing and verification are `identity.ts`'s job (T008); this
 * milestone's local-only chains never call `verifyPin` on it (see the
 * report: pin verification is wired up in `resolve/fetch.ts`, User Story
 * 3, not here).
 */
function lookupPin(tree: Node): string | undefined {
  return asStringScalar(lookupMappingEntry(tree, "$pin"))?.value;
}

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
export type ExtractedReference =
  | { readonly kind: "none" }
  | { readonly kind: "single"; readonly reference: Reference }
  | { readonly kind: "sequence"; readonly sequenceSpan: SourceSpan; readonly entries: readonly Reference[] };

function extractReference(tree: Node, key: "$schema" | "$adopts", refKind: ReferenceKind, authority: ReferenceAuthority): ExtractedReference {
  const raw = lookupMappingEntry(tree, key);
  if (raw === undefined) {
    return { kind: "none" };
  }
  const pin = lookupPin(tree);
  if (raw.type === "scalar" && raw.kind === "string") {
    return {
      kind: "single",
      reference: createReference({ text: raw.value, span: raw.span, kind: refKind, authority, pin }),
    };
  }
  if (raw.type === "sequence") {
    const entries: Reference[] = [];
    for (const item of raw.items) {
      const found = asStringScalar(item);
      if (found !== undefined) {
        entries.push(createReference({ text: found.value, span: found.span, kind: refKind, authority, pin }));
      }
    }
    return { kind: "sequence", sequenceSpan: raw.span, entries };
  }
  return { kind: "none" };
}

/**
 * A config's `$schema` — kind `"schema"`, authority `"config-authored"`
 * (FR-020: the config author wrote it, which is consent).
 */
export function extractSchemaReference(tree: Node): ExtractedReference {
  return extractReference(tree, "$schema", "schema", "config-authored");
}

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
export function extractAdoptsReference(tree: Node): ExtractedReference {
  return extractReference(tree, "$adopts", "adopts", "schema-authored");
}
