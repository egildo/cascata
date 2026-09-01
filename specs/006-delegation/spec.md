# Feature Specification: Delegation (Transclusion)

**Feature Branch**: `006-delegation` *(spec directory; no separate git branch created)*

**Created**: 2026-08-31

**Status**: Draft

**Input**: User description: "Cascata v0.6, the sixth milestone of the SPEC.md §14 roadmap: Delegation (transclusion, sandbox, positional validation, breadcrumbs)."

**Implements**: `SPEC.md` §8 (Article V — Delegation) in full, §8.4's security posture, §9's
`delegate: allow` vocabulary entry, §10's delegation breadcrumb, §11's delegation clause,
§14 item 6.

**Builds on**: v0.1 (positioned trees), v0.2 (the resolver, sandbox confinement, cycle detection,
diamond dedup), v0.3 (the fold and provenance), v0.4 (the constraint checker and §10's error
contract), v0.5 (named types and nested demands).

Three things were left ready for this milestone specifically, and each is a debt now being called in:

- v0.2 built `resolveAllBranches` in `src/graph/build.ts` **explicitly for v0.6** — generic,
  diagnostic-agnostic, multi-branch — and it has been exercised only by unit tests ever since,
  because `$adopts` is single-branch and never produced a second candidate to collect from.
- Constitution Principle III phases the **delegation breadcrumb** to arrive exactly here, and v0.4
  FR-026 required it be *absent rather than faked* until it could be real.
- v0.5's nested `keys` demands make a **delegable nested key** expressible for the first time.

## User Scenarios & Testing *(mandatory)*

The users are the **config author**, who wants to split a large configuration across files without
changing its meaning; the **schema publisher**, who decides which keys may be split and takes on the
responsibility that implies; and the **operator**, who needs to know that a schema fetched from the
web cannot make their machine read files it should not.

§8.1's razor is what this milestone is really about. Without schema governance every string is
ambiguous — is `"./conf.yaml"` a filename *as data*, or an instruction *to load*? Systems that guess
accumulate heuristics and then CVEs. Here the schema disambiguates: mentioning a file (a `resource`
value) and loading a file (`delegate`) are different constructs with different keywords. **This is
the data/code boundary**, and every requirement below serves it.

### User Story 1 - A schema grants a key the right to be split into its own file (Priority: P1)

A schema publisher marks one key `delegate: allow`. A config author writes a path there instead of
the subtree, and the file's contents are grafted in at that position.

**Why this priority**: It is the milestone, and it is the first time in six milestones that a
**value** causes a document to be loaded. Everything before this loaded documents because a
*document* named them (`$adopts`, `$schema`). That is a genuinely new capability and a genuinely new
attack surface, which is why §8.1's razor and §8.4's posture arrive with it rather than after it.

**Independent Test**: A schema granting `delegate: allow` on one key, and a config supplying a
relative path there; confirm the resulting tree contains the file's contents at that position.

**Acceptance Scenarios**:

1. **Given** a key granted `delegate: allow` and a config supplying a relative path, **When**
   resolved, **Then** the fragment's contents appear as the subtree at that key.
2. **Given** a key **not** granted `delegate: allow` and a config supplying the same string, **When**
   resolved, **Then** the string stays a string — it is data about a file, not an instruction to load
   one (§8.1). This is the razor, and it MUST have its own case.
3. **Given** a key granted `delegate: allow` and a config supplying an inline mapping rather than a
   string, **When** resolved, **Then** the mapping is used as written — the grant permits delegation,
   it never compels it (§8.4: "the schema allowing delegation never compels it").
4. **Given** a `delegate` value this version does not implement, **When** read, **Then** it is refused
   at its own position, naming what is supported — `delegate: allow` is the only form in v1, and
   §8.4's `delegate: { allow: true, formats: [...] }` is a future door (v0.3 FR-014's precedent for
   `merge-by-key`).
5. **Given** a `delegate` declared by a **config** rather than a schema, **When** read, **Then** it
   has no effect. Capabilities are granted by the schema, never ambient, never self-granted
   (v0.3 FR-015, v0.4 FR-003, v0.5 FR-004 — the same rule for a fourth kind of vocabulary).
6. **Given** a delegated path naming a file that does not exist or cannot be parsed, **When**
   resolved, **Then** it is refused with the failure at the delegating value's own position.

---

### User Story 2 - A fragment is indistinguishable from having written it inline (Priority: P2)

A config author splits twelve subtrees into twelve files. The configuration validates, merges, and
cascades exactly as the single-file version would.

**Why this priority**: §8.2 states this as the identity that makes delegation safe to add at all: a
fragment "carries no `$schema`, starts no pedigree, creates no merge boundary". If splitting a file
could change what a configuration *means*, delegation would be a second cascade mechanism competing
with the first, and every guarantee from v0.3 through v0.5 would need re-proving under it.

**Independent Test**: Two configurations — one inline, one split across fragments — that must produce
byte-identical merged trees and identical validation outcomes.

**Acceptance Scenarios**:

1. **Given** a configuration written inline and the same configuration split across fragments,
   **When** both are resolved and merged, **Then** the merged trees are identical in shape and value.
2. **Given** the same pair, **When** both are validated, **Then** they produce the same outcome — a
   demand violated in a fragment is violated identically inline.
3. **Given** a fragment grafted under a key governed by `cascade: append`, **When** merged, **Then**
   accumulation behaves exactly as it would inline — delegation creates no merge boundary (§8.3).
4. **Given** a fragment containing any `$`-prefixed key, **When** resolved, **Then** it is refused.
   Fragments carry no `$schema`, start no pedigree, and `$`-keys in fragments are forbidden in v1
   (§8.2).
5. **Given** a fragment in a different format from its parent, **When** resolved, **Then** it grafts
   normally — format freedom is a consequence of the information model, not a feature anyone builds
   (§8.3).
6. **Given** a fragment whose root is a scalar or a sequence rather than a mapping, **When** grafted,
   **Then** it is used as the subtree at that position — nothing in §8 restricts a fragment's root to
   a mapping, and inventing that restriction would break the inline-identity claim.

---

### User Story 3 - An error names the fragment and how it got there (Priority: P3)

A value inside a fragment violates a demand. The diagnostic names the fragment file, the position
within it, **and** the delegating document and position that pulled it in.

**Why this priority**: §10's canonical sentence has carried the breadcrumb since v0.1 —
`constraint from house.yaml:7 rejected value from conf.network.yaml:3 (delegated from site.yaml:12)`
— and every milestone until now has had to leave it absent. Principle III phases it to arrive here.
Without it, a fragment's error tells an author *where* the bad value is but not *why that file was
being read at all*, which is the question a twelve-fragment configuration makes hard.

**Independent Test**: A demand violated by a value inside a fragment; confirm the diagnostic carries
both the fragment position and the delegating position, and renders §10's sentence with the
breadcrumb clause present.

**Acceptance Scenarios**:

1. **Given** a violation inside a fragment, **When** reported, **Then** the diagnostic carries the
   delegating document and position in addition to everything v0.4's contract already required.
2. **Given** a violation in a non-delegated value, **When** reported, **Then** the breadcrumb is
   **absent**, not empty-but-present — v0.4 FR-026's "absent rather than faked" rule, now applied to
   the case where there genuinely was no delegation.
3. **Given** a value inside a fragment, **When** `why` is asked about its pointer, **Then** the
   provenance chain carries the delegation breadcrumb alongside the layer that contributed it.
4. **Given** a fragment reached through more than one delegation hop, **When** reported, **Then** the
   breadcrumb describes the whole path, not only the last hop — subject to FR-012's answer on whether
   multi-hop delegation exists at all.

---

### User Story 4 - A web-published schema cannot make the machine read what it should not (Priority: P4)

A schema fetched over HTTPS grants `delegate: allow`. It cannot thereby cause any file outside the
sandbox to be read, and it cannot cause a network fetch at all unless the **user** has opted in.

**Why this priority**: §8.4 exists because delegation is schema-triggered file loading and schemas
come from the web. This is the milestone's security story, and §11 already promises it: "a remote
schema can never trigger local file reads outside the sandbox, nor remote delegation without user
opt-in."

**Independent Test**: A schema granting delegation and a config attempting `../` escape, an absolute
path, and a remote URL; confirm each is refused, and that the remote case succeeds only when the user
has opted in.

**Acceptance Scenarios**:

1. **Given** a delegated path containing `..` that escapes the sandbox root, **When** resolved,
   **Then** it is refused (v0.2's sandbox machinery, applied to a new kind of reference).
2. **Given** an absolute delegated path, **When** resolved, **Then** it is refused.
3. **Given** a delegated path that is a remote URL and no user opt-in, **When** resolved, **Then** it
   is refused — and the refusal names the *user* opt-in as what is missing, never suggesting the
   schema could grant it.
4. **Given** the same with the user's explicit opt-in, **When** resolved, **Then** it is fetched under
   v0.2's existing remote rules — HTTPS only, pinning verified when present.
5. **Given** a delegated path, **When** resolved, **Then** it resolves relative to the **delegating
   config's** directory — not the schema's, and not the process working directory (§8.4).
6. **Given** a cycle of delegations, **When** resolved, **Then** it is refused rather than followed
   (§8.3: cycle detection comes free from treating fragments as DAG edges).

### Edge Cases

- **A delegated path pointing at the delegating document itself.** The degenerate cycle.
- **The same fragment grafted at two points in one configuration.** §6.1 and §8.3 describe this
  differently; see FR-013.
- **A fragment that is empty**, or whose document contains no content at all.
- **A delegated value under a key that also carries `provide`.** The provide injects during merge; the
  delegation resolves before merge. Their interaction needs stating, not deriving.
- **A key granted `delegate: allow` whose demand is `type: string`.** The grant and the demand
  contradict each other — a string value would be loaded, so the demand can never see a string. Is
  that a schema defect to refuse, or simply an odd schema?
  **Settled in v0.7 planning: an odd schema, and an info-level lint** (`SPEC.md` §8.1, §15). The
  premise stated here is also half wrong, which is why it stayed open: a *fragment* document holding
  a bare string scalar satisfies such a demand exactly, so only the **inline** string is unreachable.
  The schema is surprising, not unusable, and refusing it would overstate the case. Built in
  `specs/007-sealing-and-embedding` FR-005.
- **A delegated path whose target lies inside the sandbox but is not a document** (a directory, a
  device file, an unreadable file).
- **Two different keys delegating to paths that differ only by symlink resolution.** v0.2's sandbox
  rules already have a position on this; delegation must inherit it rather than invent one.

## Requirements *(mandatory)*

### Functional Requirements

**Reading the `delegate` vocabulary** (§8, §9)

- **FR-001**: The system MUST read `keys.<name>.delegate` from schema documents in the pedigree.
- **FR-002**: `delegate: allow` MUST be the only form recognized in v1. Any other value MUST be
  refused at its own position, naming what is supported; §8.4's `delegate: { allow: true, formats:
  [...] }` is a future door and MUST be refused as unimplemented rather than as unknown.
- **FR-003**: A `delegate` declared by a config MUST have no effect. Capabilities are granted by the
  schema, never self-granted (§8's "never ambient").
- **FR-004**: A grant MUST permit delegation without compelling it. An inline value at a delegable
  key MUST be used as written (§8.4).
- **FR-005**: A string at a key with **no** grant MUST remain a string. Nothing may infer delegation
  from a value's shape — this is §8.1's razor and the milestone's central safety property.

**Transclusion** (§8.2, §8.3)

- **FR-006**: A string value at a granted key MUST be resolved as a reference and its document grafted
  as the subtree at that position.
- **FR-007**: Transclusion MUST happen before merge and before validation, so that by merge time
  inline and delegated subtrees are indistinguishable (§8.3's "merge interaction: none").
- **FR-008**: Transclusion MUST be performed **during graph build**, as §8.3 requires — but the
  graph stage MUST NOT read schema vocabulary to do it. The orchestrator MUST resolve the pedigree,
  read the `delegate` grants, and supply the set of delegable positions to graph build **as data**.
  Graph build gains multi-branch reference resolution and never learns what `delegate` means.
- **FR-008a**: This MUST reuse the policy-free shape `src/graph/` already has — `VisitDecision`
  reporting kinds rather than messages, and `resolveAllBranches` generic over its value and failure
  types precisely so the caller supplies meaning. Cycle detection and diamond dedup therefore stay
  free (§8.3), and v0.5 FR-017's rule holds: no stage learns schema semantics it was kept clear of.
- **FR-009**: A fragment MUST NOT carry `$`-prefixed keys. Any `$`-key in a fragment MUST be refused
  (§8.2, v1).
- **FR-010**: A fragment MUST NOT start a pedigree, contribute a layer, or create a merge boundary.
  It belongs to the layer of the document that delegated to it.
- **FR-011**: A fragment's root MUST be permitted to be any node — mapping, sequence, or scalar.
  Restricting it to a mapping would break FR-014's identity claim.
- **FR-012**: A fragment MUST itself be able to delegate, wherever the governing schema grants it,
  to arbitrary depth. §8.2's inline-identity claim requires it: if a configuration split across
  fragments must equal the inline original, then a fragment containing a delegable key must behave
  exactly as that subtree would have inline.
- **FR-012a**: Recursive delegation MUST be bounded by an explicit depth limit, in the manner v0.1
  bounds parse depth and v0.5 FR-025 bounds nested demands. Depth is a resource limit, not an
  unbounded promise — and here the input is untrusted by construction (§8.4).
- **FR-012b**: The breadcrumb MUST therefore describe a **chain** of hops, not a single hop, and MUST
  name each in order from the outermost delegating document inward.
- **FR-013**: One fragment grafted at two points MUST be read, parsed, and refused-or-accepted
  **once** — §8.3's dedup, which keeps a fragment used many times cheap — while each graft MUST be
  treated as its own position, with its own breadcrumb. §6.1's "two independent subtrees" is a claim
  about *semantics*, and it holds: the subtree is frozen and deeply immutable (v0.1), so whether the
  two grafts share structure is unobservable to any consumer.
- **FR-013a**: The two grafts MUST NOT share one provenance record. They were delegated from
  different positions, so their breadcrumbs differ even where every span within them is identical —
  which is precisely why a single shared graph node would be wrong.
- **FR-014**: A configuration using fragments MUST be **semantically identical** to the same
  configuration written inline: the same merged tree, the same validation outcome, the same merge
  behaviour including `cascade`. This is §8.2's identity claim and the milestone's acceptance test.
- **FR-015**: A cycle of delegations MUST be refused rather than followed.
- **FR-016**: A fragment MAY be in a different format from its parent, and this MUST require no
  format-specific code above the adapter boundary (§8.3, Principle IV).

**The breadcrumb** (§10, Principle III)

- **FR-017**: A diagnostic about a value inside a fragment MUST carry the delegating document and
  position, in addition to everything v0.4's error contract already requires.
- **FR-018**: The breadcrumb MUST be **absent** where no delegation occurred — never present-but-empty
  (v0.4 FR-026's rule, now applied in the other direction).
- **FR-019**: §10's canonical sentence MUST render the breadcrumb clause from structured fields alone,
  with no string assembly at the call site (v0.4 FR-025, extended).
- **FR-020**: A provenance chain for a value inside a fragment MUST carry the breadcrumb alongside the
  contributing layer, so `why` can answer with it.

**Security** (§8.4, §11)

- **FR-021**: A delegated path MUST resolve relative to the **delegating config's** directory.
- **FR-022**: A delegated path MUST be confined to the sandbox root. `..` escapes MUST be refused.
- **FR-023**: An absolute delegated path MUST be refused. §8.4's "by default" implies a door; v1 does
  not open one (see Assumptions).
- **FR-024**: A remote delegation target MUST be refused unless the **user** has opted in. The opt-in
  MUST be expressible only by the caller, never by any document, and the refusal MUST NOT suggest a
  schema could grant it.
- **FR-025**: With the user's opt-in, a remote fragment MUST be fetched under v0.2's existing remote
  rules — HTTPS only, pinning verified whenever present, the content-addressed cache honoured.
- **FR-026**: Delegation MUST reuse v0.2's sandbox and cycle machinery rather than reimplement it, so
  that a rule fixed once holds for both reference kinds.

**Invariants**

- **FR-027**: Resolution MUST report every delegation failure it can determine independently, not the
  first (v0.1 FR-019, v0.2 FR-025, v0.3 FR-028, v0.4 FR-017, v0.5 FR-031 — the sixth statement of the
  same obligation, and the one milestone where `resolveAllBranches` finally has real branches to
  collect from).
- **FR-028**: Delegation MUST be deterministic: the same inputs produce the same tree, the same
  breadcrumbs, and the same diagnostics in the same order.
- **FR-029**: A grafted tree MUST satisfy every v0.1 invariant — every node positioned with a span
  into its **own** document, canonical key order, deeply frozen.

### Key Entities

- **Grant**: a schema's `delegate: allow` on one key. Carries its declaring layer, pointer, and span.
- **Delegation**: one act of grafting — the delegating document and position, the target reference,
  and the resolved fragment. The unit a breadcrumb describes.
- **Fragment**: a resolved document grafted as a subtree. Has no identity as a layer, no pedigree,
  and no `$`-keys.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A configuration split across fragments produces a merged tree identical to the inline
  equivalent, in 100% of corpus cases.
- **SC-002**: A string at an ungranted key is never loaded, in 100% of cases — zero inferences from
  value shape.
- **SC-003**: 100% of diagnostics about values inside fragments carry a delegation breadcrumb naming
  a real delegating document and position; 100% of diagnostics about non-delegated values carry none.
- **SC-004**: Every sandbox escape, absolute path, and un-opted-in remote target is refused, in 100%
  of cases.
- **SC-005**: A delegation cycle is refused rather than followed, in 100% of cases and within a
  bounded time.
- **SC-006**: Delegation is deterministic across runs — identical trees, breadcrumbs, and diagnostic
  order.
- **SC-007**: A grafted tree satisfies every v0.1 invariant, with zero exceptions across the corpus.
- **SC-008**: No test performs network access; remote delegation is exercised entirely against
  recorded responses.

## Assumptions

- **`delegate` is read from schemas only, like every other governing keyword.** v0.3 (`cascade`), v0.4
  (`demand`), and v0.5 (`types:`) each established this for their own vocabulary; delegation is the
  fourth and the one where it matters most, since the keyword grants a capability.
- **v1 opens no door for absolute delegated paths.** §8.4 says "no absolute paths by default", which
  implies a switch, but nothing in `SPEC.md` specifies one and the constitution's Principle VI says to
  ship the restriction when in doubt: an escape hatch can be added later but never removed. Recorded
  so a future reader knows the door was left closed deliberately.
- **The user's remote-delegation opt-in is distinct from v0.2's remote *schema* fetching.** A caller
  who permits remote schemas has not thereby permitted remote fragments; §8.4 separates them, and
  collapsing them would let a schema author reach further than the operator agreed to.
- **A fragment's spans point into the fragment's own file.** §8.3 says so explicitly, and v0.4's
  FR-023 already resolves a value's layer from its own span origin — which is what makes a fragment's
  positions correct without special-casing.
- **`provide` and delegation do not interact.** A provide injects during merge; delegation resolves
  before it. A provided value is never a delegation target, because nothing grants a *schema's* own
  provide the right to be loaded.

## Out of Scope

Each belongs to a later milestone in the `SPEC.md` §14 roadmap, or is a future door:

- `seal`, `final`, and cascade limits (v0.7); the meta-schema bootstrap (v0.7)
- Static subsumption (v1.x, §5.4 item 2)
- The typed TypeScript output surface (v1.0); JSON Schema export (v1.x)
- `delegate: { allow: true, formats: [...] }` selector-style parameters (§8.4, future)
- A "delegate and start a layer" construct — §8.4 pre-commits that as a **new keyword with new laws**,
  never a mutation of this one
- Any command-line surface
