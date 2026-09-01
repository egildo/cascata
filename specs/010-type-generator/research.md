# Research: The Accumulated Demand, and the TypeScript Type Generator

**Milestone**: v1.1 (`specs/010-type-generator`). Written before implementation. Three kinds of
entry, as in 009: **F-n** findings (facts checked against the code or against TypeScript 5.9.3 by
running it), **D-n** decisions this plan takes, and **W-n** warts in Article VIII surfaced by planning,
to be fed back into `SPEC.md` §15 as corrections or additions.

**The probe gate (constitution Principle V) was run, not assumed.** Every claim below about what
TypeScript "handles" was exercised with `ts.createProgram` over an in-memory file under `strict`,
against non-ASCII, boundary, and adversarial input. Two of the results changed rules the spec had
written down; they are F-4 and F-5.

## F-1. The accumulated-demand lattice exists, and it is driven by a document

`src/validate/numeric.ts:16` states the composition rule this milestone generalizes —
`admission(P) = ⋂ over every demand applying at P ( ⋃ over its depth-0 alternatives )` — and
implements it as a two-flag lattice (`numeric.ts:76-89`: `Admission { int, float }`, `union`,
`intersect`) accumulated per RFC 6901 pointer across schema layers only (`numeric.ts:307-323`).
`resolveTypeName` (`types.ts:283`) resolves a name to the nearest declaration at or above the usage
layer, which is §7's law; `admissionOfName` (`numeric.ts:117`) applies it.

But the walk is **value-driven**: `walk` bails when there is no value (`numeric.ts:187`) and descends
`values`/`items` by iterating the actual merged tree (`numeric.ts:218`, `232`). It knows nothing about
a position no document reaches. The shape walk in `check.ts` is worse for this purpose: `checkDemand`
(`check.ts:552`) fuses descent with judgment and gates every descent on the value's runtime type;
`numeric.ts:47-62` records why a collector could not ride on it. There is no value-free "walk the
demand shape" anywhere.

Reusable as-is: `parseTypeExpression` and its canonical `Alternative[]` (`typeexpr.ts:66-76, 234`),
`resolveTypeName`/`allDeclarations`/`TypeDeclaration` (`types.ts:48-58, 159, 283`),
`readDemandVocabulary`/`readNestedKeysMapping`/`readKeyDeclarationDemand` (`vocabulary.ts:172, 191,
222`), `readKeysVocabulary` for `provide` (`merge/strategy.ts:103`), the memo shape of `check.ts:536`.
A demand is a `RawDemand = ReadonlyMap<string, Node>` (`vocabulary.ts:159`); no typed record exists,
and every consumer re-reads keywords by hand. The `switch` in `refuseMalformedShapes`
(`vocabulary.ts:434-536`) is the de facto specification of the record this milestone introduces.

**None of it is exported** from `src/index.ts`; `package.json` ships `.` and `./host/node`.

## F-2. Per-layer emission joined by `&` is unsound twice — confirmed by the compiler

Probe: `type Root = { n: number }; type House = { n: bigint }; const v: Root & House = { n: 1n }`
fails with *Type 'bigint' is not assignable to type 'never'*. A root admitting `int | float` and a
house narrowing to `int` accumulate to `int` — `bigint` — while their per-layer emissions are `number`
and `bigint`, whose intersection is uninhabited.

Probe: `type Open = { a: string; [k: string]: unknown }; type Closed = { a: string };
const v: Open & Closed = { a: "x", extra: 1 }` **compiles**. An open layer's index signature survives
intersection with a closed layer's object type, so `seal: closed` would not close.

Probe: `type A = { a?: string }; type B = { a: string }; const v: A & B = {}` fails — `&` does get
optionality right. That is the only one of the three it gets right, and it is why Decision 1 in the
brief (one accumulated tree, semantic intersection) was taken rather than the smaller design.

## F-3. The oracle is buildable with what is installed, and the compiler's excess-property check is what makes closedness testable

`typescript` 5.9.3 is a devDependency; `ts.createProgram` over a `CompilerHost` whose
`getSourceFile` serves one in-memory file, with `noEmit`, `strict`, `lib: ["lib.es2022.d.ts"]`,
typechecks a `const x: T = <literal>` and returns diagnostics without touching disk. Every probe in
this file ran that way.

Closedness: `type T = { readonly a: string }; const v: T = { a: "x", extra: 1 }` fails with *Object
literal may only specify known properties*. The same value reaching `T` **through a variable**
compiles — TypeScript's excess-property check applies to object literals only. The oracle writes
literals, so `seal-violation` cases fail as US6 requires; the limit is real for consumers and is
named in the contract (W-3).

`exactOptionalPropertyTypes`: the repo does not enable it (`tsconfig.json`). Under it, `{ a: undefined }`
against `{ a?: string }` fails while `{}` passes. The oracle's literal writer never writes `undefined`
— an absent key is an absent property (§17) — so the oracle is correct under either setting, and the
emitted `?` means the same thing under both.

## F-4. A closed *empty* mapping cannot be `{}` — the probe caught a wrong row

Article VIII's table says `seal: closed` emits "no index signature". For a mapping with declared keys
that is right. For a mapping with **no** declared keys the emission would be `{}`, and
`const v: {} = { a: 1 }` **compiles** — in TypeScript `{}` is "any non-nullish value", not "an object
with no properties". The honest emission is `{ readonly [key: string]: never }`: the probe shows it
rejects `{ a: 1 }` (*Type 'number' is not assignable to type 'never'*) and accepts `{}`. It cannot be
used beside declared properties (a property's type must be assignable to the index type), which is why
the two cases differ. **Reported as W-1.**

## F-5. Identifiers: what TypeScript actually accepts, and what §9.1 makes impossible

Run against the compiler:

- Quoted property names `"città"`, `"🍝"`, `"__proto__"`, `"constructor"`, `"10"` all compile, in the
  type and in the literal, and `v["__proto__"]` is typed as the declared property. Bare `città` as a
  property *and* as a type-alias name also compiles: ECMAScript identifiers are Unicode. Quoting is
  therefore a choice, not a necessity — taken in D-6 for determinism, and recorded here so that a
  future reader knows bare would have worked.
- `type Object = …` and `type Record = …` at **module** scope compile and shadow the globals; the
  emitted file is a module (`export type`), and D-6 forbids the emitter from referencing any global
  type, so shadowing is harmless and **no escape is needed for global names**. The spec's Assumptions
  said they would be escaped; that was written before the probe and is withdrawn (W-2).
- `type string = …`, `type undefined = …`, `type never = …`, `type unknown = …` are refused (*Type
  alias name cannot be …*); `type default = …`, `type class = …` are parse errors; `type my-type = …`
  is a parse error. These need the escape.
- §9.1's `Ident` grammar is `[A-Za-z_][A-Za-z0-9_-]*`, so a type name that can be *referenced* is
  ASCII and the only characters needing escape are `-` and reserved-word collisions. A `types:` entry
  may be *declared* under any name (`typeName` is unpatterned, `meta/cascata.meta.yaml:80-89`), but an
  unreferenceable declaration emits nothing a usage points at; D-6 escapes it anyway.
- Boundary: a bigint literal type of `2^1024` compiles; a 64-deep nested object type compiles and its
  literal typechecks; `readonly (string | bigint)[]` and `string | readonly string[]` parse with the
  precedence the emitter needs; `1 | 1` dedupes silently.
- `null` against `string` fails, confirming FR-018's premise from the compiler's side as well as the
  validator's.

## F-6. Semantics that decide emitted types, verified in the validator

- `type: string` refuses an explicit `null`: `matchesBuiltinLeaf` (`check.ts:161-181`) has `null` as
  its own case; the only key-level escape is absence (`check.ts:573`). Not directly tested under a
  bare `type: string`; `validate-types/array-union` proves `null` is an opt-in alternative and
  `validate-required/explicit-null` proves `required` refuses it.
- `enum` members are any node (`vocabulary.ts:482-485` checks only that it is a sequence; `checkEnum`
  uses `nodesEqual`), `type` is not required beside `enum` (`validate-single-layer/enum-member`), and
  kind is part of membership (`T017c-enum-kind-distinct`). No fixture has a non-scalar member.
- A key with no demand, or a demand with no `type`, projects faithfully (`numeric-projection.test.ts:139-153`).
- Built-ins: `typeexpr.ts:60` — nine names, closed. `mapping`/`sequence` are container assertions
  only; built-ins win over declarations (`types.ts:283-292`).
- `seal: closed` is enforced locally per layer (`check.ts:856-909`), so the accumulated allowed set is
  the intersection of every closing layer's `keys` — proven by `seal/weaken-closed-to-open`. `values`
  never adds to the allowed set (`values.test.ts:195`).
- `provide` accepts any node (`merge/strategy.ts:63-64`); `final` records presence only
  (`merge/final.ts:126-127`); every `final` fixture provides a string; `provide` cannot be written at
  a nested position (`check.ts:993-998`).
- `keys` + `values` compose by intersection with no precedence (`T003b-values-keys-compose`).
- The validate corpus: 104 descriptors, **38 with `ok: true`**; the rest refuse.

## D-1. The tree is a third walk, in `src/generate/accumulate.ts`, and it introduces the typed demand record

Not a side channel on `check.ts` (F-1 and 009's D-3 both say why) and not an extension of
`numeric.ts`, whose contract is "per pointer of a concrete document". A value-free recursive descent
over every schema layer's `keys:` (and top-level `seal`), reading demands through a new
`ParsedDemand` record exported from `src/validate/vocabulary.ts` — one typed reader replacing the
hand re-reads, additive, with `refuseMalformedShapes`'s `switch` as its specification. The existing
readers keep their signatures; `numeric.ts` and `check.ts` are not migrated in this milestone (a
migration would touch every validation path at the first release after the freeze, for no
behavioural gain; it is recorded as follow-up).

The walk memoizes on `(set of declarations being intersected, structural depth, type hops)` — the
same discipline 009 D-1 gave `checkNamedType`, with the value dimension dropped — so the `keys`+`values`
composition over one shared type is polynomial (FR-006), and guarded recursion is represented as a
**reference** to a declaration set rather than unrolled (FR-005).

## D-2. Intersection, per keyword, and what a named type becomes

As Article VIII states, with three things the article leaves to the implementation:

- **A `type` intersection is over canonical alternatives.** `parseTypeExpression` already yields a
  deduped, sorted `(name, depth)` set. `A[] ∩ B[]` is `(A ∩ B)[]`; alternatives of unequal depth do not
  intersect; a built-in intersects with itself only, except that the numeric class is decided by the
  existing `Admission` lattice (D-3), so `int ∩ (int | float)` is `int`.
- **A name intersects by body.** Two references to the *same* declaration are that declaration. Two
  different declarations (a narrowing chain, §7) intersect body-with-body, and the result is an
  anonymous accumulated position, **emitted inline** with a JSDoc naming both declarations. It is not
  emitted as `A & B` — F-2 shows why an alias intersection can be `never` where the semantic
  intersection is not. Where recursion re-enters a set of two or more declarations, the emitter
  synthesizes one alias for that set, named from the qualified names joined by `_and_`,
  deterministically. Rare; pinned by a case.
- **`enum` intersects under `nodesEqual`**, and an `enum` restricts the position's *emission* to its
  literals only when every surviving member is a scalar; otherwise the accumulated type is emitted
  and the members go to JSDoc.

`required` and `provided` are recorded as two booleans; the emitter ORs them into optionality
(FR-010). `final` with a scalar `provide` records the constant node.

## D-3. The numeric class reuses `numeric.ts`'s lattice, exported

`Admission`, `union`, `intersect`, `admissionOfDemand`, and `admissionOfName` become exports of
`src/validate/numeric.ts` (additive). The tree carries the accumulated `Admission` at every position
whose type mentions a number, and the emitter asks §17's one question. This is what guarantees FR-016:
`project()` and `generate()` cannot disagree because they run the same function over the same
declarations — the oracle (D-7) is the proof rather than the mechanism.

## D-4. The emitter is a printer; no `typescript` at runtime

`src/generate/emit.ts` walks the tree and writes text. Named declarations become `export type`
aliases; the root becomes `export type <Root> = …`. Every property is `readonly`; every array is
`readonly T[]`; unions are parenthesized inside arrays. No global type is ever referenced —
`Readonly<>`, `Record<>`, `Array<>` are never written — so shadowing (F-5) cannot bite. JSDoc is
emitted per property in a fixed order (constraint, then declaring layer), so the text is
deterministic. `typescript` is imported only under `tests/`.

## D-5. `generateTypes()` launches from a schema, so the entry document is a schema layer

`resolve()` treats its entry as the configuration. For the generator the entry *is* the leaf schema.
`generateTypes()` therefore resolves the schema location as the entry, then builds the layer list
from the pedigree **plus the entry document itself as the leaf schema layer** (rank = pedigree
length). The reserved `$`-keys are not stripped, because nothing here folds; the vocabulary readers
read `types:`/`keys:`/`seal` and ignore the rest.

A schema the language refuses must not be emitted from (FR-030). The closed-vocabulary pass that
`validate()` runs before any value check — unknown keywords, malformed shapes, unresolved or cyclic
types, malformed sections — is run over the layers first; `check.ts`'s per-layer vocabulary problems
become reachable through one exported function, additive. `generateTypes()` lives beside `load()` in
`src/index.ts`, because it needs `resolve()`; the pure stage (`accumulate`, `generate`) lives in
`src/generate/` and is also the `cascata/generate` entry point (FR-032).

## D-6. Identifier rules, fixed by the probe

- **Property names.** Emitted bare iff they match `[A-Za-z_$][A-Za-z0-9_$]*`; otherwise quoted,
  verbatim, with the string escaped as a TypeScript string literal. Non-ASCII keys are therefore
  quoted although bare would compile (F-5): an ASCII rule needs no Unicode tables and cannot drift
  with the compiler's identifier definition.
- **Alias names.** Emitted bare iff the name matches the same ASCII pattern **and** is not on the
  fixed list of names TypeScript refuses as alias names (the predefined type names — `string`,
  `number`, `bigint`, `boolean`, `symbol`, `object`, `any`, `unknown`, `never`, `undefined`, `void`,
  `null` — and the ECMAScript reserved words, `default` and `class` among them). Otherwise the alias is
  `$` followed by the name with every character outside `[A-Za-z0-9_]` replaced by `_`. `$` never
  begins a §9.1 identifier, so an escaped name can never collide with a bare one; two *escaped* names
  can collide (`a-b`, `a_b`), and that is FR-026's generator error.
- **Qualified aliases.** Where a chain declares a name more than once, every declaration is emitted
  as `<qualifier>_<name>` (the qualifier being §7's, escaped by the same rule); where two declaring
  layers share a qualifier, `<qualifier>_<rank>_<name>`.
- **No escape for global names** (`Object`, `Record`, …): a module-scope alias shadows them and the
  emitter references none (D-4).

## D-7. The oracle: literals, in memory, over the whole validate corpus

`tests/unit/generate-oracle.test.ts`. For each descriptor in `tests/corpus/validate-cases/`: resolve
and merge the case as the corpus runner does; `generateTypes()` from the leaf schema (the config's
`$schema` target); `project()` the configuration; write the value as a TypeScript literal (`bigint` as
`<digits>n`, strings as JSON strings, `null`, arrays, objects with every key quoted); typecheck
`const x: <Root> = <literal>` against the emitted source with `ts.createProgram` in memory, `strict`,
`lib: ["lib.es2022.d.ts"]`.

- Positive: every `ok: true` case must compile; the count of such cases is asserted (38 at HEAD, so a
  runner that silently skips fails).
- Negative: every case whose **every** expected diagnostic has a type-shaped code — `type-mismatch`,
  `required-violated`, `seal-violation`, `enum-violated` — must fail to compile. A case mixing a
  type-shaped refusal with a range refusal is neither asserted nor skipped silently: it is listed, with
  its reason, in the test's own table.
- The meta-schema: `generateTypes(meta/cascata.meta.yaml)` against `project()` of the meta-schema
  loaded as a config of itself (the shape `metaValidate()` already builds).
- The literal writer is checked on one hand-written pair (a value and the text it must produce).
- Sabotage (FR-037): swap the numeric emission; the meta-schema case has `int`-demanded positions
  (`min`, `max`) so it goes red, and at least one corpus case with a numeric demand goes red.

Cost: the corpus runs the compiler ~100 times. Measured in 009's spirit before the number is written
down: a `createProgram` over one small file with the ES2022 lib takes on the order of a second cold
and tens of milliseconds warm when the lib source files are shared across programs; the harness
shares a `CompilerHost` and its parsed lib across cases.

## D-8. The `ts` lane of the doc-examples sweep

A fenced ```` ```yaml ```` block **immediately** followed by a fenced ```` ```ts generated ```` block is
a pair: the YAML is a single-layer schema, the `ts` block is what `generate()` must produce for it,
byte for byte after trimming. The `generated` info-string word is the marker (spec Assumptions); a
`ts` block without it is not compared. The existing sweep's structure is kept: a count floor, one
`it()` per pair, a synthetic-mismatch meta-test proving the lane can fail. `README.md`'s new
`generate` section is the first pair.

## D-9. Positions in the tree are structural, not pointers

`values` and `items` have no RFC 6901 spelling. The tree is a tree — a position is a node with a
`keys` map, an optional `values` child, an optional `items` child — and the only pointers that appear
anywhere are the **demands' own pointers in their own layers**, which are real. A diagnostic from this
stage (the empty-intersection lint) therefore carries `demand: { pointer, span }` for *both* demands,
and a `related` span for the second, with no invented wildcard syntax (§10: do not invent a path
syntax).

## The warts in Article VIII

- **W-1. A closed mapping with no declared keys.** The table says "no index signature", which for the
  empty case emits `{}` — a type that admits every non-nullish value (F-4). Correct emission is
  `{ readonly [key: string]: never }`. The article's row needs a **correction**: "no index signature
  where keys are declared; `never` where none are".
- **W-2. The Assumption that global-named aliases are escaped is withdrawn.** F-5: module-scope
  aliases shadow harmlessly and the emitter references no global. Not an article defect; the spec's
  own Assumptions carry the reversal.
- **W-3. Closedness is enforced only on object literals.** The article promises `seal: closed`
  suppresses the index signature; TypeScript checks excess properties only on literals (F-3). The
  contract states the limit; the article should add one clause: "as far as the host type system
  enforces it, which is at object literals". A correction.
- **W-4. `generateTypes()`'s entry document.** The article says it "treats every document it reaches
  as a schema layer"; `resolve()`'s entry is by definition the config. D-5 relabels it. The article is
  right about the outcome and silent about the mechanism; no change needed, recorded so the
  implementer does not reopen it.
- **W-5. The lint's code.** Article VIII mandates the empty-intersection lint and names no code.
  Proposed `demand-unsatisfiable`, `info`. A second new code, `emit-identifier-collision`, `error`,
  for FR-026. Both go to `SPEC.md`'s diagnostic catalogue via the README, as every milestone's codes
  have.
- **W-6. The article's identifier clause says "non-ASCII included" for quoting** and says nothing
  about type names, which §9.1 already restricts to ASCII. Consistent, but the article's probe-gate
  concern about non-ASCII *type* names is unreachable through a type expression. Recorded, no change.
