/**
 * The value view — `SPEC.md` **Article VII (§17)**, §3's last pipeline
 * stage, v1.0 FR-008 through FR-021;
 * specs/009-output-surface-and-freeze/contracts/value-view.md.
 *
 * Seven milestones produced a positioned, frozen `Node` tree and no way to
 * read it as ordinary data. §1 promises the tool developer "a validated
 * configuration object"; until v1.0 it received a tagged union with spans,
 * `Map`s for mappings and `bigint`s for integers, and had to walk the model
 * by hand. This module is that promise kept.
 *
 * Four properties, each of which is a rule from the article rather than an
 * implementation preference:
 *
 * 1. **Null-prototype objects.** `Object.create(null)`, not `{}`, because a
 *    configuration key is author-controlled: on an ordinary object,
 *    `o["__proto__"] = v` *sets the prototype* and creates no own property
 *    at all, so a config author writing `__proto__:` in YAML would be
 *    reaching into the consuming application's object graph. On a
 *    null-prototype object the same assignment is an ordinary own data
 *    property. `constructor`, `toString` and `hasOwnProperty` come free
 *    from the same choice — nothing is inherited, so nothing is shadowed.
 *
 * 2. **Canonical insertion order**, which is as far as JavaScript goes.
 *    §4.2 stores mappings sorted by code point and this walk inserts in
 *    that order, but ECMA-262's `OrdinaryOwnPropertyKeys` returns every
 *    **array-index** key — a canonical numeric string in `[0, 2^32−2]` —
 *    first, ascending, ahead of everything else. No object can do
 *    otherwise. Article VII says keys are *inserted* canonically, which is
 *    met exactly; the milestone's own FR-009 says they *enumerate* that
 *    way, which is not satisfiable and is reported as a gap rather than
 *    silently approximated. `tests/unit/value-view.test.ts` asserts the
 *    limit in both directions.
 *
 * 3. **The demand decides the numeric type, not the document.** `kind` is
 *    lexical — `30` is an int and `30.0` is a float — so a faithful
 *    projection would let a config author's punctuation decide whether the
 *    consuming application sees `bigint` or `number` under an unchanged
 *    schema. `src/validate/numeric.ts` computes the accumulated admission
 *    per pointer; `projectScalar` below reads it, and emits §17's
 *    `precision-narrowed` lint where a normalization would actually drop a
 *    digit — never on the shape, because "a lint that cried on every
 *    `int | float` key would be ignored within a week".
 *
 * 4. **Iterative, not recursive.** FR-014: projection must not throw on any
 *    legal document. A recursive walk overflows the stack a few thousand
 *    levels down, and `validate()`'s own contract (like this one) takes a
 *    configuration from anywhere, not only from a parser bounded by §11's
 *    depth cap — `tests/unit/recursion-termination.test.ts` builds
 *    400-level trees by hand today. The explicit stack below is what makes
 *    the 5,000-level case in `tests/unit/value-view.test.ts` return instead
 *    of throwing. `src/extend.ts` is used for the same posture one level
 *    down: no call-site spread, ever.
 *
 * World-blind and pure (Principle IV, Article VI): it reads
 * `configuration` and nothing else, touches no node, and produces a fresh
 * value every call.
 */
import type { MergedConfiguration } from "../merge/provenance.js";
import { type Diagnostic } from "../diagnostics/diagnostic.js";
/**
 * A configuration as ordinary JS data (Article VII).
 *
 * The mapping case is an index signature rather than a nominal type: a
 * null-prototype object has no observable type of its own, and giving it
 * one would be a promise about `instanceof` that nothing can keep.
 */
export type ConfigValue = string | bigint | number | boolean | null | readonly ConfigValue[] | {
    readonly [key: string]: ConfigValue;
};
/** What `project()` produces: the value, and whatever `info` lints the projection itself earned. */
export interface ProjectionResult<T = unknown> {
    /**
     * The value view. **`T` is the caller's claim and the library never
     * checks it** (Article VII): validation enforces the *schema* against the
     * value and cannot enforce the caller's belief about what the schema
     * says. A `T` that disagrees with its schema is a bug in the calling
     * code, and the generator (§14, §18 — shipped at v1.1) removes the guesswork by
     * deriving `T` from the schema chain.
     */
    readonly value: T;
    /** Today this is `precision-narrowed` and nothing else. Never `error`-level: a projection has no failure mode. */
    readonly diagnostics: readonly Diagnostic[];
}
/**
 * Project `configuration.tree` into ordinary JS data.
 *
 * Total (FR-014), pure (FR-013), and a projection rather than a
 * replacement (FR-012): the configuration handed in is untouched and its
 * tree, spans, provenance and pedigree stay exactly where they were, so
 * `why()` keeps answering by RFC 6901 pointer.
 */
export declare function project<T = unknown>(configuration: MergedConfiguration): ProjectionResult<T>;
//# sourceMappingURL=value.d.ts.map