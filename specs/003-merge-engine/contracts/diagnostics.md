# Contract: Diagnostic Codes, v0.3 additions

**Implements**: FR-013, FR-014, FR-015 | **Extends**: v0.1's and v0.2's catalogues

Earlier codes are unchanged. Codes remain stable identifiers and part of the public contract.

Per constitution v1.2.0's phased Principle III, a v0.3 diagnostic carries a **code**, a **sentence**,
and a **primary span** whose origin names its document. The RFC 6901 pointer and the violated demand
arrive with the constraint checker in v0.4; a pointer appears here as the *provenance* key, which is
a different thing and not a diagnostic field.

| Code | Refuses | Primary span |
|---|---|---|
| `unknown-cascade-strategy` | A `cascade` value that is not a strategy — including a non-string value | The declared value |
| `unimplemented-cascade-strategy` | `merge-by-key`, reserved by §5.3 but not built | The declared value |
| `append-over-non-sequence` | `cascade: append` on a key whose value in some layer is not a sequence | The offending value, in the layer that supplied it |

`unknown-cascade-strategy` and `unimplemented-cascade-strategy` are deliberately distinct.
`merge-by-key` is named in `SPEC.md` §5.3 as reserved, so an author writing it is **early, not
wrong** — and a diagnostic that says "unknown" would teach them the opposite. This is the same
reasoning that made a sequence-valued `$adopts` refuse with `multiple-adoption` rather than as a
malformed value.

## What does not produce a diagnostic

- A **config** declaring `cascade`: ignored, not refused. A config is data; policy is contract
  (§5.3). Recorded as the more forgiving of the two readings FR-015 permits.
- A schema using `demand`, `seal`, `final`, or `delegate`: ignored. This milestone reads neither
  meaning nor error into vocabulary it does not implement (FR-002).
- An absent, empty, or non-mapping `keys:` section: contributes nothing (FR-003). A schema that
  provides nothing is not a broken schema.
