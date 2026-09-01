# Research: The Output Surface, and the Freeze

**Milestone**: v1.0 (`specs/009-output-surface-and-freeze`)

Written **before** implementation. Every entry below was produced by running something — a Node
probe or the project's own test runner — not by reading. The constitution's probe gate (Principle V)
applies to every conclusion here that says a platform primitive "just works": each was exercised
against a **non-ASCII**, a **boundary**, and an **adversarial** input before being written down.

Decisions are `D-n`; findings that constrain the design without being a choice are `F-n`; warts in
`SPEC.md` Article VII are `W-n` and are the report's spine.

---

## F-1. A plain object cannot enumerate in canonical order, and the boundary is exact

**Probe** (`node`, one-liner): build `Object.create(null)`, insert fourteen keys **in §4.2 canonical
(code-point) order**, then read `Object.keys`, `for…in`, and `Object.getOwnPropertyNames`.

Keys probed, deliberately spanning all three gate categories:

| category | keys |
|---|---|
| non-ASCII | `"😀"` (U+1F600, above the BMP), `"�"` (U+FFFD) — the pair `src/model/node.ts` documents as UTF-16-vs-code-point discriminating |
| boundary | `"0"`, `"10"`, `"2"`, `"4294967294"` (the largest array index), `"4294967295"` (one past it) |
| adversarial | `"__proto__"`, `"constructor"`, `"-0"`, `"01"`, `" "` |

Result — inserted canonical order versus observed enumeration:

```text
canonical  : [" ","-0","0","01","10","2","4294967294","4294967295","__proto__","a","b","constructor","�","😀"]
Object.keys: ["0","2","10","4294967294"," ","-0","01","4294967295","__proto__","a","b","constructor","�","😀"]
```

**Finding.** ECMA-262's `OrdinaryOwnPropertyKeys` hoists every **array-index** key — a canonical
numeric string in `[0, 2^32−2]` — to the front, in ascending numeric order, before every other key,
which then follow in insertion order. This is not a property of `Object.create(null)`, of `Map`, or
of anything Cascata does: it is the object model. `"4294967295"` is *one past* the last array index
and is therefore **not** hoisted; `"-0"` and `"01"` are not canonical numeric strings and are not
hoisted either. Non-ASCII keys, including one above the BMP, enumerate in exactly the inserted
order.

**Consequence.** Article VII's wording — mappings project to "null-prototype objects whose keys are
**inserted** in §4.2's canonical order" — is satisfiable exactly as written. This milestone's own
FR-009 — "keys MUST **enumerate** in §4.2's canonical order" — is **not**, for any mapping carrying
an array-index key. See **W-2**. The implementation inserts canonically and the limit is named,
tested, and reported rather than papered over.

## F-2. `__proto__` on a null-prototype object, confirmed both ways

Same probe. On `{}`, `q["__proto__"] = {…}` **sets the prototype** and creates no own property
(`hasOwnProperty` false, `getPrototypeOf` returns the assigned object). On `Object.create(null)`,
`p["__proto__"] = {…}` creates an **ordinary own data property** (`writable`, `enumerable`,
`configurable` all true) and `getPrototypeOf` stays `null`.

This is Article VII's stated reason for `Object.create(null)`, verified rather than assumed. It also
settles the Edge Case list's `constructor` / `toString` / `hasOwnProperty`: on a null-prototype
object those names inherit nothing, so they are ordinary own properties with no special behaviour at
all — no separate mechanism is needed, only the same one, and a case each.

## F-3. `Number.isSafeInteger` is the wrong exactness test — the probe caught it

Article VII: the precision lint fires "where `int | float` projects an integer that is **not exactly
representable** as a double". The obvious implementation is `!Number.isSafeInteger(Number(v))`. It is
wrong, and wrong in the direction that matters — it fires on values that lose nothing:

| `bigint` | `Number(v)` | exactly representable? | `Number.isSafeInteger` |
|---|---|---|---|
| `9007199254740991` (2^53−1) | same | yes | `true` |
| `9007199254740992` (2^53) | same | **yes** | `false` ← false positive |
| `13510798882111488` (3·2^52) | same | **yes** | `false` ← false positive |
| `1152921504606846976` (2^60) | same | **yes** | `false` ← false positive |
| `9007199254740993` (2^53+1) | `…992` | no | `false` |
| `1152921504606846977` (2^60+1) | `…847000` | no | `false` |
| `2^1024` | `Infinity` | no | `false` |

The correct predicate is the round trip: `Number.isFinite(n) && BigInt(n) === v`. The `isFinite`
guard is load-bearing and adversarial-probe-derived — `Number(2n ** 1024n)` is `Infinity` and
`BigInt(Infinity)` **throws** `RangeError`, which under Article VI would be a legal document making
`load()` throw. Negative magnitudes behave symmetrically (`-2^1024 → -Infinity`), and were probed.

"A lint that cried on the shape rather than the value would be ignored within a week" is Article
VII's own reason for this rule; a lint that cries on 2^60 is the same failure one layer down. This is
`guards-that-dont-guard` in its precise form, and FR-020's required absence-case is what keeps it
fixed.

## F-4. `JSON.stringify` on a `bigint` throws `TypeError`, and that is the consumer's problem

Probed: `JSON.stringify({a: 1n})` → `TypeError: Do not know how to serialize a BigInt`. Nothing in
this milestone converts to avoid it. Converting would silently reintroduce exactly the precision loss
§4.2 and §6.1 exist to prevent — the same argument that withdrew RFC 8785 from `$pin`. It is
**documented** (README, `contracts/value-view.md`) with the two one-line workarounds a consumer has
(`JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x)`, or a schema that demands
`float`), and named as a cost rather than hidden.

## F-5. The recorded exponential is real — but the test that records it stopped exhibiting it

`tests/unit/recursion-termination.test.ts`'s "RECORDED FINDING" case writes
`values: { demand: { type: node } }` — the **key-declaration** spelling. v0.7 corrected `values` to
take a **bare demand** (`SPEC.md` §9/§15) *after* that test was written, and nobody re-ran the
numbers. Under the corrected spelling that value is a demand mapping whose only keyword is `demand`,
which is not a demand keyword and which `checkDemand`'s loop ignores — so **`values` recurses into
nothing** and the case is not exponential at all.

Measured, this milestone, at the same depths, on the same machine:

| depth | recorded spelling (`values: {demand: …}`) | corrected spelling (`values: {type: node}`) |
|---|---|---|
| 10 | 0.2 ms | 7.4 ms |
| 12 | 0.2 ms | 18.1 ms |
| 14 | 0.2 ms | 60.9 ms |
| 16 | 0.2 ms | 229.9 ms |
| 18 | 0.2 ms | **919.8 ms** |

The hazard v0.7 recorded is genuine, reproduces at exactly the magnitude it recorded (898 ms → 920
ms at depth 18), and is reachable **only** through the spelling `SPEC.md` now mandates. The test
guarding it was, at HEAD, guarding nothing — `sabotage-must-outrun-existing-cases` from the other
direction. Correcting that test is a strengthening and is reported as a changed test.

## D-1. The bound is a memo on `checkNamedType`, keyed on six things

**Decision.** Memoize `checkNamedType(decl, value, usageAccept, ctx, mergedPointer)` for the duration
of one `checkConfiguration` call.

**Why it works, and why it is the only place it works.** The blow-up is not "the same demand twice";
it is two *different* demands — `keys.child.demand` and `values` — that both name one type. They
diverge at the demand pointer and re-converge the instant resolution crosses into the named type:
`checkNamedType` rewrites the demand pointer to `["types", <name>, "demand"]` and the usage layer to
`decl.layer`, so both arrive at the type's body with **identical** arguments. That is the join point,
and memoizing anything above it (`checkDemand`) would key on the demand pointer that is precisely
what still differs.

**Key.** `decl` (object identity) → `value` (node identity) → `mergedPointer` ∥ `ctx.depth` ∥
`ctx.typeHops` ∥ `usageAccept`. Every component earns its place:

| component | what it distinguishes | what breaks without it |
|---|---|---|
| `decl` | which named type | two types' bodies share a cache slot |
| `value` | which subtree | a violation reported against the wrong node |
| `mergedPointer` | *where* that subtree sits | every diagnostic's `pointer` — two structurally identical subtrees at different pointers get one answer |
| `ctx.depth` | remaining depth budget | `depth-limit-exceeded` fires or fails to fire by cache order |
| `ctx.typeHops` | remaining hop budget | an unguarded cycle's cut-off point becomes cache-order dependent |
| `usageAccept` | the usage's narrowing | `accept` narrowing silently borrows another usage's set |

`ctx.usageLayer` is deliberately **not** in the key: `checkNamedType` overwrites it with `decl.layer`
before doing anything, so it cannot affect the result. `ctx.configuration` and `ctx.allDecls` are not
in the key either — they are fixed for the life of one `checkConfiguration` call, which is exactly
the cache's lifetime. Both omissions are stated here so they are decisions rather than oversights.

The layer identity is *not* redundant with `mergedPointer`, and FR-006's "pointer, layer, or depth"
is honoured by `mergedPointer` + `decl` + `depth` together: a value's layer is a property of the node
(`value.span.origin`), which is in the key by identity.

**Measured after** (same machine, same depths): 0.4 ms at depth 18, and flat — 0.5 ms at depth 24,
where the unbounded walk would need roughly 2^24 visits. FR-004's ratio test is what asserts this;
the wall-clock numbers are context, not the assertion.

**Alternatives rejected.** (a) *Refuse the composition* — a governance change, forbidden to an
implementer and, at v1.0, a meaning change requiring v2.0. (b) *A visited-set cutting the recursion*
— changes the diagnostics, which FR-005 forbids. (c) *A cache keyed on structural equality of the
value* — `nodesEqual` is O(subtree) and the key computation would itself be the cost being avoided;
node identity is sound because the merged tree is built once and frozen.

**What this does NOT fix, reported at the time and settled since.** The memo bounds the *walk*; it
cannot bound the *output*. Where a violation sits at depth *d* under the shared type, each arm
returns it and the list doubles at every level up — 2^d byte-identical diagnostics. That was reported
as a gap between FR-004 and FR-005 rather than quietly capped, verified independently, and settled by
`SPEC.md` §10 as a **correction** ("one violated demand at one position is one diagnostic"). See
**D-8**.

## D-8. §10's multiplicity rule: the identity, and where it is applied

**Settled by governance (`SPEC.md` §10, §15, amended 2026-09-01), not by this plan.** The finding was
this milestone's; the rule is the specification's. FR-004a implements it.

**The identity is §10's own triple, read carefully.** The code; the violated demand; the offending
value's position. The trap is the middle one: §10 defines the violated demand as *"its declaring
layer + span, as a JSON Pointer per RFC 6901 into that document"* — the pointer alone is **not** the
demand. Under whole-chain validation (§5.4) two layers may declare the identical pointer and both
fire, legitimately, and a bare `(code, demand pointer, value pointer)` key deletes one of them.
`Demand.layerRank` is the component that keeps them apart, and it is exactly what `renderViolation`
already publishes as `pedigreePosition`. Sabotage-verified: dropping it turns six tests red, four of
them **monotonicity property tests** — an over-collapse does not merely lose a message, it breaks
Principle II's invariant, because per-layer reporting is what those properties measure.

**Deliberately not in the key**: the message, the spans, the reason's own payload. Keying on those
would make the rule "collapse things that are already equal", which is unfalsifiable. The identity is
what §10 says identifies a diagnostic, and a separate case asserts that the duplicates it collapses
are identical in every readable field — so a future field that legitimately varied could not be lost
silently.

**Where it is applied, and a correction to the received wisdom.** The governance entry records that
"deduplicating at the end does not help, because the exhaustion happens while the lists are being
assembled". That is the right instruction and the reason the collapse lives inside `checkNamedType`,
before the memo caches — but **this codebase's own depth-24 case does not demonstrate it**, and the
sabotage said so. With the accumulating collapse removed and only a final pass left, the 296-byte
depth-24 configuration *survives*: the final pass runs before `renderViolation`, so the process is
spared building 16.7M `Diagnostic` objects and returns in 7.97 s instead of 8 ms, on roughly 270 MB
of transient references. Slower by three orders of magnitude, and still alive.

The placement therefore needed a case the pinned one could not provide. **Depth 40** is that case:
2^40 references is a terabyte, no final pass is reachable, and with the collapse applied as results
accumulate the work is linear in depth and returns instantly. The document is ~470 bytes and still
well inside §11's parse-depth cap of 64. Both cases are in the suite — the 296-byte one because the
governance pins it, the depth-40 one because it is what actually falsifies the wrong placement.

**FR-005 re-read rather than re-run.** FR-005 asks that memoizing change no diagnostic; it never
asked that the output be frozen, and reading it that way would have made it forbid the very
correction that fixed the bug. The instrument survives intact and now runs twice: collapsed-vs-
collapsed across the two walks, and **raw**-vs-raw (`dedupe: false`) at a depth where the raw output
still exists. The second is what keeps the first from being a tautology — a collapse could in
principle mask a difference by discarding the diagnostic that carried it, and running the comparison
before the collapse forecloses that.

## D-2. One rule for four sections, in `vocabularyProblemsForLayer`, with its own code

**Decision.** A single loop over `["authority", "directives", "keys", "types"]` in
`vocabularyProblemsForLayer` (`src/validate/vocabulary.ts`), refusing a present-but-non-mapping
section at that node's own span with a new code `malformed-section`.

**Why one rule and not four.** Every one of the readers listed below independently implements
"not a mapping → nothing to read". Fixing them one at a time would leave the posture intact and the
next section added would inherit it:

```text
src/validate/vocabulary.ts   readDemandVocabulary, topLevelKeyDeclarationVocabularyProblems
src/validate/types.ts        the types: read
src/validate/directives.ts   readDirectives
src/graph/authority.ts       the authority: read
src/merge/strategy.ts        readKeysVocabulary
src/merge/final.ts           the final: scan
src/resolve/delegate.ts      the delegation-grant scan
```

None of them changes. They stay lenient — a reader that throws on a malformed section would make the
*refusal* depend on read order — and one refusal is raised once, in the one pass whose job is
schema-shape refusal. This is `vocabulary.ts`'s existing posture for `unknown-demand-keyword` applied
to a section instead of a keyword.

**Why a new code rather than `malformed-demand-value`.** A top-level section is not a demand and has
no demand pointer; the message must name the section. The corpus divergence table's own philosophy is
that a hand-written check earning a more specific code than the meta-schema's generic `type-mismatch`
is the hand-written check being *better*. Three closed vocabularies already have three codes
(`unknown-demand-keyword`, `unknown-type-entry-keyword`, `unknown-directive-key`); a fourth category
gets a fourth.

**Config layers are exempt**, unchanged: `vocabularyProblemsForLayer` already returns `[]` for
`layer.role !== "schema"`, and a config's own inert `keys:`/`types:` is a documented corpus fixture
(`merge-fold/inert-vocabulary/`). A config carrying `types: oops` stays legal.

## D-3. The numeric decision is a second, small walk — not a side channel on the violation walk

**Decision.** `src/validate/numeric.ts` walks demands against the merged tree and returns
`ReadonlyMap<pointer, NumericClass>`. `src/project/value.ts` consumes it.

**Why not thread a collector through `checkDemand`.** That walk has a boolean-only fast path
(`alternativeMatchesBoolean`, `matchesResolvedName`) used for existential union membership, which
visits alternatives that do **not** apply to the value. A collector riding along would record
demands from alternatives the value never matched — `int | string` against a string would record an
`int` demand at that pointer. Separating the walks is what keeps "which alternatives *could* apply
here" (this walk's question) apart from "did this value satisfy them" (that walk's).

**Why not in `src/project/`.** Reading a `demand` is `src/validate/`'s job and needs
`resolveTypeName`, `TypeDeclaration`, and `parseTypeExpression`, all of which live there. `project/`
imports `validate/`; `validate/` never imports `project/`, and `tests/unit/layering.test.ts` gains
that assertion in both directions.

**The cost, named:** two walks over the same demands can drift. Mitigated by sharing every reader
(`readDemandVocabulary`, `readNestedKeysMapping`, `resolveTypeName`, `parseTypeExpression`) and by
`MAX_DEMAND_DEPTH`/`typeHops` accounting copied structurally rather than reinvented — and by the
memo of D-1 being reused here, since this walk has the identical `keys`+`values` blow-up.

## D-4. Union within one expression is a **union**; across demands it is an **intersection**

`type: "int | float"` at one position admits `{int, float}` — the alternatives of one expression are
alternatives, so the expression's numeric admission is their **union**. Two demands both covering one
position (two layers, or `keys` and `values` on one entry) compose by **intersection** (§5.1). The
accumulated admission is therefore

```text
  accumulated(P) = ⋂ over every applying demand ( ⋃ over that demand's alternatives )
```

and the projection reads it in one direction only:

| accumulated admission at P | projected JS type for an `int`-kind scalar |
|---|---|
| contains `float` | `number` (§17's `float` and `int \| float` rows) |
| contains `int`, not `float` | `bigint` (§17's `int` row) |
| contains neither (no demand mentions a numeric type) | `bigint` — faithful to the lexical kind (§17's "no numeric demand" row) |

Checked against §17's table row by row: `int` → `{int}` → `bigint` ✓. `float` → `{float}` → `number`
✓. `int | float` → `{int, float}` → `number` ✓. No numeric demand → `bigint`, faithful ✓. Two layers,
`int | float` then `int` → `{int,float} ∩ {int}` = `{int}` → `bigint`, which is FR-021's "the
accumulated demand, never the nearest layer's" — and note it comes out the same whichever order the
layers sit in, because intersection is commutative, which is §5.1's own reason for the rule.

## D-5. `int | string` — the named gap (W-1), settled as `bigint`

**Decision.** A demand mixing numeric and non-numeric alternatives is read by exactly the rule in D-4,
with no special case: `int | string` admits `{int}`, does not admit `float`, and therefore projects an
`int`-kind scalar as `bigint`. A string value under the same demand is unaffected — it is a string.

**Why this is the least surprising reading.** The rule Article VII actually states is not a lookup
table over three spellings; it is *"the schema declared a float acceptable here"*. Adding a
non-numeric alternative to a demand says nothing whatever about floats, so it must not change what
happens to integers. The alternative readings and why each is worse:

- *`unknown`/faithful, on the grounds that the table does not cover it* — a schema author who wrote
  `int` gets `bigint`, and the same author adding `| string` silently loses exactness. That is the
  document deciding the type through the schema's back door.
- *`number`, on the grounds that a mixed union is "not exact"* — turns `int | string` into a lossy
  projection with no float anywhere in the demand, and would fire the precision lint on a schema that
  never mentioned floating point.

**It is still a gap in the article** and is reported as one. Under §15's freeze rule the fix is an
**addition** — one row saying the rule is "admits `float`?", not "which of these three strings?" —
and additions stay permitted after v1.0. It is named now precisely so that it can be.

## D-6. `load<T>()` is generic with a default; the value rides beside the tree

```ts
export type LoadResult<T = unknown> =
  | { ok: true; configuration: MergedConfiguration; value: T; diagnostics: readonly Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

export async function load<T = unknown>(entryPath: string, options: LoadOptions): Promise<LoadResult<T>>;
```

Additive in both directions: every existing `load(...)` call site infers `T = unknown` and every
existing reference to the bare type name `LoadResult` still resolves (the parameter has a default).
`configuration` stays exactly where it was — Article VII's "a projection, never a replacement" is
literally this field surviving.

The one unavoidable unchecked cast in the library is `value as T` at the boundary of `project<T>()`.
It is not a cast on the node model (which the constitution bans) — the projection is plain JS data by
then — and it is the *specified* behaviour: "`load<T>()`'s `T` is the caller's claim, and the library
never checks it." Written once, at one site, with the article cited beside it.

## D-7. `metaValidate()` stays available, not automatic — the v1.0 question, answered

README and `src/index.ts` both record "whether it becomes the default is a v1.0 question, decided
with the vocabulary freeze". This is v1.0. **It stays opt-in.** Three reasons, none of them new:
§2.6 frames self-hosting as a *publishing* act; running it inside `load()` would double the work of
every resolution; and it would change the diagnostics of every schema written in six milestones — at
the exact release that makes changes permanent. Recorded in the derived artifacts so the open
question does not survive the freeze as an open question.

---

## The warts in Article VII

- **W-1. The numeric table does not cover a mixed union.** `int | string`, `float | null`,
  `int | float | string`. Settled by D-5, reported as a gap. Fixable as an addition.
- **W-2. "Inserted in canonical order" and "enumerate in canonical order" are different claims, and
  only the first is true.** F-1. Article VII says *inserted* and is correct; this milestone's FR-009
  says *enumerate* and is not satisfiable. The article needs a sentence naming the array-index
  exception, or nobody will find out until a config uses numeric keys.
- **W-3. The article never says what the value view does with a `null` scalar.** `null` versus
  absence is §4.2's own three-way distinction, and the Edge Cases list raises it without settling it.
  Implemented as JS `null` (a present key whose value is `null`); an absent key is an absent
  property. Reported.
- **W-4. The article does not say whether the projection is exposed as its own stage.** §3's pipeline
  ends "freeze → typed TS surface", and Principle IV requires a stage consume only the previous
  stage's output; FR-023 requires the value view be reachable without `load()`. Implemented as an
  exported `project()`. The article should name it.
- **W-5. "Deeply immutable … including the `Map`-shaped hazard" describes a hazard that cannot
  arise.** The projection has no `Map` in it at all — a mapping becomes an object. The clause is
  harmless and is a correction, not a meaning change. Recorded so the next reader does not go looking
  for the Proxy.
- **W-6. Where the precision lint's *position* comes from is unstated.** The article says it "names
  the key and both values". It is emitted at the offending **value's** own span with the value's own
  RFC 6901 pointer, which is what Principle III's never-phasing obligation requires ("the position
  must be the offending construct's own"). Stated here because the article does not.
