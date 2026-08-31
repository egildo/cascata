# Contract: Diagnostic Codes, v0.5 additions

**Implements**: FR-002, FR-009, FR-013, FR-017, FR-018, FR-019a, FR-025 | **Extends**: v0.1's–v0.4's
catalogues

Earlier codes are unchanged. Gate 5 is satisfied at full strength for every code below, same as every
v0.4 code (pointer, violated demand, pedigree position, alongside code+sentence+primary span) —
except the two namespace codes below, which — like v0.4's vocabulary codes — carry no
`Diagnostic.pointer`, since a namespace problem has no merged-configuration position to name.

| Code | Refuses | Primary span |
|---|---|---|
| `unknown-type-entry-keyword` | A `types.<name>` entry containing anything but `demand`/`accept` (FR-002) | The unrecognized keyword's own value node |
| `type-name-collision` | Two or more schema layers declaring the same unqualified type name (FR-017) | The **later**-ranked declaration's own span; `related` names the earlier one — v0.1's duplicate-key precedent |
| `builtin-type-redeclared` | A schema declaring a type whose name is a built-in (FR-018) | The declaration's own span |
| `type-qualifier-collision` | Two documents in one pedigree whose `$id`s share a last segment (FR-019a) | The **later**-ranked document's own `$id` value span; `related` names the earlier one |
| `unresolvable-type-cycle` | A type definition reachable from itself through a chain of other types (FR-009) | The declaration where the cycle was detected while walking |
| `type-accept-widened` | An `accept` naming an alternative outside the type's own declared set — including any selection when the type declares none (FR-013) | The offending `accept` entry's own span |

`unknown-type-name` (v0.4) is reused, not repurposed, for every unresolvable name this milestone adds
a reason for: a typo, a name only reachable from a descendant (FR-008), an unreachable qualifier
(FR-019b), or a name that collided and was skipped for checking (contracts/type-resolution.md) — all
of these are "a rule the checker cannot resolve," v0.4 FR-012's own framing, applied to every new way
a name can fail to resolve rather than only the original one. `depth-limit-exceeded` (v0.1) is reused
for FR-025 (research.md D4) — the identical hazard, not a new one.

## What does not produce a diagnostic

- A `types:` section written by a **config**: never read at all (FR-004).
- One layer declaring a type, a descendant merely using it: inheritance, not collision (FR-020).
- `accept` selecting every alternative a type declares: vacuous, identical to no selector (FR-015).
- A `keys` demand against a non-mapping, or `items` against a non-sequence: `type` is what refuses
  the wrong shape (FR-024).
