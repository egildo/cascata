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

import type { Node } from "../model/node.js";
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

// --- Extraction from a parsed tree (v0.2 User Story 2, T024-T025) ------
//
// `$schema` and `$adopts` are reserved document keys (SPEC.md §9.1). A
// document plays exactly one of two roles when this milestone reads it:
// the **entry document** (a "config") names its governing schema with
// `$schema`; every document reached *through* that chain (a "schema")
// names its own parent, if any, with `$adopts` (SPEC.md §6.1's worked
// chain: `site.yaml` has `$schema`, `house.yaml` and `core.yaml` have
// `$adopts`). Which key a given document is read for is therefore a
// property of *how the caller reached it*, not something inferrable from
// the document's own content — so these two extraction entry points take
// the role as an explicit parameter (`extractSchemaReference` /
// `extractAdoptsReferences`) rather than guessing from which key happens
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

/** `undefined` unless `node` is a `Scalar` of kind `"string"` — every other shape (a mapping, a sequence, a non-string scalar) is not a legal reference text and is treated as absent (see the report's note on malformed `$schema`/`$adopts` values, which this milestone's diagnostic catalogue does not cover). */
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
 * A config's `$schema` — kind `"schema"`, authority `"config-authored"`
 * (FR-020: the config author wrote it, which is consent). `undefined` if
 * the key is absent (a legal, unpinned document — User Story 2's
 * "chain-none" case) or is present but not a string scalar (treated as
 * absent; see the report).
 */
export function extractSchemaReference(tree: Node): Reference | undefined {
  const found = asStringScalar(lookupMappingEntry(tree, "$schema"));
  if (found === undefined) {
    return undefined;
  }
  return createReference({
    text: found.value,
    span: found.span,
    kind: "schema",
    authority: "config-authored",
    pin: lookupPin(tree),
  });
}

/**
 * A schema's `$adopts` — kind `"adopts"`, authority `"schema-authored"`
 * (FR-021: confined to the sandbox, out of scope this slice, but the
 * authority is fixed here regardless).
 *
 * `$adopts` is ordinarily a single string scalar (one parent — SPEC.md
 * §6.1's v1 restriction). It MAY also be written as a sequence of string
 * scalars: not a second way to adopt multiple parents (v1 forbids that
 * absolutely), but the mechanism through which "the same document
 * reached by two different spellings" (spec.md's Edge Cases) and "a
 * schema declaring more than one `$adopts` parent" (Acceptance Scenario
 * 4, T022) are actually distinguished. `src/graph/build.ts` resolves
 * every returned `Reference`'s location and only refuses
 * `multiple-adoption` if more than one *distinct* location results — two
 * spellings of the same target collapse to one (T021's diamond); two
 * spellings of genuinely different targets do not (T022). This sequence
 * reading is this implementation's own resolution of a syntax the
 * specification does not spell out; see the report.
 *
 * Returns `[]` if `$adopts` is absent, not a string scalar, and not a
 * sequence of string scalars (treated as no reference — see the report).
 * A sequence item that is not itself a string scalar is skipped, not
 * refused (no diagnostic in this milestone's catalogue covers a
 * malformed `$adopts` item specifically).
 */
export function extractAdoptsReferences(tree: Node): Reference[] {
  const raw = lookupMappingEntry(tree, "$adopts");
  if (raw === undefined) {
    return [];
  }
  const pin = lookupPin(tree);
  const texts: { value: string; span: SourceSpan }[] = [];
  if (raw.type === "scalar" && raw.kind === "string") {
    texts.push({ value: raw.value, span: raw.span });
  } else if (raw.type === "sequence") {
    for (const item of raw.items) {
      const found = asStringScalar(item);
      if (found !== undefined) {
        texts.push(found);
      }
    }
  }
  return texts.map(({ value, span }) =>
    createReference({
      text: value,
      span,
      kind: "adopts",
      authority: "schema-authored",
      pin,
    }),
  );
}
