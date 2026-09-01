# Implementation Plan: Sealing, Authority, and the Embedding Surface

**Branch**: `007-sealing-and-embedding` (spec directory only, no separate git branch) | **Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-sealing-and-embedding/spec.md`

## Summary

Six user stories, ordered by dependency rather than prominence (spec.md's own framing): US1
(diagnostic levels) touches the one type every later story produces, so it lands first. US2
(`seal`/`final`) and US3 (`authority:`) are independent additions to the schema vocabulary,
mirroring `cascade`'s own resolution shape (`src/merge/strategy.ts`) closely enough to reuse its
pattern without reusing its code. US4 (the host seam) is the milestone's one large, invasive
refactor: `Host` (new, `src/resolve/host.ts`) becomes the library's only route to local bytes,
canonical identity, and cache storage; the concrete Node implementation — including the network
transport's real-`fetch()` call, which turns out to still be living on the wrong side of the seam
today — moves to a new, separate entry point, `src/host/node.ts`, exempted by name from a new
sweep in `tests/unit/layering.test.ts`. US5 (`load()`) and US6 (`resource` resolution) are thin
compositions sitting on US4's finished seam.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict` + `noUncheckedIndexedAccess`, Node LTS

**Primary Dependencies**: none added. `yaml` remains the only runtime dependency.

**Testing**: Vitest. New table-driven corpus families for `seal`/`final`/`authority`; a new
in-memory `Host` test double (mirroring `RecordedTransport`'s role) for US4; property tests for
the two new monotonicity-table rows (`seal: open→closed`, `final`'s "closes even a narrowing").

**Scale/Scope**: 42 FRs. New files: `src/resolve/host.ts`, `src/host/node.ts`, `src/merge/seal.ts`,
`src/graph/authority.ts`, `src/validate/resource.ts`. Changed: `src/diagnostics/diagnostic.ts`
(`level`, required — ~73 existing call sites across 13 files gain `level: "error"`),
`src/resolve/location.ts`/`cache.ts`/`fetch.ts` (I/O calls replaced by `Host`/`Transport` calls),
`src/index.ts` (orchestrator threads `Host` through every resolution path, gains `load()`),
`src/merge/strategy.ts` (`readKeysVocabulary` gains `seal`/`final`), `src/validate/check.ts`
(closed-seal and final-provide checks), `tests/unit/layering.test.ts` (gate 7), `package.json`
(new `./host/node` export).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

See `research.md`'s own "Constitution Check" section — re-run after design, **PASS**, no
unresolved tensions. Summary:

1. `tsc` clean, no `any`, no assertion casts on the node model — planned: yes; every new type is a
   plain interface built the same way every existing model/merge type is.
2. Conformance corpus green for every standard touched — planned: `tests/corpus/cases/seal/`,
   `tests/corpus/cases/authority/`, new `tests/unit/host-*.test.ts`/`resource-*.test.ts` families.
3. Monotonicity property tests — two new table rows, two new property tests, alongside the
   existing `tests/unit/monotonicity.test.ts` suite.
4. No new runtime dependency — holds.
5. Every new diagnostic carries `level` (this milestone's own new, non-optional field) plus every
   phased field the constitution already requires by v0.6 (pointer, demand, pedigreePosition,
   delegation breadcrumb where applicable).
6. No import crosses the format-blindness boundary — unaffected.
7. No import crosses the **host boundary** (new gate) — planned: `src/host/node.ts` is the one
   named exemption; every other module under `src/` is swept by `tests/unit/layering.test.ts`'s
   new check for `node:fs`/`fetch`.

**PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/007-sealing-and-embedding/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── host-api.md
│   └── sealing-authority.md
└── tasks.md
```

### Source Code

```text
src/
├── diagnostics/diagnostic.ts   # Diagnostic.level (required) — US1
├── resolve/
│   ├── host.ts                 # NEW — the Host interface, zero imports (US4)
│   ├── location.ts             # readLocalDocument/safeRealpath -> Host-backed (US4)
│   ├── cache.ts                 # DocumentCache -> Host-backed byte store (US4)
│   ├── fetch.ts                 # createNetworkTransport REMOVED (moves to host/node.ts) (US4)
│   └── delegate.ts              # isDelegationSandboxEscape -> async, Host-threaded (US4)
├── host/
│   └── node.ts                  # NEW, separate entry point — createNodeHost/createNodeTransport (US4)
├── graph/
│   └── authority.ts             # NEW — authority: reading + pinning-demand walk (US3)
├── merge/
│   ├── strategy.ts              # readKeysVocabulary gains seal/final (US2)
│   └── seal.ts                  # NEW — resolveSeal, mirroring resolveStrategies (US2)
├── validate/
│   ├── check.ts                 # seal-closed / final-provide checks (US2)
│   └── resource.ts              # NEW — resource(configuration, pointer) (US6)
└── index.ts                     # host threaded through resolve(); load() added (US4, US5)

tests/
├── unit/layering.test.ts        # gate 7 — host boundary sweep (US4)
├── unit/host-*.test.ts          # NEW
├── unit/seal.test.ts, final.test.ts, authority.test.ts, diagnostic-levels.test.ts,
│   delegate-lint.test.ts, load.test.ts, resource.test.ts   # NEW
└── corpus/cases/{seal,authority}/   # NEW fixture families

package.json                     # exports gains "./host/node"
```

**Structure Decision**: single project, extending the existing pipeline stages in place, plus one
genuinely new top-level directory (`src/host/`) for the shipped host — the only directory this
milestone adds outside the existing stage layout, and it exists specifically to sit *outside* the
policed boundary rather than inside it.

## Complexity Tracking

*No Constitution Check violations requiring justification.* The one deliberate ordering choice —
US4 placed after US1–US3 rather than first, even though it is the largest change — is spec.md's
own stated ordering (dependency, not prominence), not a plan-level deviation, and is kept as
written per the milestone brief's explicit instruction not to reorder it without cause.
