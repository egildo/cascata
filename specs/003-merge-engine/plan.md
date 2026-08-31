# Implementation Plan: Merge Engine & Provenance

**Branch**: `003-merge-engine` | **Date**: 2026-08-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-merge-engine/spec.md`

## Summary

Fold the pedigree and the config into one configuration, and record where every value came from while
doing it. A schema's `provide` fills what the config leaves silent; mappings merge deeply; everything
else replaces unless a schema declares `cascade: append`. Alongside the merged tree, the fold emits a
provenance record keyed by RFC 6901 pointer, so `why` can answer which layer supplied a value and what
it overrode — including contributions that appear nowhere in the result.

Phase 0 found no defect this time, which is worth stating plainly given the last two milestones. It
did replace three assumptions with measurements: the canonical key sort and the freeze Proxy are both
free at configuration scale, and the existing RFC 6901 escaping round-trips correctly on adversarial
keys. See [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x, `strict` plus `noUncheckedIndexedAccess`, Node LTS

**Primary Dependencies**: `yaml` remains the only runtime dependency. This milestone adds none — merge
is arithmetic over trees the earlier milestones already produce.

**Storage**: N/A. Merge consumes a resolved graph and produces a tree; the cache belongs to v0.2.

**Testing**: Vitest, table-driven, plus **property tests** for the first time — constitution
Principle II requires the §5.2 monotonicity table encoded executably, one case per constructible row.

**Target Platform**: Node LTS. The merge engine is environment-agnostic; it touches no filesystem and
no network.

**Project Type**: Library (single package), extending v0.1 and v0.2

**Performance Goals**: Configuration scale. Measured: sorting 500 keys costs 0.38ms, freezing a
9330-node tree 1.1ms. No throughput target — determinism and provenance fidelity dominate.

**Constraints**: The merged tree must satisfy every v0.1 invariant — every node positioned, mappings
in canonical key order, deeply frozen. Merge must be deterministic to the byte. No I/O of any kind.

**Scale/Scope**: 24 functional requirements; one new source area (`src/merge/`), one shared module
promoted out of tests (`src/model/pointer.ts`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| **I. Specification Supremacy** | Cite `SPEC.md`; implement nothing it does not sanction | **PASS** — and for the first milestone, **no amendment is required**. The two departures from its letter (`why` as a function, provenance beside the node) are both places §10 and §4.1 constrain the answer rather than the surface. |
| **II. Monotonicity** | Preserve subsumption; encode the table as property tests | **APPLICABLE FOR THE FIRST TIME.** Merge touches provisions. Discharged per row: `cascade: append` fully (FR-023); the `Defaults (provide)` row as far as it is constructible, with its demand-satisfaction clause declared deferred to v0.4 rather than simulated (FR-024, research D5). |
| **III. Provenance Is Structural** | Positions non-optional; diagnostics carry them | **PASS, and extended** — provenance grows from "where is this node" to "where did this value come from and what did it override". Every provenance entry carries a position in a real document (FR-018). Consistent with v1.2.0's phased contract: the RFC 6901 pointer arrives here as the provenance key, while the full error contract still waits for v0.4. |
| **IV. Stages Isolated and Format-Blind** | No format branching past the adapter boundary | **PASS** — `src/merge/` consumes trees and produces trees. It may import `model/`, `diagnostics/`, and `graph/`; it may not import `adapters/` or `resolve/`. The layering test is extended to police it. |
| **V. Citations Are Test Oracles** | Corpus before conforming code | **PASS** |
| **V. — the probe gate** | Claims of "free" exercised against non-ASCII, boundary, adversarial input | **PASS** — three measured, none assumed. No defect found this time; the gate confirmed rather than caught. |
| **VI. Closed Vocabulary, Deny by Default** | Capabilities granted, never ambient | **PASS** — an unknown `cascade` value is refused rather than defaulted (FR-014); `merge-by-key` is refused as *unimplemented* rather than unknown; unimplemented vocabulary (`demand`, `seal`, `final`, `delegate`) is ignored rather than guessed at (FR-002). |
| **Technology & Security Constraints** | Deps frozen; no network in tests | **PASS** — no new dependency; merge performs no I/O at all. |

**Post-Phase-1 re-check**: PASS. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-merge-engine/
├── plan.md              # This file
├── research.md          # Phase 0 — seven decisions, three measurements
├── data-model.md        # Phase 1 — Layer, ProvenanceEntry, ProvenanceRecord, MergedConfiguration
├── quickstart.md        # Phase 1 — how to run and validate
├── contracts/
│   ├── merge-api.md            # the fold and `why`
│   ├── precedence.md           # §5.3's numbered list, published
│   └── diagnostics.md          # merge-policy codes
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── model/
│   └── pointer.ts          # NEW — RFC 6901 escape/unescape/resolve/generate, promoted out of
│                           #       tests/corpus/runner.ts rather than copied (research D2)
├── merge/                  # NEW — trees in, tree out; no I/O, no formats, no locations
│   ├── fold.ts             # the fold itself: precedence, deep merge, provides
│   ├── strategy.ts         # `replace` / `append`, and refusing everything else
│   └── provenance.ts       # the pointer-keyed record, and `why`
└── index.ts                # gains merge() and why()

tests/
├── corpus/
│   ├── runner.ts           # now imports src/model/pointer.ts; its own copy is deleted
│   └── cases/merge-*/      # fold, append, provenance, policy-refusal cases
└── unit/
    ├── monotonicity.test.ts   # NEW — the §5.2 property tests (Principle II)
    └── layering.test.ts       # extended: src/merge/ joins the policed set
```

**Structure Decision**: `src/merge/` sits above `graph/` and below nothing. It consumes a resolved
graph and a pedigree and produces a tree plus a provenance record — no bytes, no paths, no formats.
That makes it the first module that is format-blind *and* location-blind, and the layering test is
extended to assert both: `merge/` may import `model/`, `diagnostics/`, and `graph/`, and may import
neither `adapters/` nor `resolve/`.

`src/model/pointer.ts` is a promotion, not a new implementation. The resolver has existed in
`tests/corpus/runner.ts` since v0.1, correct including the unescape-ordering subtlety the probe
re-verified. Provenance needs it in `src/`, and writing a second copy would repeat precisely the
defect commit `f9aa900` was spent undoing.

## Complexity Tracking

> No Constitution Check violations. Table intentionally empty.
>
> Worth noting what was *not* added: research D7 measured the canonical key sort and the freeze Proxy
> at merge scale and found both free, so no mutable intermediate representation and no deferred-sort
> optimisation are introduced. Either would have created a second way for a mapping to exist and put
> v0.1's canonical-order invariant at risk, in exchange for a saving that does not exist.
