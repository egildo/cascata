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
export declare const PORTABILITY_FLOOR_CODES: readonly ["duplicate-key", "non-string-key", "unsupported-tag", "multiple-documents", "invalid-encoding"];
/** Resource limits (SPEC.md §11). */
export declare const RESOURCE_LIMIT_CODES: readonly ["depth-limit-exceeded", "size-limit-exceeded", "alias-cycle", "expansion-limit-exceeded"];
/** Syntax. The one code that wraps a dependency's error rather than expressing a Cascata rule. */
export declare const SYNTAX_CODES: readonly ["malformed-document"];
/**
 * Reference resolution (v0.2, SPEC.md §3, §6.1) — contracts/diagnostics.md
 * (002). A resolution code MUST anchor to a reference, never to a fetched
 * document alone.
 */
export declare const REFERENCE_RESOLUTION_CODES: readonly ["document-unreachable", "reference-cycle", "multiple-adoption", "chain-limit-exceeded", "unsupported-scheme", "sandbox-escape", "reference-fragment"];
/** Fetching and integrity (v0.2, SPEC.md §6.1, §11) — contracts/diagnostics.md (002). */
export declare const FETCH_INTEGRITY_CODES: readonly ["pin-mismatch", "malformed-pin", "insecure-redirect", "too-many-redirects", "document-not-cached"];
/**
 * Merge policy (v0.3, SPEC.md §5.2, §5.3) — specs/003-merge-engine/contracts/diagnostics.md.
 * `unknown-cascade-strategy` and `unimplemented-cascade-strategy` are
 * deliberately distinct codes (not one code with two messages): `merge-by-key`
 * is named in SPEC.md §5.3 as reserved, so an author writing it is early,
 * not wrong, and a diagnostic saying "unknown" would teach them the
 * opposite (the same reasoning v0.2 applied to `multiple-adoption`).
 *
 * **`append-scalar-wrapped`** (v1.8, `SPEC.md` §5.3, §15) is the one
 * `level: "info"` code in this list — a normalization lint, not a refusal.
 * `append` promises a list, and the commonest contribution to one is a
 * single item, so a scalar written where the list accumulates is taken as
 * a sequence of that one scalar and the author is told, at the scalar's own
 * position, in the layer that wrote it. The posture is exactly
 * `precision-narrowed`'s (`OUTPUT_SURFACE_CODES` below, §17): the value is
 * changed, the author is told, the build continues — never silent, and
 * never fatal. It lives here rather than beside `precision-narrowed`
 * because a code belongs with the stage that raises it, and this one is
 * raised by the fold; the milestone spec asks for both placements and they
 * are mutually exclusive (see the report).
 *
 * A **mapping** keeps `append-over-non-sequence`: there is no one-item
 * reading of a mapping, so nothing is normalized and the refusal stands.
 */
export declare const MERGE_POLICY_CODES: readonly ["unknown-cascade-strategy", "unimplemented-cascade-strategy", "append-over-non-sequence", "append-scalar-wrapped", "cascade-strategy-weakened"];
/**
 * `demand` vocabulary problems (v0.4, `SPEC.md` §9) —
 * specs/004-constraint-checker/contracts/diagnostics.md. Found reading
 * `keys.<name>.demand`, before any value is checked against it.
 * `unimplemented-demand-keyword` and `unimplemented-types-section` are
 * deliberately distinct from `unknown-demand-keyword`, mirroring
 * `unimplemented-cascade-strategy` vs. `unknown-cascade-strategy` in v0.3
 * (an early keyword is not a wrong one). Both have been unreachable since
 * v0.5: `accept`, `keys` and `types:` were built then, and `format` was
 * dropped rather than built (§15), so `format:` is `unknown-demand-keyword`.
 * Codes are never repurposed, so both stay in the catalogue.
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
export declare const VALIDATE_VOCABULARY_CODES: readonly ["unknown-demand-keyword", "unimplemented-demand-keyword", "unimplemented-types-section", "malformed-demand-value", "malformed-type-expression", "unknown-type-name", "unknown-key-vocabulary-keyword"];
/**
 * Constraint violations (v0.4, `SPEC.md` §5.4, §10) —
 * specs/004-constraint-checker/contracts/diagnostics.md. Found checking
 * the merged tree against a well-formed demand.
 */
export declare const VALIDATE_VIOLATION_CODES: readonly ["type-mismatch", "range-violated", "length-violated", "pattern-mismatch", "enum-violated", "required-violated"];
/**
 * Named types and nested demands (v0.5, `SPEC.md` §7, §9 amended) —
 * specs/005-named-types/contracts/{type-resolution,nested-demands,diagnostics}.md.
 * `unknown-type-entry-keyword` is a `types.<name>` entry's own closed
 * vocabulary (`demand`/`accept` only) — distinct from `unknown-demand-keyword`,
 * which polices `keys.<name>.demand` instead. `type-name-collision` and
 * `type-qualifier-collision` are two independent namespaces (unqualified
 * names; `$id`-derived qualifiers), both unreachable in v1: a redeclaration
 * down the chain is a narrowing (§15; validate-case T034, reworked), and only
 * two unrelated declarations — impossible with single-parent `$adopts` —
 * would collide. Kept, never repurposed. `depth-limit-exceeded` (v0.1) and
 * `unknown-type-name` (v0.4) are reused for this milestone's own new
 * hazards/unresolvable-name reasons rather than repurposed with new codes
 * — see contracts/diagnostics.md for why each reuse is the identical
 * hazard, not a new one wearing an old name.
 */
export declare const NAMED_TYPE_CODES: readonly ["unknown-type-entry-keyword", "type-name-collision", "builtin-type-redeclared", "type-qualifier-collision", "unresolvable-type-cycle", "type-accept-widened"];
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
export declare const DELEGATION_CODES: readonly ["delegate-value-unimplemented", "fragment-reserved-key", "remote-delegation-not-permitted", "absolute-delegated-path"];
/**
 * Diagnostic levels (v0.7, `SPEC.md` §10) — specs/007-sealing-and-embedding.
 * `delegate-inline-string-loaded` is `level: "info"` (§8.1's lint, closing
 * v0.6's own unanswered Edge Case): at a key granted `delegate: allow`
 * whose own `demand` is a leaf shape an inline string would satisfy, an
 * inline string there is loaded as a delegation target, never matched
 * against that demand — legitimate, but surprising, so it teaches rather
 * than refuses.
 */
export declare const DIAGNOSTIC_LEVEL_CODES: readonly ["delegate-inline-string-loaded"];
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
export declare const SEALING_AUTHORITY_CODES: readonly ["seal-violation", "final-key-redeclared", "final-key-set", "required-vacuous", "unknown-authority-member", "adoption-not-pinned"];
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
export declare const DIRECTIVES_CODES: readonly ["unknown-directive-key"];
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
export declare const OUTPUT_SURFACE_CODES: readonly ["malformed-section", "precision-narrowed"];
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
 * and `a b`, which both escape to `$a_b`) but escape to one TypeScript identifier cannot both be
 * emitted, and picking one silently would make the generated type say
 * something no schema said. The emission is refused whole. Distinct from
 * `type-name-collision` (two *unrelated declarations* of one name, §7's
 * namespace, unreachable in v1) because this is a collision in the
 * **target** language's namespace, not in Cascata's: the two names are
 * perfectly legal, and it is the escape rule that cannot keep them apart.
 */
export declare const GENERATOR_CODES: readonly ["demand-unsatisfiable", "emit-identifier-collision"];
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
export declare const OVERRIDE_CODES: readonly ["override-reserved-key"];
/**
 * Writing a value back (v1.10, `SPEC.md` Article IX, §19) — specs/018-write-value
 * FR-007 and FR-009. They come from `locate`, `setValue` (and the writers
 * built on them) and `editTarget`; nothing in the reading pipeline raises
 * them. Each is `level: "error"`, except `edit-target-shared` under
 * `sharedEdits: "warn"` (below).
 *
 * - `edit-target-absent` — no value at the pointer; positioned at the nearest
 *   existing ancestor.
 * - `edit-target-shared` — the value is reached through a YAML alias or merge
 *   key, or it (or a container above it) is anchored and aliased, or (from
 *   `editTarget`, v1.12) its file is read at more than one place in the
 *   configuration (grafted twice, or a layer that is also grafted), so
 *   writing it would change every place that shares it. From the writer,
 *   positioned at the alias; from `editTarget`, at the value. `level: "error"`
 *   under `sharedEdits: "refuse"` (the default); under `"warn"` (v1.12) the
 *   edit is answered with this code at `level: "info"`, positioned at the
 *   value, `related` naming every other place the write changes.
 * - `edit-container` — a mapping or a sequence: setting a container is an
 *   insertion, not written yet (also from `editTarget`).
 * - `edit-block-scalar` — a block scalar (`|`, `>`), whose style is not reproduced.
 * - `edit-bare-key-in-flow` — a key with no value inside a flow collection
 *   (`{a}`), which has nowhere to put a `:` (v1.12).
 * - `edit-read-back` — the edit did not read back as the value set: the
 *   safety net, which no known input reaches.
 *
 * All positioned at the value. They are v1.12.1's split of `edit-unsupported`,
 * which named seven refusals: these four; a key with no value inside a shared
 * mapping, dropped; and a tag the writer could not find and a format with no
 * writer, both unreachable and now internal errors (SPEC.md §15).
 * - `edit-unrepresentable` — the format cannot spell the value (JSON has no
 *   `NaN` or infinity; no format has a lone surrogate); positioned at the
 *   value it would have replaced.
 */
export declare const EDIT_CODES: readonly ["edit-target-absent", "edit-target-shared", "edit-unrepresentable", "edit-container", "edit-block-scalar", "edit-bare-key-in-flow", "edit-read-back"];
/**
 * Which document an edit belongs in (v1.11, `SPEC.md` Article IX, §19) — specs/020-edit-targets
 * FR-003. Both are `level: "error"` and come only from `editTarget`. `edit-target-absent`,
 * `edit-container` and `edit-target-shared` (above) are the other refusals it gives.
 *
 * - `edit-target-inherited` — the winning value was supplied by a schema's `provide`; editing it
 *   would change a default every document under that schema shares. Positioned at the value in
 *   the schema document, and the message names the schema's location.
 * - `edit-target-remote` — the winning value's document was read over `https://`; a remote
 *   document is never an edit target. Positioned at the value in that document.
 */
export declare const EDIT_TARGET_CODES: readonly ["edit-target-inherited", "edit-target-remote"];
/**
 * Graph identity (v1.13, `SPEC.md` Article VI, §15) -- specs/023-graph-identity FR-012.
 *
 * - `link-changes-reference` -- `level: "info"`, never a refusal. A document whose logical and physical paths
 *   differ (a file behind a symbolic link, a remote document behind a redirect) wrote a relative reference that
 *   its medium's own convention and the other rule resolve to **different documents**: from the logical path in a
 *   file (as the shell's `cd` does), from the physical URL in a remote document (as a browser does). The one the
 *   convention names was loaded; the notice, positioned at the reference, names both, and the referring
 *   document's logical and physical paths. A link never changes a meaning silently.
 */
export declare const GRAPH_IDENTITY_CODES: readonly ["link-changes-reference"];
/**
 * Expanding a `glob` (v1.14, `SPEC.md` Article VI and §7) -- specs/024-glob FR-018. All `level: "error"`, all from `expand()`
 * and none from `load()`, positioned at the value whose expansion they refuse; the other values still expand. A pattern that
 * leads outside the sandbox is the existing `sandbox-escape`, not a code of its own.
 *
 * - `host-cannot-list` -- the host has no `list`. Loading and validating never needed one (FR-019).
 * - `directory-unlistable` -- the host answered `ok: false` for a directory the walk needed; its reason is in the message.
 * - `glob-in-remote-document` -- the declaring document was read over `https://`: HTTP has no directory listing, so a remote
 *   pattern is never expanded.
 * - `glob-limit-exceeded` -- the walk did more work than `limits.maxSteps` allows (default 100,000): one step per directory entered at each pattern position, per entry examined there, and per kind lookup (v1.14 FR-027).
 */
export declare const GLOB_EXPANSION_CODES: readonly ["host-cannot-list", "directory-unlistable", "glob-in-remote-document", "glob-limit-exceeded"];
/** Every stable diagnostic code, in the catalogue's declaration order. Each version only appends. */
export declare const DIAGNOSTIC_CODES: readonly ["duplicate-key", "non-string-key", "unsupported-tag", "multiple-documents", "invalid-encoding", "depth-limit-exceeded", "size-limit-exceeded", "alias-cycle", "expansion-limit-exceeded", "malformed-document", "document-unreachable", "reference-cycle", "multiple-adoption", "chain-limit-exceeded", "unsupported-scheme", "sandbox-escape", "reference-fragment", "pin-mismatch", "malformed-pin", "insecure-redirect", "too-many-redirects", "document-not-cached", "unknown-cascade-strategy", "unimplemented-cascade-strategy", "append-over-non-sequence", "append-scalar-wrapped", "cascade-strategy-weakened", "unknown-demand-keyword", "unimplemented-demand-keyword", "unimplemented-types-section", "malformed-demand-value", "malformed-type-expression", "unknown-type-name", "unknown-key-vocabulary-keyword", "type-mismatch", "range-violated", "length-violated", "pattern-mismatch", "enum-violated", "required-violated", "unknown-type-entry-keyword", "type-name-collision", "builtin-type-redeclared", "type-qualifier-collision", "unresolvable-type-cycle", "type-accept-widened", "delegate-value-unimplemented", "fragment-reserved-key", "remote-delegation-not-permitted", "absolute-delegated-path", "delegate-inline-string-loaded", "seal-violation", "final-key-redeclared", "final-key-set", "required-vacuous", "unknown-authority-member", "adoption-not-pinned", "unknown-directive-key", "malformed-section", "precision-narrowed", "demand-unsatisfiable", "emit-identifier-collision", "override-reserved-key", "edit-target-absent", "edit-target-shared", "edit-unrepresentable", "edit-container", "edit-block-scalar", "edit-bare-key-in-flow", "edit-read-back", "edit-target-inherited", "edit-target-remote", "link-changes-reference", "host-cannot-list", "directory-unlistable", "glob-in-remote-document", "glob-limit-exceeded"];
/** A stable, machine-readable diagnostic code. */
export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];
/** Whether `code` is one of the catalogue's stable codes. */
export declare function isDiagnosticCode(code: string): code is DiagnosticCode;
//# sourceMappingURL=codes.d.ts.map