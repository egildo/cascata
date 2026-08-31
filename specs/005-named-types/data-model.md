# Data Model: Named Types & Nested Demands

**Date**: 2026-08-31 | **Plan**: [plan.md](./plan.md) | **Implements**: `SPEC.md` §7, §9 (amended)

New entities for v0.5. `Demand`, `Violation`, `ViolationReason` (v0.4) gain fields; nothing existing
is removed.

## Type Declaration

One named bundle of demands, contributed by one schema layer's `types:` section.

| Field | Meaning |
|---|---|
| `name` | Unqualified name as declared (`resource`) |
| `qualifier` | The declaring document's own qualifier (last segment of its `$id`), or `undefined` if it has none — this is what a **usage** writes as `core/resource`, not a field the declaration itself is keyed by beyond identifying which document to attribute to |
| `demand` | The type's own raw demand mapping — same closed vocabulary as a key's `demand` (FR-002) |
| `accept` | The type's own declared alternative names (`RawDemand`-adjacent: a list of raw name strings), or `undefined` if the type declares none |
| `layer` | The declaring schema layer |
| `layerRank` | That layer's precedence rank |
| `pointer` | RFC 6901 pointer into the declaring document, `/types/<name>` |
| `span` | The type entry's own span |

## Type Scope

What a given layer can resolve. Not a stored structure — computed on demand from
`MergedConfiguration.layers`: at layer `L`, the reachable declarations are every `Type Declaration`
whose `layerRank <= L.rank`, plus the built-in set (`string`, `int`, `float`, `bool`, `null`,
`mapping`, `sequence`, `url`, `path` — nine names; `glob` left the set in v0.5, `SPEC.md` §15: a
resource is singular, an unexpanded glob is a string nothing interprets, and `type: glob` is now an
ordinary `unknown-type-name`). Reachability now resolves **nearest-wins** (`SPEC.md` §15, FR-016),
not to a unique-or-nothing candidate: two or more reachable declarations of one name is an ordinary
narrowing chain, not a collision. A genuine collision — two *unrelated* declarations, which v1's
single-parent-chain pedigree cannot produce — remains an error but is structurally unreachable at
this milestone (FR-016b).

## Resolved Type

What a `type:` alternative naming a declared type means at one usage, after `accept`-narrowing
(research.md D3): the type's own `demand`, **and**, if the type declares `accept` (narrowed by any
usage-level `accept` sibling to the same `type:` expression, defaulting to the type's full declared
set), the value must additionally match at least one of the narrowed alternative names.

## `Demand` — additive field

| Field | Meaning |
|---|---|
| `declaresIn?` | The `Type Declaration` this demand's own keyword lives inside, when the demand being checked is a *type's own* demand rather than a key's — carries the type's `name`/`qualifier`/`layer` so a violation can render "constraint from `<type's own document>`" per FR-007 ("exactly as if written inline at the usage") while still being checked in the type's own resolution scope (research.md D2) |

## `ViolationReason` — additive members

| Kind | Meaning |
|---|---|
| `accept-widened` | A usage's `accept` names an alternative the type never declared (FR-013) |
| `keys-violated` / `items-violated` | Not separate reasons — a nested violation reuses the *same* leaf reason (`type-mismatch`, `range-violated`, …) found at the nested value, per FR-024/FR-026: `keys`/`items` contribute no violation of their own, only a deeper pointer |

## Diagnostics — new codes

| Code | Refuses |
|---|---|
| `unknown-type-entry-keyword` | A `types.<name>` entry containing anything but `demand`/`accept` (FR-002) |
| `type-name-collision` | Two *unrelated* schema layers declaring the same unqualified type name (FR-016b) — reserved for a multi-adoption future; structurally unreachable in v1, since every pedigree is one `$adopts` chain and every pair of layers is ancestor/descendant (`SPEC.md` §15, research.md D1's settled-note) |
| `builtin-type-redeclared` | A schema declaring a type whose name is one of the built-ins (FR-018) |
| `type-qualifier-collision` | Two *unrelated* documents in one pedigree whose `$id`s share a last segment (FR-019a) — likewise reserved and unreachable in v1 |
| `unresolvable-type-cycle` | A type definition that refers to itself, directly or through other types (FR-009) |
| `type-accept-widened` | A usage's (or a type's own) `accept` naming an alternative outside the declared set (FR-013) |

`depth-limit-exceeded` (v0.1) is reused, not repurposed, for FR-025 — see research.md D4.
`unknown-type-name` (v0.4) is reused for every unresolvable name — a typo, a name only reachable from
a descendant, or an unreachable qualifier — since all of these are, from a checker's standpoint, "a
rule that cannot be resolved" (v0.4 FR-012's own framing, unchanged). A redeclared name is no longer
in this list at all: it resolves nearest-wins (FR-016), not as a skipped/unresolvable case.

## Nested demand structure (recursion)

`keys`'s own value is a mapping of child-key-name → nested `RawDemand` (the *same* closed demand
vocabulary, recursively — FR-021, FR-023). `items`'s own value is a single nested `RawDemand`, applied
to every element (generalized from v0.4's one-level cap — FR-022, FR-023). Both recurse into further
`keys`/`items` beneath them to whatever depth is written, bounded by FR-025's limit (research.md D4).

## State transitions

Unchanged in shape from v0.4: `validate()` still produces a certified configuration or a non-empty,
position-ordered diagnostic list, never both, and never partially. The **new failure surface** sits
entirely inside the *vocabulary* pass (a third source of unconditional-vocabulary-problem diagnostics,
alongside v0.4's demand-vocabulary and type-expression passes) and the *value* pass (deeper pointers,
type-resolved leaf checks) — the top-level `checkConfiguration` shape does not change.
