/**
 * The stable diagnostic code catalogue — contracts/diagnostics.md.
 *
 * Codes are stable identifiers and part of the public contract: the corpus
 * asserts against them, and tooling may branch on them. They are Cascata's
 * own vocabulary, deliberately not a mirror of any dependency's internal
 * codes, so a library rename is never a breaking change here (research D6).
 *
 * Rules for adding a code (contracts/diagnostics.md):
 *   1. A new code needs a `SPEC.md` article to cite (Principle I).
 *   2. It arrives with at least one accepting and one refusing conformance
 *      case (Principle V).
 *   3. Codes are never repurposed (Principle VI).
 */

/** Portability floor (SPEC.md §4.2). */
export const PORTABILITY_FLOOR_CODES = [
  "duplicate-key",
  "non-string-key",
  "unsupported-tag",
  "multiple-documents",
  "invalid-encoding",
] as const;

/** Resource limits (SPEC.md §11). */
export const RESOURCE_LIMIT_CODES = ["depth-limit-exceeded", "size-limit-exceeded", "alias-cycle"] as const;

/** Syntax. The one code that wraps a dependency's error rather than expressing a Cascata rule. */
export const SYNTAX_CODES = ["malformed-document"] as const;

/**
 * Reference resolution (v0.2, SPEC.md §3, §6.1) — contracts/diagnostics.md
 * (002). A resolution code MUST anchor to a reference, never to a fetched
 * document alone.
 */
export const REFERENCE_RESOLUTION_CODES = [
  "document-unreachable",
  "reference-cycle",
  "multiple-adoption",
  "chain-limit-exceeded",
  "unsupported-scheme",
  "sandbox-escape",
] as const;

/** Fetching and integrity (v0.2, SPEC.md §6.1, §11) — contracts/diagnostics.md (002). */
export const FETCH_INTEGRITY_CODES = ["pin-mismatch", "malformed-pin", "insecure-redirect", "too-many-redirects", "document-not-cached"] as const;

/**
 * Merge policy (v0.3, SPEC.md §5.2, §5.3) — specs/003-merge-engine/contracts/diagnostics.md.
 * `unknown-cascade-strategy` and `unimplemented-cascade-strategy` are
 * deliberately distinct codes (not one code with two messages): `merge-by-key`
 * is named in SPEC.md §5.3 as reserved, so an author writing it is early,
 * not wrong, and a diagnostic saying "unknown" would teach them the
 * opposite (the same reasoning v0.2 applied to `multiple-adoption`).
 */
export const MERGE_POLICY_CODES = ["unknown-cascade-strategy", "unimplemented-cascade-strategy", "append-over-non-sequence", "cascade-strategy-weakened"] as const;

/** Every stable diagnostic code, in the catalogue's declaration order. v0.1's and v0.2's codes are unchanged; v0.3 only appends. */
export const DIAGNOSTIC_CODES = [
  ...PORTABILITY_FLOOR_CODES,
  ...RESOURCE_LIMIT_CODES,
  ...SYNTAX_CODES,
  ...REFERENCE_RESOLUTION_CODES,
  ...FETCH_INTEGRITY_CODES,
  ...MERGE_POLICY_CODES,
] as const;

/** A stable, machine-readable diagnostic code. */
export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

const DIAGNOSTIC_CODE_SET: ReadonlySet<string> = new Set(DIAGNOSTIC_CODES);

/** Whether `code` is one of the catalogue's stable codes. */
export function isDiagnosticCode(code: string): code is DiagnosticCode {
  return DIAGNOSTIC_CODE_SET.has(code);
}
