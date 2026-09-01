# Research: Sealing, Authority, and the Embedding Surface

Six design questions the spec left to planning. Each is decided here against the existing
codebase (v0.1–v0.6) and the recorded fixtures, which FR-030 makes the oracle for US4.

## D1 — The `Host` interface's shape

**Decision**: `Host` (new file `src/resolve/host.ts`, zero imports, mirroring `resolve/transport.ts`'s
own zero-import contract) has exactly four methods:

```ts
export type HostReadResult = { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly reason: string };
export interface Host {
  read(location: string): Promise<HostReadResult>;
  canonicalize(location: string): Promise<string | undefined>;
  cacheRead(key: string): Promise<Uint8Array | undefined>;
  cacheWrite(key: string, bytes: Uint8Array): Promise<void>;
}
```

**Rationale**: FR-022 names two capabilities in prose ("the bytes at a location, or a refusal" and
"the canonical identity of a location, or the absence of one") but FR-025 separately requires the
on-disk cache to move behind the host — a third, distinct capability FR-022's own prose does not
enumerate but the requirements list does. `§15`'s "How far the host boundary reaches" amendment
names exactly three things that move: the local read, `realpath` for the sandbox check, and the
on-disk cache. `read`/`canonicalize`/`cacheRead`+`cacheWrite` are those three, one method (pair)
each.

**What does *not* join `Host`**: the network fetch. `§15`'s amendment says the fetch "already
went through an injectable transport since v0.2, which is half the seam and the half that proves
the shape works" — it is not named among the three things that move. `Transport`
(`src/resolve/transport.ts`) stays exactly as declared. What *does* have to move is
`resolve/fetch.ts`'s `createNetworkTransport` — a concrete implementation that calls the real
`fetch()` directly from a file under `src/resolve/`, which FR-023's literal text ("no module under
`src/` may... call `fetch`") now forbids regardless of `§15`'s framing. This is a finding, not a
design choice: the *interface* was already behind the seam; one concrete *implementation* of it,
sitting on the library side of the line, was not. See D2.

**`cacheRead`/`cacheWrite` are a generic byte store, not two directories.** `DocumentCache`
(`src/resolve/cache.ts`) keeps its policy — content addressing, `Cache-Control`/`ETag`/`Expires`
parsing, freshness — unchanged, but every `existsSync`/`readFileSync`/`writeFileSync`/`mkdirSync`
call is replaced by `host.cacheRead("meta/" + urlKey)` / `host.cacheRead("blob/" + hash)` and their
`cacheWrite` counterparts. The `"meta/"`/`"blob/"` prefixing is library policy (still two logical
namespaces, matching the existing on-disk layout's *shape*), not something `Host` needs to know
about — `Host` sees opaque keys, exactly as FR-022's "supplies, never decides" line requires.

**Rejected alternative**: folding `Transport` into `Host` (`Host.request(url, method)`). Rejected
because it would force every existing `RecordedTransport`-based test and every recorded fixture to
be re-plumbed through a differently-shaped seam for no requirement gain — FR-030 requires the
fixtures to pass *unmodified*, and `Transport`'s contract is not itself broken. Keeping `Transport`
separate is the reading that satisfies FR-030 by construction rather than by careful rewriting.

## D2 — Where the shipped Node host lives, and what it changes about `resolve()`'s defaults

**Decision**: a new, separate entry point, `src/host/node.ts`, exporting:

```ts
export function createNodeHost(options?: { readonly cacheDir?: string }): Host;
export function createNodeTransport(maxBytes?: number): Transport;
```

`createNodeHost`'s `read`/`canonicalize` are today's `readLocalDocument`/`safeRealpath`, moved
verbatim (FR-027: "moved, not changed"). `cacheRead`/`cacheWrite` are `DocumentCache`'s current
`existsSync`/`readFileSync`/`writeFileSync`/`mkdirSync` bodies, moved the same way, keyed by the
opaque string the library now passes rather than computing their own file layout. When
`options.cacheDir` is omitted, both throw the same message `resolve()`'s own `cacheDir` throws
today ("... requires 'cacheDir' ... — the same 'granted, never ambient' posture as 'sandboxRoot'"),
now thrown from the host at the point caching is actually attempted, matching `ResolveOptions`
losing its own `cacheDir` field (below). `createNetworkTransport` moves here unchanged, renamed
`createNodeTransport` for symmetry (behaviorally identical, including remaining untested by the
hermetic suite for the identical reason its predecessor was — CLAUDE.md's "no network in tests").

**Consequence, stated because it is a real behavior change**: `ResolveOptions.transport` **no
longer defaults to a real-network implementation**. Today, `resolve()` calls
`options.transport ?? createNetworkTransport(...)` from inside `src/resolve/fetch.ts` — a module
that, after this milestone, may not call `fetch` at all. Once the concrete network transport lives
on the far side of the seam, `src/index.ts` cannot silently construct one as a fallback without
importing `src/host/node.ts` from the library's own core — which would collapse the exact
distinction Article VI draws ("importing the library proper still cannot touch a disk"). So: an
embedder who wants remote resolution must now explicitly pass a transport (their own, a test
double, or `createNodeTransport()` from the host module) — there is no silent default. This is a
deliberate, spec-forced break from v0.2–v0.6's ergonomics, named here rather than discovered by a
failing test. `ResolveOptions.host` becomes **required** with no default at all (FR-028, matching
`sandboxRoot`'s existing posture) — `resolve()`/`load()` throw if it is omitted or malformed.

`ResolveOptions.cacheDir` **is removed**. Caching is now the host's own construction-time
configuration (`createNodeHost({ cacheDir })`), not a per-call resolve() option — the library no
longer knows what "a directory" means at all, matching FR-025's "the storage does not [stay in the
library]".

**Package export**: `package.json`'s `exports` map gains `"./host/node"` →
`dist/host/node.{js,d.ts}`, compiled automatically (`tsconfig.build.json` already includes all of
`src`).

## D3 — The layering test's new gate 7

**Decision**: extend `tests/unit/layering.test.ts` with a third sweep, scanning **every** `.ts`
file under `src/` (not a fixed subset) for a static/type-only import of `"node:fs"` or a call to
the bare identifier `fetch(` (a regex over source text, the same mechanism the existing two sweeps
already use for import specifiers), **except** `src/host/node.ts`, named explicitly as the
boundary test's own exemption (FR-024). A socket is not separately checked — nothing in this
codebase opens one directly (`fetch` is the only network primitive used anywhere), so the letter of
FR-023 is satisfied by checking the two primitives actually reachable.

This is additive to the existing two sweeps (adapters boundary, resolve boundary) and does not
touch their assertions, satisfying FR-023's "MUST NOT weaken anything this file already asserts."

## D4 — Where `seal`/`final` are read, resolved, and enforced

**Decision, mirroring `cascade`'s own precedent exactly**:

- **Reading**: `src/merge/strategy.ts`'s `readKeysVocabulary` is extended to also read `seal` and
  `final` off each top-level `keys.<name>` declaration (siblings to `provide`/`cascade`, per §9's
  vocabulary line) — **top-level keys only**, the identical scope decision v0.3 FR-027 made for
  `cascade` ("`keys:` in a schema names a key of the config's own top level... never a nested key of
  the same name"). `seal`/`final` are declared at exactly the same syntactic position `cascade` is;
  nothing in this milestone's Acceptance Scenarios or worked examples shows either nested under a
  `demand.keys.<child>` entry the way a further `demand` can be. Recorded as a scope decision, not a
  citation gap — the same posture v0.6 recorded for delegation grants being `keys`-only, not
  `items`-only.
- **Resolution**: a new function, `resolveSeal(layers)` in a new file `src/merge/seal.ts` (mirroring
  `resolveStrategies`'s shape exactly): walks schema layers root-to-leaf, tracking one running
  `{ seal: "open" | "closed"; final?: { layer, span, hasProvide } }` per top-level key.
  `open → closed` is a silent tightening; `closed → open` is refused as `seal-weakened`
  (FR-009's second half — the identical shape `cascade-strategy-weakened` already has, per the
  milestone spec's own words). Once `final` is set by any layer, **any** further declaration of that
  key by any descendant schema layer — of `demand`, `provide`, `cascade`, `seal`, or `final` itself —
  is refused as `final-key-redeclared` (FR-010), independent of whether the later declaration would
  be a legal narrowing. This is a vocabulary-level, schema-authoring check — like
  `cascade-strategy-weakened`, it needs no config data, only the pedigree's own schema trees, so it
  runs alongside `resolveStrategies` in `foldConfiguration` and its diagnostics are concatenated with
  the fold's own (FR-028's precedent, v0.3).
- **Enforcement against the merged tree**: `src/validate/check.ts`'s existing recursive walk gains
  two checks, both needing the merged tree (so they cannot be vocabulary-only):
  - `seal: closed` — FR-007: for a key whose accumulated `demand.keys` vocabulary is non-empty and
    whose resolved seal is `closed`, every child key present in the merged value at that position
    but absent from the accumulated `keys` vocabulary is refused (`seal-violation`), positioned at
    the child.
  - `final` **with** `provide` — FR-011: if the config layer's own raw tree contributes a value at
    that key's pointer (checked the same way `layerForSpanOrigin` already distinguishes "whose span
    this is" — the value's own span traces to the config layer, not to the schema that provided the
    constant), it is refused as `final-key-set`, even though the value may be byte-identical to the
    provided constant — `final` forbids the *act* of setting it, not just a differing value.
  - `required: true` at a `final`+`provide` key — FR-013 — is §5.5's mandated `info` lint,
    reusing the same "does the value's span trace to the schema's own `provide`, never the config"
    test the `final-key-set` check already performs, fired only when `final-key-set` did *not* fire
    (a config that illegally overrides a final key gets the refusal, not the lint, on top of it —
    the refusal already says everything the lint would).

**Why not fold `seal`/`final` resolution into `resolveStrategies` itself** rather than a sibling
file: `cascade`'s resolution and `seal`/`final`'s are three independently-tightening axes over the
same `keys.<name>` declarations, sharing no state — merging them into one function would mean one
function tracking three unrelated running maps, which is harder to read and to test in isolation
than three cousins sharing one iteration shape. `seal.ts` imports nothing `strategy.ts` does not
already import.

**AMENDMENT (during US2 implementation) — the above is superseded for `seal`.** While implementing
against this decision, the coordinator raised (and Egildo then settled) that `seal` was designed
here as a *per-key* keyword — a sibling of `provide`/`cascade`/`final` inside `keys.<name>` — which
is not how §9 of `SPEC.md` actually describes it once read against the worked examples rather than
against the prose summary alone. Egildo's ruling, delivered mid-implementation:

1. **`seal` moves out of the per-key vocabulary entirely and into the `demand` vocabulary** — it is
   now a demand keyword like `type` or `required`, written `demand: { seal: closed, keys: {...} }`,
   not `keys.<name>: { seal: closed }`. `SPEC.md` §9/§6.3/§5.2 were amended to match; this milestone
   spec's FR-006 through FR-009 still read in the old per-key terms and were **not** re-worded to
   match (see the implementation report's governance-findings section).
2. **`final` stays a per-key keyword, but is now written as a bare boolean** (`final: true`), not the
   richer per-key record this section originally sketched. Its resolution keeps needing whole-stack
   memory (§ below) for exactly the reason this section gives: a descendant's redeclaration, even a
   strictly narrower one, must be refused, and nothing but a running per-key map across schema layers
   can catch that.
3. **A schema may additionally carry a single top-level `seal: open | closed`** (sibling to the
   top-level `keys:` map itself), constraining the *config's own* top-level keys the same way a
   nested `seal: closed` constrains a mapping value's children.

The practical consequences for this file's D4, all verified in the shipped code rather than asserted
here:

- `seal` needs **no dedicated resolution function and no whole-stack state at all.** Being a demand
  keyword, it is read fresh off each schema layer's own `demand` (or a named type's own `demand`,
  wholesale — no cross-declaration merging, matching how every other demand keyword already treats
  named types) and checked directly against the merged tree, in `src/validate/check.ts`'s
  `sealClosedSites` (nested) and `topLevelSealDiagnostics` (the new top-level form). `seal.ts` as a
  file does not exist; `resolveSeal` does not exist.
- **`seal-weakened` does not exist**, and is not needed. Because every ancestor schema's own demand
  is checked against the final merged tree redundantly (SPEC.md §5.4, "whole-chain validation") — the
  same property that already lets a named-type narrowing go unenforced by a dedicated diagnostic — an
  attempt by a descendant to widen `closed` back to `open` is automatically inert: the ancestor that
  declared `closed` still fires `seal-violation` against the final tree regardless of what a
  descendant later claims. A dedicated weakening check would be redundant with a check that already
  runs. (`DIAGNOSTIC_LEVEL_CODES`/`SEALING_AUTHORITY_CODES` briefly gained a `seal-weakened` code
  during implementation, then had it retired once this was confirmed by test — see the corresponding
  comment in `src/diagnostics/codes.ts`.)
- **`resolveFinal` (renamed from the `resolveSeal` this section sketched) is the one part of this
  section that shipped essentially as designed**: still a sibling file (`src/merge/final.ts`, `git
  mv`'d from `seal.ts`), still a single non-recursive whole-stack walk over each schema layer's
  top-level `keys:`, still refusing **any** further declaration after `final` is set — narrower or
  not — as `final-key-redeclared`. `KEY_DECLARATION_SIBLINGS` dropped from six entries to five
  (`demand`, `provide`, `cascade`, `final`, `delegate`) now that `seal` is not among them.
- `final-key-set` (FR-011) and the `required: true`-under-`final` info lint (FR-013) are unaffected by
  the correction and shipped as this section describes, simplified to top-level-only lookups (`final`
  never nests, per the coordinator's third correction — see the report).

## D5 — Where `authority:` (`demandPinnedAdoption`, `finalAgainstForking`) is read and enforced

**Decision**: a new module, `src/graph/authority.ts` (format-blind, pedigree-shaped — reads only
already-parsed schema trees, so it belongs beside `graph/pedigree.ts`, not `merge/`, since it must
run *during* `resolve()`'s own pedigree assembly, before `merge()` ever sees the graph — the pinning
demand is a resolution-time policy, not a merge-time one, per §11: "the library verifies, the
pedigree legislates").

- `readAuthoritySection(schemaTree)`: reads a schema's top-level `authority:` mapping into
  `{ demandPinnedAdoption?: boolean; finalAgainstForking?: boolean }`, refusing an unrecognized
  member as `unknown-authority-member` (FR-016) at its own position — the same closed-vocabulary
  shape `merge/strategy.ts`'s `classifyUnrecognizedCascade` already has for schema vocabulary
  problems.
- `checkPinningDemand(pedigree, schemaTreesByLocation)`: a single left-to-right (root-to-leaf) walk
  of the already-built `Pedigree` (§6.1's chain — no diamonds possible, so a single linear walk is
  exhaustive): for each pedigree entry, first check its own `via` reference's `$pin` against
  whatever demand an **earlier** (more-rootward) entry already raised — refusing `adoption-not-pinned`
  if a demand is active and this entry's `via.pin` is `undefined` (FR-017) — *then* read this
  entry's own `authority.demandPinnedAdoption` and, if `true`, arm the demand for every entry after
  it. A descendant "retracting" the demand has no mechanism to retract it at all (there is no
  `demandPinnedAdoption: false` semantics — the vocabulary is a single boolean an author can only
  assert `true`; declaring it `false` is simply not `true`, so it never arms anything and never
  disarms anything already armed) — satisfying FR-018 by construction rather than by a special
  case. The declaring document's **own** `via` (checked in the iteration **before** its own
  declaration is read) is provably exempt from a demand it raises itself — FR-019's inherent limit,
  reachable directly from this ordering, not merely asserted.
- **"Presence", not "verification"**: FR-017 refuses an `$adopts` that "lacks a `$pin`" — a
  syntactic check (`reference.pin !== undefined`), not a verified one. This surfaces a pre-existing
  gap, flagged in full in the milestone report: v0.2 never wired `$pin` verification for **local**
  documents (`src/index.ts`'s `readAtTarget`, local branch, always returns `verified: false` and
  never calls `verifyPin`) — only remote fetches verify. `demandPinnedAdoption` therefore only ever
  guarantees a pin is *written*, not that a local schema's bytes actually match it. This is not
  fixed here: no FR in this milestone's list asks for local pin verification, and adding it
  unasked would be scope creep into a decision `SPEC.md` §11 does not obviously make for local
  reads the way it does for remote ones (a local read has no network attacker model motivating
  pinning in the first place — pinning's whole point is defending a fetch, and a local file is
  already fully under the caller's own filesystem trust).
- `finalAgainstForking` (FR-020) is recorded on `Pedigree`'s own per-entry (or a small pedigree-level
  summary) as a plain boolean, queried via a new field, and produces **no diagnostic of any level** —
  the FR is explicit that nothing should fire.
- **A config's own `authority:` section has no effect** (FR-021): `checkPinningDemand`/
  `readAuthoritySection` are only ever called against **schema** documents (the pedigree, never the
  config layer) — the same structural exemption `resolveStrategies` already gives a config's
  `cascade`, applied here by construction (there is no code path that reads the config's own tree
  for `authority:` at all).

## D6 — `resource` resolution (US6): a new query function, not a validation pass

**Decision**: a new library function, `resource(configuration, pointer)`, in a new file
`src/validate/resource.ts`, shaped like `why()` (`src/merge/provenance.ts`):

```ts
export type ResolvedResource =
  | { readonly kind: "url"; readonly location: string }
  | { readonly kind: "path"; readonly location: string }
  | { readonly kind: "not-a-resource" }
  | { readonly kind: "unknown-pointer" };
export function resource(configuration: MergedConfiguration, pointer: string): ResolvedResource;
```

**Purely lexical, purely a function of the pointed-at node's own shape and its span's origin** —
no schema/demand lookup is needed at all, which is what makes FR-039 ("resolution is lexical;
nothing is read; existence is never checked") true by construction rather than by discipline:

1. Resolve `pointer` against `configuration.tree`. Absent → `unknown-pointer`.
2. Not a string scalar → `not-a-resource`.
3. Parses as an absolute URL (`isValidUrl`, the identical predicate `check.ts`'s
   `matchesBuiltinLeaf` already uses for the `url` built-in type) → `{ kind: "url", location: value }`
   (FR-036: resolves to itself).
4. Otherwise (a `path`-shaped string, `isValidPath`'s identical predicate) → resolve it against
   `dirname(node.span.origin.id)` (Node's `path.resolve`/`path.dirname` — pure string algebra, not
   I/O, the same posture `resolve/location.ts` already holds for lexical resolution) and return
   `{ kind: "path", location: resolved }`.
5. Neither shape (e.g. a string containing a space that also fails `new URL()`) → `not-a-resource`.

**Why `span.origin.id` alone is sufficient, including through delegation (FR-037)**: every span's
`origin.id` is already the exact location string of the document that produced that node — the
entry document's absolute path, a schema's own location, or (v0.6) a delegated fragment's own
per-graft synthetic id, `"<fragment-location> #graft=<n>"`. `path.dirname` on that synthetic string
still yields the fragment's real directory, because the `" #graft=<n>"` suffix contains no path
separator — the last `/` in the string is still the one separating the fragment's real directory
from its real filename. Verified by inspection of `performGraft`'s `graftId` construction
(`src/index.ts`); a conformance case makes it explicit rather than relying on this being obviously
true (US6 Acceptance Scenario 3 requires exactly this case). No new provenance field is needed —
this is the same "the span already carries what a caller needs" property `layerForSpanOrigin`
already exploits for a different purpose (attributing a violation to a layer).

**Why not fold this into `validate()`/`checkConfiguration`**: FR-038 requires a `resource` pointing
outside the sandbox to be reported, never refused — so this can produce no diagnostic at all, ever,
for any input; it is a read-only query over an already-certified configuration, not a check that
can fail a `load()` call. Keeping it a sibling to `why()` rather than a validate-time side effect
keeps `validate()`'s contract ("a configuration or diagnostics, never both") untouched.

## Constitution Check (re-run after this research)

1. `tsc` clean, no `any`, no assertion casts — planned: yes. `Host`/`ResolvedResource`/`SealState`
   are plain interfaces built the same way every other model type in this codebase is.
2. Conformance corpus — new fixture families: `tests/corpus/cases/seal/`,
   `tests/corpus/cases/authority/`, a `tests/unit/host-*.test.ts` family for US4 (an in-memory
   `Host` test double, mirroring `RecordedTransport`'s own role), and `tests/unit/resource-*.test.ts`
   for US6.
3. Monotonicity property tests — `seal: open→closed` and `final`'s "closes even a narrowing" are
   exactly the two new monotonicity-table rows §5.2 gained this milestone; each gets its own
   property test alongside the existing `monotonicity.test.ts` suite.
4. No new runtime dependency — holds; every new module uses only `node:path`/`node:crypto` (already
   in use elsewhere) or nothing at all.
5. New diagnostics — every one carries `level` (US1's own new field, mandatory from this milestone
   on) plus the full v0.4-era set (`pointer`, `demand`, `pedigreePosition`) wherever a violation is
   involved.
6. Format-blindness boundary — unaffected; nothing new imports an adapter.
7. Host boundary (new) — planned and satisfied by design: `src/host/node.ts` is the only exemption,
   named in D3's extension to `layering.test.ts`.

**PASS.**
