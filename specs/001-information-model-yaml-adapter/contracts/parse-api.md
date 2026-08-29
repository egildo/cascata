# Contract: Public Entry Point

**Implements**: FR-025, FR-026, FR-014 | **Stability**: no compatibility promise before v1.0

## Shape

One entry point. It accepts a document's text and the identity of where that text came from, and
returns **either** a positioned tree **or** a non-empty list of diagnostics — never both, never a
partial tree (research D5).

```
parse(text, { origin, limits? }) -> ParseResult

ParseResult =
  | { ok: true,  tree: Node }
  | { ok: false, diagnostics: Diagnostic[] }   // non-empty, ordered by position
```

`origin` is required. There is no default, because a diagnostic that cannot say which document it
came from is the failure mode Principle III exists to prevent.

## Behavioral contract

1. **Never throws for bad input.** A malformed, hostile, or unportable document produces
   `{ ok: false, diagnostics }`. Exceptions are reserved for programmer error — a missing `origin`,
   a nonsensical limit. Bad *documents* are data, not exceptions.
2. **Total.** Every input produces one of the two outcomes; none hangs, and none exhausts memory
   (FR-014, FR-015).
3. **Deterministic.** Identical input yields identical trees and identical diagnostic lists, in
   identical order, on every run (SC-008).
4. **Diagnostics are complete.** One call reports every floor violation detectable in that pass, not
   the first (FR-019).
5. **The tree is deeply frozen.** Mutation attempts do not succeed (FR-026).
6. **No I/O.** This milestone reads text it is handed. It opens no file and touches no network —
   resolution arrives in v0.2, and the absence of I/O here is what keeps the corpus hermetic.

## Limits

| Option | Default | Refused with |
|---|---|---|
| `maxDepth` | 64 | `depth-limit-exceeded` |
| `maxBytes` | 8 MiB | `size-limit-exceeded` |

Size is checked **before** parsing, so a hostile document is refused without being parsed at all.
Defaults are proposals of research D7, chosen to clear real configuration documents comfortably; they
are configurable and the corpus asserts behavior at the boundary and one step past it.

## Empty documents

An empty document, a comment-only document, and a whitespace-only document are all **valid** and yield
a null scalar spanning zero width at offset 0. They are not errors: a document that says nothing is a
document that says nothing, and the cascade will have layers that legitimately do exactly that.
