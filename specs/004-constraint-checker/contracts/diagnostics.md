# Contract: Diagnostic Codes, v0.4 additions

**Implements**: FR-005, FR-006, FR-007, FR-009, FR-012, FR-013–FR-031 | **Extends**: v0.1's, v0.2's,
and v0.3's catalogues

Earlier codes are unchanged. Codes remain stable identifiers and part of the public contract.

Per constitution v1.2.1's Principle III, gate 5 is satisfied **at full strength** for the first time
by every code below: pointer, violated demand, and pedigree position, alongside the never-phasing
code + sentence + primary span. See data-model.md's `Diagnostic` additive fields.

## Vocabulary codes (schema-authoring problems — found reading `keys.<name>.demand`, before any value is checked)

| Code | Refuses | Primary span |
|---|---|---|
| `unknown-demand-keyword` | A key inside `demand` that is not in §9's closed list — including `format`, dropped from §9 in favor of `type: url`/`path`/`glob` (SPEC.md §15) | The unrecognized keyword's own key node |
| `unimplemented-demand-keyword` | `accept` or `keys` — listed by §9, not built this milestone (FR-006, FR-011b; SPEC.md §9's amendment for `keys`, naming v0.5) | The keyword's own key node |
| `unimplemented-types-section` | A top-level `types:` section in a schema (FR-011a) | The `types:` key node |
| `malformed-demand-value` | A constraint whose value is the wrong shape (`min: "ten"`, `enum: 3`, `required: "yes"`) (FR-007) | The value node itself |
| `malformed-type-expression` | A `type` value that does not parse under §9.1's grammar (FR-009) | The `type` value's own span |
| `unknown-type-name` | A name inside a `type` expression that resolves against neither FR-011's built-in set nor (v0.5+) a named type (FR-012) | The name's own position within the `type` expression's span — the whole expression's span if sub-span tracking inside the DSL string is not available; see tasks.md for which this milestone ships |

`unimplemented-demand-keyword` and `unimplemented-types-section` are deliberately distinct from
`unknown-demand-keyword`, mirroring `unimplemented-cascade-strategy` vs. `unknown-cascade-strategy`
in v0.3: an author writing `accept`, `keys`, or `types:` is early (the keyword is real, named by
§7/§9, arriving in v0.5), not wrong, and a diagnostic saying "unknown" would teach the opposite. An
author writing `format` is not early — `SPEC.md` §15 dropped it in favor of `type: url`/`path`/`glob`,
so it is exactly as wrong as any other typo, hence `unknown-demand-keyword`, not this code.

## Violation codes (data problems — found checking the merged tree against a well-formed demand)

| Code | Refuses | Primary span |
|---|---|---|
| `type-mismatch` | A value whose kind (or, for `T[]`, an item's kind) does not match any alternative of the `type` demand | The offending value's (or item's) own span |
| `range-violated` | A number outside a `min`/`max` bound | The offending value's own span |
| `length-violated` | A string whose code-point length is outside `minLength`/`maxLength` | The offending value's own span |
| `pattern-mismatch` | A string that does not match a `pattern` demand (ECMA-262 regex, §7) | The offending value's own span |
| `enum-violated` | A value that is not `nodesEqual` to any member of an `enum` demand | The offending value's own span |
| `required-violated` | A `required` key absent, or present with an explicit `null`, after merge (§5.5) | The absent/null position — the nearest resolvable ancestor pointer for "absent" (FR-031), the `null` scalar's own span for "explicit null" |

Every violation code's diagnostic also carries `demand` (the violated demand's own pointer + span,
into its **declaring** document — FR-022) and `pointer` (into the **merged** configuration — FR-024).
These are two different pointers into two different documents on the same diagnostic, by design —
§10's canonical sentence names both.

## When a code counts as added

Unchanged from v0.3's own rule: a code is added when it can be **emitted**, not when its identifier is
declared. Each code above arrives with an accepting and a refusing conformance case in the phase that
makes it reachable (Principle V).

## What does not produce a diagnostic

- `seal`, `final`, `delegate` in a schema's `keys.<name>`: ignored, unchanged from v0.3 FR-002's
  posture (this milestone reads `demand` where that one reads `provide`/`cascade`; both leave the
  other three fields untouched).
- A `demand` written by a **config**: never read at all (FR-003) — the same "this layer's role is not
  even consulted" posture v0.3 FR-015 established for a config's `cascade`.
- An absent **or empty** `keys:` section: contributes no demands (FR-004). **Corrected at v1.0**: a
  *non-mapping* `keys:` in a **schema** layer is refused as `malformed-section` (v1.0 FR-001,
  `SPEC.md` §9) rather than silently ignored. It still contributes no demands; it now also produces a
  diagnostic. A **config** layer's own `keys:` remains inert, per the bullet above.
- A key no demand mentions: any value is accepted — schema silence is permission (FR-021), until
  `seal: closed` arrives in v0.7.
- A demand restated identically by a nearer layer, on a value that satisfies it: legal and vacuous
  (FR-015) — zero diagnostics, not one suppressed diagnostic per restatement.
- A `required` key filled by a schema's own `provide`: zero diagnostics of any level (FR-029) — the
  guaranteed-key pattern is a feature, not a tolerated gap.
