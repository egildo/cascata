/**
 * One document's pointer at another — `SPEC.md` §3, §6.1;
 * data-model.md "Reference".
 *
 * This type lives in `src/model/` rather than in `src/resolve/` because
 * both `resolve/` (which produces references) and `graph/` (which
 * consumes them) need it, and Principle IV forbids `graph/` importing
 * `resolve/`. Declaring it in each place instead — which an earlier
 * revision did — left two structurally identical shapes with no single
 * source of truth, kept in step only by the orchestrator failing to
 * compile. `model/` is the format-blind core both layers may depend on,
 * so it is the honest home.
 *
 * Behaviour stays where it belongs: constructing a `Reference` and
 * extracting one from a parsed tree are both `resolve/reference.ts`'s
 * job, and this module knows nothing about `$schema`, `$adopts`, or
 * documents. It declares shapes and imports nothing but `SourceSpan`.
 */
export {};
//# sourceMappingURL=reference.js.map