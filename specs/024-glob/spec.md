# Feature Specification: `glob` — a Pattern That Is Checked, and Expanded in a Stage of Its Own

**Feature Branch**: `024-glob` (committed on `main`)

**Created**: 2026-10-11

**Status**: Approved by the owner, 2026-10-11 (implementer: Sonnet)

**Input**: issues #4 (bring `glob` back as a built-in type, checked and anchored, never expanded) and #5
(expand it in a stage of its own, through an optional `Host.list`), both raised by 0km against v1.8.1.
`SPEC.md` dropped `glob` from v1 (§15, "`glob` as a built-in type") because a pattern the library never
expands invites its author to believe it will, and asked for an expansion semantics, a sandbox story and
a determinism story first. Taking both issues in one round answers all three. The owner ruled the shape
on 2026-10-11, one decision at a time:

1. **One round**, the type first (Part A), then expansion (Part B).
2. **The grammar is a strict subset of the Language Server Protocol's `GlobPattern`**: `*`, `**` and `?`
   only. Every other special character is refused by name, so growing toward the full LSP set later turns
   a refusal into an acceptance and changes nothing that worked.
3. **A `glob` value projects as its pattern string**, like `path`; its base is answered by a query beside
   `resource()`.
4. **Checking a pattern confines nothing; expanding it confines everything it reads.** A `path` value is
   data about a file and is never confined (v0.7 FR-038, §8.1's razor); a `glob` value is data about a
   set of files and is not confined either. Expansion lists directories through the host, which is a
   read, and the sandbox governs every read. `..` after a wildcard is refused as a syntax rule.
5. **A match carries the logical/physical pair** of v1.13: named by the route the walk took, identified
   physically, deduplicated physically, sorted by logical path in code point order.
6. **#5's three leans are taken**: no demand on the number of matches; a visited-entries cap in the
   library with an option to raise it; `list` reports kinds after following links and never judges.
   The stage is `expand()`; `load()` never calls it; a memory host ships as
   `@egildo/cascata/host/memory`.

**Ships as v1.14.** `SPEC.md` is a living document; the amendments this round implements are in Part D,
written by the coordinator in the same commit as this file. **Do not edit `SPEC.md`**; report every place
the code disagrees with it.

**Citations are milestone-local**: `v1.14 FR-nnn`. Extend `CITES_PATTERN` in every corpus loader that
gains a case, in the first commit that adds one.

---

## Part A — The type

- **FR-001** **`glob` is a built-in refinement of `string`**, beside `url` and `path` (§7), singular (one
  pattern); multiplicity stays in the brackets, `glob[]`. `resource` is unchanged and does not admit it.
  Like `url` and `path` it narrows: `string ∩ glob` is `glob`, and a house layer may narrow `path | glob`
  to `glob`.
- **FR-002** **The grammar.** A pattern is a sequence of segments separated by `/`. Within a segment:
  - `*` matches any run of characters (possibly empty) other than `/`;
  - `?` matches exactly one character (one code point) other than `/`;
  - `**`, **only as a whole segment**, matches zero or more whole segments;
  - every other character matches itself, by code point.

  **Refused**, each with a message naming the character or rule and its position: an empty pattern; a
  `**` that is not a whole segment (`a**`, `**b`); any of `[`, `]`, `{`, `}`, `\`; a `!` as the first
  character; an empty segment (`a//b`) and a trailing `/`; and a `..` segment after the first segment
  that contains a wildcard (FR-005). A leading `/` (an absolute pattern) and leading `..` segments are
  allowed, as they are in a `path`. These are a strict subset of LSP's `GlobPattern`, so every accepted
  pattern means the same thing to an LSP-conforming matcher.
- **FR-003** **Validation is linear** in the pattern's length and never backtracks: one pass over code
  points. Witness in the main suite by counting steps on adversarial input (`*****…`, `**/**/…/**`, a
  pattern at the document size cap), not by timing.
- **FR-004** **The diagnostic.** A value that fails the grammar fails `glob`'s type demand like any type
  mismatch, at the value's span, carrying the violated demand — the message names the refused character
  or rule. No new error code: it is the existing type-mismatch diagnostic with a precise message (report
  if the existing shape cannot carry it).
- **FR-005** **Checking confines nothing.** No sandbox check, no host call, no existence check while
  loading or validating; a `glob` value that points anywhere, `../../*.md` included, loads, as a `path`
  does. The `..`-after-a-wildcard refusal of FR-002 is syntax (`*/..` names nothing a pattern needs, and
  forbidding it lets the literal prefix be computed lexically), not confinement.
- **FR-006** **Projection.** The value view carries the pattern string exactly as written; the type
  generator emits `string` for `glob` and `string[]` for `glob[]` (§18 gains the row); the soundness
  oracle covers both.
- **FR-007** **The base query.** A query beside `resource()` — `globBase(configuration, pointer)`, name
  tentative — answers, for a `glob` value: the pattern; its **literal prefix** (the segments before the
  first segment containing a wildcard; for a pattern with no wildcard, all but its last segment); the directory the pattern is anchored at, which is the declaring
  document's directory joined with the literal prefix, by the medium's rule of v1.13 (a file's logical
  directory, a remote document's physical URL) with `otherLocation` beside it where the other rule
  differs, as `resource()` does; and the value's span. A query, not a check: no diagnostic, no host.
- **FR-008** **Cascade and provenance are unchanged mechanisms.** `glob[]` under `cascade: append`
  accumulates patterns in layer order; `why()` names the layer and line of each pattern.

## Part B — Expansion

- **FR-009** **`Host` gains an optional `list(location)`** answering `{ ok: true, entries: { name, kind:
  "file" | "directory" | "other" }[] }` or `{ ok: false, reason }`. Supply, never a verdict. `kind` is what
  the entry is **after following a symbolic link**; a link whose target is missing is `other`. A host
  without `list` is the library exactly as before.
- **FR-010** **The Node host implements it** with `readdir` (file types, then `stat` for a link), in
  `src/host/node.ts` only. The layering sweep gains `readdir` and `opendir` among what no other module
  under `src/` may call.
- **FR-011** **`@egildo/cascata/host/memory` ships**: `createMemoryHost({ files, links? })` answering
  `read`, `canonicalize` (following `links`, a map from a location to its target, files or directories),
  `paths` (POSIX) and `list`, with no cache. It imports nothing platform-specific. Provenance's
  `createMemoryHost` is the model; the existing test double may be built on it or kept beside it (report).
- **FR-012** **`expand(configuration, options)`** — a stage of its own, after `load()`/`validate()`, and
  the only stage besides resolution that asks the host. `options`: `host` (required), the sandbox roots
  (the same options `resolve()` takes; if the configuration already records the roots it was resolved
  with, those are the default — report which), and `limits`. It returns, for every value at a position
  whose accumulated type admits `glob` (alone, in a list, or in a union), that value's matches or its
  diagnostics; other values are untouched. A value with no wildcard is a pattern that names one file: it
  matches that file if it exists. `load()` never calls `expand()`.
- **FR-013** **The walk.** From the anchored directory of FR-007 (logical), segment by segment: a literal
  segment is a direct child; `*`/`?` segments match listed names; `**` descends through every directory,
  zero or more levels. Before listing any directory, its physical path (the host's `canonicalize`, v1.13's
  rule) is judged against the sandbox; a directory already listed under the same physical path is not
  listed again, which ends link cycles. Only entries of kind `file` are returned.
- **FR-014** **Dotfiles.** `*`, `?` and `**` never match a name whose first character is `.`, and `**`
  never descends into such a directory; a literal `.` does (`.github/*.yml`). The convention of every
  shell and of gitignore.
- **FR-015** **Matching is exact**, by code point sequence, against names as the host lists them: no case
  or Unicode normalization (§4.2's string rule). On a case- or normalization-folding disk a name matches
  as it is stored. The probe gate (FR-021) measures what the Node host lists for a decomposed name.
- **FR-016** **Each match carries the v1.13 pair.** Its logical path is the route the walk took; its
  physical path is the host's answer, present when it differs. Two routes to one physical file are one
  match, named by the smaller logical path in code point order. The list is sorted by logical path in
  code point order (not UTF-16, CLAUDE.md's trap), so the same files give the same list whatever order
  the host lists them in. Each match also carries the pattern's span, so `why()`-style provenance names
  the layer and line that selected it.
- **FR-017** **Confinement.** Every listed directory and every returned file is judged by the sandbox
  through its physical path, exactly as resolution judges a reference. A directory or file outside it —
  a literal prefix that climbs out, a link that leads out — refuses that **value's** expansion with the
  existing `sandbox-escape` code, positioned at the value, naming the offending location (logical, with
  the physical path beside it, v1.13). Other values still expand.
- **FR-018** **Refusals are data, positioned at the value.** New codes, one reason each:
  - **`host-cannot-list`** — the host has no `list`;
  - **`directory-unlistable`** — the host answered `ok: false` for a directory the walk needed (its reason
    in the message);
  - **`glob-in-remote-document`** — the declaring document was read over `https://`: HTTP has no
    directory listing, so a remote pattern is never expanded;
  - **`glob-limit-exceeded`** — the walk visited more entries than `limits.maxEntriesVisited` (default
    100,000; raise it in `options.limits`, as fetch limits are raised).

  An empty match is an empty list, never a diagnostic. `expand()` never throws for a document or the
  world, only for programmer error (no host).
- **FR-019** **World-blindness.** A configuration with `glob` values loads and validates with a host that
  has no `list`; only `expand()` refuses (`host-cannot-list`). Every stage before `expand()` is unchanged.

## Part B′ — Revisions after the coordinator's review (the owner's rulings, 2026-10-12)

- **FR-024** **Literal segments are paths; wildcard segments are matching** (on ambiguity 2). Every literal
  segment of a pattern, wherever it sits — the literal prefix, a literal after a wildcard, the last
  segment of a wildcard-free value — is found as a `path` is: by asking the host for that location
  (`canonicalize`, then the kind), not by searching a listing for the exact name. So `café.md`, written
  composed, finds a file stored decomposed on a disk that folds them, as opening `café.md` would. Only
  `*`, `?` and `**` compare names, by code point, as `list` returns them (FR-015 now governs wildcard
  segments only). A literal found this way is named by its written spelling (logical) with the stored
  one as physical, v1.13's pair.
- **FR-025** **The configuration remembers its roots** (on ambiguity 3). `resolve()` records the sandbox
  roots it was given on the result, and `merge()` carries them onto `MergedConfiguration`. `expand()`'s
  `sandboxRoot` becomes optional and defaults to them; given explicitly, it replaces them for that call.
- **FR-026** **A missing directory matches nothing** (on ambiguity 10). Where the walk needs a directory
  that does not exist — a literal prefix, or a literal after a wildcard — that branch matches nothing,
  and a value whose every branch is missing has an empty list. `directory-unlistable` is only for a
  directory that exists and that the host refuses to list.
- **FR-027** **The limit counts work, not names** (the coordinator, on ambiguity 12: CLAUDE.md's "measure
  the work, not the input"). Measured: a pattern of 60 `**` over 5,461 directories took 19 s and listed
  each directory once, so the cap of names listed never fired. `limits.maxEntriesVisited` now counts
  every (directory, pattern position) the walk enters plus every entry it examines there; past it,
  `glob-limit-exceeded`. Redundant consecutive `**` segments are equivalent to one and may be collapsed,
  but the count is the guard, so that `**/*/**/*/…` is bounded too. Witness by counting in the main suite
  (60 `**` over that tree refused at the default, accepted with the limit raised), not by timing.
  *Renamed by the owner, 2026-10-12:* the option is `limits.maxSteps` (default 100,000), since it counts
  walk steps, no longer entries visited.

## Part C — Witnesses

- **FR-020** **Grammar cases, written from FR-002 before the validator:** accepted — `*.md`,
  `content/**/*.md`, `?.yaml`, `**`, `/abs/*.md`, `../shared/*.md`, non-ASCII literals (`café/*.md`,
  composed and decomposed); refused, each at its position — empty, `a**`, `**b`, `[ab].md`, `{a,b}`,
  `a\b`, `!x`, `a//b`, `a/`, `*/../x`. Boundary: a lone `**`, a pattern at the size cap. Adversarial,
  counted: `*` × 10,000, `**/` × 5,000.
- **FR-021** **Probe gate before Part B is trusted** (Principle V): what `readdir` with file types answers
  on the real disk for a non-ASCII name stored composed and decomposed, a link to a file and to a
  directory, a dangling link, a link loop, a dotfile, and an unreadable directory. Record it; say which
  answers depend on APFS.
- **FR-022** **Expansion cases** (memory host by default; one shared `list` suite run against both the
  Node host on a temporary directory and the memory host): the same files listed in two orders give one
  list; non-ASCII names; `.hidden.md` matched only by a literal dot; `**` skipping `.git`; a link out of
  the sandbox refused at the value; a link cycle terminating; two routes to one file giving one match
  named by the smaller logical path; a match through a linked directory carrying its physical path; a
  wildcard-free value matching its one file, and matching nothing when absent; an unlistable directory;
  no `list`; past the cap; a remote declaring document; `glob[]` under `append` where each match names
  its own layer; a `path | glob` union position expanded.
- **FR-023** **Sabotage** each of FR-002's refusals (as a group, then `..`-after-wildcard alone), FR-013's
  physical revisit check, FR-014, FR-016's sort and deduplication, FR-017 and each FR-018 code, and watch
  its own cases go red. Count `list` calls rather than timing them.

## Part D — `SPEC.md` amendments this round implements

Written by the coordinator, in the same commit as this file:

- **§7** — `glob` returns as a built-in refinement of `string`, with its grammar, its base, and the
  sentence that checking it confines nothing; `resource` stays singular.
- **§12** — a conformance row: the LSP `GlobPattern`, the subset taken.
- **§14** — `glob` leaves Future (expansion with it); the roadmap gains v1.14.
- **§18** — the type table's `string` row gains `glob`.
- **Article VI** — `list`, its optionality and its "supply, never a verdict"; the memory host; that
  `expand()` is the second stage that asks the host.
- **§15** — the round's entry, superseding the "`glob` as a built-in type" entry by answering, by name,
  each thing it asked for: expansion semantics, a sandbox story, a determinism story.

---

## Ambiguities the implementer should expect

- **Where `expand()` learns which positions admit `glob`.** The accumulated demand of Article VIII is the
  natural source; the layering test decides which stage may import it. Report the module placement and
  the layering rules you add for it.
- **A `path | glob` union.** FR-012 expands every value at a position that admits `glob`; a value there
  that was meant as a path is then expanded as a one-file pattern. Decided by the coordinator, not the
  owner; report if a case makes it look wrong.
- **The anchored directory of a wildcard-free value** is its own parent directory (the literal prefix is
  everything but the last segment).
- **`?` and a non-BMP character**: one code point, two UTF-16 units. Test it.
- **The cap counts entries listed**, every name a `list` answer returns, not directories.
