/**
 * `globBase` -- the base query for a `glob` value, beside `resource()` (SPEC.md §7, v1.14 FR-007).
 *
 * A **query, not a check**: no diagnostic at any level, no host, nothing read or confined (FR-005). It answers where a
 * pattern is anchored: the directory of the document that declared the value, joined with the pattern's literal prefix, by
 * the same medium rule `resource()` follows (v1.13: a file's logical directory, a remote document's physical URL, with
 * `otherDirectory` where the other rule would anchor it elsewhere). `expand()` starts its walk from `directory`.
 */
import { resolvePointer } from "../model/pointer.js";
import { checkGlobPattern, splitGlob } from "./glob.js";
import { locateFromDocument } from "./resource.js";
/** Where the `glob` value at `pointer` is anchored. `not-a-glob` for anything that is not a string the grammar accepts. */
export function globBase(configuration, pointer) {
    const node = resolvePointer(configuration.tree, pointer);
    if (node === undefined) {
        return { kind: "unknown-pointer" };
    }
    if (node.type !== "scalar" || node.kind !== "string" || !checkGlobPattern(node.value).ok) {
        return { kind: "not-a-glob" };
    }
    const { absolute, literal } = splitGlob(node.value);
    const literalPrefix = `${absolute ? "/" : ""}${literal.join("/")}`;
    const where = locateFromDocument(configuration, node.span.origin, literalPrefix, true);
    return {
        kind: "glob",
        pattern: node.value,
        literalPrefix,
        directory: where.location,
        ...(where.otherLocation === undefined ? {} : { otherDirectory: where.otherLocation }),
        span: node.span,
    };
}
//# sourceMappingURL=globbase.js.map