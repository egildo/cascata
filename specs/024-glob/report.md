# Milestone 024 -- `glob`: implementer's report

Implementer: Sonnet 5.5. Spec: `specs/024-glob/spec.md` (FR-001 to FR-023). `SPEC.md`, `CLAUDE.md` and the constitution were
not edited. Ships as v1.14 by the spec; **`package.json`'s `version` is untouched (1.13.0)**; its `exports` gained
`./host/memory` (and `./host/memory.js`, as the other entries have a `.js` twin).

## Commits (all on `main`, none pushed, no amend/rebase; every message ends with the Sonnet 5.5 trailer)

| Commit | What |
|---|---|
| `9530797` | Part A -- the type: grammar, `glob` in the built-in table, the message, `globBase()`, the generator row, corpus cases G001-G005 (FR-001 to FR-008, FR-020) |
| `ed98305` | Part B -- `Host.list`, the Node implementation, the memory host, the shared list suite, the `readdir`/`opendir` sweep (FR-009 to FR-011, FR-021) |
| `e203f82` | Part C -- `expand()`, `src/expand/`, the four codes, the layering rules for the new stage (FR-012 to FR-019, FR-022) |
| `a77827c` | Witnesses the sabotage found missing, plus `docs/reference.md` for v1.14 (FR-023) |
| `f820102` | `specs/024-glob/report.md` and `specs/HANDOFF.md` |
| `a97b04a` | Revision: FR-024 to FR-027 (code and cases) |
| (the next) | Revision: sabotage witnesses, `docs/reference.md`, this section, `HANDOFF.md` |

The probe gate (FR-021) was run on the real disk before Part B was written (a scratch script under the session scratchpad; not
committed). Its answers are below and `host-list.test.ts` / `expand-disk.test.ts` pin them.

## What was built, per FR

- **FR-001** `glob` joins `BUILTIN_TYPE_NAMES` (`src/validate/typeexpr.ts`), `matchesBuiltinLeaf` (`check.ts`), `REFINES` in
  `accumulate.ts` (so `string ∩ glob` is `glob` and `path | glob` narrows by `accept: [glob]`). `resource` is not touched.
- **FR-002** `src/validate/glob.ts`: `checkGlobPattern(pattern, counter?)`. One loop over code points, a run of `*` tracked by
  start and length, refusals reported at the first offending offset (code points from 0). Names: `[ ] { } \` ("character
  classes", "brace alternation", "escapes"), a leading `!`, the empty pattern, an empty segment, a trailing `/`, a run of `*`
  that is not exactly a whole `**`, `..` after a wildcard segment.
- **FR-003** the `GlobStepCounter` (`{ steps }`), one step per code point. `glob-grammar.test.ts` counts: `*` x 10,000,
  `**/` x 5,000 (accepted with a name, refused as a trailing slash without), `*/` x 5,000, 8 MiB of `a`, a late refusal.
- **FR-004** no new code. `describeActual` (in `check.ts`) now says, when the one expected alternative is exactly `glob` and the
  value is a string outside the grammar: `expected glob, got the pattern "[ab].md", which is not a glob: '[' is not part of the
  glob grammar (...) at offset 0 -- constraint from ...`. The existing `ViolationReason` carried it unchanged (I put the
  explanation in `actualDescription`); see Ambiguities 9 for where it does not reach.
- **FR-005** checking reads no host: `glob-type.test.ts` loads `../../outside/*.md`, `/etc/*.conf` and a pattern naming nothing,
  and asserts the host's reads are exactly the two documents.
- **FR-006** `emit.ts` emits `string`; the soundness oracle covers `glob` (G001, T052) and `glob[]` (G004) as positive cases
  and G005 as a negative; G002/G003 are two more entries in the oracle's `INEXPRESSIBLE` table (the `url`/`path` family).
- **FR-007** `globBase(configuration, pointer)` (`src/validate/globbase.ts`, exported from the root): `{ kind: "glob", pattern,
  literalPrefix, directory, otherDirectory?, span } | { kind: "not-a-glob" } | { kind: "unknown-pointer" }`. The lexical
  resolution `resource()` had inline is now `locateFromDocument` in `resource.ts`, used by both.
- **FR-008** unchanged mechanisms; witnessed in `expand.test.ts` (an appended `glob[]`: each match's span names its own
  layer, and `why()` on the list names the same two layers and lines).
- **FR-009** `HostListEntry`, `HostListResult`, `Host.list?` (`src/resolve/host.ts`, exported from the root); `resolve()`
  throws early if a given `list` is not a function, as it does for `locate`.
- **FR-010** `createNodeHost().list`: `readdirSync(withFileTypes)`, then `statSync` for a link; any failure of `stat` is `other`.
  `layering.test.ts` gains the `readdir`/`opendir` sweep (comments stripped; the exemption must itself match).
- **FR-011** `src/host/memory.ts`, `createMemoryHost({ files, links? })`. Kept beside `InMemoryHost` (the test double is not
  built on it: it records every call it receives and takes `Map`s, and 26 test files import it).
- **FR-012** `expand(configuration, { host, sandboxRoot, limits? })` in `src/expand/expand.ts`; the values come from
  `src/expand/positions.ts`, which walks the merged tree beside the accumulated demand (named types, unions, `items`,
  `values`). **Roots: the configuration does not record the roots it was resolved with** (`MergedConfiguration` has no such
  field), so `sandboxRoot` is a required option, validated as `resolve()` validates it.
- **FR-013** the walk: best-first over routes; literal after the prefix found in the listing by exact name; `*`/`?` by a
  code-point matcher (`matchesGlobSegment`, greedy with one backtrack point); `**` zero or more directories; files only.
  Every directory is judged by its physical path before it is listed; it is *entered* once per (physical path, pattern
  position) and *listed* (asked of the host) once per `expand()` call.
- **FR-014** `matchesGlobSegment` refuses a name starting with `.` unless the segment starts with a literal `.`; `**` skips
  dot names and dot directories.
- **FR-015** exact code-point comparison; no normalization or folding anywhere (tests: composed vs decomposed, `Readme.md`).
- **FR-016** `{ location, physical?, span }`; dedup by physical path keeping the smaller `location` by `compareByCodePoint`;
  the list sorted the same way. The route order is the part with machinery: see Ambiguities 1.
- **FR-017** directories and returned files are judged through `isWithinSandbox(PhysicalPaths, ...)`; the message names the
  logical path with the physical beside it (`namedDocument`) and the roots. A whole value is refused, others still expand.
- **FR-018** `GLOB_EXPANSION_CODES` (`host-cannot-list`, `directory-unlistable`, `glob-in-remote-document`,
  `glob-limit-exceeded`) in `codes.ts`. Positioned at the value, `pointer` set, `level: "error"`.
- **FR-019** `expand.test.ts` loads and validates with a host that has no `list`, and then `expand()` refuses each value.
- **FR-020 to FR-022** the cases: `glob-grammar.test.ts` (50), corpus G001-G005, `host-list.test.ts` (11, one suite over both
  hosts), `expand.test.ts` (59, memory host), `expand-disk.test.ts` (4, the Node host on a temporary directory).
- **FR-023** below.

## Probe gate (FR-021)

Run on macOS 26.6.2, **APFS** (`diskutil info /`), Node 25.6.1, a directory under `os.tmpdir()` (itself behind the `/var` link).
`readdirSync(dir, { withFileTypes: true })`, then `statSync` where an entry was a link:

| Question | Answer |
|---|---|
| A name stored composed (`café.md`, U+00E9) | listed as stored: `63 61 66 e9 2e 6d 64`. `existsSync` through the decomposed spelling: **true** (the OS finds it) |
| A name stored decomposed (`cafe` U+0301 `.md`) | listed as stored: `63 61 66 65 301 ...`. Through the composed spelling: true |
| Writing the second spelling into a directory holding the first | no error and **no second entry**: one name, the first spelling stored. `realpathSync.native` of the other spelling answers the *stored* one |
| A link to a file | `Dirent`: `isSymbolicLink()` true, `isFile()` false. `stat` -> file |
| A link to a directory | `isSymbolicLink()` true, `isDirectory()` false. `stat` -> directory. `readdir` through it lists the target |
| A dangling link | `stat` throws `ENOENT` -> `other` |
| A loop of links (`a -> b -> a`) | `stat` and `readdir` throw `ELOOP` -> `other` / refusal |
| A directory cycle (`dir/up -> parent`) | `realpath` of `adir/up/adir/up` equals `realpath` of the parent: `canonicalize` resolves the cycle to the same physical path, which is what ends it |
| A dotfile, a dot directory | listed like any name (`.hidden` a file, `.git` a directory) |
| An unreadable directory (mode 000) | `readdir` throws `EACCES: permission denied, scandir '<path>'` -> `{ ok: false, reason }` |
| `readdir` of a file / of a missing path | `ENOTDIR` / `ENOENT` -> `{ ok: false }` |
| The order of the entries | alphabetical on this volume, which is a platform fact: nothing relies on it; determinism is witnessed with a host that reverses its answers |

**What depends on APFS:** normalization-insensitive, normalization-*preserving* names. On ext4 and most Linux file systems the
composed and decomposed spellings are two files; on HFS+ every name is stored decomposed (so a composed name would list back
decomposed). Case-insensitivity (the default APFS volume) was not probed: nothing here folds case. The sorted listing order
and the `EACCES` text are also platform facts. **What does not:** the shape of `Dirent` for links, `stat`'s errors for a
dangling link and a loop, `readdir`'s for a file and a missing path.

**The consequence the probe forced (Ambiguities 2):** with exact matching, `cafe` + U+0301 in a pattern does not find a name
stored composed even though the OS opens it, *except* in the literal prefix, which is joined into the anchored directory and
resolved by the OS.

## Sabotage (FR-023)

Method per `CLAUDE.md`: every source file backed up to `/tmp/cascata-024/backup/` before each run, the edit marked
`/* SABOTAGE */`, the 12 test files that could see it run, the red tests recorded, the file restored and compared
byte-for-byte, `grep -rn SABOTAGE src/ tests/` empty at the end (and before every commit). The driver is
`/tmp/cascata-024/sab.py` (a JSON list of file, old, new). 55 mutants; **three survived the first run** (S23, S36, S39), which
found three real gaps; each got a case and was rerun red (last column). S16 (the physical-revisit check) was run on the two
`expand` files only, because without it a link cycle does not terminate.

| # | Rule broken | FR | Red | Where (tests) |
|---|---|---|---|---|
| S01 | FR-002 refusals as a group | FR-002/FR-004/FR-020 | 39 | validate-corpus (2), expand (2), glob-base (1), glob-grammar (30), glob-type (4) |
| S02 | FR-002 empty pattern | FR-002 | 1 | glob-grammar (1) |
| S03 | FR-002 ** only as a whole segment | FR-002 | 8 | validate-corpus (1), glob-grammar (6), glob-type (1) |
| S04 | FR-002 [ ] { } \ refused by name | FR-002 | 15 | validate-corpus (1), expand (2), glob-base (1), glob-grammar (8), glob-type (3) |
| S05 | FR-002 leading ! | FR-002 | 1 | glob-grammar (1) |
| S06 | FR-002 empty segment | FR-002 | 2 | glob-grammar (2) |
| S07 | FR-002 trailing slash | FR-002 | 3 | glob-grammar (3) |
| S08 | FR-002 .. after a wildcard, alone | FR-002/FR-005 | 4 | glob-grammar (4) |
| S09 | FR-003 linear: a second pass over every code point | FR-003 | 8 | glob-grammar (8) |
| S10 | FR-004 the message names the offence | FR-004 | 2 | glob-type (2) |
| S11 | FR-001 the type checks the grammar at all | FR-001/FR-004 | 6 | validate-corpus (2), glob-type (4) |
| S12 | FR-001 string ∩ glob is glob (REFINES) | FR-001 | 1 | glob-type (1) |
| S13 | FR-006 emit table | FR-006 | 5 | generate-oracle (2), glob-type (3) |
| S14 | FR-007 literal prefix cut one segment late | FR-007 | 49 | expand-disk (3), expand (34), glob-base (12) |
| S15 | FR-007 base follows the physical rule in a file (v1.13) | FR-007 | 2 | expand-disk (1), glob-base (1) |
| S16 | FR-013 physical revisit check removed | FR-013 | 2 | expand-disk (1), expand (1) |
| S17 | FR-013 each directory listed once (answers not kept) | FR-013 | 2 | expand (2) |
| S18 | FR-014 a wildcard may match a leading dot | FR-014 | 10 | expand-disk (1), expand (9) |
| S19 | FR-014 ** descends into dot directories and returns dot files | FR-014 | 6 | expand-disk (1), expand (5) |
| S20 | FR-015 names compared with Unicode normalization | FR-015 | 2 | expand-disk (1), expand (1) |
| S21 | FR-015 wildcard matching folds case | FR-015 | 1 | expand (1) |
| S22 | FR-016 sort is UTF-16, not code point | FR-016 | 1 | expand (1) |
| S23 | FR-016 two routes: keep the first, not the smaller | FR-016 | 0 | - -- **survived the first run (0 red)**; after the case added for it: 1 red in expand |
| S24 | FR-016 deduplicate by physical path (key by logical) | FR-016 | 5 | expand-disk (1), expand (4) |
| S25 | FR-016 route order: directories compared without the trailing separator | FR-016 | 1 | expand (1) |
| S26 | FR-016 the physical path is reported only when it differs | FR-016 | 1 | expand (1) |
| S27 | FR-017 directories are not judged by the sandbox | FR-017 | 3 | expand (3) |
| S28 | FR-017 files are not judged by the sandbox | FR-017 | 2 | expand-disk (1), expand (1) |
| S29 | FR-017 the message names the physical path beside the logical | FR-017 | 3 | expand-disk (1), expand (2) |
| S30 | FR-018 host-cannot-list | FR-018 | 1 | expand (1) |
| S31 | FR-018 directory-unlistable | FR-018 | 3 | expand-disk (1), expand (2) |
| S32 | FR-018 glob-in-remote-document | FR-018 | 1 | expand (1) |
| S33 | FR-018 glob-limit-exceeded | FR-018 | 2 | expand (2) |
| S34 | FR-018 the cap is exact (> becomes >=) | FR-018 | 2 | expand (2) |
| S35 | FR-018 the cap is charged per value, not once per call | FR-018 | 1 | expand (1) |
| S36 | FR-012 positions: array depth is ignored (glob[] admitted as glob) | FR-012 | 0 | - -- **survived the first run (0 red)**; after the case added for it: 1 red in expand |
| S37 | FR-012 positions: sequence items are not lowered | FR-012 | 53 | expand-disk (4), expand (49) |
| S38 | FR-012 positions: named types are not entered | FR-012 | 1 | expand (1) |
| S39 | FR-012 positions: a union admits only its first alternative | FR-012 | 0 | - -- **survived the first run (0 red)**; after the case added for it: 1 red in expand |
| S40 | FR-012 positions: a value outside the grammar is still expanded | FR-012 | 2 | expand (2) |
| S41 | FR-012 positions: mapping `values` apply to undeclared keys | FR-012 | 1 | expand (1) |
| S43 | FR-010 the Node host does not stat a link (links are `other`) | FR-010/FR-009 | 3 | expand-disk (2), host-list (1) |
| S44 | FR-011 the memory host does not follow links in canonicalize | FR-011 | 10 | expand (7), host-list (2), host-memory (1) |
| S45 | FR-011 the memory host lists a link as a file | FR-011 | 15 | expand (14), host-list (1) |
| S46 | FR-010 layering: another module calls readdir | FR-010 | 1 | layering (1) |
| S47 | layering: a stage imports expand | FR-012/layering | 1 | layering (1) |
| S48 | layering: expand imports a shipped host | FR-012/layering | 1 | layering (1) |
| S49 | FR-013 a `.` segment after a wildcard is the directory itself | FR-013 | 1 | expand (1) |
| S50 | FR-018 the default cap is 100,000 | FR-018 | 1 | expand (1) |
| S51 | FR-012 sandboxRoot is required | FR-012 | 1 | expand (1) |
| S52 | FR-011 the memory host ends a link loop | FR-011 | hang | - (hangs: killed at 60 s) |
| S53 | FR-013 a wildcard segment is matched as a literal | FR-013 | 31 | expand-disk (2), expand (29) |
| S54 | FR-013 a trailing ** also returns files of non-final positions | FR-013 | 11 | expand-disk (1), expand (10) |
| S55 | FR-016 the entries of a directory are walked in host order | FR-016 | 1 | expand (1) |
| S56 | FR-013 only files are returned (a directory may match) | FR-013 | 3 | expand (3) |

The "FR-002 as a group" (S01) and "`..` after a wildcard alone" (S08) rows are the two the spec names; S02-S07 are each
refusal alone. S16 and S17 are the two halves of FR-013 (the revisit check ends cycles; the answers are kept so each directory is
asked of the host once). S52 hangs on purpose: the memory host's loop guard is a synchronous loop, so the "red" is a
60-second kill, not a failed assertion; the loop test (`host-memory`, `host-list`) is what the mutant starves of an answer.

## Tests

| | Main suite | Timing suite |
|---|---|---|
| Before (`56bbbe1`) | 114 files / **3,294** tests | 8 files / 14 tests |
| After | 121 files / **3,650** tests | 8 files / 14 tests |

+7 files: `glob-grammar` 50, `glob-type` 10, `glob-base` 18, `host-list` 11, `host-memory` 9, `expand` 59, `expand-disk` 4
(= 161). `layering.test.ts` 685 -> 875 (+190: per-file sweeps for the five new modules and the new rules). `validate-corpus`
105 -> 110 (G001-G005). `pnpm typecheck` and `pnpm test` (main, then the serial timing suite) are green at `a77827c`; the
timing suite ran at a load average of 30 to 50 (another process) and was green. No timing test was added: work is counted
(`GlobStepCounter`, `list` calls, the entry cap).

The new files run against the `56bbbe1` source (a worktree, tests copied in): all 8 files red, 35 tests failing and 4 suites
unable to import (`glob-grammar`, `host-list`, `host-memory`, `expand`); the 107 that passed there are almost all the existing
`validate-corpus` cases that ran in the same file, plus a couple of new cases that do not need the new code. **I did not watch the grammar cases red before the validator existed**:
I wrote the test file, then the validator in the next step, and the first run was green. The cases were derived by hand before,
and the sabotage table above is the evidence that they bite (S01-S09: 1 to 39 red each).

## Changes to existing tests (and why)

1. `tests/corpus/validate-cases/T052-...json` (and its fixture directory `glob-is-unknown` -> `glob-returned`): asserted
   `glob` is an `unknown-type-name`. v1.14 reverses that on purpose, and the reversal is named in SPEC.md §15. The same schema
   and value now load; renamed, `cites` is `v1.14 FR-001`. Nothing was relaxed: the case now asserts the opposite fact.
2. `tests/unit/typeexpr.test.ts`: "`glob` does not resolve" -> "`glob` resolves again; `globs` does not". Same reason.
3. `tests/unit/generate-oracle.test.ts`: counts 104 -> 109 descriptors, 38 -> 41 positives, 22 -> 25 negatives,
   15 -> 16 that fail to typecheck; two entries (G002, G003) added to `INEXPRESSIBLE`, with their reasons; a comment
   updated. The oracle's pinned counts are asserted exactly, so adding corpus cases moves them. T052 moved from "listed" to a
   positive.
4. `tests/corpus/validate-case.ts`: `CITES_PATTERN` admits `v1.14`. (No other loader got a v1.14 case.)
5. `tests/unit/layering.test.ts`: only additions (`src/expand` in the adapter list; the downstream and host-import rules; the
   `readdir` sweep). No assertion weakened.

`src/validate/resource.ts` was refactored (the lexical resolution extracted as `locateFromDocument`): every `resource` case,
including v1.13's, is untouched and green.

## Ambiguities

Every place the spec or `SPEC.md` was silent, contradictory or wrong, and every detail I invented, unsoftened.

1. **FR-013 contradicts FR-016, or can be read to.** FR-013: "a directory already listed under the same physical path is not
   listed again, which ends link cycles." FR-016: "two routes to one physical file are one match, named by the smaller logical
   path." With one global visited set per physical directory, a directory reachable by two routes (`a/` and a link `a-b -> a`)
   is entered by whichever the walk meets first, so the match is named by the *traversal order*, not by the smaller path --
   and for a cycle there is no smallest path at all (`X/z` vs `X/loop/z` vs `X/loop/loop/z`: each is smaller than the last).
   **What I built:** a directory is *entered* once per (physical path, pattern position) and *asked of the host* once per
   call; the walk is a best-first search over routes, smallest first, with each directory compared as `path + "/"` (so `a-b/`
   precedes `a/`, 0x2d < 0x2f, exactly as the paths below them compare), so the first route to reach a state is the smallest
   one and the file is named by it; a file reached again keeps the smaller. This is a heap and a comparison trick the spec
   did not ask for. The cost is that "named by the smaller logical path" is operational ("among the routes the walk takes"),
   not a property of all routes. A test (`a`, `a-b`) pins the case where the naive order is wrong; S25 and S23 prove the
   comparison and the keep-smaller rule are load-bearing.
2. **RESOLVED by the owner (FR-024; see "Revision after the coordinator's review").** *As first reported:* FR-013 ("a literal segment is a direct child") vs FR-015 (exact matching against names as listed) vs SPEC.md §7.**
   I read a literal segment *after the literal prefix* as "found in the listing by its exact name", so the result does not
   depend on how the disk resolves names. The literal **prefix** is not matched at all: it is joined into the anchored
   directory (FR-007) and the OS or host resolves it. So on APFS `café/x.md` (composed) lists a directory stored decomposed
   (the OS is tolerant) while `*/café.md` and the wildcard-free `café.md` do not find a decomposed-stored file. The probe
   shows this is real. SPEC.md §7 says names are compared "by code point as the host lists them"; that is true of every
   segment but the prefix. Not fixed: a stricter reading would list every ancestor of the prefix.
3. **RESOLVED by the owner (FR-025; see the Revision).** *As first reported:* FR-012: "if the configuration already records the roots it was resolved with, those are the default -- report which."
   It does not.** `MergedConfiguration` has no field for them; `resolve()` throws them away. I did not add one (it would have
   touched `ResolveResult`, `MergeInput`, `fold` and every `toEqual` on an ok result). `sandboxRoot` is required on `expand()`
   and a missing or empty one throws, in `resolve()`'s own words. SPEC.md's Article VI says `expand()` "takes a loaded
   configuration" and is silent on where the roots come from; for a caller who loaded with roots `R` the safe habit is to pass
   `R`, and nothing checks that they do.
4. **The result shape is mine** (the spec says "returns ... that value's matches or its diagnostics"): `{ expansions, diagnostics
   }`, each expansion `{ ok, pointer, pattern, span, matches | diagnostics }`; a match `{ location, physical?, span }`; no
   overall `ok`, because one value failing does not fail the call. `physical` is *absent*, not `undefined`, when equal (as
   `Origin.physical`). `globBase`'s name was "tentative"; I kept it, and named the second field `otherDirectory` (the spec said
   "`otherLocation` beside it").
5. **Module placement and layering.** `src/expand/` is a new top-level directory (`expand.ts` the stage, `positions.ts` the
   values). It imports `src/generate/accumulate.ts` (the accumulated demand lives there; `expand` is downstream of it),
   `src/validate/glob*.ts`, `src/resolve/location.ts` (`PhysicalPaths`, `isWithinSandbox`, `namedDocument`) and `src/merge/`
   types. Rules added to `tests/unit/layering.test.ts`: `src/expand` joins the format-blindness list; **no module of `model`,
   `diagnostics`, `resolve`, `graph`, `merge`, `validate`, `project`, `generate`, `adapters` or `host` may import `src/expand/`**
   (only the package root wires it in); `src/expand` imports nothing under `src/host/` (it takes the `Host` interface);
   `readdir`/`opendir` calls are the Node host's alone. `expand` *does* import `resolve/`, unlike `graph/ merge/ validate/
   project/ generate/`; I added no rule against it. `globBase` lives in `src/validate/` beside `resource()`, so validate gained
   a module that is not a check. **`CLAUDE.md`'s non-negotiables list the layering rules and does not mention `src/expand/`** --
   a stale line in a governance file; I did not edit it.
6. **The union rule (FR-012).** Implemented as decided: every value at a position that admits `glob` is expanded. Details I
   decided: a string that fails the grammar (`[x]` in a `path | glob` list, or in a configuration nobody validated) is *not
   expanded and not reported* -- it is not a pattern; a `url | glob` position expands `mailto:x` as a one-file pattern (it
   passes the grammar); a `glob[]` position does not expand a *scalar* sitting there (unvalidated config). No case made the
   union rule look wrong, but it expands path-looking strings such as `docs/readme.md` as patterns, which is what the
   coordinator chose.
7. **Positions come from the accumulated demand, with its limits.** A position that names a type *and* declares keys of its
   own gets the body inlined (the tree already does this). The named-type chase is cycle-guarded by declaration set. A
   `provide`d value is a node of the merged tree like any other, so a schema's own `provide: ['assets/*.css']` is expanded,
   anchored at the schema's directory (a test pins it). `accumulate()` is recomputed on every `expand()` call.
8. **Grammar details I fixed where FR-002 was silent.** A `.` segment is an ordinary literal in the grammar and a no-op in the
   walk (`./a.md`, `*/./x` work; a pattern ending in `.` names a directory and matches nothing). `/` alone is a trailing-slash
   refusal, at offset 0; `//a` is an empty segment at 1. `!` is refused only as the *very first* character, so `/!x` is
   accepted. `...` is a name. `a/..` (a trailing `..` with no wildcard) is accepted and matches nothing; `**/..` and
   `*/x/..` are refused. A run of three or more stars is refused the same way as `a**`, at the run's start. Offsets are
   0-based code points; the empty pattern is refused at 0. "Refused by name" for the empty pattern, empty segment and trailing
   slash is by *rule* (there is no character to name).
9. **FR-004's message reaches only the single-alternative case.** The existing shape (`expectedDescription` / `actualDescription`
   strings) carried it, but a union (`path | glob`) or a named type's `accept` list produces the generic "expected path | glob,
   got a string scalar" because that path has no per-alternative attribution (v0.5 research.md). Reporting "no new code, precise
   message" is true for `type: glob` and `type: glob[]`, directly or through a named type, and false for a union.
10. **RESOLVED by the owner (FR-026; see the Revision).** *As first reported:* Missing directories are refusals. FR-018: `directory-unlistable` is "the host answered `ok: false` for a directory the
    walk needed". A literal prefix naming a directory that does not exist (`content/**/*.md` with no `content`) is therefore
    `directory-unlistable`, not an empty list, although the spec also says an empty match is an empty list. The two
    statements do not meet; I took the first literally. The cost: an optional directory is a refusal the author cannot
    silence. The *file* case (`sub/nope.txt` with `sub/` present) is an empty list, as FR-012 says.
11. **Order of the refusals.** A pattern from a remote document is `glob-in-remote-document` even when the host also has no
    `list` (the answer would not change with a better host); the host check comes second. A value's first refusal in route
    order wins; the files of a directory are tried in code-point order of name, so which of two escaping files is named does
    not depend on the host (tested).
12. **RESOLVED by the coordinator (FR-027; see the Revision).** *As first reported:* The cap. "The cap counts entries listed, every name a `list` answer returns" (spec): a value's walk is
    charged for a listing the first time *it* uses it. The host answer is cached for the whole `expand()` call, so a second
    value that uses the same directory is charged for it too (the cap is per value, tested); the test is `visited > limit`,
    so exactly the cap is fine. `limits` is validated (non-negative integer, else a programmer-error throw). The cap does **not** bound
    the work of matching: directories entered x pattern positions, where a pattern of very many `**` segments over a large
    tree is unbounded by it. I deleted a collapse of consecutive `**` that I could not witness (nothing observable differed);
    a pattern like `**/` x 5,000 over a big tree is slow. A guard I did not build, named here so it is not mistaken for one.
13. **A dot-prefixed name and the first character.** `.*` matches `.hidden.md` (the first character is a literal dot, the star
    takes the rest); `*.md` does not match `.md`; `?hidden.md` does not match `.hidden.md`. FR-014 says wildcards "never match
    a name whose first character is `.`", which I implemented as "the segment must itself begin with a literal `.`".
14. **`**` as the last segment** returns every non-dot file at any depth below (`a/**` does not return `a`); `**` before other
    segments is zero or more directories.
15. **The memory host's model.** Locations are POSIX resolved against `/`; `files` is a `Record` of string-or-bytes (the spec
    did not say; Provenance's takes a `Record` too); `links` targets may be relative to the link's directory; **there are no
    empty directories** (a directory exists when something is in it); a link's own location must not sit below another link;
    forty hops end a chain ("a loop answers like a missing target"); `cacheRead` always finds nothing and `cacheWrite` keeps
    nothing ("no cache" said as discard, not as throw -- the Node host throws without a `cacheDir`); `list` order is the order
    of `files` then `links`. A memory host cannot model a case-folding disk or a normalizing one.
16. **`Host.list` is passed the logical location of the first route to a physical directory.** The answer is cached by
    physical path for the call, so a second route to the same directory does not call `list` again. A host whose `list` of a
    path differs from its `list` of the same directory by another route would be answered once, by the first.
17. **`expand()` asks `canonicalize` through `PhysicalPaths`**, so a directory's ancestors and a file's are memoized like
    resolution's, but a host whose `canonicalize` answers differently across calls is not handled. The `list` suite for the
    Node host cannot test a platform's other file systems (HFS+, ext4); the probe notes which answers are APFS's.
18. **`resource()` on a glob value** answers `{ kind: "path", ... }`, since a pattern is a path-shaped string (and `*.md` has
    no space): it is a query that knows no types. Unchanged; noted because it will surprise someone who calls it on a `glob`.
19. **FR-020's "a pattern at the size cap"** is tested on the function (8 MiB of `a`), not through a document: a document at the
    cap holds a pattern of a few bytes less, and the loader's own cap test is another file's.
20. **SPEC.md vs the code, where they differ**: (a) §15's "a directory is never listed twice under one physical path" -- true of
    host calls, not of entries (one directory is entered at several pattern positions, each reading the cached answer);
    (b) §7's "compares names by code point as the host lists them" -- not the literal prefix (item 2); (c) nothing else
    found. The constitution and `CLAUDE.md` were not read for further drift beyond item 5.
21. **No corpus kind exists for expansion** (the corpus loaders judge a load, a merge, a validation, a write). The FR-022 cases
    are unit tests, as `resource()`'s are; the type cases (grammar, mismatch) are corpus cases G001-G005 plus the unit table.
22. **Things I noticed and did not touch.** `README.md`'s status paragraph and the older `specs/*/contracts/` are the v1.13
    leftovers HANDOFF already pins. `docs/reference.md`'s opening paragraphs still say "v1.12.1" and stop at v1.11 in their
    prose (the table is current); I added only the v1.14 row, the section and the dependency-policy sentence.

## Revision after the coordinator's review (FR-024 to FR-027, 2026-10-12)

The owner ruled on ambiguities 2, 3 and 10 and the coordinator on 12; they are `spec.md` Part B' and `SPEC.md` §7/§15. Cases first:
I wrote `expand-revision.test.ts` and the changes to `expand.test.ts` / `expand-helpers.ts` before the code and watched **14 tests
red** on the first run (once the code was in, two tests in `expand-disk.test.ts`, which the rulings invert, and the sixty-`**` case, which needed the
faster frontier, were red; see "Changes"), then wrote the code. The earlier "I did not watch it red" caveat does not apply to this round.

### What changed, per FR

- **FR-024, literals are paths.** In `src/expand/expand.ts` a literal state asks the host: `PhysicalPaths.exact(child)` (new: the
  host's raw `canonicalize` answer, `undefined` where nothing is there, with no ancestor fallback) and, for a **last** literal,
  `kindOf(stored)`. A non-last literal just pushes its child directory; the prefix was already resolved by the host and now gets
  the same existence test as any directory. Wildcard states list and compare names exactly, as before. A literal match is named by
  its written spelling (`join(dir, literal)`) with the stored path as `physical`. There is **no `stat` verb on `Host`**, so "the
  kind" is read from the *stored parent's* listing (below, Ambiguities R1).
- **FR-025, roots.** `ResolveResult.sandboxRoots` (absolute, in order), `MergeInput.sandboxRoots?`,
  `MergedConfiguration.sandboxRoots?` (stamped by `foldConfiguration`, like `paths`); `ExpandOptions.sandboxRoot` optional,
  explicit replaces; a configuration with none recorded and no option throws the old "requires 'sandboxRoot'" error.
- **FR-026, missing is empty.** A directory whose `exact` answer is `undefined` matches nothing (after the sandbox has judged it:
  a missing directory outside the sandbox is still `sandbox-escape`). `directory-unlistable` is thrown only when a directory that
  exists is refused; a failed listing of an existing path is first asked what it is (`kindOf`), and a file where a directory was
  wanted matches nothing.
- **FR-027, work.** `limits.maxEntriesVisited` is `work.units`: +1 for each (directory, position) entered, +1 per entry examined in
  a wildcard or `**` state, +1 per kind lookup; `> limit` refuses. A literal state costs its one unit and no listing. Consecutive
  `**` are not collapsed (the count is the guard). The coordinator's case (6 deep, fan-out 4, 5,461 directories, `t/` + `**/` x 60
  + `*.md`) now **refuses at the default in about 0.4 s**; raised to exactly the work it is **999,302 units (61 x (5,461 + 10,921),
  derived by hand and asserted) and takes about 3.9 s, 5,461 `list` calls, 5,461 matches** -- the 19 s of the first build was mostly
  the memory host scanning every file for each listing (it now keeps a directory -> names index) and `compareByCodePoint`
  allocating in the frontier (`compareRoutes`, exported from `expand.ts` for its test, falls back to it only across the
  surrogate range).

### Sabotage of the revision (20 mutants, all red on the first run; same driver, entries in `/tmp/cascata-024/entries3.py`)

| # | Rule broken | FR | Red | Where (tests) |
|---|---|---|---|---|
| R01 | FR-024 the last literal must be stored as written (exact-name behaviour) | FR-024 | 7 | expand-disk (1), expand-revision (6) |
| R02 | FR-024 a prefix written in another spelling is treated as missing | FR-024 | 1 | expand-revision (1) |
| R03 | FR-024 wildcard matching compares names normalized | FR-024 | 3 | expand-disk (1), expand-revision (1), expand (1) |
| R04 | FR-024 the last literal is not confined | FR-024/FR-017 | 1 | expand-revision (1) |
| R05 | FR-024 the kind of a last literal is not asked (a directory matches) | FR-024 | 4 | expand-revision (3), expand (1) |
| R06 | FR-025 resolve() records no roots | FR-025 | 3 | expand-revision (3) |
| R07 | FR-025 merge() does not carry them | FR-025 | 3 | expand-revision (3) |
| R08 | FR-025 an explicit sandboxRoot does not replace them | FR-025 | 3 | expand-revision (1), expand (2) |
| R09 | FR-025 with neither given nor recorded, no error | FR-025 | 1 | expand-revision (1) |
| R10 | FR-026 a missing directory is not skipped | FR-026 | 3 | expand-disk (1), expand-revision (1), expand (1) |
| R11 | FR-026 a missing literal after a wildcard is not skipped | FR-026 | 8 | expand-revision (3), expand (5) |
| R12 | FR-026 a file where a directory was wanted is unlistable | FR-026 | 2 | expand-revision (2) |
| R13 | FR-026 a root the host refuses is not a directory | FR-026 | 1 | expand-revision (1) |
| R14 | FR-026 confinement is judged after existence | FR-026 | 4 | expand-revision (1), expand (3) |
| R15 | FR-027 entering a state costs nothing | FR-027 | 4 | expand-revision (3), expand (1) |
| R16 | FR-027 entries examined cost nothing | FR-027 | 4 | expand-revision (2), expand (2) |
| R17 | FR-027 a kind lookup costs nothing | FR-027 | 1 | expand-revision (1) |
| R18 | FR-027 the limit is exact (> becomes >=) | FR-027 | 4 | expand-revision (2), expand (2) |
| R19 | FR-027 the count is names listed, once per directory (the first build) | FR-027 | 5 | expand-revision (4), expand (1) |
| R20 | FR-027 route comparison ignores the surrogate range | FR-027 | 1 | expand-revision (1) |

R13 was written because I asked of my own code which branch no case reached: the sandbox-root shortcut in `kindOf` has the same
outcome as the sibling rule *except* for a root the host refuses to list, so I added that case (`expand-revision`: a root that is
unlistable is `directory-unlistable`, and its parent outside the sandbox is never asked) before running the mutant.

### Tests

| | Main suite | Timing suite |
|---|---|---|
| After the first round (`f820102`) | 121 files / 3,650 | 8 / 14 |
| After the revision | 122 files / **3,677** | 8 / 14 (unchanged) |

+1 file (`expand-revision` 26 tests), `expand-disk` 4 -> 5. `pnpm typecheck` and `pnpm test` green; the one slow case (the
raised-limit run, ~4 s) has a 60 s timeout of its own and is the only test of this round that runs seconds.

### Changes to existing tests this round (each inverted by a ruling, none relaxed)

1. `expand.test.ts`, "directory-unlistable: a literal prefix naming a directory that is not there": **inverted** (FR-026). It is
   now an empty list, no diagnostic, and no `list` call at all.
2. `expand.test.ts`, the cap tests: the unit of the cap changed from names to work (FR-027). `x/*.md` is 4 units (was 3 names),
   `**/*.md` is 16 (was 6), re-derived by hand in the test; the "per value" test uses 4. The default-cap test is unchanged.
3. `expand.test.ts`, "expand() throws for programmer error": the "no `sandboxRoot` throws" line is **removed** (FR-025: the
   configuration's roots are the default); `[]` and `[""]` still throw, and a configuration with no recorded roots has its own
   test in `expand-revision.test.ts`.
4. `expand-disk.test.ts`: the composed/decomposed test and the `ENOENT` test were replaced (FR-024, FR-026). The first asserted
   that each spelling finds only itself, which on APFS is no longer true of a literal; it now asks the disk whether it folds and
   asserts both outcomes. The second asserted a refusal for a missing directory; the refusal is tested with a real `chmod 000`
   directory (skipped as root).
5. `expand-helpers.ts`: `expandPatterns` takes a `wrap`; `folding()` and `fanTree()` added. `src/host/memory.ts`'s `list` is
   indexed (no change of answer; `host-list` / `host-memory` unchanged and green).

No other existing test needed to change: adding `sandboxRoots` to `ResolveResult` broke no `toEqual`.

### New ambiguities (this round, unsoftened)

R1. **"The kind" has no host verb.** The ruling says "ask the host for that location (canonicalize, then the kind)". `Host` has
   `canonicalize` and `list`, no `stat`. I read the kind from `list(parent of the stored path)`, found by the stored basename;
   cached with the other listings and charged one unit. So a last literal costs a listing of its parent (not of nothing), and a
   host can refuse that listing while allowing the literal to be opened: then the value is `directory-unlistable` at the
   parent. A `Host.kind`/`stat` verb would be cleaner and is the owner's to add; I did not.
R2. **`canonicalize` returning `undefined` means "not there", whatever the reason.** Node's `realpath` also fails for an
   unreadable *ancestor* (EACCES on traversal), so a branch behind a directory the process cannot traverse is silently empty,
   not unlistable; only a directory whose own entries are refused (readable path, unreadable contents) is
   `directory-unlistable`. FR-026's "exists and the host refuses" is exactly as good as `canonicalize`'s `undefined`.
R3. **The prefix keeps one unit and one existence test.** The literal prefix is a single anchored directory (`globBase`), so ten
   prefix segments cost one unit, not ten, and its spelling is the host's problem as a path is (FR-024). `..` in a prefix is
   still resolved lexically (v1.13), not by the host.
R4. **A file used as a directory is told apart only when a listing fails.** Before listing, a non-last literal is assumed to be a
   directory; when its `list` fails, `kindOf` is asked and a non-directory matches nothing. A host whose `list` of a *file*
   answers `ok: true` with no entries (not the two shipped ones) would be walked as an empty directory, which is also nothing.
R5. **`ResolveResult.sandboxRoots` is a required field of a public type**, so a consumer that builds a `ResolveResult` by hand
   (rather than passing `resolve()`'s through) must add it; `MergeInput.sandboxRoots` is optional, so `merge()` calls are
   unaffected. An empty recorded list counts as none. `generateTypes()`'s resolution records them too (harmless).
R6. **Work units, exactly:** +1 per state entered (also for a literal state), +`entries.length` per wildcard or `**` state, +1 per
   kind lookup. Host questions that are memoized (`canonicalize`, `exact`) cost nothing, and neither does the heap, so a
   pattern of many literals is cheap in units and not free in time. The default stays 100,000 (a number the owner may want
   changed now that it means something else); the option keeps the name `maxEntriesVisited`, which now misdescribes it.
R7. **The raised-limit acceptance on the coordinator's tree runs in the main suite (~4 s).** It is the case the ruling asked
   for; the small-tree pair (40 directories, 1,309 units, +/- 1) is the fast boundary witness. Under heavy load the 60 s
   timeout, not the work, is what protects it.
R8. **`compareRoutes` is a second implementation of code point order** (fast path plus a fallback). It is tested against
   `compareByCodePoint` on a table that includes the surrogate range and BMP characters above it; the model's own function is
   still the one used for sorting matches and entries.
R9. **Items 2, 3, 10 and 12 above are resolved by the rulings;** item 16 (list receives the first route's logical location),
   item 17 and item 20(b) need a word: (b) is now true -- every segment that compares names does so exactly as listed, literal
   segments are asked as paths, and SPEC.md §7 was updated by the coordinator to say so.
