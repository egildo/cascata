/**
 * `cascata/generate` — the pure stage, on its own.
 *
 * `SPEC.md` Article VIII: "Emitters are translations of the tree, and
 * thin." `accumulate()` and `generate()` need no host, touch no disk, and
 * know nothing about where a document came from — so they are reachable
 * without importing the package root at all, exactly as `project()` is
 * reachable without `load()` (Principle IV). A tool that already has the
 * schema layers in hand — a language server, a second emitter, a JSON
 * Schema exporter (v1.2) — imports this and nothing else.
 *
 * `generateTypes()` is **not** here: it needs `resolve()`, so it lives
 * beside `load()` in the package root (plan P-7, FR-032).
 */
export { accumulate, intersectionKeyOf } from "./accumulate.js";
export { generate } from "./emit.js";
export { aliasName, propertyName, qualifiedAlias } from "./identifiers.js";
//# sourceMappingURL=index.js.map