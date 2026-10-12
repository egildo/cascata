/**
 * The path facility — how a realm answers questions about *paths*
 * (issue #1).
 *
 * **Why paths are the host's business.** v0.2 through v1.4 imported
 * `node:path` (and `node:os`) directly in `src/resolve/location.ts`,
 * `src/resolve/delegate.ts` and `src/validate/resource.ts`. That is the
 * same load-time failure in a browser realm that `node:crypto` was, and
 * it does not have `node:crypto`'s answer: SHA-256 is arithmetic anyone
 * can write down, while what `dirname("C:\\a\\b")` is, whether
 * `\\server\share` is absolute, and what separates two segments are
 * facts about a *platform*. Article VI already draws that line — the host
 * answers what only the host can know — so the host answers this too.
 * `createNodeHost` hands over `node:path`'s own functions unchanged,
 * which is why Windows keeps exactly the semantics it has always had:
 * they are not reimplemented here, they are node's.
 *
 * This file sits at the root of `src/` rather than inside any stage
 * because two stages on opposite sides of a policed boundary need it —
 * `src/resolve/` and `src/validate/` — and `src/validate/` may not import
 * `src/resolve/` (Principle IV, `tests/unit/layering.test.ts`).
 */
/** Whether `path` is absolute in POSIX terms. */
function posixIsAbsolute(path) {
    return path.startsWith("/");
}
/**
 * `node:path.posix.dirname`'s rules, which are not quite "everything
 * before the last slash": a trailing slash is ignored (`dirname("/a/b/")`
 * is `"/a"`, not `"/a/b"`), a path with no slash at all has dirname
 * `"."`, and the root is its own parent.
 */
function posixDirname(path) {
    if (path.length === 0) {
        return ".";
    }
    const hasRoot = posixIsAbsolute(path);
    let end = -1;
    let sawNonSeparator = false;
    for (let i = path.length - 1; i >= 1; i -= 1) {
        if (path.charCodeAt(i) === 0x2f) {
            if (sawNonSeparator) {
                end = i;
                break;
            }
        }
        else {
            sawNonSeparator = true;
        }
    }
    if (end === -1) {
        return hasRoot ? "/" : ".";
    }
    if (hasRoot && end === 0) {
        return "/";
    }
    return path.slice(0, end);
}
/**
 * `node:path.posix.resolve`, with `"/"` standing in for the working
 * directory. Right to left until an absolute segment is found, then
 * normalized: `.` dropped, `..` popping the segment before it, and a
 * `..` that would pop past the root dropped (an absolute path has no
 * parent above `/`, which is why `resolve("/../..")` is `"/"`).
 */
function posixResolve(base, segment) {
    let resolved = "";
    for (const part of segment === undefined ? [base] : [segment, base]) {
        if (posixIsAbsolute(resolved)) {
            break;
        }
        if (part.length === 0) {
            continue;
        }
        resolved = resolved.length === 0 ? part : `${part}/${resolved}`;
    }
    // The working directory a realm without one has: the root. See
    // `PathFacility.resolve`.
    if (!posixIsAbsolute(resolved)) {
        resolved = resolved.length === 0 ? "/" : `/${resolved}`;
    }
    const output = [];
    for (const part of resolved.split("/")) {
        if (part.length === 0 || part === ".") {
            continue;
        }
        if (part === "..") {
            output.pop();
            continue;
        }
        output.push(part);
    }
    return `/${output.join("/")}`;
}
/**
 * The facility a `Host` that supplies none is given: POSIX rules, and no
 * home directory.
 *
 * A realm that is not node and does not say otherwise is overwhelmingly a
 * browser one, where locations are URL-shaped and `/` separates them.
 * This is a *default*, not an assumption forced on anyone — a host on any
 * platform may hand over its own facility, and `createNodeHost` does
 * exactly that.
 *
 * Checked against `node:path.posix` case for case in
 * `tests/unit/paths.test.ts`; `node:path` is the oracle, never this file.
 */
export const posixPaths = {
    separator: "/",
    homeDirectory: undefined,
    dirname: posixDirname,
    isAbsolute: posixIsAbsolute,
    resolve: posixResolve,
};
//# sourceMappingURL=paths.js.map