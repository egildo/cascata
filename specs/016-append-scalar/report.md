# Milestone report: a scalar under `append` (016)

Branch `016-append-scalar`, on top of `00a289c` (the spec, and `SPEC.md` amended). Two commits:

| | |
| --- | --- |
| `c95e5b5` | **The wrap** — v1.8 FR-001 to FR-007, FR-009, and the code's declaration |
| *(this commit)* | **The code's contract** — FR-008's documentation, the forward pointers, this report |

**Final suite: 2160 tests, 2159 passing.** The one failure is
`tests/unit/doc-examples.test.ts > parses SPEC.md:134`, **which was already red at `00a289c`**,
before this milestone's first line — see finding 1. `tsc --noEmit` is clean. The branch point had
2141 tests; 19 were added (17 unit, 2 corpus) and four existing cases were rewritten.

## What landed

`checkAppendable` used to answer `Diagnostic | undefined`. It now answers an `AppendableOutcome` —
the node to accumulate, and the diagnostic (if any) that reading it produced:

- a **sequence** is itself, silently;
- a **scalar** is `createSequence([node], node.span)` plus `append-scalar-wrapped`, `level: "info"`;
- a **mapping** is itself, plus `append-over-non-sequence`, `level: "error"`.

One function still owns the whole reading, and both of `src/merge/fold.ts`'s moments still call it —
`checkFreshAppendContributions` and `checkTransitionedAppendKeys` became
`readFreshAppendContributions` and `readTransitionedAppendKeys`, each returning the node with every
wrapped key substituted (and returning its input unallocated when nothing was wrapped, which is every
fold written before v1.8).

**FR-007 needed no provenance change at all, and that is the design.** The synthetic sequence carries
the scalar's own span and its single item *is* the scalar node, origin untouched, so
`recordFreshContribution`/`recordAccumulation` record exactly what they would have recorded for a
sequence the author bracketed by hand. `why("/styles/0")` walks up to `/styles` (the builder records
at mapping-key granularity — `provenance.ts`'s own rule) and finds a chain whose last entry is the
config's line 2, column 9. Nothing downstream can tell a wrapped contribution from a hand-written
one, which is the point: the wrap is a reading of the text, not a stage of its own.

**FR-003 falls out of `accumulateAppend` seeing two sequences.** No ordering code was written.

**`info` had to stop being fatal.** `foldConfiguration` returned `ok: false` whenever
`diagnostics.length > 0`; it now partitions by level — an `error` still discards the tree, notices
ride along on the `ok: true` branch, which gains a `diagnostics` field (additive). `load()`
concatenates them, **on the failure path as well as the success one**: FR-006's scenario needs both
the wrap and the demand's refusal, and a refusal of `[42]` at a span where the author wrote `42` is
unreadable without the notice that produced the list.

## Conformance

- **Merge corpus**, two new cases over two new fixtures: `T016a-append-scalar-wrapped` (*Wrapped*,
  FR-001/FR-002) and `T016b-append-scalar-extends-inherited-list` (*Extended*, FR-003). Trees written
  by hand from §5.2's rule; every line and column counted off the fixture text, never read off a run.
  The case format's `ok: true` branch gains an optional `diagnostics` list, and the runner checks it
  **whether or not the case declares one** (absent means "none", not "do not look") — otherwise a
  case could raise an undeclared notice and still pass, a hole the `ok: false` branch never had.
- **Unit** `tests/unit/append-scalar.test.ts`, 17 cases: the remaining scenarios through `load()`,
  `merge()` and `why()` with an `InMemoryHost`, plus the two out-of-scope readings pinned rather than
  left implicit (a `null` scalar wraps to `[null]`; a scalar under `replace` stays a scalar).
- Written first and watched red: **13 of the 17 failed** against the unchanged library. The four that
  passed did so for a nameable reason — they assert v1.7 behaviour that must not change (a sequence
  under `append`, a scalar under `replace`, and the two mapping refusals).

### Sabotage

Each backed up to the scratchpad first, marked `SABOTAGE`, watched red, restored;
`grep -rn SABOTAGE src/ tests/` empty before the commit. Counts exclude the standing SPEC.md:134
failure and one flake (below).

| # | Sabotage | Red |
| --- | --- | --- |
| 1 | FR-001: no substitution at moment 2 (the diagnostic still fires; the node is not replaced) | **3**, the *Pre-existing* cases and nothing else: corpus `T052a` and both FR-004 units |
| 2 | FR-002: wrap silently | **11**: both new corpus cases, `T052a`, and every unit case that observes the notice |
| 3 | FR-002: discard the tree on an `info` too | **16**, including *Wrapped* on `ok` — every case that reaches a value through a wrap |
| 4 | FR-003: prepend instead of append | **22**, *Extended* among them |
| 5 | FR-005: wrap a mapping too | **8**: `T052b`, `T055`, `T058` and all three FR-005 units |
| 6 | FR-007: attribute the item to the declaring layer's contribution span | **3**: *Answerable*, and `T016a`'s span assertion |

Sabotage 1 is the one the spec asked to be exact, and it is: three red, all *Pre-existing*. A first,
cruder version of it — deleting the whole moment-2 call — took a fourth case with it (the mapping
pre-existing the transition), which is a different claim; it was redone to break only the
substitution.

Sabotage 4 is worth naming as **mostly redundant**: 22 red, of which only two are this milestone's.
Append ordering was already guarded by `T025a`, `T025b`, `T026`, `T028b`, `T029`, `T035`, `T040`,
`T053` and a validate-corpus delegation case. The new *Extended* case earns its place by covering the
wrap-specific half (a *scalar* extending rather than replacing), not the ordering itself.

## Existing assertions that moved

Four, each with its reason. Two more than the spec anticipated.

1. **`tests/corpus/merge-cases/T052a-append-over-scalar-refused-in-supplying-layer.json`** — the case
   the spec expected. A scalar pre-existing the transition to `append`; it now pins the wrap,
   `ok: true`, `append-scalar-wrapped` at `schema-root.yaml:3:14`. **Its own point survives intact**:
   it was written to pin the *position* — the layer that supplied the value, not the one that
   declared the strategy — and FR-004 keeps exactly that rule for the notice. Fixture untouched;
   `cites` moves to `v1.8 FR-004`.

2. **`tests/corpus/merge-cases/T055-cross-category-policy-failures-all-reported.json`** and
   **3. `T058-multiple-independent-policy-failures-all-reported.json`** — here I did **not** do what
   the spec's sentence says, and the reason is CLAUDE.md's rule about not weakening a test. Both were
   written to prove that *errors* are collected rather than reported one at a time: T055 that a
   vocabulary failure and a data-shape failure both come back, T058 that two independent data-shape
   failures both do. Their offending values happened to be scalars. Repointing them at
   `append-scalar-wrapped` would have turned both claims into claims about **notices**, which do not
   abort and therefore prove far less — the collect-all property would have lost its only corpus
   coverage for errors. Instead their fixtures' `provide:` values became **mappings**, which v1.8
   still refuses, and both cases assert exactly what they always asserted, at the mappings' new
   positions. The names say so. `T052b` (mapping) is untouched, as instructed.

4. **`tests/unit/merge-index.test.ts`'s "returns ok:true with a configuration, never both a
   configuration and diagnostics"** — the one the spec did not anticipate, and the only assertion
   this milestone genuinely contradicts. It asserted `expect("diagnostics" in result).toBe(false)`.
   v1.8's whole mechanism is that a successful merge may now carry notices. The claim FR-010 actually
   makes is about **errors**, so it is now asserted as such — no `error`-level diagnostic accompanies
   a configuration — with the (empty) list also checked for this fixture, which is strictly more than
   the old line proved. A test asserting the *absence of a field* was pinning the encoding rather
   than the rule.

The spec's instruction to grep first (015's lesson, item 1) was followed and is what found all four:
`append-over-non-sequence` and `append` across `tests/corpus/merge-cases/` and `tests/unit/`.

## Found, recorded rather than smoothed

### 1. `SPEC.md`'s v1.8 amendment ships a YAML block that does not parse, and the repository's own test says so

This is the headline. `SPEC.md` §5.3's new example, at line 134, is a single ```yaml fence holding
**two documents side by side in two columns**:

```
# house schema                        # ./page.md, the config
keys:                                 ---
  styles:                             styles: ./report.css        # taken as [./report.css]; noticed
    cascade: append                   ---
    provide: [house.css]
# resolves to [house.css, ./report.css]
```

That is not YAML. `tests/unit/doc-examples.test.ts` (v0.7 FR-021a / SC-009, "every documented YAML
example parses") reports three `malformed-document` diagnostics for it — *Nested mappings are not
allowed in compact mappings*, *Implicit keys need to be on a single line* — and has been red since
`00a289c`, the amendment's own commit. **Verified by stashing every change on this branch and running
that file at `00a289c`: 1 failed, 36 passed.** It is not a regression from this milestone.

I am instructed not to edit `SPEC.md`, so it is still red, and the suite is green apart from it. The
fix is one that only the document's owner may make: split the fence into two, which is `SPEC.md`'s own
convention everywhere else — §5.3's worked cascade and §9's worked chain both give each document its
own fenced block with a `# path` comment on the first line. The test is doing exactly the job it was
written for; that this slipped through is a fact about how the amendment was committed, not about the
test.

### 2. FR-008 asks for two placements that are mutually exclusive

"The new code is declared in `src/diagnostics/codes.ts` **beside `precision-narrowed`**, in **whichever
code list the fold's diagnostics belong to**." `precision-narrowed` is in `OUTPUT_SURFACE_CODES`; the
fold's codes are `MERGE_POLICY_CODES`. **Invented:** `MERGE_POLICY_CODES`, on the ground that a code
belongs with the stage that raises it, with a doc comment that names `precision-narrowed` as the
posture it copies and says why it is the one `info` in an otherwise all-`error` list. If "beside" was
meant literally, this is the line to change.

### 3. FR-006's own scenario does not run as written

The spec (and issue #3) write `demand: { type: "resource[]" }`. `resource` is **not a built-in** — it
is a named type declared in `SPEC.md` §7's worked example, and BelType's own. A standalone fixture
naming it is refused as `unknown-type-name` **at the schema's own span**, before the item demand is
ever reached. Measured: `[{append-scalar-wrapped @ /v/config.yaml:2:9}, {unknown-type-name @
/v/schema.yaml:5:13}]`. **Invented:** `string[]`, which exercises the identical path with a built-in
— the wrap produces `[42]`, and `42` is not a string. The scenario's claim (both diagnostics present,
the failure on the error) holds; only its type name had to change, and the test says so in a comment.

### 4. The spec's story-2 boundary cannot hold

The plan puts FR-008 (the code's declaration) in story 2, after story 1 implements FR-001 to FR-007.
A diagnostic code that is not in `DIAGNOSTIC_CODES` does not typecheck, so story 1 cannot compile
without it. **Invented:** the declaration lands in story 1 as the compile-time prerequisite it is;
story 2 carries FR-008's other half, the documentation — `docs/reference.md`'s table, the merge
contract, the forward pointers.

### 5. Changing `checkAppendable`'s signature is not in any requirement, and there was no alternative

FR-001 says "the fold takes it as a sequence of that one scalar" without saying where the substitution
happens. The predicate answered a diagnostic; something had to answer a node. **Invented:**
`AppendableOutcome`, one shape carrying both halves so no caller can read the diagnostic and forget
the node. The alternative — a second function beside the predicate — would have let the two moments
drift apart, which is the thing `fold.ts`'s module doc spends two paragraphs guaranteeing they cannot.

### 6. FR-002's "`foldConfiguration` and `load()` carry `info` diagnostics through" understates the change

It reads as a property to preserve. It was a property to *create*: `foldConfiguration` had no
`ok: true` diagnostics channel at all, `MergeResult`'s success branch had no such field, and `load()`
dropped everything but `validated.diagnostics` on a validation failure. Three signatures changed
(`FoldOutcome`, `MergeResult`, and `load()`'s failure path), all additively. A reader of FR-002 alone
would budget for none of it.

### 7. `SPEC.md` §15's v1.8 entry checked against the code

Every sentence holds, with two notes:

- "**at either moment the fold checks appendability**" — correct, and the entry is the only document
  that says so; FR-001 says it too, but §5.3's own prose does not, and §5.3 is what an author reads.
- "**the author is told with `append-scalar-wrapped`, `level: "info"`, at the scalar's own span in the
  layer that wrote it**" — correct at both moments, which is FR-004 and is worth the entry stating,
  since the pre-existing-scalar case is the one where "the layer that wrote it" is not the layer that
  declared the strategy.
- "**No document that resolved before resolves differently**" — true, and now mechanically checked:
  every pre-existing merge-corpus case is byte-identical in outcome except the three whose *fixtures*
  I changed, and those changed because they were fixtures for the refusal, not for any document that
  resolved.

### 8. `SPEC.md` §5.3's new paragraph says the demand "still decides what the item may be, after the wrap, at the same position" — true, and slightly generous

The demand decides at the same position *when the demand is about the item*. An `items:` demand
refuses the item at the scalar's span, as promised. A demand about the **sequence** — `minLength`, say
— now sees a list of one where it previously saw a refusal, and reports at the sequence's span, which
is also the scalar's span. So the sentence holds in both readings here, but only because the synthetic
sequence borrows the scalar's span; it would have been false under any other choice of span, and
nothing in §5.3 or the requirements says the span choice is load-bearing for it. FR-001 does say the
span is the scalar's, so the two are consistent — recorded because the dependency is invisible from
§5.3 alone.

### 9. Smaller things

- **`tests/corpus/merge-case.ts`'s `CITES_PATTERN`** admitted only `v0.3`, exactly as 015 found for
  `resolve-case.ts`. Extended to `v(0.3|1.8)`. That is twice in two milestones; the gate deserves a
  line in `CLAUDE.md` rather than a rediscovery per milestone.
- **`createMapping` de-duplicates by `new Map(sorted)`**, so appending an override entry would have
  worked — via V8's stable sort. The substitution is written as an explicit
  `entries.map(([k, v]) => [k, wrapped.get(k) ?? v])` instead, because correctness resting on sort
  stability is the kind of thing this repository's traps list is made of.
- **FR-009 does not exist.** The spec's "Plan and tasks" lists story 1 as "FR-001 to FR-007, FR-009",
  and the requirements stop at FR-009 being about `generateTypes()` — which is numbered FR-009 in the
  list but described in the Conformance section as untested-by-design. It is FR-009's content
  (`generateTypes()` and the JSON Schema exporter are unaffected) that is discharged here by argument
  rather than by test: both read `demand` vocabulary and never values, and the wrap touches only
  values. `generateTypes()` does not even call `foldConfiguration`'s value path. No test, per the
  requirement's own instruction.
- **One flake**, unrelated and pre-existing: `tests/unit/validate-totality.test.ts`'s "doubling the
  alternatives does not quadruple the work" is a wall-clock ratio assertion that fails under load and
  passes on a quiet machine. It did so once during this milestone, as it did during 015.

## Complexity Tracking

One `spec.md` and this report, on the 012–015 precedent; no `/speckit-plan`, no `/speckit-tasks`. The
change is one predicate's return type, two call sites in the fold, a level partition, and a field on
two result types. The version is **not** bumped: `package.json` stays at `1.7.0`, per the spec.

## Not done, deliberately

- **Not tagged, not pushed, not merged.** `npm run dist-tag` and the push are Egildo's acts.
- **Issue #3 is neither closed nor commented on.**
- **`SPEC.md` and the constitution are untouched**, including the block in finding 1 that leaves a
  standing test red.
- **BelType's single-string branch.** Deleted there, once this ships.
