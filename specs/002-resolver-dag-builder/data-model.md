# Data Model: Resolver & DAG Builder

**Date**: 2026-08-30 | **Plan**: [plan.md](./plan.md) | **Implements**: `SPEC.md` §3, §6.1, §11

New entities for v0.2. v0.1's `Node`, `SourceSpan`, `Origin`, and `Diagnostic` are unchanged and
still format-blind; these sit above them.

## Reference

One document's pointer at another. The unit of everything in this milestone.

| Field | Meaning |
|---|---|
| `text` | What was written — a relative path or an absolute URL |
| `span` | Where it was written, in the document that wrote it |
| `kind` | `schema` (a config naming its governing schema) or `adopts` (a schema naming its parent) |
| `authority` | `config-authored` or `schema-authored` |
| `pin` | The stated content hash, if any |

**Invariants**: a `Reference` is unconstructible without a span, exactly as a `Node` is (Principle
III). `authority` is not cosmetic — it decides sandbox treatment (D6), and it is derived from *which
document* carries the reference, never from the reference's own text, so a schema cannot claim
config authority.

## Document Identity

What makes two fetches the same document.

| Field | Meaning |
|---|---|
| `location` | The absolute resolved location — a real path, or a normalized URL |
| `hash` | SHA-256 over the exact bytes (§6.1, amended) |

Two documents are the same when their **hashes** match, regardless of location. Deduplication before
fetching uses `location` alone, because `hash` does not exist yet (D5).

**Not a canonical form.** The hash covers bytes as received. A reformatted document is a different
identity — see research D1 for why a canonical form was withdrawn.

## Resolved Document

| Field | Meaning |
|---|---|
| `identity` | Location and hash |
| `bytes` | Exactly what was read or fetched |
| `via` | The `Reference` that brought it in — absent only for the entry document |
| `verified` | Whether a pin was present and matched |

`via` is what makes FR-024 possible: a failure inside a fetched document is attributable to the
reference that fetched it, and so to something the author wrote. `verified` is what FR-026 reports,
so an unpinned link is visible rather than silent (§11).

## Graph

Resolved documents and the reference edges between them.

**Invariants**: acyclic — a cycle is a refusal, never a state the graph can hold. Each identity
appears exactly once. Every edge carries the `Reference` that formed it, so the graph is traversable
back to source positions rather than being a bare adjacency structure.

Cycle detection operates on `location` during resolution, because it must fire before bytes exist
(D5).

## Pedigree

The ordered chain of schema identities, root to leaf (§6.1).

**Invariants**: a chain, never a tree — `$adopts` takes exactly one parent in v1 (FR-005), so
branching is a refusal rather than a shape to handle. Order is root-first, which is the order
provisions will fold in when the merge engine arrives in v0.3.

Each entry reports its identity, the reference that brought it in with its position, and whether it
was hash-verified. That last field is §11's auditability requirement, and it is why the pedigree is
the natural home for it: the question "what am I trusting unverified?" is a question about the
chain, not about any one document.

## Cache Entry

| Field | Meaning |
|---|---|
| `identity` | What was fetched |
| `bytes` | The stored body |
| `freshness` | The subset of RFC 9111 metadata D3 names — lifetime, `ETag`, `Last-Modified` |

Stored under content address. A previously fetched chain resolves with no network (FR-016); a stale
entry with no network available is still usable, since a hash-addressed body cannot silently drift.

## Relationships

```
Reference ──resolves to──> Document Identity ──addresses──> Resolved Document
    │                                                            │
    │                                                     Cache Entry (remote only)
    └──carries──> span ──> the document that wrote it

Graph = { Resolved Document } + { Reference edges }, acyclic
Pedigree = the schema-kind path through the Graph, root to leaf
```

## State transitions

```
entry document + sandbox root
   │
   ├── no $schema ──────────────────────> Graph of one, empty Pedigree   (legal)
   │
   └── reference ──> resolve location ──┬─> refused: scheme, sandbox, cycle, chain limit
                                        │
                                        └─> read or fetch ──┬─> refused: unreachable,
                                                            │   pin mismatch, size, timeout
                                                            └─> parse ──> recurse
```

Terminal states are a graph or a non-empty diagnostic list, never both — the same rule v0.1 set for
a single document (research D5 there), applied to a set of them.
