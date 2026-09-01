# Research: The Meta-Schema Bootstrap

**Milestone**: v0.7, part 2 (`specs/008-metaschema-bootstrap`)

**Status**: written during v0.7 part 1's implementation, ahead of `/speckit-plan`.

**Method**: the meta-schema was drafted **by hand, on paper**, from `SPEC.md` §9 alone, before any of
008 was implemented — `draft-meta-schema.yaml` in this directory is that draft. Nothing here was
derived by running the code. That is deliberate and it is the constitution's Principle V discipline
applied to a design artifact: a meta-schema written against the implementation would prove only that
the implementation is self-consistent.

The exercise has already paid for itself twice. Its **first** pass, during v0.7 planning, found three
structural gaps and one unimplementable obligation, all settled in `SPEC.md` §15 (`values`, guarded
recursion, `directives:`, diagnostic levels). Its **second** pass, recorded here, found three more
that were settled mid-implementation (`seal` belonging to `demand`, `final: true`, top-level `seal`)
and three more recorded below — of which two are now settled and one, the YAML flow trap, turned out
to be a live defect in `SPEC.md` rather than a limitation of the vocabulary.

**The draft parses.** It has been round-tripped through the project's own `yaml` dependency, which is
how W-6 was found; a draft that had only been read would still contain the same error `SPEC.md` did.

---

## Decisions

### D-1. The meta-schema is the root of its own pedigree

It adopts nothing. A meta-schema that adopted something would need *that* document validated by
something, and the regress has to stop at a document the library ships. `$id: cascata/meta`,
`$version: 1`; §11's "the schema language itself is versioned via the meta-schema's own pedigree" is
satisfied by that `$version` being readable from the pedigree like any other.

### D-2. Meta-validation is available, not automatic

Carried from the milestone spec's Assumptions and restated here because it is the decision most
likely to be quietly reversed by an implementer who finds it easy to wire in. §2.6 frames
self-hosting as "publishing a schema = validating it as a config" — a **publishing** act. Running the
meta-schema on every `load()` would double the work of every resolution and would change the
diagnostics of every schema written in six milestones. Whether it becomes the default is a v1.0
question, decided with the vocabulary freeze. **This is a judgment call, not a citation.**

### D-3. `values` constrains shape; `keys` + `seal: closed` constrains membership

Both are needed and the draft uses each where the other will not do. `types:` and `keys:` are
mappings of author-chosen names → `values`. `directives:` is a mapping of exactly six known names →
`keys` plus `seal: closed`, because `values` alone would constrain the six entries' shapes while
admitting a seventh.

### D-4. **SETTLED** — a nested key declaration is a different shape from a top-level one

The draft needs two types where the vocabulary appears to offer one. As built:

| keyword | top-level `keys.<name>` | nested `demand.keys.<name>` |
|---|---|---|
| `demand` | yes | yes |
| `delegate` | yes | yes — via v0.6's own separate walker (`collectDelegationGrants`) |
| `provide` | yes | **no** |
| `cascade` | yes | **no** |
| `final` | yes | **no** (v0.7) |
| `seal` | — | n/a: as of v0.7 it is a `demand` keyword and nests with demands |

`SPEC.md` §9 says a nested `keys` constrains a mapping value's children "**the way** the schema's
top-level `keys:` constrains the config's own top level", which asserts a parity that does not exist.
The draft models the difference as two types, `keyDecl` and `nestedKeyDecl`, and marks both
UNSETTLED.

**Settled in favour of the split; `SPEC.md` §9's parity claim was corrected (§15).** The reasoning:
`provide`, `cascade` and `final` state a *layer's authority over a key* — a relationship between
documents, meaningful only where a schema declares a key of its own — while a nested key is part of a
value's **shape**, and shape is what `demand` is for. `delegate` nests because §8's grant is per key
at any depth and v0.6 built it that way deliberately; it is the considered exception, not the loose
end. The draft's `keyDecl` / `nestedKeyDecl` split is therefore the shipped shape.

The three readings, recorded because the rejected two each cost something real:

1. **The split is correct and §9's prose is wrong.** Governance keywords are about a *layer's
   authority over a key*, which only means something for a key the schema declares at its top level;
   a nested key is part of a value's shape. Under this reading `nestedKeyDecl` is right, §9 needs one
   sentence corrected, and `delegate`'s nesting is the anomaly needing justification — v0.6 built it
   deliberately, so it has one.
2. **§9's prose is right and the split is an accretion.** `provide`, `cascade` and `final` should
   nest too. Materially more work, with real semantics to settle (a nested `provide` injects a
   default deep in a tree; a nested `cascade` gives a subkey its own merge strategy).
3. **Neither — the two shapes should have different *syntax***, so that the difference is visible
   rather than inferred from what a reader knows about the implementation.

Reading 2 was rejected for needing genuinely new semantics settled first — a nested `provide`
injects a default deep inside a tree, a nested `cascade` gives a subkey its own merge strategy — in
service of a parity nothing had asked for. Reading 3 was rejected for breaking the shape of every
existing nested `keys` fixture.

---

## Warts found, still open

Numbered for citation. W-1 and W-2 bear on what self-hosting can honestly claim; W-3 and W-4 bear on
how the milestone's own requirements should be read.

### W-1. **RESOLVED WITH DEBT** — the leaf DSL, approximated by a superset pattern

§9.1's grammar has balanced parentheses, so it is not regular, no `pattern` can capture it, and a
schema cannot invoke the DSL parser. **Self-hosting is therefore complete except for leaf type
expressions.** Settled (§9.1, §15) as an approximation under one governing rule:

> **The pattern MUST accept every string the grammar accepts.** Over-acceptance is safe — the parser
> is the authority and refuses the rest — while a single false rejection would put two authorities in
> contradiction. In practice the superset differs only in not checking that parentheses balance.

The pattern is in `draft-meta-schema.yaml`. It was **established, not assumed**: 200,000 expressions
generated from §9.1's productions, with whitespace injected at every legal position, are all accepted
— zero false rejects — and the check was re-run on the pattern *after* a round-trip through the
project's own `yaml` dependency, since a pattern that does not survive YAML is no pattern at all.
Probe gate: non-ASCII names are rejected, matching the grammar, which is agreement rather than a gap.

**Two things for whoever revisits this.** First, the obvious whitespace-tolerant pattern is
**quadratic**: several adjacent optional whitespace groups compete for one run of spaces, giving
catastrophic backtracking measured at 4× per doubling — 16k spaces took 404ms. Folding whitespace
into the structural character classes, so exactly one quantifier consumes each boundary, makes it
linear (0.1ms on the same input) at no cost in strictness. A shipped library carrying a ReDoS-able
pattern in its own artifact is a different matter from `src/validate/constraints.ts`'s documented
acceptance of author-supplied regex exposure, and must not be reintroduced by "simplifying" it.
Second, the debt is parked in §14: closing it needs the vocabulary to be able to name a grammar.

### W-2. "Declared, but unconstrained" has no natural spelling

`provide` accepts any value. There is no top type — the built-ins are `string`, `int`, `float`,
`bool`, `null`, `mapping`, `sequence`, `url`, `path` — so the draft writes `demand: {}`, an empty
demand mapping.

Worse, the failure mode is silent and sharp: `readNestedKeysMapping` skips a child that has **no**
`demand` at all, so omitting `demand` does not mean "declared with no constraints", it means "not
declared" — and under `seal: closed` that key is then **refused**. Two spellings that look
interchangeable differ by whether the key exists. Whether the cure is a top type, an explicit
`demand: any`, or simply a documented idiom is worth a paragraph in the report.

### W-3. The meta-schema cannot express relational or cross-layer law

By construction it checks one document's **shape**. It cannot express:

- that a `provide` value satisfies its own key's accumulated demands (§5.2's Defaults row) — a
  relation between two parts of one document;
- any of §5.2's monotonicity table — relations *between* documents;
- that a type expression's names resolve (§7's namespace rules).

All three stay hand-written checks. FR-017 and FR-018 must not be read as "the meta-schema subsumes
the hand-written vocabulary checks": it subsumes the *shape* ones only, and the milestone should say
which is which rather than leave a reader to assume the stronger claim.

### W-4. "The verdicts must agree" needs to mean verdict, not diagnostic code

FR-018 requires the meta-schema's verdict to agree with the hand-written check for every schema
vocabulary error. They will frequently disagree on the **code**: a sequence-valued `$adopts` draws a
purpose-built `multiple-adoption` diagnostic from the resolver — which exists specifically to tell an
author they are ahead of C3 linearization (§9) — where the meta-schema yields a generic type
mismatch. That is the hand-written check being *better*, not the meta-schema being wrong. Read FR-018
as accept/refuse agreement, and report every place the codes differ, because each is a candidate for
teaching the meta-schema a `pattern` or an `enum` that recovers the better message.

### W-6. YAML flow style breaks unquoted `[]` — and five `SPEC.md` examples with it

`demand: { type: resource[] }` is well-formed Cascata and malformed **YAML**: inside a flow mapping,
`[` opens a flow sequence, so the document is rejected before §9.1's grammar is consulted. Block
style is unaffected, and `|` alone is safe in flow (`{ type: int | float }` parses).

Found by feeding the draft to the project's own parser rather than reading it. **Five of `SPEC.md`'s
own worked examples were written in the broken form** — three in §7, two in §9's worked chain — and
had been wrong for six milestones. Nothing caught them because no *executed* fixture uses flow style
with brackets; the examples were prose that had never been run. Fixed textually, with the durable
part being the authoring rule now stated in §9.1 (§15).

The lesson generalizes past this milestone and is the reason §5.3 and §7 each gained a worked example
in the first place: **an example is worth what executing it costs.** Any example this milestone adds
to a document should be parsed by the real parser in a test, not merely written.

### W-5. `seal` names two different things in one document

In the draft, `seal` appears as a demand keyword inside `types.demand`, and again as an entry in the
meta-schema's own `keys:` section — because a schema document may itself carry a top-level `seal`.
Both are correct and legal. It is worth one comment in the shipped artifact, and worth watching for
whether the implementation ever confuses the two scopes.

---

## Confirmed by the draft (no action needed)

- **Guarded recursion works, and every cycle the meta-schema needs is guarded.** `demand → items →
  demand`, `demand → keys → values → keyDecl → demand`, and `demand → values → keyDecl → demand` each
  pass through a structural level. §7's amended rule is exactly strong enough and no stronger — a
  useful sign it was drawn in the right place.
- **`directives:` is sufficient** for §6.1's pin syntax and §9's single-string `$adopts`, both of
  which have existed only as hand-written checks until now.
- **`enum` with string members works** for `cascade`, `delegate`, and `seal`, via `nodesEqual`.
- **Top-level `seal: closed`** closes the meta-schema's own document, which was the construct with no
  syntax at all before v0.7.

---

## Risks for `/speckit-plan`

1. **The corpus may not be clean.** FR-017 requires every schema in the conformance corpus to
   validate against the meta-schema. Six milestones of hand-written fixtures were never held to one;
   some will fail, and each failure is either a sloppy fixture or a meta-schema that is too strict.
   Budget for triage, and do not "fix" a fixture without establishing which of the two it is.
2. **The depth cap.** The meta-schema is the deepest document this project has produced. If it
   approaches `MAX_DEMAND_DEPTH`, the cap needs re-examining and that is a finding, not an
   inconvenience — see the `guards-that-dont-guard` lesson: prove a bound is reachable before calling
   it protection.
3. **008 depends on 007's `load()` and host seam** (FR-019: the meta-schema is obtained through the
   seam, never read directly as a bundled constant). It cannot start its US5 until those land.
