# Data Model: Delegation (Transclusion)

## Grant

A schema's `keys.<name>.delegate: allow` (or a nested `keys.<child>.delegate: allow` beneath it,
to arbitrary depth — D2 scopes this to `keys`, not `items`).

| Field | Type | Notes |
|---|---|---|
| `pointer` | `readonly (string)[]` | Path segments from the schema's own `keys:` root, e.g. `["network","subnet"]` |
| `declaringDocument` | `string` | Which schema document granted it (for `FR-002`'s own-position refusal) — a document location, not a `Layer`: `src/resolve/` may not import `src/merge/`, where `Layer` is defined (Principle IV), so the grant is carried in primitives |
| `declaringRank` | `number` | |
| `span` | `SourceSpan` | The `delegate: allow` value's own span |

(Named `DelegationGrant` in `src/resolve/delegate.ts`; the table above originally called these fields
`layer`/`layerRank`, which would have required a layering violation to construct — corrected to match
the actual, layering-clean shape.)

`DelegationGrantTree` is the recursive structure built from every schema layer's own grants, unioned
across the pedigree (any layer granting a position makes it delegable — `delegate` does not narrow or
compose the way a `demand` does; it is a boolean permission, not a constraint):

```ts
interface DelegationGrantNode {
  readonly grant?: Grant;                                   // this position itself
  readonly keys: ReadonlyMap<string, DelegationGrantNode>;   // nested named children
}
```

## Delegation

One act of grafting (spec.md's own Key Entities section): the delegating document and position, the
target reference, and the resolved fragment.

| Field | Type | Notes |
|---|---|---|
| `node` | `Node` | The fragment's root, re-spanned with a per-graft `Origin` (D3) |
| `fragmentLocation` | `string` | The fragment's own resolved location — becomes `documentLocation` for a further recursive hop |
| `breadcrumbChain` | `readonly DelegationHop[]` | Outermost-inward, this graft's own chain (FR-012b) |

(Named `GraftOutcome`'s `ok: true` case in `src/index.ts`. No standalone `reference`/`hopIndex`
fields were needed at runtime: a `Reference` is constructed transiently inside `performGraft` purely
to reuse `classifyReferenceLocation`, and hop depth is tracked by `DelegationCycleTracker`'s own
active-stack size, not carried as a field on this entity — `breadcrumbChain`'s own length already
tells a caller how deep a given graft is.)

## Fragment

A resolved document grafted as a subtree (spec.md's Key Entities). Has no identity as a layer, no
pedigree, and no `$`-keys (FR-009). Its root may be a mapping, sequence, or scalar (FR-011).

## DelegationHop

One link in a breadcrumb — the delegating value's own position.

```ts
interface DelegationHop {
  readonly span: SourceSpan; // the string value that named this hop, in its own document
}
```

## `MergedConfiguration` — additive field

| Field | Type | Notes |
|---|---|---|
| `delegationBreadcrumbs` | `ReadonlyMap<string, readonly DelegationHop[]>` | Keyed by a fragment node's synthesized `Origin.id` (D3/D4) |

## `Diagnostic` — additive field

| Field | Type | Notes |
|---|---|---|
| `delegatedFrom` | `readonly DelegationHop[]` (optional) | Present only for a diagnostic about a value reached through delegation (FR-017/FR-018) — absent, never empty, otherwise |

## `Violation` — additive field (`src/validate/violation.ts`)

| Field | Type | Notes |
|---|---|---|
| `delegatedFrom` | `readonly DelegationHop[]` (optional) | Threaded into `Diagnostic.delegatedFrom` by `renderViolation`; `canonicalSentence` renders the `(delegated from ...)` clause when present |

## New diagnostic codes

| Code | Refuses | Reuses |
|---|---|---|
| `delegate-value-unimplemented` | `delegate:` value other than `allow` (FR-002) | new |
| `fragment-reserved-key` | A `$`-prefixed key inside a fragment (FR-009) | new |
| `remote-delegation-not-permitted` | A remote delegation target with no caller opt-in (FR-024) | new |
| `absolute-delegated-path` | An absolute delegated path (FR-023) | new |
| `document-unreachable` | A delegated target that cannot be read/parsed (FR-002's own scenario 6) | reused (v0.2) |
| `reference-cycle` | A delegation cycle (FR-015, FR-026) | reused (v0.2) |
| `sandbox-escape` | A delegated path escaping the sandbox root (FR-022, D6) | reused (v0.2) |
| `unsupported-scheme` | A delegated reference with an unrecognized scheme | reused (v0.2) |
| `depth-limit-exceeded` | Recursive delegation past `MAX_DELEGATION_DEPTH` (FR-012a, D5) | reused (v0.1/v0.5) |
