# Milestone report: host-resolvable identity, and a sandbox root that contains (013)

**What landed.** `Host` gains one **optional** member, `locate(reference: string): Promise<string | undefined>`. In `walkAdoptsChain`, a reference that `classifyReferenceLocation` calls `unsupported-scheme` is offered to `host.locate` before the refusal is built; a string that comes back is classified once by a new four-line helper (`classifyLocatedDocument` — `https://` or an absolute local path) and becomes the target, and the sandbox check is skipped for that one hop. Everything after the branch is code that already existed. Separately, `isWithinSandbox` now appends a separator only where the root does not already end in one. Two source files, plus one line in `requireHost` naming a malformed `locate` as the programmer error it is.

**Conformance.** Three resolve-conformance cases (`host-identity-launching`, `host-identity-adopts`, `host-identity-unclaimed`) with hashes hand-derived by `shasum -a 256` over fixtures written before any code, and eleven unit tests across `tests/unit/host-identity.test.ts` and `tests/unit/sandbox-root.test.ts`. All written first; the eight that exercise new behaviour were watched go red against `main`, and the three that assert *unchanged* behaviour were green before and after by design, which is what a regression guard is. Full suite: 86 files, **1521** tests, green (1507 at v1.3 + 14). `tsc --noEmit` clean. `grep -rn SABOTAGE src/ tests/` empty.

**Documents.** `SPEC.md` Article VI (§16) gains the law and a clause on the determinism law beside it; §11 gains the sentence that bounds the sandbox consequence; §14 moves the JSON Schema exporter from v1.4 to **v1.5** and extends item 11's prose in the voice it already used for the two prior displacements; §15 gains the entry, addition and correction argued separately. `README.md` gains the header paragraph, the milestone row, a host-seam section with the embedder's actual code, and the correction. `package.json` 1.3.0 → 1.4.0; `dist` rebuilt.

## The design, and what was rejected

The requirement was that a host be able to answer a location in a namespace it owns. Three shapes were considered.

**Overloading `canonicalize`** was the tidiest on paper and needed no new API at all: hand a scheme'd reference to `canonicalize`, and a host that answers has claimed it. It is wrong, and measurably so rather than by taste. `InMemoryHost.canonicalizeIsIdentity` defaults to `true` in this repository's own test double — the obvious implementation for a flat store — so an identity-function `canonicalize` would have claimed **every** scheme, turning the three standing `unsupported-scheme` conformance cases (`data:`, `file:`, `http:`) into local paths without anyone writing a line of policy. A capability that is granted by the most natural implementation is not granted, it is leaked.

**An allowlist option on `resolve()`** (`hostSchemes: ["beltype"]`) splits one fact across two places: the namespace's existence in the call, its contents in the host. And it still leaves the load-bearing question — *what location does `beltype:document` have* — to the host, at which point the allowlist is a gate in front of a gate.

**Making the reference config-authored** would have solved the sandbox half for free by reusing v0.2 FR-020's exemption. It is wrong for a reason worth keeping: `Reference.authority` is a fact about who *wrote* the reference, documented on itself as never inferred from the location's text, and a venue schema's `$adopts` line is written by a schema. The exemption this milestone needs is about who *chose the location*, which is a different fact and now has its own clause.

**What shipped** is that the host locates and the library uses the location. The evidence the seam was cut in the right place is what fell out rather than being built: a located document's own relative `$adopts` resolves against the located document (pinned, and sabotage-tested); a located `https://` URL is fetched, cached and pin-verified by the transport that has existed since v0.2 (pinned); location-based dedup and cycle detection see an ordinary location and need no case for this at all.

## How the sandbox exemption is argued

Not by analogy to "the embedder said so", which would have been loose, but by naming which fact the sandbox is about. §8.4 confines what a **document's own text** can reach, because a schema can come from the web and a path names the whole disk. A host identity is text that names a *namespace*; the location is chosen by the host. So the reference never picked a path, and there is no schema-chosen path to confine — the exemption is not a hole punched in the rule but a case the rule was never about. §16's own capability law finishes it: the library can read only what its host answers, so a namespace grants exactly what the host wrote into it, and a namespace is finite where a path space is not.

Three consequences are stated rather than left implied. **The exemption does not travel**: what the located document writes for itself is ordinary reference text in an ordinary document and is sandbox-checked as usual — pinned by a test that shows a located `/pkg/root.yaml` with `$adopts: ./base.yaml` refused under `sandboxRoot: "/venue"` and admitted under `/`. **§11 needed a qualifying clause**, because it said a remote schema can never trigger a local read outside the sandbox and a remote schema can now name a host identity; the bound, not an exception, is that the host wrote the namespace. **The determinism law needed one sentence**: two hosts may name different documents for one identity, which is the same latitude they already have for one path — they disagree about which documents exist, never about what a document says.

## The two BelType routes, measured

A real package at a `node_modules` path, a real venue, the shipped `createNodeHost`, and `createRequire().resolve`. Actual output:

```
ROUTE A (launching option)  ok= true {"engine":"pagedjs","title":"The Composition of Pages"}
   pedigree: [ '…/node_modules/@beltype/schemas/document.yaml' ]
ROUTE B (venue $adopts)     ok= true {"engine":"cicero","title":"A Document With A Venue"}
   pedigree: [ '…/node_modules/@beltype/schemas/document.yaml',
               '…/venue/beltype.config.yaml' ]
UNCLAIMED SCHEME            ok= false unsupported-scheme
```

Route B is the one that failed twice at v1.3 — first `unsupported-scheme`, then, with a path substituted, `sandbox-escape`. Its `engine: cicero` is the venue's `provide` displacing the root's `pagedjs`, so the cascade is demonstrably running *through* a host-located root and not merely reaching it.

## Sabotage protocol

Backed up to `/tmp` first, one `SABOTAGE`-marked edit at a time, restored from the backup rather than by `git checkout`, `grep -rn SABOTAGE src/ tests/` empty before committing.

| # | The break | What went red — and what stayed green, which is the point |
|---|---|---|
| 1 | `located` forced to `undefined` (the branch disabled) | both new corpus cases and 5 of 7 `host-identity` tests. The no-namespace test and `host-identity-unclaimed` stayed green: they assert v1.3's behaviour and must survive the feature |
| 2 | `hostLocated` forced to `false` (exemption removed) | `host-identity-adopts` and the `$id` test only. `host-identity-launching` stayed green — that route is config-authored and exempt anyway, which is exactly the discrimination FR-003 needs |
| 3 | the v1.3 `root + sep` restored | the `sandboxRoot: "/"` test, and the second half of the located-`$adopts` test. The other three containment tests stayed green |
| 4 | the separator dropped entirely (`startsWith(root)`) | the `/sandboxfoo` test only — **and the pre-existing `sandbox-escape.test.ts` did not catch it**. See "Found" below |
| 5 | `host.locate` called from the delegation refusal | the delegation test only |
| 6 | every reference offered to `locate`, not only refused schemes | the `$id` exactness test and the delegation test |
| 7 | an unclaimed scheme locating to itself instead of falling through | the two FR-004 tests, `host-identity-unclaimed`, the three standing `fail-scheme-*` cases, and `remote-fetch`'s `http://` refusal |
| 8 | `classifyLocatedDocument` always returning `local` | the located-`https://` test only |
| 9 | the recursive walk passing `referringLocation` instead of `location` | the located-`$adopts` base-directory test only |

## Found, recorded rather than smoothed

- **The `/sandboxfoo` boundary had no test.** Sabotage 4 dropped the separator entirely, and `tests/unit/sandbox-escape.test.ts` — the file whose whole subject is confinement — stayed green. The comment in `isWithinSandbox` has named that case since v0.2 and nothing checked it. `tests/unit/sandbox-root.test.ts` now does, which is why the correction's test file carries the half that must *not* change alongside the half that does.
- **`tests/unit/validate-totality.test.ts` is flaky under load.** "doubling the alternatives does not quadruple the work" measures a wall-clock ratio against a ceiling of 8 and returned 12.3 on one full-suite run while the machine was busy, then passed on its own and on every subsequent full run. Nothing to do with this milestone; recorded because a future implementer will otherwise spend twenty minutes on it. The assertion is a real property badly instrumented — a ratio of two timings on a shared machine.
- **The constitution's Principle IV enumerates the host's capabilities and the enumeration is incomplete.** It says the library asks its host for "bytes at a location, and the canonical identity of a location", which already omitted `cacheRead`/`cacheWrite` before this milestone and now also omits `locate`. Flagged, **not fixed**: CLAUDE.md says an implementer does not amend governance, and the amendment procedure says a constitution change is reviewed on its own terms rather than bundled into a feature. The precedent (cache storage, unamended since v0.7) suggests the list is illustrative, but that reading should be written down by whoever owns the document rather than assumed by whoever needed it.
- **`Host` is exported from the package root; a host implementer needs nothing new.** The v1.2 correction that exported `Host`/`HostReadResult` is what makes the README's `locate` example writable at all. No new type is exported by this milestone.
- **The corpus format gained `identities`, and the runner gained a wrapper.** `tests/corpus/resolve-runner.ts` builds each case's host as `createNodeHost()` spread with a `locate` backed by that case's map. This is the second milestone running to widen the resolve-case format (v1.3 widened `cites`, v1.4 adds a field), which continues to say the same thing: the resolve corpus was designed at v0.2 and nothing added to it for nine milestones.
- **One limit, named rather than closed.** A located schema whose own relative `$adopts` points at a sibling *outside* the sandbox is refused. That is correct under FR-003 as written — the exemption is for the located hop, not for a subtree — but it means a multi-file root schema shipped inside a package needs either `sandboxRoot` wide enough to contain it, or every rung named as its own identity. BelType's current root is one file, so nothing is blocked; if that changes, the question is "does the exemption travel", and it deserves its own round rather than a quiet widening.
- **`sandboxRoot: "/"` is now genuinely the switch-the-sandbox-off value**, and the §15 entry says so. It is not what BelType should use — the addition is what solves BelType's case, and the correction is a defect found beside it.

## Not done, deliberately

- **Not merged to `main`, not pushed, not published.** The work is committed on `013-host-resolvable-identity`; merging and publishing are Egildo's acts, as at 012. The package-name question 012 raised (`@egildo/cascata` for GitHub Packages, or keep `cascata`) is still open and still not this milestone's to decide.
- **Delegation is untouched.** A delegated `beltype:fragment` is still `unsupported-scheme`, pinned by a test. §8.4 gives a delegated target its own user opt-in, and widening it needs a security paragraph this milestone has no consumer for.
- **No default namespace.** Cascata owns no scheme. A host that implements nothing is v1.3 exactly.

## Questions for Egildo

1. **The version.** This shipped as **1.4.0** and moved the exporter to v1.5, following the precedent §15 already records twice in its own words. The addition alone would justify it; the correction rides along in the same release, which is why the §15 entry argues the two separately.
2. **Whether the located-hop exemption should travel** to a located document's own relative references (the named limit above). Not needed today; the answer changes what a package-shipped multi-file schema costs.
3. **Whether `locate` should be reachable by delegation**, with its own opt-in flag beside `allowRemoteDelegation`. There is no consumer, so the answer here is "not yet" rather than "no".
