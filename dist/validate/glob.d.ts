/**
 * The `glob` built-in type's grammar -- SPEC.md §7 (v1.14); specs/024-glob FR-001 to FR-005.
 *
 * A pattern is a strict subset of the Language Server Protocol's `GlobPattern`: segments separated by `/`;
 * `*` any run of characters but `/`; `?` one code point but `/`; `**`, only as a whole segment, zero or more
 * whole segments; every other character itself. Everything else LSP gives a meaning to is refused **by name**
 * (`[`, `]`, `{`, `}`, `\`, a leading `!`), so the grammar can grow toward the full set later and only turn a
 * refusal into an acceptance. Also refused: the empty pattern, an empty segment (`a//b`), a trailing `/`, a run
 * of two or more `*` that is not exactly a whole segment, and a `..` segment after the first segment that
 * contains a wildcard -- syntax, not confinement (FR-005): a `..` after a wildcard names nothing a pattern needs, and forbidding
 * it lets the literal prefix be computed lexically. A leading `/` and leading `..` segments are allowed, as in
 * a `path`.
 *
 * **One pass, no backtracking (FR-003).** `checkGlobPattern` visits each code point once. `counter` is the
 * witness: `steps` is incremented once per code point visited, so a test counts work instead of timing it.
 *
 * **Checking confines nothing (FR-005).** This module reads no host and no sandbox; a pattern that points
 * anywhere loads, as a `path` does (§8.1's razor).
 */
export type GlobCheck = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly offset: number;
    readonly message: string;
};
/** Work counter for the linearity witness: one step per code point visited. */
export interface GlobStepCounter {
    steps: number;
}
/**
 * Whether `pattern` is in the grammar, or the first offence by position (offsets count code points from 0).
 * The empty-segment and trailing-slash offences are reported at the slash that makes them.
 */
export declare function checkGlobPattern(pattern: string, counter?: GlobStepCounter): GlobCheck;
/** A valid pattern cut where its wildcards begin (FR-007). */
export interface GlobParts {
    /** The pattern began with `/`. */
    readonly absolute: boolean;
    /** The segments before the first segment containing a wildcard; for a pattern with no wildcard, all but its last segment. */
    readonly literal: readonly string[];
    /** The segments from the first wildcard segment on; for a pattern with no wildcard, its last segment alone. */
    readonly rest: readonly string[];
}
/** Cut a pattern that `checkGlobPattern` accepted into its literal prefix and the rest. Lexical: nothing is read. */
export declare function splitGlob(pattern: string): GlobParts;
/** Whether one segment of an accepted pattern contains a wildcard (`*` or `?`) -- the others are literals. */
export declare function isWildcardSegment(segment: string): boolean;
/** The code points of a segment, split once so that matching it against many names does not split it again. */
export declare function compileGlobSegment(segment: string): readonly number[];
/**
 * Whether `name` matches one compiled wildcard segment (v1.14 FR-002, FR-014, FR-015): `*` any run of code points (possibly
 * empty), `?` exactly one, every other code point itself, **compared exactly** -- no case or Unicode normalization. A name
 * whose first code point is `.` is matched only by a segment whose first code point is a literal `.`: a wildcard never
 * matches a leading dot. The greedy two-pointer walk backtracks only to the last `*`, so it is O(segment x name) and never
 * exponential.
 */
export declare function matchesGlobSegment(segment: readonly number[], name: string): boolean;
//# sourceMappingURL=glob.d.ts.map