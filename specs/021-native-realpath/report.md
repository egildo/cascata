# Report: The Node host answers a path's true spelling (specs/021-native-realpath)

Tests: main 2972 -> 2981 (+9, `tests/unit/node-host-spelling.test.ts`); timing project unchanged (10). `pnpm typecheck`
clean; `pnpm test` clean (no `×`, no `FAIL`). `SPEC.md` untouched, nothing pushed, no version bump.

## Commits

One commit carries the fix and its tests, not the spec's two (red tests, then fix): the standing rule is that a commit is
green. The red phase is recorded below instead, from a run against the unchanged `realpathSync`: 5 of 9 red.

## FR-003: the probe (this Mac, APFS, case-insensitive and normalization-insensitive; Node 25.6.1)

Directory made under a canonical temp base: `café` (composed), `Real-Dir` with a `Sub`, and `link` -> `Real-Dir`.
`<base>` is the canonical temp directory. "Native" is `realpathSync.native`.

| Input | `realpathSync` (JS) | `.native` |
|---|---|---|
| `<base>/café` composed, as created | `café` composed (`e9`) | same |
| `<base>/café` **decomposed** (`65 301`) | `café` **decomposed**, as given | `café` **composed**, as on disk |
| `<base>/link/Sub` (link, right case) | `<base>/Real-Dir/Sub` | same |
| `<base>/LINK/SUB` (link and case wrong) | `<base>/Real-Dir/SUB` (link followed, case kept) | `<base>/Real-Dir/Sub` |
| `<base>/real-dir` | `<base>/real-dir` | `<base>/Real-Dir` |
| `<base>/REAL-DIR/` (trailing slash) | `<base>/REAL-DIR` | `<base>/Real-Dir` |
| `<base>/Real-Dir/nope` (missing leaf) | throws `ENOENT` | throws `ENOENT` |
| `<base>/real-dir/nope` (missing, parent in wrong case) | throws `ENOENT` | throws `ENOENT` |

So: native fixes case **and** Unicode normalization, follows links as before, and throws on a missing path exactly as the
JS call does, so `canonicalize` keeps answering `undefined` (the existing `try/catch`, unchanged) and `safeCanonicalize`'s
nearest-existing-ancestor walk is unaffected. The sandbox suites of v1.4/v1.7 (`sandbox-roots`, `sandbox-root`,
`sandbox-escape`, `delegation-sandbox-confinement`, `host-identity`) stay green.

## Tests

`tests/unit/node-host-spelling.test.ts`, on a real temporary directory. The case-folding and normalization tests are
`skipIf` on a **probe of the directory the file just made** (`existsSync` of the other spelling), never on platform, and
their names state the reason. Hand-written expectations: the true name is `Case-x` (what the test created).

- `canonicalize` of `Case-x`, `case-x`, `CASE-X` (and `CASE-X/ROOT.YAML`) is `<base>/Case-x` (resp. `.../root.yaml`).
- a decomposed `é` is answered composed; a link plus wrong case is followed and truly spelled.
- controls that pass before and after: a link is followed; a missing path is `undefined`; a right-case root contains its
  chain; a root in any case still refuses `Other/` (`sandbox-escape`).
- a `sandboxRoot` of `case-x` and `CASE-X` contains its schema chain; a wrong-case reference is contained by a root
  spelled truly.

Red against `realpathSync`: the five case/normalization tests (one per bullet above that is not a control).

## Sabotage

Back to `realpathSync` (backup to `/tmp`, `SABOTAGE` comment, restored, `diff -r` clean, `grep SABOTAGE` empty): the same five
tests red, and the other four in the file plus `sandbox-roots` and `host-identity` (69 tests together) green. The skip path
(a case-sensitive file system) could not be exercised here; its probe is the same `existsSync` pair, so it would skip, but
I have not seen it skip.

## Where the spec was wrong (unsoftened)

1. **"One document adopted under two spellings is one identity: one identity, one layer" is not a consequence of
   FR-001.** The graph's identity is lexical (`DocumentIdentity.location` is the resolved path as written;
   `src/resolve/location.ts` says canonicalization "is reserved for the sandbox-escape check"), and cycle detection is by
   the same lexical location. `canonicalize` is called only by the sandbox. I measured it on the real disk: a schema
   `selfa.yaml` with `$adopts: ../case-x/selfa.yaml` (itself, spelled differently) **resolves ok with a pedigree of the same
   document twice**, before and after this change, where the same spelling is refused as a cycle. So the host-level
   statement is what FR-001 gives and what I tested (two spellings, one `canonicalize` answer); the end-to-end statement is
   false today and needs a **separate change** (have the graph builder identify a document by `host.canonicalize` of its
   location, falling back to the lexical one). That change would start refusing a document that resolves today -- but a
   self-adoption is a cycle, which v0.2 already refuses, so it reads as a correction under §15's rule; it is the owner's call
   and I have not made it.
2. The spec's plan asks for a red commit then a fix commit; the standing rule is green commits. I made one.
3. FR-002's "one layer" test could therefore not be written red-then-green; I wrote the host-level test in its place.

## What §15 should record

A **correction** (v1.11.x): the Node host's `canonicalize` answers a path's operating-system spelling
(`realpathSync.native`), not the spelling it was given, so two spellings of one file on a case-folding or
normalization-folding file system are one identity and a `sandboxRoot` in the wrong case contains its files. Nothing a
caller could rely on is lost (a wrong-case root refused its own files, a bug); the only change in what is *answered* is the
spelling of a canonical path, which now names the disk's. Add: **graph identity and cycle detection remain lexical**, so a
document reached under two spellings is still two locations to the graph (item 1 above), named as open rather than implied
fixed. Third-party hosts are unaffected; Article VI's contract ("the canonical identity of `location`") already asked for
this.
