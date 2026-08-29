/**
 * The portability-floor checks the underlying library does not do for us —
 * SPEC.md §4.2; contracts/diagnostics.md's "Portability floor" table;
 * research D2 (tag allowlist rationale).
 *
 * This module is deliberately narrow: it holds the *vocabulary* of a
 * violation (what a core-schema tag is, what a diagnostic for each floor
 * rule looks like) as pure, context-free functions. *When* a violation is
 * detected — which requires the walk's own state (alias resolution, span
 * conversion) — stays in parse.ts, which calls into this module at the
 * right moments. Keeping this file free of `Document`/`activePath`/
 * `LineCounter` concerns is what makes the tag allowlist and the
 * diagnostic shapes independently readable and testable.
 *
 * `src/adapters/yaml/` is the one format-aware directory (Principle IV);
 * this file is part of it.
 */

import { createDiagnostic, type Diagnostic, type RelatedSpan } from "../../diagnostics/diagnostic.js";
import type { SourceSpan } from "../../model/span.js";

/**
 * The YAML 1.2 core schema's seven tags, as the full tag URIs `yaml`
 * resolves an explicit tag to. An allowlist, not a denylist (research D2):
 * the probe showed non-core standard tags (`!!binary`, `!!timestamp`,
 * `!!set`, `!!omap`) resolving *silently*, so a denylist would need to
 * enumerate every tag any future `yaml` release might learn to resolve —
 * the classic failing-open design. This list fails closed instead.
 *
 * An *implicit* (untagged) scalar never has `.tag` set at all (verified
 * empirically — core-schema resolution leaves `.tag` `undefined`), so the
 * caller only needs to check this set when a tag is actually present.
 */
export const CORE_SCHEMA_TAGS: ReadonlySet<string> = new Set([
  "tag:yaml.org,2002:map",
  "tag:yaml.org,2002:seq",
  "tag:yaml.org,2002:str",
  "tag:yaml.org,2002:null",
  "tag:yaml.org,2002:bool",
  "tag:yaml.org,2002:int",
  "tag:yaml.org,2002:float",
]);

/** Whether an explicit tag falls outside the core-schema allowlist. `undefined` (no explicit tag) is never unsupported. */
export function isUnsupportedTag(tag: string | undefined): tag is string {
  return tag !== undefined && !CORE_SCHEMA_TAGS.has(tag);
}

/**
 * `unsupported-tag` at `span`.
 *
 * `span` is the tagged node's own span, which starts where the value
 * begins, not where the tag token itself does — `yaml`'s composed AST
 * (`Scalar`/`YAMLMap`/`YAMLSeq`) does not expose a tag token's position
 * separately from the value it decorates without opting into the CST
 * layer, which §4.3 defers. Documented as a known limitation, not silently
 * papered over: see the Phase 4 report.
 */
export function unsupportedTagDiagnostic(tag: string, span: SourceSpan): Diagnostic {
  return createDiagnostic({
    code: "unsupported-tag",
    message: `Tag '${tag}' is outside the YAML 1.2 core schema`,
    primary: span,
  });
}

/** `non-string-key` at the key's own span (FR-012). */
export function nonStringKeyDiagnostic(span: SourceSpan): Diagnostic {
  return createDiagnostic({
    code: "non-string-key",
    message: "A mapping key must be text",
    primary: span,
  });
}

/**
 * `duplicate-key`: primary is the later occurrence, `related` carries the
 * first (FR-018) — the field research established is load-bearing, since
 * `yaml`'s own `DUPLICATE_KEY` error reports only the second occurrence.
 */
export function duplicateKeyDiagnostic(laterSpan: SourceSpan, firstSpan: SourceSpan): Diagnostic {
  const related: RelatedSpan[] = [{ label: "first occurrence", span: firstSpan }];
  return createDiagnostic({
    code: "duplicate-key",
    message: "The same key appears more than once in this mapping",
    primary: laterSpan,
    related,
  });
}

/** `alias-cycle` at the closing alias's own position (contracts: "The alias closing the cycle"), not the anchor's. */
export function aliasCycleDiagnostic(aliasName: string, span: SourceSpan): Diagnostic {
  return createDiagnostic({
    code: "alias-cycle",
    message: `Alias '*${aliasName}' refers to content that encloses itself`,
    primary: span,
  });
}
