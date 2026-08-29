# Phase 0 Research: Information Model & YAML Adapter

**Date**: 2026-08-29 | **Plan**: [plan.md](./plan.md)

The Technical Context carried no unresolved `NEEDS CLARIFICATION` — the constitution pins the stack
and the spec settled scope. The open question was different and more consequential: **how much of
the portability floor does `yaml` enforce for us, and how much must Cascata own?**

That was answered empirically, by probing `yaml` v2.9.0 directly rather than reasoning from its
documentation. Findings below drive every decision that follows.

## Probe results: what `yaml` does and does not give us

| Floor requirement (§4.2) | `yaml` behavior | Verdict |
|---|---|---|
| Position for every node | `range: [start, valueEnd, nodeEnd]` on every node **including keys**; `LineCounter.linePos()` gives line/column | **Partly — see the correction below.** The units are wrong for our model and must be converted. |
| Duplicate keys | `DUPLICATE_KEY` error; **multiple duplicates in one document are all reported**; `"host"` and `host` correctly collide | **Free** |
| YAML 1.2 core schema / Norway | `no`/`yes`/`off` read as text, only `true`/`false` boolean, under the default core schema | **Free** |
| Integer precision | `intAsBigInt: true` yields exact big integers | **Free** |
| Lexical int vs float | `Scalar.source` preserves the written text (`"2"` vs `"2.0"`) and `Scalar.type` distinguishes plain from quoted — available **without** `keepSourceTokens` | **Free** |
| Multi-document streams | `MULTIPLE_DOCS` error from `parseDocument` | **Free** |
| BOM and CRLF | Consumed correctly; line/column stay accurate | **Free** |
| **Complex keys** (`? [a, b]`) | **Accepted silently — no error, no warning** | **Cascata must enforce** |
| **Non-string scalar keys** (`1:`, `true:`, `null:`) | Accepted; key becomes a number/boolean/null | **Cascata must enforce** |
| **Non-core tags** (`!!binary`, `!!timestamp`, `!!set`) | **Resolved silently**, no warning; only genuinely unknown tags (`!mytag`) warn, and as a *warning* not an error | **Cascata must enforce** |
| **Alias cycles** | **No error**; produces a circular structure that throws only when serialized | **Cascata must enforce** |
| Anchors / aliases / merge keys | `Alias` nodes are left in the tree, not expanded; merge keys need `merge: true` or `<<` stays a literal key | **Cascata must expand** |
| Depth / size caps | A `RESOURCE_EXHAUSTION` backstop exists at extreme flow nesting, but the threshold is the library's, not ours | **Cascata must enforce its own** |

### Correction (2026-08-29, after v0.1 implementation)

**Two claims in the table above were wrong, and both were load-bearing.** They were written from a probe
that used only ASCII documents, where the mistaken and correct readings coincide. Implementation on
non-ASCII input exposed them; both are now verified empirically.

1. **`yaml`'s `range` values are UTF-16 code-unit indices into the JS string, not UTF-8 byte offsets.**
   The two agree for ASCII and diverge the moment a document contains anything else. For
   `"a: café\nb: 2\n"` — JS length 13, UTF-8 length 14 — the library reports the `2` at 11, while its
   byte offset is 12. `data-model.md` defines `SourceSpan.start`/`end` as byte offsets, so **the adapter
   must build a conversion table**; passing the library's numbers through unchanged silently corrupts
   every span in any document containing a non-ASCII character.

2. **`LineCounter#linePos().col` counts UTF-16 code units, not code points**, contradicting
   `data-model.md`'s explicit "column is code points, so it matches what an editor shows." An astral
   character (any emoji) is one code point but two code units, so every column after it is off by one
   per such character. **The column must be recomputed**; `LineCounter` is trustworthy for the *line*
   number only, which is unaffected because a newline can never be half of a surrogate pair.

The verdict column above should therefore be read as: positions are *available* for free, but not in
the units this model requires. The conversion is the adapter's job, and
`tests/corpus/cases/unicode/astral-character-column-and-byte-offset.json` is the case that holds it.

### Open question: block-collection range extents

For a block mapping or sequence, `range`'s tight upper bound includes the trailing newline of the
block's final line, unlike scalars, which get a genuinely tight bound. v0.1 sidesteps this — no case
asserts an exact byte extent on a collection node, only on scalars — but SC-004 exactness at
collection level will have to settle whether to trim it.

The shape of the milestone follows directly: `yaml` is a lexer with excellent positions and correct
core-schema semantics; the floor is Cascata's to enforce on top of it.

## Decisions

### D1 — Build a strict conversion layer over `yaml`'s AST, not a parser

**Decision**: Use `parseDocument` with `{ intAsBigInt: true, merge: true, lineCounter }`, then walk
the resulting AST into Cascata's model, applying floor checks during the walk.

**Rationale**: Positions are the hardest part of writing a YAML parser and `yaml` already gets them
right, including the BOM and CRLF cases that are exactly where hand-rolled span math breaks. Writing
our own parser would put Cascata's most safety-critical property in the least-tested code in the
repository. The floor checks the library omits are all cheap to apply during a walk we have to do
anyway.

**Alternatives considered**: Writing a YAML parser (rejected — enormous, and would relitigate
positions); using `yaml`'s CST layer (rejected for v1 — §4.3 defers comment preservation, and the CST
is a heavier interface for no present gain, though this remains the door §4.3 leaves open); using
`js-yaml` (rejected — no byte ranges on nodes, which alone disqualifies it under Principle III).

### D2 — Tags are an allowlist, not a denylist

**Decision**: Permit only the YAML 1.2 core schema tags (`str`, `int`, `float`, `bool`, `null`, `map`,
`seq`). Every other resolved tag — including standard-library tags like `binary`, `timestamp`, `set`,
and `omap` — is refused, at the tag's own position.

**Rationale**: The probe showed non-core tags resolving *silently*, so a denylist would need to
enumerate every tag any future `yaml` release might resolve — the classic failing-open design. An
allowlist fails closed, and Principle VI says to ship the restriction when in doubt. It also matches
the model being defined as the **intersection** of YAML/JSON/TOML: `!!timestamp` has no counterpart in
either of the others.

**Alternatives considered**: Treating the library's `TAG_RESOLVE_FAILED` warning as the detector
(rejected — it fires only for genuinely unknown tags, missing `!!binary` entirely); allowing non-core
standard tags (rejected — no JSON/TOML counterpart, so they cannot survive the portability floor).

**Note**: this is the stricter of the two readings flagged in the spec's assumptions. The probe
strengthens the case for it — a denylist here would silently admit whatever the library learns to
resolve next.

### D3 — Expand anchors ourselves, with cycle detection before expansion

**Decision**: Resolve aliases and merge keys during the walk, tracking the set of anchors currently
being expanded. Encountering an anchor already on that path is refused as a cycle diagnostic.

**Rationale**: The probe confirmed `yaml` builds a circular structure and reports nothing — a naive
recursive expansion would not merely produce a bad tree, it would not terminate. Detection has to
happen *during* expansion, on the active path, because a document may legitimately reference the same
anchor many times without a cycle. Cost is a set of active anchor names.

**Alternatives considered**: Detecting cycles after building (rejected — never gets the chance);
relying on the depth cap to bound it (rejected — turns a precise, nameable error into a confusing
one, and the resulting diagnostic would point at the wrong thing).

### D4 — Expansion attributes positions to the anchored content

**Decision**: A node produced by expanding an alias reports the position of the **anchor's content**.
The alias site is not recorded in this milestone.

**Rationale**: That is where the text a reader would go look at actually lives. Carrying both is the
richer answer, but it needs the provenance-chain machinery that arrives with delegation (§8.3), and
inventing a second, incompatible breadcrumb now would have to be unwound then.

**Alternatives considered**: Attributing to the alias site (rejected — points at `*base`, which tells
the author nothing about the offending value); carrying both immediately (deferred, not refused —
this is the spec assumption most worth revisiting, and §8.3 is where it belongs).

### D5 — Any violation means diagnostics and no tree

**Decision**: `parse` returns either a tree or a non-empty diagnostic list, never both.

**Rationale**: A partial tree is a trap — every downstream consumer would need to ask whether what it
holds is trustworthy, and the honest answer would be "partly". Since the whole point of the floor is
that everything above it can assume portability, admitting a half-floored tree would undo it. This
also keeps the return contract legible: one question, one answer.

**Alternatives considered**: Returning a best-effort tree alongside diagnostics (rejected as above;
an editor integration wanting partial results is a later, explicitly-designed mode, not a default).

### D6 — Collect diagnostics from three sources, sort by position

**Decision**: The collector merges (a) `yaml`'s `errors`, (b) `yaml`'s `warnings`, and (c) Cascata's
own floor checks, maps each to a stable Cascata code, and returns them ordered by position.

**Rationale**: FR-019 demands one pass reporting everything. The probe showed the three sources
genuinely partition the work — duplicates come from (a), unknown tags from (b), complex keys and
non-core tags from (c) — so none can be dropped. Positional ordering means a config author reads them
top-to-bottom in the order the problems appear in their file.

**Alternatives considered**: Cascata codes mirroring the library's codes (rejected — that would make
a dependency's internal naming part of Cascata's public contract, and Principle VI wants the
vocabulary closed and owned).

### D7 — Depth and size caps, enforced by Cascata, with documented defaults

**Decision**: Size checked before parsing; depth tracked during the walk. Defaults are generous
against real configuration documents and hostile to the pathological ones — proposed **depth 64**,
**size 8 MiB** — and both are configurable.

**Rationale**: §4.2 mandates caps but names no numbers, and the library's own `RESOURCE_EXHAUSTION`
threshold is its business, not our contract. Checking size first means a hostile document is refused
without being parsed at all.

**Alternatives considered**: Relying on the library's backstop (rejected — undocumented threshold, and
the diagnostic would be theirs rather than ours).

### D8 — The corpus is data, and format-agnostic from the first case

**Decision**: Each case is a data file naming its input, its format, and its expected outcome — either
an expected tree or an expected set of diagnostic codes **with positions**. The runner is generic; the
adapter under test is selected by the case's `format` field.

**Rationale**: Principle V requires the corpus before the conforming code, and §12 wants it shared
across adapters. Building it while only one adapter exists is the only moment when format-agnosticism
is free; after three adapters it is a migration. Expected positions are compared, not just codes —
otherwise a diagnostic pointing at the wrong line would pass.

**Alternatives considered**: Hand-written per-case tests (rejected — FR-024 requires adding a case
without touching code); comparing codes only (rejected — SC-004 requires exact positions, and position
precision is the whole point of Principle III).

## Deferred, with reasons

- **Both-position provenance for expanded aliases** — arrives with the delegation breadcrumb (§8.3).
- **CST / comment preservation** — §4.3 explicitly defers it; the adapter is structured so it can slot
  in later without disturbing the model.
- **Partial trees for editor integration** — a deliberate future mode, not a default (D5).
