# Contract: Diagnostic Codes, v0.2 additions

**Implements**: FR-023, FR-024, FR-025 | **Extends**: v0.1's [catalogue](../../001-information-model-yaml-adapter/contracts/diagnostics.md)

v0.1's codes are unchanged. Codes remain stable identifiers and part of the public contract.

**Every code here reports the position of the *reference*, in the document that wrote it** (FR-023).
That is the milestone's central diagnostic property: a resolution failure is the least debuggable
kind, because the evidence is spread across files the author may not have opened.

## Reference resolution

| Code | Refuses | Primary span | Related |
|---|---|---|---|
| `document-unreachable` | A referenced document that does not exist, cannot be read, or timed out | The reference | |
| `reference-cycle` | A reference closing a loop | The reference that closed it | Each reference in the cycle, labelled, in chain order |
| `multiple-adoption` | A schema declaring more than one `$adopts` parent (v1 pedigree is a chain) | The second parent | The first |
| `chain-limit-exceeded` | A pedigree longer than `maxChainLength` | The reference that crossed it | |
| `unsupported-scheme` | A reference whose scheme is not HTTPS or a relative path — `http:`, `file:`, `data:` | The reference | |
| `sandbox-escape` | A **schema-authored** local reference resolving outside the sandbox root, including through a symlink | The reference | |

## Fetching and integrity

| Code | Refuses | Primary span | Related |
|---|---|---|---|
| `pin-mismatch` | Fetched bytes whose hash differs from the stated pin | The reference | |
| `malformed-pin` | A `$pin` that is not a well-formed `sha256:…` value | The pin | |
| `insecure-redirect` | A redirect hop leaving HTTPS | The reference | |
| `too-many-redirects` | More hops than `maxRedirects` | The reference | |
| `document-not-cached` | A document neither reachable nor in cache | The reference | |

`pin-mismatch` MUST name both expected and actual hash in its message. The bytes MUST NOT enter the
graph (FR-014).

## Rules for adding a code

Unchanged from v0.1, plus: **a resolution code MUST anchor to a reference, never to a fetched
document alone.** A diagnostic an author cannot trace back to something they wrote has failed at the
job this catalogue exists for.
