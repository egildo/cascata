# Data Model: Sealing, Authority, and the Embedding Surface

## `Diagnostic` — additive/changed field

| Field | Type | Notes |
|---|---|---|
| `level` | `"error" \| "info"` | **New, required** (FR-001) — the one field on `Diagnostic` with no default; every `createDiagnostic()` call site across the codebase must supply it explicitly. Every pre-existing call site gets `"error"` (FR-004, no reclassification). |

`RelatedSpan`, `ViolatedDemand`, and every other existing field are unchanged.

## `Host` (new — `src/resolve/host.ts`)

```ts
export type HostReadResult = { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly reason: string };
export interface Host {
  read(location: string): Promise<HostReadResult>;
  canonicalize(location: string): Promise<string | undefined>;
  cacheRead(key: string): Promise<Uint8Array | undefined>;
  cacheWrite(key: string, bytes: Uint8Array): Promise<void>;
}
```

The library's only route to local bytes, canonical identity, and cache storage (FR-022, FR-025,
FR-026). Never asked a policy question (FR-026: "the host is never asked whether a location is
permitted"). See research.md D1.

## `ResolveOptions` — changed fields

| Field | Change |
|---|---|
| `host` | **New, required.** No default; a missing or malformed value throws (FR-028), matching `sandboxRoot`'s existing posture. |
| `cacheDir` | **Removed.** Caching is now the host's own construction-time configuration (`createNodeHost({ cacheDir })`) — research.md D2. |
| `transport` | **No longer defaults to a real network transport.** Omitting it now means "no remote resolution is possible" (a remote reference reached with no transport throws, same posture as today's "reached with no cacheDir"), not "use the real network." An embedder wanting the real network passes `createNodeTransport()` from `cascata/host/node.js` explicitly. |

## `Seal` (new — per-key state, `src/merge/seal.ts`)

```ts
export type SealOpenness = "open" | "closed";
export interface FinalState {
  readonly layer: Layer;
  readonly span: SourceSpan;
  readonly hasProvide: boolean;
}
export interface KeySealState {
  readonly openness: SealOpenness;
  readonly final?: FinalState;
}
```

Resolved per top-level key, root-to-leaf, exactly as `MergeStrategy` is (data-model.md "Merge
Strategy" analogue). `final` is `undefined` until some layer declares it; once set, it is never
cleared (§6.3: "closes the question," not merely tightens it).

## `Authority` (new — per-schema declarations, `src/graph/authority.ts`)

```ts
export interface AuthoritySection {
  readonly demandPinnedAdoption?: boolean;
  readonly finalAgainstForking?: boolean;
}
```

Read once per schema layer's own top-level `authority:` mapping (FR-016). A config's own
`authority:` is never read (FR-021 — structural, not filtered).

## `Pedigree` / `PedigreeEntry` — additive field

| Field | Type | Notes |
|---|---|---|
| `finalAgainstForking` | `boolean` | **New**, on `PedigreeEntry` — whether *this* schema declared itself final against forking (FR-020). Recorded and queryable; consulted by nothing in v1 (`$extends` does not exist — §6.2). |

## `ResolvedResource` (new — `src/validate/resource.ts`)

```ts
export type ResolvedResource =
  | { readonly kind: "url"; readonly location: string }
  | { readonly kind: "path"; readonly location: string }
  | { readonly kind: "not-a-resource" }
  | { readonly kind: "unknown-pointer" };
```

Returned by `resource(configuration, pointer)` — see research.md D6. Never a diagnostic-bearing
type; this function cannot fail a `load()` call (FR-038).

## New diagnostic codes

| Code | Refuses | Level |
|---|---|---|
| `unknown-seal-value` | `seal:` value other than `open`/`closed` (FR-006) | error |
| `seal-violation` | An undeclared child key under `seal: closed` (FR-007) | error |
| `seal-weakened` | `closed` → `open` (FR-009) | error |
| `final-key-redeclared` | Any descendant schema declaration of a `final` key (FR-010) | error |
| `final-key-set` | A config setting a `final`+`provide` key (FR-011) | error |
| `required-vacuous` | `required: true` under `final`+`provide` (FR-013, §5.5's lint) | **info** |
| `unknown-authority-member` | An unrecognized `authority:` member (FR-016) | error |
| `adoption-not-pinned` | An unpinned `$adopts` below a `demandPinnedAdoption: true` root (FR-017) | error |
| `delegate-inline-string-loaded` | (Not a refusal) a `delegate: allow` key whose demand is a leaf shape (FR-005, §8.1) | **info** |

`document-unreachable` is **reused**, not replaced, for a host read refusal (FR-028) — the hazard
("this reference does not resolve to a readable document") is identical regardless of who declined
to supply the bytes.

## Layer / MergedConfiguration

Unchanged in shape. `Layer.tree` (already carried, per v0.3's own data-model.md note) is what
`seal.ts`/`authority.ts` read; no new field is needed on either.
