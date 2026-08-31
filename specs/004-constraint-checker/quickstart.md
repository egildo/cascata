# Quickstart: Validating the Constraint Checker

**Date**: 2026-08-31 | **Plan**: [plan.md](./plan.md)

How to run this milestone and confirm it does what the spec claims. Implementation belongs to
`tasks.md`; this is the validation guide.

## Prerequisites

Node LTS and `pnpm`. No network, no filesystem beyond the fixture files the resolve/merge stages
already need — validation itself opens nothing new.

## Setup and run

```bash
pnpm install
pnpm test
```

## Validation scenarios

Each maps to a user story in [spec.md](./spec.md).

### 1. A conforming value passes silently; a violating one names both sides (US1, SC-001, SC-002)

A single schema demanding `type: string` on one key, `min`/`max` on another, `enum` on a third.

**Expected**: a config satisfying all three validates with zero diagnostics. A config violating one
produces one diagnostic naming the demand's own document+position and the value's own document+
position — never one without the other.

### 2. An item inside a sequence is blamed, not the sequence (US1, spec.md Acceptance Scenario 6)

A schema demanding `type: string[]`; a config supplying `[a, b, 3, d]`.

**Expected**: one violation, pointing at index 2 specifically (`/key/2`), not at `/key` as a whole.

### 3. A schema's own `provide` is not exempt from its own rules (US1, spec.md Acceptance Scenario 8)

A schema demanding `type: string` on a key and also `provide`-ing an int for it (a schema authoring
mistake — the point is that the checker does not special-case its author).

**Expected**: a violation naming the `provide`'s own position as the offending value's position, the
same as if a config had written it.

### 4. The root judges even when the nearest layer is silent (US2, SC-003)

A three-layer chain: root demands `type: url` on a key, a house layer restates nothing for that key,
a config supplies a value that is a syntactically ordinary string but not a URL.

**Expected**: rejected, and the diagnostic names the **root** schema's document and position — not
the house layer's (which never spoke), and not "the nearest layer", which does not exist for this key.

### 5. Restating an ancestor's demand costs nothing extra (US2, spec.md Acceptance Scenario 1)

The same chain, but the house layer restates `type: url` identically, and the config supplies a valid
URL.

**Expected**: valid, zero diagnostics — not one suppressed "would have matched" diagnostic, just none.

### 6. Two layers, two independent violations (US2, spec.md Acceptance Scenario 3)

A root demanding `min: 5` on a key, a leaf schema (unrelated key) demanding `enum: [a, b]` on another,
a config violating both.

**Expected**: two diagnostics, each layer-precise, each independently derivable — not "the first
violation found, then stop".

### 7. `required` + `provide` is the guaranteed-key pattern (US3, SC-007)

A schema declaring `required: true` and a `provide` on the same key. Three configs: one omitting the
key, one supplying its own value, one writing `key: null` explicitly.

**Expected**: the first two validate with **zero diagnostics of any level** — the provide filling the
key is a feature, not a tolerated gap. The third is rejected: `required` forbids nulling-out even
where a `provide` exists (§5.5).

### 8. A missing parent does not cascade (US3, spec.md Acceptance Scenario 4)

A schema demanding `required: true` on several keys nested inside a mapping the schema also demands
but does not `provide`; a config omitting the whole mapping.

**Expected**: exactly one violation, at the mapping's own pointer — not one per nested required key
that mapping would have carried.

### 9. Closed vocabulary refuses what it does not know or does not yet build (US4, SC-006)

A schema with a misspelled demand keyword; a schema using `accept`; a schema using `format`; a schema
with a top-level `types:` section; a schema with `min: "ten"`; a schema with `type: (string`.

**Expected**: `unknown-demand-keyword`, two `unimplemented-demand-keyword`s (naming v0.5), one
`unimplemented-types-section` (naming v0.5), `malformed-demand-value`, and
`malformed-type-expression` respectively — never silently accepted, never merged into one generic
code, and every one of them reported together in a single run against a schema carrying all six at
once (spec.md Acceptance Scenario 5).

### 10. `seal`/`final`/`delegate` stay inert (US4, spec.md Acceptance Scenario 6)

A schema declaring `demand`, `seal`, `final`, and `delegate` together on one key.

**Expected**: `demand` is enforced; `seal`/`final`/`delegate` have no effect at all — same posture
v0.3 FR-002 established for merge, carried forward rather than re-litigated.

### 11. The property tests catch what a hand-written case would miss

```bash
pnpm vitest run tests/unit/validate-monotonicity.test.ts
```

**Expected**: passes, across many random seeds, for every §5.2 row this milestone's vocabulary makes
constructible (Types, Enums/unions, Ranges/predicates, `required`) — each stated as a property of the
validation **outcome** (FR-033): no randomly generated descendant, however loose its own demands, can
make a value valid that some randomly generated ancestor's demands reject.

### 12. The layering boundary still holds (Principle IV)

```bash
pnpm vitest run tests/unit/layering.test.ts
```

**Expected**: passes, now policing `src/validate/` too. `validate/` may import `model/`,
`diagnostics/`, `graph/`, and `merge/`; it may import neither `adapters/` nor `resolve/`.

## What is not validated here

Nothing here proves a schema-vs-schema refinement with no data present — static subsumption is v1.x.
Nothing here checks `seal: closed`'s struct openness — that is v0.7, named as deferred rather than
silently skipped (FR-032). A green run means every demand in the chain was actually checked against
the actual merged value, root to leaf, with a diagnostic that names both sides whenever it fails.
