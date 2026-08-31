# Quickstart: Validating Named Types & Nested Demands

**Date**: 2026-08-31 | **Plan**: [plan.md](./plan.md)

## Setup and run

```bash
pnpm install
pnpm test
```

## Validation scenarios

### 1. A named type's demand is enforced at every usage (US1, SC-001)

A schema declaring `resource: { demand: { type: string, minLength: 1 } }` and a key demanding
`type: resource`. **Expected**: a conforming string passes; an empty string is rejected, and the
diagnostic's `demand` names the **type declaration's own** position (spec.md Acceptance Scenario 2),
not the key's `type: resource` usage.

### 2. A shared type is not a shared failure (US1, Acceptance Scenario 3)

Two keys both demand `resource`; only one value violates it. **Expected**: one violation, naming the
violating key's own merged pointer.

### 3. A cycle among type definitions is refused, not followed (US1, Acceptance Scenario 7, FR-009)

`types: { a: { demand: { type: b } }, b: { demand: { type: a } } }`. **Expected**:
`unresolvable-type-cycle`, not a hang — run under a timeout in CI to prove it.

### 4. Nesting reaches arbitrary depth (US2, Acceptance Scenario 2, SC-004)

`keys` inside `keys` inside `items`, three levels deep, the deepest value violating.
**Expected**: reported at that depth, with a pointer that resolves in the merged configuration.

### 5. `required` inside a nested `keys` is now constructible (US2, Acceptance Scenario 5)

A `keys` demand on a mapping-typed key, one nested child marked `required: true`, the parent present
but the child absent. **Expected**: one violation naming the child's own position — the scenario
v0.4's own report recorded as unconstructible.

### 6. A usage narrows a type's declared alternatives (US3, Acceptance Scenario 1)

`resource` declares `accept: [url, path, glob]`; a key usage narrows to `accept: [url]`.
**Expected**: a `path`-shaped value the type alone would admit is rejected at this usage.

### 7. Widening a usage's accept beyond the type's declared set is refused (US3, Acceptance Scenario 2)

A usage's `accept` names an alternative the type never declared. **Expected**: `type-accept-widened`.

### 8. Two layers declaring the same type name collide (US4, Acceptance Scenario 1, SC-005)

**Expected**: `type-name-collision`, `related` naming the first declaration — never silent shadowing,
whatever the second declaration's own content looks like (research.md D1: this fires even when the
second declaration would, read alone, look like a narrowing of the first).

### 9. A layer cannot redeclare a built-in name (US4, Acceptance Scenario 2)

`types: { string: { demand: { type: int } } }`. **Expected**: `builtin-type-redeclared`.

### 10. An ancestor cannot resolve a descendant-only type — the mandated FR-008 sabotage target

A root schema's own key demands `type: houseOnly[]`, where `houseOnly` is declared only by a
descendant (house) schema. **Expected**: `unknown-type-name` at the root's own usage — never
resolved, even though the name exists later in the pedigree. Sabotaging per-layer scope into a single
merged lookup must make this wrongly resolve; confirming it does is this milestone's most important
sabotage run (research.md D1/D2 — adjusted from the coordinating brief's original "descendant
redefines a type" wording, which is unconstructible under D1's collision rule).

### 11. The property test reaches past what the corpus alone proves

```bash
pnpm vitest run tests/unit/validate-type-monotonicity.test.ts
```

**Expected**: passes across many random seeds — no randomly generated descendant-only type is ever
resolvable from a randomly generated ancestor's own usage, and no colliding pair of layers ever
validates instead of refusing.

### 12. The layering boundary still holds

```bash
pnpm vitest run tests/unit/layering.test.ts
```

**Expected**: passes — `src/validate/types.ts` is a new file in the already-policed directory; no new
boundary crossing.

## What is not validated here

Static subsumption (proving a redefinition narrower/wider with no data) — v1.x. Struct openness
(`seal`) — v0.7, still no subject governing it despite nested `keys` finally giving it one to govern
(spec.md's own framing).
