---
description: "Task list for v0.1 — Information Model & YAML Adapter"
---

# Tasks: Information Model & YAML Adapter

**Input**: Design documents from `/specs/001-information-model-yaml-adapter/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **Included and mandatory.** The specification requires the conformance corpus as a
deliverable (User Story 3, FR-021–FR-024), and constitution Principle V requires cases to be
committed *before* the code claiming to conform to them. Test tasks here are not optional extras.

**Organization**: Tasks are grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths are included in every task

## Path Conventions

Single-package library: `src/` and `tests/` at repository root, per the Structure Decision in
[plan.md](./plan.md).

## A note on ordering

Principle V ("corpus before the conforming code") and the P1→P2→P3 story order pull in different
directions, since the corpus is User Story 3. They are reconciled structurally: the **corpus harness
is Foundational** — both US1 and US2 need it to express their cases at all — while **User Story 3
owns the properties that make the corpus outlive this adapter** (format dispatch, discovery,
coverage guarantees). Within US1 and US2, cases are written before the code they judge.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization

- [x] T001 Create the `src/` and `tests/` directory skeleton per the Structure Decision in specs/001-information-model-yaml-adapter/plan.md
- [x] T002 Initialize the package in package.json with pnpm, ESM output, and Node LTS engines
- [x] T003 Configure TypeScript in tsconfig.json with `strict` and `noUncheckedIndexedAccess` enabled
- [x] T004 [P] Add `yaml` as the sole runtime dependency, and `vitest` plus `typescript` as dev dependencies, in package.json
- [x] T005 [P] Configure Vitest in vitest.config.ts for table-driven suites
- [x] T006 [P] Add `test`, `typecheck`, and `build` scripts to package.json

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The format-blind core and the corpus harness. Every user story depends on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### The model (format-blind)

- [x] T007 [P] Define `SourceSpan` and `Origin` with their invariants in src/model/span.ts per data-model.md
- [x] T008 Define `Scalar`, `Mapping`, `Sequence` and span-requiring factories in src/model/node.ts so an unpositioned node is unrepresentable (Principle III, FR-001) — depends on T007
- [x] T009 [P] Implement the single definition of equality in src/model/equality.ts: scalars by kind and value, mappings order-insensitive, sequences ordered, spans excluded (FR-007) — depends on T008
- [x] T010 [P] Implement deep freezing of returned trees in src/model/freeze.ts (FR-026) — depends on T008

### Diagnostics (format-blind)

- [x] T011 [P] Define the stable diagnostic code catalogue in src/diagnostics/codes.ts from contracts/diagnostics.md
- [x] T012 Define the `Diagnostic` shape with `primary` and labelled `related` spans in src/diagnostics/diagnostic.ts (FR-018) — depends on T007, T011
- [x] T013 Implement the collector that accumulates and never throws on the first violation, ordering by position, in src/diagnostics/collector.ts (FR-019) — depends on T012

### Corpus harness (minimum viable, so stories can write cases)

- [x] T014 Define and load the conformance case format in tests/corpus/case.ts per contracts/conformance-case.md
- [x] T015 Implement the runner executing every case and reporting per named case in tests/corpus/runner.ts — depends on T014
- [x] T016 Wire the runner into Vitest in tests/corpus/corpus.test.ts — depends on T015

### Boundary and core unit tests

- [x] T017 [P] Assert the Principle IV dependency direction — nothing in src/model/ or src/diagnostics/ imports from src/adapters/ — in tests/unit/layering.test.ts
- [x] T018 [P] Unit-test equality including order-insensitive mappings and `int 2` ≠ `float 2.0` in tests/unit/equality.test.ts — depends on T009
- [x] T019 [P] Unit-test that returned trees resist mutation in tests/unit/freeze.test.ts — depends on T010

**Checkpoint**: The model, diagnostics, and a working corpus runner exist. Story work can begin.

---

## Phase 3: User Story 1 — A document becomes a fully positioned tree (Priority: P1) 🎯 MVP

**Goal**: YAML text becomes a node tree in which every node reports its exact source position, with
anchors expanded, core-schema semantics honored, and lexical number kinds preserved.

**Independent Test**: Parse a nested document; assert a chosen deep node's position selects exactly
the characters that produced it; walk the tree and find no node lacking a position.

### Conformance cases for User Story 1 (write first — Principle V)

- [x] T020 [P] [US1] Cases asserting exact positions for deep nodes, first-byte and last-byte nodes, in tests/corpus/cases/positions/
- [x] T021 [P] [US1] Cases asserting YAML 1.2 core schema — `no`/`yes`/`on`/`off` as text, only `true`/`false` boolean — in tests/corpus/cases/core-schema/
- [x] T022 [P] [US1] Cases asserting lexical number kind (`2` int, `2.0` float, quoted `"2"` string) and exact large integers, in tests/corpus/cases/numbers/
- [x] T023 [P] [US1] Cases distinguishing explicit null, empty value, and absent key, plus empty, comment-only, and whitespace-only documents, in tests/corpus/cases/nullability/
- [x] T024 [P] [US1] Cases asserting anchors, aliases, and merge keys expand to independent copies with no references, and that explicit keys beat merged ones, in tests/corpus/cases/expansion/
- [x] T025 [P] [US1] Cases asserting position stability across BOM and CRLF line endings in tests/corpus/cases/encoding/
- [x] T026 [P] [US1] Cases asserting mappings are canonicalized — sorted by key on construction, by Unicode code point rather than UTF-16 code unit — and that equality remains order-insensitive (§4.2, amended) in tests/corpus/cases/ordering/
- [x] T027 [P] [US1] Cases asserting strings compare by code point with no Unicode normalization — precomposed `é` (U+00E9) is not equal to `e` plus combining acute (U+0065 U+0301) (FR-006) in tests/corpus/cases/unicode/

### Implementation for User Story 1

- [x] T028 [US1] Wire `parseDocument` with `intAsBigInt`, `merge`, and a `LineCounter` in src/adapters/yaml/parse.ts per research D1
- [x] T029 [US1] Convert byte ranges plus `LineCounter` output into `SourceSpan` values in src/adapters/yaml/parse.ts — depends on T028, T007
- [x] T030 [US1] Derive scalar kind lexically from the node's `source` text and quoting type in src/adapters/yaml/parse.ts (FR-004) — depends on T028
- [x] T031 [US1] Walk the AST into the model, giving every node a span, in src/adapters/yaml/parse.ts. Key positions are computed during the walk and handed to the floor checks rather than stored: `Mapping.entries` is keyed by bare strings and has nowhere to hold a key span — depends on T029, T030, T008
- [x] T032 [US1] Expand anchors, aliases, and merge keys, attributing positions to the anchored content per research D4, in src/adapters/yaml/expand.ts — depends on T031
- [x] T033 [US1] Implement the public `parse()` returning a frozen tree on success in src/index.ts — depends on T031, T032, T010
- [x] T034 [US1] Map unparseable input to the `malformed-document` diagnostic in src/adapters/yaml/parse.ts — depends on T013, T028

**Checkpoint**: A well-formed document becomes a fully positioned, frozen tree. MVP complete.

---

## Phase 4: User Story 2 — Every portability problem is named at once (Priority: P2)

**Goal**: A document breaking floor rules yields the complete diagnostic list in one pass, each with
an exact position and a stable code.

**Independent Test**: One fixture per floor rule asserting code and position, plus a fixture breaking
several rules far apart asserting all of them come back together.

### Conformance cases for User Story 2 (write first — Principle V)

- [ ] T035 [P] [US2] Cases for duplicate keys, including quoted-versus-plain collision and assertion of **both** occurrence positions, in tests/corpus/cases/duplicate-keys/
- [ ] T036 [P] [US2] Cases for complex keys (`? [a, b]`) and non-string scalar keys (`1:`, `true:`, `null:`) in tests/corpus/cases/non-string-keys/
- [ ] T037 [P] [US2] Cases for non-core tags — `!!binary`, `!!timestamp`, `!!set`, `!!omap` — and an unknown tag, in tests/corpus/cases/tags/
- [ ] T038 [P] [US2] Cases for multi-document input and invalid UTF-8 in tests/corpus/cases/document-shape/
- [ ] T039 [P] [US2] Cases for the depth cap and size cap, each at the boundary and one step past it, in tests/corpus/cases/limits/
- [ ] T040 [P] [US2] Case for an alias cycle, asserting refusal rather than non-termination, in tests/corpus/cases/alias-cycles/
- [ ] T041 [P] [US2] Case with several violations far apart in one document, asserting the complete set is returned from one read (SC-003), in tests/corpus/cases/multi-violation/

### Implementation for User Story 2

- [ ] T042 [US2] Enforce string-only keys, refusing collection keys and non-string scalar keys, in src/adapters/yaml/floor.ts (FR-012) — depends on T031
- [ ] T043 [US2] Enforce the core-schema tag allowlist per research D2 in src/adapters/yaml/floor.ts (FR-013) — depends on T031
- [ ] T044 [US2] Recover the first occurrence of a duplicated key and attach it as a `related` span in src/adapters/yaml/floor.ts (FR-018) — depends on T031, T012
- [ ] T045 [US2] Map the underlying reader's errors and warnings onto Cascata codes per research D6 in src/adapters/yaml/parse.ts — depends on T011, T028
- [ ] T046 [US2] Surface `maxDepth` and `maxBytes` as public options per contracts/parse-api.md, enforce the size cap before parsing, and track depth during the walk, in src/adapters/yaml/limits.ts (FR-014) — depends on T031
- [ ] T047 [US2] Detect alias cycles on the active expansion path per research D3 in src/adapters/yaml/expand.ts (FR-015) — depends on T032
- [ ] T048 [US2] Validate UTF-8 and refuse invalid input with a position in src/adapters/yaml/parse.ts (FR-016) — depends on T013
- [ ] T049 [US2] Continue the walk past violations so one read reports all of them, ordered by position, in src/adapters/yaml/parse.ts (FR-019) — depends on T042, T043, T044, T045, T046, T047, T048
- [ ] T050 [US2] Return diagnostics and no tree whenever any violation exists, per research D5, in src/index.ts (FR-020) — depends on T049, T033

**Checkpoint**: The floor is enforced, completely and precisely, in a single pass.

---

## Phase 5: User Story 3 — A conformance corpus that outlives this adapter (Priority: P3)

**Goal**: The corpus is data-driven and format-agnostic, so the JSON and TOML adapters reuse it
unchanged and adding a case costs no code.

**Independent Test**: Add a case as data alone and watch it execute; confirm the runner contains no
format-specific logic.

### Implementation for User Story 3

- [ ] T051 [US3] Select the adapter under test from the case's `format` field, leaving the runner format-agnostic, in tests/corpus/runner.ts (FR-021) — depends on T015
- [ ] T052 [US3] Discover cases by scanning the corpus directory so adding a file is sufficient in tests/corpus/runner.ts (FR-024) — depends on T015
- [ ] T053 [US3] Fail loudly on a case that cannot be interpreted rather than skipping it in tests/corpus/runner.ts — depends on T015
- [ ] T054 [US3] Compare expected diagnostics as a set of code-plus-position, failing on wrong positions and on missing or extra entries, in tests/corpus/runner.ts (SC-004) — depends on T015
- [ ] T055 [US3] Support selective span assertion by node path in expected trees in tests/corpus/runner.ts — depends on T015, T009
- [ ] T056 [US3] Report per-case pass or fail with expected-versus-actual detail in tests/corpus/runner.ts (FR-022) — depends on T015
- [ ] T057 [US3] Assert the FR-023 coverage obligations in tests/corpus/coverage.test.ts: every §4.2 **rejection** has both a refusing case (diagnostic plus position) and an accepting case, and every §4.2 **acceptance rule** has an accepting case (FR-023, SC-002) — depends on T020–T027, T035–T041
- [ ] T058 [P] [US3] Verify a case added by copy-and-edit runs with no code change, per quickstart scenario 6, in tests/corpus/cases/

**Checkpoint**: The corpus is ready for the JSON and TOML adapters without reshaping.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T059 [P] Document the public surface and the diagnostic codes in README.md, citing contracts/parse-api.md
- [ ] T060 [P] Confirm determinism — identical input yields identical trees and diagnostic order across runs (SC-008) — in tests/unit/determinism.test.ts
- [ ] T061 [P] Confirm no corpus case causes a throw — bad input always yields diagnostics rather than an exception, per contracts/parse-api.md — in tests/unit/totality.test.ts
- [ ] T062 [P] Confirm the suite performs no network access, keeping the corpus hermetic, in tests/unit/hermetic.test.ts
- [ ] T063 Run every validation scenario in specs/001-information-model-yaml-adapter/quickstart.md end to end
- [ ] T064 Verify the six merge gates in .specify/memory/constitution.md: strict typecheck clean, no `any` or assertion casts on the node model, corpus green, no runtime dependency beyond `yaml`, every diagnostic carrying a position, no import crossing the format-blindness boundary

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks all user stories**
- **User Story 1 (Phase 3)**: depends on Foundational
- **User Story 2 (Phase 4)**: depends on Foundational; its implementation tasks build on the walk from US1 (T031, T032)
- **User Story 3 (Phase 5)**: depends on Foundational; its coverage task (T057) needs the cases authored in US1 and US2
- **Polish (Phase 6)**: depends on all stories

### Story independence — an honest note

US1 is fully independent. US2 and US3 are independently *testable* but not independently
*implementable*: US2's floor checks hook into the walk US1 builds, and US3's coverage assertion is
meaningless without cases to count. This is inherent to a parsing pipeline rather than a flaw in the
decomposition — the stories still deliver value in strict increments, and each has its own checkpoint.

### Within each user story

- Conformance cases before the code they judge (Principle V)
- Model before adapter; adapter before the public surface
- Story complete before moving to the next priority

### Parallel opportunities

- T004–T006 in Setup
- T007, T011, T017 at the start of Foundational; then T009, T010 together; T018, T019 together
- **All of T020–T027** (US1 cases) — different directories, no shared state
- **All of T035–T041** (US2 cases) — likewise
- T059, T060, T062 in Polish

---

## Parallel Example: User Story 1 conformance cases

```bash
# All eight case groups are independent directories and can be authored simultaneously:
Task: "Position exactness cases in tests/corpus/cases/positions/"
Task: "Core schema cases in tests/corpus/cases/core-schema/"
Task: "Number kind cases in tests/corpus/cases/numbers/"
Task: "Nullability cases in tests/corpus/cases/nullability/"
Task: "Expansion cases in tests/corpus/cases/expansion/"
Task: "Encoding cases in tests/corpus/cases/encoding/"
Task: "Order preservation cases in tests/corpus/cases/ordering/"
Task: "Unicode comparison cases in tests/corpus/cases/unicode/"
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 User Story 1
4. **STOP and VALIDATE**: a well-formed document becomes a fully positioned, frozen tree
5. This is a genuine deliverable — the resolver in v0.2 can be built against it

### Incremental delivery

1. Setup + Foundational → model, diagnostics, and a working corpus runner exist
2. Add US1 → positioned trees → validate independently
3. Add US2 → the floor is enforced completely → validate independently
4. Add US3 → the corpus is ready for other formats → validate independently

---

## Notes

- Every task names a file path; `[P]` means different files with no incomplete dependency
- Conformance cases are written before the code they judge — a case that passes the moment it is
  written is testing nothing
- Three floor rules are **entirely Cascata's** because the underlying library does not catch them:
  non-string keys (T042), non-core tags (T043), and alias cycles (T047). Research established this
  empirically; treat these three as the highest-risk tasks in the milestone.
- Commit after each task or logical group; stop at any checkpoint to validate a story on its own
