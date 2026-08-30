# Implementation Plan: Resolver & DAG Builder

**Branch**: `002-resolver-dag-builder` | **Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-resolver-dag-builder/spec.md`

## Summary

Find the documents. A config names its schema, that schema names its parent, and v0.2 follows the
chain — reading local files, fetching HTTPS documents, verifying them against a content hash when one
is given, caching them so the chain resolves again offline — and assembles the result into an acyclic
graph with a queryable pedigree. It also corrects v0.1's boundary: the entry point now takes bytes,
which is the only place §4.2's UTF-8 mandate can actually be enforced.

Phase 0 changed the milestone before it started. Probing RFC 8785 (JCS) against this model — as
constitution v1.1.0's probe gate now requires — found it **unimplementable**: JCS serializes numbers
as IEEE-754 doubles, so exact large integers cannot be represented, and `2` and `2.0`, which §4.2
holds to be different values, serialize identically and collide. `SPEC.md` §6.1 was amended to hash
raw bytes instead, following W3C SRI literally. See [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x, `strict` plus `noUncheckedIndexedAccess`, Node LTS

**Primary Dependencies**: `yaml` remains the **only** runtime dependency. Hashing (`node:crypto`),
fetching (`fetch`), and URL handling (WHATWG `URL`) are Node built-ins, so this milestone adds none
and needs no amendment to Technology & Security Constraints — a direct consequence of keeping SHA-256
over BLAKE3, which is not built in.

**Storage**: A content-addressed cache directory for fetched documents. Location caller-supplied,
same as the sandbox root.

**Testing**: Vitest, table-driven. Remote behavior runs against **recorded responses** — no test
performs network access.

**Target Platform**: Node LTS. The model, graph, and resolve layers stay environment-agnostic apart
from the byte source.

**Project Type**: Library (single package), extending v0.1

**Performance Goals**: Configuration-scale chains — a handful of documents, each under the size cap.
Measured: SHA-256 over 8 MiB takes 3.9ms, so hashing is not a consideration.

**Constraints**: Bounded time and memory on hostile input — chain-length cap, response-size cap,
request timeout, cycle detection. HTTPS only, including across redirects. No network in tests.

**Scale/Scope**: 26 functional requirements; three new source areas (resolve, graph, registry) plus a
bytes entry point on the existing adapter.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| **I. Specification Supremacy** | Cite `SPEC.md`; implement nothing it does not sanction | **PASS** — and exercised twice. §11 (pinning policy) and §6.1 (pin basis) were both amended *before* planning rather than diverged from. No requirement here contradicts the canon. |
| **II. Monotonicity** | Preserve subsumption; add a table row | **NOT APPLICABLE, DECLARED** — v0.2 introduces no demand, provide, type, or constraint. It assembles the pedigree; what the pedigree *means* for subsumption arrives with the checker in v0.4. |
| **III. Provenance Is Structural** | Positions non-optional; diagnostics carry them | **PASS** — extended to references: every resolution failure reports the position of the reference that caused it, in the document that wrote it (FR-023, FR-024). A `Reference` is unconstructible without a span, as a `Node` is. |
| **IV. Stages Isolated and Format-Blind** | No format branching past the adapter boundary | **PASS, with a new boundary** — `src/resolve/` handles bytes and never parses; `src/graph/` handles trees and never fetches. Format selection is confined to a registry the orchestrator consults. The layering test is extended to police both new directories. |
| **V. Citations Are Test Oracles** | Corpus before conforming code | **PASS** |
| **V. — the probe gate (new in v1.1.0)** | Research claiming a dependency works "for free" must have been exercised against non-ASCII, boundary, and adversarial input | **PASS, and it earned its place immediately.** The JCS probe used a 23-digit integer (boundary), astral characters (non-ASCII), and the int/float collision (adversarial). It found a defect that would otherwise have reached implementation as a hash collision in a security primitive. |
| **VI. Closed Vocabulary, Deny by Default** | Capabilities granted, never ambient | **PASS** — HTTPS only and checked before any request; schema-authored local references confined to the sandbox; the sandbox root granted by the caller, never inferred (FR-022). |
| **Technology & Security Constraints** | Runtime deps frozen; no network in tests | **PASS** — no new dependency; recorded responses only. |

**Post-Phase-1 re-check**: PASS. One deviation is recorded in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-resolver-dag-builder/
├── plan.md              # This file
├── research.md          # Phase 0 — the JCS finding and seven other decisions
├── data-model.md        # Phase 1 — Reference, Identity, Graph, Pedigree, CacheEntry
├── quickstart.md        # Phase 1 — how to run and validate
├── contracts/           # Phase 1
│   ├── resolve-api.md          # the resolution entry point
│   ├── diagnostics.md          # new codes, extending v0.1's catalogue
│   └── recorded-responses.md   # the fixture format for hermetic remote tests
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── model/                  # format-blind core; imports nothing outside itself
│   ├── reference.ts        # NEW — the `Reference` shape, shared by resolve/ and graph/
│   ├── identity.ts         # NEW — the `DocumentIdentity` shape, likewise
├── diagnostics/            # gains the v0.2 codes
├── adapters/
│   ├── registry.ts         # NEW — the only place that maps a format name to an adapter
│   └── yaml/               # gains a bytes entry alongside the text one
├── resolve/                # NEW — bytes in, bytes out; never parses, never sees a Node
│   ├── reference.ts        # reading $schema / $adopts out of a tree, with spans
│   ├── location.ts         # relative-path and URL resolution; sandbox enforcement
│   ├── fetch.ts            # HTTPS only, manual redirects, timeouts, size cap
│   ├── cache.ts            # content-addressed store; the RFC 9111 subset
│   └── identity.ts         # SHA-256 over exact bytes; pin parsing and verification
├── graph/                  # NEW — trees in, graph out; never fetches, never touches a path
│   ├── build.ts            # DAG assembly, cycle detection, dedup by identity
│   └── pedigree.ts         # the ordered root-to-leaf chain
└── index.ts                # parse() gains bytes; resolve() added

tests/
├── corpus/                 # unchanged harness; gains resolution cases
│   ├── cases/
│   └── recorded/           # NEW — recorded HTTP responses, no network at test time
└── unit/
    └── layering.test.ts    # extended: resolve/ and graph/ join the policed set
```

**Where shared shapes live.** `resolve/` produces `Reference` and `DocumentIdentity`; `graph/`
consumes them; Principle IV forbids `graph/` importing `resolve/`. The first implementation resolved
that by declaring both shapes twice and relying on structural typing — which compiled, but left no
single source of truth, kept in step only by the orchestrator failing to build if they drifted. The
shapes now live in **`src/model/`**, which both layers may depend on because it is the format-blind
core and imports nothing outside itself. Behaviour did not move: constructing and extracting
references remains `resolve/reference.ts`'s job, hashing remains `resolve/identity.ts`'s, and
`model/` declares shapes and knows nothing about `$schema`, `$adopts`, or documents. This is the
answer to a question this plan originally left open, and it is worth settling before `graph/` grows.

**Structure Decision**: `resolve/` and `graph/` are split along the same seam Principle IV already
draws. `resolve/` deals in bytes and locations and never learns what a document *says*; `graph/`
deals in parsed trees and never learns where they came from. Neither may import an adapter — the
orchestrator in `index.ts` consults `adapters/registry.ts` between them, which is the one place a
format name resolves to an adapter. This is what lets the JSON and TOML adapters, when they arrive,
require no change to resolution or graph building at all.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Implementing a **subset** of RFC 9111 rather than the whole standard, against §2.8's "maximal conformance at the membrane" | Cascata fetches immutable, content-addressed schema documents over HTTPS. The subset that matters is freshness lifetime, revalidation by `ETag`/`Last-Modified`, and `immutable`. The rest of RFC 9111 governs shared proxy caches, `Vary` negotiation, and range requests — none of which arise here. | Implementing the full standard means writing and testing behavior no code path can reach, and every untested branch is a liability rather than an asset. Using an off-the-shelf HTTP cache means a runtime dependency and an amendment. The subset is named explicitly in research.md so it is a bounded, documented decision rather than an accident of what got built. |
