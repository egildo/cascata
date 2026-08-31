# Contract: Nested Demands (`keys`, `items`, arbitrary depth)

**Implements**: `SPEC.md` §9 (amended) | v0.5 FR-021 through FR-026

## Shape

`keys`'s value is a mapping of child key name → nested demand (the same closed vocabulary a
top-level `keys.<name>.demand` uses, recursively). `items`'s value is a single nested demand, applied
to every element of a sequence value. Both may recurse into further `keys`/`items` beneath them
(FR-023), generalizing v0.4's one-level cap.

## Wrong-shape values contribute nothing of their own (FR-024)

A `keys` demand against a non-mapping value, or an `items` demand against a non-sequence, produces no
violation from that keyword — `type` is what refuses the wrong shape, unchanged from v0.4's rule for
`items` alone, now stated once for both.

## Pointers (FR-026)

Every violation found at depth is reported at the offending value's **own** position, with an RFC
6901 pointer naming that position in the **merged** configuration — never the parent's. A `keys`
child's merged pointer is `<parent>/<childName>`; an `items` element's is `<parent>/<index>`, exactly
as v0.4 already did for one level, now applied at every level.

## `required` inside a nested `keys` (spec.md's own recorded "now constructible" scenario)

`required` behaves exactly as it does at the top level (v0.4 §5.5), evaluated against whichever
(sub-)tree the enclosing `keys` demand addresses: absent is anchored at the nearest resolvable
ancestor pointer (the enclosing mapping's own merged pointer, not the document root, once nesting is
involved — v0.4's top-level rule was a special case of this: the enclosing "mapping" for a top-level
key *is* the document root); an explicit `null` is anchored at the null scalar's own span.

## Depth (FR-025, research.md D4)

Recursion is bounded at 64 levels (reusing v0.1's `maxDepth` default, not a new constant — both
protect against the identical hazard: adversarially deep nesting exhausting the stack). Crossing it is
`depth-limit-exceeded` (v0.1's code, reused), anchored at the demand node whose recursion would cross
the limit. Depth counts nesting of `keys`/`items` demand structure, not the value tree directly,
though the two are bounded together in practice (a `keys`/`items` demand can only recurse as deep as
the merged value it addresses actually nests).

## `cascade: append` interaction (spec.md's own Edge Case)

`cascade` is confined to top-level keys (v0.3 FR-027, unchanged). A nested `keys`/`items` demand
under an accumulated sequence attributes a violating item to the layer that actually contributed it —
unchanged from v0.4 FR-023: the offending value's own `span.origin`, not the layer that declared the
nested demand, and not a provenance-record walk.
