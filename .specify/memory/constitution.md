<!--
Sync Impact Report
==================
Version change: 1.1.0 → 1.1.1
Bump rationale: PATCH — factual correction, no principle changed. The Security
paragraph asserted RFC 8785 (JCS) canonicalization for $pin, which SPEC.md §6.1
withdrew during v0.2 planning. A governance document was stating as constraint
something the specification it defers to had disproven. Found by an implementer
reading both, which is the same failure mode as the v0.2 redirect gaps.

Prior report (v1.1.0) follows.

Version change: 1.0.0 → 1.1.0
Bump rationale: MINOR — Principle V materially expanded with the probe gate and
its ratification corollary. No principle removed or redefined; prior compliance
remains valid.

Modified principles:
  - V. Citations Are Test Oracles — added "The probe gate", requiring research
    that concludes a dependency works "for free" to have exercised it against
    non-ASCII, boundary, and adversarial input before the conclusion is written;
    plus the corollary that a requirement must not be ratified as a MUST until
    someone has confirmed the governed component can satisfy it. Both are drawn
    from defects v0.1 actually shipped, not from anticipated risk.

Prior report (v1.0.0, initial ratification) follows.

Modified principles at 1.0.0: none (initial adoption)

Added sections:
  - Core Principles I–VI (template provided five placeholder slots; six are
    adopted because SPEC.md legislates six distinct engineering invariants)
      I.   Specification Supremacy
      II.  Monotonicity Is an Invariant, Not a Goal
      III. Provenance Is Structural
      IV.  Pipeline Stages Are Isolated and Format-Blind
      V.   Citations Are Test Oracles
      VI.  Closed Vocabulary, Deny by Default
  - Technology & Security Constraints  (template [SECTION_2_NAME])
  - Development Workflow & Quality Gates  (template [SECTION_3_NAME])
  - Governance

Removed sections: none

Deferred items / TODOs: none. RATIFICATION_DATE is the repository
initialization date (2026-08-29); SPEC.md is v0 pre-implementation, so no
earlier adoption date exists.
-->

# Cascata Constitution

This document governs **how Cascata is built**. It is deliberately not a restatement of
`SPEC.md`, which governs **what Cascata means**. Where the two meet, Principle I settles it.

## Core Principles

### I. Specification Supremacy (NON-NEGOTIABLE)

`SPEC.md` is the normative source for every semantic question. Specs, plans, tasks, code, and
tests MUST cite the article or section they implement (`§4.2`, `§5.2`, …). Behavior that is not
derivable from `SPEC.md` MUST NOT be implemented until `SPEC.md` is amended by explicit article;
implementing it first and documenting it later is drift, and drift is a defect. Amendments append
an entry to `SPEC.md` §15 with a `§`-reference to the article they change.

Conflict rule: on product semantics `SPEC.md` wins; on engineering process this document wins.
Neither may be overridden by convenience, by a plan, or by an agent's runtime guidance file.

Rationale: `SPEC.md` closes with "amend by explicit article, never by drift." A project whose
specification can be outvoted by its implementation has no specification.

### II. Monotonicity Is an Invariant, Not a Goal

The monotone cascade (`SPEC.md` §2.1, §5.2) is protected. Every feature that touches demands,
provisions, types, or pedigree MUST preserve subsumption: a config valid against a child schema
is valid against every ancestor.

The normative monotonicity table MUST exist as executable property tests, one case per row. Any
new construct adds a row **and** its test in the same change. A proposed feature that cannot
state its legal downstream mutation and its "never" is not ready to implement — it is still a
design question, and belongs in `SPEC.md` first.

Rationale: every pleasant property of this design — trivial precedence, decidable subsumption,
layer-precise errors, the impossibility of `!important` — is downstream of monotonicity. It is
cheap to protect continuously and unrecoverable once lost.

### III. Provenance Is Structural

`span` and `origin` are non-optional (`SPEC.md` §4.1). The type system MUST make an unpositioned
node unconstructible: no optional span fields, no post-hoc attachment, no casts that fabricate
one. "Parse to *positioned* nodes" is the adapter conformance bar, not an aspiration.

Every diagnostic MUST carry the violated demand (declaring layer + RFC 6901 pointer into that
document), the offending value (layer + span + delegation breadcrumb), and the pedigree position.
The canonical error sentence of §10 is a tested output format, not prose. RFC 6901 pointers are
used verbatim; no bespoke path syntax may be invented anywhere in the codebase.

Provenance is built into the merge engine from its first commit. It is nearly free there and
nearly impossible to retrofit.

### IV. Pipeline Stages Are Isolated and Format-Blind

The stages of `SPEC.md` §3 — resolve → parse → graph build → merge → validate → freeze — MUST
each consume only the previous stage's output, and MUST each be testable in isolation from
hand-constructed inputs without touching the filesystem or a parser.

From graph-build onward, no module may branch on source format, inspect a file extension, or
import a format adapter. Adapters MUST NOT be reachable except across the resolve/parse boundary.

Rationale: format-blindness is what makes "a fragment may be in a different format than its
parent" trivially true instead of a feature someone has to build. The same isolation is what
lets the merge engine be tested without YAML at all.

### V. Citations Are Test Oracles (NON-NEGOTIABLE)

Every standard in the conformance map (`SPEC.md` §12) MUST be backed by a committed corpus of
cases **before** the code claiming to conform to it. Adapters run against the shared corpus;
the TOML adapter additionally runs `toml-test`'s corpus shape.

Each portability-floor rejection of §4.2 — duplicate keys, custom tags, complex keys, the Norway
problem, lexical int/float kind — requires an explicit negative case asserting the error *and its
span*. Property tests guard monotonicity (II) and the single definition of model equality (§4.2).

Strict red-green-refactor is NOT mandated for ordinary internals. Corpus-before-conformance-code
is mandated absolutely, and an assertion that a standard is honored without a case citing it is
an unbacked claim.

**The probe gate (added v1.1.0).** Research that concludes a dependency handles something "for
free" MUST have exercised it against **at least one non-ASCII input, one boundary input, and one
adversarial input** before that conclusion is written down. A claim resting only on ASCII, or only
on well-formed input, is not a finding — it is an untested assumption wearing a finding's clothes,
and it is more dangerous than no research at all because it stops anyone from looking again.

This gate exists because v0.1 produced exactly that failure: a Phase 0 probe recorded the YAML
reader's positions as byte offsets and its columns as code points, both marked "Free". Both were
wrong. The probe had used only ASCII documents, where the mistaken and correct readings coincide.
Nothing failed, nothing warned, and every span in any document containing an accented character or
an emoji would have been silently wrong — with the corpus unable to catch it, because those cases
would have been written in ASCII too. It was caught only because an implementer distrusted the
document and re-probed. That must not be left to luck.

Corollary, same reasoning: a requirement MUST NOT be ratified as a MUST until someone has confirmed
the component it governs *can* satisfy it. v0.1 shipped FR-016 demanding refusal of invalid UTF-8
at an entry point that receives already-decoded text, where the property is unenforceable in
principle. Naming an outcome is not the same as checking it is reachable.

### VI. Closed Vocabulary, Deny by Default

Every semantic distinction costs a distinct keyword (`SPEC.md` §2.4). Overloading an existing
keyword with a second meaning is a defect; a new meaning MUST arrive as a new keyword with its
own stated laws — as `$extends` is to `$adopts`, and as any future "delegate and start a layer"
would be to `delegate`.

The constraint vocabulary stays closed declarative data: no lambdas, no template language, no
user callbacks in v1 (§2.9). Capabilities are granted, never ambient: delegation is per-key and
schema-granted, paths are confined to the sandbox root with no `..` escapes and no absolute paths
by default, and remote delegation requires the **user's** opt-in — never the schema's (§8.4).

An escape hatch can be added later but never removed. When in doubt, ship the restriction.

## Technology & Security Constraints

**Stack.** TypeScript under `strict` (plus `noUncheckedIndexedAccess`), targeting active Node LTS.
Package manager: **pnpm**. Test runner: **Vitest**, used table-driven so a conformance corpus is a
data file rather than hand-written cases. The public surface is ESM with emitted type declarations.

**Dependency policy.** Runtime dependencies are limited to the "software we don't write" list of
`SPEC.md` §12: `yaml` (eemeli's), `picomatch`, and Node's built-in WHATWG `URL`. **Ajv is
confined to the JSON Schema exporter and MUST NOT be reachable from the validation core** — the
core's constraint checker is original work over a closed vocabulary. Adding any runtime dependency
requires an amendment to this section; dev dependencies do not.

**Model constraints.** Integers are `bigint` and lexical kind wins (`2.0` is a float). Strings are
UTF-8 with code-point comparison and **no** Unicode normalization. Equality is defined exactly once,
on the model, and merge, diamond dedup, and test assertions all consume that one definition.

**Security.** Remote schemas are HTTPS-only and pinned by `$pin` = SHA-256 over the document's exact
bytes (`SPEC.md` §6.1, amended v0.2 — RFC 8785/JCS was specified here and withdrawn, because it
cannot represent this model's exact integers or its int/float distinction and would therefore collide
on values the model holds unequal); the fetch cache is content-addressed and immutable, honoring the
subset of RFC 9111 that immutable content-addressed documents actually require. Parse depth and
document size are capped. Duplicate keys, YAML custom tags, and complex keys are rejected, never
coerced. **Tests MUST NOT perform network access** — remote behavior is exercised against recorded
fixtures, so the pinning and caching logic is testable and CI is hermetic.

**Output.** The frozen result is deeply immutable. Typed TS output is derived from the accumulated
demands, and the guaranteed-key pattern (§5.5) compiles to a non-optional property.

## Development Workflow & Quality Gates

**Sequencing.** The `SPEC.md` §14 roadmap is the default order of work. A plan may reorder it only
by stating why in its Complexity Tracking. One item is not reorderable: the **meta-schema bootstrap
(v0.7) MUST NOT slip past v1.0** — self-hosting is what forces every vocabulary wart to be suffered
by its own author before the vocabulary is frozen.

**Flow.** Work proceeds `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` →
`/speckit-implement`, with `/speckit-clarify` before planning whenever a spec leaves a semantic
question open. Every generated spec names the `SPEC.md` article it implements (Principle I).

**Gates.** A change is mergeable only when all hold:

1. `tsc` clean under `strict`; no `any` and no assertion casts on the node model.
2. The conformance corpus for every standard the change touches is green (Principle V).
3. Monotonicity property tests are green, and a new construct has added its table row (II).
4. No new runtime dependency, or an accompanying amendment to Technology & Security Constraints.
5. Every new diagnostic carries layer, span, and RFC 6901 pointer (III).
6. No import crosses the format-blindness boundary of Principle IV.

**Complexity.** Any deviation from a principle MUST appear in the plan's Complexity Tracking with
the simpler alternative named and the reason it was rejected. An undocumented deviation is a
review blocker, not a discussion.

## Governance

This constitution supersedes ad-hoc practice and convenience for all process questions; `SPEC.md`
supersedes it on product semantics (Principle I). An agent runtime guidance file (`CLAUDE.md`),
when present, is a convenience index and MUST NOT contradict either document.

**Amendment procedure.** Amendments are made by a change to this file that (a) states the version
bump, (b) updates the Sync Impact Report comment at the top, and (c) is reviewed on its own terms
rather than bundled into a feature change. Versioning is semantic:

- **MAJOR** — a principle is removed, or redefined in a way that invalidates prior compliance.
- **MINOR** — a principle or section is added, or its guidance materially expanded.
- **PATCH** — clarification, wording, or non-semantic refinement.

**Compliance review.** Every `/speckit-plan` runs a Constitution Check before producing its design,
and re-runs it after. Every code review verifies the six gates above. Principles marked
NON-NEGOTIABLE (I, V) admit no Complexity-Tracking exception: a change that violates them is
rejected, not justified.

**Version**: 1.1.1 | **Ratified**: 2026-08-29 | **Last Amended**: 2026-08-30
