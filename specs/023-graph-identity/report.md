# Milestone 023 — Graph identity: implementer's report

Implementer: Sonnet 5.5. Spec: `specs/023-graph-identity/spec.md` (FR-001 to FR-019). `SPEC.md` was not edited.
Ships as v1.13 by the spec; **`package.json` still says 1.12.1** (the bump and the tag are not mine to decide).

## Commits (all on `main`, none pushed, no amend/rebase)

| Commit | What |
|---|---|
| `5060c91` | Part A — two paths per document (FR-001 to FR-004) |
| `afda94c` | Part B — identity is physical; content identity on the chain is a cycle (FR-005 to FR-009) |
| `c537f1e` | Part E — logical URL normalized, physical URL after redirects (FR-014 to FR-016) |
| `299f65c` | Part C — where a relative reference starts; `link-changes-reference` (FR-010 to FR-012) |
| `82319a0` | Part D — names stay logical (FR-013) + the first v1.13 corpus case, `CITES_PATTERN` extended |
| `4a40345` | Witnesses — the probe gate and the cases on the real disk (FR-017, FR-018) |
| `3d63a81` | `docs/reference.md` for v1.13 |
| `a0bbe98`, `41c761c`, `e5b69b6` | three test-only commits (unparseable URL text; a redirect within one directory; what the old code did) |

Part E was committed **before** Part C, not in the spec's letter order: FR-011 (a remote document's relative
reference starts from the physical URL) needs the final URL that FR-015 puts in the cache entry.

Tests: **before 106 files / 3191 tests (main) + 8 / 14 (timing); after 112 files / 3269 tests (main) + 8 / 14 (timing)**.
+6 test files (`graph-identity-{paths,cycles,remote,base,names,disk}.test.ts`) = 77 tests, + 1 corpus case
(`resolve-cases/fail-cycle-link.json`, a committed symbolic link) = 78. `pnpm typecheck` and `pnpm test` green at
`e5b69b6`. The timing suite is serial and was green on every full run except while the machine's load average was 70 to 96
(other processes: a `bfs` over `/`, OrbStack, a Playwright Chrome). In that state three timing tests failed, one of
them `validate-totality`'s type-expression parser, which this milestone does not touch; they passed on reruns
at load 12 to 16. I did not loosen any bound. See Ambiguities (the one "load" item) for what that proves and does not.

## What was built, per FR

- **FR-001/FR-002** — `PhysicalPaths` (`src/resolve/location.ts`): the host's `canonicalize`, else the nearest
  answering ancestor with the rest appended (the rule `safeCanonicalize` had, moved into the class), else the lexical
  path. The logical path is untouched (`classifyReferenceLocation` / `toAbsoluteEntryLocation`).
- **FR-003** — one `PhysicalPaths` per `resolve()` call memoizes **every question put to the host** (a promise per path),
  ancestors of a missing path included. The sandbox check (`isWithinSandbox`, `isSandboxEscape`,
  `isDelegationSandboxEscape`) takes the `PhysicalPaths`, not the host, and `canonicalizeForDiagnostic` is gone: a message
  reads the same answer. Counted in `graph-identity-paths.test.ts` with `InMemoryHost.canonicalizes`: a chain of four
  documents plus a root asks exactly five questions (the old code asked the root once per schema-authored reference).
- **FR-004** — `Origin.physical?` (only when it differs from the label; `createOrigin(id, label, physical?)` drops an
  equal one and throws on an empty one), `DocumentIdentity.physical` (required), a fragment's origin gets its own.
  `id`/`label` and the invariant `layer.identity.location === span.origin.id` are unchanged.
- **FR-005** — `GraphBuilder.beginVisit(location, incoming, physical = location)`; the active path, `resolvedByPhysical`
  and the cycle chain (each frame now carries `location` and `physical`) are physical. `resolvedByLocation` is kept beside it
  (see Ambiguities: remote).
- **FR-006 (as first built, then revised; see "Revision after the coordinator's review")** — first `contentCycle` (a hash
  match on the active chain is a cycle). **Now:** no content dedup at all; `registerContent`, `contentCycle` and
  `canonicalByHash` are gone, the stale "should still recurse" doc is replaced, the hash stays for `$pin` and
  `DocumentIdentity.hash`.
- **FR-007** — `DelegationCycleTracker.enter(location, physical = location)` compares physical paths; `frames()` added.
  Grafts are still never deduplicated (a control pins two side-by-side grafts of one file).
- **FR-008** — `editTarget`'s `otherPlaces` compares physical paths (new `physicalsInTree` in `src/model/pointer.ts`,
  read from the existing pointer index; `originsInTree` is untouched because a test pins its shape). The delegated
  `byteCache` is keyed by physical path (a local file) or by the requested URL and the final URL (a remote one).
- **FR-009** — overrides unchanged; each gets its `physical`.
- **FR-010/FR-011** — `referenceBases(referrer)`: a file's relative reference starts from the logical path, a remote
  document's from the physical URL. `walkAdoptsChain`, `readOverrides` and `performGraft` take a `Referrer {location,
  physical}`. The one behaviour change of the part (remote, via a redirect) is named in `docs/reference.md`.
- **FR-012** — `linkNotice` (`src/resolve/location.ts`), code `link-changes-reference` added to the catalogue
  (`GRAPH_IDENTITY_CODES`), `info`, positioned at the reference. Raised from `$schema`/`$adopts`, the launching schema,
  overrides and delegated locations; collected in a per-call `notices` array and returned first in `ok:true`'s `diagnostics`.
- **FR-013** — `reference-cycle` message (a cycle through a second spelling names both, one on identical bytes says so, one
  on a single spelling behind a link appends the file; an unlinked cycle is worded exactly as before), the delegation cycle
  message, `sandbox-escape` (logical, then `(the file ...)`), `editTarget`'s `physicalLocation`.
- **FR-014** — `classifyReferenceLocation`/`classifyLocatedDocument` normalize an `https` location with `new URL(...).href`.
- **FR-015** — `fetchDocument`'s `finalUrl` flows out of `resolveRemoteDocument` (fresh hit, stale fallback, 304 and
  fetch alike); `StoredMeta.finalUrl` is written with every entry; an entry without one answers its own URL.
- **FR-016** — `GraphBuilder.learnPhysical(location, physical)`: a remote visit starts under its URL and is judged
  (cycle / duplicate / new) the moment the fetch says where it ended.
- **FR-017/FR-018/FR-019** — below.

## FR-017: the probe gate (run before Part A was trusted)

Machine: macOS (Darwin 25.6.0), APFS, Node 25.6.1, `createNodeHost().canonicalize` on a fresh `os.tmpdir()` directory.
The disk **folds case** and **folds Unicode** (both probed by asking the disk, not by platform name).

```text
non-ASCII, composed asked          -> .../café/g.yaml  (e9; true spelling)
non-ASCII, decomposed asked        -> the same, composed (APFS folds the question to the name it holds)
wrong-case dir  CASE-X             -> Case-x            wrong-case file REAL/F.YAML -> Real/f.yaml
symlink to a file                  -> the file          symlink to a dir, file under it -> the file
chain of three links               -> the ultimate file
link loop A<->B, and a path under it, and a link to itself  -> undefined, in 0 ms (no hang, no throw)
dangling link                      -> undefined
missing file under a linked dir    -> undefined (also two levels down)
the filesystem root  "/"           -> "/"
"" and a relative path             -> undefined
trailing slash                     -> stripped
os.tmpdir() itself                 -> /private/var/folders/...   (/var is a link on macOS: FR-013's naming rule fires in every real-disk test)
literal ".." after a link: L/../x.yaml, L -> sub/deep   -> sub/x.yaml   (realpath resolves ".." PHYSICALLY)
```

What depends on the disk: **case folding and Unicode folding** (the two `skipIf` tests; probed on the directory the file
made). Link following, loops (`ELOOP` -> undefined), dangling and missing answers are POSIX `realpath(3)` and not
disk-specific; `/var -> /private/var` is macOS. The last line matters for Part C: the library collapses `..` lexically
**before** asking the host (`paths.resolve`), so the host never sees a `..`, and the logical path is exactly Pike's lexical
one while the physical path is the OS's. That is the FR-012 scenario, and it was measured, not assumed.

The same tests are in `graph-identity-disk.test.ts` ("FR-017 (probe gate)"). The suite's other answers (the old
`node-host-spelling.test.ts`) were not touched.

## FR-006's latent crash, reproduced before it was fixed

In-memory host: entry `/v/e.yaml` = `$schema: ./s.yaml`, `/v/s.yaml` = `$adopts: ./copy.yaml`, `/v/copy.yaml` = the entry's
bytes. On `c102494`: `Internal error: pedigree document at '/v/e.yaml' has no 'via' reference`, thrown from
`buildPedigree` out of `resolve()`. Fixed in `afda94c` by refusing it as a cycle, and **removed at its root in `b9ca014`**
(no hash dedup, so nothing hands the entry back): the case is now an ordinary document (`graph-identity-cycles.test.ts`
"3b" and, on the real disk, "3b" in `graph-identity-disk.test.ts`).

## Red before green

Every new test file was written and watched red before the code that judges it. Beyond that, the whole new set was copied
onto a clean worktree of `c102494`: **55 of the 74 tests then written failed** (the 19 that passed are controls and the
probe gate, which describes a host that did not change). Corpus case `fail-cycle-link` resolved `ok` before v1.13.

## Sabotage (FR-019, plus every other rule)

Protocol: back up to `/tmp` first, mark `SABOTAGE`, run, restore from the backup, `grep -rn SABOTAGE src/ tests/` empty before
every commit (and after the batch). The runs below were made on the final code with
`vitest run tests/unit/graph-identity* tests/unit/delegation-depth-limit.test.ts tests/corpus/resolve-corpus.test.ts` (107
tests). "Red" is the count of tests that went red; the names are abbreviated.

| FR | Rule broken | File | Red | Which |
|---|---|---|---|---|
| FR-002 | nearest-ancestor fallback dropped | `src/resolve/location.ts` | 2 | where the host answers undefined, the nearest answering ancestor stand; a document on the other side that does not exist counts as different |
| FR-003 | host answers not remembered | `src/resolve/location.ts` | 3 | a chain of four documents asks the host once for each, and once for th; a delegated fragment is asked once, for its identity and its sandbox c; where the host cannot answer, the walk up is asked once per directory  |
| FR-004 | createOrigin drops physical | `src/model/span.ts` | 10 | a fragment's origin gains its own physical path: id `<location> #graft; createOrigin keeps a physical path only when it differs from the label; origin.physical is present only when it differs; id and label stay log; 5. one file grafted twice under two spellings is edit-target-shared un; and 6 more |
| FR-004 | document identity loses physical (adoption chain) | `src/index.ts` | 6 | a file behind a linked directory: logical as written, physical as the ; where the host answers undefined, the nearest answering ancestor stand; a value from a document behind a link is attributed to its logical loc; a document behind a redirect has the requested URL as its logical one ; and 2 more |
| FR-004 | fragment origin loses physical | `src/index.ts` | 4 | a fragment's origin gains its own physical path: id `<location> #graft; 5. one file grafted twice under two spellings is edit-target-shared un; under warn it is answered with the logical location, the physical besi; 5. one file grafted twice under two spellings (a link) is edit-target- |
| FR-005 | active-path cycle judged by logical location only | `src/graph/build.ts` | 8 | 1. a schema that adopts itself under a case variant is reference-cycle; 2a. the same through a symbolic link to the schema; 2b. the same through a linked directory: ../dl/s.yaml, where dl is a l; 3a. the entry adopted back under another spelling is a cycle, and its ; and 4 more |
| FR-005 | finished-document duplicate judged by logical location only | `src/graph/build.ts` | 1 | GraphBuilder, directly: once a document is finished, another spelling  |
| FR-006 | content identity on the chain is a dedup again | `src/graph/build.ts` | 3 | 3b. a byte-identical copy of the entry adopted by a schema on the chai; a byte-identical copy of a schema ancestor is a cycle too; 3b. a byte-identical copy of the entry on the chain is reference-cycle |
| FR-007 | delegation cycle judged by logical location | `src/index.ts` | 4 | 4a. a fragment that delegates to itself under another spelling is refe; 4b. through a directory that links to itself: reference-cycle on the f; names each fragment on the path, the second spelling with the file it ; 4. a fragment that delegates to itself through a link is reference-cyc |
| FR-008 | editTarget counts places by logical location | `src/edit-target.ts` | 3 | 5. one file grafted twice under two spellings is edit-target-shared un; under warn it is answered with the logical location, the physical besi; 5. one file grafted twice under two spellings (a link) is edit-target- |
| FR-008 | delegated byte cache keyed by logical location | `src/index.ts` | 3 | 4a. a fragment that delegates to itself under another spelling is refe; 5. one file grafted twice under two spellings is edit-target-shared un; names each fragment on the path, the second spelling with the file it  |
| FR-010 | a file's relative reference starts from the physical path | `src/resolve/location.ts` | 15 | 6. a reference through a linked directory loads the logical file, and ; a delegated location is judged the same way, at the delegating value; a document on the other side that does not exist counts as different; an override and a launching schema, which the embedder names relative ; and 11 more |
| FR-011 | a remote document's relative reference starts from the requested URL | `src/resolve/location.ts` | 3 | 7. a relative $adopts in a document reached through a redirect resolve; 7. offline, the same answers come from the cache; a remote fragment's own delegation starts from its physical URL too |
| FR-011 | resource() resolves a remote value from the requested URL | `src/validate/resource.ts` | 1 | a path provided by a remote schema behind a redirect resolves from the |
| FR-012 | no notice is ever raised | `src/resolve/location.ts` | 8 | 6. a reference through a linked directory loads the logical file, and ; a delegated location is judged the same way, at the delegating value; a document on the other side that does not exist counts as different; an override and a launching schema, which the embedder names relative ; and 4 more |
| FR-012 | a notice is raised even where both answers are one file | `src/resolve/location.ts` | 3 | two spellings of one file in the linked directory are one document, so; 6. a linked directory where both answers name the same file raises no ; 6. a linked directory whose ../base.yaml names different files: the lo |
| FR-012 | delegated references raise no notice | `src/index.ts` | 2 | a delegated location is judged the same way, at the delegating value; a remote fragment's own delegation starts from its physical URL too |
| FR-012 | overrides and launching schema raise no notice | `src/index.ts` | 1 | an override and a launching schema, which the embedder names relative  |
| FR-012 | remote notice compares nothing | `src/resolve/location.ts` | 0 -> 1 | first run: NONE (no case had a redirect that stays in one directory); after adding "a redirect that stays in the same directory leaves both rules naming one URL: no notice" it went red |
| FR-013 | cycle message omits the file where only the file differs | `src/index.ts` | 1 | a cycle closed under the same spelling, for a document behind a link,  |
| FR-013 | delegation cycle message names no file | `src/index.ts` | 1 | names each fragment on the path, the second spelling with the file it  |
| FR-013 | sandbox-escape (delegation) names only the physical path | `src/index.ts` | 1 | a delegated fragment a link carries out of the roots |
| FR-013 | editTarget omits physicalLocation | `src/edit-target.ts` | 2 | under warn it is answered with the logical location, the physical besi; 5. one file grafted twice under two spellings (a link) is edit-target- |
| FR-014 | remote locations are not normalized | `src/resolve/location.ts` | 6 | 7. a relative $adopts in a document reached through a redirect resolve; 7. offline, the same answers come from the cache; a remote fragment's own delegation starts from its physical URL too; controls: a document fetched without a redirect resolves as it always ; and 2 more |
| FR-015 | final URL not stored with the cache entry | `src/resolve/cache.ts` | 3 | 7. offline, the same answers come from the cache; offline, the same physical URL comes back from the cache, where it was; 7b. offline, the same refusal comes from the cache |
| FR-015 | a v1.12 cache entry answers an empty final URL | `src/resolve/cache.ts` | 1 | a cache entry stored before v1.13 has no final URL and answers its own |
| FR-016 | a redirect to a document on the chain is not a cycle | `src/graph/build.ts` | 3 | 7b. a schema that adopts itself through a redirect is reference-cycle,; 7b. offline, the same refusal comes from the cache; GraphBuilder, directly: a remote visit learns its physical URL after t |
| FR-016 | a redirect to a finished document is not a duplicate | `src/graph/build.ts` | 1 | GraphBuilder, directly: a remote visit learns its physical URL after t |

Notes on the table:

- **Sabotage must outrun the cases that already cover it** (memory): FR-005's "a finished document is a duplicate by
  physical path" stayed **green** in my first pass (nothing reached it end to end, because a chain is linear); a
  `GraphBuilder` unit test was added and the sabotage then went red. FR-012's remote comparison stayed green in the
  batch until the same-directory-redirect test was added.
- FR-016's "duplicate" outcome is reachable only at the `GraphBuilder` unit level; a chain cannot reach it end to end.
- The FR-005 case 1 reds appear in the disk file too because APFS folds case here; on a case-sensitive disk those two skip.
- FR-005's cases assert `host.reads` does not contain the second spelling: the refusal comes before the read, which only
  the path rule can do. (The FR-006 row above is the first version's sabotage, `contentCycle` disabled; see the revision
  section for the sabotage of the rule as revised.)

## Ambiguities

Everything below is a place the spec or `SPEC.md` was silent, contradictory or wrong, or a detail I invented. Nothing has been
softened.

### Where the spec's claims did not survive measurement

1. **[Resolved by ruling: `SPEC.md` §15 corrected in `ac8e550`.] "A fragment that delegates to itself under another spelling ... today it re-grafts until `depth-limit-exceeded`" is false
   on v1.12.** The grant tree is finite and bounds how far a graft is followed, so there is no unbounded re-grafting. Measured by
   sabotaging FR-007: the variant spelling (4a) was read and grafted once more, and a self-linked directory (4b) was grafted twice;
   **both resolved `ok`**, silently, with the file in the result twice. The spec's own sentence "(today it ...)" came from a
   survey that "none run". What FR-007 fixes is that they are now `reference-cycle` at the first hop. The `depth-limit-exceeded`
   branch is not reached by either. The test titles say what the old code did; `SPEC.md` §15's entry says "ran to
   `depth-limit-exceeded`": **that parenthesis in §15 is wrong** and should be corrected by the owner.
2. **[Resolved by the owner's ruling: FR-006 revised, identity is the physical path alone, no content dedup; implemented in `b9ca014`. The text below is what I reported.] FR-006's reason is not generally true**: "a byte-identical copy of an ancestor adopts what that ancestor adopts, so the chain
   could never end". Relative references in the copy resolve from the copy's location, so `/v/sub/s1.yaml` with the bytes of
   `/v/s1.yaml` may adopt a *different* file and the chain might end. I implemented the rule as written (cycle), which refuses a
   chain that might have terminated. The case that crashed (a copy of the **entry**) is a cycle for a different reason: the entry
   has no `via`. A narrower rule ("the entry is never a hash-dedup target") would have fixed the crash and kept the old merge for
   ancestors; the owner ruled the broader one, and `SPEC.md` §15 names it. Flagging that it is a refusal of something legal.
3. **FR-003 says "a chain of N local documents asks N times, not 2N"**. The count is: once per distinct logical path of a
   document, **plus once per sandbox root, plus once per ancestor walked for a path the host answers `undefined` for** — each
   once, memoized. Also a cost the spec does not name: documents on a **config-authored** chain (entry's `$schema`, launching
   schema, overrides) were never put to the host before (they are sandbox-exempt); they now cost one `canonicalize` each, for
   identity. For a Node host that is one `realpath` per document.

### Spec/`SPEC.md` text the code disagrees with

4. **[Settled as built by the owner: `resource()` keeps `otherLocation`; `SPEC.md` Article VI says so (`9408018`). `docs/reference.md` was checked against that sentence and carries the same, with the remote nuance of new ambiguity R4.] `resource` values get no notice** (the spec's "include it, and report"). `resource()` is a synchronous, host-free, "produces
   no diagnostic at any level" query (v0.7 FR-036 to FR-039). It cannot canonicalize, so it cannot tell whether
   `/link/x` and `/real/x` are one file, and a lexical comparison would fire on the commonest case (a linked directory).
   I did two things: remote values resolve from the physical URL (`origin.physical`), and the `path` result gains an optional
   **`otherLocation`** (invented field name), present only when the origin has a physical path and the other rule gives a
   lexically different location. So `SPEC.md` Article VI's "a link never changes a meaning silently" is not true for
   `resource()`; it is true only for a caller who reads `otherLocation`. If the owner wants a real notice, it has to be raised
   where a host exists (`load()`), which is a different design.
5. **FR-013's sandbox-escape**: the message already named the *physical* path (v1.7 FR-009: "the path actually judged"). The spec
   asks to "append the physical path when it differs", which read literally means the message starts naming the logical one.
   I wrote `resolves to '<logical>' (the file '<physical>')` when they differ and `resolves to '<path>'` when they do not. A
   wording change that nothing asserted on.
6. **FR-013's reference-cycle message** never named a document before (`Reference 'x' closes a cycle back to an already-visited
   document`). The spec's example (`/link/base.yaml (the file /real/base.yaml)`) has no existing sentence to append to, so I
   invented the tails: `: 'A' is reached again as 'B' (the file 'P')`, `: 'A' (the file 'P')` for one spelling behind a link,
   and `: 'B' has exactly the bytes of 'A', which is already on this chain, so the chain could never end` for FR-006. The
   delegation cycle message keeps its bare, unquoted paths and appends ` (the file P)`. Unlinked cycles read exactly as before
   (a control per message).
7. **[The fragment half is resolved by FR-020 (a `reference-fragment` refusal); the unparseable-text message by the revision. The rest stands.] FR-014 is not literally "Paths, queries and percent-encodings are not otherwise touched"**: `new URL(text).href` (measured
   on Node 25) percent-encodes spaces and non-ASCII in path and query (`a b.yaml` -> `a%20b.yaml`, `α` -> `%CE%B1`), maps IDNA hosts
   to punycode, resolves `.`/`..`. It keeps: the **fragment** (`a.yaml#x` and `a.yaml` are two labels, two cache keys, two
   documents here though one resource), **userinfo** (a credential in a label and a cache key; pre-existing), a trailing-dot host
   (`example.test.` is not `example.test`), percent-encoding case (`%7e` vs `%7E` vs `~`), a non-default port. Text the Standard
   cannot parse (`https://`, `https://[::1`, a relative `//[x` from a remote referrer) **stays as written**, so the refusal
   that follows is the unchanged `unsupported-scheme` — a relative reference in a remote document used to *throw* `TypeError`
   out of `resolve()` and now is a diagnostic whose message says "unsupported scheme ''" (accurate-ish, ugly).
8. **FR-011's one change of behaviour is also a trust change**: a relative reference in a document redirected to another origin
   now fetches from the *other* origin. That is the browser model and the spec's decision, and a pin still holds, but it
   deserves a line in §11 (security) if it is not there: a redirect target now chooses where a relative `$adopts` goes.
   (Remote references are not sandboxed, as always.)

### Judgment calls and inventions

9. **Cycle test uses `physical OR location`** (`beginVisit`): a frame is the same document if its physical path or its
   *logical location* is equal. The logical half is needed for a remote reference, whose physical URL is unknown until its
   fetch (a self-adoption under the identical URL must still be a cycle before a second fetch). For a file the two always
   agree, so it is dead there; the spec says "physical". `resolvedByLocation` is kept for the same reason (FR-016: a second
   reference to a URL that redirected is a pre-fetch duplicate).
10. **FR-012 remote: the other URL is not fetched.** Two URLs are "different documents" when they are different strings, so the
    notice can be raised where both redirect to one file (a false positive), never missed. A redirect within one directory
    (the common CDN case) raises nothing (a test). The spec says "by physical identity"; for a URL that would need a fetch.
11. **FR-012 timing and scope.** The notice is computed after the sandbox check and before the visit begins, so it is also
    raised for a reference that turns out to be a duplicate; for one that turns out to be a cycle or unreadable the call is
    `ok:false`, and `info` notices exist only on `ok:true` (as every `info` does), so it is dropped. Host-located references
    (`Host.locate`) get none (no relative text). `~/` and absolute texts get none (both rules agree). The notice for an
    override or the launching schema is anchored at the existing phantom span in the entry.
12. **"A missing document on the other side counts as different"** is not a special case in the code: the other side is judged
    through its nearest existing ancestor (the sandbox's rule), which cannot equal a file that exists. Covered by a test with a
    host that answers only for directories.
13. **`DocumentIdentity.physical` is required (FR-004: "always present")**, which broke the typecheck of 55 hand-built identity
    literals (56 lines) in 23 existing test files. I added `physical: <the location expression>` to each and changed nothing else; the
    diff of those files is only added `physical: ...` text (checked: every one of the 56 removed lines is an identity literal). No assertion
    was touched. One regex slip of mine (it also matched the signature of `fakeDocument` in `graph-content-dedup.test.ts`) was
    caught by the typecheck and restored before the commit. An optional field would have avoided the churn; the spec said
    required, so I followed it.
14. **`verifyPin`'s parameter type** is now `Pick<DocumentIdentity, "hash">` (it only reads the hash, and fetch.ts built a
    `{location: "", hash}` literal that no longer typechecks). No behaviour change.
15. **`metaValidate()`** builds its documents without `resolve()` and does not canonicalize: its identities' `physical` is
    their `location`. It is not in any FR; said so here.
16. **`createResolvedDocument`** (unused in `src/`) gained an optional `physical` parameter to stay honest.
17. **A cache entry for a `no-store` response** is not stored, so it has no final URL to answer offline (it never had bytes
    either). Not a regression, noted.
18. **Where FR-015 says "for an offline or fresh cache hit, the final URL recorded when it was stored"** I also use the stored
    URL on a **304 revalidation**: the fresh `fetched.finalUrl` (the 304 came from the end of the redirect chain).
19. **`editTarget`'s physical test** reads `origin.physical ?? origin.label` for the origin of the *value*, so a layer read as a
    file and the same file grafted are one place when their physical paths are equal. `physicalLocation` is on every `ok` result
    where it differs, including the refusal-free paths.
20. **Corpus.** One resolve-corpus case (`fail-cycle-link`, a committed symlink `alias.yaml -> schema.yaml`, which the
    `ok:false` runner can express); the `link-changes-reference` cases are unit tests, because the corpus runner does not assert
    `ok:true` results' diagnostics. FR-018 item 9 ("controls") is the existing 3191 tests, unchanged and green.
21. **No `tasks.md`** exists for 023, so no checkboxes were ticked.
22. **`docs/reference.md`** was updated (a version row, the identity shape, the code table, a "Graph identity" section). It is
    a derived artifact, not `SPEC.md`; the sweep-derived-artifacts lesson is why. I did not touch `README.md` or the older
    `specs/*/contracts/` (they describe earlier milestones' shapes: `contracts/resolve-api.md` still shows a
    two-field `DocumentIdentity`).
23. **Real-disk tests and the macOS temporary directory.** The venue is deliberately *not* canonicalized, so FR-013's naming
    fires in every real-disk test; expectations are the OS's (`realpathSync.native`) and the spec's rule (written in the
    test as `named()`), not the library's.
24. **Load.** I cannot say a "quiet machine" run exists for every timing test: the final full runs were at load 12 to 33, all
    green; the failing runs were at 70 to 96 and included a test over code this milestone did not touch. The only code I
    changed on the `why()`/`editTarget()` path is one `Map.set` per node in the pointer index build (O(1)), so a ratio
    regression is not expected, but the 8x bound was not re-measured at a *quiet* load beyond the passes noted.

### Governance defects to flag (not fixed)

- `SPEC.md` §15 (v1.13 entry): "(or, for a fragment, ran to `depth-limit-exceeded`)" — see item 1.
- `SPEC.md` §7 "resolved relative to the declaring file's directory" and §8.4 "paths resolve relative to the delegating config's
  directory" are silent on logical versus physical; Article VI settles it, but the two sentences now need "(logical)" or a
  pointer to Article VI to avoid reading as physical.
- `SPEC.md` §3/§15's "a link never changes a meaning silently" does not hold for `resource()` (item 4).
- `SPEC.md` §15 (v1.11.1 entry) still says "the graph's own identity and cycle detection remain lexical ... parked as issue #8";
  true as history, closed by v1.13; no edit needed unless the owner wants a back-pointer.


## Revision after the coordinator's review

Three rulings arrived after the report above was first delivered. Commits: `b9ca014` (FR-006 revised),
`ac214c9` (unparseable URL text), and the FR-020 commit (`reference-fragment`, with `docs/reference.md`).

**Counts.** Main suite: before 106 files / 3191 tests (start of milestone); first delivery 112 / 3269; **now 113 files / 3279**.
Timing suite 8 / 14, green (one run at load 64, which it survived).

### 1. FR-006 revised: identity is the physical path alone

Cases first, red against the code of the first delivery (the legal chain was refused as `reference-cycle`, "has exactly the
bytes of"; the entry copy likewise). Then `registerContent`, `contentCycle`, `StackFrame.document` and `canonicalByHash` were
removed from `GraphBuilder`; `walkAdoptsChain` and `resolveEntry` no longer have a canonical-versus-built distinction;
`cycleDiagnostic` lost its `byContent` tail; `finishVisit(location, document)` memoizes the document itself. The hash is
untouched for `$pin` and `DocumentIdentity.hash`.

New or changed cases (all in `graph-identity-cycles.test.ts` unless stated):

- the coordinator's chain, `e -> x/a -> x/b -> y/a -> y/b` with `x/a` and `y/a` byte-identical: resolves, five documents with the
  entry (discovery order `e, x/a, x/b, y/a, y/b`; pedigree root-to-leaf `y/b, y/a, x/b, x/a`), equal hashes, two documents; also on the
  real disk (`graph-identity-disk.test.ts` "3b");
- 3b, a byte-identical copy of the entry at another path adopted by a schema: an ordinary document, no throw, no cycle;
- 3a, the entry adopted back under another spelling: **unchanged**, still `reference-cycle` (physical identity), pinned again;
- a `GraphBuilder` unit case: two locations, one hash, two documents, each memoized as itself.

**Assertions that changed, and why** (nothing was deleted; each now pins the opposite by the owner's ruling):

| Where | Was | Now |
|---|---|---|
| `graph-identity-cycles.test.ts` "3b" | `reference-cycle` with a "same bytes" message and a `related` span | resolves; documents `e, s, copy`; pedigree `copy, s`; same hash, different physical |
| same file, "a byte-identical copy of a schema ancestor is a cycle too" | `reference-cycle` at `s2.yaml` | replaced by the coordinator's chain (the old fixture was in fact `document-unreachable` once the rule is gone: `/v/sub/s2.yaml` does not exist, which was my fixture's own flaw) |
| same file, "controls: identical bytes off the active chain still converge" | `registerContent` returned the earlier document; `contentCycle` undefined | two documents, each memoized as itself |
| same file, "once a document is finished, another spelling is a duplicate" | used `registerContent` | uses `finishVisit(location, doc)` (same assertion) |
| `graph-identity-disk.test.ts` "3b" | `reference-cycle` | resolves, plus the chain |
| `graph-content-dedup.test.ts`, test 1 "two different locations with identical content-hash converge to the same GraphDocument object" | `canonicalB` is `canonicalA`, not `docB` | stay two `GraphDocument`s; each memoized as itself (`beginVisit` answers `duplicate` with `docB` / `docA` respectively) |
| same file, tests 2 and 3 | `registerContent(...)` then `finishVisit(canonical)` | `finishVisit(doc)` directly; the same `duplicate` / not-deduped assertions; the header comment records the revision |
| `graph-remote-dedup.test.ts` | the protocol helper called `registerContent` | calls `finishVisit(url, document)`; the assertion (second visit is a `duplicate`, one request) is unchanged |
| comments only: `cycle-detection.test.ts`, `host-in-memory.test.ts` | described content dedup as a second safety net / the dedup mechanism | a bracketed v1.13 note each that it is gone |

### 2. Unparseable URL text

Cases first (message contains `'//[x' is not a valid URL` and not `scheme ''`; likewise for `https://[::1`), red. No existing
code names "a reference that is not a location" (`codes.ts` has `malformed-pin`, `malformed-document`, demand-vocabulary
codes), so it stays `unsupported-scheme` with a message that names the text: `Reference '<text>' is not a valid URL, so it
cannot be fetched — only HTTPS and local paths are supported`. The empty-scheme wording is gone.

### 3. The queued rulings

- **Ambiguity 4**: settled as built; `docs/reference.md` already said `otherLocation` and now says what `location` follows.
- **FR-020, `reference-fragment`** (new error code, in `REFERENCE_RESOLUTION_CODES` with its doc, and in `docs/reference.md`'s
  table). `classifyReferenceLocation` and `classifyLocatedDocument` return a new `fragment` kind for an `https` URL whose
  normalized form contains a `#` (so `#x`, `a.yaml#x`, a bare `#`); the three places that follow references (the adoption
  chain, overrides, delegation) refuse it at the reference before any request. Local paths are untouched. A redirect
  `Location`'s fragment is dropped (`URL#hash = ""`) from the URL the fetch ends at. Cases first (red, 8 of 9): absolute, empty
  `#`, relative `./b.yaml#y` and quoted `"#x"` in a remote document, a `Host.locate` answer, an override, a delegated remote
  reference and a remote fragment's own delegation, `a#b.yaml` and `#c.yaml` as local files that still load, and a redirect to
  `b.yaml#z` whose recording exists only without the fragment.

### Sabotage of the revision

| Rule broken | Result |
|---|---|
| Content dedup re-added in `walkAdoptsChain` (a hash map per resolve, entry included) | 3 red: the coordinator's chain (unit), "3b" entry copy (unit), "3b" on the real disk |
| Same, entry not included | 2 red (the chain, unit and disk): so the entry-copy case is what catches the entry half |
| The "not a valid URL" message reverted (`failure.scheme === ""` made false) | 2 red: the relative `//[x` case and the absolute `https://[::1` case |
| FR-020: fragments not detected (`remoteLocation` always `https`) | 6 red: absolute, empty, relative, `Host.locate`, override, delegation |
| FR-020: an empty fragment not detected (`hash === ""` read as none) | 1 red: "an empty fragment is still a fragment" |
| FR-020: delegation not refused | 1 red |
| FR-020: override not refused | 1 red |
| FR-020: redirect fragment not dropped (`next.hash = ""` removed) | 1 red: the redirect case |
| FR-020: local paths treated as fragments | 1 red: `a#b.yaml` |

`grep -rn SABOTAGE src tests` is empty.

### New ambiguities (after the review)

R1. **FR-020 is checked before the remote-delegation permission.** A delegated `https://...#x` is `reference-fragment` even when
    `allowRemoteDelegation` is off (the text is refused before anyone asks whether remote is allowed). The reverse order was also
    defensible.
R2. **FR-020 and a `Host.locate` answer**: the host's answer is refused at the reference that asked (the `$schema`/`$adopts`
    text, e.g. `beltype:doc`), and the message quotes that text, not the host's URL, which the author never wrote. The fragment
    shown is the host's.
R3. **FR-020 applies to URLs that parse.** `https://[::1#x` does not parse and is "not a valid URL", not a fragment refusal.
    Fragment detection is "the normalized `href` contains a `#`", which also catches a bare `#` that `URL#hash` reports as empty.
R4. **`SPEC.md` Article VI says `resource()` "answers the logical path as `location`".** For a **remote** declaring document the code
    answers the physical-URL resolution as `location` (the medium's convention, FR-011) and the logical-URL one as
    `otherLocation`; the sentence is true only of files. `docs/reference.md` says it the code's way. For the owner to reconcile.
R5. **[Resolved by the owner's ruling, FR-021; see "FR-021" below.] A remote URL with a query string is unreadable** (found by a control of mine): the format is taken from the extension of the
    URL *text*, so `https://x/a.yaml?q=1` is "No adapter recognizes the format". Pre-existing; not changed.
R6. **A transport can no longer see a fragment**: every request URL is fragment-less (the author's text is refused first, a
    redirect's is dropped), so recorded fixtures for URLs with fragments cannot exist.
R7. **The cycle message lost its "same bytes" tail** with the rule; a cycle through a second spelling or a link still names both.
R8. **The first delivery's FR-006 sabotage row and Ambiguity 2 text** are kept above as history, marked; the current rule's
    sabotage is in the table here.

### FR-021: a remote document's format comes from its URL's path

`formatForLocation` reads the extension of the WHATWG `pathname` for an `https://` location (text that does not parse is read
whole); a local location is read whole, as before. `Content-Type` is not consulted. Callers checked: `parseAtLocation`
(the entry, the adoption chain, overrides and the launching schema all go through it), `performGraft` (delegation),
`editTarget` (its `https://` refusal comes first, so a value from `…/o.yaml?v=2` is `edit-target-remote`, pinned by a
case), and `writers.ts`'s `claims` (see F3). Cases first, red (6 of 8; the two local cases are the "as today" controls and were
green throughout): `a.yaml?v=2` as YAML; `b.json?v=2` as JSON (valid JSON reads; `x: 1`, which only YAML accepts, is refused
by the JSON reader, which proves which reader ran); a query containing `.json` on a `.yaml` path as YAML; a path with no
extension and a `.yaml` in the query is still unreadable; the launching schema, an override and a delegated remote fragment;
`editTarget`'s remote refusal; a local `c.yaml?x`, in memory and on the real disk (skipped where the file system cannot
name a `?`), still "No adapter recognizes the format".

Sabotage, once: the `pathname` read replaced by the whole text, 6 red (every remote case above).

Counts: main suite **114 files / 3287 tests** (was 113 / 3279; +8 in `graph-identity-format.test.ts`); timing 8 / 14.

New ambiguities:

F1. **[Resolved by the owner's refinement of FR-021: the physical URL; see "FR-021 refined" below. What I reported:] The format is read from the logical (requested) URL**, not the physical one. A `…/latest?x` that redirects to `…/v2.yaml`
    is unreadable by this rule; the final URL is not consulted for the extension. Using the physical URL would have made the
    format depend on the answer of a fetch, which the offline cache then has to reproduce (it does record the final URL, so
    it could). The spec says the URL's path, and the logical URL is the one in hand before the fetch.
F2. **Percent-encoding and case**: the `pathname` is percent-encoded and the extension is lower-cased, so `A.YAML?x` is YAML and
    `a%2Eyaml` is not (`%2E` stays encoded in a pathname).
F3. **`writers.ts`'s `claims(location)`** goes through the same function, so a writer now claims `https://x/a.yaml?v=2`. A remote
    document is never an edit target (`editTarget` refuses it first), and a caller asking a writer about a remote location
    with a query was told "no" before and is told "yes" now. Not changed.

### FR-021 refined: the extension is read from the physical URL

`parseAtLocation` and `performGraft` take the format from `formatSource(location, physical)`: for an `https://` document the
physical URL (where the fetch ended), for a file its logical location as before. The "No adapter recognizes the format of ..."
message names the text that was judged. Offline the physical URL is the cache's recorded final URL, and a pre-v1.13 entry
answers its own URL (both pinned). Overrides, the launching schema and the adoption chain go through `parseAtLocation`; the
delegated fragment through `performGraft`; `editTarget` still refuses a remote document before it asks for a format.

Cases first, red (5 of the 7 new; the pre-v1.13 entry and the un-redirected `a.yaml?v=2` were green already, as controls):
a redirect from an extensionless URL to `.yaml` reads as YAML; to `.json` reads as JSON (valid JSON parses, `x: 1` is refused by
the JSON reader); the same offline from the cache; a delegated fragment and an override that redirect to `.yaml`; the mirror
consequence below; a pre-v1.13 cache entry; an un-redirected `a.yaml?v=2`.

**The mirror consequence, named:** a document requested as `https://x/a.yaml` that redirects to an extensionless URL
(`https://cdn.test/blob/a`) used to be read as YAML and is now unreadable (`No adapter recognizes the format of
'https://cdn.test/blob/a'`). A redirect to a download or blob URL is the realistic case; the owner's ruling accepts it.

Sabotage, once: `formatSource` returning the logical location, 5 red (YAML redirect, JSON redirect, offline, the mirror
consequence, the delegation-and-override case).

Counts: main suite **114 files / 3294 tests** (was 3287; +7 in `graph-identity-format.test.ts`); timing 8 / 14.

New ambiguities:

G1. **The format source depends on a fetch having happened**, so a document that fails to fetch has no format question; fine. But
    the pin and the cache are unaffected: bytes are the same, only the reader chosen differs.
G2. **A file keeps its logical location as the format source**, not its physical path: `c.yaml` that is a symbolic link to
    `blob` is YAML, and `blob.yaml` linked as `c` is not. FR-021 says local is "as today"; this is the same asymmetry between
    files and URLs that the rest of the milestone has (files start from the logical path, URLs from the physical), but here
    the file side is logical for the format while the URL side is physical.
G3. **`formatForLocation` itself still reads a URL's path**, so a caller giving it a URL directly (the writers' `claims`, F3) is
    judged by that URL, not a redirect target it knows nothing about.
