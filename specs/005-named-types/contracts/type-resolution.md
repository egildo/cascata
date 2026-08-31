# Contract: Type Resolution and the Namespace

**Implements**: `SPEC.md` §7, §9.1 | v0.5 FR-005 through FR-020 | **Stability**: no compatibility
promise before v1.0

## The algorithm (FR-008, research.md D1/D2)

1. **Collect.** For every schema layer in the pedigree, read its own `types:` section (FR-001,
   FR-003) into `Type Declaration`s (data-model.md).
2. **Collide, unconditionally.** Group declarations by unqualified name across the **whole**
   pedigree. Two or more declarations for the same name is `type-name-collision` (FR-017),
   regardless of whether the later declaration would, read in isolation, look like a narrowing of the
   earlier one (research.md D1 — there is no redeclaration-as-narrowing mechanism in v0.5). A name
   matching a built-in is `builtin-type-redeclared` (FR-018), checked independently of the
   multi-layer case (a single schema naming a type `string` collides even alone, against the
   built-in "declaration"). A colliding name is **not available for resolution** anywhere in the
   pedigree — every usage that would have named it resolves as `unknown-type-name` instead, since
   which of several colliding declarations is "right" is exactly the question the collision
   diagnostic already refuses to guess at.
3. **Qualify.** Every schema document's own qualifier is the last non-empty `/`-segment of its `$id`
   (FR-019, research.md D5); a document with no `$id`, or one that yields no segments, has none
   (FR-019b). Two documents sharing a qualifier is `type-qualifier-collision` (FR-019a) — a
   **different** namespace than unqualified names, checked independently.
4. **Resolve, per usage.** A `type:` expression is always written by some specific layer `L` — the
   schema layer whose `keys.<name>.demand` (at any nesting depth) or whose own `types.<name>.demand`
   contains it. Resolve each named alternative:
   - A **built-in** name always resolves (FR-011 unchanged).
   - An **unqualified** declared name resolves iff its (sole, collision-free) declaring layer has
     `rank <= L.rank` — an ancestor of `L`, or `L` itself (FR-008, FR-020). A descendant-only name is
     `unknown-type-name` when named from `L`.
   - A **qualified** name (`core/resource`) resolves against the declaration whose declaring
     document's own qualifier matches, restricted to declarations reachable from `L`'s scope the same
     way; a qualifier matching no reachable document, or a name that document never declares, is
     `unknown-type-name`.
5. **Cycles are refused, not followed** (FR-009). A type's own `demand` can name other types; walking
   that graph from any declaration back to itself (directly, or through a chain of other types) is
   `unresolvable-type-cycle`, naming the cycle. Checked once per declaration reachable from any usage,
   not per usage — a cycle is a property of the graph, independent of how many places reference it.

## `accept` (FR-011–FR-015, research.md D3)

A **declaration**-level `accept` (`types.<name>.accept`) is a list of type names — the alternatives
this type permits. A **usage**-level `accept` (inside a `demand`, sibling to `type:`) selects a
**subset** of the single named type's own declared alternatives it accompanies (this milestone
resolves `accept` only when the accompanying `type:` expression names **exactly one** declared type
at that position — see "Scope note" below). Selecting a name the type never declared — including
selecting anything at all when the type declares no `accept` — is `type-accept-widened` (FR-013).
Selecting every declared alternative is exactly as if no selector had been written (FR-015).

**Resolved check**: `type.demand` **and**, if `type.accept` is non-empty (narrowed by any usage
`accept`, defaulting to the full declared set), the value additionally matches at least one narrowed
alternative, each resolved as an ordinary `type:` name (recursively — an alternative may itself be a
further named type).

**Scope note (deliberate, not a citation gap)**: `spec.md` never shows `accept` alongside a `type:`
union of more than one named type declaring its own alternatives; this milestone does not define what
such a usage would mean and does not need to — no Acceptance Scenario exercises it.

## What is *not* a collision

- One layer declaring a type, a descendant merely **using** it (FR-020) — inheritance, not collision.
- Two documents whose `$id`s do **not** share a last segment, each with unrelated type names.
- A config's own `types:` section — never read at all (FR-004), the same "role is not even consulted"
  posture v0.4 FR-003 established for `demand`.
