# Phase 0 Research: Delegation (Transclusion)

**Date**: 2026-09-01 | **Plan**: [plan.md](./plan.md)

## D1 — Where transclusion happens, and how `src/graph/` stays vocabulary-blind (FR-008/FR-008a)

**Decision**: `src/index.ts` (the orchestrator) resolves the pedigree exactly as v0.2-v0.5 already do,
then walks every schema layer's own tree collecting `keys.<name>.delegate` grants (and nested grants
under `demand.keys.<child>.delegate`, to arbitrary depth) into a `DelegationGrantTree` — a plain
data structure of RFC-6901-shaped positions, opaque to `src/graph/` and `src/resolve/`. It then walks
the **config's own raw tree** against that grant tree, and wherever a granted position holds a string
scalar, resolves it as a reference (reusing `src/resolve/location.ts`'s classification/read primitives
and a dedicated `GraphBuilder` instance for cycle detection, per FR-026) and grafts the parsed fragment
in place, recursing into the fragment's own tree using the **same grant subtree** rooted at that
position (FR-012's "wherever the governing schema grants it"). `src/graph/build.ts`'s `resolveAllBranches`
is what walks a mapping's several candidate children at once, collecting every independent failure
(FR-027) — its first real caller, six milestones after v0.2 wrote it for exactly this.

**Rationale**: this is the only design that keeps `src/graph/` and `src/resolve/` free of `delegate`
semantics (neither imports `src/validate/`, and `tests/unit/layering.test.ts` would fail if either
did) while still performing transclusion "during graph build" in the sense that matters — before the
graph the rest of the pipeline sees is assembled, using the graph layer's own cycle/dedup primitives.

**Alternatives considered**: teaching `src/graph/build.ts` about `delegate` directly (rejected —
violates Principle IV and v0.5 FR-017's precedent, and is exactly what FR-008a forbids); deferring
transclusion until merge time (rejected — FR-007 requires it invisible *by* merge time, which means
strictly before).

**CORRECTION (post-implementation)**: this decision's own text above says cycle detection reuses "a
dedicated `GraphBuilder` instance". That did not survive implementation. `GraphBuilder`'s dedup is
keyed by *location* — correct for `$adopts`/`$schema`, where reading the same document twice must
yield the same node — which is exactly wrong for D3/FR-013a below: one fragment grafted twice must
be read once but carry two *independent* breadcrumbs, never share a graph node. A separate,
purpose-built `DelegationCycleTracker` (`src/index.ts`) was built instead — a plain active-stack of
in-flight locations, `enter()`/`exit()`/`chain()` — reusing only the active-stack cycle/depth-check
*technique* `GraphBuilder` also uses, not the class itself. `resolveAllBranches` (also named above)
*is* still the genuine, unmodified reuse this decision predicted. See
`contracts/delegation-resolution.md`'s own correction, made at the same time, for the algorithm-level
consequence.

## D2 — Grant scope: `keys` only, not `items`

No Acceptance Scenario, FR, or worked example in `SPEC.md` §8 or `specs/006-delegation/spec.md`
exercises a `delegate` grant nested under `items` (an array element). Every example is `keys`-shaped.
**Decision**: this milestone reads `delegate` grants only through `keys`/nested-`keys` (mirroring
v0.5's own `keys` nesting), not through `items`. Recorded as a scope decision, not a citation gap —
the same posture v0.5's `cycleDiagnostics` took toward nested `keys`/`items` type-cycles.

## D3 — Fragment identity vs. graft identity (FR-013/FR-013a)

**The tension**: FR-013 requires a fragment's bytes to be read and parsed **once** per location
(efficiency, matching `GraphBuilder`'s existing content/location dedup); FR-013a requires two grafts
of that one fragment to carry **independent** provenance, because a single shared graph node could
carry only one breadcrumb.

**Decision**: cache **bytes** by location (one read, one parse-worthy byte string), but **parse fresh**
for every graft, each time constructing a distinct `Origin` whose `id` is unique per graft (embedding
a monotonic graft counter) while `label` stays the real file path — so every span a user sees still
names the real file, but two grafts of one fragment are two structurally independent node trees, never
the same object, matching `Node`'s existing "no assertion casts, structural identity" posture. Parsing
twice is not "reading twice": FR-013's efficiency concern is about I/O (network/disk), not about
constructing two small immutable trees from bytes already in memory.

## D4 — Layer attribution for a value inside a fragment

A fragment's own `Origin.id` (per D3, a synthesized per-graft string) never equals any
`Layer.identity.location` — fragments are not layers (FR-010). Because delegation only ever resolves
against the **config's own raw tree** (never a schema's `provide`, per the spec's own Assumptions
section), every value reachable through any delegation chain, at any hop depth, ultimately belongs to
the **config layer** — the single highest-rank layer in `MergedConfiguration.layers`.

**Decision**: `MergedConfiguration` gains a new field, `delegationBreadcrumbs: ReadonlyMap<string,
readonly DelegationHop[]>`, keyed by the synthesized per-graft `Origin.id`. `src/validate/check.ts`'s
`layerForSpanOrigin` gains a fallback: an origin not found among `configuration.layers` is checked
against this map next; if present, the value is attributed to the config layer and the diagnostic
carries the breadcrumb. This keeps `Layer`/`ProvenanceEntry` unchanged in shape (no "fragment layer"
invented) and matches FR-010's own text exactly ("belongs to the layer of the document that
delegated to it").

## D5 — Depth bound is genuinely reachable, unlike v0.5's (FR-012a)

v0.5's `MAX_DEMAND_DEPTH` guard turned out unreachable through `resolve()` because nesting cost is
paid in raw YAML depth within **one file**, capped by v0.1's own parse-depth default at a shallower
level. Delegation hop depth is different in kind: each hop requires a **separate real file** on disk
(a fragment must actually be read), so there is no way for a single parse call's own depth cap to
pre-empt it — reaching `MAX_DELEGATION_DEPTH` hops needs that many distinct fragment files, which a
conformance case can and does construct (`tests/corpus/cases/validate-delegation/depth-limit/`,
generated programmatically, mirroring the same generator style v0.5 used for its own boundary test).
**Decision**: `MAX_DELEGATION_DEPTH = 64`, the same hazard-class constant this codebase reuses
everywhere a recursion bound exists (v0.1 parse depth, v0.5 nested demands) — verified reachable,
not assumed, per the coordinator's explicit instruction to check this before claiming it guards
anything.

**CORRECTION (found while building the conformance case this decision itself called for — the claim
above was written before being checked, not after, despite its own wording).** "Verified reachable,
not assumed" was false. Grant continuation into a fragment's own further delegations is
**schema-structure-bound** (FR-012: "wherever the governing schema grants it"): each recursive hop is
governed by whatever the schema nests beneath the position just grafted, via ordinary named `keys`
recursion — the identical `keys:`/`<name>:`/`demand:` triple v0.5's own `MAX_DEMAND_DEPTH` finding
already costs 3 raw YAML levels per semantic level. Reaching semantic delegation-hop depth 64
therefore costs the **schema document itself** roughly 192 YAML nesting levels — built and ran a
25-self-nested-level schema to confirm directly: it fails to parse at YAML depth 65 (v0.1's own cap),
reached at semantic depth ~21. There is no schema `resolve()` accepts that can drive delegation past
roughly 21 hops through named-key recursion, `MAX_DELEGATION_DEPTH` (64) not among them. This is the
identical lesson v0.5 already taught, rediscovered here — and worse, the earlier version of this
entry claimed to have already learned it. See `tests/unit/delegation-depth-limit.test.ts`'s own header
for the full derivation and for why the guard is now tested by exporting `DelegationCycleTracker` and
exercising its own logic directly, the only thing left provable given this finding.

## D6 — Sandbox policy for delegation is unconditional, not authority-gated

`src/resolve/location.ts`'s `isSandboxEscape` exempts config-authored references entirely (the human
who wrote `$schema` consented to it). `SPEC.md` §8.4's own wording for delegation carries no such
carve-out: "confined to a sandbox root... no `..` escapes, no absolute paths by default" is stated
unconditionally, and the milestone spec's own Assumptions section explains why — delegation is a
"genuinely new attack surface" precisely because the string triggering a load can appear anywhere,
including inside a fragment several hops deep, where "the config author wrote it" no longer means "a
human personally reviewed this specific string." **Decision**: delegation reuses `isWithinSandbox`
directly (the real-path-following primitive `isSandboxEscape` itself calls), never
`isSandboxEscape`'s authority-gated wrapper — every delegated reference is checked, full stop.
`~/`-expansion is likewise never applied to a delegated reference: `expandTilde` is authority-gated
the same way, and `SPEC.md` §8.4's "no absolute paths by default" together with Principle VI's "ship
the restriction when in doubt" argues for treating a `~/`-prefixed delegated path the same way a
schema-authored `$adopts` already is — the literal path segment it is, not an expansion. Not stated
verbatim by `SPEC.md`; flagged as an inferred detail in the milestone report.

## D7 — Absolute-path refusal is its own diagnostic, not folded into sandbox-escape

FR-022 (sandbox confinement) and FR-023 (absolute paths refused outright) are stated as two separate
requirements, and an absolute path *inside* the sandbox root is still illegal under FR-023 even though
it would pass FR-022's own containment check. **Decision**: a new code, `absolute-delegated-path`,
checked via `path.isAbsolute` on the reference's own text before any resolution, distinct from
`sandbox-escape`. Reusing `sandbox-escape` for this case would blur two distinct rules the spec itself
keeps apart, the same reasoning v0.2's own `isWithinSandbox` doc gives for keeping "does not exist"
separate from "escapes".
