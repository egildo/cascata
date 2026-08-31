# Specification Quality Checklist: Merge Engine & Provenance

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-31
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**Validation iterations**: 1, with two corrections applied — both drawn from defect classes earlier
milestones actually shipped.

**Correction 1 — requirements with no acceptance coverage.** FR-002 (unimplemented vocabulary is
ignored, not guessed at) and FR-003 (an absent or empty `keys:` section contributes nothing) had
implementing requirements but no scenario exercising them. Two scenarios added to User Story 1. This
is the third milestone running where the gap appeared in requirements stating a *policy* rather than
describing a visible action — v0.1 hit it with FR-003 and FR-006, v0.2 with FR-022 and FR-025. It
should now be treated as a standing check rather than a recurring surprise.

**Correction 2 — a requirement asserting something no test can observe.** FR-022 originally read
"provenance MUST be produced during the fold, not reconstructed afterwards", which is an
implementation constraint with no behavioural consequence a test could distinguish. Restated as its
observable form: provenance must record what was **overridden**, including contributions that appear
nowhere in the merged result. That *is* testable, and it is the reason §10 says retrofitting is
nearly impossible — the losing values are gone once the fold completes.

**The v0.2 trap, checked for explicitly and not present.** Three v0.2 requirements described a
branching reference graph that single-parent adoption makes unconstructible. Every multi-contributor
requirement here was checked against the vocabulary before being written: a fold genuinely has N
contributors even though the pedigree is linear, because layers stack rather than branch. FR-016
(layers disagreeing on strategy), FR-019 (every contributing layer recorded), FR-020 (append names
all contributors) and SC-003 are all constructible from a config plus two schemas.

**Principle II binds for the first time, and is discharged per row.** Merge touches *provisions*, so
the constitution's monotonicity obligation applies here rather than being declared not-applicable as
it was for v0.1 and v0.2. It is scoped honestly: FR-023 encodes the `cascade: append` row, which this
vocabulary can fully construct; FR-024 encodes as much of the `Defaults (provide)` row as exists,
and **declares the rest deferred** because its "Never" clause names `demand`, which arrives in v0.4.
Simulating demands with stubs was considered and rejected — a green test asserting against a fiction
is worse than a recorded gap, and would need rewriting in v0.4 regardless.

**Deliberate departures from `SPEC.md`'s letter, recorded not hidden:**

- **`why` is a library function, not a command.** §10 and §6.1 write provenance queries as `tool why`
  and `tool certify`. v0.1 and v0.2 shipped a library with no CLI, and growing one a verb at a time
  is worse than designing it once. Deferred, not cancelled — and unlike the pinning and `$adopts`
  cases, this needs no `SPEC.md` amendment, because §10 constrains the *answer*, not the surface.
- **Provenance lives beside the tree, not on the node.** §4.1's "delegation breadcrumb lives on the
  provenance chain, not here" reads as deliberately keeping this off `Node`, and §10 already writes
  the query as taking a pointer. The accepted cost is two structures that must stay in step, which
  FR-021 makes testable by requiring "no layer supplied this" to be distinguishable from "this
  pointer names nothing".

**Constitution check** — `.specify/memory/constitution.md` v1.2.0:

- Principle I: every requirement group cites its `SPEC.md` section; no requirement contradicts the
  canon, and no amendment is needed for this milestone as specified.
- Principle II: **applicable for the first time**, scoped per row above.
- Principle III: FR-018 requires every provenance entry to carry a position in a real document, which
  extends provenance from nodes to the history behind them. Consistent with v1.2.0's phased
  diagnostic contract — the RFC 6901 pointer arrives here as the provenance *key*, though the full
  error contract still waits for v0.4.
- Principle IV: the merge engine consumes trees and produces trees; it is format-blind by
  construction and belongs above the adapter boundary.
- Principle V: FR-023 and FR-024 are the corpus-before-code obligation applied to property tests.
- Principle VI: FR-013, FR-014, and FR-015 refuse rather than coerce, and FR-002 refuses to invent
  meaning for vocabulary this milestone does not implement.
