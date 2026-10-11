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
import { type Diagnostic } from "../../diagnostics/diagnostic.js";
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
export declare const CORE_SCHEMA_TAGS: ReadonlySet<string>;
/** Whether an explicit tag falls outside the core-schema allowlist. `undefined` (no explicit tag) is never unsupported. */
export declare function isUnsupportedTag(tag: string | undefined): tag is string;
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
export declare function unsupportedTagDiagnostic(tag: string, span: SourceSpan): Diagnostic;
/** `non-string-key` at the key's own span (FR-012). */
export declare function nonStringKeyDiagnostic(span: SourceSpan): Diagnostic;
/**
 * `duplicate-key`: primary is the later occurrence, `related` carries the
 * first (FR-018) — the field research established is load-bearing, since
 * `yaml`'s own `DUPLICATE_KEY` error reports only the second occurrence.
 */
export declare function duplicateKeyDiagnostic(laterSpan: SourceSpan, firstSpan: SourceSpan, message?: string): Diagnostic;
/** `alias-cycle` at the closing alias's own position (contracts: "The alias closing the cycle"), not the anchor's. */
export declare function aliasCycleDiagnostic(aliasName: string, span: SourceSpan): Diagnostic;
//# sourceMappingURL=floor.d.ts.map