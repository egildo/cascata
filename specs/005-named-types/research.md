# Phase 0 Research: Named Types & Nested Demands

**Date**: 2026-08-31 | **Plan**: [plan.md](./plan.md)

Conducted under constitution Principle V's probe gate. This milestone's hardest question was not a
probe at all — it was reconciling a genuine textual tension inside `spec.md` itself between its
Acceptance Scenarios/FRs (decided) and its Laws/Assumptions prose (partly flagged as open). That
reconciliation, D1 below, is the load-bearing decision of the whole milestone and is reported at
length because it changes what is and is not constructible.

## D1 — Collision is unconditional; narrowing is usage-level only; this is now sharpened, not just flagged

**The tension.** `spec.md` §7's own laws read: "Descendants may narrow inherited types (tightening
every usage...). Widening/redefining is illegal under `adopts`." This describes a descendant *doing
something to the type itself* — narrowing legally, widening illegally — which only makes sense if a
descendant can **redeclare** an inherited type's name at all. But User Story 4's own Acceptance
Scenario 1 is unconditional: "Given two layers declaring the same type name, When validated, Then the
collision is reported" — no exception carved out for a declaration that happens to be a legitimate
narrowing of an ancestor's own type. `SPEC.md` §5.2's own table settles this the same unconditional
way: the named-types row's **Never** column reads "Widen **or redefine** under `adopts`" — redefine,
not "widen", is in the forbidden column, with no separate legal-redefinition case carved out
anywhere in the row.

**Decision**: Collision (FR-017) fires whenever **two or more schema layers, anywhere in the
pedigree, declare a type under the same unqualified name** — unconditionally, including when the
later declaration would, by content, look like a legitimate narrowing of the earlier one. There is no
implemented mechanism by which a descendant redeclares `types.<name>` to narrow it. **"Narrowing an
inherited type" (§7's law, User Story 3) is achieved exclusively through usage-level `accept:`
selectors** — a demand's own `accept` (FR-012), narrowing the type's *declared* alternative set at
the point of use — never by rewriting the type's own entry.

**Consequence for the coordinator's suggested sabotage.** The task brief that commissioned this
milestone named a specific sabotage: "resolve type names against a single merged type graph instead
of per-layer scope... only a multi-layer case where a descendant redefines a type will catch it."
Under D1, **a descendant cannot redefine a type at all without triggering a hard collision** — there
is no green-path (non-error) configuration in which "a descendant redefines `resource`" is a valid,
resolvable scenario to construct. This is exactly the kind of concrete case the brief itself invited
("if implementation teaches you something that sharpens the question... put it in your report; that
is exactly the kind of finding §15 gets amended from") — reported at length in the milestone report,
not smoothed over. FR-008's own scope rule is not vacated by this, though: see D2.

**Why not the other way** (redeclaration legal, collision reserved for some narrower case)? Every pair
of layers in a v1 pedigree is comparable — `$adopts` is single-parent, chain-only, no diamonds, no
siblings (§6.1). Searched for a structural condition under which "two layers declare the same name"
could ever be *sibling* rather than *ancestor/descendant* and found none reachable in v1: delegation
(which would create fragment-like sibling relationships) is v0.6, out of scope; multi-`$adopts` is a
pre-committed future door, not v1. Absent a sibling case, the only way to make User Story 4's
unconditional Acceptance Scenario 1 *and* §5.2's unconditional "redefine: Never" both true is for
every ancestor/descendant redeclaration to be exactly what they're describing.

**Alternatives considered**: making redeclaration legal (governs downward, nearest-wins, like ordinary
value precedence) and treating collision as reachable only for the built-in and qualifier-suffix cases
(rejected — contradicts User Story 4 Acceptance Scenario 1's literal, unconditional wording, and
contradicts §5.2's table cell, which is the more authoritative, non-discursive source); trying to find
a syntactic marker that distinguishes "narrowing redeclaration" from "colliding redeclaration" — e.g.
an `accept`-only type entry with no `demand` treated as a patch rather than a fresh declaration
(rejected — no citation anywhere authorizes this distinction, and inventing it would be exactly the
kind of unauthorized mechanism Principle I forbids).

**What stays flagged, unresolved, per the task brief's own instruction not to amend §7**: whether §7's
"tightening every usage" was ever meant to include type-entry redeclaration, or was always meant to
describe usage-level `accept` narrowing (in which case §7's prose is just imprecise, not contradicted)
is exactly `spec.md`'s own flagged Assumptions-section question, and this milestone's implementation
answers it operationally (usage-level only) without amending the article. The report names this as the
single hardest interpretive call of the milestone and recommends the same fix that resolved the
v0.3 cascade-timing ambiguity: a worked example in `SPEC.md` showing one concrete case through to its
answer.

**SETTLED-NOTE (added after `SPEC.md` §15, commit 0b63d67 / `specs/005-named-types/spec.md`
commit 9c6c0d7 — not a rewrite of D1 above, which is left exactly as it was reasoned and decided
at the time): the owner overturned this decision.** D1's own "Why not the other way" section
searched for a structural condition that would make two same-name declarations *sibling* rather
than *ancestor/descendant*, found none reachable in v1, and concluded from that absence that every
same-name pair must therefore be the unconditional-collision case User Story 4's Acceptance
Scenario 1 and §5.2's "redefine: Never" cell both describe. **That reasoning had the conclusion
backwards**: the correct inference from "every pair is ancestor/descendant, never sibling" is that
every same-name pair is the narrowing §7's cascade law describes, and the *collision* law — which
exists specifically for the *sibling* (unrelated-declarations) case — can therefore never fire in
v1 at all. D1 noticed the same structural fact this settlement is built on and drew the opposite
conclusion from it.

Also wrong in hindsight: weighing User Story 4's Acceptance Scenario 1 and §5.2's table cell as
"the more authoritative, non-discursive source" over §7's cascade law. Both were amended (§15) —
the Acceptance Scenario was rewritten outright (it now describes narrowing, not collision) and the
table cell's own prose was corrected in the same commit. Citation count and discursiveness are not
the same thing as correctness; a contradiction between a spec's terse table and its prose law does
not resolve itself by picking whichever reads more like a rule.

**What this means for the "why not the other way" alternatives-considered paragraph**: the
rejected alternative ("making redeclaration legal — governs downward, nearest-wins, like ordinary
value precedence") is *exactly* what shipped after the amendment. It was rejected here for
contradicting Acceptance Scenario 1's old wording and §5.2's old table cell — both since corrected.
Nothing about the alternative's own mechanics was wrong; only the citations weighed against it were
stale.

**The mandated sabotage this file originally described ("a descendant redefines a type" is
unconstructible) is retracted along with the decision that made it unconstructible.** It is now
directly constructible — see `specs/005-named-types/tasks.md`'s narrowing conformance cases
(T049-T051) and the correction's own two mandated sabotage runs (resolving to the ancestor's
declaration instead of the nearest; an ancestor's demand resolving the leaf-most declaration).

## D2 — FR-008's scope rule is still real and testable: reachability, not disambiguation

Given D1 (names are globally unique once collision-checked), per-layer scoping cannot matter for
*choosing among candidates* — there is at most one non-built-in candidate for a given name anywhere
reachable in a collision-free pedigree. It still matters for **reachability**: FR-008 says a name
resolves "against the definitions in scope at the layer whose demand names it — that layer's own
declarations and those of its ancestors" — an **ancestor cannot resolve a name only a descendant
declares** (the Edge Case `spec.md` names directly: "A type used before it is declared, or declared in
a descendant and used in an ancestor... a resolution failure, not a lookup that happens to reach").

**Decision**: implement resolution as: at layer `L`, a name resolves against declarations from layers
`0..L` (root through `L`, inclusive) plus the built-in set. A layer ranked below the declaring layer
cannot see it. **This is the property the mandated sabotage targets** (adjusted from "a descendant
redefines a type" to "an ancestor resolves a name only a descendant declares" — see D1): resolving
against a single pedigree-wide merged graph instead of a rank-bounded one would wrongly let an
ancestor's own `type:` expression resolve a descendant-only name. A second, complementary case: two
*different*, non-colliding names, one declared by the root and one by a descendant — the descendant's
own usage can see both; the root's own usage can see only its own. Both are real, constructible,
green/red-distinguishing cases under D1, so FR-008 is not vacated by D1 — it is narrowed to exactly
the reachability half of what its own text describes.

**SETTLED-NOTE (same amendment as D1's own note above).** This decision's opening sentence —
"Given D1 (names are globally unique once collision-checked), per-layer scoping cannot matter for
*choosing among candidates* — there is at most one non-built-in candidate" — no longer holds: a
name can now have several reachable candidates (an ordinary narrowing chain), and scope now governs
*both* reachability (unchanged, this decision's own load-bearing claim, still correct) *and*, for
the first time, an actual choice among candidates — nearest-wins (FR-016), the identical rule
`src/validate/types.ts`'s `nearestReachable` implements. The reachability claim this decision makes
— "an ancestor cannot resolve a name only a descendant declares" — is untouched by the amendment
and remains exactly as reasoned below; only the premise that resolution never has to *choose*
changed.

## D3 — `accept`'s two positions, and what a type's own `demand` + `accept` compose to

`accept` appears in two structurally distinct positions that happen to share a name (`spec.md`'s own
Assumptions section names this explicitly, citing it as the same shape `SPEC.md` §15 just resolved for
`format` — but concludes, correctly, that this is not that defect, because the two positions are
syntactically disambiguated: a type-entry-level `accept` (sibling of `demand`, e.g.
`types.resource.accept`) declares alternatives; a demand-level `accept` (inside `keys.<name>.demand`,
or inside a nested `keys`/`items` demand, e.g. `keys.styles.demand.accept`) selects a subset.

**Decision on what the resolved constraint means**: given a `type:` alternative that names a
declared type `T` with `demand: D` and (optionally) `accept: A` (a set of further type names), the
resolved check for a value at that alternative is **`D` AND, if `A` is non-empty (narrowed by any
usage-level `accept`, defaulting to all of `A`), the value additionally matches at least one name in
the narrowed subset** — each treated as an ordinary `type:` alternative (recursively resolved through
the same builtin-or-named lookup). A type declaring no `accept` at all has no second half — only `D`
applies. **This is inferred, not stated verbatim by §7's mechanics** — §7's own worked example
(`demand: { type: string }` with `accept: [url, path, glob]`) does not distinguish AND-composition
from "accept replaces demand.type" (all three alternatives are themselves refinements of `string`, so
either reading produces the same verdict for that one example, which is exactly why it does not
settle the question by itself). AND-composition was chosen because it is the only reading that keeps
`demand`'s other fields (e.g. `minLength`) meaningful on a type that also declares `accept` — an
"accept replaces demand" reading would silently discard them. Flagged as an inferred detail, not a
governance question (unlike D1): no citation contradicts it, it is simply underspecified, and a
worked example resolves it as cleanly as D1's tension would benefit from one.

**A usage's `accept` naming an alternative outside the type's own declared set — including a type
declaring no `accept` at all — is FR-013's widening refusal**, `type-accept-widened`: an empty
declared set makes any usage-level selection "outside the declared set" by construction, which is
exactly `spec.md`'s own Edge Case ("`accept` on a type whose demands are not a union... must be
decided") resolved by reusing FR-013's existing mechanism rather than inventing a new one.

## D4 — Depth-bounded recursion (FR-025), probed

**Probe**: node/v8's default stack comfortably tolerates recursion far past any depth a real
configuration would ever nest (v0.1's own `maxDepth: 64` default has run in production against this
project's own real fixtures without incident since v0.1). No new probe found a reason to pick a
different number for nested-demand depth than the number already governing nested-document depth —
both protect against the identical class of hostile input (adversarially deep nesting intended to
exhaust the stack), so reusing `64` avoids introducing an unjustified second constant. **Decision**:
the recursive value-walk that checks `keys`/`items` at depth refuses with `depth-limit-exceeded`
(v0.1's existing code, reused — not repurposed, since it is the identical hazard) once nesting exceeds
`64` levels, anchored at the demand node whose recursion would cross the limit. Checked dynamically
during the walk (not as a separate static schema scan) — the walk already visits every level exactly
once, so a second pass would cost real complexity for no coverage gain; the dynamic guard is reached
before any stack growth a realistic `maxDepth` could not already tolerate.

## D5 — `$id` qualifier extraction, probed

**Probe**: `id.split("/").filter(s => s.length > 0)`, taking the last element. Non-ASCII
(`réseau/cœur` → `cœur`), boundary (`""` → no qualifier; `"core"` → `core`; a trailing slash →
unaffected), adversarial (repeated/empty segments `a//b///core` → `core`; a full URL
`https://example.com/schema/core` → `core`, matching `$id: site-builder/core` → `core` from §7's own
worked example; an all-slash string → no qualifier) all behave sanely with no exceptions thrown.
**Decision**: this extraction is the qualifier rule (FR-019). A document whose `$id` produces no
segments (absent, or present but degenerate) has no qualifier and is unreachable by qualified name
(FR-019b).

## Deferred, with reasons

- **Static subsumption** for named types — v1.x, `spec.md`'s own Assumptions section and §5.4.
- **The meta-schema bootstrap** that makes "primitives are predefined types" literally true — v0.7.
- **A configurable nested-demand depth limit** — this milestone hardcodes `64` (D4); `validate()`
  takes no options today, and adding one is a surface decision this milestone was not asked to make.
