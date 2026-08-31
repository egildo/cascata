# Feature Specification: Named Types & Nested Demands

**Feature Branch**: `005-named-types` *(spec directory; no separate git branch created)*

**Created**: 2026-08-31

**Status**: Draft

**Input**: User description: "Cascata v0.5, the fifth milestone of the SPEC.md §14 roadmap: Types (`types` section, selector parameters, namespace collision errors); nested demands (`keys` implemented, `items` generalized from one level to arbitrary depth, per §9's amendment)."

**Implements**: `SPEC.md` §7 (Article IV — Types) in full, §9's amended `demand` vocabulary (`keys`,
`accept`, arbitrary-depth nesting), §9.1 (name resolution through the type graph), §5.2's named-types
row, §14 item 5.

**Builds on**: v0.1 (positioned trees), v0.2 (the pedigree chain), v0.3 (the fold and provenance),
v0.4 (the constraint checker, whole-chain validation root-to-leaf, and §10's full error contract).
v0.4 sized this milestone's doors deliberately: `accept` and `keys` already refuse with
`unimplemented-demand-keyword` **naming v0.5**, and a qualified name like `core/resource` already
parses under §9.1's grammar while resolving to `unknown-type-name`.

## User Scenarios & Testing *(mandatory)*

The users are the **schema publisher**, who wants to name a constraint bundle once and reuse it, and
to tighten an inherited one for their whole organization in a single edit; the **config author**, who
should be told which rule they broke in terms of the type they were asked for; and the **library
consumer**, whose nested configuration can, for the first time, be constrained below its top level.

Two things arrive together here, and they are independent of each other. **Named types** are §14's
headline for v0.5. **Nested demands** are the obligation §14's v0.5 line inherited when `SPEC.md` §15
settled v0.4's second governance question — and they matter out of proportion to their size, because
until they land nothing can constrain a demanded mapping's own children at all, which also leaves
§5.2's "Struct openness" row and v0.7's `seal` with no subject to govern.

### User Story 1 - A constraint bundle is named once and demanded by name (Priority: P1)

A schema publisher declares `resource` once in a `types:` section and demands it on any key that
needs it. A config supplying a value that violates the type's own demands is rejected, and the
diagnostic speaks in terms of the type.

**Why this priority**: It is §14's headline for the milestone, and it is what turns the constraint
vocabulary from a per-key checklist into a language a schema publisher can factor. §7's whole claim
is "no new mechanism" — types reuse the cascade discipline — so this is the slice that proves it.

**Independent Test**: Declare a type with its own demands, demand it on one key, and confirm a
conforming value passes and a violating value is reported naming both the type's declaration and the
offending value.

**Acceptance Scenarios**:

1. **Given** a schema declaring a type and a key demanding it, **When** a conforming value is
   validated, **Then** the configuration is valid.
2. **Given** the same schema, **When** a violating value is validated, **Then** the violation is
   reported with the type declaration's own position and the value's own position.
3. **Given** a type used by several keys, **When** one key's value violates it, **Then** only that
   key is reported — a shared type is not a shared failure.
4. **Given** a type name used in an array or union position (`resource[]`, `resource | null`),
   **When** validated, **Then** the type resolves inside the §9.1 expression exactly as a built-in
   name does.
5. **Given** a `type:` naming something no layer declares and no built-in provides, **When**
   validated, **Then** it is refused as an unresolvable name — a rule that cannot be resolved is a
   rule that cannot be enforced (v0.4 FR-012, unchanged).
6. **Given** a `types:` section that is absent, empty, or not a mapping, **When** validated, **Then**
   it contributes nothing and validation proceeds — a schema declaring no types is not a broken
   schema (v0.3 FR-003 and v0.4 FR-004's rule, applied to a third section).
7. **Given** a type whose definition refers to itself, directly or through a cycle of other types,
   **When** validated, **Then** the cycle is refused rather than followed — v0.2 established that a
   cycle is an error and not a hang, and a type graph is no exception.
8. **Given** a `types:` section written by a **config** rather than a schema, **When** validated,
   **Then** it is ignored as ordinary data — the contract is the schema's (v0.3 FR-015, v0.4 FR-003).

---

### User Story 2 - Demands nest to whatever depth the data does (Priority: P2)

A schema publisher constrains not just a top-level key but the shape of the mapping beneath it, and
the sequence beneath that, to whatever depth the configuration actually nests.

**Why this priority**: Independent of types entirely, and shippable first if preferred. It closes a
gap `SPEC.md` §15 recorded as a defect: §8's own worked example wrote
`demand: { type: mapping, keys: { … } }` while §9's vocabulary never listed `keys`, and v0.4 could
reach exactly one level into a value. A configuration language that cannot constrain nested structure
is not finished, and v0.4's own `items` recursion was capped at one level explicitly "for want of a
citation authorizing more" — §9's amendment is that citation.

**Independent Test**: A schema demanding a mapping whose own child key must be an integer; confirm a
violating grandchild value is reported at its own position, not at the parent's.

**Acceptance Scenarios**:

1. **Given** a `keys` demand on a mapping value, **When** a child violates it, **Then** the violation
   is reported at the child's own position with a pointer naming the child.
2. **Given** `keys` nested inside `keys` nested inside `items`, **When** a value three levels down
   violates, **Then** it is reported at that depth — nesting is not capped at one level.
3. **Given** a `keys` demand and a value that is not a mapping, **When** validated, **Then** `keys`
   contributes no violation of its own — `type` is what refuses a non-mapping (v0.4's rule for
   `items` over a non-sequence, applied consistently).
4. **Given** a `keys` demand naming a child the value does not have, **When** that child is not
   `required`, **Then** nothing is reported — a demand constrains a value if one exists.
5. **Given** `required` inside a nested `keys`, **When** the child is absent, **Then** it is
   reported — this is the acceptance scenario v0.4 recorded as unconstructible, now constructible.
6. **Given** deeply nested demands, **When** validated, **Then** recursion terminates and is bounded
   the way v0.1 bounds parse depth — depth is a resource limit, not an unbounded promise.

---

### User Story 3 - A usage narrows the type it names (Priority: P3)

A schema publisher declares `resource` as accepting URLs, paths, and globs. A key that should take
only URLs says so at the point of use, and a house layer that never wants globs says so once for the
whole organization.

**Why this priority**: §7's first law — parameters are constraint *selectors*, never computation — is
what keeps parameterization monotone and statically checkable. Without it, `types:` is only an
abbreviation; with it, types cascade.

**Independent Test**: A type declaring three alternatives and a key accepting one; confirm a value of
the accepted alternative passes and a value of a declared-but-unselected alternative is rejected.

**Acceptance Scenarios**:

1. **Given** a type declaring alternatives and a usage selecting a subset, **When** a value outside
   the subset is validated, **Then** it is rejected even though the type itself would admit it.
2. **Given** a usage naming an alternative the type never declared, **When** validated, **Then** it
   is refused — selecting outside the declared set is widening, which §5.2 forbids absolutely.
3. **Given** a usage selecting every declared alternative, **When** validated, **Then** it behaves
   exactly as no selector at all — vacuous narrowing is legal (§5.1's rule for demands).
4. **Given** a descendant layer narrowing an inherited type's alternatives, **When** a config
   supplies a value the ancestor would have accepted but the descendant would not, **Then** it is
   rejected.

---

### User Story 4 - A descendant narrows an inherited type, and qualification pins a specific one (Priority: P4)

A house layer redeclares the root's `resource` with fewer alternatives — "our `resource` never allows
globs" — and that narrowing governs the house and everything beneath it. An author who needs the
root's original meaning specifically names it with a qualified name.

**Why this priority**: `SPEC.md` §15 settled this against the first draft of this story, which had it
exactly backwards. Redeclaring a name **is** how narrowing is written, so treating every
redeclaration as a collision makes §7's cascade law unreachable and reduces `types:` to an
abbreviation. Under §6.1's single-parent chain every pair of layers is related, so a genuine
collision — two *unrelated* declarations — cannot arise in v1 at all.

**Independent Test**: A two-layer pedigree where the descendant redeclares the root's type with a
narrower `accept`; confirm a value the root would have allowed and the descendant would not is
rejected for a demand the descendant governs, and that a qualified name still reaches the root's.

**Acceptance Scenarios**:

1. **Given** a descendant redeclaring an inherited type name, **When** validated, **Then** it is
   **not** an error — it is a narrowing, governing that layer and every layer below it.
2. **Given** such a narrowing and a demand **the descendant itself declares**, **When** a value
   allowed by the ancestor's version but not the descendant's is validated, **Then** it is rejected.
3. **Given** such a narrowing and a demand **only an ancestor declares**, **When** that same value is
   validated, **Then** it is accepted — the ancestor's demand resolves the ancestor's own
   declaration. This is the surprising half of §7's worked narrowing and MUST have its own case.
4. **Given** a descendant redeclaring a type more permissively, **When** a value violating the
   ancestor's version is validated against a demand the ancestor declares, **Then** it is still
   rejected — a widening is inert where it would do harm, refused by nothing and effective nowhere
   it matters.
5. **Given** an unqualified name reachable from two layers, **When** resolved, **Then** it resolves to
   the **nearest** declaration at or above the layer that names it — never to an error, and never to
   an arbitrary one of the two.
6. **Given** a qualified name, **When** resolved, **Then** it names exactly one declaration and never
   depends on which layer is asking.
7. **Given** a layer redeclaring a built-in type name (`url`, `string`), **When** validated, **Then**
   it is refused — the built-in namespace is not open for redefinition. This is a separate rule from
   collision and remains reachable in v1.

### Edge Cases

- **A type declaring `provide` or `cascade` rather than demands.** §7 defines a type as a bundle of
  *demands*. Whether the other vocabulary is refused there or simply not part of a type entry must be
  stated, not left to fall out of the reader.
- **A type used before it is declared, or declared in a descendant and used in an ancestor.** Ancestors
  cannot see descendants (§2.3, authority flows one way), so this is a resolution failure, not a
  lookup that happens to reach.
- **`accept` on a type whose demands are not a union.** Selecting among alternatives when there is one
  alternative is either vacuous or meaningless; which one must be decided.
- **A qualified name whose qualifier names no document in the pedigree.**
- **The same type name declared twice within one document.** Duplicate keys are already refused at
  parse time (§4.2), so this cannot arise — worth confirming rather than guarding twice.
- **A nested `keys` demand under a key that also carries `cascade: append`.** `cascade` is confined
  to top-level keys (v0.3 FR-027); a nested demand under an accumulated sequence must attribute a
  violating item to the layer that contributed it, which v0.4 solved via the value's own span.

## Requirements *(mandatory)*

### Functional Requirements

**Reading the `types:` section** (§7)

- **FR-001**: The validator MUST read the top-level `types:` section from schema documents in the
  pedigree.
- **FR-002**: A type entry MUST be read as a bundle of demands — `demand` and `accept` — and its
  vocabulary MUST be closed, with anything else refused at its own position (Principle VI).
- **FR-003**: A `types:` section that is absent, empty, or not a mapping MUST contribute nothing
  rather than raise an error.
- **FR-004**: A `types:` section written by a config MUST NOT take effect. The contract is the
  schema's (v0.3 FR-015, v0.4 FR-003).

**Resolving names** (§7, §9.1)

- **FR-005**: A name in a `type:` expression MUST resolve against declared types and the built-in set,
  at every array depth and in every union alternative §9.1's grammar admits.
- **FR-006**: An unresolvable name MUST be refused at its position rather than treated as permissive
  (v0.4 FR-012, unchanged).
- **FR-007**: A resolved type's own demands MUST apply wherever its name is used, exactly as if they
  had been written inline at the usage.
- **FR-008**: A type name MUST resolve against **the definitions in scope at the layer whose demand
  names it** — that layer's own declarations and those of its ancestors — never against a merged or
  leaf-most type graph. A type definition therefore governs **from the layer that declares it,
  downward**, which is the identical rule v0.3 FR-026 settled for cascade strategies and for the same
  reason: authority flows one way (§2.3), so a declaration binds descendants and never ancestors.
- **FR-008a**: Consequently, a descendant that widens or redefines an inherited type MUST NOT be able
  to make a value valid that an ancestor rejects — not because the widening is refused, but because
  the ancestor's own demand still resolves the ancestor's own definition, and whole-chain validation
  (v0.4 FR-014) still applies it. This is v0.4 FR-033's posture, applied to named types: the guarantee
  holds by construction, with no subsumption check, which §5.4 keeps in v1.x.
- **FR-009**: A cycle among type definitions MUST be refused, naming the cycle, rather than followed.
  v0.2 established that a reference cycle is an error and not a hang; a type graph is no exception.
- **FR-010**: Resolution MUST be deterministic — the same pedigree resolves the same names the same
  way on every run.

**`accept` as a selector** (§7)

- **FR-011**: `accept` in a type entry MUST declare that type's alternatives.
- **FR-012**: `accept` at a usage MUST select a subset of the declared alternatives, narrowing the
  demand.
- **FR-013**: An `accept` naming an alternative the type never declared MUST be refused — selecting
  outside the declared set is widening, which §5.2 forbids absolutely.
- **FR-014**: `accept` MUST be a selector only. No computation, no template language, no expression
  evaluation (§7's first law, Principle VI).
- **FR-015**: Selecting every declared alternative MUST behave exactly as no selector at all.

**The namespace** (§7)

- **FR-016**: Type names MUST occupy one flat namespace per pedigree. An unqualified name MUST resolve
  to the **nearest** declaration at or above the layer that names it — never to an error merely
  because more than one layer declares it (`SPEC.md` §7, §15).
- **FR-016a**: A descendant redeclaring an inherited type name MUST NOT be an error. It is the
  narrowing §7's cascade law describes, and it governs from its declaring layer downward (FR-008).
- **FR-016b**: A collision — two declarations of one name **not** standing in an ancestor/descendant
  relation — MUST remain an error carrying both declaring positions. Under §6.1's single-parent
  restriction the pedigree is a chain, so this is **unreachable in v1** and is reserved for future
  multi-adoption. Being unreachable, it MUST be documented as such wherever it is implemented rather
  than left to look like live protection (the lesson v0.5's own depth-limit guard taught).
- **FR-017**: A collision, when reachable, MUST be detected
  in the **validate** stage, alongside the existing vocabulary readers — not in graph build. §7 calls
  it "a graph-build error", which is true of its *nature* (it is a property of the assembled chain,
  detectable with no configuration data present) but not of its *stage*: `src/graph/` is deliberately
  ignorant of schema vocabulary (§3, Principle IV), and teaching it `types:` would put a third
  vocabulary reader in the one stage kept free of schema semantics — and would oblige a stage that has
  never carried §10's error contract to start.
- **FR-018**: A layer MUST NOT redeclare a built-in type name.
- **FR-019**: Qualified names MUST resolve to exactly one declaration, independently of which layer
  asks. The qualifier MUST be the **last segment of the declaring document's `$id`** — `core` for
  `$id: site-builder/core`, which is what §7's own worked example shows without stating the rule.
- **FR-019a**: Two documents in one pedigree whose `$id`s end in the same segment therefore collide in
  the qualifier namespace, and that collision MUST be reported like any other (FR-017) rather than
  silently preferring one. The escape hatch needs its own escape hatch to be an error, not a coin toss.
- **FR-019b**: A document with no `$id` MUST NOT be reachable by qualified name. It has no qualifier
  to derive, and inventing one from its location would make the name depend on where the document was
  fetched from rather than what it claims to be.
- **FR-020**: A name declared by exactly one layer and used by a descendant MUST resolve.
  Inheritance is not collision.

**Nested demands** (§9, as amended)

- **FR-021**: `keys` MUST constrain a mapping value's own children, the way the schema's top-level
  `keys:` constrains the configuration's own top level.
- **FR-022**: `items` MUST be generalized from v0.4's single level to arbitrary depth.
- **FR-023**: `keys` and `items` MUST each be able to recurse into further `keys`/`items` beneath
  them, to whatever depth the data nests.
- **FR-024**: A `keys` demand against a non-mapping value, or an `items` demand against a
  non-sequence, MUST contribute no violation of its own — `type` is what refuses the wrong shape
  (v0.4's established rule, applied consistently).
- **FR-025**: Recursion MUST be bounded by an explicit depth limit, in the manner v0.1 bounds parse
  depth. Depth is a resource limit, not an unbounded promise.
- **FR-026**: A violation found at depth MUST be reported at the offending value's own position, with
  an RFC 6901 pointer naming that position in the merged configuration — not at its parent's.

**Cascade, monotonicity, and the error contract**

- **FR-027**: A descendant MUST be able to narrow an inherited type, tightening every usage of it
  **that the narrowing governs** — the declaring layer's own usages and every layer below it, per
  FR-008. It does not reach back and tighten an ancestor's own usage of the same name; an author who
  needs that restates the key's demand, which is one line and says what it means (`SPEC.md` §7's
  worked narrowing).
- **FR-027a**: FR-027 MUST have conformance coverage, both halves. The first draft of this milestone
  asserted it while FR-016 made it impossible, and **no conformance case cited it at all**, which is
  exactly why the contradiction shipped. A requirement with no case is a requirement nobody checked.
- **FR-028**: A descendant MUST NOT be able to widen or redefine an inherited type in a way that makes
  a value valid that an ancestor's version rejects. The mechanism follows FR-008's answer.
- **FR-029**: Every §5.2 row this milestone's vocabulary newly makes constructible MUST be discharged
  as a property test, and every row it does not MUST be **declared deferred rather than stubbed**
  (v0.3 FR-024, v0.4 FR-032; the rule now stated for the third time).
- **FR-030**: Every new diagnostic MUST satisfy §10's full error contract — the violated demand with
  its declaring layer, pointer and span; the offending value with its layer and span; and the pointer
  into the merged configuration. Gate 5 is at full strength from v0.4 onward.
- **FR-031**: Validation MUST report every failure it can determine independently, not the first, and
  not the first category (v0.1 FR-019, v0.2 FR-025, v0.3 FR-028, v0.4 FR-017).

### Key Entities

- **Type declaration**: a named bundle of demands contributed by one layer. Carries its name, its own
  demands, its declared alternatives, its declaring layer, and its span.
- **Type graph**: the declarations of a whole pedigree under one flat namespace, with the built-ins
  as its floor. Must be acyclic (FR-009).
- **Resolved type**: what a name means at one usage site — the declaration's demands narrowed by
  whatever the usage selected.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A named type's demands are enforced at every usage of it, in 100% of corpus cases.
- **SC-002**: A descendant narrowing an inherited type tightens every usage of that type, with no
  usage needing to be edited.
- **SC-003**: No descendant's type definitions can admit a value that an ancestor's definitions
  reject — verified as a property, not only by example.
- **SC-004**: A violation nested three or more levels deep is reported at its own position with a
  pointer that resolves in the merged configuration, in 100% of cases.
- **SC-005**: A type-name collision is reported with both declaring positions in 100% of cases; zero
  collisions resolve by silent shadowing.
- **SC-006**: A cycle among type definitions is refused rather than hanging, in 100% of cases and
  within a bounded time.
- **SC-007**: Name resolution is deterministic across runs.
- **SC-008**: Every §5.2 row is either discharged by a property test or named in this spec as
  deferred, with no row silently unaddressed.

## Assumptions

- **`accept` has one meaning, applied at two levels.** It appears in a type declaration and at a
  usage, which reads at first like one keyword carrying two meanings — the defect Principle VI
  forbids, and the one `SPEC.md` §15 has just resolved for `format`. It is not: `accept` always means
  "the permitted alternatives at this point", and narrowing is subset selection. Recorded explicitly
  because it looks like a defect until it is stated.
- **Primitives remain built-in constants through v0.5.** §7 says they are "predefined types in the
  meta-schema's own `types` section", which cannot be literally true until the meta-schema bootstrap
  lands in v0.7. Until then they are built into the checker, and v0.7 is where the claim becomes true
  rather than aspirational. Recorded rather than glossed, per the lesson v0.2 learned three times.
- **A type entry holds demands, not provisions.** §7 defines a type as a bundle of *demands*;
  `provide`, `cascade`, `seal`, `final`, and `delegate` are key vocabulary, not type vocabulary, and
  are refused inside a type entry under FR-002's closed list rather than silently ignored.
- **Ancestors cannot resolve a descendant's types.** Authority flows one way (§2.3). A name declared
  only downstream is unresolvable upstream, and that is a refusal rather than a lookup that reaches.
- **Static subsumption remains out of scope.** §5.4 assigns schema-vs-schema proof to v1.x. This
  milestone enforces the §5.2 named-types row by the same dynamic mechanism v0.4 FR-033 established
  for demands, via FR-008's declaring-layer resolution.
- **§7's cascade law and its namespace law contradicted each other, and `SPEC.md` §15 has now settled
  it in favour of narrowing.** Redeclaring a name *is* how a narrowing is written, so treating every
  redeclaration as a collision made §7's "descendants may narrow inherited types" unreachable — and
  because §6.1 makes the v1 pedigree a chain, every same-name pair is ancestor/descendant, so the
  collision rule could only ever fire on the very case it was not written for. It was written for the
  multi-adoption world §6.1 pre-commits C3 linearization for. §7 now carries a **worked narrowing**,
  added for the same reason §5.3 gained a worked cascade: prose alone let this be read two ways, and
  it was implemented the wrong way with nothing to catch it.
- **What survives of the "tightening every usage" question.** §7's ergonomic promise is still narrower
  than it sounds, and the amendment now says so plainly rather than leaving it implied: a house layer
  narrowing `resource` **without** restating the key it governs does not tighten an ancestor's usage
  of that key. That is the price of FR-008's declaring-layer resolution, and it is the same property
  that makes a descendant's *widening* inert — which is why it is worth paying. US4's Acceptance
  Scenario 3 exists to pin exactly this behaviour, because it is the half a reader will not predict.

## Out of Scope

Each belongs to a later milestone in the `SPEC.md` §14 roadmap:

- Delegation and transclusion, and §10's delegation breadcrumb (v0.6)
- `seal`, `final`, cascade limits, and §5.2's "Struct openness" row — which this milestone finally
  gives a subject to govern, without governing it (v0.7)
- The meta-schema bootstrap that makes §7's "primitives are predefined types" literally true (v0.7)
- Static subsumption — schema-vs-schema refinement proved with no data present (v1.x, §5.4 item 2)
- The typed TypeScript output surface (v1.0); JSON Schema export (v1.x)
- Any command-line surface
