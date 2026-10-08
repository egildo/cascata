# Cascata — Schema-Governed Cascading Configuration

> Working title — rename at will. A lightweight TypeScript library for reasoning about configuration as **schema-governed, cascading, file-based data**. Format-agnostic by design (YAML first; JSON and TOML later), self-hosting, provenance-rich.

**Status:** v1.0 — implemented and frozen (§15's freeze rule). Corrections always; additions while no existing meaning changes; a changed meaning requires v2.0.

---

## 1. Motivation & Scope

**Cascata is a library a tool embeds to turn a folder of human-readable documents into one validated configuration object.** The tool names a **launching point**; the library walks the cascade from it, enforces every schema it finds along the way, resolves the resources those schemas describe, and returns an object that knows where each value came from — or refuses, naming the document, the line, and the rule that was broken.

Three consumers, each owed something different. The **tool developer** embeds it, and wants one call, a clean seam to the outside world (Article VI), and no surprises. The **organization** publishes a root schema, and wants its house standards to still be standards five layers down — a guarantee, not a convention. The **config author** writes two lines of YAML, and wants to be told, in their own file at their own line, exactly which rule they broke.

The mechanism is a cascade of ordinary documents, each **simultaneously data and contract**: a document can provide values, impose rules on descendants, and govern how descendants may extend it, all with the same vocabulary. Schema documents are just configs whose pedigree terminates in a meta-schema shipped with the library. The distinguishing property is **monotonicity** (§2.1): constraints only ever accumulate downward, so a descendant may refine what an ancestor demanded and can never weaken it. Every configuration library merges; that last clause is the one none of them offer, and it is what turns an organization's house standard from a convention into something enforced.

The ceremony is meant to stay small. `$schema:` in a config and `$adopts:` in a schema are the whole of it, and they buy the chain, the enforcement, and the answer to "where did this value come from".

Non-goals for v1: write-back of whole configurations (Article IX, v1.10, writes back one value at a time and no more), arbitrary computation in schemas (no template language, no user callbacks), the `extends` (fork) mode. **Remote delegation is not a non-goal** — it is gated: available only where the *host* supplies it and the *user* has opted in, never where a schema asks (§8.4, §11, Article VI). An earlier draft of this list called it a non-goal outright, which the delegation article and the security model had already contradicted.

---

## 2. Design Principles

1. **Monotone cascade.** In v1, constraints only ever accumulate down the cascade. If a config is valid against a child schema, it is provably valid against every ancestor (subsumption / Liskov substitution for data). Everything pleasant in this design flows from this property; protect it fiercely.
2. **Demand vs. provide are syntactically distinct.** A schema line either *demands* (constrains) or *provides* (injects a value/default). They have different mutation laws: demands only intersect; provisions may be replaced or appended unless sealed.
3. **Authority flows downward.** Ancestors declare what descendants may do (`seal`, `cascade`, `final`). A child never grants itself permissions. No `!important`; the CSS specificity war is structurally impossible.
4. **Every semantic distinction costs a distinct keyword.** `demand` ≠ `provide`, `$adopts` ≠ `$extends` (future), value-that-mentions-a-path ≠ instruction-to-load-a-path.
5. **Shape, not syntax.** All logic above the format adapters operates on a positioned, format-independent information model. Formats are serialization adapters over an intersection ("portability floor"), never a union.
6. **Self-hosting.** The schema language is defined by a meta-schema written in itself and validated by the same pipeline. Publishing a schema = validating it as a config.
7. **Provenance is mandatory, not optional.** Every node carries its source span and originating layer. The system exists to be able to print: `constraint from house.yaml:7 rejected value from conf.network.yaml:3 (delegated from site.yaml:12)`.
8. **Maximal conformance at the membrane, original only at the core.** Where the system touches the outside world (formats, hashes, pointers, URL/date/regex semantics), cite and conform to existing standards. The interior (cascade, refinement, delegation) is the original contribution.
9. **Closed constraint vocabulary.** Constraints are declarative data, statically comparable. No escape-hatch lambdas in v1 — an escape hatch can be added later but never removed.

---

## 3. Architecture: The Pipeline

```
text → [format adapter] → positioned information model → resolve/graph → merge → validate → freeze → typed TS surface
```

| Stage | Responsibility | Notes |
|---|---|---|
| **Resolve** | Turn references (relative path, URL, registry name) into bytes | Sandbox rules apply; remote fetch honors HTTP caching (RFC 9111) and pinning |
| **Parse (adapter)** | Bytes → positioned nodes | Per-format; adapters are conformance-tested against a shared corpus |
| **Graph build** | Documents → DAG | Handles `$adopts` edges *and* delegation edges uniformly; cycle detection; diamond dedup by canonical identity (pin hash) |
| **Merge** | Fold DAG into one node tree | Per-key strategies (`replace` default, `append`, later `merge-by-key`); provenance recorded per node |
| **Validate** | Check merged tree against every layer's demands, root→leaf | Redundant with by-construction narrowing; keep the redundancy in v1 |
| **Freeze** | Immutable, typed output | Optionally derive/emit TypeScript types — from the accumulated demand, a stage of its own that reads schema layers rather than the merged tree (Article VIII, v1.1) |

Each stage is independently testable and consumes only the output of the previous one. Everything from graph-build onward is format-blind — and **world-blind**: only Resolve touches anything outside the call, and it does so by *asking its host* rather than by reading. See Article VI.

---

## 4. Article I — Information Model

The model is an **information model** in the YAML-spec sense (representation graph), not a per-grammar AST. Closest prior art: RFC 8949 §2 (CBOR generic data model), JSON data model, unist.

### 4.1 Node types

```typescript
type Node = Scalar | Mapping | Sequence;

interface Base {
  span: SourceSpan;      // layer + file, line, col, byte offset — NON-OPTIONAL
  // SourceSpan carries the originating LayerId. A span is only meaningful
  // relative to the document it indexes, so the two travel as one field:
  // nothing that holds a position can lack the document it is a position in.
  // delegation breadcrumb lives on the provenance chain, not here
}

interface Scalar extends Base {
  kind: "string" | "int" | "float" | "bool" | "null";
  value: string | bigint | number | boolean | null;
}

interface Mapping extends Base { entries: Map<string, Node>; }  // string keys only, canonical (sorted) order
interface Sequence extends Base { items: Node[]; }
```

It must be impossible to construct a node without a span. This is the adapter conformance bar: "parse to *positioned* nodes," not "parse to JS objects."

### 4.2 Legislated decisions (the portability floor)

The model is the **intersection** of YAML/JSON/TOML semantics. Format surpluses are handled at the adapter with specified errors:

- **Keys are strings, period.** YAML complex keys → adapter error with span. **Duplicate keys → error**, never last-wins.
- **YAML anchors/aliases/merge keys (`<<`)** are resolved and expanded at parse time; the model never contains references. The cascade is the sharing mechanism. **Custom tags → rejected** in v1 (also the historic YAML security hole).
- **Numbers:** int/float distinction is kept (`kind: int` stores `bigint`). Lexical kind wins: YAML `2.0` is a float, not an int. `demand: {type: int}` rejects `2.0`.
- **Null vs. absence vs. empty are three different things.** TOML has no null; absence covers the semantic need there. **`required` means present AND non-null.**
- **Booleans/strings:** YAML 1.2 core schema semantics mandated. `yes/no/on/off` are strings. The Norway problem (`no` → `false`) is impossible by decree.
- **Mapping key order is canonical, not authorial.** Mappings are stored sorted by key (code point order, per the string rule below); document order is discarded like comments and quoting style are. Iteration order and equality therefore agree — a mapping cannot compare equal to another yet enumerate differently. Sequences are untouched: item order is semantically significant and always preserved. Position information is unaffected — spans, not iteration, are what make errors faithful to the source.
- **Equality** is defined once, on the model: mappings compare unordered by key, sequences ordered, scalars by (kind, value). Merge, diamond dedup, and test assertions all inherit it.
- **Strings:** UTF-8 (RFC 3629) mandatory. Comparison by code point sequence; **no** Unicode normalization (deliberate decision per UAX #15, not an omission).
- **Hygiene:** parse depth and document size capped (remote documents are accepted). *Size* is the document's size **in the model**, not only its bytes: a document whose aliases expand it far beyond what it writes is over the cap (v1.10, a correction; §15). Reading a document is meant to cost time and memory in proportion to its size, so that the caps bound the work and not only the input; where the parser underneath falls short of that, Cascata corrects it (v1.10: aliases, alias expansion, and the parser's own duplicate-key check).
- **Positions count two things, for two readers** (v1.9, a correction; §15). A span's **offsets** (`start`, `end`) count the document's **stored bytes**, exactly as read: a carriage return is a byte, a leading byte-order mark is three, and a span applied to the bytes slices exactly the text that produced its node. Text handed over as a string is counted as its UTF-8 encoding. A span's **`line` and `column`** are for a person reading the document: LF, CRLF and a lone CR each end one line, and nothing else does (not U+2028, U+2029 or NEL); `column` counts code points from the start of its line, except a byte-order mark at the very start of the stored bytes, which is never counted; any other U+FEFF — a second mark in a YAML prefix, one inside a string — is a character like any other, and an editor's cursor counts it as one. What a line break or a byte-order mark *means* is the format's to say (§12) — YAML 1.2.2 makes a lone CR a line break, and admits a byte-order mark only before a document's content or inside a quoted scalar — but never how a position is counted.

### 4.3 Lossy by design; CST door left open

The model discards comments, quoting style, indentation, anchor names, and authored key order (§4.2). v1 is read-and-validate only. Spans stay precise and adapters stay structured so a per-format lossless CST sibling (for future `tool set` / migrations, à la `toml_edit` or `yaml` Document mode) can slot in later without clobbering user comments. Its first use is Article IX (v1.10): a single value rewritten in place, every other byte untouched.

---

## 5. Article II — Cascade Semantics

### 5.1 Demand / provide

- **`demand`** — a constraint. Composes by **intersection** only. Restating an ancestor's demand is legal and vacuous; weakening is illegal under `adopts`.
- **`provide`** — a value or default injected when (or in addition to what) the config is silent. May be **replaced** downstream (a new default that satisfies all accumulated demands preserves subsumption) or **appended** (arrays under `cascade: append`), unless sealed.

### 5.2 The monotonicity table (normative)

| Construct | Legal downstream mutation | Never |
|---|---|---|
| Types | Narrow by intersection (`string \| string[]` → `string[]`) | Widen |
| Enums / unions | Shrink the set | Add members |
| Ranges / predicates | Tighten; add new predicates (conjunction) | Loosen; remove |
| `required` | Add | Remove |
| Struct openness (`seal`, a `demand` keyword) | `open` → `closed` | `closed` → `open` |
| Defaults (`provide`) | Replace with any value satisfying accumulated demands | Provide a value violating any ancestor demand |
| `cascade: append` arrays | Append provisions | Remove inherited items (not an operation in v1) |
| `cascade` strategy itself | Tighten toward accumulation (`replace` → `append`) | Weaken away from it (`append` → `replace`): a descendant declaring `replace` for a key an ancestor made `append` discards every ancestor's contribution, which the row above forbids absolutely. **A strategy governs from the layer that declares it, downward** — authority flows one way (§2.3), so declaring `append` accumulates the declaring layer's contribution and every later one onto whatever the fold had already produced, and does not reach back to re-combine layers that had already settled under `replace`. Once a key accumulates, it keeps accumulating from that point on. |
| Types (named) | Narrow inherited type (tightens every usage) | Widen or redefine under `adopts` |
| `values` | Declare it where absent; tighten a declared one | Loosen it; remove it |
| `final` | Declare it (freezes the key from the declaring layer downward) | Un-declare it; declare *anything* for a key an ancestor sealed `final` |
| `$pin` demanded by a root | Demand it where an ancestor did not | Retract an ancestor's demand for it |

### 5.3 Merge strategies

Merge policy belongs to the contract, not to individual documents (the Kustomize lesson). Per key: `replace` (default, per RFC 7386 spirit), `append`; `merge-by-key` reserved for later. Deep merge for mappings. Precedence is total, deterministic, and documented as a numbered list.

**A scalar under `append` is a list of one** (v1.8; §15). `append` promises a list, and the commonest contribution to one is a single item, so a scalar written where the list is accumulated is taken as a sequence of that one scalar — extended onto whatever was inherited, never replacing it — and the author is told, at the scalar's own position, with an `info` diagnostic (`append-scalar-wrapped`) rather than silently. A mapping has no one-item reading and is refused. The demand still decides what the item may be, after the wrap, at the same position.

```yaml
# house.yaml   (the schema)
keys:
  styles:
    cascade: append
    provide: [house.css]
```

```yaml
# page.yaml   (the config)
$schema: ./house.yaml
styles: ./report.css              # taken as [./report.css], and noticed
# resolves to [house.css, ./report.css]
```

#### Worked cascade

The reference chain has a worked example (§9) and the cascade did not, which is how the *timing* of a strategy declaration stayed ambiguous long enough to be implemented two ways. Prose can carry both readings; an example has to pick one.

```yaml
# https://site-builder.dev/schema/core.yaml   (root)
keys:
  styles:
    provide: [reset.css]          # no cascade declared — `replace` by default
```

```yaml
# ~/.config/house.yaml   (house layer)
$adopts: https://site-builder.dev/schema/core.yaml
keys:
  styles:
    provide: [house.css]          # still `replace`: this REPLACES [reset.css]
```

```yaml
# ./project.yaml   (project schema)
$adopts: ~/.config/house.yaml    # a schema's `~/` expands as a config's does, and is then confined
                                # like any path a schema wrote: it resolves only where the embedder
                                # granted a sandbox root that contains it (§8.4; §15, v1.7)
keys:
  styles:
    cascade: append               # tightening — legal, and takes effect HERE
    provide: [project.css]
```

```yaml
# ./site.yaml   (the config)
$schema: ./project.yaml
styles: [page.css]
```

Resolves to **`[house.css, project.css, page.css]`**.

`reset.css` is absent, and that is the point. The house layer replaced it while `replace` was still in force, which was legal and was what the house layer meant at the time. The project schema's `append` binds itself and everything below it — it does not reach back and re-combine a decision its ancestor had already settled. Authority flows one way (§2.3); a descendant that could rewrite an ancestor's merge outcome would be flowing the other.

Had the root itself declared `cascade: append`, the answer would be `[reset.css, house.css, project.css, page.css]`, and the house layer could not have declared `replace` — that is the weakening §5.2 forbids.

### 5.4 Enforcement, in order

1. **Dynamic (v1):** validate the final merged config against **every** layer root→leaf. Trivially correct even under merge-engine bugs; yields layer-precise errors.
2. **Static subsumption (v1.x, lint):** prove schema-vs-schema refinement with no data (CUE `vet`-style), catching a broken house schema at publish time. This is why the constraint vocabulary is closed declarative data.

Do not skip whole-chain validation in v1 even though narrowing-by-construction makes leaf-only validation tempting. Belt and suspenders.

### 5.5 `required` × `provide` (settled)

Provides inject **during merge**; `required` (present-and-non-null) checks the **post-merge** tree.

- **`required` + replaceable `provide` = the *guaranteed key* pattern. Feature, no diagnostic.** Authors may omit the key (the provide fills it); an explicit `key: null` still errors (`required` forbids nulling-out). In the typed TS output this is a **non-optional property** — a real promise to the consuming application. At v1.0 that means the `T` a caller passes to `load<T>()` should declare it non-optional; the v1.x generator (§14, §17) is what will emit it from the schema rather than trusting the caller to remember.
- **`required` + `final provide` = the *pinned constant* pattern.** The value is untouchable, so `required` adds nothing: emit an **info-level lint** ("`required` is vacuous under `final provide`"), not an error — the pattern is legitimate; the lint teaches.
- **Provide retraction** (a descendant removing an inherited provide) is *monotone-legal* — omitting configs go from valid to invalid, which is strict narrowing — but is **out of v1** pending syntax and a story. Parked in future doors as legal-when-wanted, not forbidden.

---

## 6. Article III — Pedigree

### 6.1 `$adopts` (v1)

Refinement. Preserves substitutability and the ancestor's identity as the thing you certify against. Pedigree is a first-class, queryable ordered chain of schema identities (URL + content hash) from root to leaf.

**v1 restriction (settled): `$adopts` takes exactly one parent.** The pedigree is a chain; diamonds cannot arise in the adoption graph. Stacking use cases (org → team → project) compose by chaining, and subsumption proofs, provenance, and precedence stay trivially linear. Delegation "diamonds" (one fragment grafted at two points) are a non-issue: fragments are pure data — two grafts are two independent subtrees.

**Pre-commitment for future multi-adoption: C3 linearization** (Python MRO / Dylan). Chosen because C3 is itself *monotone* — a child's linearization never reorders any ancestor's — which keeps `append` fold order stable when a layer is inserted into an existing hierarchy; and it fails loudly (inconsistent hierarchies have no C3 solution → graph-build error), matching the collision-is-an-error house style. Fold rule: provisions apply in linearization order root→leaf; a shared ancestor (deduped by pin) contributes exactly once at its linearized position. Demands are unaffected — intersection is commutative and idempotent.

- `$id`: a URI (RFC 3986).
- `$pin`: `sha256:…` content hash over the document's **exact bytes** — SHA-256 (FIPS 180-4), taking W3C Subresource Integrity's *approach* — hash what was fetched, not a reconstruction of it. The **syntax** is not SRI's: SRI writes `sha256-<base64>`, while `$pin` is `sha256:<hex>`, colon-separated and lowercase hex, matching this document's own example and the OCI/Docker convention it resembles. Fixed explicitly here because "follows SRI" would otherwise imply base64. **Not over a canonical form.** RFC 8785 (JCS) cannot express this model: it serializes numbers as IEEE-754 doubles, so an exact integer beyond that range (§4.2) is unrepresentable, and `2` and `2.0` — values this model holds to be different — serialize identically and would collide. A pin therefore names one published artifact byte-for-byte; the same document re-indented, or expressed in another format, is a different artifact with a different pin. That is the intent: a pin is an integrity check on a fetch, not a statement about meaning.
- `$version`: integer in v1; SemVer 2.0.0 if it grows.
- CLI surface: `tool why <config>` prints the pedigree; `tool certify <config> --against <root-hash>` answers the substitutability question.

### 6.2 `$extends` (future, distinct keyword)

A **fork**: severs substitutability, mints a new root of trust, may change rules. Configs validate against the new pedigree only. `forkedFrom` recorded as honest metadata with zero semantic weight.

### 6.3 Sealing / authority

Everything here is declared by an **ancestor** and binds **from the declaring layer downward** — the same one-way flow §5.2 gives cascade strategies and §7 gives type narrowing, for the same reason (§2.3).

**Per key.**

- **`seal: open | closed`** — struct openness, the keyword behind §5.2's row. `closed` on a mapping refuses any child key the accumulated `keys` vocabulary does not declare. `open` is the default. Openness narrows one way: a descendant may close what an ancestor left open, never reopen what an ancestor closed. **It lives in the `demand` vocabulary, not here** (§9, amended v0.7) — it constrains shape rather than authority, so it nests wherever demands nest and works inside a named type. It is described in this article because sealing is what it is *for*, not because it is spelled beside the keywords below.
- **`final: true`** — the key is sealed against *every* further declaration. Two consequences, and they are different:
  - **No descendant schema layer may declare that key at all** — not `demand`, not `provide`, not `cascade`, not `seal`, not `delegate`. Restating a `final` key is refused even when the restatement would be a legal narrowing, because `final` is the ancestor saying the question is closed, not that it must be answered more tightly.
  - **A `final` key carrying `provide` is a constant.** The provided value is the value; a *config* setting that key is refused. This is §5.5's **pinned constant** pattern, and it is where that section's info-level lint ("`required` is vacuous under `final provide`") fires. A `final` key carrying **no** `provide` freezes the demand only — the config still supplies the value, it simply cannot be governed further.
- **`cascade`** — §5.2, unchanged.

**Per schema**, declared in an `authority:` section — a fourth top-level section beside `types`, `keys`, and `directives` (§9). It is its own section rather than a pair of new reserved `$`-keys because the reserved list is closed at six and is depended on by the resolver, the fold's stripping rule, and the meta-schema alike; and rather than a corner of `directives:`, because *constraining* a directive and *asserting* governance are two jobs, and one section doing both is the vocabulary conflation Principle VI exists to prevent.

```yaml
$id: site-builder/core
authority:
  demandPinnedAdoption: true
  finalAgainstForking: true
```

- **A root may demand pinned adoption** (`demandPinnedAdoption`). §11 parks this power here, and this is where it lands: a published root legislates that every descendant adopting it must carry a `$pin`, and an unpinned adoption in that pedigree is refused. The mechanism (verify whenever present) has shipped since v0.2; this is the legislation that makes it mandatory, and it is authority flowing downward like everything else in this article. One limit is inherent, not chosen, and §11 states it: a root's demand is readable only *after* that root has been fetched, so it hardens every subsequent resolution but not the first. A lockfile closes that gap; this does not pretend to.
- **A root may declare itself `final` against forking** (`finalAgainstForking`) of its published identity — the text can be copied; the name cannot be claimed. `$extends` is a future keyword (§6.2), so in v1 this declaration is **recorded and queryable but enforces nothing yet**. It is stated now rather than later so that a root published today can bind a fork attempted tomorrow — a declaration that only becomes available with the keyword it governs would arrive too late for every schema already in the world.

---

## 7. Article IV — Types

A type is a **named, reusable bundle of demands**. No new mechanism: types inherit the entire cascade discipline (CUE `#Definition`, JSON Schema `$defs`, Zod-assigned schemas as prior art).

```yaml
$id: site-builder/core
types:
  resource:
    accept: [url, path]           # declared alternatives — both singular
    demand: { type: string }

keys:
  styles:
    demand: { type: "resource[]", accept: [url] }   # usage selects a subset — narrowing
    cascade: append
```

Laws:

- **Parameters are constraint selectors, never computation.** A parameter may only choose among or tighten the type's declared alternatives. Selecting a subset of a union is narrowing, so parameterization is itself monotone and statically checkable. No template language.
- **Types cascade.** A descendant may redeclare an inherited type name, and doing so **narrows that type from the declaring layer downward** — the declaring layer's own usages and every layer below it, never an ancestor's. Authority flows one way (§2.3); this is the identical rule §5.2 states for cascade strategies, for the identical reason. House-defaults ergonomics — "our `resource` is URLs only; nothing served off local disk" — therefore bind the house and everything beneath it, while an ancestor's own usage of the name keeps meaning what that ancestor declared. Widening or redefining remains illegal under `adopts` and needs no separate refusal: an ancestor's demand resolves the *ancestor's* declaration, and whole-chain validation (§5.4) applies it regardless, so a widening is inert exactly where it would otherwise do harm. Proving that a redeclaration narrows, with no data present, is static subsumption (§5.4 item 2, v1.x).
- **One flat namespace per pedigree; a collision between *unrelated* declarations is an error.** Two declarations of one name standing in an ancestor/descendant relation are **not** a collision — they are the narrowing the law above describes. Because v1 `$adopts` takes exactly one parent (§6.1), every pedigree is a chain and every pair of layers is related, so **collision is unreachable in v1** and is reserved for future multi-adoption, where two unrelated ancestors may each declare a name. Qualified names (`core/resource` — the qualifier being the last segment of the declaring document's `$id`) restrict resolution to declarations from documents carrying that qualifier, and are the escape hatch. They pin one specific declaration exactly when qualifiers are distinct, which is the case worth designing for; where two layers in one chain share a qualifier *and* a type name, the second is a narrowing of the first like any other, and the **nearest** wins there too. No silent shadowing: unqualified or qualified, a name always resolves to the nearest declaration at or above the layer that names it, and the same reference read from two different layers may therefore name two different declarations — which is the point, since that is what "narrows from the declaring layer downward" means.

- **Recursion is permitted when it is *guarded*.** A type whose definition reaches itself through at least one structural level — `keys`, `items`, or `values` — is **productive**: each traversal consumes a level of the value being checked, so checking terminates on any finite document, bounded further by the demand-depth cap. A type that reaches itself through **type expressions alone** (`A: { demand: { type: B } }`, `B: { demand: { type: A } }`) is *unguarded*: it consumes nothing, has no fixpoint any value can reach, and stays refused as `unresolvable-type-cycle`. This is the standard contractive-recursion rule, and Cascata needs it for a reason it cannot dodge — the meta-schema (§9) describes a vocabulary that nests into itself, so a language whose types cannot recurse cannot describe its own schemas, and self-hosting (§2.6) would be unreachable. Amended in v0.7, where the bootstrap ran into a blanket cycle refusal that was written for the unguarded case and fired on both (§15).

#### Worked narrowing

§5.3 gained a worked cascade because prose alone let the *timing* of a strategy declaration be read two ways. The same was true here, and cost the same: with no example of a descendant narrowing an inherited type, "descendants may narrow" and "collision is an error" were implemented as contradicting each other (§15).

```yaml
# https://site-builder.dev/schema/core.yaml   (root)
$id: site-builder/core
types:
  resource:
    demand: { type: string }
    accept: [url, path]
keys:
  styles:
    demand: { type: "resource[]" }
```

```yaml
# ~/.config/house.yaml   (house layer)
$adopts: https://site-builder.dev/schema/core.yaml
types:
  resource:
    accept: [url]               # narrowing — legal, and it takes effect HERE
keys:
  styles:
    demand: { type: "resource[]" }   # the house restates the key, so its own narrower resource governs
```

A config under the house supplying `["assets/theme.css"]` — a path — is **rejected**: the house's own `styles` demand resolves the house's `resource`, which now accepts only URLs.

Had the house narrowed `resource` **without** restating `styles`, that same path would be **accepted**. The root's `styles` demand resolves the *root's* `resource`, which still accepts paths, and no other demand applies. This is the cost of resolving in the declaring layer's scope, and it is deliberate: the property that makes it so — an ancestor's demand always means what the ancestor wrote — is exactly what stops a descendant's *widening* from voiding an ancestor's constraint. A narrowing that must reach an ancestor's usage is written by restating that key's demand, which is one line and says what it means.
- **Primitives are predefined types** in the meta-schema's own `types` section. `url` and `path` are built-in refinements of `string` — the semantics JSON Schema's `format` registry names, reached here as ordinary type names rather than a second keyword (§15); `resource` is an ordinary union of them — and a **singular** one: every alternative denotes exactly one resource, which is why a glob is not among them (§15). Multiplicity is written `resource[]`, never smuggled into the element type.
- **Path relativity:** resolved relative to the **declaring file's directory**.

Built-in type semantics (cited, not invented) — what each predefined type actually validates, in the sense JSON Schema calls a value's "format" without this article using that word as a keyword (§15): `url` → WHATWG URL Standard (what Node's `new URL()` implements; state the WHATWG-vs-RFC 3986 choice explicitly). `pattern` → ECMA-262 regex, stated explicitly. Dates (future) → RFC 3339, not bare "ISO 8601". `path` → POSIX pathname semantics + sandbox rules.

---

## 8. Article V — Delegation (Transclusion)

The capability for a key to accept `"./conf.network.yaml"` in place of its inline subtree — granted **by the schema, per key**, never ambient.

```yaml
keys:
  network:
    demand: { type: mapping, keys: { … } }
    delegate: allow      # a string value here means: load and graft
  favicon:
    demand: { type: resource, accept: [path] }   # a string here is DATA about a file
```

### 8.1 The razor

Without schema governance every string is ambiguous (filename-as-data vs. instruction-to-load); systems that guess accumulate heuristics and CVEs. Here the schema disambiguates: **mentioning a file (a `resource` value) and loading a file (`delegate`) are different constructs with different keywords.** This is the data/code boundary.

The razor cuts the schema author too. At a key granted `delegate: allow`, a string is an *instruction*, so an **inline** string can never be matched against that key's own `demand` — it is loaded first, and what the demand then sees is the fragment. A key that grants delegation while demanding a leaf shape an inline string would have satisfied (`type: string` being the plain case) is therefore not what its author is likely to think it is. It is not, however, unusable: a fragment document whose whole content is a string scalar satisfies such a demand exactly. So it earns an **info-level lint** naming what will happen, not a refusal — §5.5's precedent, and the same reasoning: the pattern is legitimate, the lint teaches. Recorded as an open Edge Case in v0.6 and settled in v0.7 (§15).

### 8.2 Transclusion, not cascade

A delegated file is a **fragment**: a branch grafted into its parent's tree, belonging to the parent's **layer**. It carries no `$schema`, starts no pedigree, creates no merge boundary. `$`-keys in fragments are **forbidden** in v1. One line tells the whole story: *the cascade composes vertically across documents; delegation composes horizontally within one document.* A config with twelve fragments is semantically identical to the same config written inline — same node tree, same validation, same merge. That identity is the feature.

### 8.3 Mechanics (all falling out of the principle)

- Transclusion happens at **graph-build**, before merge and validation; delegated files are just more DAG edges — cycle detection and diamond dedup come free.
- **Merge interaction: none.** By merge time, inline and delegated subtrees are indistinguishable node trees. Per-key `cascade` applies unchanged.
- **Provenance:** spans point into the fragment; the provenance chain keeps the delegation breadcrumb (`… (delegated from site.yaml:12)`).
- **Validation is positional:** the fragment's root mapping is validated as the subtree at its graft point. Bonus: editors can be told "this file is a `site-builder/core#network` fragment" for autocomplete, derived mechanically from the graft point.
- **Format freedom:** a fragment may be in a different format than its parent — trivially true under the information model.

### 8.4 Security posture

Delegation is schema-triggered file loading, and schemas can come from the web. Therefore: paths resolve relative to the **delegating config's** directory; confined to the sandbox — the root or roots the caller granted (v1.7), ordinarily the project directory — no `..` escapes, no absolute paths by default; **remote delegation targets are off** unless the *user* (never the schema) opts in; the schema allowing delegation never compels it — the config author chooses per key. Schema demands; config provides. Always.

Future doors, deliberately open: `delegate: { allow: true, formats: [yaml, toml] }` selector-style parameters; a possible future "delegate and start a layer" would be a **new keyword with new laws**, not a mutation of this one.

---

## 9. Syntax Reference (v1 vocabulary)

Rule documents are written **in the host format** (YAML describing rules, as JSON Schema is JSON describing JSON) — parsing, tooling, and self-hosting for free. A compact string DSL covers leaf type expressions only (`string | string[]`, `resource[]`): a tiny grammar, a few dozen lines of parser.

### 9.1 Leaf DSL grammar (settled)

```ebnf
TypeExpr := Union
Union    := Array ( "|" Array )*
Array    := Primary "[]"*
Primary  := Name | "(" Union ")"
Name     := Ident ( "/" Ident )?          (* qualified: core/resource *)
Ident    := [A-Za-z_] [A-Za-z0-9_-]*
```

- **A type expression containing `[]` must be quoted inside a YAML *flow* mapping.** `{ type: resource[] }` is not a parse error in Cascata but in YAML: `[` opens a flow sequence, so the document never reaches this grammar. Block style needs no quoting (`type: resource[]` on its own line is a plain scalar), and `|` alone is safe in flow (`{ type: int | float }` parses). This is a property of the host format rather than of the type language, and it is stated here because it is invisible until it bites: five of this document's own worked examples were written in the unquoted flow form and did not parse, undetected for six milestones because every executed fixture happens to use block style (§15).
- **`[]` binds tighter than `|`** (TypeScript precedence): `string | string[]` = string or array-of-string; `(string | int)[]` needs parens. Whitespace insignificant.
- **Names only.** No literals, no parameters, no `?` marker. Enums via `enum:`, optionality via `required:`, parameters via sibling keys (`accept:`, `min:`…). One construct per meaning — the DSL is a pure type-name algebra.
- **Canonical form:** unions flatten and dedupe as *sets* (order insignificant for equality); arrays compare structurally.
- **Subsumption:** `A ⊑ B` iff every alternative of A is ⊑ some alternative of B; `T[] ⊑ U[]` iff `T ⊑ U`; names resolve through the type graph. Decidable, ~50 lines — this is what keeps static subsumption on type expressions nearly free.

**This grammar is not describable by the constraint vocabulary, and the meta-schema approximates it.** The production `Primary := "(" Union ")"` makes the language non-regular, so no `pattern` can capture it and a schema cannot invoke this parser. The meta-schema therefore constrains a `type:` value with a `pattern` that is a deliberate **superset** of this grammar, governed by one rule: **it must accept every string this grammar accepts.** Over-acceptance is safe — the parser is the authority and refuses what it must — while a single false rejection would put two authorities in contradiction, which is the failure the razor of §8.1 exists to prevent. In practice the superset differs from the grammar only in not checking that parentheses balance. The debt is recorded rather than hidden: **self-hosting is complete except for leaf type expressions**, and closing that gap properly is a v1+ question (§14, §15).

Reserved document keys: `$id`, `$version`, `$adopts`, `$pin`, `$schema` (config-side pointer), later `$extends`.

**Reserved keys are directives, not data.** They govern how a document is found and what governs it, and they do **not** appear in a merged configuration: a consumer receives the configuration the documents describe, not the plumbing that assembled it. This was silent until v0.3, where a fold's first conformance case surfaced `$schema` sitting in the merged tree as an ordinary key.

**`$adopts` and `$schema` are single string scalars.** A sequence value is refused — not as a malformed value, but with a diagnostic saying v1 adopts exactly one parent (§6.1), because that is the shape multi-adoption will take when C3 linearization lands and an author writing it early deserves to be told which version they are ahead of. Two `$adopts` keys in one mapping are already impossible: duplicate keys are refused (§4.2).

Schema vocabulary per key: `demand` (`type`, `items`, `required`, `accept`, `keys`, `values`, `seal: open | closed`, plus JSON-Schema-named leaf constraints: `min`, `max`, `minLength`, `maxLength`, `pattern`, `enum`), `provide`, `cascade: replace | append`, `final: true`, `delegate: allow`.

**`seal` is a `demand` keyword, not a per-key one** (amended v0.7; §15). It constrains a mapping value's *shape* — it composes by intersection, `open ∩ closed = closed`, and narrows monotonically — which is what every demand does and what no governance keyword does. Structurally it is `required`, not `cascade`. Placing it beside `provide` and `cascade`, as this document did until v0.7, made it unable to reach a nested mapping or the inside of a named type, and the meta-schema needs both.

**A schema may also carry a top-level `seal`**, governing the **config's own top level** — the mate to a schema's top-level `keys:`, which §9 already says governs the config's own top level. The two are one keyword at two scopes and must never diverge in meaning. Before v0.7 there was no way to close a document's top level at all.

**`final` is a boolean**, written `final: true`. `final: false` is legal and inert where no ancestor sealed the key, and refused as a weakening where one did. The syntax was never stated until the meta-schema forced the question (§15). **`keys`, `items`, and `values` all nest to arbitrary depth**: `keys` constrains a mapping value's own *named* children, `items` constrains a sequence value's own elements, and `values` constrains **every** entry of a mapping whatever its key is; any of them may recurse into further `keys`/`items`/`values` beneath it, to whatever depth the data actually nests.

**A nested key declaration is a smaller thing than a top-level one, and deliberately so** (amended v0.7; §15). This sentence used to say a nested `keys` constrains a mapping's children "the way" a schema's top-level `keys:` constrains the config's top level, which asserted a parity that never existed. A **top-level** entry carries the full per-key vocabulary — `demand`, `provide`, `cascade`, `final`, `delegate`. A **nested** entry carries `demand` and `delegate` only. The distinction is not an accretion: `provide`, `cascade` and `final` are statements about *a layer's authority over a key*, which is a relationship between documents and means something only where a schema declares a key of its own; a nested key is part of a value's **shape**, and shape is what `demand` is for. `delegate` nests because §8's grant is per key at any depth, and v0.6 built it that way on purpose. `seal` is no longer an exception either, having moved into `demand` above, where it nests with every other demand.

**`values` is to a mapping what `items` is to a sequence** — the construct for a mapping whose keys are the author's to choose rather than the schema's to enumerate. **The parallel is exact, including the shape: `values` takes a bare demand mapping** (`values: { type: string }`), as `items` does, and *not* a key declaration. Corrected in v0.7 after the first implementation took the other reading and made the wrong spelling a silent no-op (§15). Where a key is named by `keys` *and* covered by `values`, both apply: demands compose by intersection and always have (§5.1), so there is no precedence rule to invent. `values` alone says nothing about *which* keys may appear — that is `seal`'s question, and the two are orthogonal: `values` with `seal: open` means "any key you like, each shaped like this"; adding `keys` entries under `seal: closed` restricts the set to those named. Added in v0.7 because the meta-schema's own `keys:` section is exactly a mapping of author-chosen names, and nothing in the vocabulary could describe it (§15).

Top-level schema sections: `types`, `keys`, `directives`, `authority`. The last two arrive in v0.7; `authority` holds the per-schema governance declarations of §6.3 and is described there.

**`directives` constrains the reserved `$`-keys**, and exists because they are a different category rather than in spite of it. Reserved keys are directives, not data: they govern how a document is found and what governs it, and they do not appear in a merged configuration (above). A meta-schema constraining them through `keys:` would therefore be constraining something the pipeline has already, correctly, removed. `directives:` is a separate section whose vocabulary is **closed to the six reserved keys** and whose entries take the same per-key vocabulary as `keys:` entries. This is what lets the meta-schema say that `$pin` matches `^sha256:[0-9a-f]{64}$` and that `$adopts` is a single string (§9's own rule, until now enforced only by hand-written code) without any reserved key ever re-entering the data plane. Added in v0.7 for the bootstrap (§15).

### Worked chain

```yaml
# https://site-builder.dev/schema/core.yaml   (root)
$id: site-builder/core
$version: 1
types:
  resource: { accept: [url, path], demand: { type: string } }
keys:
  styles:
    demand: { type: "resource[]", accept: [url], required: true }
    cascade: append
    seal: open
```

```yaml
# ~/.config/house.yaml   (house layer)
$adopts: https://site-builder.dev/schema/core.yaml
$pin: sha256:9f2c…
keys:
  styles:
    demand: { type: "resource[]" }                      # legal: (vacuous) narrowing
    provide: ["https://cdn.house.dev/base.css"]       # house default, appended
```

```yaml
# ./site.yaml   (the config)
$schema: ~/.config/house.yaml   # a leading `~/` expands to the user's home directory; no sandbox
                                # confines it, because a config's own reference is author consent (§8.1)
styles:
  - https://example.com/theme.css
# resolves to [base.css, theme.css] — valid against house AND core, provably
```

---

## 10. Validation & Error Contract

- Every error carries: the violated demand (with its declaring layer + span, as a JSON Pointer per RFC 6901 into that document), the offending value (layer + span, delegation breadcrumb included), and the accumulated pedigree position.
- Canonical error sentence: `constraint from house.yaml:7 (/keys/styles/demand) rejected value from conf.network.yaml:3 (delegated from site.yaml:12)`.
- **Diagnostics carry a level: `error` or `info`.** An `error` is a refusal — it decides the outcome, and a result carrying one is not a configuration. An `info` is a **lint**: it teaches and never changes the verdict. Two levels, not three: every lint this document mandates (§5.5's vacuous `required`, §8.1's inline string at a delegating key) is a "this does not mean what you think" observation about a *legitimate* construct, and nothing yet cited needs a middle rank. A third level may be added when something needs it; adding one that nothing fires is the vocabulary inflation Principle VI forbids. Levels are part of the contract, so an `info` carries the same position, pointer, and pedigree data an `error` does — a lint with a worse diagnostic than a refusal would be a lint nobody acts on.
- **One violated demand at one position is one diagnostic.** Where a walk reaches the same demand and the same value by more than one path — which §9's `keys` + `values` composition makes ordinary, since both may cover an entry and both may recurse into one shared type — the diagnostic is reported **once**. This is a statement about multiplicity, on which this section had been silent; it changes nothing a diagnostic *carries*. It is written down because the silence was not free: at v1.0 a 296-byte configuration, legal and well inside §11's depth cap, reported a single violation 2^depth times and exhausted memory at depth 24. Every copy was byte-identical in every field a consumer can read, so nothing was being communicated by the repetition. **The collapse must be applied as results accumulate**, not once at the end — where two arms recurse into one shared type, the list doubles at every level up, and a final pass runs after the doubling has already happened (§15).
- Machine-readable error output uses RFC 6901 pointers throughout — do not invent a path syntax.
- `tool why <config> <pointer>` answers "where did this value come from and what did it override" (the `git config --show-origin` / DevTools struck-through-rule feature). Built into the merge engine from day one; nearly free there, nearly impossible to retrofit.

---

## 11. Security Model (summary)

- **Remote schemas: HTTPS, always.** Pinning by content hash (`$pin`, SHA-256 over the exact bytes, §6.1) is **verified whenever a pin is present**, and verification is absolute: mismatched bytes are refused and never enter the graph. Whether a pin is *required* is not the library's decision but the pedigree's — authority flows downward (§2.3), and a published root legislates what its descendants must do, here as everywhere. v0.2 shipped the mechanism; **the legislation lands in §6.3 at v0.7**, where a root may demand pinned adoption and an unpinned link in its pedigree is refused. An unpinned reference is therefore fetched on TLS alone, and **an unpinned remote link MUST be reportable**, so a root's demand is auditable and an author can see what they are trusting unverified. One limit is inherent rather than chosen: a root's demand can only be read after that root has been fetched, so it hardens every subsequent resolution but not the first — which is what a lockfile closes. Immutable content-addressed cache per RFC 9111 semantics; lockfile-friendly.
- A remote schema can never trigger local file reads outside the sandbox (delegation rules, §8.4) nor remote delegation without user opt-in — save the one document a host has itself chosen to name, where the host owns a namespace (§16, v1.4): a schema may write `$adopts: beltype:document`, and the host may answer with a location outside the sandbox. That is a bound rather than an exception, and the next sentence is why. A namespace is finite and the host wrote it, while a path namespace is the whole disk, which is what the sandbox exists for and why the two are not confined by the same rule. **This is structural, not self-policed**: the library performs no I/O of its own and can read only what its host answers (Article VI), so a host that declines has denied it and no schema can appeal. The sandbox rules below remain in force as defence in depth, so that a permissive host still gets every guarantee.
- **A path rule is only as good as the terms it is judged in** (§16, v1.5). §8.4's refusal of an absolute delegated path, and the sandbox containment check that compares a location against its root, are computed with the **host's** notion of "absolute" and of what separates two segments. Judged by POSIX rules on a Windows host, `C:\secrets\creds.yaml` is not absolute and `C:\sandbox` does not end in a separator — so the one refusal §8.4 exists for would let exactly the reference it was written to stop through. This is why the path facility is supply the host answers rather than something the library reads from its process: a security check written against the wrong platform's rules is not a check. **One property the check requires of the facility it is handed** (v1.8, a correction — the implementation had relied on it unsaid since v1.7): for an absolute, normalized location, `dirname` answers a prefix of its input, and a root is its own parent. The containment check judges a location that does not exist by walking up through `dirname` until the host canonicalizes an ancestor and appending what it walked past, and that appending is a slice of the input at the ancestor's length. `node:path`'s posix and win32 rules and `posixPaths` all satisfy it; a host that supplies a `dirname` which does not gets a wrong verdict rather than an error, which is why it is written here and not left to the seam's comment.
- YAML custom tags rejected; parse depth/size capped — size including alias expansion (§4.2), so a few hundred bytes of nested aliases ("billion laughs") are refused rather than expanded; duplicate keys rejected.
- The schema language is versioned by the meta-schema's identity **in the pedigree of the schemas that adopt it** — location plus content hash, from which the `$version` is read in the document that identity names. Not by the meta-schema's *own* pedigree, which is empty: a pedigree entry carries an identity rather than a version, and §6.1's chain excludes the entry document, so a meta-schema resolved as its own entry has nothing in front of it. Corrected in v0.7, when the bootstrap was the first thing able to try it (§15).

---

## 12. Standards Conformance Map

Posture: **maximal conformance at the membrane, original at the core.** Every citation doubles as a test oracle.

| Area | Standard | Use |
|---|---|---|
| JSON | ECMA-404 / **RFC 8259** | Adapter conformance (8259 is the stricter, useful one) |
| YAML | **YAML 1.2.2, core schema** | Adapter mandate; kills the Norway problem by fiat |
| TOML | **TOML v1.0.0** + `toml-test` | Adapter conformance; borrow the test-suite shape |
| Encoding | RFC 3629 (UTF-8), UAX #15 (cited for the no-normalization decision) | Model |
| Data model prose | RFC 8949 §2 (CBOR) | Crib for the model article |
| Pinning | **SHA-256** (FIPS 180-4) over exact bytes | Reproducible `$pin` hashes. RFC 8785 (JCS) was specified here and **withdrawn**: it cannot represent this model's exact integers or its int/float distinction, so it would both fail on large numbers and collide on values the model holds unequal (§6.1). Hashing raw bytes conforms to W3C SRI literally instead. |
| Integrity pattern | W3C Subresource Integrity | Legibility of the pinning story |
| Tree addressing | **RFC 6901 (JSON Pointer)** | Errors, `tool why`, graft points — verbatim |
| Merge baseline | RFC 7386 (JSON Merge Patch) | Cited as the default-replace baseline we exceed |
| Patch (future ops) | RFC 6902 (JSON Patch) | If `tool set` ever needs a change format |
| Constraint leaf names | **JSON Schema 2020-12 vocabulary** (`min…`, `pattern`, `enum`) | Selective vampirism: names yes, composition semantics no. The `format` *registry*'s semantics remain available — as built-in type names (`url`, `path`, and any future `email`/`date-time`), not as a second, non-cascading keyword (§15) — but its keyword is not borrowed |
| URLs | **WHATWG URL Standard** (explicitly chosen over RFC 3986 at the margins) | `url` format = what `new URL()` validates |
| Regex | ECMA-262 | `pattern` dialect, stated explicitly |
| Dates (future) | RFC 3339 | Not bare ISO 8601 |
| Identifiers / versions | RFC 3986 (`$id`), SemVer 2.0.0 | Naming |
| HTTP caching | RFC 9111 | Remote schema fetch |
| Media type (eventual) | RFC 6838 IANA registration | `application/vnd.<name>+yaml` — low priority signaling |

### Leverage: software we don't write

`yaml` (eemeli's; YAML 1.2, CST, spans) · Ajv (engine behind the JSON Schema **export**, not the core) · WHATWG `URL` (Node built-in) · `toml-test` (adapter corpus shape).

### Interop: the JSON Schema exporter

A lossy compiler from Cascata schemas to JSON Schema 2020-12 (flattens the cascade into the accumulated intersection; drops `provide`/sealing). One exporter buys the whole ecosystem: VS Code autocomplete via `$schema`, Ajv validation in CI systems that don't run this tool, OpenAPI embedding. **Highest-leverage single interop feature; schedule it early after v1.**

---

## 13. Prior Art (attitudes absorbed)

- **CUE** — schema/data unification, closedness, subsumption checking, definitions. The closest relative; study its lattice pages.
- **CSS `@layer`** — explicit, author-declared precedence; the principled redesign of the cascade. The anti-pattern absorbed in negative: `!important` (losers fighting upward) is structurally impossible here.
- **HOCON** — carefully specified merge precedence as a numbered list.
- **Dhall** — remote imports with content-hash pinning; fetch ≠ trust.
- **Kustomize** — merge policy belongs to the contract (patch strategies, merge keys).
- **JSON Schema** — leaf vocabulary and `format` registry (adopted); intersection-only composition pain and non-injecting `default` (instructive failures).
- **ESLint flat config** — the lesson that *implicit* directory cascading confuses everyone; all composition here is explicit.
- **Zod** — the TypeScript-facing bar: schemas that yield typed outputs.
- **CDDL (RFC 8610)** — design literature for a small standards-track constraint language.

---

## 14. Roadmap

1. **v0.1** — Information model spec + YAML adapter (positioned nodes, portability-floor rejections) + shared conformance corpus skeleton.
2. **v0.2** — Resolver + DAG builder: `$adopts`, pinning (SHA-256 over exact bytes), cycle detection, diamond dedup, HTTP caching.
3. **v0.3** — Merge engine with per-key strategies (`replace`, `append`) and full provenance; `tool why`.
4. **v0.4** — Constraint checker (closed vocabulary), whole-chain validation, error contract; `tool certify`.
5. **v0.5** — Types (`types` section, selector parameters, namespace collision errors); nested demands (`keys` implemented, `items` generalized from one level to arbitrary depth, per §9's amendment).
6. **v0.6** — Delegation (transclusion, sandbox, positional validation, breadcrumbs).
7. **v0.7** — Sealing/governance (`seal`, `final`, a root demanding pinned adoption, a root final against forking) + **the embedding surface** (the host seam of Article VI, the one-call `load()`, `resource` values resolved against their declaring document rather than merely shape-checked) + **meta-schema bootstrap** (self-hosting; do this early — every vocabulary wart becomes a wart you personally suffer). The embedding surface belongs *here* rather than at v1.0 because the meta-schema bootstrap is its first real consumer — self-hosting means the library loads its own meta-schema through its own seam, which is the embedding story exercising itself. **Planning the bootstrap made good on its own justification before any code was written**: three vocabulary warts (no construct for author-chosen keys, no recursive types, no way to constrain the reserved keys) and one unimplementable obligation (§5.5's lint, against a `Diagnostic` with no severity) surfaced from trying to write the meta-schema and are settled in §15. `values`, guarded recursion, `directives:`, and diagnostic levels are therefore part of this milestone. Cascade limits are **already shipped** — `cascade-strategy-weakened` landed in v0.3 — and leave the list.
8. **v1.0** — **Freeze this document** (see §15's freeze rule) + **the output surface** (Article VII): the value view a consumer actually reads, and `load<T>()`. Also closes the two holes v0.7 recorded rather than fixed — a non-mapping top-level `keys:`/`types:` section silently ignored, and the exponential `keys`+`values` composition over a shared recursive type.
9. **v1.1** — **The accumulated demand, and the TypeScript type generator** (Article VIII): a value-free stage that intersects every layer's demands per position, and an emitter that writes it as the `T` that `load<T>()` consumes. The tree is the artifact; the emitter is a translation of it.
10. **v1.x** — **JSON Schema 2020-12 exporter**, a second emitter over the same tree (§12's "accumulated intersection"); Ajv as its test oracle only, never a runtime dependency.
11. **v1.x** — static subsumption lint (the same tree, compared rather than emitted); **JSON adapter — shipped at v1.2**, ahead of item 10's exporter, which therefore moved from v1.2 to v1.3, then to v1.4 when the **launching schema** (Article VI, `resolve()`'s `schema` option, an embedder's stand-in for a `$schema` line the entry did not write) shipped at v1.3, then to v1.5 when **host-resolvable identity** (Article VI, a scheme the host owns, `Host.locate`) shipped at v1.4, and then to v1.6 when **browser-realm portability** (Article VI, `Host.paths`, and two Node-only facilities replaced inside the library) shipped at v1.5, and then to v1.7 when **overrides** (Article VI, `resolve()`'s `overrides` option — config documents the embedder names, ranked after the entry) shipped at v1.6, and then past v1.7 (**sandbox roots**) and v1.8 (**a scalar under `append`**), both consumer-reported as well — all seven for the same reason, because a consumer needed it and an addition needs no turn in the queue (§15); the third displacement is the same consumer as the second, needing the other half of the same mechanism, the fourth is that consumer again, needing the library to load in the realm its own tools run in, and the fifth is that consumer once more, needing its operator's command line to be a layer the cascade governs; TOML adapter (run against `toml-test`). The TS generator sat **here rather than at v1.0** because it is the same shape of artifact as the JSON Schema exporter beside it — a translation of accumulated demands into a foreign type system — and freezing one while deferring its sibling would have been incoherent. It also has by far the larger surface to freeze: `load<T>()` is one signature, while a generator's *output format* makes every emitted construct a compatibility promise. Split into two milestones at v1.1 so that the tree is built once, under the first emitter, and the second inherits it.
12. **v1.10** — **Writing a value back** (Article IX): `locate` and `setValue` on one document, the first use of §4.3's door; Cascata's half of write-back. Inserting and deleting, and which document a merged value's edit belongs in, stay open.
13. **v1.11** — **Edit targets and writers** (Article IX): which document and in-document pointer a merged value is written in, `why()` entries carrying that pointer, and the YAML and JSON writers in the editing stage's shape.
14. **v1.12** — **After the review** (Article IX, §15): two memoizations that restore the bounded-cost claim, `sharedEdits` with a file grafted twice counted as shared, three edge corrections, and a documentation sweep.
15. **Future** — closing §9.1's self-hosting gap (the meta-schema approximates the leaf type-expression grammar with a superset `pattern` because the constraint vocabulary cannot name a grammar; §15); `$extends` fork mode; `merge-by-key`; CST layer for write-back; delegation parameters; remote delegation opt-in; multi-`$adopts` via C3 linearization (§6.1); `provide` retraction (monotone-legal, needs syntax; §5.5); `glob` as a type, which needs **expansion** semantics, a sandbox story, and a determinism story before it can mean anything (§15).

---

## 15. Settled Questions (amendment log)

All initial open questions are resolved; amendments are integrated into the articles cited.

### The freeze rule (from v1.0)

**This document freezes at v1.0.** From that release, of the three things an amendment can be:

- **A correction** — this document said something untrue about itself or about the implementation — stays permitted, always, and needs no version bump. Several of the entries below are corrections; a document that forbids fixing its own errors preserves them rather than its meaning.
- **An addition** — new vocabulary, a new article, a new future door — stays permitted, provided it changes **no existing meaning**. A schema valid before the addition is valid after, and means the same thing.
- **A change to an existing meaning** — a keyword that starts doing something different, a rule that starts refusing what it accepted — requires **v2.0**. There is no other way to make one.

The engineering constitution (`.specify/memory/constitution.md`) does **not** freeze: it governs process, not the language, and has been amended four times in seven milestones, each time because an implementer found it unsatisfiable as written. Freezing it would preserve those defects rather than the project's standards.

The bootstrap (§14 item 7) was scheduled before this point precisely so that the vocabulary would be suffered by its own author first. It found nine problems, all fixed above. That is what the freeze is standing on.

- **Diamond `provide` ordering** → settled by restriction: v1 `$adopts` is single-parent (chains only, diamonds impossible); C3 linearization pre-committed for future multi-adoption. See §6.1.
- **Leaf-DSL grammar** → settled: name-only algebra, TypeScript precedence (`[]` > `|`), set-canonical unions, decidable subsumption. See §9.1.
- **`required` × `provide`** → settled: guaranteed-key pattern is a feature (non-optional TS property); vacuous only under `final provide` (info lint); retraction monotone-legal but parked. See §5.5.
- **Naming** → settled: **Cascata**.
- **When a cascade strategy takes effect** → settled: **from the layer that declares it, downward.** The
  row added earlier in this milestone said "once a key accumulates, it keeps accumulating" without saying
  whether a late `append` reaches back over ancestors that had already combined under `replace`. A v0.3
  implementer read it as governing the whole key uniformly and said so; the discriminating case — root
  provides `[a]`, a middle layer `[b]`, a leaf declares `append` and provides `[c]` — yields `[a,b,c]`
  under that reading and `[b,c]` under this one. Settled downward, because §2.3 has authority flowing
  one way: a layer's declaration binds its descendants, never its ancestors, and a leaf retroactively
  changing what a middle layer's `replace` did is a layer reaching backwards. See §5.2.
- **Reserved keys in merged output** → settled: **directives, never data.** §9 named `$id`, `$version`,
  `$adopts`, `$pin` and `$schema` as reserved without saying what becomes of them once documents are
  folded, so nothing forbade `$schema` appearing in a merged configuration as an ordinary key — which is
  what a v0.3 implementer's first conformance case actually produced. They are stripped from the fold's
  output. See §9.
- **Cascade-strategy mutation** → settled: **a strategy may tighten toward accumulation and never away
  from it.** The table had a row forbidding the removal of inherited items under `append`, and no row at
  all for changing the strategy — so nothing forbade a descendant declaring `replace` for a key its
  ancestor declared `append`, which removes every inherited item by another route. Found by
  cross-artifact analysis of v0.3, whose own draft had chosen "the nearer layer's declaration governs"
  by analogy with value precedence. Precedence is the right rule for values and the wrong one for
  policy, because policy decides whether earlier values survive at all. See §5.2.
- **`$adopts` shape and tilde paths** → settled: **`$adopts` and `$schema` are single string scalars**, and a
  leading `~/` in a **config-authored** reference expands to the user's home directory. Both were silences
  rather than decisions, and both bit an implementer. §6.1 said `$adopts` takes exactly one parent but never
  said what the value looked like — and since duplicate keys are already refused (§4.2), a scalar makes
  "more than one parent" unwritable, so any diagnostic for it is unreachable. A sequence is therefore
  refused with a diagnostic that names the restriction, rather than being either legal or merely malformed.
  Separately, §9's own worked chain wrote `~/.config/house.yaml` while tilde expansion appeared nowhere in
  the specification, so the example could not have resolved. Expansion is limited to config-authored
  references, which are already sandbox-exempt under §8.1's razor, so it grants schemas no new reach.
  See §9.
- **Pin basis** → settled: **the exact bytes, not a canonical form.** §6.1 originally specified RFC 8785
  (JCS) canonicalization before SHA-256. Probing it against this model found it unimplementable in two
  independent ways: JCS serializes numbers as IEEE-754 doubles, so an exact integer past that range cannot
  be represented at all, and `2` (int) and `2.0` (float) — which §4.2 holds to be *different values* —
  serialize identically, producing a hash collision by construction in a security primitive. Hashing raw
  bytes is faithful, needs no canonicalizer, and follows W3C Subresource Integrity literally rather than by
  analogy. Cost accepted: a pin names one artifact byte-for-byte, so reformatting breaks it and the same
  document in another format hashes differently. See §6.1.
- **Remote pinning policy** → settled: **the library verifies, the pedigree legislates.** `$pin` is verified
  whenever present, absolutely; whether one is *required* is a governance decision belonging to a published
  root under §2.3's downward authority, and arrives with sealing (§6.3, roadmap v0.7). The prior text named
  the mechanism and was silent on the required/optional axis, which read as a mandate the library was failing
  to enforce. Unpinned links must be reportable so the policy is auditable. Inherent limit: a root's demand is
  readable only after the root is fetched, so it cannot protect its own first fetch — a lockfile closes that.
  See §11.
- **Mapping key order** → settled: **canonical (sorted), not authorial.** The prior rule preserved document order
  while declaring it insignificant for equality. Both of its stated justifications failed on inspection: `append`
  folding is ordered by layer and by sequence position, never by sibling-key order (§5.3, §6.1), and faithful errors
  come from spans, which every node carries unconditionally (§4.1, §10). What was left was a mapping that could
  compare equal to another yet enumerate differently — a discrepancy with no cited beneficiary. Sorting costs the
  authored order in dumps and gains agreement between equality and iteration. See §4.2.
- **Node provenance shape** → settled: `origin` lives *inside* `SourceSpan`, not as a sibling field on
  `Base`. A position is meaningless except relative to the document it indexes, so carrying them
  separately duplicates the relationship and admits the state this article exists to forbid — a node
  whose position and whose layer disagree. Amended after v0.1 implementation surfaced the divergence.
  See §4.1.

- **`format` vs `type: url`** → settled: **`format` is dropped; one mechanism.** §7 made `url`,
  `path`, `glob` predefined *types*, and separately §9 listed `format` among `demand`'s own keywords,
  glossed in §7 as "JSON Schema `format` in spirit" — two spellings admitted for one meaning, which
  cuts against Principle VI (every semantic distinction costs a distinct keyword, and its converse). A
  v0.4 implementer traced both citations, found the tension, and correctly declined to settle it. The
  deciding argument: types cascade and narrow (§7's own laws); a `format` keyword would not have, so
  the v0.7 meta-schema would have ended up with two ways to constrain a leaf's shape and only one of
  them monotone. Everything constraining a leaf's shape is therefore a type — `url`/`path`/`glob` stay
  built-in types, and any future `email`/`date-time` arrive the same way, as type names, not as a
  second keyword. §12's "Constraint leaf names" row is amended to match: the `format` *registry*'s
  semantics remain a legitimate crib, its keyword does not. See §7, §9, §12.
- **Nested demands** → settled: **`keys` joins §9's demand vocabulary; `keys` and `items` both nest to
  arbitrary depth.** §8's own worked example wrote `demand: { type: mapping, keys: { … } }`, but §9's
  vocabulary line never listed `keys`, and the v0.4 implementation could reach only one level into a
  value (`items`, for a sequence's own elements, capped there "for want of a citation authorizing
  more" per that milestone's own contract) — leaving a demanded mapping's *own* children
  unconstrainable by anything, and §5.2's "Struct openness" row, and v0.7's `seal`, with no subject to
  govern. `keys` now provides the missing mechanism and the missing citation for `items`'s
  generalization. `keys` ships in v0.4 as `unimplemented-demand-keyword` naming v0.5 — the posture
  `accept` already holds — with the nesting itself, and `items`'s generalization from one level to
  arbitrary depth, arriving in v0.5. See §8, §9, §14.

- **Narrowing an inherited type vs. name collision** → settled: **narrowing wins; collision is
  reserved for unrelated declarations, which v1 cannot produce.** §7 carried two laws that prescribed
  opposite responses to one syntactic act. "Descendants may narrow inherited types" requires
  redeclaring the name; "one flat namespace per pedigree, collision is an error" forbids exactly that.
  They are not two situations needing to be told apart — under §6.1's single-parent restriction the
  pedigree is a *chain*, so every pair of layers stands in an ancestor/descendant relation, and every
  same-name pair collision could ever see is precisely the shape a narrowing takes. The collision law
  was written for the multi-adoption world §6.1 pre-commits C3 linearization for, where two unrelated
  ancestors may each declare a name; in v1 it only ever fired on the case it was not written for. A
  v0.5 implementation therefore made narrowing impossible — a descendant redeclaring a type was
  refused as a collision, and the requirement asserting narrowing must work had no conformance case at
  all, which is why nothing caught it. Resolved in favour of the cascade law, since types that cannot
  be narrowed reduce `types:` to an abbreviation and forfeit most of Article IV's point. A
  redeclaration narrows **from its declaring layer downward**, matching §5.2's rule for cascade
  strategies; a widening needs no refusal because an ancestor's demand resolves the ancestor's own
  declaration and §5.4's whole-chain validation still applies it. §7 gains the worked narrowing whose
  absence caused this, the way §5.3 gained a worked cascade for the same reason. See §7, §6.1, §5.4.

- **`glob` as a built-in type** → settled: **dropped from v1.** `resource` is **singular** — every
  alternative denotes exactly one resource — and `glob` denotes a *set*, so listing it beside `url`
  and `path` conflated "a reference to a thing" with "a pattern matching many things" and made
  `resource[]` mean "an array of things-or-sets-of-things". Multiplicity belongs in the `[]`, never
  smuggled into the element type: an array of stylesheets is `resource[]`, enumerated.

  The decisive argument is not the category error but what an unexpanded glob *is*. A glob is only
  useful if something expands it into resources; expansion reads the filesystem, which is computation
  (§2.9, Principle VI), non-deterministic across machines, and a security surface. Without expansion,
  accepting a glob means accepting a string containing `*` that the system will never interpret —
  while inviting its author to believe it will. That is worse than refusing it. `glob` therefore
  belongs to the world that has expansion, and is parked in §14's Future list with the expansion,
  sandbox, and determinism stories it needs first.

  Consequences: `glob` leaves §7's built-in refinements and both of its examples; §12 loses its Globs
  row and `picomatch` from "software we don't write" (its only use in the implementation was
  validating this one type); and §7's stated house-defaults ergonomic — "our `resource` never allows
  globs" — is replaced, because it was never coherent: a correctly singular `resource` never admitted
  globs, so narrowing could not remove them. The real motivation for narrowing is between two singular
  alternatives — "URLs only; nothing served off local disk" — which is what §7's worked narrowing now
  shows. Supersedes, for `glob` only, the `format`-vs-`type` entry above, which had `url`/`path`/`glob`
  all staying as built-in types. See §7, §12, §14.

- **What Cascata is, and where the outside world stops** → settled: **it is a library a tool embeds,
  and it performs no I/O.** §1 framed the project as a *language* for six milestones, which is true
  and is the wrong first sentence for something a tool developer embeds. Rewritten around the
  launching point and the three consumers it owes different things to. The seam that framing implies
  is now **Article VI**: the library asks its host for bytes and never reads anything itself, which
  makes §8.4's remote opt-in and §11's sandbox promises structural instead of self-policed — a host
  that does not answer has denied the request. Half of that seam already existed: remote reads have
  gone through an injectable transport since v0.2, built so tests could be hermetic; local reads
  never did. Unifying them is what v0.7 adds, alongside `load()` and `resource` values resolved
  against their declaring document rather than merely shape-checked. Those land at v0.7 rather than
  v1.0 because the meta-schema bootstrap is `load()`'s first real consumer — self-hosting is the
  embedding story exercising itself. Also corrected in passing: §1 listed remote delegation as a v1
  non-goal, which §8.4 and §11 had already contradicted by gating it behind a user opt-in rather than
  forbidding it. See §1, §3, §11, §14, Article VI.

- **`values`' shape, and a version read from an empty pedigree** → settled: **`values` takes a bare
  demand; the schema language is versioned by the meta-schema's identity in its adopters' pedigrees,
  not by its own.** Both found by v0.7's own bootstrap, which is what §14 schedules it early to do.

  §9 introduced `values` by analogy to `items` and then left its *syntax* unstated, and the first
  implementation read it as taking a key declaration (`values: { demand: {…} }`) rather than the bare
  demand `items` takes. The analogy is not the argument that settles it — the failure mode is. Under
  the key-declaration reading, `values: { type: string }` — the spelling the analogy invites — parses,
  is accepted, and **constrains nothing**: a silent no-op, the worst outcome available. Under the bare
  demand, the wrong spelling contains `demand`, which is not a demand keyword, and is refused as
  `unknown-demand-keyword`. Loud beats silent. It also retires a smaller wart at no cost: the
  key-declaration form left room to write `delegate:` under `values`, which the pipeline never grants
  (§8's grants are scoped to `keys`), so the meta-schema had been promising something the
  implementation does not do; with a bare demand there is nowhere to write it.

  Separately, §11 claimed "the schema language itself is versioned via the meta-schema's own
  pedigree". It cannot be: a `PedigreeEntry` carries an identity and no `$version`, and §6.1's chain
  excludes the entry document, so the meta-schema resolved as its own entry has an **empty** pedigree.
  The claim had never been exercised because nothing before the bootstrap had a meta-schema to
  resolve. The true and useful statement is the one that survives: the meta-schema appears in the
  pedigree of every schema adopting it, by location and content hash, and the version is read from the
  document that identity names. See §9, §11.

  A third finding is settled without amending this document, because the text was already right and
  only the implementation was not: §9 states the per-key vocabulary as a closed list and Principle VI
  requires closure, but nothing enforced it — the one closed vocabulary in the language with no
  `unknown-…` refusal behind it, while `demand` and type entries each have one. Two corpus fixtures
  had carried a per-key `seal:` since that keyword moved into `demand` earlier in v0.7, passing for a
  reason they were not written for, and no milestone noticed. v0.7 closes it.

- **Five of this document's worked examples did not parse** → fixed: **quote a type expression
  containing `[]` inside a YAML flow mapping.** `demand: { type: resource[] }` is well-formed
  Cascata and malformed *YAML* — `[` opens a flow sequence, so the document is rejected before §9.1's
  grammar is ever consulted. §7 carried three such examples and §9's worked chain two. Nothing caught
  it in six milestones because no executed fixture is written that way: every corpus case uses block
  style, where the same expression is an ordinary plain scalar and needs no quoting. The examples
  were prose that had never been run. Found while drafting the meta-schema, when the draft was fed to
  the project's own parser rather than merely read. The fix is textual — five pairs of quotes — and
  the durable part is the rule now stated in §9.1, since the trap belongs to every schema author and
  not only to this document. A reminder that a worked example is only worth what executing it costs
  (§5.3, §7, and the reason both gained one).

- **Nested vs. top-level key declarations** → settled: **they are different shapes, and §9's claim
  of parity was wrong.** §9 said a nested `keys` constrains a mapping's children "the way" a schema's
  top-level `keys:` constrains the config's top level. It never did: a top-level entry carries
  `demand`, `provide`, `cascade`, `final` and `delegate`; a nested one carries `demand` and
  `delegate`. Found by drafting the meta-schema, which needed *two* types where the vocabulary
  appeared to offer one, and could not write either until the difference was named. Settled in favour
  of the split rather than of the prose, on the ground that `provide`, `cascade` and `final` state a
  **layer's authority over a key** — a relationship between documents, meaningful only where a schema
  declares a key of its own — while a nested key is part of a value's **shape**, which is what
  `demand` is for. `delegate` nests because §8's grant is per key at any depth and v0.6 built it so
  deliberately; it is the considered exception, not the loose end. Rejected: making `provide`,
  `cascade` and `final` nest, which would have needed real new semantics settled first (a nested
  `provide` injects a default deep inside a tree; a nested `cascade` gives a subkey its own merge
  strategy) for a parity nothing had asked for. See §9.

- **Whether the meta-schema can describe §9.1's leaf DSL** → settled: **no, and it approximates it
  with a `pattern` under one governing rule.** `Primary := "(" Union ")"` makes the type-expression
  language non-regular, so no `pattern` captures it and a schema cannot invoke the parser. The
  meta-schema's `pattern` is therefore a deliberate **superset**: it must accept every string the
  grammar accepts, may accept some the grammar rejects, and in practice differs only by not checking
  that parentheses balance. That asymmetry is what keeps the approximation from creating two
  contradicting authorities — the parser refuses what the pattern lets through, and nothing the
  pattern refuses could have been valid. A false rejection would be the contradiction, which is why
  the property is stated as a MUST and established by generating from the grammar rather than by
  examples.

  Two things worth recording for whoever revisits this. The obvious whitespace-tolerant pattern is
  **quadratic** — several adjacent optional whitespace groups compete for one run of spaces, giving
  catastrophic backtracking measured at 4× per doubling of input. Folding whitespace into the
  structural character classes, so that exactly one quantifier consumes each boundary, makes it
  linear at no cost in strictness. Do not "simplify" it back. And the honest consequence for §2.6:
  **self-hosting is complete except for leaf type expressions.** Closing that properly needs the
  vocabulary to be able to name a grammar, which is a v1+ question and is parked in §14 rather than
  papered over. See §9.1, §14.

- **One violation, reported 2^depth times** → settled: **a diagnostic is emitted once per violated
  demand per position**, and §10 now says so. Found by v1.0's implementer, who could satisfy the
  milestone's bound on the *walk* and not on the *output*, and said so plainly rather than reporting
  the half that worked.

  §9 says `keys` and `values` both apply where both cover an entry, and demands intersect. That is
  right and is not what changed. The consequence nobody had traced: where both arms recurse into one
  shared type, a violation at depth *d* is returned by each arm and doubles at every level up — so a
  **296-byte** configuration, legal and well inside §11's depth cap of 64, produced 1,048,576
  diagnostics at depth 20 and exhausted memory at depth 24. Verified independently, not taken on
  report.

  Settled as a **correction rather than a meaning change**, which is what let it land before the
  freeze rather than costing v2.0: §10 legislates what a diagnostic *carries* — the violated demand,
  the offending value, the pedigree position — and its canonical sentence describes one sentence per
  violation. It was silent on multiplicity. All 2^d copies were byte-identical across every field a
  consumer can read (code, demand, level, message, pedigree position, pointer, primary span, related
  spans), so the repetition communicated nothing and removing it takes nothing away. What was there
  was an artifact of one walk reaching one `(demand, value)` pair by two paths.

  One implementation note belongs with the rule, and **the first version of this entry got it wrong in
  a way worth preserving.** It said flatly that "deduplicating at the end does not help", and pinned
  that claim to the 296-byte depth-24 document. The implementer ran the sabotage against that exact
  case rather than a plausible one and found the claim false there: with a final-only pass, depth 24
  *survives*, in about eight seconds, because this pipeline's final pass runs over violations
  **before** diagnostics are rendered — so the sixteen million message-carrying objects are never
  built, and only the cheaper references are. The rule is still right and the placement still matters;
  the example did not demonstrate it. What does is **depth 40**, where 2^40 references fit in no
  machine and no final pass is reachable at all — a ~470-byte document, still inside §11's cap. Both
  cases are pinned in the suite now, the first for the defect and the second for the placement.

  That is the project's own recurring lesson landing on this document one more time: an example is
  worth what executing it costs, and a claim pinned to an example that does not exercise it is a
  claim nobody has tested. See §10, §9.

- **Article VII, corrected and generalized by its first implementation** → settled. The article was
  written days before it was built and had never been implemented against; five of its clauses needed
  work, and the milestone's own requirements needed more.

  **The generalization, and the only one of these that is an addition rather than a correction:** the
  numeric rule was a table of three spellings — `int`, `float`, `int | float` — which left every
  mixed union (`int | string`, `float | null`) to an implementer's judgment. Restated as the question
  it always was, **"does the accumulated demand admit `float`?"**, the three rows become consequences
  and every future union is settled in advance. `int | string` admits no float and yields `bigint`,
  so an author who wrote `int` and later widened does not silently lose exactness.

  **The corrections.** Keys are *inserted* in canonical order and cannot be *enumerated* in it —
  ECMA-262 hoists array-index keys to the front of every object, so `10, 2, b, a` enumerates
  `2, 10, a, b` regardless; the article now names this rather than leaving it to be debugged, and
  this milestone's own FR-009 had asserted the impossible version. The deep-immutability clause cited
  "the same means … including the `Map`-shaped hazard", describing a hazard a projection cannot have,
  since a mapping becomes an object and no `Map` survives. The undemanded-key row said "typed
  `unknown`", which cannot be a v1.0 obligation at all: `load<T>()` types the whole configuration
  with one caller-supplied `T`, so per-key typing is the v1.x generator's statement. And the article
  named neither the projection as a stage nor a function for it, while requiring it be reachable
  without `load()`; it is `project()`, and it depends on `merge()` rather than on `validate()`.
  Finally, `null`-versus-absence and the precision lint's *position* were both raised in the
  milestone's Edge Cases and answered nowhere; both are now stated. See §17, §10.

- **What v1.0 freezes, what a consumer receives, and where the type generator goes** → settled, and
  the three answers are one decision seen from three sides.

  **The freeze** is of this document, not the engineering constitution, and is additive-only:
  corrections always allowed, additions allowed while no existing meaning changes, a changed meaning
  requiring v2.0. §14 said "freeze the constitution" and this document calls *itself* the constitution
  while `CLAUDE.md` calls the other one the engineering constitution — an ambiguity nobody had had to
  resolve until the freeze was the next thing to do. The rule is stated in this section's own header
  because it governs this section.

  **The output surface** is Article VII, and it exists because of a gap nobody had named: seven
  milestones produced a `Node` tree and no way to read it as data, while §1 promised the tool
  developer "a validated configuration object". A consumer wanting `config.styles[0]` had to walk a
  tagged union with spans. The projection is null-prototype objects in canonical key order — null-
  prototype because a configuration key is author-controlled and `__proto__` must not be settable by
  writing it in YAML.

  Its sharpest rule: **the demand decides the numeric type, not the document.** `kind` is lexical, so
  a faithful projection would let a config author's punctuation — `30` versus `30.0` — decide whether
  the consuming application sees `bigint` or `number` under an unchanged schema. That is this
  project's own thesis inverted, since the schema demands and the config provides. `type: int` yields
  `bigint`, `type: float` and `type: int | float` yield `number`, and an undemanded key is `unknown`.
  Where normalization would actually drop a digit, an info-level lint (§10) fires on the *value*, not
  on the shape — a lint that cried on every `int | float` key would be ignored within a week.

  **The type generator moves to v1.x**, beside the JSON Schema exporter, because they are the same
  artifact — a translation of accumulated demands into a foreign type system — and freezing one while
  deferring its sibling is incoherent. `load<T>()` ships instead: a one-signature surface, where the
  generator's *output format* would have made every emitted construct a permanent promise at exactly
  the version that makes promises permanent. The cost is named rather than hidden in Article VII: a
  `T` that disagrees with its schema is a caller bug the library cannot catch, and removing that
  guesswork is precisely what the generator is for. See §14, §15, §17, §5.5.

- **Where `seal` lives, and two things its spelling never said** → settled: **`seal` is a `demand`
  keyword; `final` is a boolean; a schema may seal its own top level.** All three came out of
  drafting the meta-schema on paper during v0.7, which is precisely the feedback §14 schedules the
  bootstrap early to obtain — this time before any of the three had been implemented.

  §9 listed `seal` beside `provide`, `cascade`, `final` and `delegate`, which are governance: they say
  *who may speak about a key*. `seal` says what *shape a mapping value has*. It composes by
  intersection (`open ∩ closed = closed`) and narrows monotonically, which is what every demand does
  and what no governance keyword does; structurally it is `required`. Its misplacement had two
  consequences, and only the second is fatal. A per-key `seal` cannot reach a **nested** mapping —
  §15's own nested-demands entry had justified adding `keys` partly on the grounds of giving "v0.7's
  `seal` a subject to govern", and it would not have had one. And a per-key `seal` cannot appear
  inside a **named type** at all, since a type entry's vocabulary is `{demand, accept}`; because the
  meta-schema's central `demand` type is *recursive* it must be a named type, so no amount of
  nesting-fixing would have made the meta-schema writable. As a demand keyword `seal` reaches both
  for free and its monotonicity is the ordinary narrowing rule rather than a bespoke check.

  Two smaller things the same exercise found. **`final`'s syntax had never been written down** —
  §6.3 said `final` and §5.5 said `final provide`, neither saying whether that is a boolean or a bare
  marker; settled as `final: true`, consistent with `authority:`'s booleans and expressible in the
  meta-schema, with `final: false` legal and inert where no ancestor sealed and refused as a
  weakening where one did. And **nothing could close a document's top level**: `seal` was per-key and
  a document root is not a key, so §5.2's openness row was unreachable there and a schema could not
  refuse a config carrying a stray top-level key. A schema's top-level `seal` now governs the
  config's own top level, exactly as its top-level `keys:` already does. One keyword, two scopes, one
  meaning. See §9, §6.3, §5.2.

- **A mapping whose keys the schema cannot enumerate** → settled: **`values`, a sibling to `keys`.**
  `keys` names children one at a time, which describes every mapping whose shape the schema knows and
  no mapping whose keys are the author's to choose. The meta-schema's own `keys:` section is the
  second kind, so the language could not describe its own central construct — found while planning
  v0.7, before any code, which is the bootstrap earning its place in the roadmap. `values` constrains
  every entry regardless of key, exactly as `items` constrains every element of a sequence; the
  parallel is the argument for the name. Rejected: a reserved `"*"` inside `keys`, which collides with
  a literal key named `*` and needs an escape rule — a heuristic, and §8.1's razor exists to keep
  heuristics out of exactly this decision. Composition needed no new rule: where `keys` and `values`
  both cover an entry, demands intersect (§5.1). Orthogonal to `seal`, which answers *which* keys may
  appear rather than what shape they take. See §9, §5.2.

- **Recursive types** → settled: **guarded recursion is legal; only unguarded cycles are refused.**
  v0.5 refused every type reachable from itself as `unresolvable-type-cycle`, which is right for
  `A → B → A` through type expressions alone — that has no fixpoint any value can reach — and wrong
  for a type that reaches itself through `keys`, `items`, or `values`. The latter is *productive*:
  every traversal consumes a level of the document being checked, so it terminates on any finite
  value. The blanket rule was written for the unguarded case and fired on both, and nothing noticed
  because no milestone before the bootstrap needed a recursive type. The meta-schema needs one
  unavoidably: a key declaration contains a demand, a demand contains `keys`, and `keys` contains key
  declarations. A language whose types cannot recurse cannot describe its own schemas, which makes
  §2.6 unreachable. See §7.

- **Constraining the reserved `$`-keys** → settled: **a third top-level section, `directives:`, closed
  to the six of them.** Reserved keys are directives rather than data and are stripped before a
  configuration is produced (§9) — correctly, and it means a meta-schema constraining them through
  `keys:` would be constraining something the pipeline has already removed. Two ways out: give the
  schema-as-config path a mode where reserved keys survive the fold, or give them their own section.
  The mode was rejected because it makes one pipeline mean two things, which is precisely what §16's
  determinism law forbids and what §3's stage isolation is for. `directives:` keeps the data plane
  exactly as it is and puts the constraints where the category boundary already ran. Its payoff is
  immediate and not only bootstrap-shaped: `$adopts` is a single string and `$pin` is
  `sha256:<64 hex>` (§6.1, §9), rules that until now existed only as hand-written checks in the
  implementation with no schema able to state them. See §9, §6.1.

- **Diagnostic severity** → settled: **two levels, `error` and `info`.** §5.5 has mandated an
  info-level lint since it was written, and §8.1 now mandates a second; the `Diagnostic` type had no
  level at all, so every diagnostic was a refusal and neither lint could be implemented. This was a
  requirement ratified as a MUST against a component that could not satisfy it — the failure mode
  Principle V's ratification corollary names, found here by reading rather than by shipping. Two
  levels because both mandated lints are the same kind of thing: a "this does not mean what you
  think" observation about a construct that is legitimate. A third rank is added when something needs
  it, not in advance. Consequence for §16: "a configuration or diagnostics, never both" was written
  when every diagnostic was fatal, and now means *never a configuration and errors* — lints ride
  along with a successful result, because a result that must be thrown away to read its warnings is a
  result whose warnings nobody reads. See §10, §5.5, §8.1, §16.

- **`delegate: allow` at a key demanding a leaf shape** → settled: **info-level lint, not a refusal.**
  Left as an unanswered Edge Case by v0.6. At a granted key a string is an instruction (§8), so an
  *inline* string never reaches that key's own `demand` — which makes `delegate: allow` beside
  `demand: { type: string }` almost certainly not what its author meant. Almost: a fragment document
  whose entire content is a string scalar satisfies such a demand exactly, so the schema is
  surprising rather than unusable, and refusing it would overstate the case. The lint follows §5.5's
  precedent for the same reason that section gives — the pattern is legitimate, the lint teaches. It
  matters now rather than at leisure because the meta-schema is written in this same vocabulary. See
  §8.1, §10.

- **How far the host boundary reaches** → settled: **bytes, canonical identity, and the cache; the
  Node host ships as a separate entry point.** Article VI said the library never opens a file, and
  v0.6 opened files in three places — the local read, `realpath` for the sandbox check, and the
  on-disk cache. Only the first is obviously a read, which is why the other two survived the article
  being written. All three move behind the host. Canonical identity is the interesting one: it looks
  like meaning, and the article forbids the host supplying meaning. It is supply — only the host knows
  how its storage names things — and the division holds precisely where it matters: the host says
  *which thing is at this location*, the library compares identities and decides *whether it is
  confined*. A host that lies about identity can defeat confinement, which is the right place for that
  trust, since a host that lies can equally answer with different bytes. And the article does not
  forbid Cascata shipping a host: it forbids the *library* doing I/O. Shipping a Node host on the far
  side of the seam is what keeps the ordinary embedder from writing a filesystem adapter to read a
  file, while importing the library proper still cannot touch a disk. See §16, §11.

- **Sealing, fully stated** → settled: **`final` closes the question, and closes it for the config too
  when it carries a `provide`.** §6.3 was three lines and left `final` glossed as "no override at
  all", which does not say *by whom*. Settled in two parts, because they are two facts: no descendant
  **schema** layer may declare a `final` key at all — not even a legal narrowing, since `final` says
  the question is closed rather than that it must be answered more tightly — and a `final` key that
  also carries `provide` is a constant the **config** cannot set either, which is what makes §5.5's
  pinned-constant pattern real and gives that section's vacuous-`required` lint something to fire on.
  A `final` key without `provide` freezes only the demand. §6.3's two per-schema powers land at v0.7
  as well, in a new top-level `authority:` section rather than as new reserved `$`-keys — the
  reserved list is closed at six and the resolver, the fold's stripping rule and the meta-schema all
  depend on it — and rather than inside `directives:`, since constraining a directive and asserting
  governance are two jobs. They are: a root demanding pinned adoption (§11 parked it here
  explicitly), and a root declaring itself final against forking — the latter **recorded and queryable but enforcing nothing** until
  `$extends` exists (§6.2), stated now rather than with that keyword so a root published today can
  bind a fork attempted tomorrow. See §6.3, §5.5, §11, §5.2.

- **The accumulated demand, and the emitted type** → added at v1.1 as **Article VIII**, an addition under
  the freeze rule. Article VII had named the generator without saying what it derives from, and the first
  design that suggests itself — emit one TypeScript type per layer and let the compiler intersect them
  with `&` — is unsound twice over: a root admitting `int | float` and a house narrowing to `int` project
  to `number` and `bigint`, and `number & bigint` is `never`; and an open layer's index signature survives
  a closed layer's intersection, so `seal: closed` would not close. Both the numeric class and the seal
  must be computed from the accumulated demand, not left to the host type system — and once two keywords
  need the intersection, every keyword should have it. The tree already half-existed: §17's numeric rule
  had been reading one slice of it since v1.0, driven by a concrete document. Article VIII names the
  whole of it as a stage, value-free, and makes both emitters translations of it, which is what §12 had
  called the exporter's "accumulated intersection" all along. Two further choices are recorded: the
  emitted type carries literal unions for scalar `enum`s and pinned constants, and JSDoc for the
  constraints TypeScript cannot express, the comments declared non-contractual so that only the types
  are promises; and soundness against the validator is the conformance rule, so that the generator never
  has an expected output written by hand. See §18, §14, §17, §5.5, §12.

- **Article VIII, corrected by its first implementation** → settled, at v1.1, as corrections. The
  article was written days before it was built, and five of its rows or clauses were wrong in ways
  only running the compiler and the corpus could show. **Closed-empty:** "no index signature" emits
  `{}`, which admits every non-nullish value; a closed mapping with no keys is
  `{ readonly [key: string]: never }`. **The index signature beside an optional sibling** carries
  `undefined`, because TypeScript requires it to subsume its siblings — the article's "no
  `| undefined`" clause now scopes itself to a property's own type. **`url` and `path` refine
  `string`**: a rule that intersected built-ins only with themselves turned §7's own worked
  `resource` into `never`, found by the corpus. **A position that names a type and adds structure of
  its own** had a row for each and none for both, and the first implementation emitted the alias
  alone — wider than the accumulated demand, a sound-looking hole no schema in the corpus exercised;
  it now intersects, as two declarations do. **The soundness law's negative half** overstated what a
  type can express: seven of the corpus's twenty-two type-shaped refusals typecheck, five for the
  `url`/`path` limit and two for `required` at positions whose type is `unknown`; the law now names
  the limit and the oracle names the cases. Closedness is enforced at object literals only, and the
  article says so.

  Three things found beside the article, recorded rather than smoothed: **no descriptor in the
  validate corpus expected `seal-violation`**, so a v0.7 guarantee had no case until v1.1 added four
  by hand; **`resolve()` could not launch from a schema**, since a schema carries `$adopts` and the
  resolver read `$schema`, so `generateTypes()` would have emitted every leaf's demands alone had
  the oracle not been run against a chain; and **a type-vocabulary check exported since v0.5 is
  called from nowhere**, so `unknown-type-entry-keyword` and a non-mapping `types.<name>.demand`
  are catalogued codes with a dead path — a pre-existing defect of `validate()`, left for its own
  milestone because fixing it changes what `validate()` refuses. See §18, §7, §17, §10.

- **The JSON adapter, and the host seam's own types** → added at v1.2 as an **addition** and a
  **correction**, respectively. The addition is §14 item 11's JSON adapter, taken ahead of item 10's
  JSON Schema exporter: the two are independent, an addition changes no existing meaning, and a
  consumer existed for one and not the other — an archive host that renders a photograph's metadata
  as JSON bytes at a location no file occupies. §12's RFC 8259 row was the oracle and needed no
  change. Three things the milestone found, recorded rather than smoothed:

  **The registry was real and nothing was plugged into it.** `src/adapters/registry.ts` was written
  at v0.2 explicitly so a second adapter could join with no change to `resolve/` or `graph/`, and
  that held exactly. But the orchestrator that consults it never did: both of `src/index.ts`'s
  parse-at-location sites read the format and then compared it to the literal `"yaml"`, so
  registering an adapter changed nothing a caller could reach until both were made to look it up. A
  seam is not proved by the code on its own side of it.

  **Two adapters may differ about their own grammars.** JSON's `JSON-text = ws value ws` has no
  production for an empty document and YAML's has one, so an empty `.json` file is refused and an
  empty `.yaml` file is a null document. §16's determinism law is not violated: that law forbids two
  **hosts** disagreeing about one document, not two grammars differing about what each admits. Named
  here because it is the first place the question could be asked at all.

  **No new diagnostic code, and four floor rules unreachable.** Every way a JSON document can be
  wrong is a hazard that already had a name — `malformed-document` for the grammar,
  `duplicate-key`, `invalid-encoding` (including an unpaired `\uXXXX` surrogate, which is text that
  cannot be UTF-8), and the two caps. And `non-string-key`, `unsupported-tag`,
  `multiple-documents` and `alias-cycle` cannot be produced from this grammar at all; the corpus
  carries the nearest legal document for each so the silence is an answer rather than an omission.

  The **correction** is that `Host` and `HostReadResult` are now exported from the public surface.
  Article VI obliges an embedder to write a host, and until v1.2 neither name was reachable from the
  package — measured against the published surface with `deno check`, which said "declares 'Host'
  locally, but it is not exported". Both types have existed since v0.7 and `Host` already appeared in
  `LoadOptions`; nothing about either changed, only its reachability. A specification that names an
  obligation whose vocabulary it does not publish has misdescribed its own implementation, which is
  what a correction is for. See §12, §14, §16, §4.2, §11.

- **The launching schema** (v1.3, 2026-09-02) → an **addition** under the freeze rule. `resolve()` and `load()` accept `schema?: string`, consulted only when the entry names no `$schema`: the entry is then resolved as if it had written that line, config-authored, anchored at a zero-width span in the entry document. An authored `$schema` wins and the option is never read; without the option nothing changes. Recorded in Article VI (§16). The consumer is BelType, which hands Cascata a Markdown file's frontmatter as a position-preserving redaction and cannot insert a line without moving every span; its shell knows which venue schema governs a silent document. Two facts the milestone recorded rather than smoothed: the corpus case format's `cites` pattern admitted only `v0.2 FR-n`, so a v1.3 case could not be written until the pattern was widened — a format that cannot cite its own present is a format nobody has added to in a while; and the milestone folder holds one `spec.md` in place of the usual seven files, stated in that file's Complexity Tracking, because the whole design is one optional field and one branch.

- **Overrides** (v1.6, 2026-09-07) → an **addition** under the freeze rule, reported from outside by the same consumer as v1.3 through v1.5. `resolve()` and `load()` accept `overrides?: readonly string[]`: config documents the embedder names, read after the entry's chain and ranked after the entry in the order given. The consumer's problem was a command line. BelType's operator sets a document key with a flag, and the embedder had nowhere to put that value except a deep merge over the projected value after `load()` returned — where no demand saw it, a `final` did not hold, and `why()` named the document that lost. Three shapes inside the vocabulary were tried first and none holds: nothing stands nearer than the entry in §6.1's chain; delegation grafts horizontally into its parent's own layer (§8.2) and cannot outrank it; and "delegate and start a layer" is a keyword §8.4 reserves, with laws still unwritten. What fits is what the launching schema (v1.3) already is — an embedder's option standing in for a line nobody wrote — there a `$schema`, here whole documents. The mechanism is small because the fold was already a ranked fold: `Graph` gains an additive optional `overrides`, `deriveLayers` pushes each as a `role: "config"` layer after the entry, and everything downstream — demands, `final`, `append`, delegation, provenance — applies unchanged, which is the point. One new code, `override-reserved-key`: an override carries no `$`-key, under its own code rather than `fragment-reserved-key` because the two refuse for different reasons — a fragment cannot start a pedigree, an override must not start a second one. Not registered with the graph builder, because an override is a layer and not a node: identical bytes are two layers, and there is nothing to deduplicate. Recorded in Article VI (§16). The word carries a caveat, written into the law rather than spent on a second keyword: `overrides` is the trade's name for the command line's contribution, and under an accumulating key an override adds. Rejected on the way, and recorded because it was the consumer's working code: the embedder-side merge, for the three failures above.
- **A library that loads where Node does not** (v1.5, 2026-09-03) → an **addition**, reported from outside by the same consumer as v1.3 and v1.4. Cascata could not be evaluated in a browser realm at all: `node:crypto` (one `createHash` call), the `Buffer` global (two byte-length calls), and — found by the boundary sweep written for the first two, not by the report — `node:path` in three files and `node:os` in one. A bare `node:` import fails before any code runs, so there was no partial mode and no diagnostic; the library simply did not load. Three answers, each chosen for a different reason. **SHA-256 became arithmetic this repository owns** (`src/resolve/sha256.ts`, FIPS 180-4, checked against `node:crypto` and the standard's published vectors): a `Host.hash` verb would have handed every embedder a digest to implement for one call, and `crypto.subtle` is async on both platforms, which would have made `createDocumentIdentity` async for no observable gain. **`Buffer.byteLength` became a counting loop** (`utf8ByteLength`): `TextEncoder().encode(s).length` is exactly correct and allocates the encoded copy, which is free everywhere except at the size-limit check, whose whole job is to refuse an over-large document without materializing it twice. **Path semantics became the host's answer** (`Host.paths`), because unlike the other two they are not arithmetic: what `dirname("C:\a\b")` is, and whether `\\server\share` is absolute, are facts about a platform, and reimplementing them would have traded a portability bug for a Windows one. `createNodeHost` hands over `node:path`'s own functions, so Node behavior is unchanged. Recorded in Article VI (§16), with §11 gaining the clause that bounds it — §8.4's absolute-delegated-path refusal is judged in the host's terms, because judged in POSIX terms on Windows it refuses nothing. **A partial shim is worse than none**, which is the consumer's finding and worth keeping: a `Buffer` stand-in carrying only what Cascata needed turned `es-module-lexer`'s working non-Node fallback into a crash, because libraries feature-detect that global. The one bounded behavior change is named in §16: a Windows embedder with a custom host must now answer `paths`. The mechanical sweep that found the four sites nobody reported is in `tests/unit/layering.test.ts`, beside the I/O sweep it extends — the two facilities that broke this were both on the *permitted* built-ins list, which is precisely why nothing caught them.
- **Host-resolvable identity, and a sandbox root that contains** (v1.4, 2026-09-03) → one **addition** and one **correction**, found together by the same consumer. The addition: `Host` gains an optional `locate(reference)`, and a `$schema`/`$adopts` reference — the launching schema included — whose scheme is not `https:` is offered to the host before it is refused. The host answers with a location, an absolute path or an `https://` URL, and everything downstream is the code that already reads locations; a scheme no host claims is `unsupported-scheme` exactly as before, and a host that implements nothing is v1.3 unchanged, which is what makes this an addition rather than a changed meaning. A located reference is not sandbox-checked, because the host chose the location and the sandbox confines what a document's own text can reach (§8.1's reasoning, applied to a fact about *who chose* rather than *who wrote*); the exemption does not travel down the chain. Recorded in Article VI (§16), with §11 gaining the clause that bounds it. The consumer is BelType again, whose root schema ships inside its own installed package: the absolute path differs on every machine, so a venue's `$adopts` line cannot name one and `beltype:document` must. Rejected on the way, and recorded because the reasoning is the interesting part: overloading `canonicalize` — no new API at all — would have let this codebase's own test double, whose `canonicalize` is the identity function, claim `data:`, `file:` and `http:` by accident and silently break three standing conformance cases; a door that opens for the most natural implementation is the wrong door.

  The **correction** is that a `sandboxRoot` naming a filesystem root now contains what is under it. Containment was `location === root || location.startsWith(root + separator)`, so `sandboxRoot: "/"` tested `startsWith("//")` and refused every reference except the root document itself — the one value that plainly means "contain nothing, admit everything" admitting nothing. No caller can have depended on it: a library that refuses everything is noticed on its first run, and a caller wanting confinement passed a real directory. That is the argument the freeze rule wants, and it is written here rather than left implied, because "it was obviously a bug" is not one. The separator is now appended only where the root does not already end in one; `/sandbox` still does not contain `/sandboxfoo`, and that half had no test until this milestone wrote one. See §16, §11, §14, §8.4.

- **The open edges** (v1.12.1, 2026-10-08) → the edges the v1.12 handoff named as noticed and not fixed, settled one at a time by the owner. *A clarification:* `editTarget`'s `ok` answers where a value lives, and only the writer answers whether it is written (Article IX), because some refusals live in bytes `editTarget` never reads, or in the value it is never given. Making `editTarget` read the file was rejected: it would make it read files, and would still not see the value. **Parked by name:** asking the writer about many values of one document parses the document once per question, so a tool that checks every field before offering it pays a parse per field; the cure is a writer that parses once and answers many questions against that one version, as a language server answers against an opened document, and it waits for a consumer that needs it. *A correction:* a writer's `locate` ignored the writer's own `sharedEdits` and refused an alias copy its `write` wrote under `allow`, so the editing stage could make an edit it could not record the address of; `locate` now follows the policy, and the default is unchanged. *A correction under §12:* a pointer segment with a leading zero (`/01`, `/00`) was read as a list index, where RFC 6901, adopted verbatim, defines an index as `0` or digits with no leading zero; such a segment now names no item of a list, and is absent wherever a pointer is answered (`why()`, `editTarget`, `locate`, `setValue`). It is a key like any other in a mapping. Refusing what the adopted standard itself refuses is a correction, by the reading v1.9 made explicit. *A correction of diagnostics alone:* a stream of more than one document is refused as before, but it is now reported once, at the second document, in Cascata's words rather than the `yaml` package's (which told the reader to call a function of it), and nothing from the second document's prefix on is diagnosed — Cascata never reads it. Before, a byte-order mark that YAML 1.2.2 admits at a later document's start was called misplaced, and one ahead of a `---`, which `yaml` reads as content, hid the second document entirely and was the only error reported. *A correction of position:* inside a merge key's list (`<<: [*a, *b]`), an item that is not a mapping, or an alias with no anchor, is reported at that item, not across the whole list.

- **After the review: cost, shared edits, and three slips** (v1.12, 2026-10-08) → from one review of v1.11.1 by 0km, a consumer still at the design stage (issues #9 to #13); specs/022-after-the-review. *Two corrections of cost alone.* Reading was quadratic in line length (the column of every node counted from the start of its line) and asking `why()` or `editTarget()` of every value was quadratic in the document (each call walked the whole tree); both are now one table or one index, built once — the v1.10 entry above records the correction to its own claim. *One addition that closes a hole.* A file delegated to at two places was editable through either, and the edit changed both: that is the shared-value hazard Article IX refuses for aliases, now refused for grafts too. With it, the refusal becomes a policy, `sharedEdits` (`refuse`, the default; `warn`; `allow`), set by the embedder where its writers and edit targets are made — the tool that knows whether changing every copy is what its user means is the tool, not the library. *Three corrections at edges.* An empty document after a byte-order mark was located before the mark, a leftover of the days when the mark was stripped (v1.9); the writer emitted a tag that contradicted its value (`!!int x`), which only Cascata's own reader would read as intended, so a tag is now kept only where it holds the value, the mate of the quoting law; and a bare `? a` key was dropped on reading, where the information model (§4.2) keeps null, an absent key and an empty value as three states. **The one bounded change of behavior**, named: `? a`, and `{a}` in a flow mapping, now read as a mapping with `a: null` where they read as empty. A correction under the freeze reading: it refuses nothing, and reads what §4.2 already said it reads. The documents were swept claim by claim in the same round, after the review found three that no longer said what the code does.

- **The Node host answers a path's true spelling** (v1.11.1, 2026-10-08) → a **correction** of the shipped host, found while checking the write sandbox of the source-graph library Cascata now writes through. `createNodeHost`'s `canonicalize` used Node's JavaScript `realpathSync`, which resolves symbolic links but keeps the casing and Unicode form it is given; on a case- or normalization-folding file system (macOS's default; Windows) one file under two spellings was answered as two identities, and a `sandboxRoot` typed in the wrong case refused its own files. It now uses `realpathSync.native`, the operating system's own answer, which is what Article VI's contract — "the canonical identity of a location" — always asked for; third-party hosts are unaffected. **Named as open rather than implied fixed:** the graph's own identity and cycle detection remain lexical, so a document reached under two spellings is still two locations to the graph — a schema adopting itself under another spelling resolves today with itself twice in its pedigree. Closing that means identifying documents through the host's canonical answer, which would refuse such a self-adoption as the cycle it is; parked by the owner as issue #8. See Article VI.

- **Edit targets, and writers** (v1.11, 2026-10-08) → two **additions** to Article IX, completing Cascata's half of write-back's first slice for a tool that edits through a cascade. `editTarget` answers which document, and which pointer inside it, holds the value that won at a merged pointer; a schema's `provide` is refused as `edit-target-inherited`, naming its layer, and a remote document as `edit-target-remote`. `why()`'s entries gain `pointer`, the value's position inside its own document — a new field on an existing result, which changes no existing one. And `locate`/`setValue` are offered as YAML and JSON writers in the editing stage's shape, so the session that stages, rebases and commits edits needs no knowledge of either format. The view-update question stays open and is now refused by name rather than by silence. See §19.

- **A document's cost is bounded by its size** (v1.10, 2026-10-08) → two **corrections**, found while 018 was built, and bundled because they are one property. *The first is of cost alone.* Reading a YAML document was quadratic in its aliases — 4,000 aliases in 142 KB took ten seconds — because each alias asked the `yaml` package to search the document for its anchor. Cascata now resolves every alias in one pass, with a table of anchors built in document order, which is exactly `yaml`'s own rule (the nearest preceding anchor of that name) computed once. Nothing reads differently and nothing is refused. *The second refuses documents that loaded.* Cascata expands every alias into a copy, by design (§4.2: the model never contains references), so a few hundred bytes of aliases nested ten wide — the "billion laughs" — expanded into millions of nodes: 280 bytes took 1.2 s at five levels, and eight levels would run for hours. The 8 MiB cap never saw it, because it measured bytes. §4.2 and §11 had always promised that **document size** is capped; a document whose model is a thousand times larger than what it writes is not inside that promise, so enforcing it is a correction of the implementation to the stated rule, made under the reading this log states for v1.9 (refusing what a stated rule already excludes is a correction; a new rule needs v2.0). The budget is strict, at the owner's word: the expanded tree may hold at most ten times the nodes the document writes, plus ten thousand, and the count is checked as the expansion proceeds, so a bomb stops at the alias that crosses it, as `expansion-limit-exceeded`. Go's YAML library refuses "excessive aliasing" by a ratio of the same shape, more generous for small documents; Java's SnakeYAML caps aliases per collection at 50. Both are the precedent; ours is stricter, and an embedder may raise it through the parse limits, as with depth and bytes. *A third, of cost alone, found by following the second:* `yaml` checks each new key of a mapping against every key already there, so one flat mapping of 32,000 keys took eighteen seconds to read. Cascata already refuses duplicate keys by its own rule (§4.2), with a map, so the parser's check is switched off (`uniqueKeys: false`); 64,000 keys now read in half a second, and every diagnostic is byte-identical on a battery of 26 duplicate cases — quoting, merge keys, flow mappings, non-ASCII, anchored keys. **The one bounded change of behavior**, named: a document that expands more than tenfold beyond ten thousand nodes is refused. See §4.2, §11. *(Corrected in v1.12: the claim did not hold for line length. Every node's column was counted from the start of its line, so one line of 40,000 items took about forty times longer than the same items on 40,000 lines; columns are now one table, built with the byte table. And asking `why()` or `editTarget()` of a value walked its whole document, so asking about every value was quadratic; the pointers of a document are now indexed once, on first use.)*

- **Writing a value back** (v1.10, 2026-10-08) → an **addition**: Article IX. Asked for by the owner as Cascata's half of write-back, designed with Provenance (its `docs/write-back.md`), after a design conversation that settled three things recorded here because they bound this article. **Cascata takes new formats by its existing rule** (§4.2): a KDL or XML file is a configuration layer only as far as it fits the model, and everything else is data — read and written back, never cascaded. **An edit carries two addresses**, its bytes and its meaning (document, pointer, value), so the caller's session can find the target again after the file moved; this article supplies both halves for YAML and JSON, and nothing else. **One parser per format**: two parsers of one file could disagree about where its bytes are, so the format that measured a value is the only one that writes it. The prior art is the Language Server Protocol's `TextEdit` (a range and new text against a version) and the lens laws of bidirectional transformation (get-then-put changes nothing; put-then-get returns the edit), which are this article's first two laws; the third is Provenance's "edits are splices". Refused in this first version rather than guessed: values reached through an alias, block scalars, containers. See §19, §4.3.

- **Spans count stored bytes** (v1.9, 2026-10-06) → **corrections**, reported from outside by a consumer at the design stage (issue #6), and bundled because they answer one question: what does a position count? §4.2 now answers it in two halves. **Offsets count the stored bytes**, because a span exists so that a machine can find those bytes again and pins hash them exactly; **line and column count what a person sees**, because that is who reads them. Each correction below is a place where the implementation, or a sentence of this document, mixed the halves.

  **The hygiene sentence.** §4.2 said "line endings normalized for span math". The corpus has contradicted it since v0.1: for `a: 1\r\nb: 2\r\n`, `encoding/crlf-line-endings` places `/b` at offset 9, counting the carriage return, and it was right to — a span on a CRLF file computed over normalized text points one byte early per line. Only the line number is independent of the terminator, and that is what the sentence should have said.

  **The byte-order mark.** Both adapters stripped a leading mark before computing spans, so it contributed zero bytes to every offset — contradicting §4.1, whose span carries a *byte offset* and says nothing of removing one — while the `invalid-encoding` diagnostic, computed on the raw bytes before decoding, counted it in its offset *and* its column. Offsets now count the mark on every path; no column counts the mark at the very start of the bytes, and every column counts any other U+FEFF, which is what an editor does — its decoder drops one leading mark and keeps every other as text. The reason is one address space: Provenance, the source-graph library, addresses stored bytes with the mark included, adopted bytes over UTF-16 *so that* a Cascata span would cross into it unconverted, and with a mark still needed converting by three. The prior art is unanimous for offsets and settles the cost of the alternative. The Rust compiler normalizes CRLF and strips the mark before parsing; its JSON output's `byte_start`/`byte_end`, computed over the normalized text, broke `cargo fix` on Windows, which splices files at those offsets, and since 2019 they are converted back so that they "can be used to index the original file" (rust-lang/rust#65074), mark and CRLF alike, with line and column untouched. `go/scanner` and tree-sitter count the mark in their offsets; tree-sitter's character column skips it, which is this document's column.

  **A lone carriage return in YAML.** §12 mandates YAML 1.2.2, whose `b-break` is CRLF, CR or LF, and the `yaml` package does not treat a lone CR as a break: `a: 1⏎` (a lone CR at ⏎) read as the string `"1\r"`, and `- x⏎- y⏎` as a sequence of one item. Silently wrong values, against a mandate this document already stated. The adapter now hands the parser an LF in place of each CR that no LF follows — one byte for one byte, so no offset moves, and YAML 1.2.2 normalizes every line break inside scalar content to a line feed, so the values are exactly the standard's. **Refusing a lone CR instead was considered and rejected**: under the freeze rule it is "a rule that starts refusing what it accepted", which only v2.0 may make, and the mandate already says what the document means.

  **A misplaced byte-order mark in YAML.** YAML 1.2.2 admits a mark in a document prefix — before a document's content, repeatably, each optionally followed by comment lines — and inside a quoted scalar, and nowhere else (`nb-char` excludes it). The `yaml` package admitted one silently almost anywhere else: in a plain key, as the invisible first character of `"\uFEFFb"`; inside a plain or block scalar's value; in a flow collection; in an indent; after `---`; and in a comment, where it was dropped with the comment and the tree came out right. Every one is now `malformed-document` at the mark's offset, which is what the JSON adapter already answers for a mark anywhere but its first byte. **This refuses documents Cascata used to accept, and it is still a correction, by the reading of the freeze rule this entry makes explicit:** refusing what the standard §12 mandates itself refuses is a correction, because the specification promised that standard and those documents were never in it; refusing what that standard accepts is a new rule, and needs v2.0. The two halves of this entry are that reading applied twice — a lone CR is valid YAML 1.2.2, so it is read as the standard reads it and never refused; a mark outside a prefix or a quoted scalar is not, so it is refused, even where, as in a comment, the old reading happened to give the right tree.

  **Lines in JSON.** RFC 8259 has no lines; a lone CR is whitespace, and the JSON adapter and the `invalid-encoding` locator counted LF alone. A lone CR now ends a line on every path, which is the Language Server Protocol's set (`\n`, `\r\n`, `\r`) and the one a person's editor shows.

  **The behavior changes, named rather than glossed.** In a document that begins with a mark, every offset moves by +3, and the `invalid-encoding` column on its first line by −1. A YAML document with a lone CR reads with the values YAML 1.2.2 gives it rather than the ones it was given. A YAML document with a mark outside a document prefix or a quoted scalar is refused. A JSON document with a lone CR reports later line numbers past it. **What does not change:** any tree read from a document without a lone CR; every line and column outside the `invalid-encoding` diagnostic on a marked file; pins and document identity, which always hashed the exact bytes. Superseded by forward pointer, their text kept as history: v0.1 FR-010 and the v0.1 edge case on the mark (`specs/001-information-model-yaml-adapter/spec.md`), whose "positions" was true of line and column only, and v1.2 FR-004 (`specs/011-json-adapter/spec.md`). See §4.2.

- **A scalar under `append`** (v1.8, 2026-09-22) → an **addition** under the freeze rule, reported from outside by the same consumer (issue #3), and the argument written down rather than assumed. The rule forbids a rule that starts refusing what it accepted; this is the reverse. A key under `cascade: append` refused every contribution that was not a sequence, and the commonest contribution there is — one stylesheet, one component — is a scalar: `styles: ./report.css` is what an author writes first, `[./report.css]` what they write after reading the error, and the consumer's own page builder carried a branch accepting a single string for exactly that reason. A scalar under `append` is now a sequence of that one scalar, at either moment the fold checks appendability (a layer's fresh contribution, and the value already there when a strategy first tightens to `append`), extended onto the inherited list in rank order so §5.2's monotonicity is untouched; the author is told with `append-scalar-wrapped`, `level: "info"`, at the scalar's own span in the layer that wrote it — the posture `precision-narrowed` set in §17: the value is changed, the author is told, the build continues. A mapping is still refused. The fold does not consult the demand — `merge/` is downstream of nothing that validates — so a scalar the item demand would refuse is wrapped and then refused by the demand at the same span, which is the right refusal from the right stage. No document that resolved before resolves differently; a document that was refused now resolves, and the refusal was the only thing anyone could have leaned on. See §5.3.

- **Sandbox roots** (v1.7, 2026-09-21) → two **corrections** and two **additions**, reported from outside by the same consumer as v1.3 through v1.6 (issue #2), and bundled because they share one question: how does a caller let a schema reach a file outside the project, and how does the sandbox tell *outside* from *absent*?

  **The first correction: absent is not outside.** The containment check canonicalizes both the root and the location through the host, and fell back to the *lexical* path for whichever the host could not canonicalize — which means a location that does not exist. The root exists, so under a root that is or sits beneath a symbolic link the two sides were compared in different spaces, and a schema's reference to a file that was merely missing was refused as `sandbox-escape`, with a message naming as outside the root a path that was inside it. On macOS that is the ordinary case and not a corner: `/tmp` and `/var` are links. A missing location is now judged through its **nearest ancestor the host canonicalizes** — ordinarily the nearest that exists — with the segments below it appended as written, none of which can be a link because none of them was answered for; so both sides stand in the same space, an absent file inside the root is `document-unreachable`, and an absent file outside it is still `sandbox-escape`. No caller can have depended on the old verdict: it contradicted the check's own stated rule that "cannot be canonicalized" is a verdict in neither direction, and it varied with whether the same venue was reached through a link.

  **The second correction: a schema's `~/` expands, and is then confined.** §5.3's worked chain has a project *schema* write `$adopts: ~/.config/house.yaml`; the "tilde paths" entry above limits expansion to config-authored references. The document contradicted itself, and its own example could not resolve — the second time a worked chain has written a tilde the law did not honor. That entry's reason, that limiting expansion "grants schemas no new reach", located reach in the wrong place: reach is what *containment* grants, and containment binds every schema-authored local reference whether or not its text was expanded first. A schema's `~/schemas/house.yaml` therefore expands through the host's home directory (§16) and is admitted only where a granted root contains it; refused, the diagnostic names the real path rather than a literal `<venue>/~/…` that misled the consumer's own maintainer into believing the opposite of what had happened. A config-authored `~/` is what it was. A `~/` in a document read over `https://` is not expanded under either authority: a remote document has no home on the reader's machine, and a home path is never joined into a URL. **The one bounded change of behavior**, recorded rather than glossed: a local schema that wrote `~/x` to mean a directory literally named `~` beside itself must now write `./~/x`.

  **The first addition: the caller may grant more than one sandbox root.** `sandboxRoot` accepts a list, and a location is inside the sandbox when it is inside any member. This is the lawful door the second correction needs — a house schema shared by every project on a machine lives outside all of them — and it moves nothing about who holds the key: **granted, never ambient**. No root is inferred, none is read from a document, nothing a document says can add one, and an empty list is refused as a missing root always was. Delegation (§8.4) is confined by the same set; there is one sandbox, not one per mechanism. Every door that was shut stays shut to a caller who grants one root, which is what makes this an addition.

  **The second addition: `posixPaths` is exported** (`cascata/paths`). A host with no filesystem of its own but a known remote realm — a browser tab editing a server's POSIX paths — needs POSIX rules *plus* a home directory, and had to re-implement the facility to add one member to it.

  Out of scope, and said so: the window between the check and the read. A dangling link inside the root that points outside it is judged inside (it cannot be canonicalized; its ancestor can) and then fails to read; were its target to appear between the two calls, the read would succeed. v0.2 judged it identically, and closing it wants a host verb that reads and reports the real path together. See §5.3, §8.4, §9, §11, §16.

New open questions get an entry here while open and a §-reference when settled. Amend by explicit article, never by drift.

---

## 16. Article VI — The Host Boundary

*Numbered out of article sequence deliberately.* This article belongs after Article V, but inserting it there would renumber §9–§15, and those are cited throughout the implementation, every milestone spec, the tests, and the README. Renumbering would turn hundreds of **currently correct** citations into wrong ones, which is worse than the untidiness. The Roman numeral records where it belongs; the section number records where it could safely go.

Cascata is **embedded, not run**. Everything the library needs from outside the call it was given, it **asks for**. The **host** is whatever embeds it — a CLI, an editor, a build tool, a test harness.

Laws:

- **The library performs no I/O.** It never opens a file or a socket. It requests a document by location and receives bytes or a refusal. Where those bytes come from is the host's problem, and deliberately not the library's. **Three things this covers that are easy to miss**, all of them library I/O in v0.6 and none of them obviously a "read": resolving a location to its canonical identity (symlink following, which the sandbox check needs), storing and retrieving cached remote documents, and the network fetch itself — already behind an injectable transport since v0.2, which is half the seam and the half that proves the shape works.
- **The host boundary is the capability boundary.** A library that cannot read except by asking cannot exceed what its host grants. §8.4's remote-delegation opt-in and §11's sandbox promises are therefore *structural* rather than self-policed: a host that does not answer has denied the request, and no schema can appeal. The library's own sandbox rules remain in force as defence in depth, so a permissive host still gets every guarantee. This is §2.3 and Principle VI's "capabilities are granted, never ambient" made load-bearing rather than aspirational.
- **Some refusals never reach the host.** The library's own policy — sandbox confinement, a missing user opt-in — refuses *before* asking, and that is the defence-in-depth this article requires rather than an exception to it. A refusal the library made itself and a refusal the host answered with are different events and carry different diagnostics; both are refusals, and neither throws.
- **A refusal is data, not an exception.** A host declining to supply a document yields a diagnostic like any other refusal, carrying the position of the reference that asked for it. **Programmer errors throw** — a caller omitting a required option is a bug in the calling code, not a fact about the world. Nothing about the state of the world throws.
- **Everything above resolution is world-blind.** §3's pipeline is format-blind from graph-build onward; it is world-blind from the same point. Merge, validation, and provenance are pure functions of documents already in hand. That is what lets them be tested without a filesystem, and what makes §5.4's whole-chain validation "trivially correct even under merge-engine bugs" true rather than hopeful.
- **The host supplies bytes, never meaning.** It answers *what is at this location* — never *is this allowed*, *what format is this*, or *does this satisfy the schema*. Policy stays in the library; supply stays in the host. Two hosts must never be able to disagree about what one configuration means.
- **Canonical identity is supply, not meaning.** The host answers *which thing is at this location* — following symlinks, normalizing case where the filesystem does — because only the host knows how its storage names things. It never answers *whether that thing is inside the sandbox*: the library compares the identities the host returned and reaches the verdict itself. This is the line the previous law draws, applied to the one case where it is genuinely tempting to hand the whole question over. A host that lies about identity can defeat confinement, and that is the correct place for that trust to sit — a host that lies can simply answer with different bytes.
- **A shipped host is not a violation of the law.** The library performs no I/O; a *host* is supposed to. Cascata therefore ships a Node host as a **separate entry point**, so that the ordinary embedder is not made to write a filesystem adapter to read a file, and so that importing the library proper still cannot touch a disk. The seam is real precisely because the default implementation sits on the other side of it.
- **One call.** The ordinary embedding is a single `load()` from a launching point to a validated configuration or a set of **errors**, never both. The staged functions stay public for tools that need to step through the pipeline, but no tool should have to assemble the ordinary path itself, and none should have to rediscover how a path relates to the document that declared it. **"Never both" is about errors, not about diagnostics**: an `info` lint (§10) describes a configuration that is valid, so a successful `load()` returns the configuration *with* whatever lints it earned. A result that had to be discarded to see its warnings would guarantee nobody reads them.
- **The launching schema (v1.3, an addition).** An entry document that names no `$schema` may still be governed: the embedder passes `schema` in the one call, and the entry is resolved as if it had written `$schema: <schema>` — relative to its own directory, `~/` expanded, **config-authored** (the embedder's option is consent the way §8.1 reads a config's own reference), refused as `document-unreachable` at the entry when the host cannot supply it. An authored `$schema` always wins; without the option, a silent entry is what it has always been, a single-document graph with an empty pedigree. This exists for the embedder whose documents are written by people who have never heard of the library — a Markdown file's frontmatter, say — and whose tool knows what governs them; the alternative, editing the entry's bytes to insert a line, moves every span the embedder relies on. Supply, not meaning: the host still answers only what is at a location; the option only says where to start.
- **A host may own a namespace (v1.4, an addition).** A reference whose scheme this library does not itself understand is offered to the host before it is refused: `locate` answers *where `beltype:document` is*, or declines, and a scheme no host claims stays the `unsupported-scheme` it has always been. What comes back is a **location** and nothing more — an absolute local path, or an `https://` URL — read by the code that reads every other location, so a located document is parsed, deduplicated, cycle-checked and pin-verified exactly as a path-named one is, and a relative `$adopts` written inside it resolves against it. This is the law above applied where it is easiest to miss: until v1.4 the library decided by itself which strings could be locations at all, which is a claim about the world and therefore not its to make. A located reference is **not sandbox-checked**, for the reason §8.1 exempts a config's own reference — the sandbox confines what a *document's own text* can reach, and here the text named a namespace while the host chose the location. The exemption does not travel down the chain: what the located document then writes for itself is ordinary reference text in an ordinary document, checked as such. The method is **optional**, so a host that implements nothing has the library exactly as it was at v1.3; the door opens only for an embedder who built it, which is what makes this an addition rather than a changed meaning. It exists for the embedder whose root schema ships inside its own installed package, where the absolute path differs on every machine and a portable `$adopts` line therefore cannot name one. Delegation is untouched: §8.4 gives a delegated target its own user opt-in, and widening it is a separate question with its own security paragraph to write.
- **The host answers platform facts, not only bytes (v1.5, an addition).** A `Host` may supply `paths`: what `dirname` of a location is, whether a location is absolute, how two locations join, what separates their segments, and where the user's home directory is. These are not lexical arithmetic — `C:\a\b`, `\\server\share` and a backslash separator are facts about a *platform*, and a library that reads them from the process it happens to be running in has reached past its own seam for something the host was supposed to answer. The consequence was not subtle: importing `node:path`, `node:os` and `node:crypto` inside the library made it fail at **module evaluation** in any realm that is not Node, before a line of Cascata code ran and with no partial mode to fall back to. Supply, not meaning, holds here exactly as it does for bytes: the host says what a path *is* in its world; the library still decides what any of it is allowed to mean, and the sandbox verdict, the `absolute-delegated-path` refusal and every other policy remain the library's own — computed, now, in terms the host recognizes rather than in terms the process happened to have. `createNodeHost` answers with `node:path`'s own functions, so a Node embedder's behavior — Windows included — is what it always was. The member is **optional**: a host that supplies none is given POSIX rules and no home directory, which is the honest answer for a realm that has no filesystem in the first place. **The one bounded change of behavior**, recorded rather than glossed: an embedder running on Windows with a *custom* host — not `createNodeHost` — used to get Windows path semantics from the process and must now say so by answering `paths`. No document changes meaning; a host must state a fact it used to be able to leave unsaid.
- **The embedder may name config documents the entry did not write (v1.6, an addition).** `load()` accepts `overrides`, an ordered list of locations. Each is read after the entry's chain, as a **config-authored** reference anchored at the entry — relative to the entry's directory, `~/` expanded, a scheme offered to `locate`, `https://` through the transport, exempt from the sandbox for the reason the launching schema is — and becomes a config-role layer ranked after the entry, the last one highest of all. That is the whole mechanism, and the point is what it does *not* add: **an override is governed exactly as the entry is.** Every demand the pedigree accumulated refuses its value at its own span, a key sealed `final` refuses it, a key under `append` accumulates it after the entry's contribution, the pedigree's grants delegate from inside it, and `why()` names it. It carries no `$`-key — the pedigree is the entry's, and an override starts none (`override-reserved-key`). It is a layer of the fold and not a node of the adoption graph: not deduplicated, not cycle-checked, absent from the pedigree, so two overrides with identical bytes are two layers. Absent or empty, v1.5 exactly; `generateTypes()` ignores it. It exists for the embedder whose operator sets a key from a command line — `--set title=Draft`, `-c ci.yaml` — and whose venue's contract must bind those values like any others. What that embedder did instead, merging them over the projected value after `load()` returned, saw no demand, held no `final`, and left `why()` naming the document that lost; §1's promise, that a house standard is still a standard five layers down, stopped at the entry, and the command line is where a scripted build most needs it to hold. Supply, not meaning: the host still answers only what is at a location, and the option only says which documents there are. One caveat on the word, stated here rather than spent on a second keyword: `overrides` is what the trade calls the command line's contribution, and under an accumulating key an override *adds* rather than replaces — the strategy governs, as it governs every layer. **What this is not**: a second entry. An override naming its own `$schema` would start a pedigree of its own, which is the "delegate and start a layer" §8.4 reserves for a keyword with laws of its own; this law leaves that door exactly where it was.
- **The caller grants the sandbox, and may grant more than one root (v1.7, an addition and two corrections).** `sandboxRoot` is a location or a list of them, and a schema-authored path is inside the sandbox when it is inside any. The posture is the one it has always been — **granted, never ambient**: the embedder holds the list, and no document can read it, extend it, or learn from a refusal anything but that it was refused. It exists for the document that is lawfully outside every project because it is shared by all of them, a house schema under the user's home directory; a schema names it `~/schemas/house.yaml`, the host answers where home is (`paths.homeDirectory`), and the library decides — as it decides every policy — whether what that expands to is contained. Expansion is supply; containment is meaning. Two corrections ride with it (§15): a location that does not exist is judged through its nearest existing ancestor, so that a root behind a symbolic link no longer turns *absent* into *outside*; and a schema's `~/` expands at all, which §5.3 had always shown and §15 had forbidden. `posixPaths` is exported (`cascata/paths`) as the base a host spreads — `{ ...posixPaths, homeDirectory }` — when it has no filesystem but knows POSIX rules and a home directory.
- **Determinism across hosts.** Given the same documents, every host gets the same tree, the same provenance, and the same diagnostics in the same order. A host may decide *whether* the library sees a document; it may never influence what that document means. Two hosts naming different documents for one identity (the law above) is the same latitude they already have for one path — supply, not meaning: they disagree about *which documents there are*, never about what a document says.

---

## 17. Article VII — The Output Surface

*Numbered out of article sequence deliberately*, for the reason Article VI gives: inserting it where it belongs would renumber sections cited throughout the implementation, every milestone spec, the tests, and the README, turning hundreds of **currently correct** citations into wrong ones. The Roman numeral records where it belongs; the section number records where it could safely go.

Seven milestones produced a positioned, frozen `Node` tree and no way to read it as ordinary data. §1 promises the tool developer "a validated configuration object"; until v1.0 it received a tagged union with spans, `Map`s for mappings and `bigint`s for integers, and had to walk the model by hand. This article is that promise kept.

Laws:

- **The ordinary consumer receives a value, not a tree.** Mappings project to **null-prototype objects** whose keys are inserted in §4.2's canonical order. *Inserted*, not enumerated: ECMA-262 hoists every array-index key — a canonical numeric string in `[0, 2^32−2]` — to the front of any object and orders those numerically, so a mapping with keys `10, 2, b, a` enumerates `2, 10, a, b` no matter how it was built. This is a property of the host language, not a choice, and it is named here so it is found by reading rather than by debugging. A consumer needing canonical order over numeric keys reads the node tree, which has it unconditionally. Sequences project to arrays; sequences to arrays; scalars to their JS equivalents. `Object.create(null)` rather than `{}` because a configuration key is author-controlled and `__proto__` is not a key anyone should be able to set by writing it in YAML.
- **The value view is a projection, never a replacement.** The node tree remains available on the same result. Spans, provenance, and pedigree live there, and `why()` still answers by RFC 6901 pointer. A consumer who needs a position has not lost one; a consumer who needs a value no longer pays for positions they will not read.
- **The demand decides the numeric type, not the document.** `kind` is lexical — `30` is an int and `30.0` is a float — so a *faithful* projection would let a config author's punctuation decide whether the consuming application sees `bigint` or `number`, under an unchanged schema. That is backwards: this project's thesis is that the schema demands and the config provides, and the output type is part of what is demanded. Therefore, per key, from the **accumulated** demand:

  **The question is "does the accumulated demand admit `float`?"** — not "which of these spellings is it?". Stated that way it settles every union, including the mixed ones a table of spellings would miss (`int | string`, `float | null`, and whatever v1.x adds):

  | the accumulated demand | value | reason |
  |---|---|---|
  | admits `float` | `number` | the schema declared a float acceptable here |
  | admits `int` but not `float` | `bigint` | exact at any magnitude (§4.2) |
  | admits neither | projected faithfully by lexical kind | not a numeric key; no contract to consult |

  The three original rows are consequences: `int` → `bigint`, `float` → `number`, `int | float` → `number`. `int | string` admits no float and therefore yields `bigint` — an author who wrote `int` and later widened to `int | string` does not silently lose exactness. **The generalized rule was added at v1.0**, from an implementer's report that a table of spellings left every mixed union to a judgment call (§15).

  Where a key has no numeric demand, **nothing is promised about its type**: a caller's `T` says `unknown` there, and the v1.x generator will emit that. At v1.0 `load<T>()` types the whole configuration with one caller-supplied `T`, so per-key typing is the generator's statement to make, not this version's.

  A schema author who needs exactness above 2^53 writes `type: int`, which is one line, discoverable, and the only place the decision belongs.
- **Normalization never loses a digit silently.** Where `int | float` projects an integer that is not exactly representable as a double, an **info**-level diagnostic (§10) says so, naming the key and both values. It fires on actual loss, not on every `int | float` key — a lint that cried on the shape rather than the value would be ignored within a week.
- **`load<T>()`'s `T` is the caller's claim, and the library never checks it.** Validation enforces the *schema* against the value; it cannot enforce the caller's belief about what the schema says. A `T` that disagrees with its schema is a bug in the calling code, and the v1.x generator (§14) exists to remove the guesswork by deriving `T` from the schema chain. Until then the mismatch is real and is named here rather than discovered.
- **The value is deeply immutable**, to the same depth as the tree — but not by the same means, and the difference matters. A mapping becomes an object, so no `Map` survives a projection and `Object.freeze` is sufficient; the tree needs a Proxy precisely because `Object.freeze` does nothing to a `Map` (§4.1). This clause said "by the same means … including the `Map`-shaped hazard" until v1.0, describing a hazard the projection cannot have.
- **The projection is a stage, and has a name.** `project()` takes a merged configuration and returns a value; it reads accumulated demands from the configuration's own layers, so it depends on `merge()` and not on `validate()`. `load()` places it after validation because that is where a *successful* configuration exists, not because of a data dependency. Per Principle IV it consumes only the previous stage's output and is reachable without `load()`.
- **A present key set to `null` is a present property whose value is `null`**; an absent key is an absent property. §4.2's three-way distinction between absent, null, and empty survives the projection intact.
- **The precision lint is anchored at the offending value**, carrying that value's own span and pointer — not the demand's. A lint the consumer cannot locate in their own file is a lint they cannot act on (Principle III).

## 18. Article VIII — The Accumulated Demand, and the Emitted Type

*Numbered out of article sequence deliberately*, for the reason Articles VI and VII give: the Roman numeral records where it belongs; the section number records where it could safely go.

Article VII made the consuming application's `T` the caller's claim and named the generator that would replace the claim with a derivation. This article is that generator — and the thing it derives from, which turns out to be the more durable of the two. Added in v1.1 under §15's freeze rule as an addition: nothing a schema meant before this article means anything else after it.

Laws:

- **The accumulated demand is a stage, and has a name.** For every position a schema chain can describe, the accumulated demand is the intersection of every demand any layer places there (§5.1), each named type resolved in the scope of the layer that used it (§7). It is computed from schema layers alone. No configuration takes part, and positions are *shapes*: `values` and `items` denote every entry and every element, not the entries and elements of some document. `accumulate()` takes the schema layers of a chain, root to leaf, and returns the tree; per Principle IV it is reachable without any emitter. §17's numeric rule has read one slice of this tree since v1.0 — the numeric class — and the tree is the rest of it.
- **Intersection is defined per keyword, and it is the only composition.** `type` expressions intersect alternative by alternative, at equal array depth; a name intersects by the body it resolves to. `keys` unites the declared names and intersects each; `values` and `items` intersect. `required` is true if any layer says so. `enum` intersects as a set under §4.2's equality. `min` and `minLength` take the largest bound, `max` and `maxLength` the smallest. `pattern` accumulates as a conjunction. `accept` intersects as a set of alternatives. `seal` is `closed` if any layer closes the position. None of this is new: every row restates what §5.2 and §5.4's whole-chain validation already enforce, once, in a form that exists before any document does.
- **An empty intersection is `never`, and is reported.** Where two demands admit no common value — `string` and `int` at one position — the tree records the emptiness, the emitted type is `never`, and an **info**-level diagnostic (§10) names both demands. Whole-chain validation already refuses every value there; this lint is the first time the contradiction is visible with no value to trip over it, which is the beginning of the static subsumption §5.4 promises.
- **Emitters are translations of the tree, and thin.** The TypeScript generator emits the tree as declaration text; the JSON Schema exporter (§12) emits the same tree as the "accumulated intersection" that section has described since before either existed. Neither reads a schema document; both read the tree. A third foreign type system would be a third emitter, never a third walk.
- **The generator performs no I/O.** `generate()` takes the tree and returns TypeScript source text with diagnostics; the caller writes it where it belongs, or does not. `generateTypes()` is the one call (Article VI): it resolves a *schema* as the launching point, treats every document it reaches as a schema layer, accumulates, and generates. Article VI's laws apply unchanged.
- **The mapping from tree to TypeScript is the contract**, and each row is a compatibility promise under §15's freeze rule from the moment it ships:

  | accumulated demand | emitted TypeScript |
  |---|---|
  | `string`, `url`, `path` | `string`. `url` and `path` **refine** `string` (§7), so `string ∩ (url \| path)` is `url \| path`, never empty — §7's own worked `resource` is that intersection |
  | admits `float` | `number` (§17) |
  | admits `int`, not `float` | `bigint` (§17) |
  | `bool`, `null` | `boolean`, `null` |
  | a union of alternatives | a union; `T[]` → `readonly T[]` |
  | `keys` | an object type; every property `readonly` |
  | `values: D` | an index signature `readonly [key: string]: D`, its type widened to include every declared sibling property's type, and `undefined` where any sibling is optional — TypeScript requires an index signature to subsume its siblings, and a `k?: T` sibling is `T \| undefined` |
  | `seal: closed` in any layer | no index signature where keys are declared; `readonly [key: string]: never` where none are — TypeScript's `{}` admits every non-nullish value. Otherwise `readonly [key: string]: unknown` |
  | a key `required` in any layer, or provided in any layer | a non-optional property (§5.5's guaranteed key); otherwise optional |
  | `enum` whose members are all scalars | a literal union, kind-aware under the numeric rule (`1n` under `bigint`, `1` under `number`); any non-scalar member → the accumulated type |
  | `final: true` with a scalar `provide` | the literal type of the constant (§6.3); a non-scalar `provide` → the accumulated type |
  | a named type | a named `export type`; guarded recursion is carried by TypeScript's own recursive aliases, and unguarded cycles never reach here (§7) |
  | a position that names a type **and** declares structure of its own (`keys`, `values`, `items`, `seal`) | the intersection of the named body with that structure, inline, exactly as two declarations of one name intersect — never the alias alone, which would be wider than the accumulated demand |
  | one name declared by two layers of a chain | every declaration carries §7's qualifier as a prefix; a bare name is emitted only where the chain declares it once |
  | no demand | `unknown` (§17) |
  | `min`, `max`, `minLength`, `maxLength`, `pattern`, `accept` | no type; a JSDoc comment on the property naming the constraint and its declaring layer |
  | `delegate`, `cascade`, `directives`, `authority` | nothing; they are not shape |

  **A `null` in the emitted type comes only from a `null` alternative.** `type: string` rejects an explicit `null` (§4.2's three-way distinction), so the emitted `string` carries no `| null` and no `| undefined`. Optionality belongs to the property, never to the value. The one place `undefined` appears in a value type is an index signature beside an optional sibling, for the reason the `values` row gives; it is TypeScript's requirement, not a statement about the configuration.

  **JSDoc is output, not contract.** The comments exist so that a consumer hovering a property sees what the schema demands; their presence and wording may change without a version bump. The types may not.

- **Identifiers are kept, quoted, or refused — never silently renamed.** A key that is a valid ECMAScript identifier is emitted as written; any other key is a quoted property name, non-ASCII included. A type name that is a valid identifier and not a TypeScript reserved word is emitted as written; otherwise it is escaped by a rule the contract states and the same input always escapes the same way. Two names that escape to one identifier are a generator error, not a coin toss.
- **Soundness is the conformance rule, and the validator is the oracle.** Every configuration that validation accepts, projected by Article VII, inhabits the type generated from its schema chain — asserted by typechecking the projected value against the emitted type, for every accepting case in the conformance corpus and for the meta-schema against itself. A configuration refused for a type-shaped reason (`type-mismatch`, `required-violated`, `seal-violation`, `enum-violated`) must fail the same check **wherever the refused property is expressible as a type**. It is not always: a `url` or `path` refinement is a `string` to TypeScript; `required` at a key with no `type` refuses `null` where the property is `unknown`, which `null` inhabits; and a structural demand with no `type: mapping` admits any value, so a nested `required` beneath it constrains nothing the type can see. Each such case is named in the oracle, never skipped, so that one joining them is a regression and one leaving them is a limit closed. One refused for a range, a length, or a pattern may pass it, because TypeScript has no type for those and the JSDoc above is the honest substitute. And closedness is enforced by the host type system at object literals only — a value reaching a closed type through a variable is accepted structurally — so `seal: closed` is exact in the emitted type and partial in the compiler. The generator therefore has no expected outputs written by hand; expected outputs are derived, as Principle V requires.
- **`load<T>()` is unchanged.** `T` remains the caller's claim and the library never checks it (§17). The generator makes the claim derivable; it does not make it checked. A caller who writes `T` by hand still may, and a `T` the generator wrote is still, to `load()`, a claim.

---


## 19. Article IX — Writing a Value Back

*Numbered out of article sequence*, as Articles VI to VIII are. Added in v1.10 under §15's freeze rule as an **addition**: it reads nothing differently and refuses nothing it accepted; it is new capability beside the reading pipeline. It is the first use of §4.3's open door, and Cascata's half of a design shared with Provenance (that repository's `docs/write-back.md`): a tool edits its model, and the edit lands in exactly the right bytes of exactly the right file. Cascata owns the bytes of the formats it reads, because whatever writes a value must be the parser that measured it.

Laws:

- **Two verbs, on one document.** `locate` takes a document's stored bytes, its format and an RFC 6901 pointer, and answers the byte range of the value at that pointer, or that there is none. `setValue` takes the same and a new value, and answers an **edit**: a byte range of the input and the bytes to put there. Neither verb touches a file; applying the edit is the caller's. Both work on any document Cascata can read, whether it is a configuration layer or a data file.
- **Three laws, each a conformance case.** *Nothing changed, nothing written*: setting a value to the value already there gives an edit whose bytes are the bytes already there. *What you set is what you read*: reading the edited document gives, at the pointer, the value set, of the same kind (§4.2). *Only the value moves*: every byte outside the edit's range is untouched — comments, indentation, quoting elsewhere, line endings, the byte-order mark.
- **Kind is kept unless the value says otherwise.** A number written where the document has a decimal stays a decimal (`3` over `3.2` is written `3.0`); a whole number where it has an integer stays an integer; a value of another kind — a string over a number, a non-integer over an integer — changes the kind, because the caller said so. A value the format cannot spell (JSON has no infinity) is refused.
- **Spelling is the format's, and is chosen for every reader.** A string is written plain only where a plain scalar reads back as that same string — under Cascata's rules *and* under YAML 1.1's, so `yes`, `no`, `on` and `off` are quoted even though Cascata reads them as strings (§4.2). A scalar that was quoted stays quoted, in its own style, wherever that style can hold the value; one that was plain and can no longer be is double-quoted. A tagged scalar keeps its tag wherever the tag can hold the value, and is written without it where it cannot: `!!int 1` set to a string is written plain, not `!!int x`, which Cascata alone would read as a string. *(v1.12, a correction: the writer emitted a tag that contradicted its value.)* *(Corrected in v1.10: the first wording read as "plain whenever plain is safe", which the conformance table, rightly, did not do.)* A number is written in its shortest exact form. No precision rule is applied: rounding is the caller's until a schema can declare one.
- **Some targets are refused rather than guessed.** A pointer with no value in the document. A **shared** value: one reached through a YAML alias or merge key, *or one that is itself anchored and aliased elsewhere, or sits inside an anchored container that is* — writing it would change every other place that shares it, which breaks the third law in meaning even where every byte outside the range is untouched. (An anchor nothing aliases is not shared; a key that overrides a merged one is the document's own.) A value is also shared when its document is delegated to at more than one place: one edit to the file changes every graft of it. *(v1.12, from the consumer's finding.)* **Whether a shared value is refused is the embedder's policy**, `sharedEdits`, set where its writers and edit targets are made and never global: `refuse` (the default, and everything above), `warn` (the edit is answered and the other places it changes are named, as an `info` diagnostic), or `allow` (answered, and nothing said). Under `warn` and `allow` the edit lands on the bytes that hold the value, through the alias; the third law is then broken in meaning on purpose, by a caller who said so. `locate` follows the same policy, so a writer always locates the bytes it writes; finding is harmless, so it adds no notice under `warn`. *(v1.12.1, a correction: `locate` had answered as under `refuse` whatever the writer was made with.)* *(v1.12. The graft sentence is a **correction**: such a value was shared in this law's own sense, one edit changing every place, and v1.11.1 answered it `ok`. The policy is an **addition**, and its default is the law.)* A block scalar, whose style the first version does not reproduce. A mapping or sequence, because setting a container is an insertion, which is not yet written. A value an edit could not be read back as. Each is a diagnostic, never a throw: an absent value at its nearest existing ancestor, a shared one at the alias, the rest at the target. `locate` answers for containers and block scalars, since knowing where they are is harmless; only `setValue` refuses them. *(The anchor's owner, the positions and the read-back were added in v1.10 from the implementer's findings: the round-trip oracle caught the owner on its first run.)*

- **Which document an edit belongs in** (v1.11, an addition). `editTarget` takes a merged configuration and a pointer into it and answers the document and the pointer *inside that document* where the winning value is written — so a tool that edits its model never has to know the cascade. A value supplied by a config layer, an override, or a fragment a config delegated to is a target. A value supplied by a schema's `provide` is refused as **inherited**, naming the schema that supplied it: whether such an edit should change the default or add an override nearer the user is the view-update question, and this article does not answer it. A document read over `https://` is never a target. A container is refused as in the laws above. The document is named by its location — for a delegated fragment, the fragment's own file, not the graft that placed it. `why()`'s entries carry each entry's own value's in-document pointer, beside the span they always carried (for an item of an accumulated list, `why()` answers the list's entries and `editTarget` the item's; the two differ there by design). *(Corrected in v1.11 from the implementer's findings.)* **An `ok` from `editTarget` names where the value lives, not that it will be written**: whether an edit is written is the writer's answer alone. Some of the writer's refusals are visible only in the document's bytes — a block scalar, a key with no value inside a flow collection — and one depends on the value being set — an explicit tag that cannot hold it, written where the writer cannot remove it — and `editTarget` sees neither the bytes nor the value. *(v1.12.1, a clarification: nothing answered before is answered differently.)*
- **The shape of a writer** (v1.11, an addition). The two verbs are also offered as **writers** — one for YAML, one for JSON, each claiming its own extensions — in the shape a source-graph library's editing stage expects (`claims`, `locate`, `write`), by shape and not by import, as a read pass's host already satisfies Article VI's `Host`. A writer's path is an RFC 6901 pointer.

What is not in this article: inserting and deleting entries, which need format-preserving trees (§4.3's sibling, still unbuilt); which document an edit to a *merged* value belongs in, where a value may come from a schema's `provide` rather than any config (the view-update question, left open); and applying, committing and rebasing edits, which belong to the caller's session.

---

*This document is the constitution. The meta-schema, the adapter conformance corpus, and every future design conversation cite it. Keep it under revision control; amend by explicit article, never by drift.*
