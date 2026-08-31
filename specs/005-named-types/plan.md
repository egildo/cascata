# Implementation Plan: Named Types & Nested Demands

**Branch**: `005-named-types` *(spec directory; no separate git branch — main)* | **Date**: 2026-08-31
| **Spec**: [spec.md](./spec.md)

## Summary

Two independent obligations land together. **Named types** (§7): a schema's `types:` section becomes
real, resolved per-layer (root-to-usage-layer scope, never a merged graph), with a closed
declaration-entry vocabulary, unconditional collision detection (both unqualified and `$id`-qualified
namespaces), cycle refusal, and `accept` as a real narrowing selector. **Nested demands** (§9,
amended): `keys` moves from unimplemented to real, and `items` generalizes from v0.4's one-level cap
to arbitrary depth, both bounded by a reused depth limit.

Phase 0 found one thing worth stating plainly: the milestone's hardest question was not a probe, it
was reconciling `spec.md` §7's discursive "narrowing" prose against its own decided, unconditional
collision Acceptance Scenarios and §5.2's unconditional "redefine: Never" table cell. Resolved as
research.md D1: collision is unconditional; narrowing is usage-level `accept` only; type-entry
redeclaration is not a mechanism this milestone implements at all. This makes the coordinating brief's
own suggested FR-008 sabotage ("a descendant redefines a type") unconstructible as a green-path case
under this reading — reported, not silently substituted, per D1's own note.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict` + `noUncheckedIndexedAccess`, Node LTS

**Primary Dependencies**: none added. `yaml` and `picomatch` remained the only runtime dependencies at plan time; **stale as of `SPEC.md` §15** (commit 4fbb2b1) — `glob` left the built-in type set mid-milestone and `picomatch` left with it, leaving `yaml` alone.

**Testing**: Vitest, table-driven, plus property tests for the two §5.2 rows this milestone newly
makes fully constructible (Types (named), and Struct openness stays deferred — `seal` is still v0.7,
named as deferred again, third time per FR-029).

**Scale/Scope**: 31 FRs; one new module (`src/validate/types.ts`); a substantial generalization of
`src/validate/check.ts`'s walk from one-level to recursive; `src/validate/constraints.ts` gains a
type-resolution parameter threaded through `checkType`; six new diagnostic codes, two reused.

## Constitution Check

| Principle | Gate | Status |
|---|---|---|
| **I. Specification Supremacy** | Cite `SPEC.md`; implement nothing it does not sanction | **PASS, with one flagged tension recorded, not resolved** — research.md D1; the owner's own task brief explicitly authorized recording rather than resolving it. |
| **II. Monotonicity** | Property tests per newly-constructible §5.2 row | Types (named) row discharged as a property test (FR-029); Struct openness still deferred (v0.7, unchanged). |
| **III. Provenance Is Structural** | Gate 5 at full strength | **PASS** — every value-violation diagnostic carries pointer+demand+pedigreePosition; the two namespace codes omit `pointer` for the same reason v0.4's vocabulary codes do (no merged-configuration position to name). |
| **IV. Stages Isolated, Format-Blind** | No new boundary crossing | **PASS** — everything lives inside the already-policed `src/validate/`; no new directory. |
| **V. Citations Are Test Oracles** | Corpus before conforming code; probe gate | **PASS** — research.md D4/D5 probed before being written down. |
| **VI. Closed Vocabulary, Deny by Default** | — | **PASS** — a type entry's vocabulary is closed (FR-002); an unqualified/qualified collision is refused, never silently shadowed. |
| **Technology & Security** | No new dependency | **PASS** — none added. |

**Post-Phase-1 re-check**: PASS. Complexity Tracking is empty — no deviation from a principle, only
from the coordinating brief's suggested (but, per D1, unconstructible) sabotage wording, which is a
finding, not a deviation.

## Project Structure

```text
specs/005-named-types/
├── plan.md, research.md, data-model.md, quickstart.md
├── contracts/
│   ├── type-resolution.md      # collision, qualification, accept semantics
│   ├── nested-demands.md       # keys/items generalization, depth limit
│   └── diagnostics.md          # v0.5's new codes
└── tasks.md

src/validate/
├── types.ts          # NEW — types: reading, collision/qualifier detection, cycle check, resolution
├── vocabulary.ts      # keys/accept leave UNIMPLEMENTED_DEMAND_KEYWORDS; new type-entry vocabulary reader
├── check.ts            # generalized recursive walk (keys/items to arbitrary depth); type-scope threaded in
├── constraints.ts      # checkType gains a resolution parameter; accept becomes a real leaf check
└── violation.ts         # Demand gains declaresIn; ViolationReason gains accept-widened

tests/
├── corpus/cases/validate-types/, validate-nested/   # NEW fixture families
└── unit/validate-type-monotonicity.test.ts           # NEW property test
```

## Complexity Tracking

Empty. The one substantial judgment call (research.md D1) is a specification-interpretation decision,
not a principle deviation, and is recorded there and in the milestone report rather than here.
