# Feature Specification: Constraint Checker & Whole-Chain Validation

**Feature Branch**: `004-constraint-checker` *(spec directory; no separate git branch created)*

**Created**: 2026-08-31

**Status**: Draft

**Input**: User description: "Cascata v0.4, the fourth milestone of the SPEC.md §14 roadmap: the constraint checker (closed vocabulary), whole-chain validation, and the error contract; `tool certify`."

**Implements**: `SPEC.md` §3 (the **validate** stage), §5.1 (`demand` composes by intersection), §5.2
(the monotonicity table), §5.4 (enforcement, in order), §5.5 (`required` × `provide`), §9 (the
`demand` vocabulary), §9.1 (the leaf type-expression DSL), §10 (the validation & error contract),
§14 item 4.

**Builds on**: v0.1 (a document becomes a positioned tree), v0.2 (a chain becomes a graph with a
pedigree), v0.3 (the pedigree folds into one configuration with a provenance record). v0.4 is where
the configuration is finally **judged**: every milestone so far could assemble a wrong configuration
and say nothing.

## User Scenarios & Testing *(mandatory)*

The users are the **config author**, who wants to be told exactly which rule their value broke and
who wrote that rule; the **schema publisher**, who declares constraints and needs them enforced even
when a descendant schema forgot to restate them; and the **library consumer**, who needs a
configuration that is not merely assembled but known-good before their application reads it.

This is the milestone that reads **`demand`** for the first time. v0.3 deliberately ignored it
(v0.3 FR-002); the same ignore-don't-guess discipline still applies here to `seal`, `final`, and
`delegate`, which belong to v0.6 and v0.7.

Two properties distinguish this milestone from "run a JSON Schema validator":

1. **Validation is whole-chain, not leaf-only** (§5.4). The merged configuration is checked against
   **every** layer of the pedigree, root to leaf. Narrowing-by-construction makes leaf-only checking
   tempting and it is refused deliberately: whole-chain checking stays correct even when the merge
   engine is wrong, and it is what makes an error layer-precise.
2. **Every diagnostic names both sides** (§10). Not "value invalid" but *which* demand, written in
   *which* document, at *which* position, rejected *which* value, written *where*. The constitution's
   gate 5 has been phasing this in — "Before v0.4 that is code + sentence + span" — and v0.4 is where
   the phasing ends.

### User Story 1 - A configuration is judged against its schema's demands (Priority: P1)

A library consumer merges a configuration and asks whether it is valid. Where a schema demands a
type, a range, a length, a pattern, or a member of an enumeration, a value that violates it is
reported; a value that satisfies every demand yields a configuration certified fit to use.

**Why this priority**: It is the milestone. Every earlier milestone could produce a confidently
wrong configuration — a string where a number was demanded, a value outside every range the schema
allows — and report success. This is the first slice that can say *no*.

**Independent Test**: Validate a merged two-layer configuration against a schema demanding a type and
a range on one key; confirm a conforming value passes and a violating value is reported with the
demand's own position and the value's own position.

**Acceptance Scenarios**:

1. **Given** a schema demanding `type: string` and a config supplying a string, **When** validated,
   **Then** the result is valid and carries no diagnostics.
2. **Given** a schema demanding `type: int` and a config supplying a string, **When** validated,
   **Then** a diagnostic names the violated demand and the offending value, each with its own
   document and position.
3. **Given** a schema demanding `min`/`max` and a config supplying a number outside the range,
   **When** validated, **Then** the violation is reported at the value's position.
4. **Given** a schema demanding `enum` and a config supplying a value outside the set, **When**
   validated, **Then** the violation is reported and the diagnostic states what the permitted set was.
5. **Given** a schema demanding `pattern` and a config supplying a non-matching string, **When**
   validated, **Then** the violation is reported — the pattern is interpreted as ECMA-262 regex, cited
   rather than invented (§7).
6. **Given** a schema demanding `type: string[]` and a config supplying a sequence with one
   non-string item, **When** validated, **Then** the diagnostic points at the offending **item**, not
   at the sequence.
7. **Given** a key the schema demands nothing about, **When** validated, **Then** any value is
   accepted — silence in a schema is permission, not prohibition.
8. **Given** a value injected by a schema's own `provide` rather than written by the config, **When**
   it violates a demand, **Then** it is reported exactly as a config-written value would be, with the
   position of the `provide` that wrote it. A schema is not exempt from its own rules.

---

### User Story 2 - Every layer judges, not just the nearest (Priority: P2)

A schema publisher writes a root schema demanding that a key be a URL. A house layer adopting it
restates the key more loosely, or forgets to restate it at all. A config supplies a value the house
layer would accept and the root would not. Validation rejects it, and the diagnostic names the
**root** as the layer whose demand was violated.

**Why this priority**: It is §5.4's "belt and suspenders" and the reason §2.1's monotone-cascade
promise is trustworthy rather than merely intended. Without it, a single careless intermediate schema
silently voids every ancestor's constraint, and the property the whole design rests on — "valid
against a child implies valid against every ancestor" — becomes a hope.

**Independent Test**: A three-layer chain whose root demands more than its descendant does; confirm a
value satisfying the descendant but violating the root is rejected, and that the diagnostic cites the
root's document and position, not the descendant's.

**Acceptance Scenarios**:

1. **Given** a root demanding a constraint and a nearer layer restating it identically, **When**
   validated, **Then** a conforming value passes once — restating an ancestor's demand is legal and
   vacuous (§5.1), not a double failure or a duplicate diagnostic.
2. **Given** a root demanding a constraint no descendant restates, **When** a value violates it,
   **Then** it is reported and the diagnostic names the root as the declaring layer.
3. **Given** a value violating demands in two different layers, **When** validated, **Then** both are
   reported — one per violated demand, each layer-precise.
4. **Given** demands in several layers that a value satisfies, **When** validated, **Then** the
   result is valid, and validation cost is proportional to the chain, not exponential in it.
5. **Given** a merged configuration and a pedigree, **When** validated twice, **Then** the same
   diagnostics are produced in the same order — order is total and deterministic, never dependent on
   map iteration or layer arrival.

---

### User Story 3 - `required` is checked after the merge, and `provide` may satisfy it (Priority: P3)

A schema publisher marks a key `required` and also supplies a `provide` for it. A config author who
omits the key still gets a valid configuration — the provide filled it. A config author who writes
`key: null` explicitly does not: `required` means present **and non-null**, and nulling-out is
refused.

**Why this priority**: §5.5 settles this as the **guaranteed-key pattern**, the thing that makes a
key compile to a non-optional property in v1.0's typed surface. It is a small slice with an
outsized payoff, and it is the one place where the ordering of two stages — provides inject during
merge, `required` checks post-merge — is load-bearing rather than incidental.

**Independent Test**: A schema declaring both `required: true` and a `provide` on one key; confirm an
omitting config validates, a config supplying its own value validates, and a config writing an
explicit null is rejected.

**Acceptance Scenarios**:

1. **Given** a key demanded `required` and a config omitting it with no provide anywhere in the
   chain, **When** validated, **Then** the key is reported missing, at a position naming the demand
   that required it.
2. **Given** a key demanded `required` with a schema `provide`, **When** the config omits it,
   **Then** the configuration is valid and carries the provided value — **no diagnostic of any
   level**. This is a feature, not a tolerated violation.
3. **Given** a key demanded `required` with a schema `provide`, **When** the config writes an
   explicit null, **Then** it is rejected: `required` forbids nulling-out, and null is a value rather
   than an absence (v0.3 FR-008).
4. **Given** a key demanded `required` inside a nested mapping, **When** the mapping itself is
   absent, **Then** the report is about the absent mapping and does not also emit a cascade of
   diagnostics for every key nested beneath it.

---

### User Story 4 - Malformed and unrecognized demand vocabulary is refused (Priority: P4)

A schema publisher misspells a constraint keyword, writes a constraint whose value is the wrong
shape, or reaches for a constraint this version does not implement. Each is refused at the position
where it was written, and the refusal distinguishes "no such keyword" from "that keyword exists but
arrives in a later version".

**Why this priority**: Principle VI — closed vocabulary, deny by default. A misspelled constraint
that is silently ignored is strictly worse than a rejected one: the schema publisher believes a rule
is being enforced and it is not, which is the one failure mode a constraint checker must never have.

**Independent Test**: A schema with an unrecognized key inside `demand`; confirm validation refuses
it, at that key's own position, and does not proceed as though the schema were sound.

**Acceptance Scenarios**:

1. **Given** a `demand` containing a keyword outside §9's closed vocabulary, **When** validated,
   **Then** it is refused at that keyword's position — never ignored.
2. **Given** a `demand` containing a keyword §9 lists but this version does not implement, **When**
   validated, **Then** it is refused as **unimplemented**, naming the version it arrives in — a
   distinct diagnostic from "unknown", following v0.3 FR-014's treatment of `merge-by-key`.
3. **Given** a constraint whose value is the wrong shape (`min: "ten"`, `enum: 3`, `required: "yes"`),
   **When** validated, **Then** it is refused at the value's position, naming the shape expected.
4. **Given** a `type` expression that does not parse under §9.1's grammar, **When** validated,
   **Then** it is refused at the expression's position.
5. **Given** several independent vocabulary failures across a schema, **When** validated, **Then**
   **all** of them are reported, not merely the first — and not merely the first *category*
   (v0.1 FR-019, v0.2 FR-025, v0.3 FR-028; the same obligation, stated for the fourth time because
   v0.3 omitted it once and the omission reproduced exactly the behaviour it forbids).
6. **Given** a schema declaring `seal`, `final`, or `delegate`, **When** validated, **Then** they are
   **ignored**, not refused — they are v0.6/v0.7 vocabulary, and this milestone reads neither meaning
   nor error into vocabulary it does not implement (v0.3 FR-002's rule, still binding).

### Edge Cases

- **A demand on a key no layer ever supplies, not marked `required`.** Nothing to validate; not an
  error. A demand constrains a value if one exists.
- **A demand whose own declaring document is the config.** Merge policy comes from schemas only
  (v0.3 FR-015); demands do too. A config's `keys:` section is ordinary data.
- **A demand nested below the top level.** v0.3 confined `cascade` to top-level keys (v0.3 FR-027).
  `demand` is not so confined — §8's own example nests `keys:` inside a demand — so the depth at
  which demands may appear must be stated rather than inherited by analogy.
- **A sequence demand over an empty sequence.** Vacuously satisfied; `min`-style constraints on
  length are `minLength`, and conflating the two is a defect.
- **Two demands in different layers that cannot both be satisfied** (`min: 5` in one, `max: 3` in
  another). Every value is rejected, by two separate diagnostics. Detecting the contradiction
  *itself* — with no value present — is static subsumption, which §5.4 places in v1.x.
- **A value violating a demand at a pointer that also carries an `append` accumulation.** The
  offending item is one contributor's, not the accumulated whole's; the diagnostic must name the
  layer that actually wrote that item — read from the item's own `span.origin`, not from v0.3's
  provenance record, which records mapping keys only and has no entry for one item inside an
  accumulated sequence (FR-023).
- **An astral-plane or combining-character string under `minLength`/`maxLength`.** Length in what
  units? The model counts code points (v0.1), and this must be stated, not assumed — the project has
  been bitten twice by UTF-16 code units masquerading as characters.
- **A `pattern` that is a catastrophically backtracking regex.** A schema is untrusted input under
  §11. Whether this milestone caps regex execution or accepts the exposure must be a decision on the
  record.

## Requirements *(mandatory)*

### Functional Requirements

**Reading the demand vocabulary** (§9)

- **FR-001**: The validator MUST read `keys.<name>.demand` from schema documents in the pedigree.
- **FR-002**: `seal`, `final`, and `delegate` MUST continue to be ignored — read by nothing, never
  guessed at (v0.3 FR-002's rule, unchanged).
- **FR-003**: Demands MUST be read from schema layers only. A `demand` written by a config MUST NOT
  take effect, on the same grounds as v0.3 FR-015: a config is data, and the contract is the schema's.
- **FR-004**: A `keys:` section absent, empty, or not a mapping MUST contribute no demands rather
  than raise an error (v0.3 FR-003's rule, unchanged).
- **FR-005**: The demand vocabulary MUST be **closed**. A keyword inside `demand` that is not in §9's
  list MUST be refused at its own position, never ignored (Principle VI).
- **FR-006**: A keyword §9 lists but this milestone does not implement MUST be refused as
  **unimplemented**, naming the milestone it arrives in — a diagnostic distinct from "unknown",
  following v0.3 FR-014.
- **FR-007**: A constraint whose value is the wrong shape MUST be refused at the value's position,
  naming the shape expected.

**Type expressions** (§9.1)

- **FR-008**: `type` values MUST be parsed as §9.1's leaf DSL: unions with `|`, arrays with `[]`,
  parentheses for grouping, `[]` binding tighter than `|`, whitespace insignificant.
- **FR-009**: A `type` expression that does not parse MUST be refused at its own position.
- **FR-010**: Union canonical form MUST flatten and dedupe as a **set** — order insignificant for
  equality — and arrays MUST compare structurally (§9.1).
- **FR-011**: The type names this milestone resolves MUST be exactly the information model's own kinds
  — `string`, `int`, `float`, `bool`, `null`, `mapping`, `sequence` — together with `SPEC.md` §7's
  built-in refinements of `string`: `url`, `path`, `glob`. `url` MUST follow the WHATWG URL Standard,
  `path` POSIX pathname semantics, and `glob` gitignore pattern syntax, each cited rather than
  invented (§7).
- **FR-011a**: A user-declared `types:` section MUST be refused as **unimplemented**, naming v0.5 —
  not ignored, and not reported as unknown (v0.3 FR-014's distinction).
- **FR-011b**: `accept` MUST likewise be refused as unimplemented, naming v0.5. It selects among a
  *named* type's declared alternatives (§7), and named types do not exist until v0.5.
- **FR-012**: An unresolvable type name MUST be refused at its position rather than treated as
  permissive — a name the checker cannot resolve is a rule it cannot enforce.

**Validating a configuration** (§5.4, §10)

- **FR-013**: Validation MUST take a merged configuration and its pedigree, and MUST report whether
  the configuration satisfies every demand in the chain.
- **FR-014**: Validation MUST check the merged tree against **every** layer's demands, root to leaf —
  never the leaf alone, whatever narrowing-by-construction would permit (§5.4).
- **FR-015**: Restating an ancestor's demand MUST be legal and vacuous — satisfying it once satisfies
  it, and MUST NOT produce a duplicate diagnostic (§5.1).
- **FR-016**: A value violating demands in several layers MUST produce one diagnostic per violated
  demand, each naming its own declaring layer.
- **FR-017**: Validation MUST report **every** violation it can determine independently, not the
  first, and not the first category (v0.1 FR-019, v0.2 FR-025, v0.3 FR-028).
- **FR-018**: Validation MUST be deterministic: the same configuration and pedigree produce the same
  diagnostics in the same order on every run.
- **FR-019**: Validation MUST be a distinct pipeline stage consuming only merge's output and the
  pedigree (§3), and MUST NOT be reachable only through merge.
- **FR-020**: A value supplied by a schema's own `provide` MUST be validated exactly as a
  config-written value is, at the `provide`'s own position. A schema is not exempt from its own rules.
- **FR-021**: A key no demand mentions MUST be accepted whatever its value — schema silence is
  permission (until `seal: closed` arrives in v0.7).

**The error contract** (§10)

- **FR-022**: Every diagnostic MUST carry the **violated demand**: its declaring layer, its RFC 6901
  pointer into that layer's document, and its span.
- **FR-023**: Every diagnostic MUST carry the **offending value**: its span, and the layer that wrote
  it. The writing layer MUST be determined from the value's own `span.origin`, which identifies its
  document directly — not by walking v0.3's provenance record, which records mapping keys only and
  cannot attribute an individual item inside a `cascade: append` accumulation.
- **FR-024**: Every diagnostic MUST carry the **pointer into the merged configuration** at which the
  violation occurred, as an RFC 6901 pointer. No path syntax may be invented (§10).
- **FR-025**: Every diagnostic MUST be renderable as §10's canonical sentence — `constraint from
  house.yaml:7 (/keys/styles/demand) rejected value from conf.network.yaml:3` — from its structured
  fields alone, with no string assembly at the call site.
- **FR-026**: The delegation breadcrumb §10's sentence carries MUST be absent rather than faked in
  this milestone; delegation is v0.6.

**`required` × `provide`** (§5.5)

- **FR-027**: `required` MUST be checked against the **post-merge** tree, after provides have injected.
- **FR-028**: `required` MUST mean **present and non-null**.
- **FR-029**: A `required` key satisfied by a schema's `provide` MUST produce **no diagnostic at any
  level** — the guaranteed-key pattern is a feature (§5.5).
- **FR-030**: A `required` key written explicitly null MUST be rejected even where a `provide` exists.
- **FR-031**: A `required` key absent inside an absent parent MUST NOT produce a cascade of
  diagnostics for every key beneath that parent.

**Monotonicity** (§5.2, Principle II)

- **FR-032**: Every §5.2 row this milestone's vocabulary makes constructible MUST be discharged as a
  property test, and every row it does not MUST be **declared deferred rather than stubbed** — the
  rule v0.3 FR-024 followed for the demand-satisfaction clause, and the lesson v0.2 learned three
  times: a requirement about a construct needs the vocabulary producing that construct to exist first.
- **FR-033**: A descendant schema whose demands are weaker than an ancestor's MUST NOT be able to make
  a value valid that the ancestor rejects. This milestone achieves that **dynamically**, through
  FR-014's whole-chain validation, and MUST NOT refuse the weakening itself: detecting it with no
  value present is static subsumption, which §5.4 assigns to v1.x. The §5.2 rows are therefore
  discharged as properties of the validation **outcome** — "no descendant's demands can admit a value
  that some ancestor's demands reject" — rather than as refusals.

**Invariants**

- **FR-034**: Validation MUST NOT mutate the merged configuration. It consumes a frozen tree and
  produces diagnostics.
- **FR-035**: Validation MUST NOT perform network access, and MUST NOT resolve any reference — every
  document it needs is already in the pedigree (§3: each stage consumes only the previous one's output).

### Key Entities

- **Demand**: one constraint declared on one key by one layer. Carries its constraint keyword and
  value, its declaring layer, its RFC 6901 pointer into that layer's document, and its span. Composes
  with other demands on the same key by **intersection only** (§5.1).
- **Type expression**: the parsed form of a `type` value — a set of alternatives, each a name at some
  array depth. Compares by canonical form, not by source text (§9.1).
- **Violation**: the pairing of a demand with the value that broke it, at a pointer into the merged
  configuration. The unit §10's canonical sentence renders.
- **Validation result**: either a certified configuration or a set of violations — never both, on the
  v0.3 `MergeResult` precedent.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A configuration violating any demand in any layer is reported, in 100% of corpus cases
  — never silently accepted.
- **SC-002**: 100% of diagnostics carry both a demand position and a value position, each naming a
  real document and a real offset — the full §10 contract, with zero exceptions.
- **SC-003**: A value satisfying the nearest layer but violating an ancestor is rejected, and the
  diagnostic names the ancestor, in 100% of cases.
- **SC-004**: Restating an ancestor's demand produces zero additional diagnostics for a conforming
  value.
- **SC-005**: Validation is deterministic: identical inputs give identical diagnostics in identical
  order on every run.
- **SC-006**: An unrecognized or malformed constraint keyword is refused at its own position in 100%
  of cases; zero are silently ignored.
- **SC-007**: A `required` key filled by a `provide` yields a valid configuration with zero
  diagnostics of any level, while an explicit null under the same demand is rejected — both in 100%
  of cases.
- **SC-008**: Every §5.2 monotonicity row is either discharged by a property test or named in the
  spec as deferred, with no row silently unaddressed.
- **SC-009**: Every diagnostic renders §10's canonical sentence from structured fields alone, with
  no bespoke string assembly at any call site.

## Assumptions

- **Validation is a distinct stage with its own entry point, not a phase of `merge()`.** §3's pipeline
  table makes Validate its own stage consuming only the previous stage's output, and Principle IV
  isolates stages. A caller merges, then validates. This also keeps §5.4's "trivially correct even
  under merge-engine bugs" claim true rather than aspirational.
- **`certify` is a library function in v0.4, not a command.** §14 names `tool certify`, but v0.1
  through v0.3 shipped a library with no CLI, and v0.3 research D3 set the precedent when it deferred
  `tool why` on the same reasoning: growing a command surface one verb at a time is worse than
  designing it once at v1.0. Deferred, not cancelled.
- **The offending value's layer is read from its own `span.origin`** (FR-023), not by walking v0.3's
  provenance record. The merged tree is built from the very node objects each layer contributed
  (`src/merge/fold.ts`), so a node's own span already names its writing document — including a single
  item inside a `cascade: append` accumulation, which the provenance record never addresses
  individually (it records at mapping-key granularity only, never inside a sequence's items). This
  reattaches, rather than discards, the earlier argument that provenance is "nearly impossible to
  retrofit" (§10): that argument is true of the **override chain** `why()` answers — which values
  lost the merge and to whom, unrecoverable once the fold completes — and remains the reason
  provenance is built during the fold rather than after it. It is not, however, the mechanism this
  milestone's value attribution uses; FR-023 draws on each node's own span, which the model already
  carries unconditionally (§4.1), not on the provenance record. Whether `validate()` consumes the
  provenance record for any other purpose is an open implementation question, not a settled one —
  recorded here rather than assumed silently either way.
- **`minLength`/`maxLength` count code points**, consistent with v0.1's model-wide rule that strings
  are UTF-8 compared by code point with no normalization. Stated rather than assumed because the
  project has twice been bitten by UTF-16 code units passing for characters.
- **Demands may appear at any depth, not only at top-level keys.** v0.3 confined `cascade` to
  top-level keys (FR-027) because accumulation is a whole-key policy; §8's own example nests `keys:`
  inside a demand, so no such confinement is inherited here. Recorded because the analogy is
  tempting and would be wrong.
- **Struct openness is NOT constructible in this milestone.** §5.2's "Struct openness" row is
  governed by `seal: open | closed`, which §14 places in v0.7. It is named here so the row's absence
  from this milestone's property tests is a recorded decision rather than an oversight — precisely
  the discipline FR-032 requires.
- **Contradictory demands across layers are not detected as such.** `min: 5` in one layer and
  `max: 3` in another produce two diagnostics for every value and no diagnostic on their own.
  Detecting the contradiction with no value present is static subsumption, which §5.4 assigns to
  v1.x as a lint.
- **The constraint checker is original work.** Per the constitution's dependency policy, Ajv MUST NOT
  be reachable from the validation core; it is confined to the future JSON Schema exporter. The
  vocabulary is closed and small by design precisely so this is a few hundred lines rather than a
  dependency.

## Out of Scope

Each belongs to a later milestone in the `SPEC.md` §14 roadmap:

- Static subsumption — proving schema-vs-schema refinement with no data present (v1.x, §5.4 item 2)
- Delegation, transclusion, and the breadcrumb in §10's canonical sentence (v0.6)
- `seal`, `final`, cascade limits, and the `required` + `final provide` info-lint of §5.5 (v0.7)
- The meta-schema bootstrap and self-hosting (v0.7)
- The typed TypeScript output surface, in which the guaranteed-key pattern becomes a non-optional
  property (v1.0)
- JSON Schema export, and Ajv in any form (v1.x)
- Any command-line surface, including `certify` as a command
