# Milestone report: sandbox roots (015)

Branch `015-sandbox-roots`, on top of `3029d76` (the spec, and `SPEC.md` amended). Five commits, one
per story, each with `pnpm typecheck` clean and `pnpm test` green:

| | |
| --- | --- |
| `c8de7f2` | **Absent is not outside** — v1.7 FR-001 to FR-003 |
| `6f0375e` | **Granted roots** — v1.7 FR-004 to FR-006, FR-009, FR-011 |
| `e2d9f14` | **A schema's `~/`** — v1.7 FR-007, FR-008 |
| `395de64` | **`cascata/paths`** — v1.7 FR-010 |
| *(this commit)* | derived artifacts, `1.7.0`, this report |

The first commit stands alone: it touches `src/resolve/location.ts` and one new test file, changes no
signature and no option type, and can be tagged as a patch on its own if the rest stalls.

**Final suite: 90 files, 2140 tests, green.** The branch point was 89 files and 2082 tests; 58 cases
were added and one existing case was rewritten (below).

## What landed, per story

**Absent is not outside (FR-001 to FR-003).** `safeCanonicalize` no longer falls back to the lexical
path when `host.canonicalize` declines. It walks up with `paths.dirname` until the host answers, then
returns that canonical ancestor with the remaining segments appended — taken as a slice of the very
string they came from, `resolved.slice(current.length)`, so a non-ASCII or oddly normalized name
passes through untouched and no new `PathFacility` member is needed (FR-003's condition held). Where
no ancestor canonicalizes at all, the lexical path stands exactly as before, so a host that answers
`canonicalize` for documents only is unchanged. Both sides of the containment comparison now stand in
the same space, so `document-unreachable` and `sandbox-escape` separate cleanly, for `$adopts`/
`$schema` and for delegation alike — one fix, because `isDelegationSandboxEscape` has always reused
`isWithinSandbox` rather than reimplementing it. The doc comments on `isWithinSandbox` and
`safeCanonicalize`, which defended the old behaviour at length, are rewritten rather than appended to,
and now also record the window this deliberately leaves open (a dangling link inside the root).

**Granted roots (FR-004 to FR-006, FR-009, FR-011).** `ResolveOptions.sandboxRoot` is
`string | readonly string[]`; `toAbsoluteSandboxRoot` became `toAbsoluteSandboxRoots`, taking either
shape and returning the absolute list; `isWithinSandbox`, `isSandboxEscape` and
`isDelegationSandboxEscape` take `readonly string[]` and answer true for the first root that contains
the location. `requireSandboxRoot` holds v0.2 FR-022 member-wise. FR-009's message names the location
as resolved, every granted root in the order granted, and the option that grants one.

**A schema's `~/` (FR-007, FR-008).** `expandTilde` lost its authority condition and gained the
referring document's location: a leading `~/` written by a **local** document expands under either
authority, and a schema-authored one is then confined as every schema-authored local reference is. A
`~/` inside a document read over `https://` is not expanded at all. Putting the guard inside
`expandTilde` rather than in `classifyReferenceLocation` fixes `resolveReferenceLocation` in the same
line — both call it, and the spec named only the first.

**`cascata/paths` (FR-010).** `package.json` gains `./paths` and `./paths.js`, both
`{ types: "./dist/paths.d.ts", import: "./dist/paths.js" }`, on the `./generate` precedent. Nothing
moved in `src/`, so `tsconfig.build.json` already ships it and the realm sweep already polices it.
Verified against the built output as well as the source: `dist/paths.js` imports and spreads in a bare
node module.

## Conformance

`tests/unit/sandbox-roots.test.ts`, 53 cases, in the two halves the spec asked for, plus five cases in
`tests/unit/paths.test.ts` for FR-010 and the rewritten corpus case.

- **The scripted host** is `InMemoryHost` with `canonicalizeIsIdentity: false` and an explicit
  `canonical` map. The table *is* the oracle: every expected verdict is derived from it by hand and
  each case writes its derivation down in a comment (`/link/venue/missing.yaml` → absent → ancestor
  `/link/venue` → `/real/venue` → `/real/venue/missing.yaml`, root `/link/venue` → `/real/venue`,
  prefix `/real/venue/`, contained). A win32 `PathFacility` built from `node:path.win32` runs the same
  two verdicts on `C:\link\venue` with no disk involved, on the precedent `tests/unit/paths.test.ts`
  already set.
- **The node host** builds `real/` and a `link` → `real` symlink itself, per test, so the case is red
  on Linux too. `realpathSync` on the `mkdtemp` result is load-bearing and commented as such: on macOS
  `os.tmpdir()` is `/var/folders/…` and `/var` is a link, so without it both halves would be the
  symlinked case and the comparison would prove nothing.

**Which host the resolve-corpus runner uses, and where the symlink cases therefore live.**
`tests/corpus/resolve-runner.ts` calls `createNodeHost()` over the real fixture directories under
`tests/corpus/cases/`, overriding `process.env.HOME` for a case with a `homeDir`. So the runner's host
*can* follow links — the obstacle is not the host but the fixture: a symlink case there would need a
symlink committed to git, which does not survive every checkout and makes the case's meaning depend on
the checkout rather than on the test. The symlink cases are therefore in
`tests/unit/sandbox-roots.test.ts`, which builds the link at run time. The corpus still carries the
tilde rule (`chain-tilde`), where no link is involved.

### The probe gate

Run against the implementation with expectations derived by hand from the table (or from the
filesystem the test itself builds), and all of them kept as standing cases.

| Class | Input | Result |
| --- | --- | --- |
| non-ASCII | scripted: venue directory `città/` under the link; `/link/città/missing.yaml`, root `/link/città` | ancestor `/link/città` → `/real/città`, remainder `/missing.yaml` → inside → `document-unreachable` |
| non-ASCII | node host: a real `città/` venue under a real symlink, missing file | `document-unreachable` |
| boundary | the root itself absent: root `/link/venue/nowhere`, location `/link/venue/nowhere/missing.yaml` | both judged through `/link/venue` → `/real/venue`; inside → `document-unreachable` |
| boundary | the location **is** the root: `$adopts: .` under root `/link/venue` | canonicalizes to `/real/venue`, equal to the canonical root → inside → `document-unreachable` (the read of a directory fails) |
| boundary | root `/`, location `/elsewhere/missing.yaml` | prefix is `/` (already ends in the separator, v1.4 FR-007) → inside → `document-unreachable` |
| boundary | a host whose `canonicalize` answers `undefined` for everything, including `/` | no ancestor found, lexical path stands on both sides → `document-unreachable`, i.e. v0.2–v1.6 unchanged |
| adversarial | a dangling link inside the root pointing outside it (node host) | judged inside through its ancestor, then unreadable → `document-unreachable`; the window the spec puts out of scope, pinned rather than left implicit |
| adversarial | `/housekeeping/missing.yaml` against root `/house` (scripted **and** node host) | `/house/` is not a prefix of `/housekeeping/missing.yaml` → `sandbox-escape` |
| control | a symlink inside the root whose **real** target is outside it | still `sandbox-escape` — the v0.2 guarantee this milestone must not loosen |

The non-ASCII probe is the one that decided the implementation: taking the remainder as a slice of the
already-resolved string, rather than re-joining segments, is what makes normalization a non-question.
The `città` cases would not have distinguished the two on their own — both pass — but the slice is the
form that cannot be wrong, and is the reason no `basename` was needed (see the findings).

### FR-008's probe on the pre-change code

Run against `main`'s `classifyReferenceLocation` before any edit, with
`paths = { ...posixPaths, homeDirectory: "/home/u" }` and the referrer
`https://example.com/schemas/base.yaml`:

| reference | authority | v1.6 output |
| --- | --- | --- |
| `~/x.yaml` | `config-authored` | `{ kind: "https", url: "https://example.com/home/u/x.yaml" }` |
| `~/x.yaml` | `schema-authored` | `{ kind: "https", url: "https://example.com/schemas/~/x.yaml" }` |

So yes: the user's home directory was expanded and then joined into a URL offered to the transport.
`classifyReferenceLocation` expanded before it looked at the referrer, exactly as the spec suspected.
The schema-authored row is the old authority gate coincidentally doing the right thing for the wrong
reason.

The same probe also reproduced FR-001's bug end to end on the node host before any edit — same venue
content, real directory against a symlink to it:

```
$adopts: ./missing.yaml   real/venue  ->  document-unreachable
$adopts: ./missing.yaml   link/venue  ->  sandbox-escape: Schema-authored reference './missing.yaml'
                                          resolves outside the sandbox root
                                          '/private/var/.../link/venue' (v0.2 FR-021)
```

### Sabotage

Each backed up to the scratchpad first, marked with a `SABOTAGE` comment, watched red, restored;
`grep -rn SABOTAGE src/ tests/` empty before every commit.

| # | Sabotage | Red |
| --- | --- | --- |
| 1 | FR-001: `safeCanonicalize` returns the lexical path again | **7**, and only the symlink cases: the four scripted ones (POSIX `$adopts`, POSIX delegation, win32, `città`) and three node-host ones (absent inside the link, `città` on disk, the dangling link). 2096 passed |
| 2 | FR-004: `some` → `every` | **4**: the two FR-004 admitting cases, FR-006's admitted delegation, and FR-011's `["/nothing-here", "/"]`. 2121 passed |
| 3 | FR-004: first member only | the same **4** |
| 4 | FR-005: accept `[]` | **1**: "throws for the empty list" |
| 5 | FR-007: restore the authority condition | **6**: the three FR-007 expansion cases, FR-008's local-referrer case, the rewritten corpus case, and `hermetic.test.ts`'s run over that corpus |
| 6 | FR-008: drop the remote guard | **2**: the spy transport, which was then offered `https://example.test/home/u/x.yaml`, and the both-authorities classification |

Sabotage 1 is the one that mattered: the requirement is that it turns the symlink cases red *and only
those*, and the run bears that out — 2096 of 2103 passed, every failure in the new file.

FR-010 has no sabotage. The spec's Conformance section lists none, and the assertion is a direct read
of the file it constrains; breaking it is deleting the line it asserts.

## Existing assertions that moved

**Exactly one, and not the one the spec anticipated.**

The spec expected pins on the old `sandbox-escape` message text. There were none — a grep for
"resolves outside the sandbox root" across `tests/`, `docs/`, `specs/`, `README.md` and `meta/` was
empty before the change, so FR-009's rewording moved nothing.

What did move is `tests/corpus/resolve-cases/chain-tilde.json`, whose name was *"T024: a config's
leading `~/` expands to the home directory; a schema's does not"*. Its fixture has
`fakehome/schema-root.yaml` writing `$adopts: ~/parent.yaml` and a directory **literally named `~`**
beside it, holding the document that reference used to reach. It is FR-007's "one bounded change of
behavior" embodied as a conformance case, and it had to change with the law it pins.

It now pins the new rule *and* the migration path in one chain:
`project/config.yaml` → (config `~/`) `fakehome/schema-root.yaml` → (schema `~/`)
`fakehome/parent.yaml` (new, one file) → (`./~/`) `fakehome/~/parent.yaml`. So nothing in the fixture
became unused, the literal-`~` directory is still reached, and the escape hatch FR-007 prescribes is
demonstrated rather than merely described. Hashes were computed with `shasum -a 256` over the fixture
bytes and spans derived by hand from the file contents; the three unchanged fixtures' hashes came out
byte-identical to the ones the case already carried, which is what says the oracle is the right one.

One test-infrastructure change came with it: `tests/corpus/resolve-case.ts`'s `CITES_PATTERN` admitted
only `v(0.2|1.3|1.4|1.6) FR-\d+`, so the case could not cite the requirement that now governs it. The
pattern now admits `1.7`.

## Derived artifacts

`docs/reference.md`: the freeze preamble now counts to v1.7 and names both of this milestone's
corrections beside v1.4's; a v1.7 row in the milestone table; `options.sandboxRoot`'s entry retyped and
rewritten; the `sandbox-escape` row in the diagnostics table now says that a merely absent file is
`document-unreachable`; the §8.4 delegation bullet says "granted sandbox roots"; `Reference.text`'s
comment notes that `~/` expands under either authority for a local document; and three new paragraphs
after the v1.4 correction (granted roots, a schema's `~/`, absent is not outside).

`README.md`: the host-seam paragraph now says roots plural and names the house-schema case; the install
pin and the Status line move to v1.7.

`specs/002-resolver-dag-builder/spec.md`: a one-line forward pointer at **v0.2 FR-022** and at **v0.2
FR-029**, both leaving the original text as history.
`specs/002-resolver-dag-builder/contracts/resolve-api.md`: `sandboxRoot`'s shape and the member-wise
requirement.

`package.json`: `1.6.0` → `1.7.0`, plus the two new `exports` entries.

## Found, recorded rather than smoothed

This section is the milestone's real output. Every item is a place `specs/015-sandbox-roots/spec.md`
or `SPEC.md`'s v1.7 amendment was silent, contradictory or wrong, or a detail I had to invent.

### Where the documents were wrong or silent

1. **"No other existing assertion should need to move — if one does, that is a finding" (spec,
   Conformance). One did, and the spec should have known about it.** `chain-tilde.json` is in this
   repository, its name states the rule FR-007 reverses, and its fixture contains the very
   directory-named-`~` that FR-007's "one bounded change of behavior" is about. The spec anticipated
   only message-text pins — a class with zero members — and did not anticipate the conformance case
   that *is* the changed behaviour. Whoever writes the next amendment to a resolution rule should grep
   `tests/corpus/resolve-cases/` for the rule's name before claiming a clean run.

2. **`CITES_PATTERN` is an undocumented gate on the corpus.** A new milestone cannot add or re-cite a
   resolve-conformance case until that regex in `tests/corpus/resolve-case.ts` is extended. Nothing in
   `spec.md`, in `CLAUDE.md` or in the 012–014 reports mentions it. It is a good guard and it cost ten
   minutes; it should be in the next milestone's checklist rather than rediscovered.

3. **FR-009 asks for a string the code had no way to produce, and the spec did not say how to get
   it.** "The location as resolved (expanded, and canonicalized where FR-001 could)" lives inside
   `safeCanonicalize`, which was private, and `isSandboxEscape` returns a boolean. **Invented:**
   exporting it as `canonicalizeForDiagnostic`, called only on the refusal path, so the message can
   never disagree with the verdict. The alternative — having `isSandboxEscape` return the canonical
   path alongside the verdict — changes a widely-called predicate's shape for the sake of a message,
   and was rejected on that ground.

4. **FR-009 does not say whether the *delegation* refusal changes.** It says "the `sandbox-escape`
   message" and pins "the `v0.2 FR-021` citation", which belongs to the `$schema`/`$adopts` refusal
   alone; the delegation one cites `SPEC.md §8.4, v0.6 FR-022`. **Invented:** the same three additions
   applied to the delegation message, keeping its own citation. Given FR-006 ("there is one sandbox"),
   a refusal that named only one root for delegation and all of them for `$adopts` would be
   indefensible — but it is an inference, and if the intent was to leave the delegation message alone,
   this is where to say so.

5. **FR-005 says every bad shape throws "its error" — v0.2 FR-022's error — but that error's text
   describes a single root.** **Invented:** one message for all eight shapes, keeping the
   `requires 'sandboxRoot'` substring (`tests/unit/load.test.ts:113` matches it by regex) and
   extending it to "a non-empty location, or a non-empty list of them, every member a non-empty
   string", with a `v0.2 FR-022, v1.7 FR-004/FR-005` citation. A caller passing `["/a", 42]` gets the
   same message as one passing nothing, which is the literal reading of "its error" and is arguably
   less helpful than a message naming the bad member. Cheap to change if you want the second form.

6. **FR-001 is silent on how to name the remaining segments, and `PathFacility` has no `basename`.**
   FR-003 forbids adding one, so the walk keeps the resolved string and slices it at the ancestor's
   length. **This works because `dirname`'s answer is always a prefix of its input for an already
   normalized absolute path — and that is not a property `PathFacility` documents.** It holds for
   `node:path.posix`, `node:path.win32` and `src/paths.ts`'s own `posixDirname`, checked by hand on
   the boundary shapes (`/a/b` → `/a`, `/a` → `/`, `C:\a` → `C:\`, and the root being its own parent,
   which is also the loop's termination condition). A host supplying an exotic `dirname` that returns
   a non-prefix would produce a wrong containment verdict rather than an error. **This is a genuine
   gap in §11's `PathFacility` contract that the amendment did not notice**: the seam now has an
   unstated invariant. It is not an implementer's call to add one — flagged for §11 or for
   `PathFacility`'s own doc, whichever you judge right.

7. **FR-008 names `classifyReferenceLocation` and not `resolveReferenceLocation`, which has the
   identical bug.** Both call `expandTilde`. **Invented:** the guard lives in `expandTilde`, which now
   takes the referring location, so both callers are fixed by one line — the same "three callers and
   one fix" posture FR-002 takes for `isWithinSandbox`, applied where the spec did not notice it
   applied.

8. **`SPEC.md` §5.3's worked chain resolves only under a `sandboxRoot` the example cannot show.** The
   amendment's new comment ("it resolves only where the embedder granted a sandbox root that contains
   it") is accurate and discharges issue #2's proposal (d). But §5.3 is presented as a worked example
   of the *language*, and it is now the only one in `SPEC.md` whose success depends on a caller-side
   option no document can express. That may be exactly the point — the whole milestone is that reach
   is the caller's to grant — but it is a change in what a §5.3 example promises, and it is worth
   confirming deliberately rather than by drift.

9. **`SPEC.md` §15's v1.7 entry is less complete than the milestone spec on what `sandboxRoot`
   refuses.** It says "an empty list is refused as a missing root always was" and stops; FR-005 also
   refuses a list with a non-string or empty member. Not a contradiction, but the document that
   governs is the less complete one.

10. **`SPEC.md` §16's v1.7 bullet slightly misdescribes what is exported.** "`posixPaths` is exported
    (`cascata/paths`) for the host that has POSIX rules and a home directory but no filesystem" —
    `posixPaths` itself has `homeDirectory: undefined`; what is exported is the base a host spreads to
    *add* a home directory. `spec.md`'s FR-010 and issue #2 both put it correctly. A wording
    correction, not a semantic one.

11. **"Nearest existing ancestor" is really "nearest ancestor the host answers for".** §15's sentence
    ("canonicalized, with the segments that do not exist appended, none of which can be a link because
    none of them exists") is true of the ordinary case. The walk is driven by whether
    `host.canonicalize` answers, not by whether the directory exists, so a host that declines for some
    other reason — a permissions failure, a host that canonicalizes documents only — makes the walk
    continue past a directory that does exist. The verdict is unaffected (the higher ancestor is
    canonical too, and the standing "canonicalizes nothing" case pins the degenerate end of it), but
    the sentence claims a little more than the code can know.

12. **The probe gate ran after FR-001's conclusion was written down, because the conclusion was
    committed with the spec.** Constitution Principle V wants the probe first. `SPEC.md` §15's entry
    and `spec.md`'s FR-001 both assert the nearest-existing-ancestor conclusion, and both are in
    `3029d76`, one commit before any probe. The probes were run before any *code* and are recorded
    above, but the ordering the principle asks for was not available to me. Not an implementer's to
    fix; recorded because it is the second time a v1.7 document states a conclusion the process wanted
    evidence for first.

13. **FR-011's four clauses do not weigh the same, and the spec presents them as if they did.**
    `/sandboxfoo` against `/sandbox` and `sandboxRoot: "/"` genuinely interact with the list change
    and are worth the cases. A host-located reference and an override's or launching schema's text are
    exempt through `isSandboxEscape`'s authority gate and `hostLocated` flag, neither of which this
    milestone touched — those cases are near-vacuous and are kept only because FR-011 asks for them.

### Details invented, beyond those above

- `toAbsoluteSandboxRoots` replaces `toAbsoluteSandboxRoot`: one function taking either shape, so the
  `string`-is-a-one-element-list rule exists in exactly one place.
- `namedRoots`, and the message wording: *"Schema-authored reference 'X' resolves to 'Y', outside every
  granted sandbox root ('a', 'b') — a caller grants roots through 'sandboxRoot' (v0.2 FR-021)"*. The
  roots are named in the order the caller granted them, absolute (post-resolution), and every one of
  them; a message naming only the first would be the misleading message this milestone replaces.
- The corpus fixture `tests/corpus/cases/chain-tilde/fakehome/parent.yaml`, and the three-hop chain
  described above.
- FR-010's cases live in `tests/unit/paths.test.ts` rather than a new file: it is already the file
  about this module, and story 3's `homePaths` — `{ ...posixPaths, homeDirectory: HOME }` — is the
  consumer's spread in real use rather than a demonstration of it.
- `SpyTransport`, local to the test file: `RecordedTransport` throws on an unmatched request, which
  makes "what URL was the transport offered?" unaskable when the answer is the wrong URL. FR-008's
  sabotage requires exactly that question.
- The scripted host's `canonical` tables, and the decision to leave `canonicalizeIsIdentity` at its
  default (true) for stories 2 and 3, so a verdict there can only have come from the containment rule
  and never from canonicalization.

### Not a finding, but a reader of a CI log will see it

Three wall-clock ratio assertions failed intermittently during this milestone and passed on re-run,
including once on the untouched baseline before any change was made:
`tests/unit/validate-totality.test.ts`'s "doubling the alternatives does not quadruple the work",
`tests/unit/metaschema.test.ts`'s "stays LINEAR on adversarial input", and
`tests/unit/totality.test.ts`'s "many sibling keys". They are load-sensitive, not related to this
work, and are named here so a flake is not mistaken for a regression.

## Complexity Tracking

The design did not want more room than the single-file precedent. One `spec.md` and this report, as
012, 013 and 014 did; no `/speckit-plan`, no `/speckit-tasks`. The whole change is one new predicate
shape, one option type, one guard moved into an existing function, and two `package.json` lines. The
governance question 012 raised — whether every addition needs the seven-file flow — is still open and
still not an implementer's to decide.

## Not done, deliberately

- **Not tagged, not pushed, not merged.** `npm run dist-tag v1.7.0` and the push are Egildo's acts.
  The branch is `015-sandbox-roots`.
- **Issue #2 is neither closed nor commented on.**
- **`SPEC.md` and the constitution are untouched.** Every disagreement found in the v1.7 amendment is
  in the section above rather than in a diff.
- **The window between the check and the read.** Out of scope per the spec, pinned by a standing case
  so that the next reader finds the behaviour asserted rather than inferred.
- **BelType's wrapper forwarding `Host.paths`.** The consumer's own fix, in its own repository.
