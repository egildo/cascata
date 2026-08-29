# Cascata

A format-blind, positioned information model with a YAML adapter — v0.1 of the Cascata configuration
cascade (see `SPEC.md` for the full product vision; this package is the first milestone of its §14
roadmap).

This milestone turns YAML text into a tree of mappings, sequences, and scalars in which **every node
reports exactly where it came from**, or — when the document leans on constructs outside the
portability floor (§4.2) — into a complete, position-ordered list of diagnostics. No resolution,
merging, or constraint checking yet: that arrives in v0.2 through v0.4 per `SPEC.md` §14.

Full detail lives in `specs/001-information-model-yaml-adapter/` — `spec.md`, `plan.md`,
`data-model.md`, and `contracts/`. This file is the shorter, code-facing version of the same surface.

## Install

```bash
pnpm install
```

## Public surface

Everything below is exported from the package root. There is no compatibility promise before v1.0
(contracts/parse-api.md).

### `parse(text, options)`

```typescript
import { parse, createOrigin } from "cascata";

const origin = createOrigin("config.yaml", "config.yaml"); // id, then a human-readable label
const result = parse("a: 1\nb: 2\n", { origin });

if (result.ok) {
  result.tree; // a frozen Node
} else {
  result.diagnostics; // a non-empty, position-ordered Diagnostic[]
}
```

- **`text: string`** — the document. Already-decoded text, not raw bytes; see "Known limitation"
  below.
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
| `invalid-encoding` | An unpaired UTF-16 surrogate. See "Known limitation" below |
| `depth-limit-exceeded` | Nesting past `maxDepth`, at the node where the limit was crossed |
| `size-limit-exceeded` | Input larger than `maxBytes`, refused before parsing (zero-width at offset 0) |
| `alias-cycle` | An alias referring to content that encloses itself, at the closing alias |
| `malformed-document` | Input the underlying reader cannot parse at all, or an otherwise-uncategorized reader error |

**Known limitation** (`spec.md` FR-016): `parse()` receives already-decoded text, which cannot itself
*be* invalid UTF-8 — decoding already happened before Cascata saw it. `invalid-encoding` catches the
one reachable failure at this layer (an unpaired surrogate); byte sequences that were genuinely invalid
UTF-8 will already have become replacement characters by the time `parse()` runs, and are accepted as
ordinary text. Enforcing the byte-level UTF-8 mandate requires an entry point that reads bytes, which
arrives with the v0.2 resolver.

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

## Dependency policy

`yaml` (eemeli's) is the sole runtime dependency, per the project constitution
(`.specify/memory/constitution.md`). Everything else is a dev dependency.
