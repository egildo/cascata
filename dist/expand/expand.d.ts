/**
 * `expand()` -- a stage of its own: a `glob` value walked through the host. SPEC.md §7 and Article VI (v1.14);
 * specs/024-glob FR-009 to FR-019.
 *
 * It runs **after** `load()`/`validate()` and only when asked; `load()` never calls it. It is the second stage that asks the
 * host (after resolution): it reads no bytes, it lists directories, and it returns locations. The sandbox governs every
 * listing, because a listing is a read.
 *
 * **The walk** (FR-013). From the directory the pattern is anchored at (`globBase`: the declaring document's directory
 * joined with the literal prefix), segment by segment: a literal segment is a direct child, **found in the listing** by its
 * exact name (so `café` composed does not find `café` decomposed on a disk that stores it so -- FR-015); `*` and `?` match
 * listed names; `**` is zero or more directories, never a dot directory. Only files are returned. Before a directory is
 * listed its physical path (the host's `canonicalize`, v1.13) is judged against the sandbox, and a directory is entered once
 * per physical path and pattern position, which is what ends a link cycle. Dotfiles are matched by a literal dot only
 * (FR-014).
 *
 * **Order.** The walk is best-first over the *routes* (the logical path of each directory entered), smallest first, with
 * every directory compared as `path + "/"` so that `a-b/` comes before `a/` (0x2d < 0x2f) exactly as the paths below them
 * will. A directory reached by two routes is therefore entered by the smaller, and a file reached by two routes is named by
 * the smaller logical path (FR-016); nothing depends on the order the host lists in. The matches are sorted by code point,
 * not UTF-16 (CLAUDE.md's trap), and deduplicated by physical path.
 *
 * **Cost.** Each distinct directory is put to the host once per `expand()` call (the answers are kept). A value's walk is
 * charged its work, not the names it lists (v1.14 FR-027): one step per (directory, pattern position) entered, plus one per
 * entry examined there, plus one per kind lookup, against `limits.maxSteps`; past it, `glob-limit-exceeded`. So a pattern of
 * many `**` over a large tree is refused, not slow (consecutive `**` are not collapsed; the count is the guard).
 *
 * Never throws for a document or the world -- every refusal is a diagnostic at the value (FR-018) and the other values still
 * expand; it throws only for programmer error (no host; no sandbox root given and none recorded, FR-025).
 */
import { type Diagnostic } from "../diagnostics/diagnostic.js";
import type { MergedConfiguration } from "../merge/provenance.js";
import type { SourceSpan } from "../model/span.js";
import type { Host } from "../resolve/host.js";
/** FR-018: the walk of one value may visit this many directory entries before it is refused. */
export declare const DEFAULT_MAX_STEPS = 100000;
export interface ExpandLimits {
    /**
     * The work one value's walk may do before `glob-limit-exceeded` (v1.14 FR-027): each (directory, pattern position) it enters
     * counts one, each entry it examines there one more, and each kind lookup one. Work, not names: a pattern of many `**` over a
     * tree whose every directory is listed once is still many times the tree.
     */
    readonly maxSteps: number;
}
export interface ExpandOptions {
    /** Required: the host that lists directories (and canonicalizes). No default and none inferred. */
    readonly host: Host;
    /**
     * The roots the walk is confined to, a location or a list of them, exactly as `resolve()` takes them. **Optional (v1.14
     * FR-025):** `resolve()` records the roots it was given and `merge()` carries them onto `MergedConfiguration.sandboxRoots`,
     * and they are the default; given here, these replace them for this call. A configuration that records none (a hand-built
     * `merge()` input) and no option is a programmer error.
     */
    readonly sandboxRoot?: string | readonly string[];
    readonly limits?: Partial<ExpandLimits>;
}
/** One file a pattern matched. */
export interface GlobMatch {
    /** The route the walk took, named in the pattern's own terms: lexical, links not followed (v1.13's logical path). */
    readonly location: string;
    /** Where the file really is (the host's `canonicalize`); present only when it differs from `location`. */
    readonly physical?: string;
    /** The pattern's own span, so that `why()`-style provenance can name the layer and line that selected this file. */
    readonly span: SourceSpan;
}
interface ExpandedBase {
    /** RFC 6901 pointer to the pattern in the merged configuration. */
    readonly pointer: string;
    readonly pattern: string;
    readonly span: SourceSpan;
}
/** One value's outcome: its matches (possibly none), or the diagnostics that refuse it. */
export type ExpandedGlob = (ExpandedBase & {
    readonly ok: true;
    readonly matches: readonly GlobMatch[];
}) | (ExpandedBase & {
    readonly ok: false;
    readonly diagnostics: readonly Diagnostic[];
});
export interface ExpandResult {
    /** Every value at a position that admits `glob`, in the merged tree's order. */
    readonly expansions: readonly ExpandedGlob[];
    /** The refusals of `expansions`, flattened in the same order. */
    readonly diagnostics: readonly Diagnostic[];
}
/**
 * `compareByCodePoint` without building two arrays per call -- the frontier compares keys a great many times. UTF-16 order and
 * code point order agree unless one of the first differing units is a surrogate (CLAUDE.md's trap), and that case is handed to
 * `compareByCodePoint` itself; `tests/unit/expand-revision.test.ts` checks the two agree.
 */
export declare function compareRoutes(a: string, b: string): number;
/**
 * Expand every `glob` value of `configuration`: each one's matches, or the diagnostics that refuse it (FR-012). `configuration`
 * is a `MergedConfiguration` (`load()`'s `configuration`, or `merge()`'s); the values expanded are those at positions whose
 * accumulated demand admits `glob`, alone, in a list, in a union, or through a named type. Other values are untouched.
 */
export declare function expand(configuration: MergedConfiguration, options: ExpandOptions): Promise<ExpandResult>;
export {};
//# sourceMappingURL=expand.d.ts.map