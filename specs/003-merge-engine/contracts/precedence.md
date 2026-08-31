# Contract: Precedence

**Implements**: FR-005, SC-008 | **Cites**: `SPEC.md` §5.3

§5.3 requires precedence to be "total, deterministic, and documented as a numbered list", naming
HOCON's carefully specified merge precedence as the prior art. A precedence order that exists only in
code is one nobody can predict, and predicting it is the entire value of a cascade.

## The list

For any key, the value is decided by the first rule that applies:

1. **A nearer layer beats a further one.** Layers rank root-first: the root schema is lowest, each
   `$adopts` descendant higher, and the config highest of all.
2. **Within a layer, an explicit value beats a `provide`.** A config's own value is explicit; a
   schema contributes only through `provide` in this milestone.
3. **Mappings on both sides merge deeply**, rule 1 applying independently to each key inside. This is
   the only rule that recurses.
4. **Any other pairing replaces**, wholesale — a scalar over a mapping, a sequence over a sequence, a
   mapping over a scalar. Deep merge is for mappings only.
5. **Unless the key is declared `cascade: append`**, in which case sequences accumulate root-first
   instead of replacing, and no contribution is ever removed.
6. **An explicit null is a value**, and replaces by rule 1. It is not an absence that yields to a
   provide.
7. **Absence contributes nothing.** A layer silent on a key neither overrides nor clears it.

## What is not in the list

`demand` does not participate — constraints are checked after the fold, in v0.4, against the merged
result. `seal` and `final` do not participate: they constrain what a *descendant schema* may declare,
and arrive with v0.7. Neither changes which value wins here.

## Determinism

The list is total: for any two layers and any key, exactly one rule decides. There is no
tie-breaking, because there are no ties — rank is dense and unique. Given the same pedigree and
config, the fold produces a byte-identical tree and identical provenance chains in identical order,
on every run (SC-005).
