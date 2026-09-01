# Contract: `values`, guarded recursion, and `directives:`

**Milestone**: v0.7, part 2. Normative for this milestone; `SPEC.md` outranks it.

## 1. `values`

1. `values` is a member of §9's closed `demand` keyword set.
2. Its value MUST be a mapping; anything else is `malformed-demand-value`.
3. Its value is a **key declaration** (`{ demand?, delegate? }`), not a demand mapping. A `values:`
   mapping with no `demand:` child constrains nothing — the identical silent no-op a `keys:` entry
   with no `demand:` already has (research.md W-2). **Not refused**, for consistency with `keys`;
   reported as a wart.
4. `values` applies to **every** entry of the mapping it constrains, in canonical key order.
5. Where `keys` names an entry and `values` also covers it, **both** run. Neither wins; there is no
   precedence rule (§5.1 — demands intersect).
6. Against a value that is not a mapping, `values` contributes nothing — the shape refusal is
   `type`'s (v0.3 FR-028's never-twice precedent).
7. `values` nests: its own `demand` may declare further `keys`/`items`/`values`, bounded by
   `MAX_DEMAND_DEPTH`, refused as `depth-limit-exceeded` at the boundary.
8. `values` is orthogonal to `seal`. `seal: closed`'s declared set is drawn from `keys` alone; a
   `values` declaration never adds a name to it.
9. Monotonicity (§5.2's `values` row) is achieved **dynamically**: every schema layer's own `values`
   is checked against the merged tree independently (§5.4), so a descendant that drops or loosens an
   inherited `values` cannot rescue a value the ancestor's own `values` refuses. No dedicated
   weakening diagnostic exists, for the reason §15 gives for named-type widening and v0.7 gives for
   `seal`.

## 2. Guarded recursion

1. A type reaching itself through at least one of `keys`, `items`, or `values` is **accepted**.
2. A type reaching itself through `type:` expressions or `accept:` alone is **refused** as
   `unresolvable-type-cycle`.
3. A cycle carrying at least one structural level anywhere is accepted, even where other links in
   the same cycle are unguarded aliases (FR-009). One structural level makes the whole loop
   productive.
4. Checking a guarded recursive type terminates on every finite document. Termination is a
   consequence of two independent facts, and both MUST hold: every structural traversal consumes a
   level of the value being checked, **and** `MAX_DEMAND_DEPTH` bounds the walk regardless.
5. A document nested past `MAX_DEMAND_DEPTH` against a recursive type is refused with
   `depth-limit-exceeded`, not by the cycle rule.

## 3. Named types check their whole demand

1. A named type's own `demand` is checked in full: `type`, `accept`, every leaf constraint,
   `required`, `seal`, `keys`, `items`, and `values`. Before v0.7 part 2, `keys`, `items`, `values`
   and `required` inside a named type were silently unchecked.
2. Every violation found inside a resolved named type is attributed to **the type's own
   declaration** — `/types/<name>/demand/...` in the type's own declaring document (v0.5 FR-007),
   at that document's own layer rank.
3. Names inside a type's own demand resolve in **the type's own declaring layer's scope**, never the
   usage's (v0.5 FR-008).

## 4. `directives:`

1. A top-level `directives:` mapping in a **schema** layer is recognized. In a config layer it is
   inert (FR-014).
2. Its vocabulary is closed to `$id`, `$version`, `$adopts`, `$pin`, `$schema`, `$extends`. Any
   other entry is `unknown-directive-key`.
3. An entry takes the same per-key vocabulary a `keys:` entry takes. Only `demand` has an effect;
   `provide`, `cascade`, `final`, `delegate` are accepted and inert, because a directive is never
   merged and has no layer to govern.
4. The `demand` of an entry named `$k` is checked against the **config layer's own** `$k` value,
   read from that layer's parsed tree.
5. Every diagnostic so produced is positioned at that `$k`'s own value in that document, and carries
   **no** `Diagnostic.pointer`.
6. No reserved key enters the merged configuration, before or after `directives:` exists. The fold's
   stripping rule is untouched (FR-013).
