# Phase 0 Research: Merge Engine & Provenance

**Date**: 2026-08-31 | **Plan**: [plan.md](./plan.md)

Conducted under constitution v1.2.0's **probe gate**: a conclusion that existing code or a dependency
handles something "for free" must have been exercised against non-ASCII, boundary, and adversarial
input before it is written down.

Unlike v0.2, this milestone's probe found no defect — which is itself worth recording. The gate is
cheap when it confirms, and the three measurements below replace three assumptions that would
otherwise have been made silently.

## Probe results

| Question | Probe | Result |
|---|---|---|
| Does `createMapping`'s code-point sort cost anything at merge scale? | 50 / 500 / 5000 keys, reverse-ordered (worst case) | **No.** 0.04ms / 0.38ms / 3.16ms. Configuration documents are tens to hundreds of keys; deep merge rebuilds mappings often, and this is still free |
| Does `freeze`'s per-mapping `Proxy` cost anything at merge scale? | Trees of 155 / 1554 / 9330 nodes | **No.** 1.1ms to freeze 9330 nodes; 9330 proxied reads in 0.3ms. The Proxy that guards `Map` mutation is not a merge-path concern |
| Does RFC 6901 escaping round-trip correctly? | `~0`, `~1`, `a~1b`, `a//b`, `~~`, empty key, `café`, `🎉` | **Yes**, zero broken round-trips — including the ordering subtlety that unescaping must expand `~1` before `~0`, or `~01` decodes to `/` instead of `~1` |

## Decisions

### D1 — Provenance is a side structure keyed by RFC 6901 pointer

**Decision**: The fold produces a merged tree *and* a provenance record mapping pointer → ordered
chain. `Node` is unchanged.

**Rationale**: `SPEC.md` §4.1 keeps the delegation breadcrumb off the node deliberately ("lives on the
provenance chain, not here"), and §10 already writes the query as taking a pointer. v0.1's `Node` is
frozen and asserted against by 300 tests; widening it to carry history would change every one.

**Cost accepted**: two structures that must stay in step. FR-021 makes that testable by requiring
"no layer supplied this" to be distinguishable from "this pointer names nothing" — a pointer that
resolves in the tree but not the record, or the reverse, is then a detectable defect rather than a
silent one.

**Alternatives considered**: a chain on every node (rejected — changes `Node`, and every node pays
whether or not anyone asks); a compact handle into a chain table (rejected — still changes `Node`,
and adds an indirection to explain for no gain over a pointer key).

### D2 — The pointer resolver moves into `src/`, it is not duplicated

**Decision**: RFC 6901 escaping, unescaping, resolution, and *generation* move to
`src/model/pointer.ts`. `tests/corpus/runner.ts` imports it rather than keeping its own copy.

**Rationale**: A resolver already exists — in `tests/corpus/runner.ts`, because until now only tests
needed one. Provenance is keyed by pointer, so `src/` needs it too. Writing a second copy is exactly
the defect commit `f9aa900` was spent undoing for `Reference` and `DocumentIdentity`: two
structurally identical implementations with no single source of truth, kept in step by nothing.

`model/` is the right home for the same reason it was there: format-blind, imports nothing outside
itself, and depended on by every layer above.

**Note**: the existing implementation is correct, including the unescape ordering the probe checked.
This is a move, not a rewrite, and the tests that already cover it come along.

### D3 — `why` is a library function; the command surface is deferred

**Decision**: `why(merged, pointer)` returns the chain as data. No CLI in v0.3.

**Rationale**: §10 writes `tool why` and §6.1 writes `tool certify`, but v0.1 and v0.2 shipped a
library with no binary at all. Growing a CLI one verb at a time produces a surface nobody designed;
`certify`, `why`, and whatever v0.4 needs should be designed together.

Unlike the pinning and `$adopts` cases, this needs no `SPEC.md` amendment: §10 constrains what the
answer must contain, not how it is invoked.

**Alternatives considered**: shipping a minimal CLI now (rejected — argument parsing and output
formatting are a milestone's worth of decisions hiding behind one verb); deferring provenance
entirely to v0.4 (rejected — §10 is explicit that it is nearly free here and nearly impossible to
retrofit).

### D4 — A merged node carries the span of the nearest layer that contributed it

**Decision**: For a replaced value, the winner's span. For a deeply merged mapping, the span of the
nearest layer contributing to that mapping. For an appended sequence, the nearest contributor's.

**Rationale**: v0.1's invariant is that every node is positioned, and the position must mean
something — "open the file and see the line". The nearest contributor is the layer a reader would
look at first, and it is the same rule precedence follows everywhere else, so there is one story
rather than two. The *full* history is not lost: it is exactly what the provenance record holds.

**Alternatives considered**: a synthetic span for merged mappings (rejected — a position pointing at
nothing is worse than one pointing at a partial truth); the root's span (rejected — inverts the
precedence intuition everywhere else in the design).

### D5 — Monotonicity is discharged per row, and the untestable half is declared

**Decision**: Encode the `cascade: append` row of §5.2 as a property test now. Encode the
constructible half of the `Defaults (provide)` row — that a nearer layer may replace a provided
value. Record the other half — that a replacement must satisfy accumulated demands — as arriving with
v0.4, and do not simulate `demand` with stubs.

**Rationale**: Constitution Principle II binds for the first time here, because merge touches
provisions. But its own "Never" clause names a construct that does not exist yet. v0.2 shipped three
requirements describing scenarios its vocabulary could not construct, each found by a different
implementer; the lesson recorded in that spec was that a requirement about something needs the
vocabulary producing it to exist first. This applies it rather than repeating the mistake.

**Alternatives considered**: stub demands (rejected — a green test asserting against a fiction, to be
rewritten in v0.4 regardless); deferring all monotonicity to v0.4 (rejected — `cascade: append` is a
genuine merge behaviour and would ship untested against the table that governs it).

### D6 — Precedence is published as a numbered list, not left to be inferred

**Decision**: The precedence order is written out as a numbered list in a contract and in the README,
and the corpus asserts a case per rule.

**Rationale**: §5.3 says precedence must be "total, deterministic, and documented as a numbered
list", and names HOCON's carefully specified merge precedence as the prior art worth copying. A
precedence order that exists only in code is one nobody can predict, and predicting it is the entire
value of a cascade.

### D7 — Sorting and freezing are not merge-path concerns

**Decision**: Rebuild mappings freely during the fold; freeze once at the end.

**Rationale**: Measured rather than assumed (probe gate). `createMapping`'s canonical sort costs
0.04ms at 50 keys, and freezing a 9330-node tree costs 1.1ms. Neither justifies a mutable
intermediate representation or a deferred-sort optimisation, both of which would add a second way for
a mapping to exist and put v0.1's canonical-order invariant at risk for no measured gain.

## Deferred, with reasons

- **A command surface** for `why` and `certify` — designed together, in a later milestone (D3).
- **`merge-by-key`** — reserved by §5.3, refused as unimplemented rather than as unknown, so an
  author writing it learns it is coming rather than that it is wrong.
- **Provide retraction** — §5.5 parks it as monotone-legal but out of v1 pending syntax.
