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
const REFUSED_CHARACTERS = new Map([
    ["[", "character classes"],
    ["]", "character classes"],
    ["{", "brace alternation"],
    ["}", "brace alternation"],
    ["\\", "escapes"],
]);
function refusal(offset, message) {
    return { ok: false, offset, message: `${message} at offset ${offset}` };
}
/**
 * Whether `pattern` is in the grammar, or the first offence by position (offsets count code points from 0).
 * The empty-segment and trailing-slash offences are reported at the slash that makes them.
 */
export function checkGlobPattern(pattern, counter) {
    if (pattern.length === 0) {
        return refusal(0, "the pattern is empty (it names no file)");
    }
    let index = 0; // code-point offset of the code point being visited
    let segmentStart = 0; // code-point offset where the current segment starts
    let dots = 0; // `.` count, meaningful while `onlyDots`
    let onlyDots = true; // every code point of this segment so far is `.`
    let segmentHasWildcard = false;
    let wildcardBefore = false; // a segment before this one contained a wildcard
    let runStart = -1; // start of the current run of `*`, or -1
    let runLength = 0;
    let slashEnds = -1; // offset of a slash that is the last code point so far, or -1
    /** A run of `*` just ended; `wholeSegment` is whether the segment ends with it. Only exactly `**` as a whole segment is a run that is allowed. */
    const endRun = (wholeSegment) => {
        const bad = runLength >= 2 && !(wholeSegment && runStart === segmentStart && runLength === 2);
        const start = runStart;
        runStart = -1;
        runLength = 0;
        return bad ? refusal(start, "'**' is only allowed as a whole segment (a run of two or more '*' that is not exactly the segment '**')") : undefined;
    };
    /** The segment that just ended: a `..` after a wildcard segment is refused (FR-002). */
    const judgeSegment = () => {
        if (onlyDots && dots === 2 && wildcardBefore) {
            return refusal(segmentStart, "'..' after a segment containing a wildcard (a pattern's literal prefix is computed lexically, so it may not climb after a wildcard)");
        }
        if (segmentHasWildcard) {
            wildcardBefore = true;
        }
        return undefined;
    };
    for (const character of pattern) {
        if (counter !== undefined) {
            counter.steps += 1;
        }
        if (character === "*") {
            if (runStart === -1) {
                runStart = index;
            }
            runLength += 1;
            segmentHasWildcard = true;
            onlyDots = false;
            slashEnds = -1;
            index += 1;
            continue;
        }
        const ended = endRun(character === "/");
        if (ended !== undefined) {
            return ended;
        }
        if (character === "/") {
            if (index === 0) {
                // The absolute marker: not a segment boundary; the first segment starts after it.
                segmentStart = 1;
            }
            else {
                if (segmentStart === index) {
                    return refusal(index, "empty segment (two '/' in a row)");
                }
                const judged = judgeSegment();
                if (judged !== undefined) {
                    return judged;
                }
                segmentStart = index + 1;
                dots = 0;
                onlyDots = true;
                segmentHasWildcard = false;
            }
            slashEnds = index;
            index += 1;
            continue;
        }
        slashEnds = -1;
        if (character === ".") {
            dots += 1;
        }
        else {
            onlyDots = false;
            if (character === "?") {
                segmentHasWildcard = true;
            }
            else {
                const refused = REFUSED_CHARACTERS.get(character);
                if (refused !== undefined) {
                    return refusal(index, `'${character}' is not part of the glob grammar (${refused} are refused, so the grammar can grow without changing a meaning)`);
                }
                if (character === "!" && index === 0) {
                    return refusal(index, "a leading '!' (negation) is not part of the glob grammar");
                }
            }
        }
        index += 1;
    }
    const lastRun = endRun(true);
    if (lastRun !== undefined) {
        return lastRun;
    }
    if (slashEnds !== -1) {
        return refusal(slashEnds, "a trailing '/' (the last segment is empty)");
    }
    return judgeSegment() ?? { ok: true };
}
/** Cut a pattern that `checkGlobPattern` accepted into its literal prefix and the rest. Lexical: nothing is read. */
export function splitGlob(pattern) {
    const absolute = pattern.startsWith("/");
    const segments = (absolute ? pattern.slice(1) : pattern).split("/");
    const firstWildcard = segments.findIndex((segment) => segment.includes("*") || segment.includes("?"));
    const cut = firstWildcard === -1 ? segments.length - 1 : firstWildcard;
    return { absolute, literal: segments.slice(0, cut), rest: segments.slice(cut) };
}
/** Whether one segment of an accepted pattern contains a wildcard (`*` or `?`) -- the others are literals. */
export function isWildcardSegment(segment) {
    return segment.includes("*") || segment.includes("?");
}
/** The code points of a segment, split once so that matching it against many names does not split it again. */
export function compileGlobSegment(segment) {
    return Array.from(segment, (character) => character.codePointAt(0) ?? 0);
}
const STAR = 0x2a;
const QUESTION = 0x3f;
const DOT = 0x2e;
/**
 * Whether `name` matches one compiled wildcard segment (v1.14 FR-002, FR-014, FR-015): `*` any run of code points (possibly
 * empty), `?` exactly one, every other code point itself, **compared exactly** -- no case or Unicode normalization. A name
 * whose first code point is `.` is matched only by a segment whose first code point is a literal `.`: a wildcard never
 * matches a leading dot. The greedy two-pointer walk backtracks only to the last `*`, so it is O(segment x name) and never
 * exponential.
 */
export function matchesGlobSegment(segment, name) {
    const codePoints = Array.from(name, (character) => character.codePointAt(0) ?? 0);
    if (codePoints[0] === DOT && (segment[0] === STAR || segment[0] === QUESTION)) {
        return false;
    }
    let patternIndex = 0;
    let nameIndex = 0;
    let starIndex = -1;
    let resume = 0;
    while (nameIndex < codePoints.length) {
        const patternCode = segment[patternIndex];
        if (patternCode === STAR) {
            starIndex = patternIndex;
            resume = nameIndex;
            patternIndex += 1;
        }
        else if (patternCode !== undefined && (patternCode === QUESTION || patternCode === codePoints[nameIndex])) {
            patternIndex += 1;
            nameIndex += 1;
        }
        else if (starIndex !== -1) {
            patternIndex = starIndex + 1;
            resume += 1;
            nameIndex = resume;
        }
        else {
            return false;
        }
    }
    while (segment[patternIndex] === STAR) {
        patternIndex += 1;
    }
    return patternIndex === segment.length;
}
//# sourceMappingURL=glob.js.map