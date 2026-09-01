# Contract: Merge and `why`

**Implements**: FR-004, FR-017, FR-021 | **Stability**: written before v1.0, when no compatibility promise was made; from v1.0 the surface follows `SPEC.md` §15's freeze rule (a correction always, an addition while no meaning changes, a changed meaning only at v2.0)

## Shape

```
merge(resolved) -> MergeResult

MergeResult =
  | { ok: true,  configuration: MergedConfiguration }
  | { ok: false, diagnostics: Diagnostic[] }      // non-empty, ordered by position

why(configuration, pointer) -> WhyResult

WhyResult =
  | { kind: "chain";       entries: ProvenanceEntry[] }   // non-empty, winner first
  | { kind: "synthesized"; contributors: ProvenanceEntry[] }  // no layer supplied THIS node; the
                                                              // merge built it because descendants
                                                              // were supplied
  | { kind: "unknown-pointer" }                           // pointer names nothing in the tree
```

**All three outcomes are reachable, and that is deliberate.** An earlier draft called the middle case
`no-value` — "pointer resolves, no layer supplied it" — without saying when that could happen, since
every *value* comes from somewhere. It happens for **containers the merge synthesized**: a mapping whose
contents are the product of more than one layer, so no single layer wrote what is actually there.

An earlier draft illustrated this as "one layer supplied `/a/x`, another `/a/y`, and no layer ever
wrote `/a` itself" — which is **wrong about the mechanism**, as a v0.3 implementer found. Deep merge
recurses only where *both* sides are already mappings (precedence rule 2), so at any recursion point
both layers did write a mapping there. Read literally, the outcome would be unreachable, which is the
same defect that produced this three-way shape in the first place.

The operative rule: `synthesized` when two or more layers independently contribute a mapping at the
pointer, whether or not their keys overlap; `chain` when one layer's mapping stands alone. Both occur,
and the distinction a reader wants — "did somebody write this, or did the merge assemble it" — is the
one this draws.

`synthesized` carries its contributors rather than being empty, because "the merge built this from
these layers" is the useful answer and "nothing" is not.

Distinguishing these from `unknown-pointer` is not a nicety: provenance lives beside the tree rather
than on the node (research D1), so the two structures can in principle disagree, and this is where
that disagreement becomes observable instead of silent.

## Behavioral contract

1. **Never throws for bad input.** Malformed merge policy is a diagnostic. Exceptions remain for
   programmer error only.
2. **Total.** Every input terminates; the fold visits each node once per contributing layer.
3. **Deterministic.** Same input, byte-identical tree, identical chains in identical order (SC-005).
4. **The tree satisfies every v0.1 invariant** — positioned, canonically ordered, deeply frozen
   (FR-010). Merge does not get an exemption for being downstream.
5. **No I/O.** Merge reads no file and opens no socket. It is a function of what resolution produced.
6. **Provenance is complete.** Every value in the tree has a chain, and every chain names every
   contributing layer — including those overridden (FR-019, FR-022).

## `why` and appended keys

For a key under `cascade: append`, every entry is `accumulated` and there is no winner. `why` MUST
NOT nominate one — reporting the last contributor as though it had won would misdescribe the only
strategy where nothing is overridden.

## Chain order

A chain ending on a **winner** is ordered winner-first, so the answer to "why is this what it is"
comes first and the history follows. A chain ending on **accumulation** stays chronological,
root-first, because that is the order the items themselves are in and reversing it would put the
chain and the sequence it explains in opposite orders.

This also settles the case where a value won under `replace` before a later layer tightened the key
to `append`: the earlier entry is relabelled `accumulated` in place rather than being reordered.
Recorded because no document settled it and an implementer had to choose.

## Pointers inside sequences

Provenance is recorded at **mapping-key granularity** — the fold recurses through mappings, and rule
2 makes sequences replace or accumulate wholesale rather than merging element-wise, so an individual
item has no contribution history distinct from its sequence's. `why` for a pointer into a sequence
item answers for the nearest enclosing recorded pointer rather than refusing, since "this item came
from the sequence that came from these layers" is true and useful. Recorded as a decision, not an
accident.
