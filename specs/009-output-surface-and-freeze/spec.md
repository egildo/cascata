# Feature Specification: The Output Surface, and the Freeze

**Feature Branch**: `009-output-surface-and-freeze` *(spec directory; no separate git branch created)*

**Created**: 2026-09-01

**Status**: Draft

**Input**: User description: "Cascata v1.0, the eighth and final pre-1.x milestone of the SPEC.md §14
roadmap: freeze SPEC.md, and ship the output surface a consumer actually reads."

**Implements**: `SPEC.md` **Article VII (§17)** in full, §15's **freeze rule**, §5.5's amended
non-optional-property clause, §3's last pipeline stage, §14 item 8.

**Builds on**: everything. v0.7's `load()` and host seam most directly — the value view is what
`load()` should have been returning all along.

**This milestone ends with a freeze**, which changes what "good enough" means. After it, a correction
to `SPEC.md` is always allowed and an addition is allowed while no existing meaning changes, but
**changing an existing meaning requires v2.0**. Anything this milestone gets wrong about the output
surface is therefore expensive in a way nothing before it has been. Prefer refusing to guessing;
prefer a named limit to a convenient default.

## User Scenarios & Testing *(mandatory)*

The user is, finally and specifically, **the tool developer** — §1's first consumer, who has been
owed "a validated configuration object" since §1 was rewritten and has been handed a `Node` tree
instead. Behind them stand the **organization**, whose house standards must still be the thing that
decides what the application sees, and the **config author**, who must not be able to change the
consuming application's types by choosing different punctuation.

### User Story 1 - A malformed top-level section is refused, not ignored (Priority: P1)

`types: oops` and `keys: not-a-mapping` are accepted today and do nothing.

**Why this priority**: it is a **silent acceptance** in a language whose Principle VI is deny-by-
default, it is small, it is independent of everything else here, and a freeze must not make it
permanent. v0.7 recorded it (008's W-5 / the divergence table) rather than fixing it; this is the
last chance before the meaning is fixed.

**Independent Test**: a schema whose `types:` is a scalar; confirm refusal at that node's own position.

**Acceptance Scenarios**:

1. **Given** a schema whose top-level `types:` is not a mapping, **When** validated, **Then** it is
   refused at the offending node's own position.
2. **Given** the same for `keys:`, **Then** likewise.
3. **Given** the same for `directives:` and `authority:`, **Then** likewise — all four top-level
   sections are one rule, not four.
4. **Given** a schema **omitting** a section entirely, **Then** that is legal and unchanged. Absent
   and malformed are different, and only one of them is an error.
5. **Given** the meta-schema/pipeline divergence table (`tests/unit/metaschema-corpus.test.ts`),
   **When** this lands, **Then** its two remaining rows are gone and the assertion says zero. The
   table is the measure of this fix, and its count MUST be asserted rather than described.

### User Story 2 - `keys` + `values` composition is bounded (Priority: P2)

Where both cover an entry and both recurse into the same type, the walk visits each subtree twice per
level: **2^depth**. Measured 8 ms at depth 10, 123 ms at 15, 898 ms at 18.

**Why this priority**: it is the other thing v0.7 recorded rather than fixed, it is a denial of
service reachable by a legal document, and §11 caps document *size* while nothing caps *work*.

**Independent Test**: the depth-18 case that took 898 ms completes in a small constant multiple of
the depth-10 case.

**Acceptance Scenarios**:

1. **Given** a schema where `keys` and `values` both cover an entry and both recurse into one shared
   type, **When** a deeply nested document is checked, **Then** the work is polynomial, not
   exponential, established by a **ratio** test across depths rather than a wall-clock threshold —
   scaling is a fact about the algorithm, wall-clock is a fact about the machine.
2. **Given** the same schema, **When** checked, **Then** the diagnostics are **identical** to those
   the unbounded walk produced — same set, same order. A cache that changes results is not a cache.
3. **Given** a cache keyed on anything, **When** two structurally identical subtrees appear at
   different pointers, layers, or depths, **Then** they are not confused. The key MUST include
   whatever distinguishes them, and a test MUST prove a mis-keyed cache fails.
4. **Given** the existing depth cap, **When** it is reached, **Then** it still fires exactly as
   before. The cache bounds work, not depth.

### User Story 3 - A consumer reads a configuration as ordinary data (Priority: P3)

`config.server.host` rather than a walk over a tagged union.

**Why this priority**: it is the milestone, and Article VII exists because §1's promise has been
outstanding for seven milestones.

**Independent Test**: a merged configuration projected to a value; confirm `Object.getPrototypeOf` is
`null`, keys enumerate in canonical order, and a sequence is an array.

**Acceptance Scenarios**:

1. **Given** a merged configuration, **When** projected, **Then** mappings are **null-prototype**
   objects, sequences are arrays, and scalars are their JS equivalents.
2. **Given** a configuration carrying a key literally named `__proto__`, **When** projected, **Then**
   it is an ordinary own property and pollutes nothing. This MUST have its own case — it is the
   reason for `Object.create(null)` and the failure is silent.
3. **Given** a mapping, **When** its keys are enumerated, **Then** they come out in §4.2's canonical
   (code-point) order, not authorial order.
4. **Given** a projected value, **When** anything attempts to mutate it at any depth, **Then** it
   fails. Deep immutability, by the same means as the tree — including the `Map` hazard
   `src/model/freeze.ts` exists to close, if any `Map` survives into the projection.
5. **Given** a projection, **When** the result is inspected, **Then** the **node tree is still
   available** on it. The value view is a projection, never a replacement; spans, provenance and
   pedigree stay reachable and `why()` still answers by pointer.
6. **Given** a projection, **When** it completes, **Then** the tree it projected is **unchanged** —
   the projection is pure.
7. **Given** a configuration of non-trivial depth, **When** projected, **Then** projection terminates
   and does not throw on any legal document (the totality posture of Article VI, and `src/extend.ts`'s
   own reason for existing).

### User Story 4 - The schema decides the numeric type, not the punctuation (Priority: P4)

**Why this priority**: it is Article VII's sharpest rule and the one place the config author could
otherwise reach into the consuming application's type system.

**Independent Test**: one schema, two configs differing only in `30` versus `30.0` at a key demanding
`int | float`; confirm the projected JS type is the same for both.

**Acceptance Scenarios**:

1. **Given** an accumulated demand of `type: int`, **Then** the value is `bigint` — at every
   magnitude, exactly.
2. **Given** `type: float`, **Then** `number`.
3. **Given** `type: int | float`, **Then** `number`, whichever lexical form the author wrote. This is
   the discriminating case: two configs differing **only** in `30` versus `30.0` MUST project the
   same JS type.
4. **Given** a key with no numeric demand, **Then** the value is projected faithfully by lexical kind
   and typed `unknown` — no contract to consult, so nothing is promised.
5. **Given** `type: int | float` and an integer **not exactly representable** as a double, **When**
   projected, **Then** an **info**-level diagnostic names the key and both values, and the result is
   still successful (§10, v0.7).
6. **Given** `type: int | float` and an integer that **is** exactly representable, **When** projected,
   **Then** **no** diagnostic is emitted. The lint fires on actual loss, not on the shape — a case
   asserting the *absence* of a lint is required, or the previous scenario proves nothing.
7. **Given** a demand accumulated across several layers, **When** the numeric type is decided, **Then**
   it is decided from the **accumulated** demand, not the nearest layer's.

### User Story 5 - One call, one type (Priority: P5)

`load<T>()` returns the caller's `T`.

**Why this priority**: it is the smallest piece and it sits on US3.

**Acceptance Scenarios**:

1. **Given** `load<T>()`, **When** called without a type argument, **Then** `T` defaults to `unknown`
   — the honest default, since nothing is known about an arbitrary schema.
2. **Given** a `T`, **When** the call succeeds, **Then** the configuration is typed `T` and the
   library has performed **no** check of `T` whatsoever. Validation enforces the schema; it cannot
   enforce the caller's belief about the schema.
3. **Given** the staged functions, **When** this milestone completes, **Then** they remain public and
   the value view is reachable independently of `load()` (Principle IV: a stage consumes only the
   previous stage's output).

### User Story 6 - The freeze holds (Priority: P6)

**Why this priority**: it is the milestone's name and it is last because it certifies everything above.

**Acceptance Scenarios**:

1. **Given** every derived artifact — `README.md`, every `specs/**/contracts/*.md`, `CLAUDE.md` —
   **When** swept, **Then** none contradicts `SPEC.md` as frozen. Staleness lands in derived artifacts
   first; this project has found that four times.
2. **Given** `README.md`'s claim that no CLI ships "before v1.0's typed output surface", **When**
   checked against §14 as amended, **Then** it is corrected or the claim is honoured.
3. **Given** `package.json`, **When** this milestone completes, **Then** its version is `1.0.0`.
4. **Given** every YAML example in every document, **When** the FR-021a sweep runs, **Then** all parse
   — including any this milestone adds.

### Edge Cases

- **An empty mapping and an empty sequence** projected — `{}` with a null prototype, and `[]`.
- **A key named `constructor`, `toString`, or `hasOwnProperty`.** `__proto__` is the famous one; it is
  not the only one.
- **A scalar at the configuration root** rather than a mapping.
- **A `null` value** versus an absent key, in the projection.
- **A projected value serialized with `JSON.stringify`** — `bigint` throws. Is that this article's
  problem, or the consumer's? It should at least be *named*.
- **`int | float` where the value is a float already** — nothing to normalize, no lint.
- **A demand that admits `int` alongside a non-numeric type** (`int | string`). What is the JS type?
  Article VII's table does not say.

## Requirements *(mandatory)*

### Functional Requirements

**Top-level sections** (§9, Principle VI)

- **FR-001**: A top-level `types:`, `keys:`, `directives:`, or `authority:` whose value is not a
  mapping MUST be refused at that node's own position, by one rule covering all four.
- **FR-002**: An omitted section MUST remain legal.
- **FR-003**: The meta-schema/pipeline divergence table MUST reach **zero** rows, asserted by count.

**Bounded composition** (§9, §11)

- **FR-004**: `keys` + `values` composition over a shared recursive type MUST be polynomial,
  established by a ratio test across depths, not a wall-clock threshold.
- **FR-005**: Diagnostics MUST be identical — same set, same order — to the unbounded walk's.
- **FR-006**: Any cache key MUST distinguish subtrees that differ by pointer, layer, or depth, and a
  test MUST prove a mis-keyed cache fails.
- **FR-007**: The existing depth cap MUST still fire unchanged.

**The value view** (Article VII)

- **FR-008**: Mappings MUST project to **null-prototype** objects, sequences to arrays.
- **FR-009**: Keys MUST enumerate in §4.2's canonical order.
- **FR-010**: A key named `__proto__` MUST become an ordinary own property, polluting nothing.
- **FR-011**: The projection MUST be deeply immutable.
- **FR-012**: The node tree MUST remain available on the same result, and `why()` MUST still answer by
  RFC 6901 pointer.
- **FR-013**: The projection MUST be pure — the tree it reads is unchanged.
- **FR-014**: Projection MUST NOT throw on any legal document.

**The numeric rule** (Article VII)

- **FR-015**: Accumulated `type: int` MUST project `bigint` at every magnitude.
- **FR-016**: Accumulated `type: float` MUST project `number`.
- **FR-017**: Accumulated `type: int | float` MUST project `number` regardless of lexical form.
- **FR-018**: A key with no numeric demand MUST project faithfully by lexical kind, typed `unknown`.
- **FR-019**: Normalization that is not exactly representable as a double MUST emit an **info**
  diagnostic naming the key and both values, leaving the result successful.
- **FR-020**: Normalization that **is** exact MUST emit nothing, with a case asserting the absence.
- **FR-021**: The type MUST be decided from the **accumulated** demand, never the nearest layer's.

**One call** (Article VII, §16)

- **FR-022**: `load<T>()` MUST default `T` to `unknown` and MUST perform no check of `T`.
- **FR-023**: The value view MUST be reachable independently of `load()`.

**The freeze** (§15)

- **FR-024**: Every derived artifact MUST be swept against `SPEC.md` as frozen.
- **FR-025**: `package.json`'s version MUST be `1.0.0`.

**Invariants**

- **FR-026**: No existing test is weakened.
- **FR-027**: `pnpm typecheck` clean; no `any`; no assertion casts on the node model.
- **FR-028**: All seven constitution gates hold, the layering and host boundaries included.

### Key Entities

- **The value view** — a configuration as ordinary JS data: null-prototype objects, arrays, scalars.
- **The numeric rule** — the accumulated demand, not the document, decides `bigint` versus `number`.
- **The precision lint** — an info diagnostic fired on an actual lost digit, never on a shape.
- **The freeze** — corrections always; additions while no meaning changes; a changed meaning ⇒ v2.0.

## Success Criteria *(mandatory)*

- **SC-001**: A schema with a non-mapping top-level section is refused; the divergence table is zero.
- **SC-002**: The depth-18 composition case completes in a small constant multiple of depth-10, with
  identical diagnostics.
- **SC-003**: A configuration reads as `config.server.host` with no node-model knowledge.
- **SC-004**: A key named `__proto__` pollutes nothing.
- **SC-005**: Two configs differing only in `30` versus `30.0`, under one `int | float` demand, project
  the **same** JS type.
- **SC-006**: An inexact normalization lints; an exact one does not.
- **SC-007**: All 901 pre-existing tests remain green, unmodified in substance.
- **SC-008**: `package.json` reads `1.0.0` and every documented YAML example parses.

## Assumptions

- **The value view is a new, final pipeline stage** (§3), consuming only the previous stage's output
  per Principle IV. It needs accumulated demands, so it sits after validation.
- **`int | string` and other mixed numeric/non-numeric demands are an open question.** Article VII's
  table does not cover them. Pick the least surprising reading, implement it, and **report it as a
  gap in the article** — under the freeze rule an addition is still permitted, so this is fixable, but
  only if it is named.
- **`JSON.stringify` throwing on `bigint` is the consumer's problem, and must be documented.** Nothing
  in this milestone should hide it by converting.

## Out of Scope

- The TypeScript type **generator** — v1.x, beside the JSON Schema exporter (§14).
- The JSON Schema exporter, static subsumption lint, JSON and TOML adapters — v1.x.
- Any CLI.
- Anything in §14's Future list.
