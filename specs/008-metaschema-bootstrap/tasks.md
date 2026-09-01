---
description: "Task list for v0.7, part 2 — The Meta-Schema Bootstrap (Self-Hosting)"
---

# Tasks: The Meta-Schema Bootstrap (Self-Hosting)

**Input**: Design documents from `/specs/008-metaschema-bootstrap/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/values-and-directives.md](./contracts/values-and-directives.md),
[contracts/meta-schema.md](./contracts/meta-schema.md), [draft-meta-schema.yaml](./draft-meta-schema.yaml)

**Tests**: Included and mandatory (Principle V — conformance cases before the code that judges them).

**Order**: US1 → US2 → US3 → US4 → US5, per spec.md's own priority ordering. US2 carries the
milestone's one invasive change and must land before US4 can mean anything.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Verify the baseline: 796 tests / 59 files, `pnpm typecheck` clean, tree clean,
      `grep -rn SABOTAGE src/ tests/` empty
- [x] T002 `mkdir -p tests/corpus/cases/values tests/corpus/cases/recursion tests/corpus/cases/directives meta`

---

## Phase 2: User Story 1 — `values` (Priority: P1)

**Goal**: a schema constrains a mapping whose keys it cannot enumerate.

**Independent Test**: a key demanding a mapping with `values`; a config supplying three
schema-unseen entries; all three checked, one bad one refused at its own position.

- [x] T003 [US1] Conformance cases **first**, expected values derived by hand from
      contracts/values-and-directives.md §1, never from output:
      `tests/corpus/cases/values/{unenumerated-keys-checked,keys-and-values-compose,values-with-seal-open,values-nested,values-non-mapping-noop,values-narrowed-downstream}/`
      plus their `tests/corpus/validate-cases/T0xx-*.json` descriptors
- [x] T004 [US1] `src/validate/vocabulary.ts`: `"values"` joins `DEMAND_KEYWORDS`
- [x] T005 [US1] `src/validate/vocabulary.ts`: `refuseMalformedShapes` — `values` must be a mapping
- [x] T006 [US1] `src/validate/vocabulary.ts`: `recursiveVocabularyProblems` descends into
      `values`'s own `demand` (FR-003), bounded by `MAX_DEMAND_DEPTH`
- [x] T007 [US1] `src/validate/check.ts`: `checkNestedValues` — every entry of the mapping, in
      canonical key order; a non-mapping value is a no-op (FR-006); depth-capped (FR-003)
- [x] T008 [US1] `src/validate/check.ts`: `typeUsageProblems`'s own walk descends into `values`
- [x] T009 [US1] `tests/unit/values.test.ts` — the six scenarios, end to end
- [x] T010 [US1] `tests/unit/values-monotonicity.test.ts` — §5.2's `values` row, discharged
      dynamically (plan.md Complexity Tracking): a descendant dropping an inherited `values` cannot
      rescue a value the ancestor's own `values` refuses
- [x] T011 [US1] **Sabotage**: break `checkNestedValues`'s non-mapping guard; confirm
      `values-non-mapping-noop` goes red and nothing else does. Back up to `/tmp` first; mark
      `SABOTAGE`; `grep -rn SABOTAGE src/ tests/` before trusting anything
- [x] T012 [US1] `pnpm typecheck && pnpm test` green; commit `feat(validate): values`

**Checkpoint**: `values` is real, nested, composable with `keys`, orthogonal to `seal`.

---

## Phase 3: User Story 2 — guarded recursion (Priority: P2)

**Goal**: a type may refer to itself when doing so consumes structure — and doing so actually
*checks* something.

**Independent Test**: a type reaching itself through `keys`; it validates a five-level document and
terminates. Alongside it, an unguarded alias cycle still refused, by v0.5's own unmodified case.

- [x] T013 [US2] Conformance cases first:
      `tests/corpus/cases/recursion/{guarded-via-keys,guarded-via-values,guarded-one-point-unguarded-another,guarded-depth-cap}/`
      plus descriptors
- [x] T014 [US2] `src/validate/check.ts`: **the invasive change** — `checkNamedType` delegates to
      `checkDemand` with the type's own declaring context, so `keys`/`items`/`values`/`required`
      inside a named type are checked (plan.md P-2). The type-expression path returns `Violation[]`
      rather than `RawSite[]`
- [x] T015 [US2] Depth accounting: a named-type hop costs 1; a structural level inside a named type
      costs 2. Verify `MAX_DEMAND_DEPTH` still terminates an unguarded alias chain
- [x] T016 [US2] `src/validate/types.ts`: `cycleDiagnostics`'s doc comment states §7's
      guarded-recursion rule as the law it implements — replacing v0.5's "scope decision" wording.
      **No behavioural change**
- [x] T017 [US2] `tests/unit/guarded-recursion.test.ts` — FR-007, FR-008 (v0.5's case untouched),
      FR-009 (the guarded-at-one-point cycle, both directions)
- [x] T018 [US2] `tests/unit/recursion-termination.test.ts` — FR-010, a **property** test over
      adversarially nested documents (seeded PRNG, house pattern), not an example
- [x] T019 [US2] **Sabotage**: hold the probe fixed and vary the code — run the same nested-document
      probe against the pre-T014 `checkNamedType` and the post-T014 one, so the probe is not a
      variable. Confirm the old code reports nothing and the new code reports the violation
- [x] T020 [US2] `pnpm typecheck && pnpm test` green; commit `feat(validate): guarded recursion`

**Checkpoint**: a recursive named type checks a document to the depth the document has.

---

## Phase 4: User Story 3 — `directives:` (Priority: P3)

**Goal**: a schema constrains the reserved `$`-keys without promoting them to data.

- [x] T021 [US3] `src/merge/fold.ts`: export `RESERVED_DOCUMENT_KEYS` (one definition, not two)
- [x] T022 [US3] `src/diagnostics/codes.ts`: `unknown-directive-key`
- [x] T023 [US3] Conformance cases first:
      `tests/corpus/cases/directives/{pin-pattern-refused,pin-pattern-accepted,unknown-directive-key,config-directives-inert,directives-not-in-merged-tree}/`
- [x] T024 [US3] `src/validate/violation.ts`: `renderViolation(v, { omitMergedPointer })`
- [x] T025 [US3] `src/validate/directives.ts`: read a schema layer's `directives:`; closed
      vocabulary; per-entry `demand` checked against the config layer's own raw `$`-key
- [x] T026 [US3] `src/validate/check.ts`: run the directives pass inside `checkConfiguration`
- [x] T027 [US3] `tests/unit/directives.test.ts` — the five acceptance scenarios, including
      FR-013's own case (no reserved key in the merged tree, before or after)
- [x] T028 [US3] **Sabotage**: make the directives pass read `configuration.tree` instead of
      `layer.tree`; confirm the pin-pattern case goes red (it would find nothing to check)
- [x] T029 [US3] `pnpm typecheck && pnpm test` green; commit `feat(validate): directives:`

---

## Phase 5: User Story 4 — the meta-schema (Priority: P4)

**Goal**: the schema language describes itself.

- [x] T030 [US4] Write `meta/cascata.meta.yaml` from `draft-meta-schema.yaml`, **investigating and
      recording every divergence** (spec.md's own instruction: a divergence is a finding, not a
      merge conflict)
- [x] T031 [US4] `package.json`: `files` gains `meta`
- [x] T032 [US4] `src/index.ts`: `metaValidate()` per contracts/meta-schema.md §4 —
      host-read, two-layer fold, real `validate()`
- [x] T033 [US4] `tests/unit/metaschema.test.ts` — **FR-016, the fixed point**: the meta-schema
      validates against itself
- [x] T034 [US4] `tests/unit/metaschema-corpus.test.ts` — FR-017: every schema document in the
      conformance corpus, triaged
- [x] T035 [US4] FR-018: for every vocabulary error the codebase already refuses by hand, confirm
      the meta-schema **agrees on the verdict**; record every code that differs
- [x] T036 [US4] Depth: measure the meta-schema's worst-case walk depth against `MAX_DEMAND_DEPTH`
      and record the number. Do not assume headroom (`guards-that-dont-guard`)
- [x] T037 [US4] `typeExpr`'s superset property: generate from §9.1's grammar and confirm zero false
      rejects, and confirm the pattern is linear, **after** a round-trip through `yaml`
- [x] T038 [US4] **Sabotage**: introduce one vocabulary error into the meta-schema (an undeclared
      `demand` keyword); confirm the fixed-point test goes red
- [x] T039 [US4] `pnpm typecheck && pnpm test` green; commit `feat(meta): the meta-schema`

---

## Phase 6: User Story 5 — through the host seam (Priority: P5)

- [x] T040 [US5] `src/host/node.ts`: `nodeMetaSchemaLocation()`
- [x] T041 [US5] `tests/unit/metaschema-host.test.ts` — FR-019/SC-006: the meta-schema loaded by an
      **in-memory** host, with no filesystem reachable
- [x] T042 [US5] FR-020: the meta-schema's `$version` readable from its own pedigree
- [x] T043 [US5] `pnpm typecheck && pnpm test` green; commit `feat(host): meta-schema location`

---

## Phase 7: FR-021a — documented examples are executed

- [x] T044 `tests/unit/doc-examples.test.ts`: every fenced YAML block in `SPEC.md`, `README.md`, and
      `specs/**/*.md` is parsed by the project's own parser. An ellipsis-abbreviated block has the
      ellipsis substituted and its **skeleton** parsed, never skipped
- [x] T045 **Sabotage**: introduce a deliberately broken block; confirm the test names it (SC-009)
- [x] T046 `pnpm typecheck && pnpm test` green; commit `test(docs): executed examples`

---

## Phase 8: Close-out

- [x] T047 `grep -rn SABOTAGE src/ tests/` empty
- [x] T048 `pnpm typecheck && pnpm test` green; tree clean
- [x] T049 The report: FR-021's friction list, every divergence from the draft, every ambiguity,
      every invention, every sabotage and what it revealed
