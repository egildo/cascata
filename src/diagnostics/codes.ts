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

/**
 * `demand` vocabulary problems (v0.4, `SPEC.md` §9) —
 * specs/004-constraint-checker/contracts/diagnostics.md. Found reading
 * `keys.<name>.demand`, before any value is checked against it.
 * `unimplemented-demand-keyword` and `unimplemented-types-section` are
 * deliberately distinct from `unknown-demand-keyword`, mirroring
 * `unimplemented-cascade-strategy` vs. `unknown-cascade-strategy` in v0.3:
 * `accept`, `format`, and `types:` are named by §7/§9 and arrive in v0.5,
 * so an author writing them is early, not wrong.
 *
 * **`unknown-key-vocabulary-keyword` joins this list in v0.7 part 2**
 * (`SPEC.md` §9, Constitution Principle VI). It polices a **key
 * declaration** itself — `keys.<name>` (the full `{demand, provide,
 * cascade, final, delegate}` five, shared by `directives.<name>` per
 * FR-012) or a nested `keys:` child (`{demand, delegate}` only) — where
 * `unknown-demand-keyword` polices the `demand:` mapping *inside* one.
 * Distinct from both `unknown-demand-keyword` and
 * `unknown-type-entry-keyword` for the same reason those two are
 * distinct from each other: three closed vocabularies, three codes, each
 * naming which one was violated (`src/validate/vocabulary.ts`'s own
 * `TOP_LEVEL_KEY_DECLARATION_KEYWORDS` doc has the finding this closes).
 */
export const VALIDATE_VOCABULARY_CODES = [
  "unknown-demand-keyword",
  "unimplemented-demand-keyword",
  "unimplemented-types-section",
  "malformed-demand-value",
  "malformed-type-expression",
  "unknown-type-name",
  "unknown-key-vocabulary-keyword",
] as const;

/**
 * Constraint violations (v0.4, `SPEC.md` §5.4, §10) —
 * specs/004-constraint-checker/contracts/diagnostics.md. Found checking
 * the merged tree against a well-formed demand.
 */
export const VALIDATE_VIOLATION_CODES = ["type-mismatch", "range-violated", "length-violated", "pattern-mismatch", "enum-violated", "required-violated"] as const;

/**
 * Named types and nested demands (v0.5, `SPEC.md` §7, §9 amended) —
 * specs/005-named-types/contracts/{type-resolution,nested-demands,diagnostics}.md.
 * `unknown-type-entry-keyword` is a `types.<name>` entry's own closed
 * vocabulary (`demand`/`accept` only) — distinct from `unknown-demand-keyword`,
 * which polices `keys.<name>.demand` instead. `type-name-collision` and
 * `type-qualifier-collision` are two independent namespaces (unqualified
 * names; `$id`-derived qualifiers) — see research.md D1 for why collision
 * is unconditional, including a redeclaration that would look like
 * narrowing read in isolation. `depth-limit-exceeded` (v0.1) and
 * `unknown-type-name` (v0.4) are reused for this milestone's own new
 * hazards/unresolvable-name reasons rather than repurposed with new codes
 * — see contracts/diagnostics.md for why each reuse is the identical
 * hazard, not a new one wearing an old name.
 */
export const NAMED_TYPE_CODES = ["unknown-type-entry-keyword", "type-name-collision", "builtin-type-redeclared", "type-qualifier-collision", "unresolvable-type-cycle", "type-accept-widened"] as const;

/**
 * Delegation (v0.6, `SPEC.md` §8) — specs/006-delegation/contracts/
 * delegation-resolution.md. `document-unreachable`, `reference-cycle`,
 * `sandbox-escape`, `unsupported-scheme` (v0.2), and `depth-limit-exceeded`
 * (v0.1/v0.5) are reused for delegation's own identical hazards
 * (FR-026) rather than repurposed with new codes.
 * `delegate-value-unimplemented` mirrors `unimplemented-cascade-strategy`/
 * `unimplemented-demand-keyword`: a `delegate:` value other than `allow`
 * is early (a future door, §8.4), not simply wrong. `absolute-delegated-path`
 * is a separate rule from `sandbox-escape` (research.md D7) — an absolute
 * path is refused even when it would resolve inside the sandbox root.
 */
export const DELEGATION_CODES = ["delegate-value-unimplemented", "fragment-reserved-key", "remote-delegation-not-permitted", "absolute-delegated-path"] as const;

/**
 * Diagnostic levels (v0.7, `SPEC.md` §10) — specs/007-sealing-and-embedding.
 * `delegate-inline-string-loaded` is `level: "info"` (§8.1's lint, closing
 * v0.6's own unanswered Edge Case): at a key granted `delegate: allow`
 * whose own `demand` is a leaf shape an inline string would satisfy, an
 * inline string there is loaded as a delegation target, never matched
 * against that demand — legitimate, but surprising, so it teaches rather
 * than refuses.
 */
export const DIAGNOSTIC_LEVEL_CODES = ["delegate-inline-string-loaded"] as const;

/**
 * Sealing and authority (v0.7, `SPEC.md` §6.3, §5.2, §9, §11) —
 * specs/007-sealing-and-embedding/contracts/sealing-authority.md.
 * `required-vacuous` is `level: "info"` (§5.5's lint); every other code
 * here is `level: "error"`.
 *
 * **`seal` moved into the `demand` vocabulary during implementation**
 * (SPEC.md §9/§6.3, amended) — it no longer has its own malformed-value
 * code (`unknown-seal-value`, retired: a bad `seal:` value now reuses
 * `malformed-demand-value`, the same code every other demand keyword's
 * shape mistake uses — `src/validate/vocabulary.ts`) or its own
 * weakening code (`seal-weakened`, retired: `closed → open` needs no
 * dedicated refusal — whole-chain validation's own redundancy makes the
 * attempt inert, the identical "a widening needs no refusal" precedent
 * SPEC.md §15 already established for named-type narrowing). Neither
 * code shipped before this correction, so retiring them costs nothing.
 * `seal-violation` stays, now produced by `src/validate/check.ts`'s
 * per-layer, per-position check rather than a whole-stack pre-resolution.
 */
export const SEALING_AUTHORITY_CODES = [
  "seal-violation",
  "final-key-redeclared",
  "final-key-set",
  "required-vacuous",
  "unknown-authority-member",
  "adoption-not-pinned",
] as const;

/**
 * The `directives:` section (v0.7 part 2, `SPEC.md` §9, §6.1 — amended;
 * specs/008-metaschema-bootstrap FR-011). One code only, and the scarcity
 * is the point: a `directives:` entry's `demand` **is** an ordinary
 * demand, so every way its constraints can be malformed or violated
 * already has a code (`malformed-demand-value`, `type-mismatch`,
 * `pattern-mismatch`, `required-violated`, ...) and reusing them is what
 * makes §9's "entries take the same per-key vocabulary as `keys:`
 * entries" true in the diagnostics as well as in the syntax.
 *
 * `unknown-directive-key` is the one thing with no existing code: the
 * section's own vocabulary is **closed to the six reserved keys**
 * (`$id`, `$version`, `$adopts`, `$pin`, `$schema`, `$extends`), and a
 * seventh name is a closed-vocabulary refusal about a *section*, not
 * about a demand keyword (`unknown-demand-keyword`) or a type entry
 * (`unknown-type-entry-keyword`). Three closed vocabularies, three codes,
 * each naming which one was violated — Principle VI's own posture, and
 * the reason none of the three is reused for another.
 */
export const DIRECTIVES_CODES = ["unknown-directive-key"] as const;

/**
 * The output surface and the last silence (v1.0, `SPEC.md` §9, §17;
 * specs/009-output-surface-and-freeze FR-001, FR-019).
 *
 * **`malformed-section`** polices §9's four top-level sections — `types`,
 * `keys`, `directives`, `authority` — whose value must be a mapping.
 * Until v1.0 a schema writing `types: oops` was **silently ignored**:
 * every section reader in this codebase treats a non-mapping section as
 * "nothing to read, never an error", a posture documented since v0.3 and
 * recorded as a hole by v0.7's meta-schema corpus sweep, where the
 * meta-schema refused two fixtures the pipeline accepted. A silent
 * acceptance in a language whose Principle VI is deny-by-default is the
 * one thing a freeze must not make permanent.
 *
 * A fourth code rather than a reuse, for the reason the other three are
 * distinct from each other: `unknown-demand-keyword` polices a demand
 * mapping, `unknown-type-entry-keyword` a `types.<name>` entry,
 * `unknown-directive-key` a `directives:` name, and this one a **section**
 * — four closed vocabularies, four codes, each naming which one was
 * violated. It is not `malformed-demand-value`: a section is not a demand
 * and has no demand of its own to point at.
 *
 * **`precision-narrowed`** is `level: "info"` — §17's normalization lint.
 * It fires where an accumulated demand admitting `float` projects an
 * `int`-kind scalar to `number` and the conversion is **not exact**;
 * never on the shape, only on an actual lost digit, because "a lint that
 * cried on every `int | float` key would be ignored within a week" (§17).
 * Exactness is the round trip `Number.isFinite(n) && BigInt(n) === v`,
 * not `Number.isSafeInteger` — 2^53, 3·2^52 and 2^60 are all exactly
 * representable and all fail the latter (research.md F-3).
 */
export const OUTPUT_SURFACE_CODES = ["malformed-section", "precision-narrowed"] as const;

/**
 * The accumulated demand and the emitted type (v1.1, `SPEC.md` §18 —
 * Article VIII; specs/010-type-generator FR-004, FR-026).
 *
 * **`demand-unsatisfiable`** is `level: "info"` — Article VIII's own lint.
 * Where two demands at one position admit no common value (`string` in one
 * layer, `int` in another), the accumulated demand is empty, the emitted
 * type is `never`, and this names both demands. It is not an `error`, and
 * deliberately so: whole-chain validation already refuses every value at
 * such a position, so nothing here changes an outcome. What is new is that
 * the contradiction is visible **with no document in hand** — "the
 * beginning of the static subsumption §5.4 promises" — and a lint is what a
 * beginning looks like. A second, distinct code rather than a reuse of
 * `type-mismatch`: that code says a *value* failed a demand, and there is
 * no value here at all.
 *
 * **`emit-identifier-collision`** is `level: "error"` — Article VIII's
 * "two names that escape to one identifier are a generator error, not a
 * coin toss". Two `types:` entries whose names differ in Cascata (`a-b`
 * and `a_b`) but escape to one TypeScript identifier cannot both be
 * emitted, and picking one silently would make the generated type say
 * something no schema said. The emission is refused whole. Distinct from
 * `type-name-collision` (two *unrelated declarations* of one name, §7's
 * namespace, unreachable in v1) because this is a collision in the
 * **target** language's namespace, not in Cascata's: the two names are
 * perfectly legal, and it is the escape rule that cannot keep them apart.
 */
export const GENERATOR_CODES = ["demand-unsatisfiable", "emit-identifier-collision"] as const;

/** Every stable diagnostic code, in the catalogue's declaration order. v0.1's through v0.5's codes are unchanged; v0.6 only appends. */
/**
 * Overrides (v1.6, `SPEC.md` Article VI — §16; specs/014-overrides FR-005).
 *
 * One code, for the one thing an override can do that no existing code
 * names: carry a `$`-prefixed key. `fragment-reserved-key` is the same
 * shape refusing for a different reason — a fragment belongs to its
 * parent's layer and cannot start a pedigree, an override is a layer of
 * its own and must not start a second one — and Principle VI says two
 * reasons are two codes. Everything else an override can get wrong
 * (unreadable, an unsupported scheme, a violated demand, a `final` set)
 * already has its code, and reusing those is what makes "an override is
 * governed as the entry is" true in the diagnostics as well as in the
 * fold.
 */
export const OVERRIDE_CODES = ["override-reserved-key"] as const;

export const DIAGNOSTIC_CODES = [
  ...PORTABILITY_FLOOR_CODES,
  ...RESOURCE_LIMIT_CODES,
  ...SYNTAX_CODES,
  ...REFERENCE_RESOLUTION_CODES,
  ...FETCH_INTEGRITY_CODES,
  ...MERGE_POLICY_CODES,
  ...VALIDATE_VOCABULARY_CODES,
  ...VALIDATE_VIOLATION_CODES,
  ...NAMED_TYPE_CODES,
  ...DELEGATION_CODES,
  ...DIAGNOSTIC_LEVEL_CODES,
  ...SEALING_AUTHORITY_CODES,
  ...DIRECTIVES_CODES,
  ...OUTPUT_SURFACE_CODES,
  ...GENERATOR_CODES,
  ...OVERRIDE_CODES,
] as const;

/** A stable, machine-readable diagnostic code. */
export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

const DIAGNOSTIC_CODE_SET: ReadonlySet<string> = new Set(DIAGNOSTIC_CODES);

/** Whether `code` is one of the catalogue's stable codes. */
export function isDiagnosticCode(code: string): code is DiagnosticCode {
  return DIAGNOSTIC_CODE_SET.has(code);
}
