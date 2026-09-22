/**
 * Reading a schema's `demand` vocabulary — SPEC.md §9 ("Schema vocabulary
 * per key: `demand` (`type`, `items`, `required`, `accept`, `keys`, plus
 * JSON-Schema-named leaf constraints: `min`, `max`, `minLength`,
 * `maxLength`, `pattern`, `enum`)..."), amended (§15) for `keys`/`items`
 * nesting to arbitrary depth; v0.4 FR-001 through FR-007, FR-011a,
 * FR-011b; v0.5 FR-021 through FR-025;
 * specs/005-named-types/contracts/nested-demands.md.
 *
 * **v0.5: the demand vocabulary is fully closed *and* fully implemented.**
 * `accept` and `keys` leave `UNIMPLEMENTED_DEMAND_KEYWORDS` (empty as of
 * this milestone) — the last two keywords §9 named but no milestone had
 * yet built. `format` stays outside the vocabulary entirely (v0.4's own
 * §15 amendment) — a schema writing it is `unknown-demand-keyword`, not
 * this file's unimplemented column.
 *
 * `readDemandVocabulary` only **extracts** a schema's top-level
 * `keys.<name>.demand` — one level, as v0.4 left it. Nesting is a
 * property of *checking*, not of this one read: `recursiveVocabularyProblems`
 * below walks a demand mapping's own `items`/`keys` sub-values to
 * whatever depth they nest (FR-023), bounded by `MAX_DEMAND_DEPTH`
 * (FR-025, research.md D4) — the same walk `check.ts`'s value-checking
 * pass performs in parallel, for the same reason: a demand and the value
 * it constrains nest together.
 *
 * `seal`, `final`, and `delegate` stay unread (v0.4 FR-002, unchanged).
 *
 * **Vocabulary problems never look at whether a *value* satisfies a
 * demand** — only whether the demand is well-formed. `constraints.ts`'s
 * leaf checks already treat a malformed value as silently not-applicable,
 * so running both passes unconditionally produces exactly one diagnostic
 * per malformed keyword, never a duplicate (v0.3 FR-028's precedent).
 */
import { type Diagnostic } from "../diagnostics/diagnostic.js";
import type { Node, Scalar } from "../model/node.js";
import type { Layer } from "../merge/provenance.js";
import type { SourceSpan } from "../model/span.js";
import { type TypeExpression } from "./typeexpr.js";
/**
 * §9's closed `demand` keyword list (v0.4 FR-005). Order is declaration
 * order, not significant otherwise.
 *
 * **`seal` joins this list in v0.7** (SPEC.md §9/§6.3, amended) — moved
 * here from a per-key sibling of `provide`/`cascade`/`final`/`delegate`,
 * where it started this milestone. `seal` constrains a mapping value's
 * *shape*: it composes by intersection (`open ∩ closed = closed`) and
 * narrows monotonically, exactly like `required`/`type`/every other
 * demand keyword — and unlike `cascade` (merge policy) or `final`
 * (governance, "who may speak"), which stay per-key. The decisive reason
 * (not merely tidiness): a per-key `seal` cannot reach a nested mapping
 * or the inside of a named type's own `demand`, and the meta-schema
 * (specs/008-metaschema-bootstrap) needs both.
 *
 * **`values` joins this list in v0.7 part 2** (SPEC.md §9, amended; §15's
 * "A mapping whose keys the schema cannot enumerate"). It is to a mapping
 * what `items` is to a sequence — every entry, whatever its key — and it
 * exists because the meta-schema's own `keys:` section is exactly a
 * mapping of author-chosen names, which nothing in the vocabulary could
 * describe.
 *
 * **`values` takes a *bare demand mapping*, exactly as `items` does —
 * corrected in v0.7 part 2, post-implementation** (SPEC.md §9/§15, amended
 * today). The first implementation read `values` as a *key declaration*
 * (`values: { demand: {...} }`), by analogy with a `keys:` entry. The
 * analogy is not the argument that settles the syntax — the failure mode
 * is: under the key-declaration reading, `values: { type: string }` — the
 * spelling the analogy itself invites an author to write — parses, is
 * accepted, and constrains **nothing**, a silent no-op. Under the bare
 * demand, that same wrong spelling contains `demand`, which is not a
 * demand keyword, so it is refused as `unknown-demand-keyword`. Loud
 * beats silent. It also retires a smaller wart at no cost: the
 * key-declaration reading left room to write `delegate:` under `values`,
 * which the pipeline never grants (delegation grants are scoped to
 * `keys`, `src/resolve/delegate.ts`) — with a bare demand there is
 * nowhere left to write it.
 */
export declare const DEMAND_KEYWORDS: readonly ["type", "items", "required", "min", "max", "minLength", "maxLength", "pattern", "enum", "accept", "keys", "seal", "values"];
export type DemandKeyword = (typeof DEMAND_KEYWORDS)[number];
/** Nesting bound for `keys`/`items` recursion (v0.5 FR-025, research.md D4) — reused from v0.1's `maxDepth` default, the identical hazard (adversarially deep nesting exhausting the stack), not a new constant. */
export declare const MAX_DEMAND_DEPTH = 64;
/**
 * §9's **per-key vocabulary** — a second closed list, distinct from
 * `DEMAND_KEYWORDS` above: this one governs a *key declaration* itself
 * (`keys.<name>: { demand, provide, cascade, final, delegate }`), not
 * the `demand:` mapping inside it. A **top-level** declaration (a
 * schema's own `keys.<name>`, or a `directives.<name>` entry, which
 * FR-012 gives the identical vocabulary) carries the full five; a
 * **nested** one (a `keys:` demand keyword's own children, at any depth)
 * carries only `demand`/`delegate` — §15's "Nested vs. top-level key
 * declarations" settled the split, on the ground that `provide`,
 * `cascade`, and `final` state a layer's *authority over a key*, which
 * means something only where a schema declares a key of its own.
 *
 * **Added in v0.7 part 2, closing a hole nothing had noticed in six
 * milestones**: §9 states this list as closed, and Principle VI requires
 * closure, but until now nothing refused a member outside it — the one
 * closed vocabulary in the language with no `unknown-…` refusal behind
 * it, while `DEMAND_KEYWORDS` (`unknown-demand-keyword`) and a
 * `types.<name>` entry's own vocabulary (`unknown-type-entry-keyword`,
 * `types.ts`) both already have one. Found by the meta-schema bootstrap:
 * two corpus fixtures had carried a per-key `seal:` — the spelling that
 * moved into `demand` earlier in v0.7 (this file's own `DEMAND_KEYWORDS`
 * doc) — and kept passing, silently, for a reason neither was written
 * for.
 */
export declare const TOP_LEVEL_KEY_DECLARATION_KEYWORDS: readonly ["demand", "provide", "cascade", "final", "delegate"];
/** The strictly smaller vocabulary a *nested* key declaration carries (§15, above). */
export declare const NESTED_KEY_DECLARATION_KEYWORDS: readonly ["demand", "delegate"];
/**
 * The unqualified local name inside a possibly-qualified `type:`
 * alternative (`core/resource` -> `resource`; `resource` -> `resource`
 * unchanged) — `TypeDeclaration.name` and `knownDeclaredNames`
 * (`types.ts`) are always local names, never qualified strings, so any
 * "is this name declared *anywhere* in the pedigree" check must compare
 * against the local part of a qualified reference, not the qualified
 * string itself.
 *
 * **Bug found and fixed while writing v0.5 US4's T036 conformance case**:
 * both `refuseTypeExpressionProblems` below and `check.ts`'s
 * `checkAlternativeReachability` used to test
 * `knownDeclaredNames.has(alt.name)` directly. For a qualified reference
 * like `root/resource`, that string is never a member of
 * `knownDeclaredNames` (which only ever holds `"resource"`), so *every*
 * qualified reference — valid or not — was refused as globally unknown
 * before `resolveTypeName`'s own, correct qualifier-matching logic ever
 * ran. FR-019's "qualification is the way out" of a collision did not
 * work at all until this fix; T036 (a genuinely valid qualified
 * reference) is what caught it, going from an unexpected
 * `unknown-type-name` to the correct outcome.
 */
export declare function localNameOf(name: string): string;
/** One raw `demand:` declaration for one key — every keyword present, unvalidated. */
export type RawDemand = ReadonlyMap<string, Node>;
/**
 * Read the `keys:` section of a schema's tree into a map of key name →
 * raw `demand` declaration (every keyword present, verbatim, unvalidated).
 * An absent `keys:`, an empty mapping, a non-mapping `keys:`, a per-key
 * declaration that is not itself a mapping, or a per-key declaration with
 * no `demand` at all, all contribute nothing for that key — mirrors
 * `src/merge/strategy.ts`'s `readKeysVocabulary` exactly (v0.3 FR-003's
 * rule; v0.4 FR-004). One level only — `readNestedKeysMapping` below is
 * the general form a nested `keys:` demand also uses (v0.5 FR-021).
 */
export declare function readDemandVocabulary(schemaTree: Node): ReadonlyMap<string, RawDemand>;
/**
 * The general form: given a `keys:`-shaped mapping node directly (a
 * schema's own top-level one, or a nested `keys` demand's own value —
 * v0.5 FR-021, both share the identical shape, child name → `{ demand:
 * {...} }`), extract each child's raw demand. A child declaration that
 * is not itself a mapping, or that has no `demand:` (or a non-mapping
 * one), contributes nothing for that child.
 */
export declare function readNestedKeysMapping(keysNode: Node): ReadonlyMap<string, RawDemand>;
/**
 * The raw demand inside one **key declaration** — the `{ demand: {...} }`
 * shape a `values:` value takes, and the shape each entry of a nested
 * `keys:` mapping takes (v0.7 part 2, SPEC.md §9 amended).
 * `readNestedKeysMapping` above is the plural form of exactly this read;
 * this is the singular one, kept as its own function so `values` and
 * `keys` cannot drift apart in what they consider a declaration.
 *
 * `undefined` for a declaration that is not a mapping, or that carries no
 * `demand:` (or a non-mapping one) — the identical "not a mapping ->
 * nothing" posture v0.3/v0.4 use throughout, and the identical silent
 * no-op `readNestedKeysMapping` gives such a child.
 */
export declare function readKeyDeclarationDemand(declarationNode: Node): RawDemand | undefined;
/** One vocabulary problem, with its own diagnostic. */
export interface DemandVocabularyProblem {
    readonly diagnostic: Diagnostic;
}
/**
 * Refuse every closed-vocabulary problem in one demand mapping — an
 * unrecognized keyword (`unknown-demand-keyword`), a recognized-but-
 * unimplemented one (`unimplemented-demand-keyword`) — at that keyword's
 * own value span. `demandPointerPath` is the **full** pointer path up to
 * and including this demand mapping itself (e.g. `["keys","tags","demand"]`
 * for a top-level one, or `["keys","tags","demand","keys","host","demand"]`
 * for one nested two levels down) — generalized from v0.4's
 * `(keyName, keysPointerPath)` split so the same function serves any
 * nesting depth (v0.5).
 *
 * **No `Diagnostic.pointer` (merged-configuration pointer) is set here** —
 * a vocabulary problem is a mistake in the schema document itself,
 * independent of any config or merged position (v0.4's own reasoning,
 * unchanged).
 */
export declare function refuseUnknownOrUnimplementedKeywords(demandPointerPath: readonly (string | number)[], layerRank: number, raw: RawDemand): DemandVocabularyProblem[];
/**
 * Every closed-vocabulary problem in a schema layer's own **top-level**
 * `keys:` and `directives:` sections — one declaration per named entry,
 * each checked against `TOP_LEVEL_KEY_DECLARATION_KEYWORDS`. FR-012: "A
 * `directives:` entry MUST take the same per-key vocabulary a `keys:`
 * entry takes" — the identical closed set, so one walk over both
 * sections' entries serves both, differing only in which top-level
 * section name prefixes the pointer. A sibling walk to
 * `readDemandVocabulary`'s own top-level `keys:` read, but this one
 * inspects the *declaration* (`{demand, provide, cascade, final,
 * delegate}`) rather than extracting its `demand` child — the two reads
 * are independent because `readDemandVocabulary` already discards every
 * non-`demand` member before this problem could be seen there, and it
 * has no `directives:` counterpart at all (`directives.ts`'s own
 * `readDirectives` does that extraction).
 */
export declare function topLevelKeyDeclarationVocabularyProblems(schemaTree: Node, layerRank: number): DemandVocabularyProblem[];
/**
 * §9's four top-level schema sections, in canonical (code point) order —
 * which is also the order their diagnostics come out in, so a schema
 * malforming several of them reports them deterministically without
 * anything sorting anything.
 */
export declare const TOP_LEVEL_SECTIONS: readonly ["authority", "directives", "keys", "types"];
/**
 * **v1.0 FR-001** — a present top-level section whose value is not a
 * mapping is refused at that node's own position, by **one rule covering
 * all four**.
 *
 * Until v1.0 this was the language's last silent acceptance. `types: oops`
 * and `keys: not-a-mapping` parsed, merged, validated, and did nothing:
 * every section reader in this codebase — `readDemandVocabulary` and
 * `topLevelKeyDeclarationVocabularyProblems` here, `types.ts`'s `types:`
 * read, `directives.ts`'s `readDirectives`, `graph/authority.ts`'s
 * `readAuthoritySection`, `merge/strategy.ts`'s `readKeysVocabulary`,
 * `merge/final.ts`'s `final:` scan, and `resolve/delegate.ts`'s grant scan
 * — independently treats a non-mapping section as "nothing to read, never
 * an error". v0.7's meta-schema corpus sweep found the hole from the other
 * side: the meta-schema says a section is a mapping and refused two
 * fixtures the pipeline accepted, and that divergence was recorded rather
 * than fixed because closing it is a governance decision. §9 was always
 * the governance; v1.0 is where the implementation catches up, because a
 * freeze must not make a silent acceptance permanent.
 *
 * **None of those readers changes.** They stay lenient deliberately: a
 * reader that refused would make the diagnostic depend on which stage
 * happened to read the section first, and would have to be re-fixed for
 * every section a later milestone adds. One refusal is raised once, here,
 * in the pass whose whole job is schema-shape refusal — `unknown-demand-
 * keyword`'s existing posture applied to a section instead of a keyword.
 *
 * **Schema layers only.** The caller (`vocabularyProblemsForLayer`) already
 * returns early for `layer.role !== "schema"`, so a *config* carrying an
 * inert `types:`/`keys:` of any shape stays legal and is ordinary data —
 * v0.3's `merge-fold/inert-vocabulary/` fixtures are exactly that, and
 * v1.0 FR-002 keeps them so. Absent and malformed are different, and only
 * one of them is an error.
 */
export declare function topLevelSectionProblems(schemaTree: Node, layerRank: number): DemandVocabularyProblem[];
/**
 * Refuse a constraint value of the wrong shape as `malformed-demand-value`
 * (v0.4 FR-007), naming the shape expected. `type` is checked here only
 * for its most basic shape (a string scalar) — the grammar and name
 * resolution are `refuseTypeExpressionProblems`'s job. `accept` and
 * `keys` are real, checked keywords as of v0.5 (see their own `case`s
 * below); `format` is not in `DEMAND_KEYWORDS` at all (SPEC.md §15) and
 * falls to `default` like any other unrecognized keyword.
 */
export declare function refuseMalformedShapes(demandPointerPath: readonly (string | number)[], layerRank: number, raw: RawDemand): DemandVocabularyProblem[];
/**
 * Wire `typeexpr.ts`'s own parse/resolution failures to diagnostics (v0.4
 * FR-009, FR-012). Only reached for a `type` value that is already a
 * string scalar — `refuseMalformedShapes` refuses anything else. As of
 * v0.5, "resolution" beyond a name being a syntactically-known built-in
 * or grammatically well-formed name is `check.ts`'s job (it needs a
 * layer's own type scope, which this file does not have) — this function
 * still catches a name that resolves against **neither** the built-in
 * set **nor any declared type anywhere in the pedigree**, since that is
 * unresolvable regardless of scope; a name reachable only via scope
 * (declared, but not by an ancestor of the usage layer) is caught later,
 * in `check.ts`, where scope is available.
 */
export declare function refuseTypeExpressionProblems(demandPointerPath: readonly (string | number)[], layerRank: number, raw: RawDemand, knownDeclaredNames: ReadonlySet<string>): DemandVocabularyProblem[];
/**
 * Recursively find every vocabulary problem in one demand mapping,
 * descending into `items`/`keys` to whatever depth they nest (v0.5
 * FR-023), bounded by `MAX_DEMAND_DEPTH` (FR-025). `demandPointerPath` is
 * the full pointer path up to and including `raw` itself; `depth` is the
 * nesting level `raw` sits at (0 for a top-level key's own demand).
 */
export declare function recursiveVocabularyProblems(raw: RawDemand, layerRank: number, demandPointerPath: readonly (string | number)[], depth: number, knownDeclaredNames: ReadonlySet<string>): readonly DemandVocabularyProblem[];
/**
 * Every closed-vocabulary problem in one schema layer's own top-level
 * `keys.<name>.demand` declarations, recursively (v0.5 FR-017's
 * collect-all discipline applied across the whole layer, at every
 * nesting depth), plus every top-level `keys.<name>` **declaration's own**
 * closed-vocabulary problem (v0.7 part 2 — `topLevelKeyDeclarationVocabularyProblems`,
 * this file's own `TOP_LEVEL_KEY_DECLARATION_KEYWORDS` doc). `layer.role
 * !== "schema"` contributes nothing (FR-003). The `types:` section itself
 * is `src/validate/types.ts`'s job, not this function's — it is validated
 * once per pedigree there, not per key here.
 */
export declare function vocabularyProblemsForLayer(layer: Layer, knownDeclaredNames: ReadonlySet<string>): Diagnostic[];
/** One `demand:` mapping read once, every keyword typed (v1.1 data-model.md). */
export interface ParsedDemand {
    /** Canonical alternatives (`typeexpr.ts`), or absent where no `type:` was declared or it did not parse. */
    readonly type?: TypeExpression;
    readonly items?: ParsedDemand;
    readonly keys?: ReadonlyMap<string, ParsedNestedKey>;
    readonly values?: ParsedDemand;
    readonly required?: boolean;
    /** Numeric scalars, kind preserved — `min: 1` and `min: 1.0` are different nodes (§4.2). */
    readonly min?: Scalar;
    readonly max?: Scalar;
    readonly minLength?: bigint;
    readonly maxLength?: bigint;
    /** The pattern source. It compiles, or `refuseMalformedShapes` never let it here. */
    readonly pattern?: string;
    readonly enum?: readonly Node[];
    readonly accept?: readonly string[];
    readonly seal?: "open" | "closed";
    /** The demand mapping's own position. */
    readonly span: SourceSpan;
    /** RFC 6901, in this demand's own layer. */
    readonly pointer: string;
}
/** One entry of a **nested** `keys:` — §9's strictly smaller vocabulary (`demand`, `delegate`). */
export interface ParsedNestedKey {
    readonly demand?: ParsedDemand;
    readonly delegate?: "allow";
    readonly span: SourceSpan;
}
/**
 * Read one raw demand mapping into a `ParsedDemand`. `pointerPath` is the
 * full path to `raw` itself in its own document (e.g. `["keys", "tags",
 * "demand"]`), matching every other function in this file; `span` is the
 * demand mapping's own span.
 *
 * Recursion into `items`, `keys` and `values` is unbounded here on purpose:
 * `MAX_DEMAND_DEPTH` is enforced by `recursiveVocabularyProblems` above and
 * by `check.ts`'s own descent, both of which run before this does, and a
 * second, differently-worded bound in a pure reader would be a second
 * authority on the same question.
 */
export declare function parseDemand(raw: RawDemand, pointerPath: readonly (string | number)[], span: SourceSpan): ParsedDemand;
//# sourceMappingURL=vocabulary.d.ts.map