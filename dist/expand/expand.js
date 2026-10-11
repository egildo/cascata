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
import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { compareByCodePoint } from "../model/node.js";
import { posixPaths } from "../paths.js";
import { isWithinSandbox, namedDocument, PhysicalPaths, toAbsoluteSandboxRoots } from "../resolve/location.js";
import { checkGlobPattern, compileGlobSegment, isWildcardSegment, matchesGlobSegment, splitGlob } from "../validate/glob.js";
import { globBase } from "../validate/globbase.js";
import { globValues } from "./positions.js";
/** FR-018: the walk of one value may visit this many directory entries before it is refused. */
export const DEFAULT_MAX_STEPS = 100_000;
const HTTPS_LOCATION_PATTERN = /^https:\/\//i;
class Refusal extends Error {
    diagnostic;
    constructor(diagnostic) {
        super(diagnostic.message);
        this.diagnostic = diagnostic;
    }
}
/**
 * `compareByCodePoint` without building two arrays per call -- the frontier compares keys a great many times. UTF-16 order and
 * code point order agree unless one of the first differing units is a surrogate (CLAUDE.md's trap), and that case is handed to
 * `compareByCodePoint` itself; `tests/unit/expand-revision.test.ts` checks the two agree.
 */
export function compareRoutes(a, b) {
    const shared = Math.min(a.length, b.length);
    for (let index = 0; index < shared; index += 1) {
        const unitA = a.charCodeAt(index);
        const unitB = b.charCodeAt(index);
        if (unitA !== unitB) {
            return (unitA >= 0xd800 && unitA <= 0xdfff) || (unitB >= 0xd800 && unitB <= 0xdfff) ? compareByCodePoint(a, b) : unitA - unitB;
        }
    }
    return a.length - b.length;
}
function compareSteps(a, b) {
    return compareRoutes(a.key, b.key) || a.seg - b.seg;
}
/** A binary min-heap of steps. */
class Frontier {
    items = [];
    push(step) {
        const items = this.items;
        items.push(step);
        let index = items.length - 1;
        while (index > 0) {
            const parent = (index - 1) >> 1;
            const child = items[index];
            const above = items[parent];
            if (child === undefined || above === undefined || compareSteps(above, child) <= 0) {
                break;
            }
            items[index] = above;
            items[parent] = child;
            index = parent;
        }
    }
    pop() {
        const items = this.items;
        const top = items[0];
        const last = items.pop();
        if (top === undefined || last === undefined) {
            return undefined;
        }
        if (items.length > 0) {
            items[0] = last;
            let index = 0;
            for (;;) {
                const left = 2 * index + 1;
                const right = left + 1;
                let smallest = index;
                const here = items[smallest];
                const leftStep = items[left];
                if (leftStep !== undefined && here !== undefined && compareSteps(leftStep, here) < 0) {
                    smallest = left;
                }
                const best = items[smallest];
                const rightStep = items[right];
                if (rightStep !== undefined && best !== undefined && compareSteps(rightStep, best) < 0) {
                    smallest = right;
                }
                if (smallest === index) {
                    break;
                }
                const swap = items[smallest];
                if (swap === undefined || here === undefined) {
                    break;
                }
                items[smallest] = here;
                items[index] = swap;
                index = smallest;
            }
        }
        return top;
    }
}
function requireOptions(options) {
    const host = options?.host;
    if (typeof host !== "object" || host === null || !("canonicalize" in host) || typeof host.canonicalize !== "function") {
        throw new Error("expand() requires 'host' (v1.14 FR-012, SPEC.md Article VI) -- there is no default; pass the host that resolved the configuration (createNodeHost() or createMemoryHost())");
    }
    if ("list" in host && host.list !== undefined && typeof host.list !== "function") {
        throw new Error("expand() was given a 'host' whose 'list' is not a function (v1.14 FR-009) -- omit the member entirely for a host that cannot list a directory");
    }
    const granted = options.sandboxRoot;
    if (granted !== undefined) {
        const members = typeof granted === "string" ? [granted] : granted;
        if (!Array.isArray(members) || members.length === 0 || members.some((root) => typeof root !== "string" || root.length === 0)) {
            throw new Error("expand() requires 'sandboxRoot' to be a non-empty location, or a non-empty list of them, every member a non-empty string, exactly as resolve() takes it (v1.14 FR-012, FR-025)");
        }
    }
    const cap = options.limits?.maxSteps;
    if (cap !== undefined && (!Number.isInteger(cap) || cap < 0)) {
        throw new Error("expand() was given a 'limits.maxSteps' that is not a non-negative integer (v1.14 FR-018)");
    }
}
function refusal(value, code, message) {
    return new Refusal(createDiagnostic({ code, level: "error", message, primary: value.node.span, pointer: value.pointer }));
}
async function walk(value, ctx) {
    const pattern = value.node.value;
    const span = value.node.span;
    const anchored = globBase(ctx.configuration, value.pointer);
    if (anchored.kind !== "glob") {
        return [];
    }
    const rest = splitGlob(pattern).rest;
    const compiled = new Map();
    const separator = ctx.separator;
    const join = (dir, name) => (dir.endsWith(separator) ? `${dir}${name}` : `${dir}${separator}${name}`);
    const stepFor = (dir, seg) => ({ dir, key: dir.endsWith(separator) ? dir : `${dir}${separator}`, seg });
    const work = { units: 0 };
    /** FR-027: the limit counts work. */
    const spend = (units) => {
        work.units += units;
        if (work.units > ctx.limit) {
            throw refusal(value, "glob-limit-exceeded", `expanding the glob '${pattern}' did more than ${ctx.limit} units of work (each directory entered at each pattern position, and each entry examined there; limits.maxSteps); raise it in expand()'s options if the tree and the pattern are really that large`);
        }
    };
    const escape = (location, physical) => refusal(value, "sandbox-escape", `expanding the glob '${pattern}' reached ${namedDocument(location, physical)}, which is outside the sandbox (${ctx.roots.map((root) => `'${root}'`).join(", ")}); a pattern is confined as a reference is, through the physical path`);
    /** The physical path of `location`, refusing the value if it is outside the sandbox. */
    async function confined(location) {
        const physical = await ctx.physical.of(location);
        if (!(await isWithinSandbox(ctx.physical, location, ctx.roots))) {
            throw escape(location, physical);
        }
        return physical;
    }
    /** The host's answer for a directory, asked once per call. */
    async function rawListing(dir, physicalDir) {
        let answer = ctx.listings.get(physicalDir);
        if (answer === undefined) {
            if (ctx.host.list === undefined) {
                throw refusal(value, "host-cannot-list", `cannot expand the glob '${pattern}': the host has no 'list', so it cannot list a directory (loading and validating never needed one)`);
            }
            answer = await ctx.host.list(dir);
            ctx.listings.set(physicalDir, answer);
        }
        return answer;
    }
    function unlistable(dir, physicalDir, reason) {
        return refusal(value, "directory-unlistable", `cannot expand the glob '${pattern}': the host could not list the directory ${namedDocument(dir, physicalDir)}: ${reason}`);
    }
    /**
     * What the stored path `physicalPath` is, by asking its stored parent (FR-024: "the kind"). A sandbox root is a directory
     * (its parent is outside the sandbox and is not asked). `undefined` where the parent has no such name.
     */
    async function kindOf(physicalPath) {
        for (const root of ctx.roots) {
            if ((await ctx.physical.of(root)) === physicalPath) {
                return "directory";
            }
        }
        const parent = ctx.dirname(physicalPath);
        if (parent === physicalPath) {
            return "directory";
        }
        if (!(await isWithinSandbox(ctx.physical, parent, ctx.roots))) {
            return "other";
        }
        const answer = await rawListing(parent, parent);
        if (!answer.ok) {
            throw unlistable(parent, parent, answer.reason);
        }
        spend(1);
        let index = ctx.kinds.get(parent);
        if (index === undefined) {
            index = new Map(answer.entries.map((entry) => [entry.name, entry.kind]));
            ctx.kinds.set(parent, index);
        }
        return index.get(physicalPath.slice(parent.endsWith(separator) ? parent.length : parent.length + separator.length));
    }
    /** The entries of a directory that exists; `undefined` if it is not a directory at all (a file where one was wanted). Refused by the host: directory-unlistable. */
    async function listed(dir, physicalDir) {
        const answer = await rawListing(dir, physicalDir);
        if (answer.ok) {
            return answer.entries;
        }
        const kind = await kindOf(physicalDir);
        if (kind !== undefined && kind !== "directory") {
            return undefined;
        }
        throw unlistable(dir, physicalDir, answer.reason);
    }
    const frontier = new Frontier();
    const visited = new Set();
    const found = new Map();
    function record(location, physical) {
        const existing = found.get(physical);
        if (existing === undefined || compareByCodePoint(location, existing) < 0) {
            found.set(physical, location);
        }
    }
    frontier.push(stepFor(anchored.directory, 0));
    for (let current = frontier.pop(); current !== undefined; current = frontier.pop()) {
        let seg = current.seg;
        while (rest[seg] === "." && seg < rest.length - 1) {
            seg += 1;
        }
        const segment = rest[seg];
        if (segment === undefined || segment === ".") {
            continue;
        }
        const dir = current.dir;
        // Confinement first (a missing directory outside the sandbox is an escape, not an empty list), then whether it is there at all.
        const physicalDir = await confined(dir);
        const state = `${physicalDir}\u0000${seg}`;
        if (visited.has(state)) {
            continue;
        }
        visited.add(state);
        if ((await ctx.physical.exact(dir)) === undefined) {
            continue; // FR-026: a directory that is not there matches nothing
        }
        spend(1);
        const last = seg === rest.length - 1;
        if (segment !== "**" && !isWildcardSegment(segment)) {
            // FR-024: a literal is found as a path is -- asked of the host by its written spelling, and named by it.
            const child = join(dir, segment);
            if (!last) {
                frontier.push(stepFor(child, seg + 1));
                continue;
            }
            const stored = await ctx.physical.exact(child);
            if (stored === undefined) {
                continue;
            }
            await confined(child);
            if ((await kindOf(stored)) === "file") {
                record(child, stored);
            }
            continue;
        }
        const entries = await listed(dir, physicalDir);
        if (entries === undefined) {
            continue;
        }
        spend(entries.length);
        const sorted = [...entries].sort((a, b) => compareByCodePoint(a.name, b.name));
        async function candidate(name) {
            const location = join(dir, name);
            record(location, await confined(location));
        }
        if (segment === "**") {
            if (!last) {
                frontier.push(stepFor(dir, seg + 1));
            }
            for (const entry of sorted) {
                if (entry.name.startsWith(".")) {
                    continue;
                }
                if (entry.kind === "directory") {
                    frontier.push(stepFor(join(dir, entry.name), seg));
                }
                else if (entry.kind === "file" && last) {
                    await candidate(entry.name);
                }
            }
        }
        else {
            let cp = compiled.get(seg);
            if (cp === undefined) {
                cp = compileGlobSegment(segment);
                compiled.set(seg, cp);
            }
            for (const entry of sorted) {
                if (!matchesGlobSegment(cp, entry.name)) {
                    continue;
                }
                if (last) {
                    if (entry.kind === "file") {
                        await candidate(entry.name);
                    }
                }
                else if (entry.kind === "directory") {
                    frontier.push(stepFor(join(dir, entry.name), seg + 1));
                }
            }
        }
    }
    return [...found]
        .map(([physical, location]) => ({ location, ...(physical === location ? {} : { physical }), span }))
        .sort((a, b) => compareByCodePoint(a.location, b.location));
}
async function expandOne(value, ctx) {
    const base = { pointer: value.pointer, pattern: value.node.value, span: value.node.span };
    try {
        const origin = value.node.span.origin;
        if (HTTPS_LOCATION_PATTERN.test(origin.id)) {
            throw refusal(value, "glob-in-remote-document", `cannot expand the glob '${base.pattern}': it was written in '${origin.id}', a document read over https://, and HTTP has no directory listing -- a remote pattern is never expanded`);
        }
        if (ctx.host.list === undefined) {
            throw refusal(value, "host-cannot-list", `cannot expand the glob '${base.pattern}': the host has no 'list', so it cannot list a directory (loading and validating never needed one)`);
        }
        return { ...base, ok: true, matches: await walk(value, ctx) };
    }
    catch (error) {
        if (error instanceof Refusal) {
            return { ...base, ok: false, diagnostics: [error.diagnostic] };
        }
        throw error;
    }
}
/**
 * Expand every `glob` value of `configuration`: each one's matches, or the diagnostics that refuse it (FR-012). `configuration`
 * is a `MergedConfiguration` (`load()`'s `configuration`, or `merge()`'s); the values expanded are those at positions whose
 * accumulated demand admits `glob`, alone, in a list, in a union, or through a named type. Other values are untouched.
 */
export async function expand(configuration, options) {
    requireOptions(options);
    const host = options.host;
    const paths = host.paths ?? posixPaths;
    const granted = options.sandboxRoot;
    let roots;
    if (granted !== undefined) {
        roots = toAbsoluteSandboxRoots(granted, paths);
    }
    else if (configuration.sandboxRoots !== undefined && configuration.sandboxRoots.length > 0) {
        roots = configuration.sandboxRoots;
    }
    else {
        throw new Error("expand() requires 'sandboxRoot' (v1.14 FR-025): this configuration records none (it was not made by resolve() and merge()) and none was given; there is no default and none is inferred");
    }
    const ctx = {
        configuration,
        host,
        physical: new PhysicalPaths(host),
        roots,
        limit: options.limits?.maxSteps ?? DEFAULT_MAX_STEPS,
        separator: paths.separator,
        dirname: paths.dirname,
        listings: new Map(),
        kinds: new Map(),
    };
    const expansions = [];
    for (const value of globValues(configuration)) {
        expansions.push(await expandOne(value, ctx));
    }
    return { expansions, diagnostics: expansions.flatMap((expansion) => (expansion.ok ? [] : expansion.diagnostics)) };
}
//# sourceMappingURL=expand.js.map