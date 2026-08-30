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

**Validation iterations**: 1 at authoring time, plus a second round from `/speckit-analyze` once
`tasks.md` existed. Both recorded below.

**Iteration 1 finding — resolved.** Two functional requirements had no acceptance scenario exercising
them: FR-022 (the sandbox root must be caller-supplied, never inferred) and FR-025 (resolution reports
every failure it can determine, not only the first). Two scenarios were added to User Story 4. All 25
functional requirements now trace to at least one of the 23 acceptance scenarios.

This is the **same defect class** the v0.1 checklist caught at its own first iteration, and again the
requirements involved were the ones stating a policy rather than describing a visible action — the
kind that read as settled and quietly go unverified. Worth treating as a standing check rather than a
coincidence.

**Post-`/speckit-analyze` corrections (2026-08-30) — two CRITICAL.** Cross-artifact analysis found a
security property that had entered the design through a side door and never became a requirement:

- **Redirects had no functional requirement.** They appeared in this spec's *edge cases*, in research
  D4, in both contracts, and in quickstart scenario 5 — but never in the FR list. FR-013 refuses
  non-HTTPS *references*, and a redirect is not a reference, so the HTTPS guarantee had a documented
  bypass with nothing forbidding it. `/speckit-tasks` correctly produced no task, because there was no
  requirement to derive one from. Added FR-027 (every hop must satisfy FR-013, checked before it is
  followed) and FR-028 (hops are capped).
- **The redirect cap was enforced by nothing.** research D4 said "a redirect limit applies" and
  `contracts/resolve-api.md` published `maxRedirects` and `too-many-redirects`, but no task counted
  hops — so a redirect loop would never terminate, contradicting that same contract's stated "Total.
  Every input terminates." Now enforced in T042 with cases in T039.

Also closed: a stale cached document with no network had an edge case and a data-model assertion but
no requirement (now in FR-018), and a garbled setup task naming `cascata:` as a directory.

**The lesson, which differs from v0.1's.** There the defects were requirements that were unsatisfiable
or unverified. Here the defect was a requirement that was never written at all, while every downstream
artifact behaved as though it had been. An edge case is not a requirement; a research decision is not
a requirement; a diagnostic code in a contract is not a requirement. Only the FR list feeds task
generation, so anything that matters and lives solely outside it will be designed, documented,
contracted — and never built.

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

**Disagreement with `SPEC.md` §11 — raised at authoring time, now resolved.** The draft made
content-hash verification conditional on a hash being present, which read as narrowing §11's "pinned
by content hash." Raising it produced a better answer than the one proposed: the tension was not a
weakening to be justified but a misplaced decision. Pinning policy belongs to the pedigree, not the
library — §2.3's authority flows downward, and a published root legislates what its descendants must
do. §11 and §15 were amended to say the library verifies and the pedigree legislates, with the
legislation arriving alongside sealing (§6.3, roadmap v0.7). Spec and canon now agree, and FR-026
exists because that amendment made unpinned-link reportability a MUST.

The process point worth keeping: this was caught before implementation because the divergence was
written down at authoring time rather than absorbed. The equivalent divergence in v0.1 — `origin`
inside `SourceSpan` versus alongside it — was found only when an implementer questioned the artifacts,
two phases later.

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
