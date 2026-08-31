# Contract: Merge and `why`

**Implements**: FR-004, FR-017, FR-021 | **Stability**: no compatibility promise before v1.0

## Shape

```
merge(resolved) -> MergeResult

MergeResult =
  | { ok: true,  configuration: MergedConfiguration }
  | { ok: false, diagnostics: Diagnostic[] }      // non-empty, ordered by position

why(configuration, pointer) -> WhyResult

WhyResult =
  | { kind: "chain";       entries: ProvenanceEntry[] }   // non-empty, winner first
  | { kind: "no-value" }                                  // pointer resolves, no layer supplied it
  | { kind: "unknown-pointer" }                           // pointer names nothing in the tree
```

`why` distinguishing `no-value` from `unknown-pointer` is not a nicety: provenance lives beside the
tree rather than on the node (research D1), so the two structures can in principle disagree, and this
is where that disagreement becomes observable instead of silent.

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
