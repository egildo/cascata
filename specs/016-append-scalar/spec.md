# Feature Specification: A Scalar Under `append`

**Feature Branch**: `016-append-scalar`

**Created**: 2026-09-22

**Status**: Draft

**Input**: GitHub issue #3 (Egildo, 2026-09-22), found by BelType on v1.6.0. A key under `cascade: append` refuses any contribution that is not a sequence, and the commonest contribution there is — one stylesheet, one component — is a scalar. `styles: ./report.css` is what an author writes first; `styles: [./report.css]` is what they write after reading the error. BelType's page builder still carries a branch accepting a single string for exactly this reason, reachable now only by direct call.

**Implements**: `SPEC.md` §5.3 (merge strategies), amended; §15 entry "A scalar under `append`" (v1.8). It relaxes v0.3 FR-013 (`specs/003-merge-engine/spec.md`), whose text stays as history with a forward pointer.

**This is an addition under §15's freeze rule, and the argument is written down rather than assumed.** The rule forbids "a rule that starts refusing what it accepted". This is the reverse: a document the fold refused now resolves, and no document that resolved before resolves differently — a sequence under `append` is untouched, a mapping is still refused, and a scalar produced no value at all to change. The one thing a consumer could have depended on is the refusal itself, and the consumer who reported it is asking for it to go.

**Precedent.** `precision-narrowed` (`src/diagnostics/codes.ts`, §17) is already a normalization reported as an `info` lint: the value is changed, the author is told, the build continues. This is the same posture for a different normalization.

## User Scenarios & Testing

The user is **the author** of a config or a schema who contributes one item where a list is accumulated, and **the embedder** who surfaces `info` diagnostics as notices.

- **Wrapped.** A key under `append` receives a string scalar from a config. The merged value is a one-item sequence; exactly one `info` diagnostic, `append-scalar-wrapped`, primary at the scalar's own span in the layer that supplied it; the load succeeds. (merge corpus; unit FR-001, FR-002)
- **Extended.** A root schema provides `[a.css]` under `append`; the config writes `styles: ./b.css`. The result is `[a.css, ./b.css]`, in that order. (merge corpus; unit FR-003)
- **Pre-existing.** An ancestor supplied `styles: ./a.css` while `replace` was in force, and a descendant schema declares `cascade: append` without re-supplying the key. The value accumulation starts from is a scalar; it is wrapped, with the notice at the ancestor's scalar. (unit FR-004)
- **Still refused.** A mapping under `append` is `append-over-non-sequence`, `error`, exactly as today; so is a mapping pre-existing the transition. (unit FR-005)
- **The demand decides the type.** `demand: { type: "resource[]" }`, config writes `styles: 42`. The fold wraps and notices; validation then refuses the item at the scalar's span. Both diagnostics are present; the load fails on the error, not on the wrap. (unit FR-006)
- **Answerable.** `why()` on the wrapped item names the scalar's own document, line and column. (unit FR-007)
- **Nothing else moves.** A sequence under `append`, a scalar under `replace`, and every existing merge-corpus case are byte-identical in outcome. (the existing suite)
- **The `-dist` consumer.** `load()` returns `ok: true` with the notice in `diagnostics` — `info` never makes a call `ok: false` (v0.7 FR-002 already says so). (unit FR-002)

## Requirements

- **FR-001** Where a value asked to participate in an `append` accumulation is a **scalar** — at either of the two moments `src/merge/fold.ts` checks appendability: a layer's fresh contribution, and the existing value when a key's strategy first transitions to `append` — the fold takes it as a sequence of that one scalar. The synthetic sequence's span is the scalar's span; the item is the scalar node itself, origin unchanged.
- **FR-002** Each wrap is reported as `append-scalar-wrapped`, `level: "info"`, primary at the scalar's span, message naming the key, the value as written, and the explicit spelling: `key 'styles' is under 'cascade: append'; the single value './report.css' was taken as a list of one — write [./report.css] to say so explicitly`. Never silent. `foldConfiguration` and `load()` carry `info` diagnostics through and do not discard the tree for them; only an `error` does.
- **FR-003** The wrapped item is appended after every inherited item, in rank order — §5.2's monotonicity is unchanged: a scalar never replaces an inherited list, it extends it by one.
- **FR-004** A scalar pre-existing the transition to `append` is wrapped under FR-001's second moment. Its notice is anchored at the ancestor's scalar, the same rule `append-over-non-sequence` follows: the document that wrote the value, not the one that declared the strategy.
- **FR-005** A **mapping** under `append`, at either moment, is refused as `append-over-non-sequence`, `level: "error"`, with the message no longer claiming a scalar is refused. v0.3 FR-013's text is amended by forward pointer; its refusal of a mapping stands.
- **FR-006** The fold does not consult the demand. Whole-chain validation runs over the merged tree after the fold, as it does today, so a scalar whose type the item demand refuses is refused **by the demand, at the scalar's span**, with the wrap notice also present. No special path.
- **FR-007** Provenance: the wrapped sequence's one item is attributed to the layer and span of the scalar, so `why()` on `styles[n]` names the author's line. The synthetic sequence node itself is attributed to the same layer.
- **FR-008** The new code is declared in `src/diagnostics/codes.ts` beside `precision-narrowed`, in whichever code list the fold's diagnostics belong to, with its level in the code's own doc; `isDiagnosticCode` admits it; the diagnostics contract (`docs/reference.md`'s code table and `specs/003-merge-engine/contracts/diagnostics.md`) lists it.
- **FR-009** `generateTypes()` and the JSON Schema exporter are unaffected: they read demands, never values. To be stated in the report, not tested, unless a test is one line.

## Out of scope

- **A `null` scalar under `append`.** Wrapped like any scalar (`[null]`); if the demand admits it, that is the author's list of one. Not special-cased.
- **Wrapping under `replace`.** A scalar under `replace` is a scalar; the demand refuses it if it wanted a list. Only `append` has a natural one-item reading, because only `append` promises a list.
- **A mapping as a list of one.** No sensible reading; refused as today.
- **Consulting the demand before wrapping.** Issue #3 phrases the rule as "where the key's demand admits a sequence"; the fold is demand-blind (`src/merge/` may not import `src/validate/`, `tests/unit/layering.test.ts`) and the demand refuses the item after wrapping at the same span, so the outcome is the same and the boundary is kept.
- **BelType's single-string branch.** Deleted there once this ships.

## Conformance

- **Merge corpus** (`tests/corpus/merge-cases/`, fixtures under `tests/corpus/cases/`): one case for *Wrapped*, one for *Extended*. The case format's `expect` for `ok: true` gains an optional `diagnostics` list for `info` codes, as the resolve corpus's already has; `CITES_PATTERN` in `tests/corpus/merge-case.ts` admits `v1.8` — it is an undocumented gate found by 015, and `tests/corpus/resolve-case.ts` has the same one. Expected trees written by hand from §5.2's rule, never from a run.
- **Unit** `tests/unit/append-scalar.test.ts`: the remaining scenarios through `load()` and `why()`, with an `InMemoryHost`.

Sabotage, each watched red and restored: FR-001 (wrap only the first moment — *Pre-existing* must go red and nothing else); FR-002 (drop the notice — *Wrapped* red; and make the fold discard the tree on `info` — *Wrapped* red on `ok`); FR-003 (prepend instead of append — *Extended* red); FR-005 (wrap a mapping too — *Still refused* red); FR-007 (attribute the item to the declaring layer — *Answerable* red). `grep -rn SABOTAGE src/ tests/` before every commit.

Existing tests that pin `append-over-non-sequence` on a **scalar** change: they now pin the wrap. Name each in the report. Any pinning it on a mapping is unchanged. Grep `tests/corpus/merge-cases/` and `tests/unit/` for the code and for `append` before claiming a clean run (015's lesson, item 1 of its report).

## Plan and tasks

One file and a report on the 012–015 precedent unless the design wants more; say which in the Complexity Tracking note. Commits, tree green at each:

1. **The wrap** — FR-001 to FR-007, FR-009. Tests first, red against the current code.
2. **The code and its contract** — FR-008; `docs/reference.md`'s table; a forward pointer at v0.3 FR-013 in `specs/003-merge-engine/spec.md` and at `append-over-non-sequence` in its `contracts/diagnostics.md`, leaving their text as history; `README.md` if it states the rule; `specs/016-append-scalar/report.md`.

Do not bump the version: 015 set `1.7.0` and the release that carries both milestones is decided after verification. `SPEC.md` is already amended on this branch (§5.3, §15). **Do not edit it.** Check every sentence of the amendment against what the code turned out to do, and report each disagreement unsoftened.
