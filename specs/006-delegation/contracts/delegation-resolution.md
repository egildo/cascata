# Contract: Delegation Resolution

## Algorithm

1. `resolve()` walks `$schema`/`$adopts` exactly as v0.2-v0.5 already do, producing a `Graph`/`Pedigree`
   unchanged in shape.
2. The orchestrator collects a `DelegationGrantTree` from every schema layer's own `keys:`/nested-`keys`
   tree (D1, D2) — a pure `Node`-walk, no dependency on `src/validate/`.
3. The orchestrator walks the **config's own raw tree** (`graph.entry.tree`) against the grant tree's
   own top level:
   - A position with no grant: descend into its own children if it is a mapping (looking for further
     granted descendants), otherwise leave as written.
   - A granted position holding a **string** scalar: this is a delegation target (FR-006). Classify,
     sandbox-check (D6), depth-check (D5), and resolve it via `DelegationCycleTracker`
     (`src/index.ts`) — cycle detection, FR-015/FR-026 — shared across the **whole** delegation walk
     for one `resolve()` call (so a cycle spanning two different grafted fragments is still caught).
     **Correction**: earlier drafts of this contract named `GraphBuilder` (`src/graph/build.ts`) for
     this role; the implementation uses a separate, purpose-built active-stack tracker instead,
     because `GraphBuilder`'s own dedup is keyed by *location* — the right rule for `$adopts`/`$schema`,
     where the same document read twice is the same node — which is exactly wrong for delegation's
     FR-013a requirement (one fragment grafted twice must be read once but carry two independent
     breadcrumbs, never share a node). `DelegationCycleTracker` reuses only the active-stack
     cycle/depth-check *technique*, not the class. Read once per location (cached), parse fresh per
     graft (D3). Refuse any `$`-prefixed key in the fragment's own top level (FR-009) — fragments
     never carry their own further `$`-keys, at any depth, since a fragment's own nested mappings are
     ordinary data once past its root.
   - A granted position holding **anything else** (a mapping, a sequence, a non-string scalar): used
     as written (FR-004) — the grant permits, it never compels.
   - **Several granted positions in one mapping**: resolved via `resolveAllBranches`
     (`src/graph/build.ts`), collecting every independent failure (FR-027) rather than stopping at the
     first.
4. Once a fragment is grafted, the walk **recurses into the fragment's own tree**, using the grant
   subtree rooted at the same position (FR-012) — so a nested `delegate: allow` beneath the position
   that was just grafted governs the fragment's own top-level keys exactly as it would have governed
   an inline mapping at that position. The hop counter increments by exactly one per graft, never per
   tree level (D5): walking *inline* structure inside one document costs nothing against the bound.
   **This does not make `MAX_DELEGATION_DEPTH` cheap to reach with real files**: the grant subtree
   used at hop *N+1* is the same `DelegationGrantNode` object that governed hop *N* (`src/index.ts`'s
   `walkForDelegation`, its own recursive call), so permitting a further hop requires the *schema* to
   nest one more `demand.keys.<name>.delegate: allow` level. A real chain therefore costs the schema
   document roughly 3 raw YAML levels per hop it wants to permit, and v0.1's own 64-level parse-depth
   cap is reached — as `depth-limit-exceeded` from `parse()`, not from delegation's own guard — around
   semantic hop depth ~21, well short of `MAX_DELEGATION_DEPTH`. Confirmed by construction
   (research.md D5's correction), not assumed. `MAX_DELEGATION_DEPTH` and its tracker are exported
   from `src/index.ts` specifically so the guard's own logic can still be tested directly.
5. The result is a new `graph.entry.tree` — a config tree with every delegation target already
   replaced by its fragment's contents — fed into `buildGraph`/`buildPedigree` unchanged. Everything
   from `merge()` onward sees a tree indistinguishable from having been written inline (FR-007,
   FR-014).

## `delegate:` vocabulary (FR-001 through FR-005)

- Read from schema documents only (`role: "schema"` layers); a config's own `delegate` key has no
  effect (FR-003) — it is read nowhere, exactly like `provide`/`cascade`/`types:` before it.
- `delegate: allow` is the only recognized value (FR-002). Anything else —
  `delegate: deny`, `delegate: { allow: true, formats: [...] }`, `delegate: true` — is
  `delegate-value-unimplemented`, at the value's own position, naming what is supported.

## Security (FR-021 through FR-026)

- Resolved relative to the **delegating document's own directory** (the config, or — for a recursive
  hop — the fragment that named the next one), never the schema's, never `process.cwd()`.
- `path.isAbsolute` on the reference's raw text, before any resolution: `absolute-delegated-path`.
- `isWithinSandbox` (unconditional, D6) on the resolved local path: `sandbox-escape`.
- A remote (`https://`) target: refused as `remote-delegation-not-permitted` unless the **caller**
  (never any document) opted in via a new `ResolveOptions` field, `allowRemoteDelegation?: boolean`.
  With opt-in, fetched under the existing v0.2 remote machinery (HTTPS-only, pin verification, cache).
- Any other scheme: `unsupported-scheme`, matching `$adopts`'s own existing refusal.

## The breadcrumb (FR-017 through FR-020)

- A diagnostic about a value reached through delegation carries `delegatedFrom`, chain outermost-inward
  (FR-012b); a diagnostic about a non-delegated value carries no such field at all (FR-018).
- `canonicalSentence` appends `(delegated from <doc>:<line> -> <doc>:<line> ...)` when present, still
  assembled from structured fields alone (FR-019).
- `why()`'s provenance chain surfaces the same breadcrumb for a value inside a fragment (FR-020).
