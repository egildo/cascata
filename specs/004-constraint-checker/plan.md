# Implementation Plan: Constraint Checker & Whole-Chain Validation

**Branch**: `004-constraint-checker` *(spec directory; no separate git branch — main, per this
milestone's own spec.md header)* | **Date**: 2026-08-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-constraint-checker/spec.md`

## Summary

Read `demand` for the first time, and judge the merged configuration against it. Every schema layer's
own `demand` is checked against the same merged tree, root to leaf — never the leaf alone — so a
descendant that forgets or loosens an ancestor's constraint cannot silently void it (§5.4's belt and
suspenders). Every diagnostic carries both sides of §10's contract: which demand, in which document,
at which position, rejected which value, written where — read from the value's own `span.origin`
directly, not by walking v0.3's provenance record, which cannot attribute one item inside a
`cascade: append` accumulation to a single layer.

Phase 0 found two real defects that would otherwise have shipped as untested assumptions: `pattern`'s
ReDoS exposure is real and measured (exponential, confirmed at 7-character patterns), not
hypothetical; and `picomatch("")` throws rather than matching, so an empty `glob` demand value needs
an explicit guard or it becomes an uncaught exception instead of a diagnostic. It also found that a
mixed `bigint`/`number` relational comparison is exact at magnitudes where casting first would
silently be wrong — confirmed by probe before being written down as "free". See
[research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x, `strict` plus `noUncheckedIndexedAccess`, Node LTS

**Primary Dependencies**: `yaml` (unchanged) plus **one new runtime dependency this milestone**:
`picomatch` (`^4.0.7`), already on the constitution's Technology & Security Constraints allow-list,
added because §7 names it by name as `glob`'s implementation, not left to implementer choice
(research.md D4). `@types/picomatch` (dev-only, no constitution amendment needed) supplies the type
declarations the package does not bundle.

**Storage**: N/A. Validation consumes a `MergedConfiguration` and produces diagnostics or a certified
configuration; no cache, no filesystem.

**Testing**: Vitest, table-driven, plus a second family of property tests (constitution Principle II)
for every §5.2 row `demand` newly makes constructible — Types, Enums/unions, Ranges/predicates,
`required` — following `tests/unit/monotonicity.test.ts`'s hand-rolled-PRNG pattern, no new
dependency.

**Target Platform**: Node LTS. Validation is environment-agnostic; it touches no filesystem and no
network (FR-035).

**Project Type**: Library (single package), extending v0.1–v0.3

**Performance Goals**: Configuration scale, same order of magnitude as merge. No throughput target;
determinism and diagnostic fidelity dominate. One known, accepted exception: a `pattern` demand can
be made to run for a long time against a sufficiently long value under a catastrophic regex — measured
in research.md, accepted explicitly in D3, not mitigated this milestone.

**Constraints**: Validation must not mutate the merged tree (FR-034) and must perform no I/O of any
kind (FR-035). Every diagnostic must satisfy gate 5 at full strength — pointer, violated demand,
pedigree position — not merely the never-phasing floor.

**Scale/Scope**: 35 functional requirements (3 corrected/closed in this milestone's own Step 1); one
new source area (`src/validate/`, five files); one new runtime dependency; three additive fields
spread across two existing types (`Diagnostic`, `MergedConfiguration`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| **I. Specification Supremacy** | Cite `SPEC.md`; implement nothing it does not sanction | **PASS, with one flagged exception.** Every FR cites an article. `format`'s relationship to `type: url/path/glob` is a genuine `SPEC.md` ambiguity this plan does not resolve by amendment (not this implementer's call) — see research.md D2; this milestone's own choice (refuse `format` as unimplemented, same as `accept`) is a conservative reading, not an amendment. **Settled after this plan was written** (`SPEC.md` §15): `format` is dropped from the vocabulary entirely — one mechanism, everything constraining a leaf's shape is a type. The escalation recorded here was the right call; the text above stands as what was true at planning time. |
| **II. Monotonicity** | Preserve subsumption; encode the table as property tests | **APPLICABLE FOR THE FIRST TIME AT FULL STRENGTH.** `demand` makes Types, Enums/unions, Ranges/predicates, and `required` constructible; each gets a property test (FR-032). Struct openness (`seal`) stays deferred, named explicitly rather than silently absent. |
| **III. Provenance Is Structural** | Positions non-optional; diagnostics carry them | **PASS, gate 5 satisfied at full strength for the first time** — every `validate/`-produced diagnostic carries `pointer`, `demand` (pointer+span), and `pedigreePosition`, additive to the never-phasing code+sentence+span floor. Pre-v0.4 diagnostics are untouched (the new fields are optional). |
| **IV. Stages Isolated and Format-Blind** | No format branching past the adapter boundary | **PASS** — `src/validate/` consumes `MergedConfiguration` (tree + layers) and produces diagnostics or a certified configuration. May import `model/`, `diagnostics/`, `graph/`, `merge/`; may not import `adapters/` or `resolve/`. The layering test is extended before any file exists under the new directory, following the v0.2/v0.3 precedent. |
| **V. Citations Are Test Oracles** | Corpus before conforming code | **PASS** — a `validate-cases/` corpus family, conformance cases written before the code that judges them, per phase. |
| **V. — the probe gate** | Claims of "free" exercised against non-ASCII, boundary, adversarial input | **PASS, and it caught two real defects** — `picomatch("")` throwing, and the ReDoS exposure being measured rather than assumed. Both recorded in research.md rather than discovered in production. |
| **VI. Closed Vocabulary, Deny by Default** | Capabilities granted, never ambient | **PASS** — `demand`'s eleven-keyword list is closed (FR-005); `accept`/`format`/`types:` are refused as unimplemented, distinct from unknown (FR-006, FR-011a, FR-011b) — `format` since dropped and `keys` since added, per §15, leaving the count unchanged; `seal`/`final`/`delegate` continue to be ignored rather than guessed at (FR-002, unchanged from v0.3). |
| **Technology & Security Constraints** | Deps frozen; no network in tests | **One new runtime dependency, on the allow-list, declared explicitly** (`picomatch`) — see research.md D4. No network access anywhere in validation or its tests. |

**Post-Phase-1 re-check**: PASS. Complexity Tracking below records the one new dependency and the one
accepted, unmitigated security exposure — both decisions, not violations, and both cite the principle
they weigh against.

## Project Structure

### Documentation (this feature)

```text
specs/004-constraint-checker/
├── plan.md              # This file
├── research.md          # Phase 0 — five probed decisions, two governance/exposure flags
├── data-model.md        # Phase 1 — Demand, Type Expression, Violation, Validation Result,
│                         #           plus Diagnostic's and MergedConfiguration's additive fields
├── quickstart.md         # Phase 1 — how to run and validate
├── contracts/
│   ├── validate-api.md         # validate()'s shape and behavioral contract
│   ├── diagnostics.md          # v0.4's vocabulary and violation codes
│   └── demand-vocabulary.md    # the closed `demand` list, the §9.1 grammar, leaf-check semantics
└── tasks.md              # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── diagnostics/
│   └── diagnostic.ts       # gains three additive optional fields: pointer, demand, pedigreePosition
├── merge/
│   └── provenance.ts       # MergedConfiguration gains one additive field: layers
├── validate/                # NEW — trees and layers in, diagnostics or a certified configuration out
│   ├── vocabulary.ts        # reads keys.<name>.demand; closed-vocabulary + shape refusal
│   ├── typeexpr.ts          # §9.1's grammar: parse, canonical set form, name resolution
│   ├── constraints.ts       # the leaf checks: type, items, required, min, max, minLength,
│   │                        # maxLength, pattern, enum — one pure function per keyword
│   ├── check.ts             # the root→leaf walk; collect-all; required×provide timing
│   └── violation.ts         # the Violation entity and §10's canonical sentence, structured-only
└── index.ts                 # gains validate()

tests/
├── corpus/
│   ├── validate-case.ts        # NEW — mirrors merge-case.ts's shape
│   ├── validate-runner.ts      # NEW — mirrors merge-runner.ts: resolve() -> merge() -> validate()
│   ├── validate-corpus.test.ts # NEW — discovers and runs every validate-cases/ fixture
│   └── validate-cases/         # NEW — one JSON descriptor per conformance case, fixtures alongside
└── unit/
    ├── validate-monotonicity.test.ts  # NEW — the §5.2 property tests this milestone's vocabulary
    │                                  #        newly makes constructible (Principle II)
    └── layering.test.ts               # extended: src/validate/ joins both policed sets
```

**Structure Decision**: `src/validate/` sits above `merge/` and consumes only `merge()`'s own output
(`MergedConfiguration`, additively carrying `layers`) — no `Graph` passed alongside, which would let a
later caller reach for `graph/`'s own concerns (resolution-time information) inside a stage that
should only ever ask "does this tree satisfy these demands." This is the same reasoning `src/merge/`
was scoped by in v0.3, one stage further down the pipeline. The layering test is extended to assert
both directions: `validate/` may import `model/`, `diagnostics/`, `graph/`, and `merge/`; it may
import neither `adapters/` nor `resolve/`.

`Diagnostic`'s and `MergedConfiguration`'s new fields are additive on existing types rather than new
wrapper types, so every pre-v0.4 construction site — merge's, graph's, resolve's, parse's — keeps
compiling and keeps its existing tests green with zero edits, satisfying gate 5's phased design
(constitution Principle III) literally rather than by convention.

## Complexity Tracking

> One dependency addition, one accepted-and-documented exposure — both are decisions with a named
> alternative rejected for a stated reason, not silent deviations.

| Decision | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Add `picomatch` as a runtime dependency | §7 names it explicitly as `glob`'s implementation ("implemented via `picomatch`, cited by name") — not left to implementer choice the way `url`/`path` are | Hand-rolling gitignore-syntax matching (rejected — duplicates real, tested work and drifts from the cited standard the moment an edge case, e.g. `**`, negation, character classes, is gotten slightly wrong; undercuts §12's "leverage: software we don't write" posture) |
| Accept `pattern`'s ReDoS exposure, unmitigated | §11 already treats schemas as untrusted; a real mitigation (worker-based timeout) needs infrastructure this milestone was never scoped to build, and the brief's own budget for the whole checker is "a few hundred lines" | A pattern-**length** cap (rejected — the probe's catastrophic pattern is 7 characters; length-capping the pattern does not address the measured risk, which is a function of the **value** being matched); a value-length cap before matching (rejected — silently stops enforcing `pattern` on legitimately long strings, a semantic change no FR authorizes, with no citation for wherever the threshold would be drawn) |
