# Feature Specification: The Accumulated Demand, and the TypeScript Type Generator

**Feature Branch**: `010-type-generator` *(spec directory; no separate git branch created)*

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "v1.1 — the accumulated demand, and the TypeScript type generator. A
value-free stage that intersects every schema layer's demands per position, a TypeScript emitter
that writes the tree as declaration text, the one-call `generateTypes()`, soundness against the
validator as the conformance oracle, and a `ts` lane in the doc-examples sweep."

**Implements**: `SPEC.md` **Article VIII (§18)** in full; §14 item 9; §17's rule that the
accumulated demand decides the numeric type and that an undemanded key is `unknown`; §5.5's
guaranteed-key pattern as a non-optional property; §7's per-layer resolution of named types and its
qualifier; §9's closed vocabulary.

**Builds on**: v1.0's `project()` and `load<T>()` (specs/009) most directly — this milestone is what
makes `T` derivable instead of guessed. Also v0.5's type resolution, v0.7's `values`, `seal` and
guarded recursion, and the meta-schema, which is the first non-trivial subject the generator has.

**This is the first milestone under the freeze.** `SPEC.md` Article VIII was added as an addition:
nothing a schema meant before it means anything else after it. This milestone MUST keep that true —
every existing test stays green unweakened, `load<T>()` stays an unchecked claim, and the emitted
mapping ships as the compatibility promise Article VIII says it is. Where the article and the code
disagree, report the disagreement; do not quietly pick.

## User Scenarios & Testing *(mandatory)*

The user is **the tool developer** again — §1's first consumer, who at v1.0 received a value and had
to *say* its type. The organization behind them wants the house standard's shape to be what the
application compiles against, five layers down. The config author must remain unable to reach the
application's types by choosing punctuation, which §17 settled and this milestone must carry into the
emitted text.

### User Story 1 - The accumulated demand is a stage of its own (Priority: P1)

Every schema layer's demands, intersected per position, resolved per layer, with no document in hand.

**Why this priority**: it is the artifact. Article VIII makes both emitters translations of this
tree; if the tree is wrong, every emitted type is wrong the same way, and if it is right, the TypeScript
emitter is a small function. §17's numeric rule has been reading one slice of this tree since v1.0,
so the shape is known; what does not exist is the value-free walk.

**Independent Test**: two schema layers, a root demanding `type: string | string[]` and a house
narrowing it to `type: string[]`, accumulated with no config; confirm the position carries exactly
`string[]`.

**Acceptance Scenarios**:

1. **Given** the schema layers of a chain, root to leaf, **When** accumulated, **Then** the result is
   a tree keyed by position, each position carrying the intersection of every demand any layer places
   there, and **no configuration is consulted or required**.
2. **Given** a `type` demanded by two layers, **When** accumulated, **Then** the alternatives intersect
   alternative by alternative at equal array depth, and a named alternative intersects by the body it
   resolves to **in the scope of the layer that used it** (§7): a root demanding `resource[]` and a
   house that narrowed `resource` without restating the key still yields the root's `resource` at the
   root's demand, exactly as §7's worked narrowing says validation does.
3. **Given** `keys` in two layers naming different children, **Then** the accumulated `keys` is the
   union of the names, and each name's demand is the intersection of what named it.
4. **Given** `values` or `items` in two layers, **Then** they intersect. Positions are shapes: `values`
   denotes every entry and `items` every element, not the entries and elements of some document.
5. **Given** `required: true` in any layer, **Then** the position is required. **Given** a `provide` in
   any layer, **Then** the position is recorded as provided. The two are recorded separately; the
   emitter, not the tree, decides what optionality means.
6. **Given** `enum` in two layers, **Then** the accumulated `enum` is their set intersection under
   §4.2's equality (kind included: `1` and `1.0` are different members).
7. **Given** `min`/`minLength` in two layers, **Then** the larger bound; `max`/`maxLength`, the smaller;
   `pattern`, both, as a conjunction; `accept`, the intersection of alternatives; `seal`, `closed` if
   any layer closes the position.
8. **Given** two demands at one position that admit no common value (`string` and `int`), **When**
   accumulated, **Then** the position is recorded as **empty** and an **info**-level diagnostic (§10)
   names both demands, their layers, and their pointers. Whole-chain validation already refuses every
   value there; this is the first time the contradiction is visible with no value to trip over it.
9. **Given** a guarded recursive type (the meta-schema's `demand`), **When** accumulated, **Then** the
   walk terminates and the recursion is represented as a reference, not unrolled. **Given** an
   unguarded cycle, **Then** it never reaches this stage — v0.5's refusal stands, and a case asserts
   it still fires.
10. **Given** the stage, **When** this milestone completes, **Then** it is reachable **without any
    emitter** (Principle IV), and a second emitter could be written against it without touching it.
11. **Given** the same schema layers, **When** accumulated twice, or in a different order of
    declaration within a layer, **Then** the tree is identical: intersection is commutative and the
    walk is deterministic.

### User Story 2 - Shapes emit as object types (Priority: P2)

`keys`, `values`, `items`, `seal`, and optionality, per Article VIII's mapping table.

**Why this priority**: shapes are most of what a consumer reads, and optionality is where §5.5's
promise ("a real promise to the consuming application") has been waiting since v0.3.

**Independent Test**: a schema with a `required` key, a provided key, and a plain key; confirm the
emitted object type marks the first two non-optional and the third optional.

**Acceptance Scenarios**:

1. **Given** an accumulated `keys`, **When** emitted, **Then** an object type whose every property is
   `readonly`.
2. **Given** a key `required` in any layer, **or** provided in any layer, **Then** a non-optional
   property; otherwise an optional one (`?`). A key satisfied by a `provide` is present after merge
   whatever the config does, and the emitted type MUST say so.
3. **Given** `values: D`, **Then** an index signature `readonly [key: string]: D`.
4. **Given** `keys` and `values` on one mapping, **Then** both appear, and a key named by `keys` has
   the intersection of its own demand and `D` — the same composition §9 gives validation.
5. **Given** `seal: closed` in any layer at a position, **Then** **no** index signature is emitted
   there; **Given** no layer closes it, **Then** an index signature of `unknown` is emitted, because
   §17 says an undemanded key is `unknown` and an open mapping admits undemanded keys.
6. **Given** `items: D`, **Then** `readonly D[]`; **Given** a type expression `T[]`, **Then**
   `readonly T[]`; **Given** `(a | b)[]`, **Then** `readonly (A | B)[]` with the parenthesization
   TypeScript needs.
7. **Given** a schema's top-level `keys:` and top-level `seal`, **Then** the root type is the object
   type of the config's top level, governed by the same two rules.
8. **Given** a key whose name is not a valid ECMAScript identifier — `my-key`, `città`, `10`, an emoji,
   `__proto__`, `constructor` — **Then** it is emitted as a **quoted** property name, verbatim, and the
   emitted text typechecks. Non-ASCII keys MUST have their own cases (Principle V's probe gate).

### User Story 3 - Leaves emit as the types §17 promised (Priority: P3)

The numeric rule, unions, `null`, `enum` literals, and the pinned constant.

**Why this priority**: it is where the freeze bites hardest — every leaf mapping is a permanent
promise — and where the one design that suggests itself is unsound.

**Independent Test**: a root demanding `int | float` and a house narrowing to `int`; confirm the
emitted type is `bigint`, not `number` and not `never`.

**Acceptance Scenarios**:

1. **Given** an accumulated demand admitting `float`, **Then** `number`; **Given** one admitting `int`
   but not `float`, **Then** `bigint`; decided from the **accumulated** demand exactly as `project()`
   decides it, so that the emitted type and the projected value never disagree.
2. **Given** `string`, `url`, or `path`, **Then** `string`. **Given** `bool`, `null`, **Then**
   `boolean`, `null`.
3. **Given** a union in a type expression, **Then** a TypeScript union of the alternatives' emissions.
4. **Given** `type: string` with no `null` alternative, **Then** the emitted type carries **no**
   `| null` and **no** `| undefined`: `type: string` refuses an explicit `null` (§4.2), and optionality
   is the property's, never the value's.
5. **Given** an `enum` whose members are all scalars, **Then** a literal union, kind-aware under the
   numeric rule: `1n` where the position is `bigint`, `1` where it is `number`, `"a"`, `true`, `null`.
   **Given** any non-scalar member, **Then** the accumulated type, with no literal.
6. **Given** `final: true` with a scalar `provide`, **Then** the literal type of that constant.
   **Given** a non-scalar `provide`, **Then** the accumulated type.
7. **Given** no demand at a position that some layer nevertheless provides, **Then** a non-optional
   property of type `unknown`. **Given** no demand and no `provide`, **Then** the key does not appear
   as a property at all; the open index signature covers it.
8. **Given** an empty intersection (US1 scenario 8), **Then** `never`.
9. **Given** `min`, `max`, `minLength`, `maxLength`, `pattern`, `accept`, **Then** **no** change to the
   type and a JSDoc comment on the property naming each constraint and the layer that declared it.
   The comment's presence and wording are **not** part of the compatibility promise, and the contract
   says so.

### User Story 4 - Named types emit as named aliases (Priority: P4)

`types:` entries, narrowing across layers, qualifiers, guarded recursion.

**Why this priority**: it is what makes the emitted text readable rather than merely correct, and it
is where §7's per-layer resolution has a visible consequence.

**Independent Test**: the meta-schema's six named types, emitted; confirm `demand` is a recursive
alias that TypeScript accepts.

**Acceptance Scenarios**:

1. **Given** a `types:` entry declared once in a chain, **Then** one `export type` alias carrying its
   bare name, and every usage refers to it by name.
2. **Given** one name declared by two layers of a chain (a narrowing, §7), **Then** **every**
   declaration is emitted, each prefixed with §7's qualifier (the last non-empty segment of its
   declaring document's `$id`), and each usage refers to the declaration §7 resolves it to. No
   declaration is privileged; a bare name appears only where the chain declares it once.
3. **Given** two declaring layers whose qualifiers coincide, **Then** the escape rule in the contract
   distinguishes them by layer rank, deterministically, and a case pins the spelling.
4. **Given** a type name that is a valid identifier and not a TypeScript reserved word, **Then** it is
   emitted verbatim. **Given** any other, **Then** the contract's escape rule applies, the same input
   always escaping the same way. Non-ASCII type names MUST have their own cases.
5. **Given** two names that escape to one identifier, **Then** a generator **error** diagnostic, never
   a silent rename.
6. **Given** a guarded recursive type, **Then** a recursive alias TypeScript accepts, and the
   meta-schema's own `demand`/`nestedKeyDecl` pair is the pinned case.
7. **Given** a type's `accept` and a usage's `accept`, **Then** the emitted type reflects the narrowed
   set of alternatives where alternatives have distinct emissions, and carries the selector in JSDoc
   otherwise (`url` and `path` both emit `string`, so `accept: [url]` is a comment, not a type).

### User Story 5 - One stage, one call (Priority: P5)

`generate()`, `generateTypes()`, and the `./generate` entry point.

**Why this priority**: it is the embedding surface, and it sits on everything above.

**Acceptance Scenarios**:

1. **Given** an accumulated tree, **When** `generate()` is called, **Then** it returns TypeScript
   declaration text and diagnostics, performs **no I/O**, and the caller decides where the text goes.
2. **Given** a schema location, **When** `generateTypes()` is called with a host, **Then** it resolves
   that schema as the launching point, treats **every** document it reaches as a schema layer (no
   config exists in this walk), accumulates, generates, and returns `{ ok, source, diagnostics }` —
   or `{ ok: false, diagnostics }` for any refusal, never both, never a throw for a fact about the
   world (Article VI).
3. **Given** a root type name option, **Then** the emitted root alias carries it; **Given** none,
   **Then** a default derived from the leaf schema's `$id` qualifier, else `Configuration`.
4. **Given** the package, **Then** `cascata/generate` is an entry point declared like `cascata/host/node`
   (extensionless and `.js` alias), and importing the package root still cannot touch a disk.
5. **Given** the layering test, **Then** `src/generate/` is in its policed set: it may import
   `validate/` and `model/`, and may not import adapters, `resolve/`, or `host/`.
6. **Given** `load<T>()`, **When** this milestone completes, **Then** it is **unchanged**: `T` is the
   caller's claim and the library checks nothing — `tests/unit/load-typed.test.ts`'s pin stays green.

### User Story 6 - Soundness is the conformance rule, and the validator is the oracle (Priority: P6)

Every configuration validation accepts inhabits the type generated from its schema chain.

**Why this priority**: it is what makes the emitted type *true* rather than plausible, and it is the
milestone's answer to Principle V — the expected outputs are derived, never written by hand from the
generator's own output.

**Independent Test**: one existing corpus case with `ok: true`; generate its chain's type, project its
config, typecheck the projected value against the type in memory; confirm it compiles.

**Acceptance Scenarios**:

1. **Given** every validate-corpus case whose expected outcome is `ok: true`, **When** its schema chain
   is generated and its configuration projected, **Then** the projected value, written as a
   TypeScript literal (`bigint` as `1n`), typechecks against the emitted root type. Every such case,
   not a sample; the count asserted.
2. **Given** every validate-corpus case refused for a **type-shaped** reason — `type-mismatch`,
   `required-violated`, `seal-violation`, `enum-violated` — **Then** its projected value does **not**
   typecheck against the emitted type.
3. **Given** a case refused for a range, length, or pattern, **Then** it MAY typecheck, and the
   contract says why: TypeScript has no type for those and JSDoc is the honest substitute.
4. **Given** `meta/cascata.meta.yaml`, **When** its type is generated from itself and its own document
   projected, **Then** the projection typechecks against the type. Self-hosting extended to the type
   surface.
5. **Given** the oracle, **When** the generator's numeric emission is sabotaged (`bigint` swapped for
   `number`), **Then** the meta-schema case or a corpus case goes red. The oracle MUST be proven able
   to fail.
6. **Given** the oracle, **Then** it runs with no new runtime dependency: the TypeScript compiler is
   already a development dependency and is invoked in memory, no file written.

### User Story 7 - Documentation is executed (Priority: P7)

The `ts` lane, and the derived-artifact sweep.

**Why this priority**: it certifies the rest, and this project's staleness has always landed in
derived artifacts first.

**Acceptance Scenarios**:

1. **Given** the doc-examples sweep, **When** extended, **Then** every fenced `ts` block that follows a
   `yaml` schema block in `README.md`, `SPEC.md`, or `specs/**/*.md` and is marked as generated output
   is compared to the generator's actual output for that schema, and a mismatch fails.
2. **Given** the sweep, **Then** at least one such pair exists, the count is asserted, and the sweep's
   own sensitivity is proven on a synthetic mismatch.
3. **Given** `README.md`, **Then** it gains a v1.1 row and a `generate` section whose example is one of
   the executed pairs. **Given** `CLAUDE.md`, **Then** the layering rule names `generate/`.
4. **Given** `package.json`, **Then** its version is `1.1.0`.

### Edge Cases

- **An empty `keys: {}`** — an object type with no properties, plus whatever the seal decides.
- **`seal: closed` with no `keys` at all** — the object type `{}` with no index signature: a mapping
  that admits nothing. Legal, and the type should say so.
- **A key named `__proto__`, `constructor`, `default`, `class`** — quoted property names; the
  emitted text must still be a valid declaration file.
- **A type named `Object`, `Record`, `Array`, `string`** — the last is impossible (built-ins cannot
  be redeclared, v0.5); the others are legal Cascata names and must not shadow TypeScript's globals
  inside the emitted file, or must be escaped. Which, is the contract's to say.
- **A key equal to a generated alias name** — a property and a type live in different namespaces;
  confirm nothing collides.
- **An `enum` under `int | float` whose members include `1` and `1.0`** — both project to `number`
  `1`; the literal union is `1`, once. Is that a loss of information the contract should name?
- **An `enum` with `2n ** 64n` as a member** — the literal is `18446744073709551616n`; TypeScript
  accepts bigint literals of any magnitude.
- **A 64-deep `keys` nest** — inside §11's cap; the emitted type nests 64 levels and must still
  typecheck.
- **`values` whose demand is itself `values`** — an index signature whose value is an index signature.
- **A `provide` at a key with no demand whose provided value is a mapping** — `unknown`, per §17; the
  provided shape is not consulted.
- **A `$id` with no `/`** — the qualifier is the whole `$id`; **a `$id` that is a URL** — the last
  path segment, per §7; **a `$id` whose last segment is not an identifier** — the escape rule.
- **A chain of one layer** — no intersection happens; the tree is that layer's demands.
- **A chain where the leaf schema declares nothing** — the tree is the ancestors' demands; the root
  type name still derives from the leaf's `$id`.
- **A schema layer that fails validation itself** (unknown demand keyword) — `generateTypes()` refuses
  with the validator's own diagnostics; the generator never emits from a schema the language rejects.

## Requirements *(mandatory)*

### Functional Requirements

**The accumulated demand** (Article VIII, §5.1, §7)

- **FR-001**: `accumulate()` MUST take the schema layers of a chain, root to leaf, and return a tree
  keyed by position carrying, at every position, the intersection of every demand any layer places
  there. No configuration MUST be required or consulted.
- **FR-002**: A named type MUST be resolved in the scope of the layer that used it, per §7: an
  ancestor's demand resolves the ancestor's declaration regardless of any descendant's redeclaration.
- **FR-003**: Intersection MUST be defined per keyword exactly as Article VIII states: `type`
  alternative-wise at equal depth; `keys` by union of names and intersection per name; `values` and
  `items` by intersection; `required` by OR; `provide` presence by OR, recorded separately from
  `required`; `enum` by set intersection under `nodesEqual`; `min`/`minLength` by the larger bound,
  `max`/`maxLength` by the smaller; `pattern` by conjunction; `accept` by set intersection; `seal`
  closed if any.
- **FR-004**: An empty intersection MUST be recorded as such and MUST emit an **info** diagnostic
  carrying both demands' pointers, spans, and declaring layers, under a new code named in the contract.
- **FR-005**: The walk MUST terminate on guarded recursion by emitting a reference rather than
  unrolling, and MUST never be reached by an unguarded cycle; a case MUST assert v0.5's refusal still
  fires ahead of it.
- **FR-006**: The walk MUST be bounded by the same memo discipline v1.0 gave the value walk: where
  `keys` and `values` both recurse into one shared type, the work MUST be polynomial in depth, and a
  ratio test across depths MUST establish it.
- **FR-007**: The tree MUST be deterministic: identical layers yield an identical tree, and a case MUST
  assert that reordering a layer's declarations changes nothing.
- **FR-008**: The stage MUST be reachable without any emitter (Principle IV).

**Shapes** (Article VIII, §9, §5.5)

- **FR-009**: `keys` MUST emit an object type whose every property is `readonly`.
- **FR-010**: A property MUST be non-optional iff some layer declares `required: true` **or** some
  layer provides it; otherwise optional. A case MUST pin each of the three: required, provided,
  neither.
- **FR-011**: `values: D` MUST emit `readonly [key: string]: D`; where `keys` and `values` both apply,
  a named key's type MUST be the intersection of its own demand and `D`.
- **FR-012**: `seal: closed` in any layer MUST suppress the index signature; otherwise the index
  signature MUST be `unknown`.
- **FR-013**: `items: D` and `T[]` MUST emit `readonly D[]` / `readonly T[]`, parenthesized where
  precedence needs it.
- **FR-014**: A schema's top-level `keys:` and top-level `seal` MUST govern the root type by the same
  rules as any nested mapping.
- **FR-015**: A key that is not a valid ECMAScript identifier MUST be emitted as a quoted property name,
  verbatim. Cases MUST include at least one non-ASCII key, one array-index key (`10`), `__proto__`,
  and `constructor`.

**Leaves** (Article VIII, §17, §4.2)

- **FR-016**: The numeric class MUST be decided from the accumulated demand by §17's rule — admits
  `float` ⇒ `number`; admits `int`, not `float` ⇒ `bigint` — and MUST agree with `project()` on every
  corpus case (US6 is the proof).
- **FR-017**: `string`, `url`, `path` ⇒ `string`; `bool` ⇒ `boolean`; `null` ⇒ `null`; a union ⇒ a
  union.
- **FR-018**: A `null` in the emitted type MUST come only from a `null` alternative; `undefined` MUST
  never appear in a property's own type. *Amended post-implementation:* an index signature beside an
  optional sibling carries `undefined`, because TypeScript requires the index type to subsume its
  siblings; the original wording forbade what the compiler requires (Phase 9 T048, `SPEC.md` §18
  corrected).
- **FR-019**: An `enum` of scalars MUST emit a kind-aware literal union following the position's
  numeric class; any non-scalar member MUST yield the accumulated type with no literal.
- **FR-020**: `final: true` with a scalar `provide` MUST emit that constant's literal type; a non-scalar
  `provide` MUST yield the accumulated type.
- **FR-021**: A position with no demand MUST emit `unknown`; a provided-but-undemanded key MUST appear
  as a non-optional `unknown` property; an undemanded, unprovided key MUST NOT appear as a property.
- **FR-022**: An empty intersection MUST emit `never`.
- **FR-023**: `min`, `max`, `minLength`, `maxLength`, `pattern`, and `accept` MUST NOT change the type
  and MUST be emitted as JSDoc naming the constraint and its declaring layer; the contract MUST state
  that JSDoc is not part of the compatibility promise.

**Named types** (Article VIII, §7)

- **FR-024**: A type declared once in a chain MUST emit one alias with its bare name.
- **FR-025**: A name declared by more than one layer MUST emit every declaration, each prefixed by
  §7's qualifier; a bare name MUST appear only where the chain declares it once; coinciding qualifiers
  MUST be distinguished by layer rank under a rule the contract states.
- **FR-026**: A type name that is a valid identifier and not a TypeScript reserved word MUST be emitted
  verbatim; any other MUST be escaped by the contract's deterministic rule. Two names escaping to one
  identifier MUST be a generator **error**.
- **FR-027**: Guarded recursion MUST emit a recursive alias TypeScript accepts; the meta-schema's
  `demand` MUST be a pinned case.
- **FR-028**: A type's own `accept` and a usage's `accept` MUST narrow the emitted alternatives where
  alternatives have distinct emissions and MUST appear in JSDoc otherwise.

**Surface** (Article VIII, Article VI, Principle IV)

- **FR-029**: `generate()` MUST take an accumulated tree and return `{ source, diagnostics }` with no
  I/O.
- **FR-030**: `generateTypes(schemaLocation, options)` MUST resolve a schema as the launching point,
  treat every document reached as a schema layer, accumulate, generate, and return
  `{ ok: true, source, diagnostics } | { ok: false, diagnostics }`; a refusal MUST be a diagnostic and
  MUST NOT throw; a schema the validator refuses MUST be refused with the validator's diagnostics.
- **FR-031**: The root alias name MUST be the caller's option, else the leaf `$id`'s qualifier, else
  `Configuration`.
- **FR-032**: `cascata/generate` MUST be a package entry point declared like `cascata/host/node`;
  `src/generate/` MUST join the layering test's policed set with the imports US5 scenario 5 states.
- **FR-033**: `load<T>()` MUST be unchanged; `tests/unit/load-typed.test.ts` MUST stay green as
  written.

**Soundness** (Article VIII, Principle V)

- **FR-034**: For every validate-corpus case expecting `ok: true`, the projected configuration written
  as a TypeScript literal MUST typecheck against the generated root type, in memory, with the count of
  cases asserted.
- **FR-035**: For every validate-corpus case refused solely for `type-mismatch`, `required-violated`,
  `seal-violation`, or `enum-violated`, the projected configuration MUST fail to typecheck **where the
  refused property is expressible as a type**; the cases where it is not (`url`/`path` refinements;
  `required` at a position whose type is `unknown`) MUST be listed by name in the oracle, never
  skipped; a case refused for range, length, or pattern MAY pass, and the contract MUST say so.
  *Amended post-implementation:* seven of twenty-two type-shaped refusals typecheck, and the original
  wording asserted none would (`SPEC.md` §18 corrected).
- **FR-036**: `meta/cascata.meta.yaml` projected MUST typecheck against the type generated from itself.
- **FR-037**: The oracle MUST be proven able to fail: a sabotage of the numeric emission MUST turn at
  least one case red, and the report MUST say which.
- **FR-038**: No new runtime dependency. The TypeScript compiler is a development dependency and MUST
  be invoked in memory only.

**Documentation** (§15, Principle I)

- **FR-039**: The doc-examples sweep MUST gain a `ts` lane comparing generated output to fenced
  blocks marked as such, with its count asserted and its sensitivity proven.
- **FR-040**: `README.md` MUST gain a v1.1 row and a `generate` section; `CLAUDE.md` MUST name the
  `generate/` layering rule; every contract under `specs/` that mentions the generator as future MUST
  be swept.
- **FR-041**: `package.json`'s version MUST be `1.1.0`.

**Invariants**

- **FR-042**: No existing test is weakened.
- **FR-043**: `pnpm typecheck` clean; no `any`; no assertion casts on the node model.
- **FR-044**: All seven constitution gates hold, the layering and host boundaries included.

### Key Entities

- **The accumulated demand** — per position, the intersection of every layer's demands, named types
  resolved per layer; a tree, value-free, the artifact both emitters translate.
- **The emitted type** — TypeScript declaration text; each row of Article VIII's mapping is a promise.
- **The empty-intersection lint** — an info diagnostic naming two demands that admit no common value.
- **The soundness oracle** — every accepted configuration inhabits its generated type; the validator
  decides, the generator obeys.

## Success Criteria *(mandatory)*

- **SC-001**: A root demanding `int | float` and a house narrowing to `int` emit `bigint` — not
  `number`, not `never`.
- **SC-002**: A required key, a provided key, and a plain key emit non-optional, non-optional, and
  optional properties respectively.
- **SC-003**: A closed mapping emits no index signature; an open one emits `unknown`.
- **SC-004**: The meta-schema's projection typechecks against the type generated from the meta-schema.
- **SC-005**: Every `ok: true` validate-corpus case passes the soundness oracle; every case refused
  solely for a type-shaped reason fails it **except the seven a type cannot express, pinned by name**;
  all three counts are asserted.
- **SC-006**: Swapping `bigint` for `number` in the emitter turns the oracle red.
- **SC-007**: All 1039 pre-existing tests remain green, none modified in substance. If one must
  change, the report says which and why, and a passing suite achieved by relaxing an assertion is a
  failure of this criterion.
- **SC-008**: A `ts` block in `README.md` is diffed against the generator on every test run.
- **SC-009**: `package.json` reads `1.1.0`.

## Assumptions

- **The tree is a new intermediate, not an extension of the validator's walk.** The value walk in
  `check.ts` is fused with value checking and gated on the value's runtime type; the numeric collector
  exists precisely because a side channel on that walk was impossible. The accumulated demand needs
  its own walk, reusing the type-expression parser, the per-layer type resolution, and the vocabulary
  readers, and introducing a typed parsed-demand record where today every consumer re-reads a raw
  node map by hand.
- **A non-scalar `final provide` is untested today.** Every `final` fixture provides a string. The
  emitter's rule (accumulated type, no literal) is stated; the tree's rule (record it as provided)
  is stated; a case MUST be added rather than inferred.
- **The empty-intersection lint is a new diagnostic code.** Article VIII mandates the lint; the code's
  name is the contract's. It is an addition under §15.
- **`accept` narrowing is mostly invisible in TypeScript** because `url` and `path` both emit `string`.
  The type stays `string` and the selector goes to JSDoc; the JSON Schema exporter (v1.2) will be able
  to say more.
- **A type named like a TypeScript global (`Object`, `Record`) is escaped**, not emitted verbatim, so
  that the emitted file never shadows a global its own text relies on. The escape spelling is the
  contract's. If the implementer finds a cleaner rule, report it.
- **Non-ASCII identifiers are quoted rather than emitted bare**, even where ECMAScript would accept
  them, because quoting is always correct and bare emission depends on the consumer's compiler
  target. Type names, which cannot be quoted, are escaped. If this proves too conservative, report it.
- **The oracle typechecks a literal, not a runtime value**, because a projected `bigint` has no JSON
  form; the literal writer is part of the test harness, not the library, and is itself checked on a
  hand-written pair.
- **The doc-examples `ts` lane marks its pairs explicitly** (a fence info string the contract states),
  because not every `ts` block in the documentation is generator output.

## Out of Scope

- The JSON Schema exporter — v1.2, a second emitter over this milestone's tree.
- The static subsumption lint — v1.x; the empty-intersection lint is its first step, not the lint.
- Deriving a type for a *config* rather than a schema; `generateTypes()` launches from a schema only.
- Writing the emitted file anywhere; the caller does.
- Any CLI.
- Anything in §14's Future list.
