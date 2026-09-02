# Feature Specification: Host-Resolvable Identity, and a Sandbox Root That Contains

**Feature Branch**: `013-host-resolvable-identity`

**Created**: 2026-09-03

**Status**: Implemented

**Input**: BelType, embedding Cascata as its configuration cascade (2026-09-03). Two findings measured against v1.3, both from the same attempt. The first is a blocker: a reference in a scheme the embedder's host entirely owns is refused at classification, before the `Host` seam is ever consulted, so a host cannot answer a location in its own namespace. The second is a defect found beside it: `sandboxRoot: "/"` — the one value that plainly means *contain nothing, admit everything* — refuses every reference except the root itself.

**Implements**: `SPEC.md` Article VI (§16). The addition is that article's own premise carried one step further: the host answers *what is at a location*, and until now the library decided by itself which strings could be locations at all. The correction is `SPEC.md` §8.4/§11's sandbox, made to mean what it says at a filesystem root.

**The addition is an addition under §15's freeze rule; the sandbox change is a correction.** No document that resolved before this milestone resolves differently after it: the new door opens only for a host that implements a method no host had, and the sandbox change only admits paths that were plainly inside a root the caller named. See "Freeze analysis" below, which is the part of this page a future reader will check.

## The measurement

All four rows reproduced against v1.3 with an in-memory host, entry `/venue/…`, schema `/pkg/root.yaml`:

| | outcome at v1.3 |
|---|---|
| `resolve(entry, { schema: "beltype:document" })` | `unsupported-scheme`; the host is asked for the entry document and nothing else |
| a venue's `$adopts: /pkg/root.yaml`, `sandboxRoot: "/venue"` | `sandbox-escape` |
| a launching schema `/pkg/root.yaml`, `sandboxRoot: "/venue"` | `ok` — config-authored, exempt (v0.2 FR-020) |
| the same venue `$adopts`, `sandboxRoot: "/"` | `sandbox-escape`, for a path plainly under `/` |

The first row is the blocker. The third is what makes the second one's failure a design question rather than a bug: an embedder's *option* is already consent, and a schema's own text already is not, and a namespace the host owns is neither of those two things yet.

## User Scenarios & Testing

The user is **the embedder**, Article VI's host author. BelType ships a root schema inside its own installed package and wants `beltype:document` to name it — machine-independent, so a venue's `$adopts` line is portable between two checkouts that have the package at different absolute paths. Two routes, both required:

- **The launching option.** `resolve(entry, { schema: "beltype:document" })` — the entry names no `$schema`, and the embedder names the governing schema by identity rather than by path. (`host-identity-launching.json`; v1.4 FR-001)
- **A venue's `$adopts`.** A venue file writes `$adopts: beltype:document` and the entry adopts the venue. This is the route that failed twice at v1.3 — first on the scheme, then, once a path was substituted, on the sandbox. (`host-identity-adopts.json`; v1.4 FR-001, FR-003)
- **A scheme the host does not own.** `other:thing`, against a host that owns `beltype:` and nothing else: `unsupported-scheme` at the reference's own position, exactly the diagnostic v0.2 FR-013 has always produced. (`host-identity-unclaimed.json`; v1.4 FR-004)
- **A host with no namespace at all.** Every host written before this milestone. `unsupported-scheme`, unchanged, and `locate` is never called because it does not exist. (unit; v1.4 FR-004)
- **A located document that is remote.** The host answers with an `https://` URL: fetched, cached and pin-verified through the transport that has existed since v0.2, because the answer is a *location* and locations already have kinds. (unit; v1.4 FR-002)
- **`$id` is not a location.** A schema whose `$id` is `beltype:document` resolves exactly as before; `$id` names, it does not point. (unit; v1.4 FR-006)
- **A delegation target is unchanged.** `beltype:fragment` at a delegating key is still `unsupported-scheme`. (unit; v1.4 FR-006)
- **A sandbox root that contains.** `sandboxRoot: "/"` admits an absolute path; `/sandbox` still does not admit `/sandboxfoo`. (unit; v1.4 FR-007)

## Requirements

- **v1.4 FR-001** `Host` gains an **optional** method, `locate(reference: string): Promise<string | undefined>`. Where a `$schema` or `$adopts` reference — the launching schema included — carries a URI scheme that is not `https:`, the library asks `host.locate` for that reference's location before refusing it.
- **v1.4 FR-002** What the host returns is a **location**, and is read exactly as any location the library already holds: a string beginning `https://` is a remote document, fetched, cached and pin-verified through the existing transport; anything else is an absolute local path. Everything downstream is unchanged — parsing, format selection by extension, location and content dedup, cycle detection, the pedigree entry, and a relative `$adopts` written *inside* the located document, which resolves against that document's own location like any other. A host must return an absolute location or `undefined`; a relative string is a host bug, not a second syntax.
- **v1.4 FR-003** A located reference is **not sandbox-checked**. The location was chosen by the host, not written by a document, and the sandbox confines what a document's own text can reach (`SPEC.md` §8.4). A reference that reaches a location by *any* other route is sandbox-checked exactly as before.
- **v1.4 FR-004** A scheme the host does not own — `locate` absent, or returning `undefined` — is refused as `unsupported-scheme`, at the reference's own position, with the message v0.2 FR-013 has always given. Nothing about the state of the world throws.
- **v1.4 FR-005** A located document the host then cannot read is `document-unreachable`, naming the location *and* the reference's text, exactly as an unreadable path-named document does.
- **v1.4 FR-006** `locate` is consulted for pedigree references only. `$id` is an identifier and is never resolved (unchanged). A delegation target's scheme handling is unchanged: `SPEC.md` §8.4 gives remote delegation its own user opt-in, and a host namespace is neither local nor remote — widening delegation is a separate question with its own security paragraph to write.
- **v1.4 FR-007** *(correction)* A `sandboxRoot` that is a filesystem root contains every absolute path beneath it. Containment is "equal to the root, or under the root followed by a separator", and a root already ending in a separator must not have a second one appended.

## Freeze analysis (§15)

**The addition changes no existing meaning.** The new branch is reached only when three things hold at once: the reference carries a non-`https` URI scheme (v1.3 refused it), the host implements `locate` (no host did), and that method returns a location (it may always decline). A configuration resolved by any host written before this milestone resolves identically after it — the method does not exist, the optional call is not made, and the refusal is byte-identical. A schema valid before is valid after and means the same thing.

**The correction changes no meaning either, because the old behaviour had no users.** `sandboxRoot: "/"` at v1.3 refused every reference except the root document itself, which is not a configuration anyone ships: a caller who wanted confinement passed a real directory, and a caller who passed `/` got a library that refused everything and would have noticed on the first run. There is no configuration whose meaning changes that anyone could have been relying on. This is recorded here and in §15 because the freeze rule is the thing a future reader will check, and "no caller can have depended on it" is the argument, not "it was obviously a bug".

**Where §11 needed a qualifying clause.** §11 said a remote schema "can never trigger local file reads outside the sandbox". A host that owns a namespace can now be asked, by a remote schema, for a document outside the sandbox — and will answer only if it chose to name one. §11's own next sentence already carried the answer ("the library performs no I/O and can read only what its host answers... a host that declines has denied it"), so the clause is a *correction* to an over-broad sentence rather than a new permission. The bound on the risk is that a namespace is finite and the host wrote it; a path namespace is the whole disk, which is why the sandbox exists for paths and not for this.

## Design, and what was rejected

**Rejected: overloading `canonicalize`.** The tidiest-looking option, and the one with no new API at all — a scheme'd reference is handed to `host.canonicalize`, and a host that answers has claimed it. It fails on a measured fact about this codebase's own test double: `InMemoryHost.canonicalizeIsIdentity` defaults to `true`, so an identity-function `canonicalize` — the obvious implementation for a flat store, and the one already written here — would have claimed **every** scheme, silently turning three standing `unsupported-scheme` conformance cases (`data:`, `file:`, `http:`) into local paths. A door that opens by accident for the most natural implementation is the wrong door. A separate optional method is claimed only on purpose.

**Rejected: an allowlist option on `resolve()`** (`hostSchemes: ["beltype"]`). It puts the namespace's existence in the call and its contents in the host, so two places have to agree; and it still leaves the harder question unanswered — *what location does `beltype:document` have* — which is the question only the host can answer and which the located string settles for free. Once the host must answer that, the allowlist is a second gate in front of a gate.

**Rejected: making the reference config-authored.** It would have solved the sandbox half by reusing v0.2 FR-020's exemption, and it is wrong: `Reference.authority` is a fact about *who wrote the reference*, documented on itself as never inferred from the location's text, and a venue schema's `$adopts` line is written by a schema. The exemption this milestone needs is a fact about *who chose the location*, which is a different fact and gets its own clause.

**Chosen: the host locates, and the library uses the location.** One optional method, one branch in `walkAdoptsChain`, one classification helper. Everything after the branch is code that already existed: the located string is a location, and this library has known what to do with a location since v0.2. The properties that fall out rather than being built — a `beltype:document` and a `../pkg/root.yaml` reference converging on one document dedup, a relative `$adopts` inside the located document resolving against it, a located `https://` URL being pinned — are the evidence that the seam was cut in the right place.

## Out of scope

- **Delegation through a host namespace** (FR-006). A separate keyword with a separate opt-in (`SPEC.md` §8.4), and no consumer.
- **A default namespace.** Cascata owns no scheme and never will; a host that implements nothing has a library that behaves exactly as v1.3.
- **A location the host returns that is itself scheme'd but not `https`.** Not recursed into. The host is answering with a location, and one hop is the whole contract.

## Plan and tasks

One `spec.md` and a report, following 012's precedent for a change whose design fits in the requirement list above. Complexity Tracking: the constitution's seven-file flow was shortened for a milestone that is one optional interface member, one branch, one four-line helper and a two-line containment fix; the report says what was found. Tasks, in the order done: the three conformance cases and the two unit files first, all red against `main`; then the corpus format's `identities` field and the runner's namespace wrapper; then the `Host` member, the branch, and the containment correction; then `SPEC.md` (§16's law, §15's entry, §14's roadmap, §11's clause), `README.md`, and the version.
