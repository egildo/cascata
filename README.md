# Cascata

A format-blind, positioned information model with a YAML adapter, the resolver and DAG builder that
follow a config's `$schema`/`$adopts` chain into a graph and a pedigree, and the merge engine that
folds that chain into one configuration with full provenance — v0.1, v0.2, and v0.3 of the Cascata
configuration cascade (see `SPEC.md` for the full product vision; these are the first three
milestones of its §14 roadmap).

v0.1 turns a document's bytes into a tree of mappings, sequences, and scalars in which **every node
reports exactly where it came from**, or — when the document leans on constructs outside the
portability floor (§4.2) — into a complete, position-ordered list of diagnostics. v0.2 finds the
*documents*: it follows `$schema` and `$adopts` through local files and HTTPS references, verifies
pins, caches fetches, and assembles the result into an acyclic graph with a queryable, root-to-leaf
pedigree. v0.3 is where the chain finally does something: `merge()` folds the pedigree and the config
into **one** node tree — a schema's `provide` fills what the config leaves silent, mappings merge
deeply, everything else replaces unless a key is declared `cascade: append` — while recording, for
every value, an ordered provenance chain `why()` can answer. Constraint checking and validation are
still ahead — v0.4 per `SPEC.md` §14.

Full detail lives in `specs/001-information-model-yaml-adapter/` (v0.1), `specs/002-resolver-dag-builder/`
(v0.2), and `specs/003-merge-engine/` (v0.3) — each has its own `spec.md`, `plan.md`, `data-model.md`,
and `contracts/`. This file is the shorter, code-facing version of the same surface.

## Install

```bash
pnpm install
```

## Public surface

Everything below is exported from the package root. There is no compatibility promise before v1.0
(contracts/parse-api.md, contracts/resolve-api.md).

### `parse(bytes, options)`

The primary entry point. Takes bytes, because that is the only boundary at which `SPEC.md` §4.2's
UTF-8 mandate is enforceable — see the note on `parseText` below.

```typescript
import { parse, createOrigin } from "cascata";

const origin = createOrigin("config.yaml", "config.yaml"); // id, then a human-readable label
const result = parse(new TextEncoder().encode("a: 1\nb: 2\n"), { origin });

if (result.ok) {
  result.tree; // a frozen Node
} else {
  result.diagnostics; // a non-empty, position-ordered Diagnostic[]
}
```

- **`bytes: Uint8Array`** — the document's exact bytes. Validated against UTF-8 (RFC 3629) before
  decoding — an invalid sequence is refused with the offending **byte** offset, never silently
  repaired into replacement characters (v0.2 FR-002). If you only hold already-decoded text, see
  `parseText` below — but prefer this whenever you can supply bytes instead.
- **`options.origin: Origin`** — required. Which document this is, for diagnostics that need to name
  their source. Build one with `createOrigin(id, label)`.
- **`options.limits?: Partial<{ maxDepth: number; maxBytes: number }>`** — overrides the resource caps
  (defaults: `maxDepth: 64`, `maxBytes: 8 MiB`; contracts/parse-api.md "Limits"). Depth counts the root
  as 0, each nested collection adds 1, and a merge-folded mapping counts at the depth of the mapping
  receiving it, not at the depth where its anchor happens to be written.

**Behavioral contract** (contracts/parse-api.md):

1. Never throws for a bad *document* — a malformed, hostile, or unportable document produces
   `{ ok: false, diagnostics }`. Exceptions are reserved for programmer error (a missing `origin`).
2. Total: every input produces one of the two outcomes; none hangs, none exhausts memory.
3. Deterministic: identical input yields identical trees and identical diagnostic order, every run.
4. One call reports **every** floor violation it can detect, not just the first (FR-019).
5. The returned tree is deeply frozen; mutation attempts throw.
6. No I/O. `parse()` reads the text it is handed and touches nothing else.

### The information model

```typescript
type Node = Scalar | Mapping | Sequence;

interface Scalar {
  type: "scalar";
  kind: "string" | "int" | "float" | "bool" | "null";
  value: string | bigint | number | boolean | null; // bigint for kind "int", exact at any magnitude
  span: SourceSpan;
}

interface Mapping {
  type: "mapping";
  entries: ReadonlyMap<string, Node>; // canonical order — sorted by key, by Unicode code point
  span: SourceSpan;
}

interface Sequence {
  type: "sequence";
  items: readonly Node[]; // write order, semantically significant
  span: SourceSpan;
}

interface SourceSpan {
  origin: Origin;
  start: number; // byte offset, 0-based
  end: number; // one past the last byte
  line: number; // 1-based
  column: number; // 1-based, counted in Unicode code points
}
```

Every node is constructible only through a span-requiring factory — there is no way to build one
without a position. `Mapping.entries` is likewise constructible only in canonical (sorted) order —
authored order is discarded the same way comments and quoting style are (`SPEC.md` §4.2, §4.3).

`nodesEqual(a, b)` is the one definition of model equality: scalars by `(kind, value)`, mappings by key
set regardless of order, sequences by items in order. Spans and origins take no part in it.

### Diagnostic codes

Stable, part of the public contract (contracts/diagnostics.md). Every diagnostic carries a `code`, a
human-readable `message`, a `primary: SourceSpan`, and zero or more labelled `related: RelatedSpan[]`.

| Code | Refuses |
|---|---|
| `duplicate-key` | The same key twice in one mapping — including a quoting-only collision (`"host"` vs `host`) — with the first occurrence attached as a `related` span |
| `non-string-key` | A key that isn't text: a complex (sequence/mapping) key, or a non-text scalar key (`1:`, `true:`, `null:`) |
| `unsupported-tag` | Any tag outside the YAML 1.2 core schema — `!!binary`, `!!timestamp`, `!!set`, `!!omap`, and any unknown tag. The span points at the tagged *value*, not the tag token itself — the underlying reader exposes no position for a tag without the CST layer `SPEC.md` §4.3 defers |
| `multiple-documents` | More than one document in the input, at the second document marker |
| `invalid-encoding` | Two triggers, one code: from `parseText()`, an unpaired UTF-16 surrogate in already-decoded text (see "Known limitation" below); from `parse()`, a byte sequence that is not well-formed UTF-8 (RFC 3629) — overlong encodings, encoded surrogates, and codepoints past U+10FFFF all included — refused at the **byte** offset where it starts, before any decoding (v0.2 FR-002) |
| `depth-limit-exceeded` | Nesting past `maxDepth`, at the node where the limit was crossed |
| `size-limit-exceeded` | Input larger than `maxBytes`, refused before parsing (zero-width at offset 0). Since v0.2, also reused for a fetched remote document whose body exceeds `resolve()`'s `limits.maxBytes` — enforced **during** streaming, anchored to the reference that fetched it |
| `alias-cycle` | An alias referring to content that encloses itself, at the closing alias |
| `malformed-document` | Input the underlying reader cannot parse at all, or an otherwise-uncategorized reader error |

### `parseText(text, options)`

Retained for callers that already hold decoded text. Produces trees identical to `parse()` for valid
input, spans included.

**Known limitation** (v0.1 FR-016, superseded by v0.2 FR-002): `parseText()` receives already-decoded
text, which cannot itself *be* invalid UTF-8 — decoding happened before Cascata saw it. Byte sequences
that were genuinely invalid UTF-8 have already become replacement characters by the time
`parseText()` runs, and are accepted as ordinary text. **`parse()` does not have this limitation**: it
validates the bytes against RFC 3629 before decoding and refuses them with the offending byte offset.
Prefer `parse()` wherever you hold bytes.

### `resolve(entryPath, options)`

**v0.2.** Follows the entry document's `$schema` — and every ancestor's `$adopts` — into an acyclic
graph and an ordered, root-to-leaf **pedigree** of schema identities (contracts/resolve-api.md).
References may be local paths or `https://` URLs; a schema takes exactly one `$adopts` parent
(`SPEC.md` §6.1, §9), so the pedigree is always a chain, never a tree.

```typescript
import { resolve } from "cascata";

// config.yaml: "$schema: ./house.yaml"
// house.yaml:  "$adopts: ./core.yaml"
// core.yaml:   "$id: core"                (no further $adopts — the chain's root)

const result = await resolve("./config.yaml", { sandboxRoot: process.cwd() });

if (result.ok) {
  result.graph; // every document read, entry first, acyclic
  for (const entry of result.pedigree) {
    // root-to-leaf: core.yaml, then house.yaml
    entry.identity.location; // absolute path or normalized URL
    entry.identity.hash; // lowercase-hex SHA-256 over the exact bytes
    entry.via.span; // where the reference that adopted it was written
    entry.verified; // whether a $pin was present and matched (v0.2 FR-026)
  }
} else {
  result.diagnostics; // non-empty, position-ordered — each anchored to a reference (v0.2 FR-023)
}
```

- **`entryPath: string`** — the entry document's path. Always local; the entry itself is never a URL.
- **`options.sandboxRoot: string`** — **required**, no default, none inferred from the entry
  document's location (v0.2 FR-022). A **schema-authored** local reference resolving outside this
  root — including through a symlink — is refused as `sandbox-escape` (v0.2 FR-021). A **config's own**
  reference is exempt (v0.2 FR-020): the author wrote it, which is consent (`SPEC.md` §9's own worked
  chain, `$schema: ~/.config/house.yaml`, depends on this asymmetry).
- **`options.cacheDir?: string`** — where fetched remote documents are cached on disk (v0.2 FR-016).
  Optional in the type, but resolution throws the moment it reaches an `https://` reference with none
  supplied — granted, never ambient, the same posture as `sandboxRoot`, enforced only where it becomes
  load-bearing. A purely local chain needs neither `cacheDir` nor network access.
- **`options.transport?: Transport`** — an injection point for the HTTP layer (used by this project's
  own hermetic test suite to supply recorded responses; contracts/recorded-responses.md). Omit it for
  the real network.
- **`options.maxChainLength?: number`** — default `32`; a longer chain is refused as
  `chain-limit-exceeded`.
- **`options.limits?: Partial<{ maxRedirects: number; requestTimeoutMs: number; maxBytes: number }>`**
  — defaults `5`, `10000`, and `8 MiB` respectively (contracts/resolve-api.md "Limits"). Response size
  is enforced **during** streaming, so a server advertising a small body and sending an unbounded one
  is cut off mid-stream, not measured after the fact.

**`ResolveResult`** is `{ ok: true, graph: Graph, pedigree: Pedigree } | { ok: false, diagnostics: Diagnostic[] }`
— never both. `Graph.documents[0]` is always the entry document; `Pedigree` never includes it (it
answers "what schemas am I bound by", and the config is not an answer to that — v0.2 FR-011).

**Behavioral contract** (contracts/resolve-api.md):

1. Never throws for bad *input* — unreachable documents, cycles, pin mismatches, sandbox escapes are
   all diagnostics. Exceptions remain for programmer error: a missing `sandboxRoot`, or a remote
   reference reached with no `cacheDir` supplied.
2. Total: cycles are detected, chain length is capped, fetches time out — nothing hangs.
3. Deterministic: the same inputs and cache state produce the same graph, the same pedigree order, and
   the same diagnostics in the same order, every run (v0.2 SC-009).
4. A remote reference carrying `$pin` is verified against it; on mismatch the bytes are discarded, not
   merely flagged — they never enter the graph (v0.2 FR-014).
5. A chain whose documents were all fetched before resolves with **no network available** (v0.2 FR-016).

### Reference & pedigree types

```typescript
interface Reference {
  text: string; // what was written — a relative path, a `~/`-prefixed path, or an absolute URL
  span: SourceSpan; // where it was written, in the document that wrote it
  kind: "schema" | "adopts";
  authority: "config-authored" | "schema-authored"; // decides sandbox treatment — never from the text
  pin?: string; // the stated `$pin`, if any
}

interface DocumentIdentity {
  location: string; // absolute resolved location — a real path, or a normalized URL
  hash: string; // lowercase-hex SHA-256 over the exact bytes (SPEC.md §6.1)
}

interface PedigreeEntry {
  identity: DocumentIdentity;
  via: Reference; // the reference that brought this schema into the chain
  verified: boolean; // whether `via.pin` was present and matched (v0.2 FR-026)
}

type Pedigree = readonly PedigreeEntry[]; // root to leaf; a chain, never a tree (v1 single-parent adoption)
```

### v0.2 diagnostic codes

Extends v0.1's catalogue above; v0.1's codes are unchanged (contracts/diagnostics.md). **Every code
here reports the position of the reference, in the document that wrote it — not merely the document
that failed** (v0.2 FR-023).

| Code | Refuses |
|---|---|
| `document-unreachable` | A referenced document that does not exist, cannot be read, or timed out |
| `reference-cycle` | A reference closing a loop, naming every reference in the cycle, in chain order |
| `multiple-adoption` | A sequence value for `$adopts`/`$schema` — v1 adopts exactly one parent (`SPEC.md` §6.1, §9) |
| `chain-limit-exceeded` | A chain longer than `maxChainLength` |
| `unsupported-scheme` | A reference whose scheme is not HTTPS or a relative path — `http:`, `file:`, `data:` |
| `sandbox-escape` | A **schema-authored** local reference resolving outside the sandbox root, including through a symlink |
| `pin-mismatch` | Fetched bytes whose hash differs from the stated `$pin` — names both expected and actual; the bytes never enter the graph |
| `malformed-pin` | A `$pin` that is not a well-formed `sha256:<64 hex digits>` value |
| `insecure-redirect` | A redirect hop leaving HTTPS — checked hop by hop, not just at the final destination |
| `too-many-redirects` | More redirect hops than `maxRedirects` |
| `document-not-cached` | A remote document neither reachable nor already cached |

### `merge(resolved)`

**v0.3.** Folds a resolved `Graph`/`Pedigree` — exactly `resolve()`'s `ok: true` shape — into one
`MergedConfiguration`: a single node tree plus a provenance record (contracts/merge-api.md). A
schema's `keys.<name>.provide` fills whatever the config leaves silent; mappings merge deeply; every
other pairing replaces, unless a schema declares `cascade: append`, in which case sequences accumulate
instead. `demand`, `seal`, `final`, and `delegate` are read by nothing in this milestone and MUST be
ignored, not guessed at (`SPEC.md` §9, v0.3 FR-002).

```typescript
import { resolve, merge, why } from "cascata";

// core.yaml:   "$id: core" with `keys: { timeout: { provide: 30 }, styles: { cascade: append, provide: [reset.css] } }`
// house.yaml:  "$adopts: ./core.yaml" with `keys: { styles: { provide: [house.css] } }`
// config.yaml: "$schema: ./house.yaml" with `styles: [project.css]`

const resolved = await resolve("./config.yaml", { sandboxRoot: process.cwd() });
if (!resolved.ok) throw new Error("resolve failed");

const result = merge({ graph: resolved.graph, pedigree: resolved.pedigree });
if (result.ok) {
  result.configuration.tree; // { timeout: 30, styles: [reset.css, house.css, project.css] } — a frozen Node
  result.configuration.provenance; // RFC 6901 pointer -> ordered ProvenanceEntry[]
} else {
  result.diagnostics; // malformed merge policy — non-empty, position-ordered
}
```

- **`resolved: { graph: Graph; pedigree: Pedigree }`** — exactly what a successful `resolve()` call
  produces; `merge()` performs no I/O of its own and reads no file (contracts/merge-api.md point 5).
- **`MergeResult`** is `{ ok: true, configuration: MergedConfiguration } | { ok: false, diagnostics: Diagnostic[] }`
  — never both. `ok: false` is reached only by malformed merge policy (see "v0.3 diagnostic codes"
  below) — never by anything about the config's own data, since values themselves cannot be malformed.

**Behavioral contract** (contracts/merge-api.md):

1. Never throws for malformed merge policy — it is a diagnostic. Exceptions remain for programmer
   error.
2. Total: the fold visits each node once per contributing layer.
3. Deterministic: the same pedigree and config produce a byte-identical tree, the same provenance
   chains in the same order, and the same diagnostics, on every run (v0.3 SC-005).
4. The merged tree satisfies every v0.1 invariant — positioned, canonically ordered, deeply frozen
   (v0.3 FR-010). Merge does not get an exemption for being downstream.
5. No I/O. Merge reads no file and opens no socket.
6. Provenance is complete: every value in the tree has a chain, and every chain names every
   contributing layer — including those overridden (v0.3 FR-019, FR-022).

#### Precedence (contracts/precedence.md, `SPEC.md` §5.3)

For any key, the value is decided by the first rule that applies:

1. **A nearer layer beats a further one.** Layers rank root-first: the root schema is lowest, each
   `$adopts` descendant higher, and the config highest of all.
2. **Mappings on both sides merge deeply**, rule 1 applying independently to each key inside. This is
   the only rule that recurses.
3. **Any other pairing replaces**, wholesale — a scalar over a mapping, a sequence over a sequence, a
   mapping over a scalar. Deep merge is for mappings only.
4. **Unless the key is declared `cascade: append`**, in which case sequences accumulate root-first
   instead of replacing, and no contribution is ever removed — **from the declaring layer downward**.
   A layer that settled under `replace` before the declaration stays settled; `append` binds
   descendants, never ancestors (`SPEC.md` §2.3, §5.2).
5. **An explicit null is a value**, and replaces by rule 1. It is not an absence that yields to a
   provide.
6. **Absence contributes nothing.** A layer silent on a key neither overrides nor clears it.

The list is total: for any two layers and any key, exactly one rule decides — there is no
tie-breaking, because there are no ties.

### `why(configuration, pointer)`

**v0.3.** Answers where a merged value came from — the `git config --show-origin` question — for an
RFC 6901 `pointer` into `configuration.tree`. A library function, not a command: `SPEC.md` §10 writes
`tool why`, but no CLI ships before v1.0's typed output surface (v0.3 research D3).

```typescript
const timeout = why(result.configuration, "/timeout");
// { kind: "chain", entries: [{ layer, span, outcome: "won" }] } — core.yaml alone supplied it

const styles = why(result.configuration, "/styles");
// { kind: "chain", entries: [
//   { layer: <core.yaml>,   outcome: "accumulated" },
//   { layer: <house.yaml>,  outcome: "accumulated" },
//   { layer: <config.yaml>, outcome: "accumulated" },
// ] } — root-first, cascade: append has no single winner
```

**`WhyResult`** is one of three outcomes, all reachable and deliberately distinct:

- **`{ kind: "chain", entries: ProvenanceEntry[] }`** — a value or a container exactly one layer
  wrote, ordered winner-first for a `replace`-terminated chain, or chronologically root-first for one
  ending in accumulation. Each `ProvenanceEntry` carries its contributing `layer`, its `span` in that
  layer's real document, and its `outcome`: `"won"`, `"overridden"`, or `"accumulated"`.
- **`{ kind: "synthesized", contributors: ProvenanceEntry[] }`** — a mapping **two or more layers
  independently contributed to** (whether or not their own keys overlap), so no single layer wrote
  what is actually there; `contributors` names each one rather than being empty.
- **`{ kind: "unknown-pointer" }`** — the pointer names nothing in the merged tree, distinct from
  both of the above, since provenance lives beside the tree rather than on the node (v0.3 research D1)
  and this is where the two structures disagreeing becomes observable rather than silent.

For a key under `cascade: append`, every entry is `"accumulated"` and `why()` never nominates a
winner — reporting the last contributor as though it had won would misdescribe the one strategy where
nothing is overridden. A pointer into a sequence *item* answers for the nearest enclosing recorded
pointer (mapping-key granularity — items have no contribution history distinct from their sequence's).

### Merge and provenance types

```typescript
interface Layer {
  identity: DocumentIdentity; // v0.2's DocumentIdentity — which document
  role: "schema" | "config";
  rank: number; // precedence order: 0 is the root schema; highest is the config
  tree: Node; // this layer's own parsed tree
}

type MergeStrategy = "replace" | "append"; // "merge-by-key" is reserved, not a member (v0.3 FR-014)

interface ProvenanceEntry {
  layer: Layer;
  span: SourceSpan; // where in that layer's real document
  outcome: "won" | "overridden" | "accumulated";
}

type ProvenanceRecord = ReadonlyMap<string, readonly ProvenanceEntry[]>; // RFC 6901 pointer -> chain

interface MergedConfiguration {
  tree: Node; // the folded tree — frozen, canonically ordered, every node positioned
  provenance: ProvenanceRecord;
  pedigree: Pedigree; // carried through from resolve(), unchanged
}
```

### v0.3 diagnostic codes

Extends v0.1's and v0.2's catalogues above, unchanged (contracts/diagnostics.md). Every code below
refuses **malformed merge policy** — data in a schema, never a config's own values, which cannot be
malformed the way policy can (`SPEC.md` §5.3: policy belongs to the contract, not to individual
documents).

| Code | Refuses |
|---|---|
| `unknown-cascade-strategy` | A `cascade` value that is not a strategy this version implements — including a non-string value |
| `unimplemented-cascade-strategy` | `cascade: merge-by-key` — reserved by `SPEC.md` §5.3 but not built; the author is early, not wrong, so this is distinct from `unknown-cascade-strategy` |
| `append-over-non-sequence` | `cascade: append` on a key whose value in some layer is not a sequence — positioned at the offending value, in the layer that supplied it, not at the `cascade` declaration |
| `cascade-strategy-weakened` | A descendant declaring `replace` for a key an ancestor declared `append` — refused because it would discard every ancestor's accumulated contribution (`SPEC.md` §5.2), not because the declaration is malformed on its own |

A **config** declaring its own `cascade` produces no diagnostic — it is ignored, never honoured, since
policy comes from schemas only (v0.3 FR-015). A schema using `demand`, `seal`, `final`, or `delegate`
likewise produces nothing — this milestone reads neither meaning nor error into vocabulary it does not
implement (v0.3 FR-002).

## Scripts

```bash
pnpm test        # the full suite: conformance corpus + unit tests
pnpm typecheck    # tsc --noEmit, strict
pnpm build        # emit dist/ with type declarations
```

## The conformance corpus

`tests/corpus/cases/` is the shared, format-agnostic corpus contracts/conformance-case.md describes:
each case is a JSON file naming its input and the outcome it must produce (an expected tree, an
expected diagnostic list, or — for the one decision needing it — a second document the first must be
model-equal to). Adding a case is adding a file; no runner or adapter code changes. `tests/corpus/
coverage.test.ts` asserts every §4.2 decision has the cases FR-023 requires.

`resolve()`'s own conformance corpus lives alongside it: `tests/corpus/resolve-cases/` holds one JSON
descriptor per case (fixture documents under `tests/corpus/cases/`, expected outcome as a `Graph`/
`Pedigree`/diagnostics shape — `contracts/resolve-api.md`), covering every local `$schema`/`$adopts`
chain scenario. Remote scenarios (fetching, pinning, caching, redirects) are hermetic `.test.ts` files
under `tests/unit/` instead, driven directly against `resolve()` with an explicit recorded `Transport`
(contracts/recorded-responses.md) — the JSON format has no field for one.

## Dependency policy

`yaml` (eemeli's) is the sole runtime dependency, per the project constitution
(`.specify/memory/constitution.md`). Everything else is a dev dependency.
