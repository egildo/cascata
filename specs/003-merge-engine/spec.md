# Feature Specification: Merge Engine & Provenance

**Feature Branch**: `003-merge-engine` *(spec directory; no separate git branch created)*

**Created**: 2026-08-31

**Status**: Draft

**Input**: User description: "Cascata v0.3, the third milestone of the SPEC.md §14 roadmap: the merge engine with per-key strategies and full provenance, plus `why`."

**Implements**: `SPEC.md` §3 (merge), §5.1 (`provide`), §5.2 (the monotonicity table), §5.3 (merge strategies), §5.5 (provides inject during merge), §10 (`tool why`), §14 item 3.

**Builds on**: v0.1 (a document becomes a positioned tree) and v0.2 (a chain of documents becomes a
graph with a pedigree). v0.3 is where the chain finally does something: it folds.

## User Scenarios & Testing *(mandatory)*

The users are the **config author**, who writes the leaf document and wants to know why the final
value is what it is; the **schema publisher**, who supplies defaults and declares how they combine;
and the **library consumer**, who receives one configuration rather than a stack of documents.

This is the first milestone that reads **schema vocabulary** rather than only the `$`-prefixed
document keys: the `keys:` section, and `provide` and `cascade` within it. `demand` (v0.4), `seal`
and `final` (v0.7), and `delegate` (v0.6) are read by nothing here and MUST be ignored rather than
guessed at.

### User Story 1 - The chain folds into one configuration (Priority: P1)

A library consumer resolves a config whose schema supplies defaults, and receives **one** node tree
rather than a pedigree of documents. Where the config is silent, the schema's `provide` fills the
value. Where both speak, the config wins. Mappings merge deeply; everything else replaces.

**Why this priority**: It is the milestone. Every earlier milestone assembled material for this fold
and produced nothing a consuming application could use; this is where a cascade becomes a
configuration.

**Independent Test**: Fold a two-layer chain — a schema providing two keys, a config overriding one —
and confirm the result contains the config's value for the overridden key and the schema's for the
other, with no trace of the layering in the tree's shape.

**Acceptance Scenarios**:

1. **Given** a schema providing a key and a config silent on it, **When** merged, **Then** the result
   carries the schema's provided value.
2. **Given** a schema providing a key and a config supplying its own value, **When** merged, **Then**
   the config's value wins.
3. **Given** two layers each providing a mapping under one key, **When** merged, **Then** the
   mappings are merged **deeply** — keys present in only one layer survive, keys in both take the
   nearer layer's value.
4. **Given** two layers providing sequences under one key with no `cascade` declared, **When**
   merged, **Then** the nearer layer's sequence replaces the further one entirely — `replace` is the
   default for every construct including sequences.
5. **Given** a layer providing a mapping and a nearer layer providing a scalar for the same key,
   **When** merged, **Then** the scalar replaces the mapping — deep merge applies only where both
   sides are mappings.
6. **Given** a config with no schema at all, **When** merged, **Then** the result is the config's own
   tree unchanged — a one-layer fold is the identity.
7. **Given** a config setting a key explicitly to null over a schema's provided value, **When**
   merged, **Then** null wins: it is a value, not an absence.
8. **Given** a schema that also declares `demand`, `seal`, `final`, or `delegate` on a key, **When**
   merged, **Then** it merges normally and those keywords have no effect — this milestone reads
   neither meaning nor error into vocabulary it does not implement.
9. **Given** a schema whose `keys:` section is absent, empty, or not a mapping, **When** merged,
   **Then** it contributes nothing and the fold succeeds — a schema that provides nothing is not a
   broken schema.
10. **Given** a config carrying `$schema` and a schema carrying `$id`, **When** merged, **Then**
    neither appears in the merged configuration — reserved keys are directives, not data.

---

### User Story 2 - `cascade: append` accumulates instead of replacing (Priority: P2)

A schema publisher declares that a key's sequences accumulate down the chain rather than each layer
replacing the last, so a house layer's stylesheet is added to rather than obliterated by a project's.

**Why this priority**: `replace` alone makes a cascade merely a stack of overrides. Accumulation is
what lets a layer contribute without having to know what came before, and it is the only §5.2 row
this milestone can fully discharge.

**Independent Test**: Two layers providing sequences under a key declared `cascade: append`; confirm
the result contains both layers' items, in root-to-leaf order, with neither layer's items lost.

**Acceptance Scenarios**:

1. **Given** a key declared `cascade: append` and sequences at two layers, **When** merged, **Then**
   the result contains every item from both, ordered root-first.
2. **Given** the same, with a third layer contributing an empty sequence, **When** merged, **Then**
   the accumulated items are unchanged — contributing nothing removes nothing.
3. **Given** a key declared `cascade: append` where a layer's value is not a sequence, **When**
   merged, **Then** it is refused: `append` is meaningless over a scalar or a mapping.
4. **Given** a key with no `cascade` declared, **When** merged, **Then** it behaves as `replace`.
5. **Given** an ancestor declaring `cascade: append` and a descendant declaring `replace` for the
   same key, **When** merged, **Then** it is refused — weakening a strategy away from accumulation
   would remove inherited items (§5.2).
6. **Given** an ancestor declaring `replace` and a descendant declaring `append`, **When** merged,
   **Then** it is permitted: tightening toward accumulation removes nothing.

---

### User Story 3 - Every value can say where it came from (Priority: P3)

A config author looks at a resolved value they did not write and asks where it came from. `why`
answers with the ordered chain: which layer supplied the winning value and where, and what it
overrode, in what order — the `git config --show-origin` question, and the struck-through-rule view
a browser gives for CSS.

**Why this priority**: `SPEC.md` §10 is explicit that this is "nearly free [in the merge engine],
nearly impossible to retrofit". The cost of building it now is small; the cost of adding it in v0.5
is rebuilding the fold.

**Independent Test**: Merge a three-layer chain where all three provide the same key, then ask `why`
for that key's pointer and confirm the chain names all three in order, winner first.

**Acceptance Scenarios**:

1. **Given** a merged result and the pointer of a key three layers contributed to, **When** `why` is
   asked, **Then** it returns an ordered chain naming each contributing layer and the span within it,
   winner first.
2. **Given** the pointer of a key only one layer supplied, **When** `why` is asked, **Then** the
   chain has exactly one entry.
3. **Given** a pointer that names nothing in the merged result, **When** `why` is asked, **Then** it
   says so distinctly, rather than returning an empty chain.
4. **Given** the pointer of a mapping that exists only because two layers each supplied a different
   key beneath it, **When** `why` is asked, **Then** it answers *synthesized* and names both
   contributors — distinct from a container one layer wrote, which answers with a chain.
5. **Given** a key under `cascade: append`, **When** `why` is asked, **Then** the chain names every
   layer that contributed items — accumulation has no single winner, and the answer must not pretend
   otherwise.
6. **Given** any merged value, **When** its provenance is inspected, **Then** every entry carries a
   position in a real document, so an author can open the file and see the line.

---

### User Story 4 - Malformed merge policy is refused precisely (Priority: P4)

Merge policy is data in a schema, and data can be wrong. A `cascade` value that is not a known
strategy, an `append` over something that cannot accumulate, or a config trying to set policy that
belongs to the contract — each is refused at the position where it was written.

**Why this priority**: §5.3's whole point is that merge policy belongs to the contract rather than to
individual documents, which is only true if the boundary is enforced.

**Independent Test**: One fixture per failure: an unknown `cascade` value, an `append` over a scalar,
and a config attempting to declare `cascade`.

**Acceptance Scenarios**:

1. **Given** a schema declaring `cascade: merge-by-key`, reserved but not implemented, **When**
   merged, **Then** it is refused naming the strategies this version supports.
2. **Given** a schema declaring a `cascade` value that is not a string at all, **When** merged,
   **Then** it is refused at that value's position.
3. **Given** a **config** declaring `cascade` on one of its own keys, **When** merged, **Then** it is
   ignored or refused — but never honoured, because policy belongs to the contract (§5.3).
4. **Given** two layers declaring **different** strategies for the same key, **When** merged, **Then**
   the outcome is defined and deterministic rather than dependent on fold order.

---

### Edge Cases

- **A key every layer provides**, and one only the root provides, in the same document.
- **A key whose value is a mapping in one layer and a sequence in another** — neither deep-merges nor
  appends.
- **An `append` key where the root contributes nothing** but a descendant does.
- **A schema whose `keys:` section is absent, empty, or not a mapping.**
- **A `provide` whose value is itself a mapping containing further keys** — deep merge must recurse
  through provided structure, not only through config structure.
- **A pointer into a value that exists only because of a provide** — `why` must still answer.
- **Two layers providing byte-identical values** — the chain must still record both, since "the house
  and the project agree" is different from "only the house spoke".
- **A very deep or very wide merge**, against the same limits v0.1 and v0.2 enforce.

## Requirements *(mandatory)*

### Functional Requirements

**Reading schema vocabulary** (§9)

- **FR-001**: The merge engine MUST read `keys.<name>.provide` and `keys.<name>.cascade` from schema
  documents in the pedigree.
- **FR-002**: `demand`, `seal`, `final`, and `delegate` MUST be ignored in this milestone — read by
  nothing, and never guessed at. A schema using them MUST still merge.
- **FR-003**: A `keys:` section that is absent, empty, or not a mapping MUST be treated as
  contributing nothing, not as an error.

**Folding** (§5.1, §5.3)

- **FR-004**: Merge MUST produce a single node tree from the pedigree plus the config.
- **FR-005**: Precedence MUST be **total, deterministic, and documented as a numbered list** — root
  first, leaf last, the config last of all.
- **FR-006**: Mappings MUST merge deeply. Every other pairing MUST replace, including a scalar over a
  mapping and a sequence over a sequence absent an `append` declaration.
- **FR-007**: A schema's `provide` MUST inject its value where the merged result is otherwise silent,
  and MUST lose to any value a nearer layer supplies.
- **FR-008**: An explicit null MUST be treated as a value that replaces, not as an absence that
  yields.
- **FR-009**: A single-layer fold MUST be the identity — the config's own tree, minus its reserved keys.
- **FR-025**: Reserved document keys (`$id`, `$version`, `$adopts`, `$pin`, `$schema`) MUST NOT appear in
  the merged configuration. They are directives governing how documents are found and what governs them,
  not data the configuration describes (`SPEC.md` §9, amended). A consumer receives the configuration,
  not the plumbing that assembled it.
- **FR-010**: The merged tree MUST satisfy every invariant v0.1 established: every node positioned,
  mappings in canonical key order, the result deeply frozen.

**Strategies** (§5.3)

- **FR-011**: `replace` MUST be the default for every key with no declared strategy.
- **FR-012**: `cascade: append` MUST accumulate sequence items root-first across contributing layers,
  and MUST NOT remove an inherited item — removal is not an operation in v1 (§5.2).
- **FR-013**: `append` over a value that is not a sequence MUST be refused at that value's position.
- **FR-014**: A `cascade` value that is not a strategy this version implements MUST be refused,
  naming what is supported. `merge-by-key` is reserved and MUST be refused as unimplemented rather
  than as unknown.
- **FR-015**: Merge policy MUST come from schemas only. A `cascade` declared by a config MUST NOT
  take effect.
- **FR-016**: A strategy MAY tighten toward accumulation and MUST NOT weaken away from it. A
  descendant declaring `replace` for a key an ancestor declared `append` MUST be refused: it discards
  every ancestor's contribution, which §5.2 forbids absolutely. `replace` → `append` is legal, since
  it removes nothing. Once a key accumulates, it keeps accumulating.

**Provenance** (§10)

- **FR-017**: Merge MUST produce a provenance record alongside the merged tree, keyed by **RFC 6901
  pointer**, with no bespoke path syntax invented.
- **FR-018**: Each provenance entry MUST name its layer and carry a span into that layer's real
  document, so an author can open the file and see the line.
- **FR-019**: A chain MUST be ordered, winner first, and MUST record every contributing layer — not
  only the winner, and not only the layers that differed.
- **FR-020**: For an `append` key, the chain MUST name every contributing layer, since accumulation
  has no single winner.
- **FR-021**: `why` MUST answer for a pointer, distinguishing three outcomes: a **chain** for a value
  or container some layer supplied; **synthesized**, naming its contributors, for a container that
  exists only because descendants were supplied and no layer wrote it; and **unknown pointer** for
  one that names nothing in the tree. All three MUST be reachable — an outcome that cannot occur is a
  distinction nobody can rely on.
- **FR-022**: Provenance MUST record what was **overridden**, not only what won — including a layer's
  contribution that appears nowhere in the merged result because a nearer layer replaced it. This is
  the observable consequence of building provenance during the fold rather than reconstructing it
  from the result, which is the point §10 makes about retrofitting: the losing values are gone by
  the time the fold is finished, and nothing downstream can recover them.

**Monotonicity** (§5.2, constitution Principle II)

- **FR-023**: The `cascade: append` row of the §5.2 table MUST be encoded as an executable property
  test: appending never removes an inherited item, and the accumulated result always contains every
  ancestor's contribution. This is the one row this milestone's vocabulary can fully construct.
- **FR-024**: The `Defaults (provide)` row MUST be encoded as far as it is constructible: that a
  nearer layer may replace a provided value is testable now; that the replacement must satisfy
  accumulated demands is **not**, because `demand` arrives in v0.4. The untestable half MUST be
  recorded as deferred rather than asserted, and MUST NOT be simulated with stub constraints.

### Key Entities

- **Layer**: one document in the fold — a schema from the pedigree, or the config — with its position
  in precedence order.
- **Merge Strategy**: `replace` or `append`, declared per key by a schema.
- **Provenance Entry**: one layer's contribution to one pointer — the layer, the span, and whether it
  won, was overridden, or accumulated.
- **Provenance Record**: pointer → ordered chain of entries, produced during the fold.
- **Merged Configuration**: the folded tree plus its provenance record.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A three-layer chain folds into one tree in which every key holds the value the numbered
  precedence list predicts, in 100% of corpus cases.
- **SC-002**: 100% of values in a merged result have a provenance chain whose every entry carries a
  position in a real document.
- **SC-003**: For any key under `cascade: append`, no ancestor's contribution is absent from the
  result, in 100% of cases — verified as a property, not only by example.
- **SC-004**: `why` answers for any pointer that names a value, and distinguishes an unsupplied key
  from an unknown pointer, in 100% of cases.
- **SC-005**: Merging is deterministic: the same pedigree and config produce a byte-identical tree,
  the same provenance chains in the same order, and the same diagnostics, on every run.
- **SC-006**: A merged tree satisfies every v0.1 invariant — positions present, canonical key order,
  deeply frozen — with zero exceptions across the corpus.
- **SC-007**: Malformed merge policy is refused at the position where it was written, in 100% of
  cases, never silently ignored.
- **SC-008**: The precedence list is published as a numbered list a reader can follow without reading
  the implementation.

## Assumptions

- **Provenance is a side structure keyed by RFC 6901 pointer**, not a field on `Node`. §4.1 keeps the
  delegation breadcrumb off the node deliberately, v0.1's `Node` is frozen and asserted against by
  300 tests, and §10 already writes the query as taking a pointer. The cost accepted: two structures
  that must stay in step, so a pointer resolving in one but not the other is a bug class this
  milestone must test for explicitly.
- **`why` is a library function in v0.3, not a command.** §10 writes it as `tool why`, but v0.1 and
  v0.2 shipped a library with no CLI, and growing one a verb at a time is worse than designing it
  once. The command surface is deferred, not cancelled.
- **Principle II binds here for the first time, and is discharged per row.** `cascade: append` is
  fully constructible now; the `provide` row's demand-satisfaction clause is not. Following the
  lesson v0.2 learned three times, the untestable half is declared rather than simulated — a stub
  constraint would make a green test assert against a fiction.
- **A strategy may tighten toward accumulation and never away from it** — not "the nearer layer
  governs", which an earlier draft of this spec assumed by analogy with value precedence. That
  analogy was wrong, and cross-artifact analysis caught it: precedence is the right rule for values
  and the wrong one for policy, because policy decides whether earlier values survive at all. A
  descendant switching `append` back to `replace` would remove every inherited item, which §5.2
  forbids. `SPEC.md` §5.2 gained the row that was missing and now settles it (logged in §15).
- **A config's `cascade` is ignored rather than refused.** A config is data; policy is contract. This
  is the more forgiving of the two readings FR-015 permits and is recorded so a future reviewer knows
  it was chosen rather than overlooked.

## Out of Scope

Each belongs to a later milestone in the `SPEC.md` §14 roadmap:

- Constraint checking, `demand`, whole-chain validation, the full error contract, `certify` (v0.4)
- Named types and the `types:` section (v0.5)
- Delegation and transclusion (v0.6); sealing, `final`, and cascade limits (v0.7)
- `merge-by-key`, `$extends`, multi-parent adoption, provide retraction (future)
- The typed TypeScript output surface (v1.0), JSON Schema export (v1.x)
- Any command-line surface, including `why` as a command
