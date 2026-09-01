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

## `Seal` / `Final` — **AMENDED mid-implementation; see research.md D4's amendment for the full
account.** This section originally designed `seal` as per-key state resolved whole-stack, alongside
`final`, in one `src/merge/seal.ts`. Egildo's ruling during US2 implementation moved `seal` into the
`demand` vocabulary instead (a demand keyword, not a per-key one — no whole-stack resolution, no
dedicated file); only `final` kept the shape this section sketches, renamed `final.ts`, and switched
to a bare boolean (`final: true`) rather than the richer per-key record below. The type that actually
ships:

```ts
// src/merge/final.ts
export interface FinalState {
  readonly layer: Layer;
  readonly span: SourceSpan;
  readonly hasProvide: boolean;
}
export interface KeyFinalState {
  readonly final?: FinalState;
}
```

`final` is `undefined` until some layer declares it; once set, it is never cleared, and any further
declaration of that key — narrower or not — is refused (§6.3: "closes the question," not merely
tightens it). `SealOpenness`/`KeySealState` as typed above do not exist in the shipped code; `seal`'s
actual resolved shape is just the raw `"open" | "closed"` string read straight off a `demand`
mapping's own `seal` entry, per schema layer, with no accumulation across layers at all — see
research.md D4's amendment for why none is needed.

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

**AMENDED**: `unknown-seal-value` does not exist — a malformed `seal:` value is refused by the
existing `malformed-demand-value` code, reused (`seal` is a demand keyword now, checked the same way
every other malformed demand value is). `seal-weakened` does not exist and was never needed —
whole-chain validation (SPEC.md §5.4) makes a descendant's attempted widening automatically inert, no
dedicated diagnostic required (research.md D4's amendment). The row below is struck through for the
paper trail; the two rows after it are as-shipped.

| Code | Refuses | Level |
|---|---|---|
| ~~`unknown-seal-value`~~ | ~~`seal:` value other than `open`/`closed` (FR-006)~~ — see `malformed-demand-value` | — |
| `seal-violation` | An undeclared child key under `seal: closed` (FR-007) | error |
| ~~`seal-weakened`~~ | ~~`closed` → `open` (FR-009)~~ — inert by whole-chain validation, no code needed | — |
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
