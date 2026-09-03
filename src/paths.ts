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

/**
 * The four path operations this library performs, plus the two
 * environment values it needs, as one object a `Host` may supply.
 *
 * Deliberately **synchronous and tiny**. Every existing caller is
 * synchronous (`resolveReferenceLocation`, `classifyReferenceLocation`,
 * `resource`), and an async answer here would turn a lexical calculation
 * into a promise for no gain — the host knows all six of these without
 * touching the world. It is also not a general path library: no `join`,
 * no `relative`, no `basename`, no `normalize`, because nothing in
 * Cascata calls them and a seam is a promise about every member it has.
 */
export interface PathFacility {
  /** What separates two path segments — `"/"` on POSIX, `"\\"` on Windows. Used only by the sandbox containment check, which must not read `/sandboxfoo` as inside `/sandbox`. */
  readonly separator: string;

  /**
   * The user's home directory, or `undefined` in a realm that has none.
   *
   * `undefined` is a real answer, not a missing one: a browser realm has
   * no home directory, and a config-authored `~/config.yaml` there stays
   * the literal relative path it looks like rather than expanding to an
   * invented one (SPEC.md §9, v0.2 FR-029 — the expansion exists because
   * a *user's* configuration may name their own home, which presupposes
   * there is one).
   */
  readonly homeDirectory: string | undefined;

  /** The directory containing `path` — `node:path`'s `dirname`. */
  dirname(path: string): string;

  /** Whether `path` is absolute in this realm's terms — `node:path`'s `isAbsolute`. Windows says yes to `C:\\x` and to `\\\\server\\share`; POSIX says no to both. */
  isAbsolute(path: string): boolean;

  /**
   * Resolve `base` (and `segment`, when given) into one absolute,
   * normalized path — `node:path`'s `resolve`. Right to left: an absolute
   * `segment` discards `base` entirely, `.`/`..` are collapsed, and a
   * result that is still relative is resolved against the realm's working
   * directory.
   *
   * Two fixed parameters rather than `...segments: string[]`, though
   * `node:path.resolve` accepts any number: nothing in this library
   * passes more than two, and a rest parameter here would invite the
   * call-site spread `tests/unit/validate-totality.test.ts` sweeps `src/`
   * for. A seam should not offer a shape its own codebase forbids.
   */
  resolve(base: string, segment?: string): string;
}

/** Whether `path` is absolute in POSIX terms. */
function posixIsAbsolute(path: string): boolean {
  return path.startsWith("/");
}

/**
 * `node:path.posix.dirname`'s rules, which are not quite "everything
 * before the last slash": a trailing slash is ignored (`dirname("/a/b/")`
 * is `"/a"`, not `"/a/b"`), a path with no slash at all has dirname
 * `"."`, and the root is its own parent.
 */
function posixDirname(path: string): string {
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
    } else {
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
function posixResolve(base: string, segment?: string): string {
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

  const output: string[] = [];
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
export const posixPaths: PathFacility = {
  separator: "/",
  homeDirectory: undefined,
  dirname: posixDirname,
  isAbsolute: posixIsAbsolute,
  resolve: posixResolve,
};
