# Feature Specification: Sealing, Authority, and the Embedding Surface

**Feature Branch**: `007-sealing-and-embedding` *(spec directory; no separate git branch created)*

**Created**: 2026-09-01

**Status**: Draft

**Input**: User description: "Cascata v0.7, the seventh milestone of the SPEC.md §14 roadmap. v0.7 is
carved across **two** spec directories: this one, and `008-metaschema-bootstrap`. Both are v0.7."

**Implements**: `SPEC.md` §6.3 (Sealing / authority) in full, §5.2's `seal`/`final`/`$pin` rows, §9's
`seal`, `final`, and `authority:` vocabulary, §5.5's info-level lint, §8.1's info-level lint, §10's
diagnostic levels, §11's pinning legislation, and **Article VI (§16) in full** — the host seam, the
one-call `load()`, and `resource` values resolved against their declaring document. §14 item 7,
part 1 of 2.

**Builds on**: v0.1 (positioned trees, the `Diagnostic` type), v0.2 (the resolver, the sandbox check,
the injectable transport, the on-disk cache, `$pin` verification), v0.3 (the fold, provenance,
`cascade` and its monotonicity refusal), v0.4 (the constraint checker, §10's error contract),
v0.5 (named types, nested demands), v0.6 (delegation and its breadcrumb).

**Explicitly *not* here, and why**: `values`, guarded type recursion, and the `directives:` section
are v0.7 vocabulary additions that exist **for** the meta-schema, and they land with it in
`008-metaschema-bootstrap` alongside the justification that produced them. `seal` is orthogonal to
`values` by construction (§9), so nothing here waits on them.

Two debts are called in by this milestone, and one obligation is discharged that has been
unsatisfiable since it was written:

- **Article VI describes a library that does not yet exist.** "The library performs no I/O" has been
  the law since the §1 recarve, and v0.6 opens files in three places: the local read, `realpath` for
  the sandbox check, and the on-disk cache. Only the first looks like a read, which is how the other
  two survived the article being written. Half the seam has existed since v0.2 — remote reads go
  through an injectable transport, built so tests could be hermetic — and that half is the proof the
  shape works.
- **§11 parked the pinning *legislation* "with sealing and authority (§6.3)".** This is that
  milestone. The mechanism (verify whenever present) shipped in v0.2 and has had nothing able to
  make it mandatory ever since.
- **§5.5 has mandated an info-level lint since it was written, against a `Diagnostic` type with no
  level.** Every diagnostic in six milestones has been a refusal, so the lint was not merely unbuilt
  — it was unbuildable. This is a requirement ratified as a MUST against a component that could not
  satisfy it, which is precisely the failure Principle V's ratification corollary names. It was found
  by reading during v0.7 planning rather than by shipping.

## User Scenarios & Testing *(mandatory)*

The users are the **tool developer** embedding Cascata, who wants one call and a seam they control;
the **operator**, who needs the sandbox and remote-opt-in promises to be structural rather than
self-policed; the **schema publisher**, who wants to close a question rather than merely tighten it,
and to legislate that descendants pin what they adopt; and the **config author**, who deserves to be
told when a construct does not mean what they think — without being refused for writing something
legitimate.

Two threads run through everything below, and they meet at `load()`.

**Authority flows one way.** §2.3 has been the spine since v0.3's cascade rule and v0.5's type
narrowing. Sealing is the same rule reaching its strongest form: an ancestor may close a question
outright, not merely narrow the answer.

**Capability is granted, never ambient.** §8.4 made this true of delegation by rule; Article VI makes
it true of *everything* by construction. A library that cannot read except by asking cannot exceed
what its host grants.

### User Story 1 - A diagnostic teaches without refusing (Priority: P1)

A config author writes something legitimate that will not behave as they expect. They are told, and
their configuration still loads.

**Why this priority**: it is small, it is cross-cutting, and it touches the one type every other
story produces. Adding a level after the host refactor would mean re-touching every diagnostic the
refactor had just written. It also has a real consumer immediately (§8.1's lint), so it does not ship
as an unexercised mechanism.

**Independent Test**: a schema granting `delegate: allow` on a key demanding `type: string`; confirm
resolution **succeeds** and carries one `info` diagnostic naming what will happen.

**Acceptance Scenarios**:

1. **Given** any diagnostic produced by any stage, **When** inspected, **Then** it carries a `level`
   of `error` or `info`.
2. **Given** a result whose only diagnostics are `info`, **When** inspected, **Then** the result is
   successful and carries both the value and the lints. A lint that had to be paid for by discarding
   the result is a lint nobody reads (§16).
3. **Given** an `info` diagnostic, **When** inspected, **Then** it carries every field an `error` of
   this milestone carries — code, sentence, primary span, RFC 6901 pointer, violated demand where one
   exists, pedigree position, delegation breadcrumb where one applies (Principle III).
4. **Given** a key granted `delegate: allow` whose own `demand` is a leaf shape an inline string
   would have satisfied, **When** the schema is read, **Then** an `info` lint names that an inline
   string there will be **loaded**, not matched (§8.1). This closes v0.6's unanswered Edge Case.
5. **Given** every diagnostic this codebase produced before this milestone, **When** inspected,
   **Then** its level is `error`. Nothing is reclassified in passing; a refusal that silently became
   a lint is a weakened test by another name.

### User Story 2 - An ancestor closes a question rather than narrowing it (Priority: P2)

A schema publisher marks a key `final`. No descendant schema may declare it again — not even more
tightly. Where the key also carries `provide`, no config may set it either.

**Why this priority**: it is `SPEC.md` §6.3's heart, it is independent of every other story here, and
`008-metaschema-bootstrap` needs it — the meta-schema must be able to describe `seal` and `final`,
which requires them to exist.

**Independent Test**: an ancestor declaring `final` on a key and a descendant restating that key with
a strictly narrower demand; confirm the restatement is refused despite being a legal narrowing.

**Acceptance Scenarios**:

1. **Given** a key demanding a mapping under `seal: closed` and a config supplying a child key the
   accumulated `keys` vocabulary does not declare, **When** validated, **Then** the undeclared child
   is refused, positioned at the child itself.
2. **Given** the same key under `seal: open` (the default), **When** validated, **Then** the
   undeclared child is accepted.
3. **Given** an ancestor declaring `seal: open` and a descendant declaring `seal: closed`, **When**
   resolved, **Then** it is legal and takes effect from the descendant downward (§5.2, and §5.3's
   "from the layer that declares it, downward").
4. **Given** an ancestor declaring `seal: closed` and a descendant declaring `seal: open`, **When**
   resolved, **Then** it is refused as a weakening — the exact shape `cascade-strategy-weakened`
   already has (v0.3), for the exact same reason.
5. **Given** an ancestor declaring `final` on a key, **When** a descendant schema declares *anything*
   for that key — `demand`, `provide`, `cascade`, `seal`, or `delegate` — **Then** it is refused,
   **including** when the declaration would be a legal narrowing. `final` says the question is
   closed, not that it must be answered more tightly. This case MUST be tested with a narrowing
   specifically, because a rule that only refuses widenings is indistinguishable from the ordinary
   monotonicity check and would pass a suite that never tried one.
6. **Given** a key declared `final` **with** a `provide`, **When** a config sets that key, **Then**
   it is refused: the provided value is a constant (§5.5's pinned-constant pattern).
7. **Given** a key declared `final` **without** a `provide`, **When** a config sets that key,
   **Then** it is accepted — `final` froze the demand, and nothing was promised about the value.
8. **Given** a key declared `final` with a `provide` **and** `required: true`, **When** validated,
   **Then** an `info` lint fires: `required` is vacuous under `final provide` (§5.5, verbatim — it
   has been mandated since that section was written and could not be built until US1).
9. **Given** `seal` or `final` declared by a **config** rather than a schema, **When** read, **Then**
   it has no effect. Capabilities are granted by the schema, never self-granted — the same rule
   v0.3 FR-015, v0.4 FR-003, v0.5 FR-004 and v0.6 FR-005 each stated for their own vocabulary.

### User Story 3 - A published root legislates what its descendants must do (Priority: P3)

A root declares that anything adopting it must pin what it adopts. An unpinned link anywhere in that
pedigree is refused.

**Why this priority**: §11 parked it here by name, and it is the first governance power in the
project that is *per schema* rather than per key. It is small on top of US2 and closes a real
security story rather than a hypothetical one.

**Independent Test**: a root declaring `demandPinnedAdoption: true` and a descendant adopting it
without `$pin`; confirm refusal, and confirm the same chain resolves once the pin is added.

**Acceptance Scenarios**:

1. **Given** a root whose `authority:` section declares `demandPinnedAdoption: true` and a descendant
   adopting it with no `$pin`, **When** resolved, **Then** the adoption is refused, positioned at the
   `$adopts` that lacked the pin, and citing the root that demanded it.
2. **Given** the same root and a descendant adopting it **with** a correct `$pin`, **When** resolved,
   **Then** it succeeds, and the pedigree entry is `verified` (v0.2's existing mechanism, unchanged).
3. **Given** a root demanding pinned adoption, **When** a *descendant* attempts to retract the
   demand, **Then** the retraction has no effect and the demand still binds (§5.2's new row).
4. **Given** a root demanding pinned adoption, **When** the chain is resolved, **Then** the demand
   binds every link **below** the root and cannot protect the fetch of the root itself. This limit is
   inherent and §11 states it; a test MUST pin it down so nobody later reads the feature as stronger
   than it is.
5. **Given** a root declaring `finalAgainstForking: true`, **When** resolved, **Then** the
   declaration is **recorded and queryable and enforces nothing** — `$extends` does not exist until
   §6.2 lands. A test asserts the recording, and asserts that no refusal is produced.
6. **Given** an `authority:` section declaring a key this version does not implement, **When** read,
   **Then** it is refused at its own position naming what is supported — the closed-vocabulary
   posture of Principle VI, as `delegate` and `cascade` each already hold.

### User Story 4 - The library reads nothing; it asks (Priority: P4)

A host supplies bytes and canonical identities. The library opens no file and no socket, and this is
enforced by a test rather than promised by a comment.

**Why this priority**: it is the largest and most invasive piece of work in the milestone, and every
remaining story sits on it. It is placed after US1–US3 so that the refactor moves a suite that is
otherwise finished, and any breakage it causes is unambiguously the refactor's.

**Independent Test**: `grep`-equivalent, as a test: no module under `src/` imports `node:fs`, calls
`fetch`, or opens a socket, save the shipped host the test names. Plus a full resolution driven by a
host backed entirely by an in-memory map.

**Acceptance Scenarios**:

1. **Given** the source tree, **When** the boundary test runs, **Then** no module under `src/`
   reaches `node:fs`, `fetch`, or a socket, except the shipped host, which the test names explicitly.
   This extends `tests/unit/layering.test.ts`, which already enforces format-blindness this way, and
   MUST NOT weaken anything that file already asserts.
2. **Given** a host answering from an in-memory map with no filesystem present at all, **When** a
   configuration with `$adopts`, `$schema`, and delegated fragments is resolved, **Then** it resolves
   fully and identically.
3. **Given** a host that declines to supply a document, **When** resolved, **Then** the refusal is a
   **diagnostic** carrying the position of the reference that asked for it — not an exception
   (§16: "a refusal is data").
4. **Given** a caller who omits the host entirely, **When** `resolve()` or `load()` is called,
   **Then** it **throws**. A missing required option is a bug in the calling code, not a fact about
   the world (§16), and this is the posture `sandboxRoot` has held since v0.2.
5. **Given** a location the host can canonicalize, **When** the sandbox check runs, **Then** the
   **host** supplied the canonical identity and the **library** reached the confinement verdict. The
   host is never asked whether something is allowed (§16).
6. **Given** a location the host cannot canonicalize — it does not exist — **When** the sandbox check
   runs, **Then** the lexical location stands in, and "cannot be canonicalized" is a sandbox verdict
   in neither direction. This preserves v0.2's `safeRealpath` behaviour exactly; it is a move, not a
   change.
7. **Given** two different hosts supplying byte-identical documents, **When** each resolves the same
   entry, **Then** the tree, the provenance, and the diagnostics are identical and in the same order
   (§16's determinism law). This MUST be a test, because it is the law that makes the seam safe.
8. **Given** the existing recorded remote fixtures, **When** the suite runs after the refactor,
   **Then** every one of them still passes. The recordings are the oracle for whether the seam
   preserved behaviour; a refactor that needed them rewritten did not preserve it.
9. **Given** the shipped Node host, **When** a tool embeds Cascata, **Then** it can read local files
   and fetch remote schemas without writing an adapter of its own. The seam must not be a tax on the
   ordinary embedder.

### User Story 5 - One call (Priority: P5)

A tool developer names a launching point and receives a validated configuration, or the reasons it is
not one.

**Why this priority**: §16 names it as the ordinary embedding, and `008-metaschema-bootstrap` is its
first real consumer. It sits directly on US4.

**Independent Test**: a single `load()` from an entry path to a certified configuration, with no
other library call.

**Acceptance Scenarios**:

1. **Given** an entry location, options, and a host, **When** `load()` is called, **Then** it returns
   either a validated configuration (with any `info` lints) or a set of errors — never a
   configuration together with errors (§16, as amended by US1).
2. **Given** a configuration that resolves, merges, and validates, **When** `load()` is called,
   **Then** the result is identical to what the staged calls produce in sequence. `load()` composes
   the pipeline; it must not become a second implementation of it.
3. **Given** a failure at any stage — unreachable document, cycle, merge refusal, constraint
   violation — **When** `load()` is called, **Then** the diagnostics are exactly those the staged
   call would have produced, in the same order.
4. **Given** the staged functions (`parse`, `resolve`, `merge`, `validate`, `why`), **When** this
   milestone completes, **Then** they remain public. `load()` is the ordinary path, not the only one.
5. **Given** a caller who omits a required option, **When** `load()` is called, **Then** it throws;
   given any fact about the world, it does not.

### User Story 6 - A path means something relative to where it was written (Priority: P6)

A `resource` value is reported with the location it denotes, resolved against the document that
declared it — not the entry document, and not the schema that demanded it.

**Why this priority**: §7 has said "resolved relative to the declaring file's directory" since it was
written, and v0.4 through v0.6 only ever shape-checked such values. §16 names the gap directly: no
tool "should have to rediscover how a path relates to the document that declared it".

**Independent Test**: a `path` value provided by a house layer in one directory and merged into a
config in another; confirm the reported location resolves against the house layer's directory.

**Acceptance Scenarios**:

1. **Given** a value satisfying `path`, **When** the configuration is produced, **Then** its resolved
   location is available, computed against the directory of the document that **declared the value**
   — which provenance already records exactly (v0.3).
2. **Given** a `path` value provided by an ancestor layer and inherited by a config in a different
   directory, **When** resolved, **Then** it resolves against the **ancestor's** directory. This is
   the discriminating case; a test that only uses same-directory documents proves nothing.
3. **Given** a `path` value written inside a **delegated fragment**, **When** resolved, **Then** it
   resolves against the fragment's own directory — the fragment is the declaring document, and §8.4
   already resolves delegated paths this way.
4. **Given** a value satisfying `url`, **When** resolved, **Then** its resolved location is the URL
   itself; relativity is a `path` question.
5. **Given** a `resource` path pointing outside the sandbox root, **When** resolved, **Then** it is
   **not** refused. A `resource` is data *about* a file, never an instruction to load one — §8.1's
   razor, from the other side. The resolved location is reported so the embedding tool can apply
   whatever policy it has; Cascata does not invent one. This case MUST be tested, because the
   intuitive-but-wrong behaviour is to confine it.
6. **Given** any `resource` value at all, **When** resolved, **Then** nothing is read and nothing is
   checked for existence. Resolution is lexical. Existence is I/O, and I/O is the host's (§16).

### Edge Cases

- **`final` on a key an ancestor already sealed `final`.** Redundant, not a widening. Lint, refusal,
  or silence?
- **`seal: closed` on a key whose demand is not a mapping.** Openness has no meaning there.
- **`final` declared in the *entry* schema**, which has no descendants. Vacuous but legal.
- **A root demanding pinned adoption that is itself reached without a pin.** §11's inherent limit,
  from the inside.
- **A host that answers with different bytes for the same location twice in one resolution.**
  Determinism is a law about hosts; the library cannot enforce it, and should say so rather than
  pretend.
- **A host that canonicalizes two distinct locations to one identity** (a hardlink, a
  case-insensitive filesystem). Diamond dedup already keys on identity; this is that mechanism
  meeting a new supplier.
- **`load()` on an entry whose schema chain is fine but which produces only `info` lints.** Success
  with diagnostics — the shape US1 introduces, exercised end to end.
- **A `resource` path in a document reached over `https://`.** "The declaring document's directory"
  when the declaring document is a URL.

## Requirements *(mandatory)*

### Functional Requirements

**Diagnostic levels** (§10, Principle III, gate 5)

- **FR-001**: Every diagnostic MUST carry a `level` of `error` or `info`. There is no third level and
  no default that lets one be omitted.
- **FR-002**: A result whose diagnostics are all `info` MUST be a **successful** result carrying both
  its value and its lints.
- **FR-003**: An `info` MUST carry every field an `error` of this milestone carries.
- **FR-004**: Every diagnostic existing before this milestone MUST be `error`. No reclassification.
- **FR-005**: A key granted `delegate: allow` whose own `demand` is a leaf shape an inline string
  would satisfy MUST produce an `info` lint stating that an inline string there is loaded, not
  matched (§8.1). It MUST NOT be refused.

**Sealing per key** (§6.3, §5.2, §9)

- **FR-006**: `seal` MUST accept `open` and `closed` only; any other value is refused at its own
  position, naming what is supported.
- **FR-007**: `seal: closed` on a key demanding a mapping MUST refuse any child key the accumulated
  `keys` vocabulary does not declare, positioned at the child.
- **FR-008**: `open` is the default.
- **FR-009**: `open` → `closed` downstream MUST be legal and MUST take effect from the declaring
  layer downward. `closed` → `open` MUST be refused as a weakening.
- **FR-010**: `final` on a key MUST refuse **any** declaration of that key by a descendant schema
  layer — `demand`, `provide`, `cascade`, `seal`, or `delegate` — including a legal narrowing.
- **FR-011**: `final` **with** `provide` MUST refuse a config setting that key.
- **FR-012**: `final` **without** `provide` MUST NOT refuse a config setting that key.
- **FR-013**: `required: true` on a key that is `final` with a `provide` MUST produce §5.5's `info`
  lint, verbatim in substance: `required` is vacuous under `final provide`.
- **FR-014**: `seal` and `final` declared by a config MUST have no effect.
- **FR-015**: `seal` and `final` MUST take effect from the layer that declares them, downward — never
  reaching back over an ancestor (§5.3's settled rule, applied to two more keywords).

**Per-schema authority** (§6.3, §11)

- **FR-016**: An `authority:` top-level section MUST be recognized, with a **closed** vocabulary of
  `demandPinnedAdoption` and `finalAgainstForking`. An unknown member is refused at its own position.
- **FR-017**: `demandPinnedAdoption: true` MUST cause any `$adopts` **below** the declaring document
  that lacks a `$pin` to be refused, positioned at that `$adopts` and citing the demanding document.
- **FR-018**: The demand MUST NOT be retractable by a descendant.
- **FR-019**: The demand MUST NOT apply to the fetch of the declaring document itself — §11's
  inherent limit, which MUST be pinned by a test rather than left to be discovered.
- **FR-020**: `finalAgainstForking: true` MUST be recorded and queryable and MUST enforce nothing in
  v1. It MUST NOT produce a diagnostic of any level.
- **FR-021**: An `authority:` section declared by a **config** MUST have no effect.

**The host seam** (§16, §11, Principle IV, gate 7)

- **FR-022**: A **host** interface MUST be the library's only route to the outside world. It supplies
  (a) the bytes at a location, or a refusal, and (b) the canonical identity of a location, or the
  absence of one.
- **FR-023**: No module under `src/` may import `node:fs`, call `fetch`, or open a socket. This MUST
  be enforced by extending `tests/unit/layering.test.ts`, and MUST NOT weaken any assertion that file
  already makes.
- **FR-024**: The single exemption is the **shipped host**, which MUST live at a separate entry point
  and MUST be named explicitly by the boundary test.
- **FR-025**: The on-disk cache MUST move behind the host. The library's caching *policy* — content
  addressing, immutability, RFC 9111's applicable subset — stays in the library; the storage does
  not.
- **FR-026**: Canonicalization MUST be the host's answer and the confinement verdict MUST be the
  library's. The host is never asked whether a location is permitted.
- **FR-027**: A location the host cannot canonicalize MUST fall back to the lexical location and MUST
  NOT be treated as a sandbox verdict in either direction (v0.2's behaviour, moved not changed).
- **FR-028**: A host refusal MUST be a diagnostic carrying the position of the reference that asked.
  A missing or malformed host option MUST throw.
- **FR-029**: The library MUST retain every refusal it makes on its own account — sandbox
  confinement, a missing remote-delegation opt-in — and MUST make them **before** asking the host
  (§16's "some refusals never reach the host"). A library refusal and a host refusal are different
  events with different diagnostics; neither throws.
- **FR-030**: Every existing recorded remote fixture MUST still pass, unmodified.
- **FR-031**: Two hosts supplying byte-identical documents MUST produce identical trees, provenance,
  and diagnostics in identical order.

**One call** (§16)

- **FR-032**: `load()` MUST take a launching point, options, and a host, and return either a
  validated configuration with any `info` lints, or a set of errors — never a configuration together
  with errors.
- **FR-033**: `load()`'s result MUST be identical to the staged calls in sequence, including
  diagnostic order.
- **FR-034**: The staged functions MUST remain public.

**`resource` resolved against its declaring document** (§7, §16, §8.1)

- **FR-035**: A value satisfying `path` MUST have a resolved location available on the result,
  computed against the directory of the document that **declared the value**, as recorded by
  provenance.
- **FR-036**: A value satisfying `url` MUST resolve to itself.
- **FR-037**: A value declared inside a delegated fragment MUST resolve against the **fragment's**
  directory.
- **FR-038**: A `resource` path resolving outside the sandbox root MUST NOT be refused. It is data
  about a file, not an instruction to load one (§8.1).
- **FR-039**: Resolution MUST be lexical. Nothing is read; existence is never checked.

**Invariants**

- **FR-040**: Every diagnostic added by this milestone satisfies gate 5, now including its level.
- **FR-041**: No existing test is weakened. A suite made green by relaxing an assertion is worse than
  a failing one.
- **FR-042**: `pnpm typecheck` clean, no `any`, no assertion casts on the node model.

### Key Entities

- **Host** — the seam. Answers bytes-or-refusal and canonical-identity-or-absence. Supplies, never
  decides.
- **Diagnostic level** — `error` or `info`. Part of the contract, not a presentation detail.
- **Seal** — per-key openness (`open`/`closed`) and per-key finality (`final`), both binding downward.
- **Authority** — per-schema governance: `demandPinnedAdoption`, `finalAgainstForking`.
- **Resolved resource** — a `path`/`url` value paired with the location it denotes, relative to its
  declaring document.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A full resolution runs against a host backed by an in-memory map, with no filesystem
  and no network reachable.
- **SC-002**: The boundary test fails if any module under `src/` is made to import `node:fs`. Verify
  by sabotage, per the constitution's Principle V protocol.
- **SC-003**: A descendant restating a `final` key with a strictly **narrower** demand is refused.
- **SC-004**: A configuration that produces only `info` lints loads successfully **and** reports them.
- **SC-005**: A root demanding pinned adoption refuses an unpinned descendant and admits a pinned one.
- **SC-006**: A `path` provided by an ancestor in a different directory resolves against the
  ancestor's directory, not the config's.
- **SC-007**: All 610 pre-existing tests remain green, unmodified in substance.
- **SC-008**: Every recorded remote fixture passes unchanged after the seam refactor.

## Assumptions

- **The host seam is async.** `resolve()` already is; a synchronous seam would forbid every
  interesting host (a network, a database, an editor's unsaved buffers).
- **HTTP *policy* stays in the library, HTTP *execution* goes to the host.** HTTPS-only, pin
  verification, size caps, and redirect limits are verdicts and stay; performing the request and
  following a permitted redirect is supply and goes. Exactly where the line falls between these is
  the milestone's main design risk and is `/speckit-plan`'s to settle against the existing
  recordings, which are the oracle for whether it was drawn correctly.
- **`resource` resolution reports; it does not police.** §8.1's razor is read as applying in both
  directions: mentioning a file is not loading one, so a mentioned file is not sandbox-confined. The
  resolved location is surfaced precisely so the embedding tool can police it.
- **`final` is not `seal: final`.** §6.3 and §9 both spell it as its own key. It is not a third value
  of `seal`, because it governs a different question — `seal` is about *which keys*, `final` is about
  *who may speak*.

## Out of Scope

- `values`, guarded type recursion, and `directives:` — `008-metaschema-bootstrap`.
- The meta-schema itself — `008`.
- `$extends` and fork enforcement (§6.2); `finalAgainstForking` records, it does not enforce.
- The typed TS output surface (v1.0).
- Static subsumption lint (v1.x).
- A lockfile. §11's inherent limit is stated and tested, not closed.
