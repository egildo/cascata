/**
 * The shipped in-memory host -- SPEC.md Article VI (§16); specs/024-glob FR-011.
 *
 * ```ts
 * import { createMemoryHost } from "@egildo/cascata/host/memory";
 *
 * const host = createMemoryHost({
 *   files: { "/project/cascata.yaml": "...", "/project/docs/a.md": "..." },
 *   links: { "/project/shared": "/library/shared" }, // a location -> its target: a file or a directory
 * });
 * ```
 *
 * For tests and for embedders with no disk (a browser tab, a virtual file system). It answers `read`, `canonicalize`
 * (following `links`, in the path and at its end), `paths` (POSIX), and `list`, and has **no cache**: `cacheRead` finds
 * nothing and `cacheWrite` keeps nothing, so a remote document is fetched each time. It imports nothing platform-specific
 * -- only `src/paths.ts`'s POSIX facility -- so unlike `host/node.ts` it is not exempt from the realm sweep in
 * `tests/unit/layering.test.ts`: it is policed like the library proper. Shipping a host is not the library performing I/O,
 * as the Node host never was.
 *
 * **The model**, small on purpose. A location is a POSIX path, resolved against `/` (so `a/b` is `/a/b`). A directory exists
 * when something is in it (a file, or a link) -- there are no empty directories. A link's target is resolved against the
 * link's own directory, as a real symbolic link's is; a chain of links is followed (forty hops, then it is a loop and
 * answers like a missing target), and so is a link met in the middle of a path. Links are listed as the kind of what they
 * lead to; one that leads nowhere is `other`. A link's own location must not itself sit below another link.
 * Entries are listed in the order the files were given, which is arbitrary on purpose.
 */
import type { Host } from "../resolve/host.js";
export interface MemoryHostOptions {
    /** location -> content. Text is held as UTF-8. */
    readonly files?: Readonly<Record<string, string | Uint8Array>>;
    /** location of a link -> its target (a file or a directory; absolute, or relative to the link's directory). */
    readonly links?: Readonly<Record<string, string>>;
}
export declare function createMemoryHost(options?: MemoryHostOptions): Host;
//# sourceMappingURL=memory.d.ts.map