# Feature Specification: Information Model & YAML Adapter

**Feature Branch**: `001-information-model-yaml-adapter` *(spec directory; no separate git branch created)*

**Created**: 2026-08-29

**Status**: Draft

**Input**: User description: "Cascata v0.1, the first milestone of the SPEC.md §14 roadmap: the information model plus the YAML adapter plus a shared conformance corpus skeleton."

**Implements**: `SPEC.md` §4.1 (node types), §4.2 (portability floor), §4.3 (lossy by design), §12 (conformance map), §14 item 1.

## User Scenarios & Testing *(mandatory)*

The users of this milestone are the **config author**, who writes a document and reads what comes
back when it is wrong, and the **library consumer**, who hands Cascata a document and receives a
structure to work with. Later milestones add the cascade; this one establishes what a single
document *becomes*.

### User Story 1 - A document becomes a fully positioned tree (Priority: P1)

A library consumer hands Cascata the text of a YAML document together with the identity of where
that text came from. They receive back a tree of mappings, sequences, and scalars in which **every
single node can say exactly where it came from** — file, line, column, and byte offset — and which
document produced it.

The tree reflects the portability floor rather than YAML's full surface: shared content written
with anchors and aliases (including merge keys) has already been expanded, so the tree contains
values and never references. Scalars remember whether they were written as an integer or a float,
so `2` and `2.0` are different things. Words like `no`, `yes`, `on`, and `off` are text, not
booleans.

**Why this priority**: Nothing downstream exists without it. The resolver, the merge engine, the
validator, and every error message in later milestones all consume this tree, and a position that
is missing here cannot be recovered later.

**Independent Test**: Parse a document and assert that a deliberately chosen deep node's reported
position selects exactly the characters it was written as, character for character; then walk the
whole tree and assert no reachable node lacks a position. Testable with no other milestone present.

**Acceptance Scenarios**:

1. **Given** a document containing a nested mapping, **When** it is parsed, **Then** every mapping,
   sequence, and scalar in the result reports a file, line, column, and byte offset, and the
   position of any chosen node selects precisely the source text that produced it.
2. **Given** a document that writes `version: 2.0` and another that writes `version: 2`, **When**
   both are parsed, **Then** the first records a float and the second an integer, and the two
   values are not equal to each other.
3. **Given** a document containing `norwegian: no` and `enabled: true`, **When** it is parsed,
   **Then** `norwegian` holds the text `no` and `enabled` holds the boolean true.
4. **Given** a document that defines shared content once and refers to it twice by alias, **When**
   it is parsed, **Then** the result contains two independent copies of that content and no
   reference of any kind, and the document is indistinguishable from one written out longhand.
5. **Given** a document using a merge key to fold one mapping into another, **When** it is parsed,
   **Then** the result is the folded mapping, with explicitly written keys taking precedence over
   merged ones.
6. **Given** an integer far larger than a conventional numeric range, **When** it is parsed and read
   back, **Then** its value is preserved exactly with no loss of precision.
7. **Given** a document with a key set explicitly to null, a key written with an empty value, and a
   key that is simply not present, **When** it is parsed, **Then** all three are distinguishable
   from one another.
8. **Given** two documents listing the same keys and values in different order, **When** both are
   parsed and compared, **Then** the mappings are equal; **and given** two documents listing the
   same sequence items in different order, **Then** the sequences are not equal.
9. **Given** a returned tree, **When** a consumer attempts to change any node within it, **Then**
   the attempt does not succeed and the tree is unchanged.

---

### User Story 2 - Every portability problem is named at once (Priority: P2)

A config author has written a document that leans on things YAML permits but the portability floor
does not. Instead of one error at a time, they receive **the complete list in a single pass** —
each item naming what is wrong, quoting where it is, and carrying a stable code — so a document
with three problems takes one round trip to fix rather than three.

**Why this priority**: The floor decisions of §4.2 are what make the model portable across YAML,
JSON, and TOML. They are worthless if they are not enforced, and hostile if enforcing them means
discovering mistakes one at a time. This is also the milestone's whole security posture: the
constructs refused here are the historic YAML attack surface.

**Independent Test**: One fixture per floor rule asserting the expected code and position, plus one
fixture breaking several rules at once asserting the complete set comes back together.

**Acceptance Scenarios**:

1. **Given** a document in which the same key appears twice in one mapping, **When** it is parsed,
   **Then** it is refused with a diagnostic naming both positions — the later value never silently
   wins.
2. **Given** a document using a key that is not text — a sequence or mapping used as a key —
   **When** it is parsed, **Then** it is refused with a diagnostic at that key's position.
3. **Given** a document carrying a tag outside the YAML core schema, **When** it is parsed, **Then**
   it is refused with a diagnostic at the tag's position.
4. **Given** a document with a duplicate key on one line and an out-of-schema tag forty lines later,
   **When** it is parsed, **Then** **both** are reported together from a single parse.
5. **Given** a document nested more deeply, or larger, than the configured limits, **When** it is
   parsed, **Then** it is refused promptly with a diagnostic naming the limit that was exceeded,
   without exhausting memory.
6. **Given** a document containing an alias that refers to content enclosing itself, **When** it is
   parsed, **Then** the cycle is reported as a diagnostic rather than expanded indefinitely.
7. **Given** a document whose bytes are not valid UTF-8, **When** it is parsed, **Then** it is
   refused with a diagnostic identifying the offending position.

---

### User Story 3 - A conformance corpus that outlives this adapter (Priority: P3)

A contributor adds a case to a shared body of conformance cases — an input, and the outcome it must
produce — and it runs immediately, with no code written. The cases are expressed independently of
any one document format, so when JSON and TOML adapters arrive they are pointed at the same corpus
rather than growing test suites of their own.

**Why this priority**: `SPEC.md` §12 makes every cited standard a test oracle, and the constitution
makes the corpus a precondition for conformance code rather than a follow-up. Building it now, while
there is one adapter, is what forces it to be format-agnostic; building it after three adapters
exist means retrofitting it onto three shapes at once.

**Independent Test**: Run the corpus and confirm it reports pass or fail per named case; add a new
case as data only and confirm it executes without any code change.

**Acceptance Scenarios**:

1. **Given** the corpus, **When** it is run, **Then** each case reports individually as passing or
   failing and a failure names the case and the difference between expected and actual outcome.
2. **Given** a new case added as data alone, **When** the corpus is run, **Then** the new case
   executes without any change to adapter or runner logic.
3. **Given** the corpus, **When** its coverage is examined, **Then** every portability-floor
   decision in §4.2 has at least one case that must be accepted and one that must be refused.
4. **Given** a case that expects refusal, **When** it is run, **Then** the expected diagnostic codes
   *and their positions* are both compared, not merely the fact that something failed.

---

### Edge Cases

- **Empty and near-empty documents**: a file that is empty, contains only comments, or contains only
  whitespace — each must produce a defined outcome rather than an ambiguous one.
- **A stream of several documents** separated by document markers: refused in this milestone, since
  the cascade — not multi-document streams — is how Cascata composes.
- **Keys equal after quoting is discarded**: `"host"` and `host` written in the same mapping are the
  same key and therefore a duplicate.
- **A duplicate created by expansion**: an alias or merge key that introduces a key already written
  explicitly. Precedence for merge keys is defined; a genuine duplicate is still refused.
- **A byte-order mark** at the start of the file, which must not shift every reported position by
  one.
- **Mixed or unusual line endings**, which must not shift reported line and column numbers.
- **A limit reached exactly at its boundary** — the case that is allowed and the case one step past
  it must be distinguishable.
- **A position at the very first and very last byte** of a document, where off-by-one errors hide.

## Requirements *(mandatory)*

### Functional Requirements

**Information model** (§4.1, §4.2)

- **FR-001**: Every node in a returned tree MUST report its source: the document it came from, and
  the line, column, and byte offset of the text that produced it. A tree containing a node without
  a position MUST NOT be producible.
- **FR-002**: The model MUST consist of exactly three node shapes — scalar, mapping, sequence — and
  every scalar MUST record which of five kinds it was written as: text, integer, float, boolean, or
  null.
- **FR-003**: Mapping keys MUST be text. Entry order MUST be preserved.
- **FR-004**: Integers MUST be preserved exactly at any magnitude, with no rounding or loss. How a
  number was written decides its kind: `2.0` is a float and `2` is an integer, and the two MUST NOT
  be equal.
- **FR-005**: Null, absence of a key, and an empty value MUST be three distinguishable states.
- **FR-006**: Text MUST be treated as UTF-8 and compared by code point, with **no** Unicode
  normalization applied.
- **FR-007**: Equality MUST be defined exactly once, over the model, and every comparison in the
  system MUST use that one definition: mappings compare by key without regard to order, sequences
  compare in order, scalars compare by kind and value.

**Reading a document** (§4.2, §11)

- **FR-008**: Boolean and text interpretation MUST follow the YAML 1.2 core schema: only `true` and
  `false` are booleans, and `yes`, `no`, `on`, `off`, `y`, and `n` are text.
- **FR-009**: Shared content written by anchor, alias, or merge key MUST be fully expanded while
  reading, so the resulting tree contains no references. Explicitly written keys MUST take
  precedence over merged ones.
- **FR-010**: Reported positions MUST be stable regardless of line-ending convention or the presence
  of a byte-order mark.
- **FR-011**: A key appearing more than once in one mapping — including duplicates introduced by
  expansion — MUST be refused. A later value MUST NOT silently replace an earlier one.
- **FR-012**: A key that is not text MUST be refused, at that key's position.
- **FR-013**: A tag outside the YAML core schema MUST be refused, at the tag's position.
- **FR-014**: A configurable limit on nesting depth and on document size MUST be enforced, and
  exceeding either MUST be refused promptly rather than consuming unbounded memory or time.
- **FR-015**: An alias cycle MUST be detected and refused rather than expanded indefinitely.
- **FR-016**: Input that is not valid UTF-8 MUST be refused with a position.
- **FR-017**: A document containing more than one document MUST be refused in this milestone.

**Diagnostics** (§10, §11)

- **FR-018**: Every diagnostic MUST carry a stable machine-readable code, a human-readable sentence,
  and a precise position; where a problem has two relevant positions — a duplicate key's two
  occurrences — both MUST be reported.
- **FR-019**: A single read MUST report every floor violation it can detect, not only the first.
- **FR-020**: A document with any violation MUST yield diagnostics and no tree, so that no consumer
  can act on a document that is not on the floor.

**Conformance corpus** (§12)

- **FR-021**: Conformance cases MUST be expressed as data, independent of any one document format,
  each naming its input and the outcome it must produce — either an expected tree or an expected set
  of diagnostic codes with their positions.
- **FR-022**: A shared runner MUST execute every case and report pass or fail per named case, with a
  failure naming the case and the difference between expected and actual.
- **FR-023**: Every portability-floor decision in §4.2 MUST have at least one case that is accepted
  and one that is refused.
- **FR-024**: Adding a case MUST require editing case data only, with no change to adapter or runner
  logic.

**Surface**

- **FR-025**: A single documented entry point MUST accept a document's text and the identity of its
  source, and return either a positioned tree or a list of diagnostics.
- **FR-026**: A returned tree MUST be deeply immutable.

### Key Entities

- **Node**: one piece of a document — a scalar, a mapping, or a sequence. Always knows its source
  position and its originating document.
- **Source Span**: where a node's text sits — file, line, column, byte offset. Never absent.
- **Document Origin**: which document a node came from. Trivial in this milestone (one document at a
  time) and the anchor for layer provenance once the cascade exists.
- **Diagnostic**: one refusal — a stable code, a sentence, and one or more positions.
- **Conformance Case**: a named input and the outcome it must produce, expressed independently of
  document format.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of nodes in every accepted corpus document report a position; the count of
  unpositioned nodes across the entire corpus is zero.
- **SC-002**: 100% of the portability-floor decisions enumerated in §4.2 have both an accepting and
  a refusing conformance case.
- **SC-003**: A document containing N distinct floor violations reports all N from one read — a
  config author never needs a second attempt to discover a problem that was already present.
- **SC-004**: For every refusing case, the reported position selects the offending construct exactly,
  verified character for character against the fixture rather than by line number alone.
- **SC-005**: `yes`, `no`, `on`, `off`, `y`, and `n` are read as text in 100% of cases, and `2.0`
  never compares equal to `2`.
- **SC-006**: Adding a conformance case requires changing case data only — zero lines of adapter or
  runner logic.
- **SC-007**: Documents past the depth or size limit, and documents containing alias cycles, are
  refused within a bounded time and memory budget in 100% of cases; none hangs or exhausts memory.
- **SC-008**: Reading is deterministic: the same input produces byte-identical trees and identical
  diagnostic sets on every run.
- **SC-009**: A contributor unfamiliar with the codebase can add a conformance case by copying an
  existing one and editing data, without reading adapter logic.

## Assumptions

Reasonable defaults chosen where the source specification is silent. Each is a candidate for
`/speckit-clarify` if it turns out to matter more than it appears.

- **Origin is trivial here.** There is no cascade yet, so every node in a read shares one origin.
  It is nevertheless recorded from the start, because it cannot be made optional now and required
  later without invalidating every node built in between.
- **Limits get concrete defaults.** §4.2 mandates that depth and size be capped but names no
  numbers. Defaults are chosen to comfortably exceed realistic configuration documents while
  refusing hostile ones, and are configurable.
- **Expanded content reports the position of the content itself**, not of the alias that referred to
  it, since that is where the text a reader would look at actually lives. Carrying both positions is
  a richer provenance breadcrumb that arrives with delegation (§8.3).
- **Core-schema tags are permitted; everything else is refused.** §4.2 refuses "custom tags"; tags
  such as binary, timestamp, set, and ordered-map are treated as outside the floor too, because they
  have no counterpart in JSON or TOML and the model is defined as the intersection.
- **Violations mean no tree.** A partially valid document yields diagnostics only, so no consumer
  can act on a document that is not on the floor.
- **Multi-document streams are refused**, since composition in Cascata is the cascade, not a stream.
- **YAML only.** JSON and TOML adapters belong to §14 v1.x; the corpus is built format-agnostic now
  precisely so they can be added without reshaping it.
- **No compatibility promise before v1.0.** The entry point is public and usable, and may change.

## Out of Scope

Each belongs to a later milestone in the `SPEC.md` §14 roadmap:

- Resolving references, fetching remote documents, HTTP caching (v0.2)
- Pedigree: `$adopts`, content pinning, cycle detection across documents, diamond dedup (v0.2)
- Merging layers, per-key merge strategies, provenance chains, `why` (v0.3)
- Constraint checking, `demand`/`provide`, whole-chain validation, the error contract (v0.4)
- Named types (v0.5), delegation and transclusion (v0.6), sealing and authority (v0.7)
- JSON Schema export, static subsumption checking, the JSON and TOML adapters (v1.x)
- Comment and formatting preservation, and any writing back to documents (§4.3 — deliberately
  deferred, with the model kept structured so it remains possible)
