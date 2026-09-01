# Contract: Diagnostic Code Catalogue

**Implements**: FR-018, FR-019 | **Cites**: `SPEC.md` §4.2, §10, §11

Codes are **stable identifiers and part of the public contract** — the corpus asserts against them,
and tooling may branch on them. They are Cascata's own vocabulary, deliberately not a mirror of any
dependency's internal codes (research D6), so that a library rename is never a breaking change here.

Every diagnostic carries a primary span. Where a second position is meaningful it appears in
`related` with a label.

## Portability floor (§4.2)

| Code | Refuses | Primary span | Related |
|---|---|---|---|
| `duplicate-key` | The same key twice in one mapping, including duplicates introduced by expansion and by quoting differences (`"host"` vs `host`) | The later occurrence | The first occurrence, labelled |
| `non-string-key` | A key that is not text — a sequence or mapping key (`? [a, b]`), or a scalar key that is a number, boolean, or null (`1:`, `true:`) | The key |  |
| `unsupported-tag` | Any tag outside the YAML 1.2 core schema, including standard tags such as `!!binary`, `!!timestamp`, `!!set`, `!!omap`, and any unknown tag | The tagged **value** — see the note below |  |
| `multiple-documents` | More than one document in the input | The second document marker |  |
| `invalid-encoding` | Bytes that are not valid UTF-8 | The offending byte |  |

**`unsupported-tag` points at the value, not the tag.** The underlying reader exposes no position for
a tag token itself — only for the value it decorates — and recovering one requires the lossless CST
layer that §4.3 defers past v1. So the span identifies the value immediately following the offending
tag. This is a known imprecision, accepted deliberately rather than discovered late: the diagnostic
names the tag in its message, and the reader is one token away from it. Revisit if and when the CST
sibling lands.

The `non-string-key` and `unsupported-tag` cases are the ones the underlying library does **not**
catch — research confirmed both pass through it silently, which is precisely why they are Cascata's
to own.

## Resource limits (§11)

| Code | Refuses | Primary span |
|---|---|---|
| `depth-limit-exceeded` | Nesting past `maxDepth` | The node at which the limit was crossed |
| `size-limit-exceeded` | Input larger than `maxBytes` | Zero-width at offset 0 — nothing was parsed |
| `alias-cycle` | An alias that refers to content enclosing itself | The alias closing the cycle |

## Syntax

| Code | Refuses | Primary span |
|---|---|---|
| `malformed-document` | Input the underlying reader cannot parse at all | Wherever the reader failed |

This is the one code that wraps a dependency's error rather than expressing a Cascata rule. Its
message may quote the underlying reader; its **code** stays ours.

## Rules for adding a code

1. A new code needs a `SPEC.md` article to cite — Principle I. If no article sanctions the refusal,
   amend `SPEC.md` first. **From v1.0 that amendment is bounded** (§15's freeze rule): a *correction*
   is always permitted and an *addition* is permitted while no existing meaning changes, but a rule
   that starts refusing what it previously accepted **is** a changed meaning and requires **v2.0**.
   A new refusal code for a construct the language already accepts is therefore a v2.0 change, not a
   v1.x one.
2. A new code arrives with at least one accepting and one refusing conformance case (Principle V).
3. Codes are never repurposed. Retiring one and adding another is correct; quietly changing what one
   means is not, since the corpus and downstream tooling both depend on it (Principle VI).
