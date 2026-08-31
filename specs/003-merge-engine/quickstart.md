# Quickstart: Validating the Merge Engine & Provenance

**Date**: 2026-08-31 | **Plan**: [plan.md](./plan.md)

How to run this milestone and confirm it does what the spec claims. Implementation belongs to
`tasks.md`; this is the validation guide.

## Prerequisites

Node LTS and `pnpm`. No network, and this time not even a filesystem: merge is a function of what
resolution already produced, so its own tests need neither.

## Setup and run

```bash
pnpm install
pnpm test
```

## Validation scenarios

Each maps to a user story in [spec.md](./spec.md).

### 1. A schema's defaults reach the result (US1, SC-001)

A schema providing two keys, a config overriding one.

**Expected**: the config's value for the key it set, the schema's for the key it did not, and a tree
whose shape shows no trace of having been assembled from two documents.

### 2. Deep merge is for mappings only (US1)

Two layers each providing a mapping under one key; then a layer providing a mapping and a nearer one
providing a scalar for the same key.

**Expected**: the first merges key-by-key; the second replaces wholesale. This is the scenario that
fails if "deep merge" quietly becomes "deep merge everything" — merging sequences element-wise is a
plausible-looking mistake that `cascade: append` exists precisely to make unnecessary.

### 3. Null is a value (US1)

A config setting a key to `null` over a schema's provided value.

**Expected**: `null` wins. An implementation treating absence and null alike passes every other
scenario here and fails this one, which is why v0.1 made them three distinct states.

### 4. Append accumulates and never removes (US2, SC-003)

Three layers contributing to a key declared `cascade: append`, one of them contributing an empty
sequence.

**Expected**: every item from every layer, root-first, with the empty contribution changing nothing.

Then the case this guide originally skipped, and which two `SPEC.md` amendments turned on: a root
providing `[a]` with no strategy, a middle layer `[b]`, and a leaf declaring `append` and providing
`[c]` must yield **`[b, c]`**, not `[a, b, c]`. A strategy governs from the layer that declares it
downward; it does not reach back over a `replace` that had already settled.
Then run the property test: for randomly generated layer stacks, no ancestor's contribution is ever
absent. That is the §5.2 row this milestone is obliged to encode, and the example alone does not
discharge it.

### 5. `why` answers with the whole history (US3, SC-002)

A three-layer chain where all three provide the same key. Ask `why` for that pointer.

**Expected**: three entries, winner first, each naming a layer and a position you can open. The two
losing entries are the point — they exist nowhere in the merged tree, and a provenance record built
by inspecting the result rather than the fold could not produce them.

### 6. `why` distinguishes all three of its answers (US3, SC-004)

Ask `why` for a mapping one layer wrote, then for a mapping two layers both contributed to — **with
overlapping keys, not only disjoint ones** — then for a pointer that names nothing at all.

**Expected**: a `chain`, then `synthesized` naming both contributors, then `unknown-pointer`. The
middle case is the one worth constructing deliberately — an earlier draft called it `no-value` and
never said when it could occur, which is how an outcome nobody can reach gets into a contract.
Collapsing the third into either of the others hides the one failure mode that keeping provenance
beside the tree can produce: the two structures disagreeing.

### 7. Merge policy belongs to the contract (US4, SC-007)

A schema declaring `cascade: merge-by-key`; a schema declaring `append` on a scalar; a **config**
declaring `cascade`.

**Expected**: `unimplemented-cascade-strategy` for the first — not "unknown", because §5.3 reserves
that name and the author is early rather than wrong. `append-over-non-sequence` for the second. The
third is ignored, and the fold proceeds as though it were not written.

### 8. Unimplemented vocabulary is inert (US1)

A schema that also declares `demand`, `seal`, `final`, and `delegate`.

**Expected**: merges normally, none of them having any effect. A milestone that reads meaning into
vocabulary it has not implemented is how a language acquires semantics nobody designed.

### 9. The merged tree is still a v0.1 tree (SC-006)

**Expected**: every node positioned, mappings in canonical key order, the whole thing deeply frozen —
verified by the same assertions v0.1 uses, applied to a merged result. Merge does not get an
exemption for being downstream.

### 10. The layering boundary still holds (Principle IV)

```bash
pnpm vitest run tests/unit/layering.test.ts
```

**Expected**: passes, now policing `src/merge/` as well. `merge/` may import `model/`,
`diagnostics/`, and `graph/`; it may import neither `adapters/` nor `resolve/`. It is the first module
that is both format-blind and location-blind.

## What is not validated here

Nothing here checks a constraint or refuses a value for violating one — `demand` and the whole error
contract are v0.4. A green run means the layers fold predictably and every value can account for
itself. Whether the result is *allowed* is the next milestone's question.
