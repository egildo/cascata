# Feature Specification: Graph Identity — Logical Routes, Physical Documents

**Feature Branch**: `023-graph-identity` (committed on `main`)

**Created**: 2026-10-11

**Status**: Approved by the owner, 2026-10-11 (implementer: Sonnet)

**Input**: issue #8, found while fixing the Node host's spelling (v1.11.1, `specs/021-native-realpath/`):
the graph tells documents apart by the text of their location, so one file reached under two spellings
(letter case, Unicode form, a symbolic link) is two documents, and a schema that adopts itself under
another spelling resolves with itself twice in its pedigree instead of being refused as a cycle. The
owner ruled the shape on 2026-10-10 and 2026-10-11, one decision at a time:

1. Every document carries **two paths**, its **logical** one (the route taken, links included) and its
   **physical** one (where it really is) — POSIX's `pwd -L` / `pwd -P`. **Identity is physical.**
2. **A relative reference in a local document resolves from the logical path**, as the shell's default
   `cd` does (Rob Pike, *Lexical File Names in Plan 9, or Getting Dot-Dot Right*). Where a link makes the
   logical and physical answers name different documents, an `info` notice names both.
3. **Remote documents follow the same design**: logical is the URL as written, normalized by the WHATWG
   URL Standard; physical is the URL after redirects (a redirect is the web's link).
4. **A relative reference in a remote document resolves from the physical URL**, the browsers' rule
   (a document's base URL is its response URL). The same `info` notice applies in the other direction.

**Ships as v1.13.** `SPEC.md` is a living document (§15, "Amending this document"); the amendments this
round implements are listed in Part G and are written by the coordinator in the same commit as this
file. **Do not edit `SPEC.md`**; report every place the code disagrees with it.

**Citations are milestone-local**: `v1.13 FR-nnn`. Extend `CITES_PATTERN` in every corpus loader that
gains a case (`tests/corpus/{resolve,merge,validate,write}-case.ts`) in the first commit that adds one.

**What the map found** (a read-only survey before this was written; every claim below was traced in
the code, none run):

- `GraphBuilder` (`src/graph/build.ts`) keys `resolvedByLocation` and the cycle stack by the lexical
  location string, and `canonicalByHash` by content hash. `host.canonicalize` is called only by the
  sandbox check (`safeCanonicalize` in `src/resolve/location.ts`) and its diagnostic message.
- The location string is also `identity.location`, `origin.id` and `origin.label`, and the referrer for
  the next relative reference. Delegated fragments have their own cycle tracker, also lexical, and no
  content-hash safety net. `editTarget`'s shared-file check compares location strings.
- **A latent crash**: hash dedup returns the first document with the same bytes, without recursing. If
  that document is the entry (a schema adopting the entry under another spelling, or a byte-identical
  copy of it), it has no `via`, and `buildPedigree` throws "Internal error: … has no 'via' reference"
  instead of answering a cycle. Not yet reproduced — FR-012 does that first.
- The builder's doc says a caller "should still recurse" after a hash match; `walkAdoptsChain` does not.
  The doc is stale.

---

## Part A — Two paths per document

- **FR-001** **The logical path** is today's location, with one change for remote documents (FR-014):
  for a local document, the lexical resolution of what was written, from the referrer's logical path
  (`~/` expanded, `.` and `..` collapsed, no link followed, no case folded) — exactly what `location` is
  today. For the entry, `toAbsoluteEntryLocation` as today.
- **FR-002** **The physical path** of a local document is the host's canonical answer for it,
  `host.canonicalize(logical)`. Where the host answers `undefined` (the file does not exist yet, or the
  host cannot say), it is the canonical answer for the nearest existing ancestor with the remaining
  segments appended — the rule `safeCanonicalize` already applies for the sandbox, so the sandbox and
  the graph can never disagree about where a path is. Where no ancestor canonicalizes, the logical
  path. A location answered by `Host.locate` is local or remote by its answer and follows the same rule.
- **FR-003** **One canonicalize per local document per resolution.** A `resolve()` call asks the host
  once per distinct logical path (a per-call map); the sandbox check reads the same answer rather than
  asking again. Counted in the main suite with the in-memory host's `canonicalizes` log: a chain of N
  local documents asks N times, not 2N.
- **FR-004** **The model carries both.** `Origin` gains `physical?: string`, present only when it
  differs from the document's logical location; `DocumentIdentity` gains `physical: string` (always
  present; equal to `location` when nothing differs). `origin.id` and `origin.label` stay logical, so
  the invariant `layer.identity.location === span.origin.id` and every label are unchanged. A fragment's
  origin (`<location> #graft=N`, label `<location>`) gains the fragment's `physical` the same way.

## Part B — Identity is physical

- **FR-005** **The adoption graph keys by physical path.** `GraphBuilder`'s cycle stack and
  `resolvedByLocation` compare physical paths. A schema that adopts itself under another spelling, or
  through a link, is `reference-cycle`, positioned as any cycle is (at the closing reference).
- **FR-006** **Content identity on the active chain is a cycle, not a dedup.** When content-hash dedup
  would return a document that is on the current stack (the entry included), the reference is
  `reference-cycle`. Hash dedup against a document off the stack is unchanged. This fixes the latent
  crash, which no longer depends on spelling: a byte-identical copy of an ancestor adopts what that
  ancestor adopts, so the chain could never end. Correct the stale "should still recurse" doc.
- **FR-007** **Delegated fragments too.** `DelegationCycleTracker` compares physical paths, so a
  fragment that delegates to itself under another spelling is `reference-cycle` (today it re-grafts
  until `depth-limit-exceeded`). Grafts are still never deduplicated: two grafts of one physical file
  are two grafts, as since v0.6.
- **FR-008** **"Is this file shared?" is physical.** `editTarget`'s count of other places that read the
  same file (`otherPlaces`, v1.12) compares physical paths, so one file grafted twice under two
  spellings, or read as a layer and as a fragment under two spellings, is `edit-target-shared` under
  `"refuse"` and named under `"warn"`. The byte cache for delegated documents (`byteCache`) keys by
  physical path.
- **FR-009** **Overrides are unchanged.** They are layers, not graph nodes, and two with identical bytes
  are two layers (v1.6); the same holds for two spellings of one file. Each gets its `physical`.

## Part C — Where a relative reference starts

- **FR-010** **Local: from the logical path.** A relative `$adopts`, `$schema`, delegated location or
  `resource` value in a local document resolves against `dirname(logical)`, as today. Nothing that
  resolves today moves.
- **FR-011** **Remote: from the physical URL.** A relative reference in a remote document resolves
  against the URL the fetch ended at (`fetchDocument`'s `finalUrl`), the base URL a browser would use.
  **The one change of behaviour in this part**, named: a remote chain whose document was reached
  through a redirect resolves its relative references from the redirect's target, where it resolved
  them from the requested URL.
- **FR-012** **The notice when a link changes a reference.** When a document's logical and physical
  paths differ, each relative reference in it is also resolved by the other rule (local: from
  `dirname(physical)`; remote: from the logical URL), and when the two answers are different documents
  by physical identity, an `info` diagnostic, **`link-changes-reference`**, is positioned at the
  reference, naming the document the reference loaded, the one the other rule would have loaded, and
  the referring document's logical and physical paths (the host answers where a path ends, not which
  link it crossed, so the notice names the two ends rather than the link). A missing document on the other side counts as
  different. Only documents behind a link pay this cost. The notice never refuses.

## Part D — Names stay logical, the physical path beside them

- **FR-013** **What a user sees.** Every diagnostic, `why()` entry and `final`/grant message keeps the
  logical location it has today. The physical path travels in `origin.physical` (FR-004) for a caller
  to show. Messages the library writes itself that name a document — `reference-cycle`, the delegation
  cycle message, `sandbox-escape` — append the physical path in parentheses when it differs ("…
  `/link/base.yaml` (the file `/real/base.yaml`)"), and the cycle message names both spellings when the
  cycle closed through a second one. `editTarget`'s `ok` result gains `physicalLocation`, present when
  it differs from `location`; a writer handed either path writes the same file.

## Part E — Remote documents

- **FR-014** **The logical URL is normalized** by the WHATWG URL Standard: `new URL(text).href` for an
  absolute reference (lowercase scheme and host, default port dropped, `.` and `..` segments resolved,
  IDNA), and `new URL(text, base).href` for a relative one, as today. Paths, queries and percent-
  encodings are not otherwise touched (URL paths are case-sensitive). **The one change of behaviour in
  this part**, named: an `https://` reference written with an uppercase host or a default port is
  labelled, cached and compared in its normalized form.
- **FR-015** **The physical URL is the URL after redirects.** On a fetch, `finalUrl`; for an offline or
  fresh cache hit, the final URL recorded when it was stored. `StoredMeta` gains `finalUrl`; a cache
  entry stored before v1.13 has none and answers its own URL as physical (no refetch is forced). A
  pinned document (`$pin`) is identified by its URL as today for fetching, and its hash is checked as
  today.
- **FR-016** **Remote cycles and duplicates by physical URL**, as Part B for files: a schema that adopts
  itself through a redirect is `reference-cycle`.

## Part F — Witnesses

- **FR-017** **Probe gate before Part A is trusted** (constitution Principle V). Against `createNodeHost`'s
  `canonicalize` on a real temporary directory, record what each answers: a non-ASCII name in composed
  and decomposed form; a wrong-case spelling; a symbolic link to a file and to a directory; a link
  chain; a link loop (expected: `undefined`, not a hang or a throw); a missing file under a linked
  directory; the filesystem root. Probe on the machine's real disk, and say which answers depend on it
  (case-folding is APFS's default and not Linux's). On macOS the temporary directory is itself under a
  link (`/var` → `/private/var`): every real-disk test meets FR-013's naming rule whether it means to or
  not, so expect it.
- **FR-018** **Cases, written before the code** (in-memory host with a `canonical` map for every
  spelling; real-disk variants where the disk allows, skipped with a stated reason otherwise):
  1. a self-adoption under a case variant: `reference-cycle`;
  2. the same through a symbolic link to the schema, and through a linked directory;
  3. the entry adopted back under another spelling, and a byte-identical copy of an ancestor:
     `reference-cycle`, not a throw (FR-006; reproduce the throw first);
  4. a fragment delegating to itself under another spelling: `reference-cycle`, not
     `depth-limit-exceeded`;
  5. one file grafted twice under two spellings: `edit-target-shared` under `"refuse"`;
  6. a linked directory whose `../base.yaml` names a different file logically and physically: the
     logical one loads, and `link-changes-reference` names both; a linked directory where both name the
     same file: no notice;
  7. a remote document behind a redirect with a relative `$adopts`: resolves from the final URL, with
     the notice; a self-adoption through a redirect: `reference-cycle`; offline, the same answers from
     the cache;
  8. `HTTPS://Example.test:443/a.yaml` and `https://example.test/a.yaml` are one document;
  9. controls: every existing resolve, merge, validate and write case is unchanged, and so is every
     label in them (in-memory hosts canonicalize as the identity).
- **FR-019** **Sabotage** each of FR-005 to FR-008, FR-011, FR-012 and FR-016 separately and watch its
  own cases go red. Count host calls for FR-003 rather than timing them.

## Part G — `SPEC.md` amendments this round implements

Written by the coordinator, in the same commit as this file:

- **§3's graph-build row** — "diamond dedup by canonical identity (pin hash)" becomes true as written:
  identity is the physical path, then the content hash.
- **Article VI** — `canonicalize` is named as what identifies a document, not only what the sandbox
  checks; the two paths, logical and physical, and which one a relative reference starts from.
- **§15** — the round's entry, naming its changes of behaviour: aliased self-adoption and aliased
  self-delegation refused as cycles; remote relative references from the final URL; normalized remote
  labels; and the new notice.

---

## Ambiguities the implementer should expect

- **The notice's cost and scope.** FR-012 resolves a second time only behind a link; whether a
  `resource` value (validated, not loaded) should get the notice is a judgment — include it, and report.
- **Which spelling a cycle message shows first.** FR-013 asks for both; the order is the order reached.
- **Physical for a host-located custom scheme answered with a local path** is that path's canonical
  answer (FR-002). A host that answers `canonicalize` for documents only (no directories) leaves a
  missing file's physical path lexical; that is correct, and the in-memory host does exactly that.
- **Windows paths** are out of scope for the real-disk tests; the logic is the host's.
