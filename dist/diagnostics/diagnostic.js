/**
 * The Diagnostic shape — SPEC.md §10, data-model.md "Diagnostic", FR-018.
 *
 * `related` is what lets a duplicate key report **both** occurrences: the
 * underlying reader reports only the second, and the first is recoverable
 * by scanning key positions (research D6), so this field is load-bearing,
 * not decorative.
 *
 * **v0.4 additive fields** (specs/004-constraint-checker/data-model.md
 * "Diagnostic — additive fields"): `pointer`, `demand`, and
 * `pedigreePosition` are what constitution Principle III's gate 5 names as
 * arriving with the constraint checker — an RFC 6901 pointer, the violated
 * demand, and a pedigree position, on top of the never-phasing
 * code+sentence+primary-span floor every earlier milestone already
 * satisfies. All three are **optional**, so every pre-v0.4 construction
 * site in this codebase keeps compiling and keeps its existing assertions
 * valid with no edits — the floor never narrows, it only grows the ceiling
 * a `src/validate/`-produced diagnostic is held to.
 *
 * `demand` is typed in primitives (`pointer: string` + `SourceSpan`),
 * never in `src/merge/`'s `Layer` — `src/diagnostics/` may not import
 * `src/merge/` (`tests/unit/layering.test.ts`), and a `Layer`-typed field
 * here would invert that dependency direction for the sake of one caller.
 *
 * **v0.7 additive field**: `level` (`"error" | "info"`, SPEC.md §10, v0.7
 * FR-001) is the one field on this type with **no default** — every
 * `createDiagnostic()` call site must state it explicitly. Unlike
 * `pointer`/`demand`/`pedigreePosition` (phased fields that stay absent
 * until a milestone's own constructs exist), `level` is mandatory from the
 * moment it exists: a diagnostic with no level cannot be sorted into
 * "changes the outcome" vs. "teaches" (v0.7 FR-001's "no default that lets
 * one be omitted"). Every diagnostic constructed before this milestone is
 * `"error"` (v0.7 FR-004 — no reclassification in passing).
 */
/** Construct a Diagnostic. `level` is required (v0.7 FR-001 — no default). `related` defaults to the empty list; `pointer`/`demand`/`pedigreePosition`/`delegatedFrom` default to absent. */
export function createDiagnostic(fields) {
    return {
        code: fields.code,
        level: fields.level,
        message: fields.message,
        primary: fields.primary,
        related: fields.related ?? [],
        ...(fields.pointer !== undefined ? { pointer: fields.pointer } : {}),
        ...(fields.demand !== undefined ? { demand: fields.demand } : {}),
        ...(fields.pedigreePosition !== undefined ? { pedigreePosition: fields.pedigreePosition } : {}),
        ...(fields.delegatedFrom !== undefined ? { delegatedFrom: fields.delegatedFrom } : {}),
    };
}
//# sourceMappingURL=diagnostic.js.map