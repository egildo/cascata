# Cascata — Schema-Governed Cascading Configuration

> Working title — rename at will. A lightweight TypeScript library for reasoning about configuration as **schema-governed, cascading, file-based data**. Format-agnostic by design (YAML first; JSON and TOML later), self-hosting, provenance-rich.

**Status:** design specification / constitution, v0 (pre-implementation)

---

## 1. Motivation & Scope

Applications need configuration that is: human-readable and file-based; composable across layers (published defaults → organization/house defaults → project → local); validated against explicit contracts; and traceable ("where did this value come from?").

Cascata provides a single language in which **everything is simultaneously data and contract**. A document can provide values, impose rules on descendants, and govern how descendants may extend it — all with the same vocabulary. Schema documents are just configs whose pedigree terminates in a meta-schema shipped with the library.

Non-goals for v1: write-back/editing of config files, arbitrary computation in schemas (no template language, no user callbacks), remote delegation targets, the `extends` (fork) mode.

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
| **Freeze** | Immutable, typed output | Optionally derive/emit TypeScript types |

Each stage is independently testable and consumes only the output of the previous one. Everything from graph-build onward is format-blind.

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
- **Hygiene:** line endings normalized for span math; parse depth and document size capped (remote documents are accepted).

### 4.3 Lossy by design; CST door left open

The model discards comments, quoting style, indentation, anchor names, and authored key order (§4.2). v1 is read-and-validate only. Spans stay precise and adapters stay structured so a per-format lossless CST sibling (for future `tool set` / migrations, à la `toml_edit` or `yaml` Document mode) can slot in later without clobbering user comments.

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
| Struct openness | Open → closed | Closed → open |
| Defaults (`provide`) | Replace with any value satisfying accumulated demands | Provide a value violating any ancestor demand |
| `cascade: append` arrays | Append provisions | Remove inherited items (not an operation in v1) |
| `cascade` strategy itself | Tighten toward accumulation (`replace` → `append`) | Weaken away from it (`append` → `replace`): a descendant declaring `replace` for a key an ancestor made `append` discards every ancestor's contribution, which the row above forbids absolutely. **A strategy governs from the layer that declares it, downward** — authority flows one way (§2.3), so declaring `append` accumulates the declaring layer's contribution and every later one onto whatever the fold had already produced, and does not reach back to re-combine layers that had already settled under `replace`. Once a key accumulates, it keeps accumulating from that point on. |
| Types (named) | Narrow inherited type (tightens every usage) | Widen or redefine under `adopts` |

### 5.3 Merge strategies

Merge policy belongs to the contract, not to individual documents (the Kustomize lesson). Per key: `replace` (default, per RFC 7386 spirit), `append`; `merge-by-key` reserved for later. Deep merge for mappings. Precedence is total, deterministic, and documented as a numbered list.

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
$adopts: ~/.config/house.yaml
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

- **`required` + replaceable `provide` = the *guaranteed key* pattern. Feature, no diagnostic.** Authors may omit the key (the provide fills it); an explicit `key: null` still errors (`required` forbids nulling-out). In the typed TS output this compiles to a **non-optional property** — a real promise to the consuming application.
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

- Per key: `seal: open | closed`, `final` (no override at all), `cascade` strategy — declared by the **ancestor**.
- Per schema: a root may declare itself `final` against forking of its published identity (the text can be copied; the name cannot be claimed).

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
    demand: { type: resource[], accept: [url] }   # usage selects a subset — narrowing
    cascade: append
```

Laws:

- **Parameters are constraint selectors, never computation.** A parameter may only choose among or tighten the type's declared alternatives. Selecting a subset of a union is narrowing, so parameterization is itself monotone and statically checkable. No template language.
- **Types cascade.** A descendant may redeclare an inherited type name, and doing so **narrows that type from the declaring layer downward** — the declaring layer's own usages and every layer below it, never an ancestor's. Authority flows one way (§2.3); this is the identical rule §5.2 states for cascade strategies, for the identical reason. House-defaults ergonomics — "our `resource` is URLs only; nothing served off local disk" — therefore bind the house and everything beneath it, while an ancestor's own usage of the name keeps meaning what that ancestor declared. Widening or redefining remains illegal under `adopts` and needs no separate refusal: an ancestor's demand resolves the *ancestor's* declaration, and whole-chain validation (§5.4) applies it regardless, so a widening is inert exactly where it would otherwise do harm. Proving that a redeclaration narrows, with no data present, is static subsumption (§5.4 item 2, v1.x).
- **One flat namespace per pedigree; a collision between *unrelated* declarations is an error.** Two declarations of one name standing in an ancestor/descendant relation are **not** a collision — they are the narrowing the law above describes. Because v1 `$adopts` takes exactly one parent (§6.1), every pedigree is a chain and every pair of layers is related, so **collision is unreachable in v1** and is reserved for future multi-adoption, where two unrelated ancestors may each declare a name. Qualified names (`core/resource` — the qualifier being the last segment of the declaring document's `$id`) restrict resolution to declarations from documents carrying that qualifier, and are the escape hatch. They pin one specific declaration exactly when qualifiers are distinct, which is the case worth designing for; where two layers in one chain share a qualifier *and* a type name, the second is a narrowing of the first like any other, and the **nearest** wins there too. No silent shadowing: unqualified or qualified, a name always resolves to the nearest declaration at or above the layer that names it, and the same reference read from two different layers may therefore name two different declarations — which is the point, since that is what "narrows from the declaring layer downward" means.

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
    demand: { type: resource[] }
```

```yaml
# ~/.config/house.yaml   (house layer)
$adopts: https://site-builder.dev/schema/core.yaml
types:
  resource:
    accept: [url]               # narrowing — legal, and it takes effect HERE
keys:
  styles:
    demand: { type: resource[] }   # the house restates the key, so its own narrower resource governs
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

### 8.2 Transclusion, not cascade

A delegated file is a **fragment**: a branch grafted into its parent's tree, belonging to the parent's **layer**. It carries no `$schema`, starts no pedigree, creates no merge boundary. `$`-keys in fragments are **forbidden** in v1. One line tells the whole story: *the cascade composes vertically across documents; delegation composes horizontally within one document.* A config with twelve fragments is semantically identical to the same config written inline — same node tree, same validation, same merge. That identity is the feature.

### 8.3 Mechanics (all falling out of the principle)

- Transclusion happens at **graph-build**, before merge and validation; delegated files are just more DAG edges — cycle detection and diamond dedup come free.
- **Merge interaction: none.** By merge time, inline and delegated subtrees are indistinguishable node trees. Per-key `cascade` applies unchanged.
- **Provenance:** spans point into the fragment; the provenance chain keeps the delegation breadcrumb (`… (delegated from site.yaml:12)`).
- **Validation is positional:** the fragment's root mapping is validated as the subtree at its graft point. Bonus: editors can be told "this file is a `site-builder/core#network` fragment" for autocomplete, derived mechanically from the graft point.
- **Format freedom:** a fragment may be in a different format than its parent — trivially true under the information model.

### 8.4 Security posture

Delegation is schema-triggered file loading, and schemas can come from the web. Therefore: paths resolve relative to the **delegating config's** directory; confined to a sandbox root (project directory) — no `..` escapes, no absolute paths by default; **remote delegation targets are off** unless the *user* (never the schema) opts in; the schema allowing delegation never compels it — the config author chooses per key. Schema demands; config provides. Always.

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

- **`[]` binds tighter than `|`** (TypeScript precedence): `string | string[]` = string or array-of-string; `(string | int)[]` needs parens. Whitespace insignificant.
- **Names only.** No literals, no parameters, no `?` marker. Enums via `enum:`, optionality via `required:`, parameters via sibling keys (`accept:`, `min:`…). One construct per meaning — the DSL is a pure type-name algebra.
- **Canonical form:** unions flatten and dedupe as *sets* (order insignificant for equality); arrays compare structurally.
- **Subsumption:** `A ⊑ B` iff every alternative of A is ⊑ some alternative of B; `T[] ⊑ U[]` iff `T ⊑ U`; names resolve through the type graph. Decidable, ~50 lines — this is what keeps static subsumption on type expressions nearly free.

Reserved document keys: `$id`, `$version`, `$adopts`, `$pin`, `$schema` (config-side pointer), later `$extends`.

**Reserved keys are directives, not data.** They govern how a document is found and what governs it, and they do **not** appear in a merged configuration: a consumer receives the configuration the documents describe, not the plumbing that assembled it. This was silent until v0.3, where a fold's first conformance case surfaced `$schema` sitting in the merged tree as an ordinary key.

**`$adopts` and `$schema` are single string scalars.** A sequence value is refused — not as a malformed value, but with a diagnostic saying v1 adopts exactly one parent (§6.1), because that is the shape multi-adoption will take when C3 linearization lands and an author writing it early deserves to be told which version they are ahead of. Two `$adopts` keys in one mapping are already impossible: duplicate keys are refused (§4.2).

Schema vocabulary per key: `demand` (`type`, `items`, `required`, `accept`, `keys`, plus JSON-Schema-named leaf constraints: `min`, `max`, `minLength`, `maxLength`, `pattern`, `enum`), `provide`, `cascade: replace | append`, `seal: open | closed`, `final`, `delegate: allow`. **`keys` and `items` both nest to arbitrary depth**: `keys` constrains a mapping value's own children the way the schema's top-level `keys:` constrains the config's own top level, and `items` constrains a sequence value's own elements; either may recurse into further `keys`/`items` beneath it, to whatever depth the data actually nests.

Top-level schema sections: `types`, `keys`.

### Worked chain

```yaml
# https://site-builder.dev/schema/core.yaml   (root)
$id: site-builder/core
$version: 1
types:
  resource: { accept: [url, path], demand: { type: string } }
keys:
  styles:
    demand: { type: resource[], accept: [url], required: true }
    cascade: append
    seal: open
```

```yaml
# ~/.config/house.yaml   (house layer)
$adopts: https://site-builder.dev/schema/core.yaml
$pin: sha256:9f2c…
keys:
  styles:
    demand: { type: resource[] }                      # legal: (vacuous) narrowing
    provide: ["https://cdn.house.dev/base.css"]       # house default, appended
```

```yaml
# ./site.yaml   (the config)
$schema: ~/.config/house.yaml   # a leading `~/` expands to the user's home directory —
                                # permitted because a config's own reference is author consent (§8.1)
styles:
  - https://example.com/theme.css
# resolves to [base.css, theme.css] — valid against house AND core, provably
```

---

## 10. Validation & Error Contract

- Every error carries: the violated demand (with its declaring layer + span, as a JSON Pointer per RFC 6901 into that document), the offending value (layer + span, delegation breadcrumb included), and the accumulated pedigree position.
- Canonical error sentence: `constraint from house.yaml:7 (/keys/styles/demand) rejected value from conf.network.yaml:3 (delegated from site.yaml:12)`.
- Machine-readable error output uses RFC 6901 pointers throughout — do not invent a path syntax.
- `tool why <config> <pointer>` answers "where did this value come from and what did it override" (the `git config --show-origin` / DevTools struck-through-rule feature). Built into the merge engine from day one; nearly free there, nearly impossible to retrofit.

---

## 11. Security Model (summary)

- **Remote schemas: HTTPS, always.** Pinning by content hash (`$pin`, SHA-256 over the exact bytes, §6.1) is **verified whenever a pin is present**, and verification is absolute: mismatched bytes are refused and never enter the graph. Whether a pin is *required* is not the library's decision but the pedigree's — authority flows downward (§2.3), and a published root legislates what its descendants must do, here as everywhere. v1 ships the mechanism; the legislation (a root demanding pinned adoption) belongs with sealing and authority (§6.3). An unpinned reference is therefore fetched on TLS alone, and **an unpinned remote link MUST be reportable**, so a root's demand is auditable and an author can see what they are trusting unverified. One limit is inherent rather than chosen: a root's demand can only be read after that root has been fetched, so it hardens every subsequent resolution but not the first — which is what a lockfile closes. Immutable content-addressed cache per RFC 9111 semantics; lockfile-friendly.
- A remote schema can never trigger local file reads outside the sandbox (delegation rules, §8.4) nor remote delegation without user opt-in.
- YAML custom tags rejected; parse depth/size capped; duplicate keys rejected.
- The schema language itself is versioned via the meta-schema's own pedigree.

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
7. **v0.7** — Sealing/governance (`seal`, `final`, cascade limits) + **meta-schema bootstrap** (self-hosting; do this early — every vocabulary wart becomes a wart you personally suffer).
8. **v1.0** — Freeze the constitution; typed TS output surface.
9. **v1.x** — JSON Schema 2020-12 exporter; static subsumption lint; JSON adapter; TOML adapter (run against `toml-test`).
10. **Future** — `$extends` fork mode; `merge-by-key`; CST layer for write-back; delegation parameters; remote delegation opt-in; multi-`$adopts` via C3 linearization (§6.1); `provide` retraction (monotone-legal, needs syntax; §5.5); `glob` as a type, which needs **expansion** semantics, a sandbox story, and a determinism story before it can mean anything (§15).

---

## 15. Settled Questions (amendment log)

All initial open questions are resolved; amendments are integrated into the articles cited.

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

New open questions get an entry here while open and a §-reference when settled. Amend by explicit article, never by drift.

---

*This document is the constitution. The meta-schema, the adapter conformance corpus, and every future design conversation cite it. Keep it under revision control; amend by explicit article, never by drift.*
