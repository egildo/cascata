# Specification Quality Checklist: Resolver & DAG Builder

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-29
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

**Validation iterations**: 1 (one correction applied).

**Iteration 1 finding — resolved.** Two functional requirements had no acceptance scenario exercising
them: FR-022 (the sandbox root must be caller-supplied, never inferred) and FR-025 (resolution reports
every failure it can determine, not only the first). Two scenarios were added to User Story 4. All 25
functional requirements now trace to at least one of the 23 acceptance scenarios.

This is the **same defect class** the v0.1 checklist caught at its own first iteration, and again the
requirements involved were the ones stating a policy rather than describing a visible action — the
kind that read as settled and quietly go unverified. Worth treating as a standing check rather than a
coincidence.

**Applying the v1.1.0 probe gate to this specification.** The constitution now requires that research
concluding a dependency handles something "for free" be exercised against non-ASCII, boundary, and
adversarial input first. This spec deliberately asserts **no** such conclusions — it names required
behavior (HTTP caching semantics, content hashing, UTF-8 validation) without claiming any of it comes
free from an existing component. Establishing what is actually available, and at what cost, is
`/speckit-plan`'s Phase 0 job, and the probe gate binds it there. Two areas are known to need real
probing rather than assumption:

- **Canonicalization for content hashing.** The hash covers a canonical form. Whether a suitable
  implementation exists within the constitution's frozen runtime dependency list is unknown, and if it
  does not, the choice is between implementing it (subtle — number serialization especially) or
  amending the dependency constraint. Either way it is a plan decision, not a spec assumption.
- **HTTP caching semantics.** RFC 9111 freshness is a substantial specification in its own right, and
  how much of it is genuinely required for immutable, content-addressed schema documents deserves
  scoping before it is built.

**Known disagreement with `SPEC.md`, recorded not hidden.** FR-014 makes content-hash verification
conditional on a hash being present, which narrows §11's "Remote schemas: HTTPS; pinned by content
hash." Under Principle I, `SPEC.md` governs product semantics, so **§11 requires an explicit amendment
before this requirement is implemented** — otherwise v0.2 ships behavior its constitution does not
sanction. This is exactly the drift that produced the `origin`/`SourceSpan` divergence in v0.1, caught
there only by an implementer questioning the artifacts. It is flagged here at authoring time instead.

**Carried-forward correction.** FR-001–FR-004 exist because v0.1's FR-016 demanded refusal of invalid
UTF-8 at an entry point that receives already-decoded text, where the property is unenforceable —
verified: invalid bytes become replacement characters before Cascata sees them, and the document is
accepted. v0.2 is the first milestone that reads bytes, so it is where the mandate becomes checkable.

**Constitution check** — `.specify/memory/constitution.md` v1.1.0:

- Principle I: every requirement group cites its `SPEC.md` section; the one divergence is named above
  rather than absorbed.
- Principle II (Monotonicity): still not applicable — v0.2 introduces no demand, provide, type, or
  constraint construct. Pedigree is assembled here; what it *means* for subsumption arrives in v0.4.
- Principle III: FR-023 and FR-024 extend provenance to references, so a failure in a fetched document
  traces to something the author wrote.
- Principle V: unchanged in force; the probe gate's application is scoped above.
- Principle VI: FR-013 (HTTPS only), FR-021 (schemas confined), FR-022 (root granted, never inferred)
  are all deny-by-default.
- Technology & Security Constraints: no test performs network access — recorded responses only.
