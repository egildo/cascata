# Implementation Plan: Information Model & YAML Adapter

**Branch**: `001-information-model-yaml-adapter` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-information-model-yaml-adapter/spec.md`

## Summary

Turn YAML text into a positioned, format-independent node tree — or, when the document leans on
constructs outside the portability floor, into a complete list of diagnostics. Ship the shared
conformance corpus alongside, built format-agnostic from day one so the JSON and TOML adapters reuse
it.

The technical approach follows from one research finding: **`yaml` (eemeli's) supplies byte ranges
on every node including keys, already collects multiple errors, and already implements the YAML 1.2
core schema — but it does not enforce the portability floor.** Complex keys, non-string scalar keys,
and non-core tags all pass through it silently, and alias cycles produce a circular structure rather
than an error. So the design is a **thin, strict conversion layer** over `yaml`'s AST: the library
handles lexing, positions, and core-schema semantics; Cascata owns the floor. See
[research.md](./research.md) for the probe results behind each of these.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict` plus `noUncheckedIndexedAccess`, targeting active Node LTS

**Primary Dependencies**: `yaml` (eemeli's) — the sole runtime dependency for this milestone, per the
constitution's frozen list

**Storage**: N/A — reads text handed to it; performs no file I/O in this milestone

**Testing**: Vitest, driven table-style so conformance cases are data files rather than hand-written tests

**Target Platform**: Node LTS; the model layer is environment-agnostic

**Project Type**: Library (single package)

**Performance Goals**: Configuration-scale documents (tens of KB, hundreds of nodes) read in
imperceptible time; no throughput target — correctness and position precision dominate

**Constraints**: Bounded memory and time on hostile input — depth cap, size cap, and alias-cycle
detection must all refuse rather than degrade. No network access at any point, including in tests.

**Scale/Scope**: ~26 functional requirements; three source areas (model, diagnostics, YAML adapter)
plus the corpus harness

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| **I. Specification Supremacy** | Every artifact cites the `SPEC.md` article it implements; nothing implemented that `SPEC.md` does not sanction | **PASS** — plan, data model, and contracts carry §-references throughout |
| **II. Monotonicity Is an Invariant** | Features touching demands, provisions, types, or pedigree preserve subsumption and add a table row | **NOT APPLICABLE, DECLARED** — this milestone introduces no demand, provide, type, or pedigree construct. The monotonicity property tests begin at v0.4 with the constraint checker. Recorded here rather than skipped silently, per the principle's own wording. |
| **III. Provenance Is Structural** | Unpositioned node unconstructible at the type level; diagnostics carry layer, span, pointer | **PASS** — nodes are constructible only through factories that take a span; no optional span field exists. See [data-model.md](./data-model.md). |
| **IV. Stages Isolated and Format-Blind** | No format branching past the adapter boundary; adapters unreachable except across it | **PASS** — `src/model/` and `src/diagnostics/` import nothing from `src/adapters/`; enforced by a dependency-direction test, not convention |
| **V. Citations Are Test Oracles** | Corpus committed before the code claiming conformance | **PASS** — corpus harness and floor cases are deliverables of this milestone (User Story 3), authored ahead of the adapter |
| **VI. Closed Vocabulary, Deny by Default** | Capabilities granted, never ambient; refuse rather than coerce | **PASS** — tags are an allowlist, not a denylist; every floor violation refuses rather than repairing |
| **Technology & Security Constraints** | Runtime deps limited to the §12 list; Ajv nowhere near the core; no network in tests | **PASS** — `yaml` only; no Ajv in this milestone; corpus is entirely local fixtures |

**Post-Phase-1 re-check**: PASS. The design added no dependency, introduced no format branching past
the adapter, and made every position non-optional. No entry in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-information-model-yaml-adapter/
├── plan.md              # This file
├── research.md          # Phase 0 output — library probe results and decisions
├── data-model.md        # Phase 1 output — entities and their invariants
├── quickstart.md        # Phase 1 output — how to run and validate
├── contracts/           # Phase 1 output
│   ├── parse-api.md             # the public entry point
│   ├── diagnostics.md           # stable diagnostic code catalogue
│   └── conformance-case.md      # corpus case format
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── model/                  # format-blind; imports nothing below it
│   ├── node.ts             # Scalar | Mapping | Sequence; span-taking factories only
│   ├── span.ts             # SourceSpan, Origin
│   ├── equality.ts         # the single definition of equality (FR-007)
│   └── freeze.ts           # deep immutability (FR-026)
├── diagnostics/            # format-blind
│   ├── codes.ts            # the stable code catalogue
│   ├── diagnostic.ts       # Diagnostic shape
│   └── collector.ts        # accumulates; never throws on first (FR-019)
├── adapters/
│   └── yaml/               # the ONLY format-aware directory
│       ├── parse.ts        # yaml AST -> model, collecting diagnostics
│       ├── floor.ts        # portability-floor checks the library does not do
│       ├── expand.ts       # anchor/alias/merge expansion + cycle detection
│       └── limits.ts       # depth and size caps
└── index.ts                # public surface: parse()

tests/
├── corpus/
│   ├── cases/              # data only — one file per case, format-agnostic
│   ├── runner.ts           # executes every case, reports per case
│   └── corpus.test.ts      # Vitest entry that drives the runner
└── unit/
    ├── equality.test.ts
    ├── freeze.test.ts
    └── layering.test.ts    # asserts the Principle IV dependency direction
```

**Structure Decision**: Single-package library. The directory split is not organizational — it *is*
the Principle IV boundary. `src/model/` and `src/diagnostics/` are format-blind and may not import
from `src/adapters/`; `tests/unit/layering.test.ts` asserts that mechanically, so the boundary fails
a test rather than eroding through review fatigue. `src/adapters/yaml/` is the sole home of
format-aware code, which is what lets the JSON and TOML adapters be added later as siblings with no
change above them.

## Complexity Tracking

> No Constitution Check violations. Table intentionally empty.
