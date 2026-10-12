# Cascata — API reference

> The code-facing reference, version by version. For the introduction, start at the [README](../README.md); for the language itself, [`SPEC.md`](../SPEC.md).

**A library a tool embeds to turn a folder of human-readable documents into one validated
configuration object.** The tool names a launching point; the library walks the cascade from it,
enforces every schema it finds along the way, resolves the resources those schemas describe, and
returns an object that knows where each value came from — or refuses, naming the document, the line,
and the rule that was broken. Format-blind above the adapter, provenance-rich throughout, and it
performs no I/O of its own: everything it needs from outside the call it was given, it asks its host
for (`SPEC.md` Article VI).

**v1.12.1.** `SPEC.md` is a living document since v1.12.1: amended by named article with an entry in
§15, which names every change of behaviour in a sentence, and no longer gated by version. All eight
milestones of its §14 roadmap shipped at v1.0, which froze it (§15's freeze rule, retired at v1.12.1: a
*correction* always, an *addition* while no existing meaning changed, a changed meaning only at v2.0).
v1.1 was the first release under that freeze, v1.2 the second, v1.3 the third, v1.4 the fourth, v1.5 the fifth, v1.6 the sixth, v1.7 the seventh, v1.8 the eighth, v1.9 the ninth, v1.10 the tenth, v1.11 the eleventh. The first eight are
additions — Article VIII's accumulated demand and type generator, then a second format adapter, then the
launching schema, then a namespace the host can own, then a library that loads in a browser realm, then config
documents the embedder names ranked after the entry, then a sandbox the caller may grant more than one root for, then a scalar under `append` taken as a list of one. v1.9 is corrections only: offsets count the stored
bytes, a lone CR in YAML is the line break YAML 1.2.2 says it is, and a byte-order mark YAML does not admit
is refused. v1.10 is both: an addition (writing a value back) and corrections that bound a
document's cost by its size. v1.11 is an addition: which document an edit belongs in, and writers.
Nothing a schema meant before any of those releases means anything else after it. Two of the first eight carry
*corrections* beside their additions: v1.4's, that a `sandboxRoot` naming a filesystem root contains what is
under it, and v1.7's two — that a location which does not exist is judged through its nearest existing
ancestor, so a root behind a symbolic link no longer reads *absent* as *outside*, and that a schema's `~/`
expands (and is then confined), which §5.3 had always shown and §15 had forbidden.

| | |
| --- | --- |
| **v0.1** | the positioned information model and the YAML adapter — every node reports exactly where it came from, or the document is refused with a complete, position-ordered list of diagnostics |
| **v0.2** | the resolver and DAG builder — `$schema` and `$adopts` followed through local files and HTTPS, pins verified, fetches cached, the result an acyclic graph with a queryable root-to-leaf pedigree |
| **v0.3** | the merge engine — one node tree, per-key `replace`/`append`, and a provenance chain `why()` can answer |
| **v0.4** | the constraint checker — the closed `demand` vocabulary, whole-chain validation, and the error contract |
| **v0.5** | named types, selector parameters, and nested demands to arbitrary depth |
| **v0.6** | delegation: a fragment grafted into its parent's tree, sandboxed, positionally validated, with a breadcrumb on every diagnostic |
| **v0.7** | sealing and authority (`seal`, `final`, `authority:`), the host seam and `load()`, and the meta-schema bootstrap — the language describing itself and validating against itself |
| **v1.0** | **the output surface** — `project()` and `load<T>()`, the value a consumer actually reads (`SPEC.md` Article VII) — plus the freeze |
| **v1.1** | **the accumulated demand, and the TypeScript type generator** — `accumulate()` and `generate()`, `generateTypes()`, and soundness against the validator as the conformance rule (`SPEC.md` Article VIII) |
| **v1.2** | **the JSON adapter** — a second format, hand-written against RFC 8259, selected for `.json` by the registry v0.2 built for it; format-blindness stops being a claim about the architecture and becomes an observed fact about two live adapters |
| **v1.3** | **the launching schema** — `resolve()`/`load()` accept `schema`, a stand-in for the `$schema` line an entry did not write, consulted only when the entry names none; built for an embedder whose entry is a Markdown file's frontmatter |
| **v1.4** | **host-resolvable identity** — an optional `Host.locate` lets a host own a URI scheme, so `$adopts: beltype:document` names a document by identity rather than by a path that differs on every machine; plus the correction that `sandboxRoot: "/"` contains everything under it |
| **v1.5** | **it loads where Node does not** — `node:crypto`, the `Buffer` global, `node:path` and `node:os` are gone from the library proper: SHA-256 is arithmetic of its own, byte length is counted rather than encoded, and path semantics are an optional `Host.paths` the shipped Node host answers with `node:path`'s own functions |
| **v1.6** | **overrides** — `resolve()`/`load()` accept `overrides`, config documents the embedder names, read after the entry's chain and ranked after it in the order given, governed by every demand, `final` and `append` the pedigree accumulated exactly as the entry is; built for an embedder whose operator sets a key from a command line |
| **v1.7** | **sandbox roots** — `sandboxRoot` takes a list, and a schema's `~/` expands and is then confined, so a house schema shared by every project on a machine has a lawful door; plus the correction that an absent file under a symlinked root is `document-unreachable` and not `sandbox-escape`, and `posixPaths` exported from `@egildo/cascata/paths` |
| **v1.8** | **a scalar under `append`** — a single value contributed to a key under `cascade: append` is taken as a list of one and appended, with an `info` notice (`append-scalar-wrapped`) at the author's own position; a mapping is still refused (`SPEC.md` §5.3) |
| **v1.9** | **spans count stored bytes** — corrections only: offsets count the document's stored bytes, a carriage return and a leading byte-order mark included, so a span slices exactly its node's text; line and column count what a person sees, with LF, CRLF and a lone CR each ending a line; a lone CR in YAML reads as the line break YAML 1.2.2 says it is, and a byte-order mark outside a document prefix or a quoted scalar is `malformed-document` (`SPEC.md` §4.2) |
| **v1.10** | **writing a value back, and bounded cost** — `locate` and `setValue` rewrite one YAML or JSON value in place, in the file's own style, every other byte untouched (`SPEC.md` Article IX); aliases resolve in one pass, the parser's quadratic duplicate-key check is replaced by Cascata's own, and alias expansion has a budget (`expansion-limit-exceeded`), so a few hundred bytes of nested aliases are refused rather than expanded (§4.2, §11) |
| **v1.11** | **edit targets, and writers** — `editTarget` answers which document, and which pointer inside it, holds the value that won at a merged pointer (a schema's `provide` and a remote document are refused by name); `why()` entries carry that in-document `pointer`; `yamlWriter()` and `jsonWriter()` offer `locate`/`setValue` in the editing stage's shape from `@egildo/cascata/writers` (`SPEC.md` Article IX)  |
| **v1.12** | **after the review** — `sharedEdits` (`refuse`, `warn`, `allow`) on `setValue`, `editTarget` and the writers, with a file delegated to at two places counted as shared; columns and in-document pointers computed once, restoring the bounded-cost claim for long lines and for asking about every value; an empty document located after its marks, a bare `? a` read as `a: null`, a tag dropped where it cannot hold the value written (`SPEC.md` Article IX, §15) |
| **v1.13** | **graph identity** — every document has a logical path (the route taken) and a physical one (where it is: the host's `canonicalize`, or the URL after redirects), and identity is physical: a schema that adopts itself under another spelling, through a link or through a redirect is `reference-cycle`, as is a document with the bytes of one already on its chain; a relative reference starts from the logical path in a file and the physical URL in a remote document, and `link-changes-reference` (`info`) reports where the other rule would have named a different document; an `https://` reference is labelled in its WHATWG-normalized form (`SPEC.md` Article VI, §15) |
| **v1.14** | **`glob`** — a built-in refinement of `string` again: a strict subset of the LSP `GlobPattern` (`*`, `**`, `?`), checked like a `path` and never confined; `globBase()` answers where a pattern is anchored; an optional `Host.list` and `@egildo/cascata/host/memory`; and `expand()`, a stage of its own that walks the patterns through the host, confined by physical path, deduplicated and sorted by code point (`SPEC.md` §7, Article VI, §15) |

Full detail lives in `specs/001-…` through `specs/024-…`, each with its own `spec.md`, `plan.md`,
`research.md`, `data-model.md`, and `contracts/`. This file is the shorter, code-facing version of
the same surface.

## Quick start

```typescript
import { load } from "@egildo/cascata";
import { createNodeHost } from "@egildo/cascata/host/node";

interface Site {
  readonly styles: readonly string[];
  readonly port: bigint;            // the schema demands `type: int`, so exactness is kept
}

const result = await load<Site>("./site.yaml", { host: createNodeHost(), sandboxRoot: process.cwd() });

if (result.ok) {
  result.value.styles[0];        // ordinary data: no walk, no tagged union, no spans
  result.configuration.tree;     // still there — spans, provenance, pedigree
  result.diagnostics;            // any info-level lints the configuration earned
} else {
  result.diagnostics;            // errors, each naming a document, a line, and a rule
}
```

`T` is the caller's claim and the library never checks it (Article VII). Deriving it from the schema
chain is the generator's job (`SPEC.md` §14), and `generateTypes()` does it from v1.1 — see below.

## Install

```bash
pnpm install
```

## Public surface

Everything below is exported from the package root. From v1.0 to v1.12 the surface carried the
compatibility promise `SPEC.md` §15 made about the *language* (a correction always; an addition while
no existing meaning changed; a changed meaning only at v2.0). Since v1.12.1 it changes as `SPEC.md`
does: by the owner's ruling, every change of behaviour named in §15.

### `parse(bytes, options)`

The primary entry point. Takes bytes, because that is the only boundary at which `SPEC.md` §4.2's
UTF-8 mandate is enforceable — see the note on `parseText` below.

```typescript
import { parse, createOrigin } from "@egildo/cascata";

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
- **`options.limits?: Partial<{ maxDepth: number; maxBytes: number; expansionRatio: number; expansionAllowance: number }>`** —
  overrides the resource caps (defaults: `maxDepth: 64`, `maxBytes: 8 MiB`, `expansionRatio: 10`,
  `expansionAllowance: 10,000`; contracts/parse-api.md "Limits"). Depth counts the root
  as 0, each nested collection adds 1, and a merge-folded mapping counts at the depth of the mapping
  receiving it, not at the depth where its anchor happens to be written. **The expansion budget (v1.10,
  YAML only):** the model never contains references (§4.2), so every alias is expanded into a copy, and the
  tree may hold at most `expansionRatio × W + expansionAllowance` model nodes, where *W* is the number of
  nodes the document writes (scalars, mappings, sequences, the root; keys are not nodes; an alias is one
  node, however much it expands to). It is counted as the expansion proceeds, so a "billion laughs" stops
  at the alias that crosses the budget instead of exhausting memory. Sharing a 20-node profile across a
  thousand records is far inside it; a 100-node anchor repeated a thousand times is not, and wants
  `expansionRatio: 100`. JSON has no aliases and is not counted.

**Behavioral contract** (contracts/parse-api.md):

1. Never throws for a bad *document* — a malformed, hostile, or unportable document produces
   `{ ok: false, diagnostics }`. Exceptions are reserved for programmer error (a missing `origin`) and
   for an internal inconsistency (an `Internal error: …` guard the reader keeps), which is a bug to report.
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
  start: number; // byte offset into the stored bytes, 0-based
  end: number; // one past the last byte
  line: number; // 1-based
  column: number; // 1-based, counted in Unicode code points
}
```

**Positions count two things, for two readers** (`SPEC.md` §4.2, v1.9). `start` and `end` count the
document's **stored bytes**, exactly as read: a carriage return is a byte, a leading byte-order mark is
three, and `bytes.subarray(start, end)` is exactly the text that produced the node (a quoted scalar's
quotes included). Text handed to `parseText` is counted as its UTF-8 encoding. `line` and `column` are
for a person: LF, CRLF and a lone CR each end one line, nothing else does (not U+2028, U+2029 or NEL),
and `column` counts code points from the start of its line, except that a byte-order mark at the very start of the stored bytes is not counted (any other U+FEFF is a character, and an editor's cursor counts it as one). In YAML a lone CR
is a line break, as YAML 1.2.2 says, and a byte-order mark is accepted only before the document's
content or inside a quoted string — anywhere else it is `malformed-document`, positioned at the mark.

Every node is constructible only through a span-requiring factory — there is no way to build one
without a position. `Mapping.entries` is likewise constructible only in canonical (sorted) order —
authored order is discarded the same way comments and quoting style are (`SPEC.md` §4.2, §4.3).

`nodesEqual(a, b)` is the one definition of model equality: scalars by `(kind, value)`, mappings by key
set regardless of order, sequences by items in order. Spans and origins take no part in it.

### Diagnostic codes

Stable, part of the public contract (contracts/diagnostics.md). Every diagnostic carries a `level`
(`"error"` or `"info"`, since v0.7), a `code`, a human-readable `message`, a `primary: SourceSpan`, and zero or
more labelled `related: RelatedSpan[]`; one about a value inside a delegated fragment also carries `delegatedFrom` (v0.6).
Since v0.4, a diagnostic produced by `validate()` additionally carries `pointer?: string` (an RFC 6901
pointer into the **merged** configuration), `demand?: { pointer: string; span: SourceSpan }` (the
violated demand's own position, in its declaring document), and `pedigreePosition?: number` (the
declaring layer's rank) — all three optional, so every diagnostic from an earlier stage stays valid
with no changes (constitution Principle III's phased contract; see "v0.4 diagnostic codes" below).

| Code | Refuses |
|---|---|
| `duplicate-key` | The same key twice in one mapping — including a quoting-only collision (`"host"` vs `host`), and since v1.12.1 a second merge key `<<` (several sources go in one list, `<<: [*a, *b]`) — with the first occurrence attached as a `related` span |
| `non-string-key` | A key that isn't text: a complex (sequence/mapping) key, or a non-text scalar key (`1:`, `true:`, `null:`) |
| `unsupported-tag` | Any tag outside the YAML 1.2 core schema — `!!binary`, `!!timestamp`, `!!set`, `!!omap`, and any unknown tag. The span points at the tagged *value*, not the tag token itself — the underlying reader exposes no position for a tag without the CST layer `SPEC.md` §4.3 defers |
| `multiple-documents` | More than one document in the input, at the second document's `---` (or, after `...`, its first content). Since v1.12.1 it is the only diagnostic about anything from the second document's prefix on, and a byte-order mark ahead of a later `---` is that document's prefix, not a misplaced mark |
| `invalid-encoding` | Two triggers, one code: from `parseText()`, an unpaired UTF-16 surrogate in already-decoded text (see "Known limitation" below); from `parse()`, a byte sequence that is not well-formed UTF-8 (RFC 3629) — overlong encodings, encoded surrogates, and codepoints past U+10FFFF all included — refused at the **byte** offset where it starts, before any decoding (v0.2 FR-002) |
| `depth-limit-exceeded` | Nesting past `maxDepth`, at the node where the limit was crossed |
| `size-limit-exceeded` | Input larger than `maxBytes`, refused before parsing (zero-width at offset 0). Since v0.2, also reused for a fetched remote document whose body exceeds `resolve()`'s `limits.maxBytes` — enforced **during** streaming, anchored to the reference that fetched it |
| `alias-cycle` | An alias referring to content that encloses itself, at the closing alias |
| `expansion-limit-exceeded` | **v1.10.** Expanding aliases (and merge keys) took the tree past `expansionRatio × W + expansionAllowance` nodes, at the outermost alias being expanded when the count crossed (for a merge key, its value). The message names W, the budget and the count reached. One diagnostic, then the read stops |
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
References may be local paths, `https://` URLs, or (since v1.4) a scheme the host claims through `Host.locate`; a schema takes exactly one `$adopts` parent
(`SPEC.md` §6.1, §9), so the pedigree is always a chain, never a tree.

```typescript
import { resolve } from "@egildo/cascata";
import { createNodeHost } from "@egildo/cascata/host/node";

// config.yaml: "$schema: ./house.yaml"
// house.yaml:  "$adopts: ./core.yaml"
// core.yaml:   "$id: core"                (no further $adopts — the chain's root)

const result = await resolve("./config.yaml", { host: createNodeHost(), sandboxRoot: process.cwd() });

if (result.ok) {
  result.graph; // every document read, entry first, acyclic
  for (const entry of result.pedigree) {
    // root-to-leaf: core.yaml, then house.yaml
    entry.identity.location; // the logical location: the route taken — an absolute path, or a normalized URL
    entry.identity.physical; // v1.13: where the document really is — the host's canonical path, or the URL after redirects
    entry.identity.hash; // lowercase-hex SHA-256 over the exact bytes
    entry.via.span; // where the reference that adopted it was written
    entry.verified; // whether a $pin was present and matched (v0.2 FR-026)
  }
} else {
  result.diagnostics; // non-empty, position-ordered — each anchored to a reference (v0.2 FR-023)
}
```

- **`entryPath: string`** — the entry document's path. Always local; the entry itself is never a URL.
- **`options.sandboxRoot: string | readonly string[]`** — **required**, no default, none inferred
  from the entry document's location (v0.2 FR-022, v1.7 FR-004). A location, or a list of them; a
  bare string is the one-element list, and a reference is inside the sandbox when it is inside **any**
  granted root. A **schema-authored** local reference resolving outside every one of them — including
  through a symlink — is refused as `sandbox-escape` (v0.2 FR-021), and the refusal names the path as
  resolved, every granted root, and this option. A **config's own** reference is exempt (v0.2 FR-020):
  the author wrote it, which is consent (`SPEC.md` §9's own worked chain, `$schema: ~/.config/house.yaml`,
  depends on this asymmetry). Granted, never ambient, member-wise: `undefined`, `""`, `[]`, and a list
  with a member that is not a non-empty string all throw. Delegation is confined by the same set —
  there is one sandbox, not one per mechanism.
- **`options.host: Host`** — **required** (v0.7, Article VI): the library's only route to local bytes,
  canonical identity and cache storage; a missing or malformed host throws. The on-disk cache directory
  v0.2 took as `cacheDir` moved behind it: `createNodeHost({ cacheDir })`. A purely local chain needs
  neither a cache directory nor a transport.
- **`options.transport?: Transport`** — the HTTP layer. There is no default (v0.7): the library never calls
  `fetch` itself, so resolution throws the moment it reaches an `https://` reference with none supplied —
  granted, never ambient, as `sandboxRoot` is. Pass `createNodeTransport()` from `@egildo/cascata/host/node`
  for the real network, or a recorded transport in tests (contracts/recorded-responses.md).
- **`options.maxChainLength?: number`** — default `32`; a longer chain is refused as
  `chain-limit-exceeded`.
- **`options.limits?: Partial<{ maxRedirects: number; requestTimeoutMs: number; maxBytes: number }>`**
  — defaults `5`, `10000`, and `8 MiB` respectively (contracts/resolve-api.md "Limits"). Response size
  is enforced **during** streaming, so a server advertising a small body and sending an unbounded one
  is cut off mid-stream, not measured after the fact.

**`ResolveResult`** is `{ ok: true, graph, pedigree, delegationBreadcrumbs, paths, diagnostics } | { ok: false, diagnostics }`
— never both; the `ok` branch's `diagnostics` holds only `info` lints. Pass the whole result to `merge()` so the
breadcrumbs and the path facility are carried through. `Graph.documents[0]` is always the entry document; `Pedigree` never includes it (it
answers "what schemas am I bound by", and the config is not an answer to that — v0.2 FR-011).

**Behavioral contract** (contracts/resolve-api.md):

1. Never throws for bad *input* — unreachable documents, cycles, pin mismatches, sandbox escapes are
   all diagnostics. Exceptions remain for programmer error: a missing or malformed `sandboxRoot` or
   `host`, or a remote reference reached with no `transport` supplied.
2. Total: cycles are detected, chain length is capped, fetches time out — nothing hangs.
3. Deterministic: the same inputs and cache state produce the same graph, the same pedigree order, and
   the same diagnostics in the same order, every run (v0.2 SC-009).
4. A remote reference carrying `$pin` is verified against it; on mismatch the bytes are discarded, not
   merely flagged — they never enter the graph (v0.2 FR-014).
5. A chain whose documents were all fetched before resolves with **no network available** (v0.2 FR-016).

### Reference & pedigree types

```typescript
interface Reference {
  text: string; // what was written — a relative path, a `~/`-prefixed path (expanded for a local document under either authority since v1.7), or an absolute URL
  span: SourceSpan; // where it was written, in the document that wrote it
  kind: "schema" | "adopts" | "delegate" | "override"; // "delegate" v0.6, "override" v1.6
  authority: "config-authored" | "schema-authored"; // decides sandbox treatment — never from the text
  pin?: string; // the stated `$pin`, if any
}

interface DocumentIdentity {
  location: string; // the logical location, the route taken (v1.13) — a real path with no link followed, or a normalized URL as written
  physical: string; // v1.13: where the document really is — the host's canonical path, or the URL after redirects. Always present; equal to `location` when nothing differs. Identity is this one
  hash: string; // lowercase-hex SHA-256 over the exact bytes (SPEC.md §6.1)
}

interface PedigreeEntry {
  identity: DocumentIdentity;
  via: Reference; // the reference that brought this schema into the chain
  verified: boolean; // whether `via.pin` was present and matched (v0.2 FR-026)
  finalAgainstForking: boolean; // v0.7: the schema declared authority.finalAgainstForking (recorded, consulted by nothing in v1)
}

type Pedigree = readonly PedigreeEntry[]; // root to leaf; a chain, never a tree (v1 single-parent adoption)
```

### v0.2 diagnostic codes

Extends v0.1's catalogue above; v0.1's codes are unchanged (contracts/diagnostics.md). **Every code
here reports the position of the reference, in the document that wrote it — not merely the document
that failed** (v0.2 FR-023).

| Code | Refuses |
|---|---|
| `document-unreachable` | A referenced document that does not exist or cannot be read. A remote fetch that times out or fails falls back to a stale cached copy, else it is `document-not-cached` |
| `reference-cycle` | A reference closing a loop, naming every reference in the cycle, in chain order. Since v1.13 the loop is judged physically: a document reached again under another spelling, through a symbolic link or through a redirect, or one whose bytes are exactly those of a document already on the chain, closes it, and the message names both spellings and the file |
| `multiple-adoption` | A sequence value for `$adopts`/`$schema` — v1 adopts exactly one parent (`SPEC.md` §6.1, §9) |
| `chain-limit-exceeded` | A chain longer than `maxChainLength` |
| `unsupported-scheme` | A reference whose scheme is not HTTPS, not a relative path, and not claimed by `Host.locate` (v1.4) — `http:`, `file:`, `data:` |
| `sandbox-escape` | A **schema-authored** local reference resolving outside every granted sandbox root, including through a symlink. A reference to a file that merely does not *exist* is `document-unreachable`, not this (v1.7 FR-001/FR-002) |
| `reference-fragment` | An `https://` reference — absolute, relative to a remote document, a delegated location, an override, or a `Host.locate` answer — whose URL carries a fragment (`a.yaml#x`, `#x`, even an empty `#`) (v1.13 FR-020). A fragment names a place inside a document, never a different document, and Cascata gives it no meaning, so the text is refused at the reference rather than guessed. Not for a local path, where `#` is an ordinary filename character; a redirect `Location` with a fragment is not refused, the fragment is dropped from the physical URL |
| `pin-mismatch` | Fetched bytes whose hash differs from the stated `$pin` — names both expected and actual; the bytes never enter the graph |
| `malformed-pin` | A `$pin` that is not a well-formed `sha256:<64 hex digits>` value |
| `insecure-redirect` | A redirect hop leaving HTTPS — checked hop by hop, not just at the final destination |
| `too-many-redirects` | More redirect hops than `maxRedirects` |
| `document-not-cached` | A remote document neither reachable nor already cached |

### Delegation (`SPEC.md` §8, Article VI, v0.6)

A schema grants one key `delegate: allow`; a config supplying a **string** there gets that file's
contents grafted in as the subtree at that position, before merge and validation — indistinguishable
from having been written inline (§8.2's identity claim). Resolved as part of `resolve()` itself, after
the pedigree is walked and before the graph is handed onward:

```typescript
// schema.yaml
keys:
  network:
    demand: { type: mapping }
    delegate: allow      # a string value here means: load and graft

// config.yaml
network: ./conf.network.yaml   # grafted — network.yaml's own content lands here
favicon: ./icon.png             # NOT granted — stays the literal string (§8.1's razor)
```

- **§8.1's razor**: nothing infers delegation from a value's *shape*. A string at an ungranted key is
  always data, never an instruction to load — verified not just by a dedicated case but by the entire
  pre-v0.6 corpus, which has zero grants anywhere and would fail almost everywhere if this ever broke
  (a real sabotage result, not a hypothetical one).
- **A grant permits, never compels** (FR-004): an inline mapping at a granted key is used as written.
- **`delegate: allow` is the only recognized value** (FR-002); anything else, including the future
  `delegate: { allow: true, formats: [...] }` selector form, is `delegate-value-unimplemented`.
- **Recursive, depth-bounded** (FR-012, FR-012a): a fragment may itself delegate, wherever the
  governing schema grants it, up to `MAX_DELEGATION_DEPTH` (64) hops. In practice this bound is
  reachable only via a schema deep enough to grant many nested levels by name — and, unlike v0.1's own
  parse-depth cap, that schema depth itself collides with the same 64-level parse limit well before
  the delegation bound does (see `tests/unit/delegation-depth-limit.test.ts`), so the guard is tested
  directly rather than end to end through a real chain of files.
- **One fragment, many grafts, independent provenance** (FR-013, FR-013a): the same file grafted at
  two positions is read once but parsed and attributed independently — two grafts never share a
  breadcrumb, which is what makes each one's own error position correct.
- **Security is unconditional, not authority-gated** (§8.4): every delegated reference — however
  deeply nested, whoever nominally "wrote" the string — is confined to the granted sandbox roots and refused if
  absolute, with no `$schema`-style exemption for a "config-authored" string. Remote targets are
  refused unless the **caller** opts in (`ResolveOptions.allowRemoteDelegation`), never a schema; the
  refusal names the missing opt-in and never suggests a schema could grant it.
- **Article VI in practice**: remote delegation asks the same injectable `Transport` remote
  `$schema`/`$adopts` fetches already use (v0.2) — the host answers with bytes or the transport
  reports a failure, and either way `resolve()` returns an ordinary diagnostic, never an exception.
  Since v0.7, local delegation reads go through the same `Host` as every other read (`host.read`); no file
  under `src/` outside the shipped Node host imports `node:fs`.
- **The breadcrumb** (§10, the last of Principle III's phased diagnostic fields): a diagnostic about a
  value inside a fragment carries `delegatedFrom`, naming the chain of delegating positions outermost
  to innermost; a diagnostic about a non-delegated value carries none at all. `canonicalSentence`
  appends `(delegated from site.yaml:12)` (or a longer chain) from these structured fields alone.

### v0.6 diagnostic codes

| Code | Refuses |
|---|---|
| `delegate-value-unimplemented` | A `delegate:` value other than `allow` |
| `fragment-reserved-key` | A `$`-prefixed key inside a fragment's own root |
| `remote-delegation-not-permitted` | A remote delegation target with no caller opt-in |
| `absolute-delegated-path` | An absolute delegated path — refused even if it resolves inside the sandbox |

`document-unreachable`, `reference-cycle`, `sandbox-escape`, and `unsupported-scheme` (v0.2) and
`depth-limit-exceeded` (v0.1/v0.5) are reused for delegation's own identical hazards rather than
repurposed with new codes.

### `merge(resolved)`

**v0.3.** Folds a resolved `Graph`/`Pedigree` — exactly `resolve()`'s `ok: true` shape — into one
`MergedConfiguration`: a single node tree plus a provenance record (contracts/merge-api.md). A
schema's `keys.<name>.provide` fills whatever the config leaves silent; mappings merge deeply; every
other pairing replaces, unless a schema declares `cascade: append`, in which case sequences accumulate
instead. As of v0.3, `demand`, `seal`, `final`, and `delegate` were read by nothing and had to be
ignored, not guessed at (`SPEC.md` §9, v0.3 FR-002) — **stale as a claim about the library overall**:
`demand` is read by `validate()` since v0.4, and `delegate` is read (and grafts fragments) as part of
`resolve()` since v0.6. `merge()` itself still reads neither — folding stays exactly what v0.3 built —
`seal` and `final` are read as of v0.7 — `seal` by `validate()` (it moved into the `demand`
vocabulary, `SPEC.md` §9 amended) and `final` by the fold's own whole-stack resolution. See v0.7
below, and Delegation above.

```typescript
import { resolve, merge, why } from "@egildo/cascata";
import { createNodeHost } from "@egildo/cascata/host/node";

// core.yaml:   "$id: core" with `keys: { timeout: { provide: 30 }, styles: { cascade: append, provide: [reset.css] } }`
// house.yaml:  "$adopts: ./core.yaml" with `keys: { styles: { provide: [house.css] } }`
// config.yaml: "$schema: ./house.yaml" with `styles: [project.css]`

const resolved = await resolve("./config.yaml", { host: createNodeHost(), sandboxRoot: process.cwd() });
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
- **`MergeResult`** is `{ ok: true, configuration: MergedConfiguration, diagnostics } | { ok: false, diagnostics: Diagnostic[] }`
  — never both; the `ok` branch's `diagnostics` holds only `info` lints (v1.8: `append-scalar-wrapped`). `ok: false` is
  reached only by malformed merge policy (see "v0.3 diagnostic codes" below) or, since v0.7, by a schema
  redeclaring a key an ancestor sealed `final` (`final-key-redeclared`) — never by anything about the config's own
  data, since values themselves cannot be malformed.

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
`tool why`, and **no CLI ships at all** — `SPEC.md` §14 places none in any milestone, and v1.0 is the
output *surface*, not a command line. v0.3's research D3 said "before v1.0's typed output surface",
which read as a promise this milestone would bring one; corrected at v1.0 rather than left to imply
a CLI that was never scheduled.

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

- **`{ kind: "chain", entries: WhyEntry[] }`** — a value or a container exactly one layer
  wrote, ordered winner-first for a `replace`-terminated chain, or chronologically root-first for one
  ending in accumulation. Each `ProvenanceEntry` carries its contributing `layer`, its `span` in that
  layer's real document, and its `outcome`: `"won"`, `"overridden"`, or `"accumulated"`.
  Each entry also carries `pointer` (v1.11, below the list).
- **`{ kind: "synthesized", contributors: WhyEntry[] }`** — a mapping **two or more layers
  independently contributed to** (whether or not their own keys overlap), so no single layer wrote
  what is actually there; `contributors` names each one rather than being empty.
- **`{ kind: "unknown-pointer" }`** — the pointer names nothing in the merged tree, distinct from
  both of the above, since provenance lives beside the tree rather than on the node (v0.3 research D1)
  and this is where the two structures disagreeing becomes observable rather than silent.

For a key under `cascade: append`, every entry is `"accumulated"` and `why()` never nominates a
winner — reporting the last contributor as though it had won would misdescribe the one strategy where
nothing is overridden. A pointer into a sequence *item* answers for the nearest enclosing recorded
pointer (mapping-key granularity — items have no contribution history distinct from their sequence's).

**`pointer` (v1.11).** Every entry `why()` returns carries `pointer`: the RFC 6901 pointer of the entry's value
*inside its own document* (`span.origin`), found in that document's own tree by the entry's span. For a config
layer it is usually the merged pointer; for a value grafted from a delegated fragment it is the fragment's own
(`/L1/elevation` where the merged pointer is `/levels/L1/elevation`); for a schema's `provide` it is where the
provided value sits in the schema document (`/keys/defaults/provide/height`). It is the pointer of the entry's
*value*, so for a pointer into a list's item the entries are the list's, with the list's pointers. Where an alias
or a merge key gives two nodes one span, `why()` — which reports, and does not act — chooses by convention: the node at the pointer asked about, then the node with the
same last segment, then the first. `editTarget` refuses such a value under its default `sharedEdits: "refuse"`, and
under `"warn"` or `"allow"` (v1.12) answers the pointer this same convention chooses (below). Added at answer time like `delegatedFrom`; the stored `ProvenanceRecord`
does not carry it.

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

// what why() returns (v1.11): the stored entry plus its pointer inside its own document
type WhyEntry = ProvenanceEntry & { pointer: string };

type ProvenanceRecord = ReadonlyMap<string, readonly ProvenanceEntry[]>; // RFC 6901 pointer -> chain

interface MergedConfiguration {
  tree: Node; // the folded tree — frozen, canonically ordered, every node positioned
  provenance: ProvenanceRecord;
  pedigree: Pedigree; // carried through from resolve(), unchanged
  layers: readonly Layer[]; // since v0.4 — root to leaf, what foldConfiguration already computed
  delegationBreadcrumbs: ReadonlyMap<string, readonly DelegationHop[]>; // v0.6 — by graft origin id
  finalState: ReadonlyMap<string, KeyFinalState>; // v0.7 — the whole stack's final resolution
  paths?: PathFacility; // v1.5 — stamped by resolve(), read by resource()
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
| `append-over-non-sequence` | `cascade: append` on a key whose value in some layer is a **mapping** — positioned at the offending value, in the layer that supplied it, not at the `cascade` declaration. A **scalar** is no longer refused: see `append-scalar-wrapped` (v1.8) |
| `append-scalar-wrapped` | **`info`** — not a refusal. A scalar contributed to a key under `cascade: append` is taken as a list of one, at the scalar's own span in the layer that supplied it (v1.8) |
| `cascade-strategy-weakened` | A descendant declaring `replace` for a key an ancestor declared `append` — refused because it would discard every ancestor's accumulated contribution (`SPEC.md` §5.2), not because the declaration is malformed on its own |

**A scalar under `append` is a list of one (v1.8).** `append` promises a list, and the commonest
contribution to one is a single item, so `styles: ./report.css` under an accumulating key is taken as
`[./report.css]` — extended onto whatever was inherited, in rank order, never replacing it — and the
author is told with `append-scalar-wrapped`, at their own position. An `info`, so the build continues
and `load()` stays `ok: true`; never silent, so nothing is normalized behind the author's back. The
posture is `precision-narrowed`'s. A mapping has no one-item reading and is still refused. The fold
does not consult the demand — it cannot, being upstream of validation — so a scalar whose type the
item demand refuses is wrapped and then refused **by the demand, at the same span**, with the notice
alongside it. To write a directory-shaped value under an accumulating key, write the list.

A **config** declaring its own `cascade` produces no diagnostic — it is ignored, never honoured, since
policy comes from schemas only (v0.3 FR-015). A schema using `demand` or `delegate` produces nothing
*at this stage* — `merge()` itself still reads neither, exactly as v0.3 built it — but both are read
elsewhere: `demand` by `validate()` (v0.4) and `delegate` by `resolve()` (v0.6, Delegation above).
`seal` and `final` are read as of v0.7, though still not by `merge()`'s fold itself: `seal` is a
`demand` keyword `validate()` checks, and `final` is resolved whole-stack alongside `cascade`. See
v0.7 below.

### `validate(configuration)`

**v0.4, extended in v0.5** with named types (`types:`) and arbitrary-depth `keys`/`items` nesting.
Judges a `MergedConfiguration` — exactly `merge()`'s `ok: true` shape — against every schema
layer's own `demand`, root to leaf (`SPEC.md` §5.4, §7, §10; contracts/validate-api.md,
specs/005-named-types/contracts/). A distinct
pipeline stage, reachable independently of `merge()`, consuming only its output (no separate pedigree
argument — `MergedConfiguration.layers` already carries what this stage needs).

```typescript
import { resolve, merge, validate } from "@egildo/cascata";
import { createNodeHost } from "@egildo/cascata/host/node";

// core.yaml:   `keys: { styles: { demand: { type: url } } }`
// house.yaml:  `$adopts: ./core.yaml` — restates nothing for styles
// config.yaml: `$schema: ./house.yaml` with `styles: "not-a-url"`

const resolved = await resolve("./config.yaml", { host: createNodeHost(), sandboxRoot: process.cwd() });
if (!resolved.ok) throw new Error("resolve failed");
const merged = merge({ graph: resolved.graph, pedigree: resolved.pedigree });
if (!merged.ok) throw new Error("merge failed");

const result = validate(merged.configuration);
if (result.ok) {
  result.certified; // the same MergedConfiguration, now certified
} else {
  result.diagnostics;
  // [{ code: "type-mismatch", pointer: "/styles", pedigreePosition: 0,
  //    demand: { pointer: "/keys/styles/demand/type", span: <core.yaml:1> },
  //    primary: <config.yaml's own span for "not-a-url"> }]
  // — the ROOT is named (pedigreePosition 0), even though house.yaml is
  // the nearer layer and restated nothing: §5.4's whole-chain guarantee.
}
```

- **`ValidateResult`** is `{ ok: true, certified: MergedConfiguration, diagnostics } | { ok: false, diagnostics: Diagnostic[] }`
  — never a certificate beside an error; the `ok` branch's `diagnostics` carries any `info` lints (v0.7 FR-002). `certified` is `configuration` itself, unchanged: `validate()` never mutates the tree
  (FR-034) and performs no I/O or reference resolution (FR-035) — every document it needs is already
  on `configuration.layers`.

**Behavioral contract** (contracts/validate-api.md):

1. Never throws for a bad configuration or schema — every problem is a diagnostic.
2. **Whole-chain, not leaf-only**: every schema layer's own `demand` is checked against the same merged
   tree. Restating an ancestor's demand costs nothing extra (FR-015); a nearer layer's silence never
   excuses an ancestor's demand (FR-016) — this is §5.4's "belt and suspenders".
3. **Collect-all**: every violation this call can determine independently is reported, including
   closed-vocabulary problems found by an independent pass that always runs alongside value-checking
   (mirroring v0.3 FR-028's precedent for `merge()`).
4. Deterministic: same configuration, same diagnostics, same order, every run (FR-018).
5. A schema's own `provide` is checked exactly like a config-written value, at the `provide`'s own
   position (FR-020) — a schema is not exempt from its own rules.
6. `required` is checked against the **post-merge** tree and means present-and-non-null (§5.5); a key
   satisfied by a `provide` produces zero diagnostics of any level — the guaranteed-key pattern is a
   feature, not a tolerated gap.

### `demand` vocabulary (`SPEC.md` §9, contracts/demand-vocabulary.md)

Thirteen closed keywords, all implemented: `type`, `items`, `keys`, `values`, `required`, `min`,
`max`, `minLength`, `maxLength`, `pattern`, `enum`, `accept`, `seal`. `seal` (v0.7) and `values`
(v0.7 part 2) are the two most recent — see v0.7 below for both. `format` is **not** in the list — `SPEC.md` §15
dropped it in favor of `type: url`/`path`, so it is `unknown-demand-keyword` like any other
typo. `type` is SPEC.md §9.1's leaf DSL — unions (`|`), arrays (`T[]`, binding tighter than `|`),
parentheses — resolving against the model's own kinds, `url`/`path`, and any name declared in
a `types:` section reachable from the usage's own layer (below). `glob` is **not** a built-in type
(`SPEC.md` §15, v1): a resource denotes exactly *one* thing, `glob` denotes a *set*, and an
unexpanded glob is a string nothing interprets — `type: glob` is an ordinary `unknown-type-name`,
ready for the expansion/sandbox/determinism story §14's Future list parks it behind. `keys` and
`items` both nest to
**arbitrary depth** (v0.5 FR-023), bounded by the same 64-level hazard class as v0.1's own parse-depth
cap (v0.5 FR-025) — a document deep enough to trip that bound never reaches `validate()` in the first
place, since `resolve()` refuses it first (see `tests/unit/validate-depth-limit.test.ts`'s own header
comment for why this milestone's depth guard is exercised by a hand-built `MergedConfiguration`, not
a file fixture). `seal` is read here as of v0.7 — it is a `demand` keyword now, not a per-key one
— and `final` is read by the fold; see v0.7 below. `delegate` is read by `resolve()`; see Delegation
above.

```typescript
keys:
  homepage:
    demand:
      type: url             # WHATWG URL Standard — new URL(), no scheme restriction
      required: true
  tags:
    demand:
      type: string[]        # a mismatched item is blamed by index, not the whole sequence
      items: { minLength: 1 }
  profile:
    demand:
      keys:                 # nests to whatever depth the data does (v0.5)
        email: { demand: { type: string, minLength: 3 } }
```

### Named types (`SPEC.md` §7, v0.5, contracts/type-resolution.md)

A `types:` section (schema-only — a config's own `types:` is ignored, FR-004) declares reusable
demand bundles, resolved by `type: <name>` exactly like a built-in kind:

```typescript
# root.yaml
types:
  resource:
    demand: { type: string }
    accept: [url, path]        # both singular — multiplicity belongs in `[]`, never the element
keys:
  styles:
    demand: { type: resource[] }

# house.yaml ($adopts root.yaml)
types:
  resource:
    accept: [url]              # a descendant redeclaring an inherited name NARROWS it —
                                # not an error (FR-016a) — governing from here downward.
                                # "URLs only; nothing served off local disk."
keys:
  styles:
    demand: { type: resource[] }   # restated, so the house's narrower resource governs it
```

- **A descendant redeclaring an inherited type name narrows it — this is not a collision**
  (FR-016, FR-016a, `SPEC.md` §7's "Worked narrowing"). An unqualified name resolves to the
  **nearest** declaration at or above the usage's own layer, exactly like ordinary merge precedence —
  never to an error merely because more than one layer declares it. **Resolution is scope-bound, not
  graph-wide** (FR-008): a usage in a layer above the narrowing has no way to see it at all, and an
  ancestor's own usage of a name only a descendant declares is `unknown-type-name` — the identical
  rule v0.3 FR-026 settled for cascade strategies.
- **The surprising half: narrowing a type does not, by itself, tighten an ancestor's usage of it.**
  A house narrowing `resource` governs the house's own usages and everything below (FR-027) — but a
  root-level key demanding `resource[]` keeps resolving the *root's* `resource`, wider alternatives
  and all, unless the house also **restates** that key's own demand. This is the cost of resolving in
  the declaring layer's own scope, and it is deliberate: the same property stops a descendant's
  *widening* from voiding an ancestor's constraint (FR-028) — an ancestor's demand always means what
  the ancestor wrote, regardless of what any descendant later declares under the same name.
- **A collision — two declarations of one name in layers that are *not* ancestor/descendant — remains
  an error** (FR-016b), reserved for a future multi-adoption world. `$adopts` is single-parent and
  chain-only in v1 (§6.1), so every pedigree is one linear chain and every pair of layers is related:
  this collision path is a reserved stub — `collisionDiagnostics` and `qualifierCollisionDiagnostics` keep their
  names, signatures and codes but return no diagnostic, unconditionally — **structurally unreachable at this
  milestone** — documented as such in `src/validate/types.ts` rather than left to look like live
  protection. Redefining a *built-in* name (`string`, `url`, ...) is a separate rule and stays
  reachable: `builtin-type-redeclared` (FR-018), since there is no "narrowing chain" for a name no
  layer itself declares.
- **A qualified name (`<qualifier>/<name>`) still pins a specific document's own declaration**
  (FR-019): `<qualifier>` is the last non-empty `/`-segment of the declaring document's own `$id`.
  Two documents sharing a qualifier *and* the same local name is FR-016a's narrowing chain restated in
  the qualified namespace — nearest-wins, not an error; `type-qualifier-collision` (FR-019a) is
  reserved for unrelated documents the same way FR-016b is, and is equally unreachable in v1.
- **`accept` composes with `demand` by AND** (research.md D3): a value must satisfy the type's own
  `demand` *and* match at least one narrowed alternative. Selecting every declared alternative behaves
  as no selector (FR-015); a *usage's* `accept` naming an alternative the resolved type never declared
  is refused as widening (`type-accept-widened`, FR-013) — usage-level widening is forbidden
  absolutely, the identical posture §5.2 takes for every other row.
- A cycle through `type`/`accept` references is refused as `unresolvable-type-cycle` (FR-009) rather
  than followed.

### v0.4/v0.5 diagnostic codes

Extends v0.1's–v0.3's catalogues above (contracts/diagnostics.md, v0.5's contracts/diagnostics.md).
Two families: vocabulary problems (found reading `demand`/`types:`, before any value is checked) and
violations (found checking the merged tree against a well-formed demand).

| Code | Refuses |
|---|---|
| `unknown-demand-keyword` | A `demand` keyword outside SPEC.md §9's closed list |
| `malformed-demand-value` | A constraint value of the wrong shape (`min: "ten"`, `enum: 3`, `required: "yes"`, `keys`/`items` not a mapping, `accept` not a sequence of strings, or a `pattern` that does not compile as ECMA-262 regex) |
| `malformed-type-expression` | A `type` value that does not parse under §9.1's grammar |
| `unknown-type-name` | A `type` expression naming something outside the built-in set and every name reachable from this layer (globally unknown, *or* declared only by a descendant, *or* collided everywhere — v0.5 FR-008) |
| `depth-limit-exceeded` | `keys`/`items` nesting past the 64-level bound (v0.5 FR-025) — reused from v0.1's identical parse-time hazard |
| `type-mismatch` | A value (or, for `T[]`, one item) whose kind matches no alternative of a `type` demand |
| `range-violated` | A number outside a `min`/`max` bound |
| `length-violated` | A string whose code-point length is outside `minLength`/`maxLength` |
| `pattern-mismatch` | A string not matching a `pattern` demand |
| `enum-violated` | A value not `nodesEqual` to any member of an `enum` demand |
| `required-violated` | A `required` key absent, or present with an explicit `null`, after merge — constructible at any `keys` nesting depth as of v0.5 |
| `unknown-type-entry-keyword` (v0.5) | A `types:` entry keyword other than `demand`/`accept` |
| `type-name-collision` (v0.5) | Two *unrelated* declarations of one unqualified type name (FR-016b) — reserved for multi-adoption; structurally unreachable in v1, since every pedigree is one chain |
| `builtin-type-redeclared` (v0.5) | A `types:` entry naming a built-in kind (FR-018) |
| `type-qualifier-collision` (v0.5) | Two *unrelated* documents whose `$id` shares a last segment (FR-019a) — likewise reserved and unreachable in v1 |
| `unresolvable-type-cycle` (v0.5) | A `type`/`accept` reference cycle among declared types (FR-009) |
| `type-accept-widened` (v0.5) | A usage's `accept` naming an alternative the referenced type never declared (FR-013) |

A demand restated identically by a nearer layer, satisfied, and a key no demand mentions both produce
zero diagnostics — schema silence is permission (FR-021) unless the position declares
`seal: closed` (v0.7), which turns silence into refusal for any key the vocabulary does not name.

## v0.7 — sealing, authority, the host seam, `load()`, and the meta-schema

v0.7 shipped in two parts. Part 1 built sealing/governance and the embedding surface; part 2 is the
meta-schema bootstrap, which exists so that "every vocabulary wart becomes a wart you personally
suffer" (`SPEC.md` §14 item 7).

### `seal`, `final`, `authority:`

`seal: open | closed` is a **`demand` keyword**, not a per-key one (`SPEC.md` §9/§6.3, amended in
v0.7; §15). It constrains a mapping value's *shape* — it composes by intersection
(`open ∩ closed = closed`) and narrows monotonically, which is what every demand does and what no
governance keyword does — so it nests wherever demands nest and works inside a named type. A schema
may also carry a **top-level `seal`**, governing the config's own top level.

`final: true` is per key, and closes the question: no descendant schema layer may declare that key at
all, and a `final` key carrying `provide` is a constant the config cannot set either. `authority:` is
a fourth top-level section holding `demandPinnedAdoption` and `finalAgainstForking`.

The **per-key vocabulary is closed**, exactly like `demand`'s own and a `types:` entry's own: a
top-level `keys.<name>` (or `directives.<name>`, FR-012) takes `demand`, `provide`, `cascade`,
`final`, `delegate` and nothing else; a nested `keys:` child takes `demand`/`delegate` only. A member
outside the applicable set is `unknown-key-vocabulary-keyword` — closed later than the other two
(v0.7 part 2), found by the meta-schema bootstrap holding hand-written code to the same closure §9
already states and Constitution Principle VI already requires.

### The host seam and `load()`

`resolve()` and `load()` **require** a `host` (`Host`: `read`, `canonicalize`, `cacheRead`,
`cacheWrite`). The library performs no I/O of its own (`SPEC.md` §16, Article VI) — enforced
mechanically by `tests/unit/layering.test.ts`, which refuses any `node:fs` import or bare `fetch`
call anywhere under `src/` except the one named exemption, `src/host/node.ts`. The same file's
**realm sweep** (v1.5) refuses any `node:` import at all, and any use of `Buffer`, `process`,
`__dirname` or `require`, under the same exemption: the library must *load* where Node does not,
not merely refrain from reading a disk there.

```typescript
import { load } from "@egildo/cascata";
import { createNodeHost, createNodeTransport } from "@egildo/cascata/host/node";

const result = await load("./site.yaml", {
  sandboxRoot: process.cwd(),
  host: createNodeHost({ cacheDir: ".cascata-cache" }),
  transport: createNodeTransport(),   // omit for a purely local resolution
});
```

**The launching schema (v1.3).** An entry that names no `$schema` can still be governed: pass `schema` and the entry is resolved as if it had written `$schema: <schema>` — relative to the entry's own directory, `~/` expanded, config-authored and so exempt from the sandbox, refused as `document-unreachable` at the entry document when the host cannot supply it. An authored `$schema` always wins and the option is then never read. Without the option a silent entry is a single-document graph with an empty pedigree, as before. `generateTypes()` ignores the field: its entry is a schema, and a schema with no `$adopts` is the root.

```typescript
const result = await load("./index.md.frontmatter.yaml", {
  sandboxRoot: process.cwd(),
  host: myHost,
  schema: "./beltype.yaml",   // consulted only if the entry names no $schema of its own
});
```

**Overrides (v1.6).** The embedder may also name config documents the entry did not write: pass `overrides`, a list of locations, and each is read after the entry's chain — as a config-authored reference from the entry, so relative to its directory, `~/` expanded, a scheme offered to `locate`, sandbox-exempt — and becomes a config layer ranked after the entry, the last highest of all. An override is governed exactly as the entry is: a demand refuses its value at its own line, a `final` holds against it, a key under `append` accumulates it after the entry's items, a granted key delegates from inside it, and `why()` names it. It carries no `$`-key (`override-reserved-key`): the pedigree is the entry's. It is a layer, not a node of the adoption graph, so two overrides with identical bytes are two layers. Built for a command line — `--set title=Draft`, `-c ci.yaml`, each minted into a document behind a location the host answers — where the alternative, merging over the value after `load()` returns, is exactly the merge no demand can see. Absent, nothing changes; `generateTypes()` ignores it.

```typescript
const result = await load("./index.md.frontmatter.yaml", {
  sandboxRoot: process.cwd(),
  host: myHost,
  schema: "./beltype.yaml",
  overrides: ["./ci.yaml", "beltype:cli"],   // read after the chain, ranked after the entry, the last highest of all
});
```

**Path semantics are the host's too (v1.5).** A `Host` may supply `paths` — `dirname`, `isAbsolute`,
`resolve`, the segment `separator`, and the user's `homeDirectory`. `createNodeHost` answers with
`node:path`'s own functions, so a Node embedder (Windows included) behaves exactly as it always has;
a host that supplies none gets POSIX rules and no home directory, which is what a browser realm
should get. This exists because `dirname("C:\a\b")` is a fact about a platform, not arithmetic —
and because importing `node:path` to ask it made the whole library fail to load outside Node. One
consequence worth stating plainly: **an embedder on Windows using a custom host must now answer
`paths`**, or it will be judged by POSIX rules that call `C:\secrets\x.yaml` a relative path.

**Host-resolvable identity (v1.4).** A `Host` may implement one more, optional method — `locate(reference)` — and own a URI scheme of its own. A `$schema`/`$adopts` reference (or a launching schema) whose scheme is not `https:` is offered to it before being refused; the host answers with a **location**, an absolute local path or an `https://` URL, and everything downstream is unchanged: the document is read, parsed, deduplicated, cycle-checked and pin-verified exactly as a path-named one, and a relative `$adopts` written *inside* it resolves against it. A scheme the host does not own — `undefined`, or no `locate` at all — is `unsupported-scheme`, exactly as before.

```typescript
import { createRequire } from "node:module";
import type { Host } from "@egildo/cascata";
import { createNodeHost } from "@egildo/cascata/host/node.js";

const require = createRequire(import.meta.url);
const base = createNodeHost();
const host: Host = {
  ...base,
  async locate(reference) {
    return reference === "beltype:document" ? require.resolve("@my/schemas/document.yaml") : undefined;
  },
};
```

A located reference is **not sandbox-checked**: the host chose the location, and the sandbox confines what a *document's own text* can reach (`SPEC.md` §16, §8.1). The exemption does not travel — what the located document writes for itself is checked as usual. Delegation targets are untouched.

**The sandbox root correction (v1.4).** `sandboxRoot: "/"` now admits every absolute path beneath it. Containment was "equal to the root, or the root plus a separator", which for `/` read `startsWith("//")` and admitted nothing at all; the separator is now appended only where the root does not already end in one. `/sandbox` still does not contain `/sandboxfoo`.

**Sandbox roots (v1.7).** `sandboxRoot` takes a list as well as a location, and a reference is inside the sandbox when it is inside any member — the lawful door for a house schema shared by every project on a machine, which lives outside all of them. The posture is unmoved: granted, never ambient. No root is inferred, none is read from a document, nothing a document says can add one, and an empty list is refused as a missing root always was. Delegation (§8.4) is confined by the same set.

A schema's leading `~/` now **expands**, through `Host.paths`' `homeDirectory`, and is then confined exactly as any other path a schema wrote: admitted only where a granted root contains it, and otherwise refused with a diagnostic naming the real path. §5.3's own worked chain — a project *schema* writing `$adopts: ~/.config/house.yaml` — could not resolve before this. A config-authored `~/` is what it was. A `~/` inside a document read over `https://` is not expanded under either authority: a remote document has no home on the reader's machine, and a home path is never joined into a URL. The one bounded change of behavior: a schema that wrote `~/x` meaning a directory literally named `~` beside itself must now write `./~/x`.

**Absent is not outside (v1.7).** Containment canonicalizes both sides through the host and used to fall back to the *lexical* path for whichever the host could not answer for — a location that does not exist. The root exists, so under a root that is or sits beneath a symbolic link the two sides were compared in different spaces and a merely absent file inside the root was refused as `sandbox-escape`. On macOS that is the ordinary case, not a corner: `/tmp` and `/var` are links. A missing location is now judged through its nearest existing ancestor, with the segments that do not exist appended — none of which can be a link, because none of them exists. An absent file inside the root is `document-unreachable`; an absent file outside it is still `sandbox-escape`.

`load()` composes `resolve()` → `merge()` → `validate()` → `project()`; the staged calls stay public.
Diagnostics carry a **level**: an `error` decides the outcome, an `info` is a lint that teaches and
rides along with a successful result.

### `values` (v0.7 part 2, `SPEC.md` §9 amended)

The construct for a mapping whose keys are the **author's** to choose rather than the schema's to
enumerate — what `items` is to a sequence, `values` is to a mapping.

```yaml
keys:
  environments:
    demand:
      type: mapping
      values:                       # every entry, whatever its key
        type: mapping
        keys:
          url: { demand: { type: url, required: true } }
```

Its value is a **bare demand mapping**, exactly the shape `items` takes — not a key declaration.
Where `keys` names an entry and `values` also covers it, **both** apply: demands compose by
intersection (§5.1) and there is no precedence rule to invent. `values` is orthogonal to `seal`:
`values` says what shape, `seal` says which keys. Against a non-mapping value it is a no-op — the
shape refusal belongs to `type`.

### Guarded recursion (`SPEC.md` §7 amended)

A type reaching itself through at least one of `keys`, `items`, or `values` is **productive** — every
traversal consumes a level of the document — and is accepted. A type reaching itself through type
expressions alone consumes nothing and is still `unresolvable-type-cycle`. A cycle guarded at one
point and unguarded at another is accepted: one structural level anywhere makes the loop productive.

### `directives:` (v0.7 part 2, `SPEC.md` §9 amended)

The third top-level section, whose vocabulary is **closed to the six reserved keys** and whose entries
take the same per-key vocabulary a `keys:` entry takes. Reserved keys are directives rather than data
and never appear in a merged configuration — so a meta-schema constraining them through `keys:` would
be constraining something the pipeline has already, correctly, removed.

```yaml
directives:
  $pin:     { demand: { type: string, pattern: '^sha256:[0-9a-f]{64}$' } }
  $adopts:  { demand: { type: string } }
```

This is what lets a schema *state* two rules `SPEC.md` §6.1 and §9 have asserted since they were
written and that had, until now, no expression outside hand-written code. `directives:` never
promotes a reserved key to data; the fold's stripping rule is unchanged.

### `metaValidate(options)` — self-hosting

```typescript
import { metaValidate } from "@egildo/cascata";
import { createNodeHost, nodeMetaSchemaLocation } from "@egildo/cascata/host/node";

const result = await metaValidate({
  host: createNodeHost(),
  subject: "./my-schema.yaml",
  metaSchema: nodeMetaSchemaLocation(),
});
```

`meta/cascata.meta.yaml` is the meta-schema: the document that describes schema documents, written in
the language it describes, and it **validates against itself**. It is a document, not a constant —
obtained through the `Host` seam like any other, because the one document that could most easily have
been exempted from Article VI is the one that must not be.

Meta-validation is **available, not automatic**: `load()` does not run it. `SPEC.md` §2.6 frames
self-hosting as "publishing a schema = validating it as a config" — a publishing act. v0.7 left
"whether it becomes the default" as a v1.0 question; **v1.0 answers it: it stays opt-in.** Running
it inside `load()` would double the work of every resolution and change the diagnostics of every
schema written in seven milestones, at the exact release that makes changes permanent — and §2.6's
own framing is of a publishing act rather than a resolution step.

Two things it cannot do, both deliberate. §9.1's leaf type-expression grammar is not regular, so
`typeExpr`'s `pattern` is a **superset** governed by one rule: it must accept every string the grammar
accepts. And it checks **one document's shape** — it cannot state that a `provide` satisfies its own
key's demands, nor any row of §5.2's monotonicity table, nor that a type name resolves. Those stay
hand-written checks, so passing the meta-schema is necessary and nowhere near sufficient.

### v0.7 diagnostic codes

Extends every catalogue above, unchanged.

| Code | Raised when |
| --- | --- |
| `seal-violation` | A key the accumulated `keys` vocabulary does not declare, at a position sealed `closed` (§6.3, §9) |
| `final-key-redeclared` | A descendant schema layer declaring anything for a key an ancestor sealed `final` |
| `final-key-set` | A config setting a key that is `final` with `provide` — the pinned constant (§5.5, §6.3) |
| `required-vacuous` | **`info`** — `required` under a `final provide`, which guarantees nothing `final` does not already (§5.5) |
| `delegate-inline-string-loaded` | **`info`** — `delegate: allow` at a key demanding a leaf shape an inline string would have satisfied (§8.1) |
| `unknown-authority-member` | An `authority:` member outside `demandPinnedAdoption`/`finalAgainstForking` |
| `adoption-not-pinned` | An unpinned adoption in a pedigree whose root demanded `demandPinnedAdoption` (§6.3, §11) |
| `unknown-directive-key` | A `directives:` entry naming something outside the six reserved keys (§9, v0.7 part 2) |
| `unknown-key-vocabulary-keyword` | A key declaration carrying a member outside its own closed per-key vocabulary — the full five (`demand`, `provide`, `cascade`, `final`, `delegate`) at a top-level `keys.<name>`/`directives.<name>`, or `demand`/`delegate` only at a nested `keys:` child (§9, v0.7 part 2) |


## v1.0 — the output surface, and the freeze

### `project(configuration)` — the value view (`SPEC.md` Article VII, §17)

Seven milestones produced a positioned, frozen `Node` tree and no way to read it as ordinary data.
`project()` is that gap closed.

```typescript
import { project } from "@egildo/cascata";

const { value, diagnostics } = project<{ readonly server: { readonly host: string } }>(result.configuration);
value.server.host;   // ordinary data
```

- **Mappings become null-prototype objects; sequences become arrays; scalars become their JS
  equivalents.** `Object.create(null)` rather than `{}` because a configuration key is
  author-controlled: on an ordinary object `o["__proto__"] = v` *sets the prototype* and creates no
  own property at all. `constructor`, `toString` and `hasOwnProperty` come free from the same choice.
- **A projection, never a replacement.** The node tree stays on the same result. Spans, provenance
  and pedigree live there and `why()` still answers by RFC 6901 pointer.
- **Deeply immutable**, at every depth, by `Object.freeze`.
- **Total.** It never throws for any legal document, at any depth or width.
- **Pure.** The tree it read is unchanged.

**One named limit.** Keys are *inserted* in `SPEC.md` §4.2's canonical (code point) order, which is
as far as JavaScript goes: ECMA-262's `OrdinaryOwnPropertyKeys` returns every **array-index** key — a
canonical numeric string in `[0, 2^32−2]` — first, in ascending numeric order, ahead of every other
key, which then follow in insertion order. No object can do otherwise. A mapping whose keys are
`10`, `2`, `b`, `a` therefore enumerates `2, 10, a, b`. Asserted in both directions in
`tests/unit/value-view.test.ts`, so the limit is on the record rather than a surprise in a config.

### The numeric rule — the demand decides, not the document

`kind` is lexical (`SPEC.md` §4.2): `30` is an int and `30.0` is a float. A *faithful* projection
would therefore let a config author's punctuation decide whether the consuming application sees a
`bigint` or a `number`, under an unchanged schema — which is this project's thesis inverted. So the
**accumulated** demand decides:

| accumulated demand | value |
| --- | --- |
| `int` | `bigint` — exact at any magnitude |
| `float` | `number` |
| `int \| float` | `number` — the schema declared a float acceptable here |
| no numeric demand | faithful to the lexical kind, and typed `unknown` |

Union within one type expression (alternatives are alternatives); **intersection** across demands
(§5.1), so two layers give one answer and the order they are read in does not change it. A schema
author who needs exactness above 2^53 writes `type: int`, which is one line.

Where an `int | float` projection actually drops a digit, an **`info`** diagnostic
(`precision-narrowed`) names the key and both values, at the offending value's own span. It fires on
actual loss, never on the shape — 2^53, 3·2^52 and 2^60 are all exactly representable and none of
them lints.

**`JSON.stringify` throws on a `bigint`** (`TypeError: Do not know how to serialize a BigInt`). That
is the consumer's problem and is deliberately not hidden: converting would silently reintroduce
exactly the precision loss §4.2 and §6.1 exist to prevent. Two one-line workarounds:

```typescript
JSON.stringify(value, (_key, x) => (typeof x === "bigint" ? x.toString() : x));  // or
// demand `float` in the schema wherever a JSON round trip matters
```

### `load<T>()`

`LoadResult<T = unknown>` carries `value` beside `configuration`. **`T` is the caller's claim and the
library performs no check of it** — validation enforces the schema against the value and cannot
enforce a belief about what the schema says. A `T` that disagrees with its schema is a bug in the
calling code; **v1.1's `generateTypes()` (below) removes the guesswork by deriving `T` from the
schema chain.** `load<T>()` itself is unchanged: a `T` the generator wrote is still, to `load()`, a
claim.

### v1.0 diagnostic codes

Extends every catalogue above, unchanged.

| Code | Raised when |
| --- | --- |
| `malformed-section` | A top-level `types:`/`keys:`/`directives:`/`authority:` in a schema whose value is not a mapping (§9). One rule, four sections — until v1.0 this was silently ignored |
| `precision-narrowed` | **`info`** — an integer projected to `number` under a demand admitting `float`, where the conversion is not exact (§17) |

### One violated demand at one position is one diagnostic

Where `keys` and `values` both cover an entry and both name the **same** recursive type, both apply
(§9) and both descend — so a walk can reach one demand and one value by more than one path. `SPEC.md`
§10 settles what that means for the output: **the diagnostic is reported once.**

The identity is §10's own — the code, the violated demand (its *declaring layer* as well as its RFC
6901 pointer, since §10 defines a demand as both), and the offending value's position. It is applied
**as results accumulate**, not at the end: the arms hand each other whole result lists, so a
collapse that waited for a final pass would arrive after the memory was gone.

The rule is a correction, not a new restriction. Before it, a **296-byte** configuration at depth 24
— legal, and well inside §11's parse-depth cap of 64 — produced 2^24 copies of one violation and
exhausted memory; every copy was identical in every field a consumer can read, so the repetition
communicated nothing. Two genuinely different violations at one position are still two: a different
code, a different demand pointer, or a different declaring layer each keeps them apart, and each has
its own case in `tests/unit/composition-bound.test.ts`.

## v1.1 — the accumulated demand, and the TypeScript type generator

`SPEC.md` **Article VIII (§18)**. Article VII made the consuming application's `T` the caller's
claim; this is the generator that replaces the claim with a derivation — and the thing it derives
from, which turns out to be the more durable of the two.

### `accumulate(layers, options?)` — the artifact

For every position a schema chain can describe, the **intersection of every demand any layer places
there**, each named type resolved in the scope of the layer that used it (§7). Computed from schema
layers alone: no configuration takes part, and positions are *shapes* — `values` and `items` denote
every entry and every element, not the entries and elements of some document.

It is a stage in its own right (Principle IV) and is reachable with no emitter in sight, from
`@egildo/cascata/generate`. A future JSON Schema exporter is a second printer over the same tree, never a
second walk.

A named type is recorded as a **reference**, never unrolled, which is the whole termination
argument: guarded recursion stops because a reference has no body to descend into. The one shape
that still needs a memo is a reference to a declaration *set* — §7's narrowing chain, which is
intersected body with body — and without it the two-layer recursive case does not terminate at all.

### `generate(tree)` — the printer

Takes the tree, returns `{ source, diagnostics }`, performs **no I/O**. The caller writes the text
where it belongs, or does not.

```yaml
$id: site-builder/core
seal: closed
keys:
  name:
    demand: { type: string, required: true }
  port:
    demand: { type: int }
  styles:
    demand: { type: "string[]" }
  features:
    demand:
      type: mapping
      values: { type: bool }
```

```ts generated
// Generated by Cascata — do not edit. Regenerate from the schema chain.

export type core = {
  readonly features?: {
    readonly [key: string]: boolean;
  };
  readonly name: string;
  readonly port?: bigint;
  readonly styles?: readonly string[];
};
```

**That pair is executed.** `tests/unit/doc-examples.test.ts` finds every fenced `yaml` block
immediately followed by a fenced `ts generated` block, runs the generator on the YAML, and fails if
the two disagree — so the example above cannot go stale (`SPEC.md` §15's own lesson about
documentation that has never been run).

Read it row by row: `name` is `required`, so the property is **non-optional**; `port` demands `int`
and not `float`, so it is `bigint` and stays exact above 2^53 (§17); `styles` is `readonly`, as every
emitted array and property is; `features` names no keys, so it is an index signature; and the
schema's own top-level `seal: closed` is why the root carries none.

`min`, `max`, `minLength`, `maxLength`, `pattern` and `accept` change **no type** and are emitted as
JSDoc naming the constraint and its declaring layer. **JSDoc is output, not contract**: its presence
and wording may change without a version bump. The types may not.

### `generateTypes(schemaLocation, options)` — the one call

```typescript
import { generateTypes } from "@egildo/cascata";
import { createNodeHost } from "@egildo/cascata/host/node";

const result = await generateTypes("./schema/project.yaml", { host: createNodeHost(), sandboxRoot: process.cwd() });
if (result.ok) {
  await fs.writeFile("./generated/config.d.ts", result.source);   // the caller writes; the library never does
  result.diagnostics;                                              // info lints, e.g. demand-unsatisfiable
}
```

Resolves `schemaLocation` as the launching point and treats **every document it reaches as a schema
layer** — the entry is the leaf schema, so its chain starts at its own `$adopts`, and its own `keys:`
govern the root. Runs the same closed-vocabulary pass `validate()` runs before any value check, so a
schema the language refuses is never emitted from. Returns
`{ ok: true, source, tree, diagnostics } | { ok: false, diagnostics }` — never both, and never a
throw for a fact about the world (Article VI). `rootName` names the root alias; the default is the
leaf `$id`'s qualifier, else `Configuration`.

`accumulate` and `generate` are exported from the package root **and** from `@egildo/cascata/generate`,
declared like `@egildo/cascata/host/node`.

### Soundness is the conformance rule, and the validator is the oracle

> Every configuration that validation accepts, projected by Article VII, inhabits the type generated
> from its schema chain.

`tests/unit/generate-oracle.test.ts` asserts exactly that, over the whole validate corpus and over
the meta-schema against itself: every accepting case is projected, written as a TypeScript literal,
and typechecked in memory against the emitted type. The oracle therefore needs **no expected
outputs written by hand**; the unit tests that pin single mapping rows (`generate-shapes`, `generate-leaves`,
`generate-types`) do write theirs, and the executed pair above is the documented one.

### Named limits

Three, each of them the host type system's rather than the generator's, and each named rather than
discovered:

- **Closedness is checked by TypeScript at object literals only.** A value carrying extra keys that
  reaches a closed type *through a variable* is accepted structurally. The emitted type is exact; the
  compiler's enforcement is partial.
- **Ranges, lengths and patterns have no type.** The JSDoc above is the whole story.
- **`url` and `path` both emit `string`.** An `accept` selector between them is therefore invisible
  in the type and survives in JSDoc — so a configuration refused for a malformed URL, or for an
  `accept` subset, may still typecheck. The oracle lists every such case by name rather than
  excusing the category.

### v1.1 diagnostic codes

Extends every catalogue above, unchanged.

| Code | Raised when |
| --- | --- |
| `demand-unsatisfiable` | **`info`** — two demands at one position admit no common value (`string` in one layer, `int` in another). The position accumulates to `never` and the lint names both demands. Whole-chain validation already refuses every value there; this is the first time the contradiction is visible with **no document in hand** (§18) |
| `emit-identifier-collision` | Two type names that escape to one TypeScript identifier. The emission is refused whole — "a generator error, not a coin toss" (§18) |

### The emitted mapping is the contract

Every row of the mapping from accumulated demand to TypeScript is part of the contract from this
release; a change to a row is named in `SPEC.md` §15 (until v1.12.1, each row was a compatibility
promise under §15's freeze rule). The rows are listed in
`specs/010-type-generator/contracts/emitted-type.md` §1. JSDoc, as above, is explicitly outside that
promise.

## v1.2 — the JSON adapter

**`SPEC.md` §14 item 11, §12's RFC 8259 row.** A second format adapter, taken ahead of its roadmap
position because a consumer needed it (see `specs/011-json-adapter/plan.md`'s Complexity Tracking).
An addition under the freeze rule: a `.json` location that was unreadable becomes readable, and no
existing document changes meaning.

### Reading a JSON document

Nothing new to call. `load()` and `resolve()` select an adapter by extension, and `.json` now
selects this one. A cascade may mix formats freely — a `.json` document may `$adopts` a `.yaml` one,
a delegated fragment may be in a different format than the document that grafts it — which is what
§3's format-blindness has promised since before there were two formats to be blind about.

**The extension of an `https://` document is the extension of its physical URL's path** (v1.13 FR-021): the URL after
redirects, and its WHATWG `pathname`, not the end of the text. `https://x/a.yaml?v=2` is YAML; `https://x/a?f=b.json` has no
recognised format; `…/schemas/latest` redirecting to `…/v2.yaml` is YAML, and `a.yaml` redirecting to `…/blob/a` is not
readable. Offline it is the final URL the cache recorded (an entry from before v1.13 answers its own URL). A local location is
read whole, as always (a file literally named `c.yaml?x` has no extension). `Content-Type` is not consulted.

```typescript
import { load } from "@egildo/cascata";
import { createNodeHost } from "@egildo/cascata/host/node.js";

const result = await load("./settings.json", { host: createNodeHost(), sandboxRoot: process.cwd() });
```

`parse()` and `parseText()` are **not** affected: both remain hard-wired to YAML. Giving them a
`format` option would be a surface addition with its own `SPEC.md` §15 entry, and nothing has needed
one — the registry is reached through `resolve()`/`load()`, which is where a location exists to
select on.

### The model a JSON document produces

```json
{
  "port": 8080,
  "ratio": 0.5,
  "big": 99999999999999999999999999999999,
  "flags": [true, false],
  "absent": null,
  "nothing": {}
}
```

- `port` is `int 8080n` — a `bigint`. `ratio` is `float 0.5`.
- `big` is an **exact** 32-digit `int`. This is why the adapter is hand-written: `JSON.parse` gives
  a rounded double and no positions, and §4.1 makes an unpositioned node unconstructible.
- `absent` is a *present* key whose value is the null scalar; `nothing` is a present, empty mapping.
  §4.2's three-way null/absent/empty distinction survives intact.
- Entries iterate in canonical (code-point) order — `absent, big, flags, nothing, port, ratio` — not
  in the order they were written, exactly as a YAML mapping does.
- Every node carries a span whose offsets are **bytes**, whose line is 1-based, and whose column
  counts **code points**. The parser scans the byte array directly, so there is no UTF-16 index to
  convert and no offset table to get wrong.

**Numbers take their kind lexically** (§4.2), from RFC 8259 §6's grammar:

| written | kind | value | |
|---|---|---|---|
| `2` | int | `2n` | no fraction, no exponent |
| `2.0` | float | `2` | a fraction makes it a float, whatever its value |
| `1e2` | float | `100` | so does an exponent |
| `-0` | int | `0n` | the same answer the YAML adapter gives `-0` |
| `-0.0` | float | `-0` | |
| `01`, `+1`, `.5`, `1.`, `0x10`, `Infinity`, `NaN` | — | refused | RFC 8259 permits none of them |

The grammar check is the parser's own scan, never `BigInt()` or `Number()`: `BigInt("0007")` is
`7n`, so delegating would silently accept a leading zero the standard forbids.

### What it refuses

| Code | Refuses |
|---|---|
| `malformed-document` | any violation of RFC 8259's grammar, at the offending byte: an unquoted or single-quoted key, a trailing comma, a control character unescaped inside a string, an unknown escape, a number spelling JSON does not have, a document that is empty or contains more than one value |
| `duplicate-key` | the same key twice in one object — RFC 8259 §4 permits it, `SPEC.md` §4.2 refuses it, never last-wins — with the first occurrence attached as a `related` span |
| `invalid-encoding` | bytes that are not well-formed UTF-8, at the offending byte offset; and a `\uXXXX` escape naming an unpaired surrogate, at the escape |
| `depth-limit-exceeded` | nesting past `maxDepth`, at the value that crossed it |
| `size-limit-exceeded` | input larger than `maxBytes`, refused before parsing at all |

**No new diagnostic code.** Every way a JSON document can be wrong is a hazard something already had
a name for, and a sixth code would have said less rather than more
(`specs/011-json-adapter/data-model.md`).

**Four floor rules are unreachable, not merely unused**: JSON's grammar has no non-string key, no
tag, no document separator and no alias, so `non-string-key`, `unsupported-tag`,
`multiple-documents` and `alias-cycle` cannot be produced. The corpus carries the nearest legal
document for each — `{"1": true}`, `"!!binary"`, `"---"`, `"&a"` — so a reader looking for them
finds an answer rather than a silence.

### Named limits

- **An empty file is not a JSON document.** `JSON-text = ws value ws` has no production for no value
  at all, so an empty or whitespace-only `.json` file is `malformed-document`. An empty `.yaml` file
  is still a `null` document, because YAML says it is. The two adapters differ about *their own
  grammars*, which is not what §16's determinism law forbids — that law is about two **hosts**
  disagreeing about one document.
- **A number too large for a double becomes `Infinity`.** RFC 8259 §6 leaves range to the
  implementation, and `1e400` parses as `float Infinity` — the same answer the YAML adapter already
  gives `1e400` and `.inf`. An *integer* of any size stays exact, so this is reachable only by
  writing an exponent.
- **A leading BOM is skipped, and counted**: a single leading `EF BB BF` is no token and no column, but
  it is three stored bytes, so every offset in a document that has one is three more than in the same
  document without (v1.9; before it, the mark contributed zero bytes). Line and column are unchanged.

### `Host` and `HostReadResult` are exported

A **correction**, not an addition (`SPEC.md` §15). Both types have existed since v0.7 and `Host`
already appeared in `LoadOptions`, but neither name was reachable from the package — so a consumer
writing the host Article VI obliges them to write could not name the interface they were
implementing. Measured against the published surface with `deno check`, which said
"declares 'Host' locally, but it is not exported". Nothing about either type changed.

```typescript
import type { Host, HostReadResult } from "@egildo/cascata";

class MyHost implements Host {
  async read(location: string): Promise<HostReadResult> { /* … */ }
  // canonicalize, cacheRead, cacheWrite — and, optionally, locate (v1.4)
}
```

## v1.10 — writing a value back

`SPEC.md` Article IX (§19), an **addition** (§15). Two functions on one document, YAML or JSON: where a value
is, and the edit that changes only it. Neither reads or writes a file; applying an edit is the caller's.

```ts
import { locate, setValue } from "@egildo/cascata";

const options = { format: "yaml", origin }; // as parse(): which document these bytes came from; optional `limits`

locate(bytes, options, "/walls/W2/height");
// { ok: true, start: 47, end: 50, kind: "float" } — stored bytes (§4.2), 0-based, end exclusive

setValue(bytes, options, "/walls/W2/height", 3.4);
// { ok: true, edit: { start: 47, end: 50, bytes: Uint8Array [ ...'3.4' ] }, diagnostics: [] }
// put `edit.bytes` in place of bytes[start, end); every other byte of the file is the caller's to keep
```

- `locate(bytes, options, pointer)` answers `{ ok: true, start, end, kind }` — `kind` is a scalar's model kind
  (`string`, `int`, `float`, `bool`, `null`) or `mapping`/`sequence` — or `{ ok: false, diagnostics }`.
  A document that does not parse gives the parse's own diagnostics. A container and a block scalar are
  located like any value; only `setValue` refuses them.
- `setValue(bytes, options, pointer, value)` answers `{ ok: true, edit: { start, end, bytes }, diagnostics }` (`diagnostics`
  empty except under `sharedEdits: "warn"`, v1.12) or
  `{ ok: false, diagnostics }`. `value` is `string`, `number`, `bigint`, `boolean` or `null`. Neither function
  throws for a document or a value — only for programmer error (no `origin`, a `format` other than
  `"yaml"`/`"json"`, a pointer that is neither empty nor starts with `/`, a value that is not a scalar, and
  since v1.12 a `sharedEdits` that is none of the three), or on an internal inconsistency (an
  `Internal error: …` guard in the YAML writer, unreachable in every probe), which is a bug to report.
- `EditOptions`, `Edit`, `EditValue`, `LocatedKind`, `LocateResult`, `SetValueResult` are exported types.

**The three laws**, each a conformance case, each also checked by round-tripping the edit through `parse`:

1. *Nothing changed, nothing written* — a value equal to the one there gives the bytes already there, in
   whatever spelling they had (`3.20` set to `3.2` writes `3.20`).
2. *What you set is what you read* — the edited document reads back the value set, of the kind below.
3. *Only the value moves* — the edit's range is exactly the value's span (§4.2) — except, since v1.12, an explicit tag on
   the value's line that cannot hold the value set, which the range widens over with its blanks: a quoted scalar's quotes in,
   a trailing comment out. CRLF, a byte-order mark, a lone CR, non-ASCII elsewhere: all outside the range.

**Kind is kept.** A `number` over a `float` is a float (`3` over `3.2` is `3.0`); over an `int`, an int if
`Number.isInteger`, otherwise a float; over anything else — a string, a boolean, null, or nothing, as in a new entry or
inside a written container — a float (since v1.15: `3` is written `3.0`). A `bigint` is an int. Anything else writes its own
kind. A float is
spelled in JavaScript's shortest round-trip form with a point or exponent guaranteed (`3.0`, `1e+21`,
`-0.0`); no precision rule is applied (`0.1 + 0.2` is `0.30000000000000004`). YAML spells `NaN`, `Infinity`
and `-Infinity` `.nan`, `.inf`, `-.inf`; JSON cannot spell them.

**Strings.** YAML: plain only if it reads back as the same string under Cascata's rules *and* YAML 1.1's —
so `yes`, `no`, `on`, `off`, `y`, `n`, `true`, `null`, `~`, numbers (including `0b101`, `1_000`, `1:30`),
dates, `.inf`, anything with `: ` or ` #`, a leading indicator, edge whitespace, a line break, a control
character, and the empty string are quoted. The style of the scalar being replaced is kept where it can hold
the text (a single-quoted scalar doubles an embedded `'`); where it cannot, double quotes with YAML escapes
(`\n`, `\x01`, `\u2028`, `\uFEFF`). In a flow collection a plain string also avoids `,`, `[`, `]`, `{`, `}`.
JSON: RFC 8259 §7, non-ASCII written as itself. A string with an unpaired surrogate has no UTF-8 spelling.

**Every edit is read back** before it is returned. One that does not come back as the value set is refused as
`edit-read-back`, not guessed. (Until v1.12 an explicit `!!str` tag over a number was the example; since
v1.12 a tag that cannot hold the value is dropped instead — see "v1.12" below.)

### v1.10 diagnostic codes

All `level: "error"`, positioned at the span named — except `edit-target-shared` under `sharedEdits: "warn"` (v1.12).

| Code | When | Positioned at |
|---|---|---|
| `edit-target-absent` | no value at the pointer | the nearest existing ancestor |
| `edit-target-shared` | the value is reached through a YAML alias or merge key, **or it, or a container above it, is anchored and an alias points there** — writing it would change every place that shares it. Since v1.12, `level: "error"` only under `sharedEdits: "refuse"` (the default); under `"warn"` the edit is answered with this code at `level: "info"`, at the value, `related` naming each alias (v1.12, above) | the (first) alias |
| `edit-container` | a mapping or a sequence — **from `editTarget` only since v1.15**, which writes containers (see "v1.15" below) | the value |
| `edit-block-scalar` | a block scalar (`\|`, `>`), whose style is not reproduced | the value |
| `edit-bare-key-in-flow` | a key with no value inside a flow collection (`{a}`, `{? a}`; v1.12) | the value |
| `edit-read-back` | an edit that would not read back as the value set (the safety net; no known input reaches it). Since v1.15 also a value past the document's depth or size limits, and a tag on a container that cannot hold the new value | the value |
| `edit-unrepresentable` | JSON asked for `NaN` or an infinity; any format asked for a string with an unpaired surrogate | the value it would have replaced |

Inserting and deleting arrived in v1.15 (below).

## v1.11 — which document an edit belongs in, and writers

`SPEC.md` Article IX (§19), two **additions** (§15): nothing read changes and nothing accepted is refused.

### `editTarget(configuration, pointer)`

```ts
import { editTarget } from "@egildo/cascata";

editTarget(configuration, "/walls/W2/height");
// { ok: true, location: "/project/override.yaml", pointer: "/walls/W2/height", format: "yaml", diagnostics: [] }
editTarget(configuration, "/levels/L1/elevation"); // the key `levels` delegates to levels.yaml
// { ok: true, location: "/project/levels.yaml", pointer: "/L1/elevation", format: "yaml", diagnostics: [] }
editTarget(configuration, "/styles/3"); // the fourth item of a list under `cascade: append`
// { ok: true, location: "/project/override.yaml", pointer: "/styles/0", format: "yaml", diagnostics: [] }
```

Takes a merged configuration (`merge()`, or `load()`'s `.configuration`) and an RFC 6901 pointer into it; answers
the document that holds the winning value — a config layer, an override, or a fragment a config delegated to —
the pointer *inside that document*, and its format (`"yaml"` or `"json"`, by extension). `location` is the
document's `origin.id`; for a delegated fragment, whose id is `<location> #graft=N`, it is the fragment's own
location. It reads no file: hand `location`'s bytes and `pointer` to a writer. It throws only for a pointer that
is neither empty nor starts with `/` (and, since v1.12, a `sharedEdits` that is none of the three).

An item of a list under `cascade: append` has its own document and its own index in it, whatever its place in the
merged list. A pointer to the whole list is a container.

### Graph identity (v1.13, `SPEC.md` Article VI)

A document has two paths, and identity is the physical one. The **logical** path is the route taken: for a file, the
lexical resolution of what was written from the referring document's logical path (no link followed, no case folded);
for a URL, the text normalized by the WHATWG URL Standard (lowercase scheme and host, default port dropped). The
**physical** path is where it really is: for a file, the host's `canonicalize` answer (for a path that does not exist,
the answer for its nearest existing ancestor with the rest appended, the sandbox's own rule); for a URL, the URL
after redirects. They travel as `DocumentIdentity.physical` (always present) and `Origin.physical` (present only when it
differs, on every span of the document and on a delegated fragment's origin); `origin.id`, `origin.label` and every
message stay logical, and the library's own messages append the physical path in parentheses where it differs.

"Is this the same document?" is answered physically: cycles in the adoption graph and in delegation, deduplication,
and `editTarget`'s count of the places that read one file. A relative reference starts where its medium's own
convention says: from the logical path in a file (as the shell's `cd` resolves `..`), from the physical URL in a remote
document (as a browser resolves against a response's URL). Where the other rule would have named a different document,
`link-changes-reference` (`info`, never a refusal) is reported at the reference, naming both documents and the
referring document's two paths. `resource()` follows the same rule and, behind a link or redirect, carries the other
answer as `otherLocation` (a query holds no host and raises no diagnostic): `location` follows the medium's own convention (a file from its logical path, a remote document from its physical URL) and `otherLocation` is what the other rule gives. `editTarget`'s `ok` result carries
`physicalLocation` when it differs from `location`; a writer handed either path writes the same file.

### v1.13 diagnostic codes

| Code | Level | Means |
|---|---|---|
| `link-changes-reference` | `info` | A relative reference in a document behind a link (or a redirect) names a different document by the other rule; the one the medium's convention names was loaded. Positioned at the reference |

### v1.11 diagnostic codes

All `level: "error"` — except `edit-target-shared` under `sharedEdits: "warn"` (v1.12).

| Code | When | Positioned at |
|---|---|---|
| `edit-target-absent` | no value at the pointer in the merged configuration | the nearest existing ancestor |
| `edit-container` | the value is a mapping or a sequence (a container, merged or not) | the value |
| `edit-target-shared` | the value's document holds more than one node at its position — an anchor and its aliases, or a merge key's copies — or (v1.12) the document is read at more than one place (delegated to twice, or both a layer and a fragment); writing it would change every place that shares it (under the default `"refuse"` the writer refuses the same alias copies). `related` names each other place: another copy, or another graft's delegating value. Under `sharedEdits: "warn"` (v1.12) the target is answered and this code comes with it at `level: "info"`; under `"allow"` nothing is said | the value |
| `edit-target-inherited` | the winning value was supplied by a schema's `provide`; the message names the schema's location and says the edit would change a default every document under it shares | the provided value, in the schema document |
| `edit-target-remote` | the winning value's document was read over `https://` | the value, in that document |

The first two are v1.10's codes. A schema's value read over `https://` is `edit-target-inherited` (the schema is the
more useful name). Whether an edit to an inherited value should change the default or add an override nearer the
user is the view-update question, which Article IX leaves open.

### Writers: `@egildo/cascata/writers`

```ts
import { yamlWriter, jsonWriter } from "@egildo/cascata/writers";

const writer = yamlWriter();
writer.claims("/project/Walls.YML");                     // true — .yaml and .yml, any case; jsonWriter(): .json
writer.locate(bytes, "/walls/W2/height");                // { ok: true, start: 47, end: 50 }
writer.write(bytes, "/walls/W2/height", 3.4);            // { ok: true, edit: { start: 47, end: 50, bytes }, diagnostics: [] }
writer.write(bytes, "/walls/W9/height", 1);              // { ok: false, reason: "No value at …" }
```

`{ claims(location), locate(bytes, path), write(bytes, path, value) }` (and, since v1.15, `open(bytes)`) — the shape a source-graph library's editing
stage expects, met by shape (nothing here names or imports that library). They are `locate` and `setValue` with
a synthetic origin and add no behaviour: `path` is an RFC 6901 pointer, `value` is `string | number | bigint |
boolean | null`, the bytes are the document as stored, and a refusal's `reason` is the first diagnostic's message.
Only programmer error throws, as with the verbs. Types: `Writer`, `WriterLocateResult`, `WriterWriteResult`.

## v1.12 — shared edits

`SPEC.md` Article IX (§19), an **addition** (§15). The default refuses what v1.11 refused and, new in v1.12, a value whose
file is read at more than one place, which v1.11's `editTarget` answered.

A value is **shared** when one write to its bytes changes more than one place: it is reached through a YAML
alias or merge key, it (or a container above it) is anchored and aliased, or — new in v1.12 — its document is
delegated to at more than one place, so one edit to the file changes every graft of it. Whether a shared value
is written is the embedder's policy, `sharedEdits`, passed where its writers and edit targets are made (there is
no global):

```ts
import { editTarget, setValue, type SharedEdits } from "@egildo/cascata";
import { yamlWriter, jsonWriter } from "@egildo/cascata/writers";

setValue(bytes, { format: "yaml", origin, sharedEdits: "warn" }, "/W1", 3.4);
// { ok: true, edit: { start: 9, end: 12, bytes }, diagnostics: [ { level: "info", code: "edit-target-shared", … } ] }
editTarget(configuration, "/levels/L1/elevation", { sharedEdits: "allow" });
// { ok: true, location: "/project/levels.yaml", pointer: "/L1/elevation", format: "yaml", diagnostics: [] }
const writers = [yamlWriter({ sharedEdits: "warn" }), jsonWriter({ sharedEdits: "warn" })]; // JSON shares nothing; it accepts the option
```

| `sharedEdits` | A shared value |
|---|---|
| `"refuse"` (default) | refused, `edit-target-shared`, `level: "error"` — v1.11's behaviour, plus a file read at more than one place (v1.12) |
| `"warn"` | answered, with one `edit-target-shared` at `level: "info"`: primary at the value, `related` naming every other place the write changes (each alias that holds it; for `editTarget`, each other copy and the delegating value of each other graft) |
| `"allow"` | answered, and nothing said |

Entry points: `EditOptions.sharedEdits` for `setValue` and `locate` (since v1.12.1 `locate` follows it: under `"warn"`
and `"allow"` it answers the bytes `setValue` writes, and says nothing; until then it answered as under `"refuse"`); the third argument of `editTarget(configuration, pointer, { sharedEdits })`; `yamlWriter({ sharedEdits })`
and `jsonWriter({ sharedEdits })`. Every `ok` result of `setValue`, `editTarget` and a writer's `write` now carries
`diagnostics`, empty except under `"warn"`. Under `"warn"` and `"allow"` the edit lands on the bytes that hold the
value — for an alias or merge-key copy, the anchor's — and the read-back checks the value at the pointer and at every
copy. A policy other than the three is programmer error and throws. Types: `SharedEdits`, `EditTargetOptions`,
`WriterOptions` (from `@egildo/cascata/writers`).

Nothing else moves to the policy: inherited, remote, absent values, containers and block scalars are refused as
before.

**Three corrections at the edges** (v1.12, §15):

- An empty document — nothing, or only comments and blank lines — is a null located **after its prefix
  byte-order marks**: a document of one mark (`EF BB BF`) locates `3..3`, as does a mark followed by `# c`; with
  no mark, `0..0` as before. `setValue` on `""` writes the value there, with no space after the mark and a space
  before a comment.
- A key written with no value at all — `? a`, or `{a}` in a flow mapping — reads as `a: null`, the null spanning
  zero width at the end of the key (it was dropped; §4.2 keeps null, an absent key and an empty value apart).
  `setValue("/a", 1)` on `? a\n` writes `\n: 1` at `3..3`, giving `? a\n: 1\n`; nested, the new line carries the
  `?`'s indentation. In a flow collection it is refused, `edit-bare-key-in-flow`.
- A tagged scalar keeps its tag where the tag holds the kind written (`!!int` an integer, `!!float` a decimal,
  `!!str` a string, `!!bool`, `!!null`; the `!<tag:yaml.org,2002:…>` form likewise) and loses it where it cannot:
  `a: !!int 1` set to `"x"` is the edit `3..10` → `x`, so `a: x`, never `!!int x`. An anchor written after the tag
  is carried into the edit. Since v1.12.1 the tag is found from the parser's own tokens wherever it is written — on an earlier line (`a: !!int` / `  1` set to `"x"` gives `a:` / `  x`, the blank before the tag going with it when a line break follows), with a comment between, or under a `%TAG` handle — and everything between it and the value is carried again.

**Two corrections of cost** (v1.12, §15): a node's column is two lookups in a table built with the byte table,
so one long line reads in time linear in its length; and the pointers of a tree are indexed once, on first use,
so `why()` and `editTarget()` on every value of a configuration are linear in it.

## v1.14 — `glob`

`glob` returns as a built-in type (v1 dropped it; `SPEC.md` §15, "`glob` returns", answers by name what that entry asked for:
expansion semantics, a sandbox story, a determinism story). It is a **pattern**, singular — multiplicity stays in the
brackets, `glob[]` — and it refines `string` beside `url` and `path`, so `string ∩ glob` is `glob` and a house layer may
narrow a type that accepts `path | glob` to `glob`. `resource` is unchanged and does not admit it.

### The grammar

A strict subset of the Language Server Protocol's `GlobPattern`. A pattern is segments separated by `/`:

| Syntax | Means |
|---|---|
| `*` | any run of characters (possibly none) except `/` |
| `?` | exactly one code point except `/` |
| `**` | **only as a whole segment**: zero or more whole segments |
| anything else | itself, by code point |

Refused, each at its offset (in code points, from 0) and naming the character or rule: the empty pattern; `**` that is not a
whole segment (`a**`, `**b`, `***`); `[`, `]`, `{`, `}` and `\`; a `!` as the first character; an empty segment (`a//b`) and a
trailing `/`; and a `..` segment after the first segment that contains a wildcard (`*/../x`). A leading `/` (an absolute
pattern) and leading `..` segments are allowed, as they are in a `path`. Because everything LSP gives another meaning is
refused today, growing toward the full set later only turns a refusal into an acceptance. Validation is one pass over the
code points and never backtracks (`checkGlobPattern(pattern, counter?)` in `src/validate/glob.ts` counts its steps for the
witness).

A value outside the grammar fails the type like any mismatch — `type-mismatch`, at the value, with a message that names it:

```
expected glob, got the pattern "[ab].md", which is not a glob: '[' is not part of the glob grammar (character classes are refused, …) at offset 0 — constraint from …
```

**Checking confines nothing**: no sandbox check, no host call, no existence check. A pattern that points anywhere
(`../../*.md`, `/etc/*.conf`) loads, as a `path` does — a `path` is data about a file, a `glob` is data about a set of files
(§8.1's razor). Confinement belongs to expansion. The value view carries the pattern string as written; the type generator
emits `string` for `glob` and `readonly string[]` for `glob[]`.

### `globBase(configuration, pointer)`

A query beside `resource()`: no diagnostic, no host, nothing read.

```ts
type GlobBase =
  | { kind: "glob"; pattern: string; literalPrefix: string; directory: string; otherDirectory?: string; span: SourceSpan }
  | { kind: "not-a-glob" }        // not a string, or a string outside the grammar
  | { kind: "unknown-pointer" };
```

`literalPrefix` is the segments before the first one containing a wildcard (all but the last when there is none), as
written (`"content"`, `"../shared"`, `"/abs"`, `""`). `directory` is where the pattern is anchored: the **declaring
document's** directory joined with the prefix, by `resource()`'s rule (a file's logical directory, a remote document's
physical URL, ending in `/`); `otherDirectory` is the other rule's answer, present only when it differs.

### `Host.list` and the memory host

```ts
interface Host {
  list?(location: string): Promise<
    | { ok: true; entries: { name: string; kind: "file" | "directory" | "other" }[] }
    | { ok: false; reason: string }
  >;
}
```

Optional, and **supply, never a verdict**: the host lists a directory and says what each entry is **after following a
symbolic link** (a link whose target is missing, and a loop of links, is `other`). Whether an entry is inside the sandbox is
the library's question, judged through `canonicalize` as every read is. The order of the entries means nothing. A host
without `list` is the library exactly as before. `createNodeHost()` implements it with `readdir` (file types) and `stat` for a
link, in `src/host/node.ts` only; no other module under `src/` may call `readdir` or `opendir`.

`@egildo/cascata/host/memory` ships `createMemoryHost({ files, links? })` — `read`, `canonicalize` (following `links`, a map
from a location to its target, a file or a directory, in the path or at its end), POSIX `paths`, `list`, and **no cache**
(nothing is kept). A directory exists when something is in it; there are no empty ones. It imports nothing platform-specific.

### `expand(configuration, options)`

A stage of its own, after `load()`/`validate()`; **`load()` never calls it**, and a configuration with `glob` values loads and
validates with a host that has no `list`. It is the second stage that asks the host (after resolution).

```ts
import { expand } from "@egildo/cascata";

const loaded = await load(entry, { host, sandboxRoot });
if (loaded.ok) {
  const { expansions, diagnostics } = await expand(loaded.configuration, { host, sandboxRoot, limits: { maxSteps: 500_000 } });
  for (const e of expansions) {
    if (e.ok) console.log(e.pointer, e.matches.map((m) => m.location)); // e.matches[i].physical when a link lies between
  }
}
```

`options.host` is required. `options.sandboxRoot` is optional (a location or a list, as `resolve()` takes them): `resolve()` records
the roots it was given (`ResolveResult.sandboxRoots`, absolute, in order), `merge()` carries them onto
`MergedConfiguration.sandboxRoots`, and they are the default; an explicit `sandboxRoot` replaces them for that call. A
configuration that records none (a hand-built `merge()` input) and no option is a programmer error. The result lists, in the merged
tree's order, **every string value at a position whose accumulated demand (Article VIII) admits `glob`** — alone, in a list, in
a union (`path | glob`) or through a named type — as `{ ok: true, pointer, pattern, span, matches }` or `{ ok: false, …,
diagnostics }`; `diagnostics` flattens the refusals. A value outside the grammar is not a pattern and is left alone. Other
values are untouched. It throws only for programmer error (no host, no sandbox root), never for a document or the world.

**The walk.** From `globBase().directory`, segment by segment. **A literal segment is a path** (the prefix, a literal after a
wildcard, the last segment of a wildcard-free value alike): the host is asked for its location (`canonicalize`) and, for a last
literal, what its stored parent says it is, as opening the file would ask. So `café.md` written composed finds a file a disk
that folds Unicode normalization stores decomposed, named as written with the stored name as `physical`. **A wildcard segment
is matching:** `*` and `?` compare listed names exactly, by code point as `list` returns them (no case folding, no
normalization; `?` is one code point, two UTF-16 units above the BMP); `**` descends through every directory, zero or more
levels. Only files are returned; a pattern with no wildcard names one file and matches it if it is there. `*`, `?` and `**`
never match a name whose first character is `.` and `**` never enters such a directory; a literal `.` does (`.github/*.yml`).
**A directory that is not there matches nothing** (a prefix, or a literal after a wildcard): that branch is empty and a value
whose every branch is missing has an empty list; `directory-unlistable` is for a directory that exists and that the host
refuses. A file where a directory was wanted matches nothing.

**Confinement.** Checking a pattern confines nothing; expanding it confines everything it reads. Each directory is judged by
its physical path (the host's `canonicalize`) against the sandbox **before** it is listed, and each returned file likewise. A
literal prefix that climbs out, or a link that leads out, refuses that value with `sandbox-escape`, naming the logical path
with the physical one beside it; other values still expand. A directory is entered once per physical path and pattern
position, which ends a link cycle, and put to the host once per `expand()` call.

**The limit counts work** (`limits.maxSteps`, default 100,000, per value): each (directory, pattern position) the walk
enters counts one, each entry it examines there one more, and each kind lookup one. A pattern of sixty `**` over 5,461
directories lists each directory once and is still sixty times the tree; counting the work refuses it at the default. Raise the
limit in `options.limits` for a tree and a pattern that are really that large.

**Determinism.** Each match is `{ location, physical?, span }`: `location` the route the walk took, `physical` the host's
answer where it differs, `span` the pattern's own (so the layer and line that selected it). Two routes to one physical file are one
match, named by the smaller logical path; the list is sorted by code point (not UTF-16), so the same files give the same list
whatever order the host lists them in. An empty match is an empty list, never a diagnostic.

### v1.14 diagnostic codes

All `level: "error"`, positioned at the value, from `expand()` only.

| Code | Means |
|---|---|
| `host-cannot-list` | the host has no `list` |
| `directory-unlistable` | the host answered `ok: false` for a directory that exists and that the walk needed (its reason is in the message). A directory that is not there is not this: it matches nothing |
| `glob-in-remote-document` | the declaring document was read over `https://`: HTTP has no directory listing, so a remote pattern is never expanded |
| `glob-limit-exceeded` | the walk did more work than `limits.maxSteps` allows (default 100,000; per value): directories entered at each pattern position, plus entries examined there |

A pattern that leads outside the sandbox is the existing `sandbox-escape`. A grammar mismatch is the existing `type-mismatch`.

## v1.15 — the opened document: parse once, then set, add and remove

`SPEC.md` Article IX (§19). `openDocument` parses a document once; the document then answers `locate`, `setValue`, `add`
and `remove` as often as asked, **each against the bytes as opened**. Its edits are independent: the caller applies several
together only where they do not overlap (the Language Server Protocol's rule for a batch of text edits), and to build on an
edit applies it and opens the result. The one-shot `locate` and `setValue` are open-then-ask and answer as they always did.

```ts
import { openDocument } from "@egildo/cascata";

const opened = openDocument(bytes, { format: "yaml", origin, sharedEdits: "refuse" }); // copies the bytes
if (!opened.ok) throw new Error(opened.diagnostics[0]?.message);
const doc = opened.document;

doc.locate("/walls/W2/height");                                   // costs no parse after the opening
doc.setValue("/walls/W2", new Map([["height", 3.4], ["thickness", 0.2]])); // a container, as a Map
doc.add("/walls/W3", new Map([["height", 3.2]]));                 // creates; refuses a key that exists
doc.add("/tags/-", "new");                                        // `-` appends to a sequence, an index inserts before
doc.remove("/walls/W1");                                          // with the comments attached to it
// each answers { ok: true, edit: { start, end, bytes }, diagnostics } or { ok: false, diagnostics }
```

- **Counted, not timed.** Opening parses once; `locate` parses nothing more; `setValue`, `add` and `remove` each parse once
  more, to read their edit back, and only when they answer an edit to check. The one-shot verbs cost what they cost.
- **Values.** `EditData` is a scalar, a sequence of `EditData`, or a `Map` of string keys to `EditData` (a plain object
  reorders array-index keys and swallows `__proto__`). A plain object, a `Map` with a non-string key, a cycle, a sparse
  array or anything else throws, naming what it found and where. Depth and size are the document's `limits`: a value past them
  is refused as `edit-read-back`. A `number` is written as a decimal (`3.0`) and a `bigint` as an integer, as the value view
  hands them out, so pass `3n` for an integer.
- **Style is copied from the nearest sibling, then from the document**: block or flow, indentation, the blanks after `:` and
  `,`, a sequence's dash (`key:\n- a` or `key:\n  - a`); the document's first indentation increase is its step, else two
  spaces; the line ending is the file's. JSON: one line or one member per line, spaces or tabs. Strings and keys follow the
  spelling rule above (a key `"1"` or `"yes"` is quoted; a multi-line string is double-quoted, never a block scalar). Nothing
  writes an anchor, a tag or an alias.
- **`add`.** A mapping entry goes after the last entry's line and same-line comment, before comments or blank lines that
  follow; a sequence item goes before the item at the pointer's index (and before the comments directly above it), `-`
  appends. An empty `{}` or `[]` whose own entry is block-style is rewritten block-style when it gains its first entry.
  Appends to one non-empty container, applied together in the order given, read back as all of them added. An add into an
  *empty* container rewrites the brackets, so two of them overlap: reopen between them.
- **`remove`.** The entry's whole lines, its same-line comment and the comment lines directly above it with no blank line
  between. A flow entry or JSON member takes exactly one comma. A container that empties keeps its kind (`walls: {}`; a root
  becomes `{}` or `[]`, the comments before it kept). Removing every entry of a mapping one edit at a time and applying the
  edits together leaves `walls:` with nothing under it, which reads as null: each edit alone is right, and a batch read-back is
  parked.
- **One policy for all three verbs.** `sharedEdits` decides whether an entry is added to or removed from a container an alias
  shares; a mapping that merges (`<<: *base`) the one edited gains or loses the key too. Two merge-key cases are refused
  whatever it says.

| Code (new in v1.15) | When | Positioned at |
|---|---|---|
| `edit-parent-scalar` | `add` into something that is not a mapping or a sequence | the scalar |
| `edit-target-exists` | `add` of a key the mapping has, one a merge key supplies included (RFC 6902 would replace; Cascata does not); also `add` at the empty pointer | the existing key |
| `edit-remove-document` | `remove` of the empty pointer | the root |
| `edit-reveals-merged` | `remove` of a key that overrides one a merge key supplies; `related` is the merged value | the key |

`setValue` on a container no longer gives `edit-container` (that code is `editTarget`'s alone: which document a container
belongs in is the view-update question, still open). Writers gain `open(bytes)`, answering a document with `locate`, `write`,
`add` and `remove`. Exports: `openDocument`, `OpenedDocument`, `OpenResult`, `EditData`.

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

Each case names its own `format`, and since v1.2 there are two: `yaml` and `json`. The `json-*`
directories hold the RFC 8259 family, and the coverage test carries a second table for them — the
two adapters do not refuse the same things, so folding them into one table would have hidden four
rules JSON's grammar cannot even express.

`resolve()`'s own conformance corpus lives alongside it: `tests/corpus/resolve-cases/` holds one JSON
descriptor per case (fixture documents under `tests/corpus/cases/`, expected outcome as a `Graph`/
`Pedigree`/diagnostics shape — `contracts/resolve-api.md`), covering every local `$schema`/`$adopts`
chain scenario. Remote scenarios (fetching, pinning, caching, redirects) are hermetic `.test.ts` files
under `tests/unit/` instead, driven directly against `resolve()` with an explicit recorded `Transport`
(contracts/recorded-responses.md) — the JSON format has no field for one.

## Dependency policy

`yaml` (eemeli's) is the only runtime dependency. `picomatch` arrived in v0.4 to implement the `glob`
built-in type and left again in v0.5 when `glob` itself was dropped (`SPEC.md` §15). `glob` returned in
v1.14 with a hand-written grammar and matcher (a strict subset of the LSP `GlobPattern`, `*`, `**` and `?` only), so
`picomatch` did not come back. The project constitution
(`.specify/memory/constitution.md`)'s dependency policy is a *ceiling* ("limited to..."), so it still
names `picomatch` on its allow-list and needs no amendment for using fewer than it allows — see
`CLAUDE.md`'s non-negotiables, corrected for the same reason a second time. Everything else is a dev
dependency.
