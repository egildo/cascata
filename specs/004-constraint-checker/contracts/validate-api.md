# Contract: `validate()`

**Implements**: FR-013, FR-014, FR-017, FR-018, FR-019, FR-034, FR-035 | **Stability**: no
compatibility promise before v1.0

## Shape

```
validate(configuration: MergedConfiguration) -> ValidateResult

ValidateResult =
  | { ok: true,  certified: MergedConfiguration }
  | { ok: false, diagnostics: Diagnostic[] }      // non-empty, ordered by position
```

Takes exactly the `MergedConfiguration` `merge()` already produces — no second `pedigree` argument,
because the pedigree's own tree access now travels on `configuration.layers` (this milestone's one
additive field, data-model.md). A caller writes `const merged = merge(...); if (merged.ok) { const
certified = validate(merged.configuration); }` — three independent stages, none reachable only
through another (FR-019).

`certified` is `configuration` itself, unchanged — validation never mutates or rebuilds the tree
(FR-034). It is named distinctly in the result only so a caller cannot mistake "validated" for
"merged"; the two are the same object.

## Behavioral contract

1. **Never throws for a bad *configuration or schema*.** A malformed demand, an unresolvable type
   name, a value that violates a constraint — all diagnostics. Exceptions remain for programmer error
   only (e.g., calling `validate()` with a hand-built `MergedConfiguration` missing `layers`, which
   the type system already forecloses for any caller going through `merge()`).
2. **Whole-chain, not leaf-only** (FR-014, §5.4). Every schema layer's own `demand` is checked against
   the **same** merged tree, root to leaf. There is no "stop once a nearer layer's demand is
   satisfied" shortcut — restating a demand costs nothing extra (FR-015) and skipping an ancestor's
   demand because a descendant's was satisfied is precisely the gap §5.4 calls "belt and suspenders"
   against.
3. **Collect-all** (FR-017). Every violation this call can determine independently is reported — not
   the first violation, not the first violated layer, not the first vocabulary problem. Vocabulary
   refusals (FR-005/006/007/009/012) and value violations are found by different passes and reported
   **together**, mirroring v0.3 FR-028's precedent for merge (`foldConfiguration`'s "both passes
   always run" discipline) rather than the gap that precedent was written to close.
4. **Deterministic** (FR-018, SC-005). Same configuration, same diagnostics, same order, every run.
   Ordering is total: primarily by pedigree position (root before leaf), then by the demand's own
   pointer within a layer, then by the merged pointer the violation occurred at — never by object
   identity, insertion order into an internal `Map`, or anything not derivable from the inputs alone.
5. **No I/O, no reference resolution** (FR-035). Every document `validate()` needs is already on
   `configuration.layers`; it opens no file, follows no `$adopts`, makes no network request.
6. **A schema's own `provide` is checked exactly like a config-written value** (FR-020) — `provide`
   values are ordinary nodes in the merged tree already (`src/merge/fold.ts`'s `schemaContribution`),
   with their own real span from the schema document that wrote them, so this needs no special case:
   whatever node `resolvePointer` finds at a demanded key is checked, regardless of which layer's
   `provide` or which config wrote it.

## What `validate()` does *not* consume

`configuration.provenance` (the `ProvenanceRecord`) is not read by this milestone's implementation —
see research.md D-notes and plan.md's finding 3. The offending value's writing layer is read from
`value.span.origin.id`, matched against `configuration.layers[].identity.location`, not from a
provenance chain lookup. This is a deliberate absence, not an oversight: recorded here so a future
milestone extending `validate()` does not have to rediscover it.

## `required` and `provide` interaction (§5.5, FR-027–FR-031)

`required` is checked **after** every layer's `provide` has already had its chance to fill the key —
which is automatic, not a special validate-time step, because `provide` injection happens during
`merge()`, one stage earlier. By the time `validate()` runs, "the key is present" and "some layer's
`provide` filled it" are indistinguishable from the merged tree's own shape alone, which is exactly
what makes the guaranteed-key pattern (§5.5) a zero-diagnostic feature rather than a tracked
exemption: `validate()` never asks *why* a key is present, only *whether* it is, and whether its value
is non-null.

A `required` key absent because its **parent mapping** is absent produces exactly one violation, at
the parent's own pointer — not one violation per nested required key that parent would have carried
(FR-031). The root→leaf walk's own recursion stops at the first missing ancestor for a given demand's
pointer, rather than continuing to resolve deeper pointers against a tree position that does not
exist.
