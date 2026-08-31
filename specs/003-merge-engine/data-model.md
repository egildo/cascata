# Data Model: Merge Engine & Provenance

**Date**: 2026-08-31 | **Plan**: [plan.md](./plan.md) | **Implements**: `SPEC.md` §5.1, §5.3, §10

New entities for v0.3. v0.1's `Node`, `SourceSpan`, `Origin` and v0.2's `Reference`,
`DocumentIdentity`, `Graph`, `Pedigree` are unchanged — deliberately, since widening `Node` to carry
history would change every one of the 300 tests asserting against it.

## Layer

One document participating in the fold, with its place in precedence order.

| Field | Meaning |
|---|---|
| `identity` | Which document — v0.2's `DocumentIdentity` |
| `role` | `schema` (from the pedigree) or `config` (the entry) |
| `rank` | Position in precedence order; 0 is the root schema, highest is the config |
| `tree` | The layer's parsed tree — what it actually contributes. Omitted from an earlier draft of this table, which listed only identity, role and rank; the fold cannot merge without it, and v0.2's `Pedigree` deliberately does not carry it |

**Invariant**: ranks are dense, total, and derived from the pedigree — never assigned ad hoc. The
config always ranks last, because it is the document the author is holding.

## Merge Strategy

`replace` or `append`, declared per key **by a schema** (§5.3). A config's declaration has no effect:
policy belongs to the contract.

`merge-by-key` is reserved by §5.3 and refused as **unimplemented** rather than unknown — the
distinction matters, because an author writing it is early rather than wrong.

## Provenance Entry

One layer's contribution to one pointer.

| Field | Meaning |
|---|---|
| `layer` | Which layer contributed |
| `span` | Where in that layer's real document — so an author can open the file and see the line |
| `outcome` | `won`, `overridden`, or `accumulated` |

`overridden` is the field that cannot be reconstructed after the fold: the losing value is gone from
the result, and nothing downstream can recover it. That is what §10 means by "nearly impossible to
retrofit", and it is why FR-022 states the requirement as *recording what was overridden* rather than
as an instruction about when to build the record.

## Provenance Record

RFC 6901 pointer → ordered chain of entries, winner first.

**Invariants**: every pointer that resolves to a value in the merged tree has a chain, and every
chain's pointer resolves in the tree. A pointer that resolves in one but not the other is a defect —
the price of keeping provenance beside the tree rather than on the node (research D1), and the reason
FR-021 requires "no layer supplied this" to be distinguishable from "this pointer names nothing".

For an `append` key the chain has no single winner: every contributor is `accumulated`, in
contribution order.

## Merged Configuration

| Field | Meaning |
|---|---|
| `tree` | The folded `Node` tree — frozen, canonically ordered, every node positioned |
| `provenance` | The record above |
| `pedigree` | Carried through from v0.2, so a consumer can still ask what it is bound by |

## Relationships

```
Pedigree ──ranks──> Layer[] ──fold──> Merged Configuration
                                       ├── tree: Node          (v0.1's model, unchanged)
                                       └── provenance: pointer ──> ProvenanceEntry[]
                                                          │
                                          every pointer resolves in tree, and vice versa
```

## State transitions

The fold is total: it produces a configuration or a non-empty diagnostic list, never both, and never
a partial tree — the same rule v0.1 set for one document and v0.2 for a graph.

```
graph + pedigree
   │
   ├── malformed merge policy ──────────> Diagnostics
   │     (unknown strategy, append over a non-sequence, merge-by-key)
   │
   └── fold, root → leaf ──> tree + provenance ──> freeze ──> Merged Configuration
```
