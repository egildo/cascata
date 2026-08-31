# Implementation Plan: Delegation (Transclusion)

**Branch**: `006-delegation` (spec directory only) | **Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-delegation/spec.md`

## Summary

A schema grants one key `delegate: allow`; a config supplying a string there gets that file's
contents grafted in as the subtree at that position, before merge and validation, indistinguishable
from having been written inline. `src/index.ts` (the orchestrator) reads the grants and the config's
own tree and performs the graft, reusing `src/graph/build.ts`'s `resolveAllBranches`
and `src/resolve/location.ts`'s sandbox/scheme primitives; `src/graph/` and `src/resolve/` gain no
new knowledge of `delegate` (Principle IV, FR-008a). A per-value delegation breadcrumb — the last of
Principle III's phased diagnostic fields — becomes real. **SETTLED**: `GraphBuilder` itself turned
out not to be reusable for cycle detection (its dedup is location-keyed, wrong for FR-013a's
independent-per-graft-provenance requirement); a separate `DelegationCycleTracker` was built
instead. See `research.md` D1's own correction.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict` + `noUncheckedIndexedAccess`, Node LTS

**Primary Dependencies**: none added. `yaml` remains the only runtime dependency.

**Testing**: Vitest, table-driven corpus cases plus property tests for the two new/newly-constructible
§5.2-adjacent guarantees this milestone adds (identical-to-inline merge, sandbox confinement).

**Scale/Scope**: 29 FRs; one new module (`src/resolve/delegate.ts`, grant-tree reading + transclusion,
the orchestrator's own helper — kept out of `src/graph/`/`src/validate/` per FR-008a); `src/index.ts`
gains the orchestration step between pedigree resolution and graph assembly; `src/merge/provenance.ts`
gains `MergedConfiguration.delegationBreadcrumbs`; `src/diagnostics/diagnostic.ts` gains
`Diagnostic.delegatedFrom`; `src/validate/violation.ts`/`check.ts` gain breadcrumb rendering and
`layerForSpanOrigin`'s fallback; four new diagnostic codes, five reused.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. `tsc` clean, no `any`, no assertion casts on the node model — planned: yes; `src/resolve/delegate.ts`
   builds fresh `Node`s only via `src/model/node.ts`'s existing constructors, never a cast.
2. Conformance corpus green for every standard touched — planned: a new
   `tests/corpus/cases/validate-delegation/` tree plus `tests/corpus/validate-cases/T0xx-*.json`
   (or a new `delegate-cases/` corpus family, decided in Phase 2/tasks.md).
3. Monotonicity property tests — the identical-to-inline claim (FR-014, SC-001) and sandbox
   confinement (SC-004) are exactly the two properties worth a random-trial property test here, since
   the merge/validate monotonicity table itself gains no *new* row from this milestone (delegation is
   orthogonal to `demand`/`cascade`/`types`, per §8.2's "no merge interaction" claim) — see
   `tests/unit/delegation-monotonicity.test.ts`.
4. No new runtime dependency — holds.
5. Every new diagnostic carries code + sentence + primary span + document, plus `pointer`/`demand`/
   `pedigreePosition` where a violation is involved, plus the new phased field this milestone adds
   (`delegatedFrom`, present exactly when delegation occurred, absent otherwise — FR-018).
6. No import crosses the format-blindness boundary — planned: `src/resolve/delegate.ts` imports
   `src/model/`, `src/graph/`, `src/resolve/location.ts`'s primitives, and `src/diagnostics/`, never
   `src/adapters/` or `src/validate/`.

**PASS**, no flagged tensions at plan time — none arose reading `SPEC.md` §8 against this milestone's
own spec.md; both agree throughout (unlike v0.5's inherited §7 contradiction).

## Project Structure

### Documentation (this feature)

```text
specs/006-delegation/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/delegation-resolution.md
└── tasks.md
```

### Source Code

```text
src/
├── model/reference.ts       # ReferenceKind gains "delegate"
├── resolve/
│   ├── delegate.ts          # NEW — grant-tree reading, transclusion algorithm
│   └── location.ts          # unchanged, reused (isWithinSandbox, classifyReferenceLocation)
├── graph/build.ts           # unchanged — resolveAllBranches gets its first real caller (GraphBuilder itself was not reused — see research.md D1's correction)
├── index.ts                 # resolve() orchestrates the new delegation step
├── merge/provenance.ts      # MergedConfiguration.delegationBreadcrumbs
├── diagnostics/diagnostic.ts # Diagnostic.delegatedFrom
├── diagnostics/codes.ts     # four new codes
└── validate/
    ├── violation.ts         # Violation.delegatedFrom, canonicalSentence's breadcrumb clause
    └── check.ts             # layerForSpanOrigin's delegation fallback

tests/
├── corpus/cases/validate-delegation/   # NEW fixture family
├── corpus/validate-cases/T0xx-*.json   # or a dedicated delegate-cases loader — see tasks.md
└── unit/delegation-monotonicity.test.ts # NEW property tests
```

**Structure Decision**: single project, extending the existing pipeline stages in place — no new
top-level directory beyond `src/resolve/delegate.ts`, matching every prior milestone's own footprint.

## Complexity Tracking

*No Constitution Check violations.*
