# Feature Specification: The Meta-Schema Bootstrap (Self-Hosting)

**Feature Branch**: `008-metaschema-bootstrap` *(spec directory; no separate git branch created)*

**Created**: 2026-09-01

**Status**: Draft

**Input**: User description: "Cascata v0.7, part 2 of 2. The meta-schema bootstrap — self-hosting.
`SPEC.md` §14 item 7 requires it early, and the constitution forbids it slipping past v1.0."

**Implements**: `SPEC.md` §2.6 (self-hosting), §9's `values` and `directives:` vocabulary, §7's
guarded-recursion law, §11's "the schema language itself is versioned via the meta-schema's own
pedigree", §14 item 7, part 2 of 2.

**Builds on**: everything, and `007-sealing-and-embedding` specifically — the meta-schema must be
able to describe `seal`, `final`, and `authority:`, which requires them to exist, and §16 names this
milestone as `load()`'s first real consumer.

**Why this milestone is different from the other seven.** Every milestone so far built a mechanism
and tested it against cases written for it. This one takes the finished vocabulary and asks it to
describe itself. §14's justification — "do this early; every vocabulary wart becomes a wart you
personally suffer" — is not a slogan here, it is the acceptance criterion. **Planning alone already
made good on it**: three warts and one unimplementable obligation surfaced from merely attempting to
write the meta-schema on paper, before a line of code, and are settled in `SPEC.md` §15:

- **No construct for a mapping whose keys the schema cannot enumerate.** `keys` names children one
  at a time. The meta-schema's own `keys:` section is a mapping of author-chosen names, so the
  language could not describe its most central construct. → `values`.
- **No recursive types.** v0.5 refused every self-reachable type as `unresolvable-type-cycle`, which
  is right for an unguarded alias cycle and wrong for a type guarded by a structural level. The
  meta-schema is unavoidably recursive: a key declaration contains a demand, a demand contains
  `keys`, `keys` contains key declarations. → guarded recursion.
- **No way to constrain the reserved `$`-keys.** They are stripped before a configuration exists, so
  a meta-schema constraining them through `keys:` would constrain something already removed. →
  `directives:`.
- **No diagnostic severity**, so §5.5's mandated lint had been unbuildable for six milestones.
  Settled and built in `007`.

The standing expectation for this milestone is therefore that **more warts will surface during
implementation**, and that reporting them is the deliverable every bit as much as the code is.

## User Scenarios & Testing *(mandatory)*

The user here is the **schema language itself**, which is an unusual thing to say and is the point.
Behind it stand two real ones: the **schema publisher**, who gets told that their schema is malformed
by the same machinery that tells their users a config is, in the same sentence shape, at the same
precision; and the **language author**, who is forced to write in the vocabulary they legislated
before they freeze it at v1.0.

### User Story 1 - A schema constrains a mapping whose keys it cannot enumerate (Priority: P1)

A schema says "every entry of this mapping, whatever it is called, has this shape".

**Why this priority**: nothing else in this milestone can be written without it. The meta-schema's
`types:`, `keys:`, and `directives:` sections are all mappings of author-chosen names.

**Independent Test**: a schema declaring `values` on a key demanding a mapping; a config supplying
three entries with names the schema never saw; confirm all three are checked and one bad one is
refused at its own position.

**Acceptance Scenarios**:

1. **Given** a key demanding a mapping with `values`, **When** a config supplies entries under names
   the schema does not declare, **Then** every entry is checked against `values`, and a violation is
   positioned at the offending entry.
2. **Given** a key declaring **both** `keys` and `values`, **When** an entry named by `keys` is
   checked, **Then** both demands apply — they compose by intersection (§5.1), and no precedence rule
   is invented.
3. **Given** `values` with `seal: open`, **When** a config supplies any key at all, **Then** it is
   admitted and shaped by `values`. `values` says what shape, `seal` says which keys; they are
   orthogonal and this MUST have its own case.
4. **Given** `values` nested inside `values`, or inside `keys`, or inside `items`, **When** checked,
   **Then** it recurses to whatever depth the data nests, bounded by the existing demand-depth cap —
   the same generalization `items` received in v0.5.
5. **Given** a descendant adding `values` where an ancestor declared none, **When** resolved, **Then**
   it is legal (narrowing). Given a descendant loosening or removing an inherited `values`, **Then**
   it is refused (§5.2's new row).
6. **Given** `values` declared against a value that is not a mapping, **When** checked, **Then** it is
   a no-op — the shape refusal belongs to `type`, and doubling it would produce two diagnostics for
   one mistake (v0.3 FR-028's precedent).

### User Story 2 - A type may refer to itself when doing so consumes structure (Priority: P2)

A type describes a shape that nests into itself. Checking it terminates because every step consumes
a level of the document.

**Why this priority**: the meta-schema cannot be written without it, and the rule that must be
loosened is a rule that currently fires correctly on a different case — so this is a refinement with
a real risk of over-loosening.

**Independent Test**: a type reaching itself through `keys`; confirm it validates a three-level
document and terminates. Alongside it, an unguarded alias cycle; confirm it is still refused.

**Acceptance Scenarios**:

1. **Given** a type reaching itself through `keys`, `items`, or `values`, **When** declared, **Then**
   it is accepted and checks a nested document to the depth the document actually has.
2. **Given** a type reaching itself through **type expressions alone** (`A: {demand: {type: B}}`,
   `B: {demand: {type: A}}`), **When** declared, **Then** it is still refused as
   `unresolvable-type-cycle`. The existing v0.5 case for this MUST remain green and unmodified.
3. **Given** a guarded recursive type and a document nested past the demand-depth cap, **When**
   checked, **Then** the existing depth refusal fires. Recursion is bounded by the cap, not by the
   cycle rule.
4. **Given** a cycle that is guarded at one point and unguarded at another (`A → B` by alias, `B → A`
   through `keys`), **When** declared, **Then** it is **accepted**: one structural level anywhere in
   the loop makes the loop productive. This is the case most likely to be got wrong in either
   direction and MUST be tested explicitly.
5. **Given** a self-recursive type, **When** a document is checked against it, **Then** checking
   terminates. A property test over adversarially nested documents MUST establish this; a
   hand-written three-level case does not.

### User Story 3 - A schema constrains the reserved directives (Priority: P3)

A meta-schema states that `$pin` is `sha256:` followed by 64 hex characters, and that `$adopts` is a
single string — rules that until now lived only in hand-written code.

**Why this priority**: it is the third structural gap, and it is the one that pays off outside the
bootstrap as well: two rules `SPEC.md` §6.1 and §9 state normatively have had no way to be *declared*
in the language they govern.

**Independent Test**: a meta-schema whose `directives:` section constrains `$pin` by pattern; a schema
carrying a malformed pin; confirm refusal positioned at the `$pin`.

**Acceptance Scenarios**:

1. **Given** a `directives:` section constraining `$pin` by `pattern`, **When** a schema carrying a
   malformed `$pin` is validated against it, **Then** it is refused, positioned at that `$pin` in
   that document.
2. **Given** a `directives:` section naming a key that is not one of the six reserved keys, **When**
   read, **Then** it is refused — the vocabulary is closed (Principle VI).
3. **Given** a `directives:` section, **When** the configuration is produced, **Then** **no** reserved
   key appears in it. `directives:` constrains directives; it never promotes them to data, and the
   fold's stripping rule (v0.3) is unchanged. This MUST have its own case, because the failure mode
   is silent and would corrupt every merged tree.
4. **Given** a `directives:` entry, **When** read, **Then** it takes the same per-key vocabulary a
   `keys:` entry takes.
5. **Given** a `directives:` section declared by a **config**, **When** read, **Then** it has no
   effect.

### User Story 4 - The schema language describes itself (Priority: P4)

The meta-schema exists, is written in Cascata's own vocabulary, and every schema in the conformance
corpus validates against it.

**Why this priority**: it is the milestone. Everything above exists to make it writable.

**Independent Test**: the meta-schema, and a run validating every schema document in the corpus
against it.

**Acceptance Scenarios**:

1. **Given** the meta-schema, **When** it is read, **Then** it describes `types`, `keys`,
   `directives`, `authority`, the per-key vocabulary (`demand`, `provide`, `cascade`, `seal`, `final`,
   `delegate`), and the full `demand` keyword set including `values`.
2. **Given** the meta-schema, **When** it is validated **against itself**, **Then** it passes. The
   meta-schema is a schema; a language that cannot describe its own description has not self-hosted,
   it has described everything except the hardest document. This is the milestone's fixed point and
   its single most important case.
3. **Given** every schema document in the existing conformance corpus, **When** validated against the
   meta-schema, **Then** each passes. Six milestones of hand-written schemas are the corpus that says
   whether the meta-schema describes the language as built or only as imagined.
4. **Given** a schema with a genuine vocabulary error — an unknown demand keyword, a `cascade` value
   that is not `replace`/`append`, a malformed type expression — **When** validated against the
   meta-schema, **Then** it is refused. For each such error the codebase **already** refuses by
   hand-written check, the meta-schema's verdict MUST agree with the hand-written one. Where they
   disagree, that disagreement is a finding to report, not a test to adjust.
5. **Given** the meta-schema, **When** the milestone completes, **Then** every place the vocabulary
   was awkward, insufficient, or surprising to write in is **reported**, including those worked
   around successfully. This is a deliverable, not a courtesy: §14 justifies the milestone's position
   in the roadmap by exactly this feedback, and a report saying "it went fine" would mean the
   milestone had not been run.

### User Story 5 - The library loads its own meta-schema through its own seam (Priority: P5)

Cascata asks its host for its meta-schema, the same way it asks for anything else.

**Why this priority**: §16 says the bootstrap is `load()`'s first real consumer and that self-hosting
is "the embedding story exercising itself". It is the smallest story here and the one that proves the
other milestone.

**Independent Test**: `load()` against the meta-schema, driven by an in-memory host.

**Acceptance Scenarios**:

1. **Given** the meta-schema, **When** it is obtained, **Then** it is obtained through the host seam
   like any other document. The library does not special-case its own meta-schema into a bundled
   constant it reads directly, because that would be the one document exempt from the article that
   governs every other.
2. **Given** a host with no filesystem, **When** the meta-schema is loaded, **Then** it loads.
3. **Given** the meta-schema's own pedigree, **When** queried, **Then** the schema language's version
   is readable from it (§11's last clause, which has had nothing to point at until now).

### Edge Cases

- **The meta-schema's `$adopts`.** Does it adopt anything, and what terminates the chain?
- **A schema that fails meta-validation but resolves fine today.** Six milestones of corpus schemas
  were never held to a meta-schema; some may be sloppy in ways nothing checked.
- **`values` on the meta-schema's own `keys:` section, describing entries that themselves contain
  `values`.** The construct describing itself.
- **A recursive type whose recursion is guarded by `values`** specifically — the newest guard.
- **`directives:` constraining `$schema`**, which appears in configs, not schemas.
- **The meta-schema's own `directives:` describing `$id`, while the meta-schema itself has an `$id`.**
- **Depth cap versus a legitimately deep meta-schema.** The meta-schema is the deepest document this
  project has produced; if it approaches the cap, the cap needs re-examining, and that is a finding.

## Requirements *(mandatory)*

### Functional Requirements

**`values`** (§9, §5.2)

> **Amended 2026-09-01, post-implementation.** FR-001 left `values`' *syntax* unstated and the first
> implementation read it as a key declaration; it takes a **bare demand mapping**, as `items` does
> (`SPEC.md` §9, §15). FR-005 and FR-017 are reworded to say what they meant — the implementer read
> both correctly and the requirements were carelessly written. FR-020 is corrected against a defect in
> `SPEC.md` §11 itself, now amended.

- **FR-001**: `values` MUST join the `demand` vocabulary, MUST take a **bare demand mapping** and not
  a key declaration, and MUST constrain every entry of a mapping
  regardless of key.
- **FR-002**: Where `keys` and `values` both cover an entry, both MUST apply, composing by
  intersection.
- **FR-003**: `values` MUST nest to arbitrary depth and MUST interoperate with `keys` and `items`
  nesting, bounded by the existing demand-depth cap.
- **FR-004**: `values` MUST be orthogonal to `seal`: `values` constrains shape, `seal` constrains
  membership.
- **FR-005**: Adding or tightening `values` downstream MUST be legal; loosening or removing it MUST
  be refused **dynamically**, by §5.4's whole-chain validation, exactly as `seal` is. A *static*
  refusal is subsumption checking, which §5.4 item 2 defers to v1.x by name; the original wording read
  as demanding one and did not mean to.
- **FR-006**: `values` against a non-mapping value MUST be a no-op, not a second diagnostic.

**Guarded recursion** (§7)

- **FR-007**: A type reaching itself through at least one of `keys`, `items`, or `values` MUST be
  accepted.
- **FR-008**: A type reaching itself through type expressions alone MUST still be refused as
  `unresolvable-type-cycle`, and v0.5's existing case for it MUST remain green and unmodified.
- **FR-009**: A cycle containing at least one structural level anywhere MUST be accepted, even where
  other links in the same cycle are unguarded aliases.
- **FR-010**: Checking a guarded recursive type MUST terminate on every finite document, bounded by
  the demand-depth cap. Established by property test, not by example.

**`directives:`** (§9, §6.1)

- **FR-011**: A top-level `directives:` section MUST be recognized, with a vocabulary **closed** to
  the six reserved keys (`$id`, `$version`, `$adopts`, `$pin`, `$schema`, `$extends`).
- **FR-012**: A `directives:` entry MUST take the same per-key vocabulary a `keys:` entry takes.
- **FR-013**: `directives:` MUST NOT cause any reserved key to appear in a merged configuration. The
  fold's stripping rule is unchanged.
- **FR-014**: `directives:` declared by a config MUST have no effect.

**The meta-schema** (§2.6, §9, §11)

- **FR-015**: A meta-schema MUST exist, written in Cascata's own vocabulary, describing `types`,
  `keys`, `directives`, `authority`, the full per-key vocabulary, and the full `demand` keyword set.
- **FR-016**: The meta-schema MUST validate against itself.
- **FR-017**: Every schema document in the conformance corpus **that the pipeline accepts** MUST
  validate against the meta-schema. The corpus deliberately contains malformed schemas; a meta-schema
  that passed those would be the broken one. The original wording said "every schema document" and was
  unsatisfiable as written.
- **FR-018**: For every schema-vocabulary error the codebase already refuses by hand-written check,
  the meta-schema's verdict MUST agree. A disagreement is a reported finding, never a silently
  adjusted test.
- **FR-019**: The meta-schema MUST be obtained through the host seam, never read directly.
- **FR-020**: The schema language's version MUST be readable from the meta-schema's **identity in the
  pedigree of a schema that adopts it** — never from the meta-schema's own pedigree, which is empty
  (a pedigree entry carries no `$version`, and §6.1's chain excludes the entry document). `SPEC.md`
  §11 asserted the impossible version of this and is amended (§15).

**Reporting** (Principle V, §14)

- **FR-021**: Every place the vocabulary proved awkward, insufficient, or surprising **MUST** be
  reported, including those worked around successfully, and including any that argue for a change to
  `SPEC.md`. Flagging governance defects is the implementer's duty; amending governance is not the
  implementer's call.

**Documented examples are executed** (§5.3, §7, W-6)

- **FR-021a**: Every fenced YAML example in `SPEC.md`, `README.md`, and `specs/**/*.md` MUST be
  parsed by the project's own parser in a test. An example deliberately abbreviated with an ellipsis
  MUST have the ellipsis substituted with plausible content and its **skeleton** parsed, never
  skipped — skipping is how a broken block hides. This exists because five of `SPEC.md`'s worked
  examples were malformed YAML for six milestones (§15, W-6): they were prose that had never been
  run, and no executed fixture happened to use the form that breaks. An example is worth what
  executing it costs.

**Invariants**

- **FR-022**: No existing test is weakened.
- **FR-023**: `pnpm typecheck` clean; no `any`; no assertion casts on the node model.
- **FR-024**: The format-blindness and host boundaries of Principle IV remain intact.

### Key Entities

- **`values`** — the mapping analogue of `items`: every entry, whatever its key.
- **Guarded recursion** — a type cycle that consumes a structural level per traversal, and therefore
  terminates on finite data.
- **`directives:`** — the section that constrains reserved keys without promoting them to data.
- **The meta-schema** — the document that describes schema documents, written in the language it
  describes, and validated by the pipeline it governs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The meta-schema validates against itself.
- **SC-002**: Every schema in the conformance corpus validates against the meta-schema.
- **SC-003**: A guarded recursive type validates a document nested to at least five levels and
  terminates; an unguarded alias cycle is still refused by the v0.5 case, unmodified.
- **SC-004**: A mapping with keys the schema never enumerated is fully checked by `values`.
- **SC-005**: No reserved key appears in any merged configuration, before or after `directives:`
  exists.
- **SC-006**: The meta-schema is loaded through the host seam, demonstrated with an in-memory host.
- **SC-007**: All tests from v0.1–v0.7 part 1 remain green, unmodified in substance.
- **SC-008**: The milestone report enumerates the vocabulary frictions found while writing the
  meta-schema. An empty list is a failed milestone, not a clean one.
- **SC-009**: Every YAML example in the repository's documentation parses, verified by a test that
  fails when a deliberately-broken example is introduced.

## Assumptions

- **Meta-validation is available, not automatic.** §2.6 frames self-hosting as "publishing a schema =
  validating it as a config" — a publishing act. Running the meta-schema on every `load()` would
  double the work of every resolution and would change the diagnostics of every schema written in the
  last six milestones. It is therefore exposed and exercised over the corpus in v0.7, and whether it
  becomes the default is a v1.0 question, when the vocabulary freezes. **This is a judgment call, not
  a citation** — `SPEC.md` does not settle it, and it is flagged rather than buried.
- **The meta-schema terminates its own pedigree.** It is the root; it adopts nothing.
- **The corpus is the oracle.** Where the meta-schema and six milestones of hand-written checks
  disagree, neither is assumed right; the disagreement is investigated and reported.

## Out of Scope

- Making meta-validation the default path (v1.0, with the vocabulary freeze).
- The JSON Schema exporter (v1.x) — a different direction of translation entirely.
- `$extends` (§6.2) and anything `finalAgainstForking` would enforce.
- Static subsumption lint (v1.x).
