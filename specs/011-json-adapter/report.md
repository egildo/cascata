# Report: what happened on `011-json-adapter`, and how to assess it

Written 2026-09-02 for the session that will judge this branch in Cascata's own venue. The work was
done by a coding agent (Claude Opus 5) under a plan cut in the photo-archive rewrite; the plan, the
agent's final report, and the independent checks below were reviewed by Claude Fable 5.1 in that
other venue. Egildo has not yet read a line of the branch. Nothing here is merged, tagged, or pushed.

## Why this branch exists

The photo-archive rewrite reads a photograph's metadata into Cascata as a **virtual document**: an
archive host renders the packet with `exiftool -json -struct -G1` and answers a location ending in
`.packet.json` with those bytes. Cascata selects adapters by extension, and until this branch only
`.yaml`/`.yml` existed. The JSON adapter was already on the roadmap (§14 item 11); a consumer arrived
before its turn in the queue. The motivating plan is
`~/.claude/plans/archivio-deno-rewrite/p0-cascata-json-adapter.md`, with the archive's reasons in
`05-wrenches.md` there ("the archive host for Cascata"). Egildo decided (2026-09-02) on exiftool's
JSON rather than a native XMP adapter, and that the adapter enters through Cascata's own process,
never a fork.

## State of the branch

| fact | value |
|---|---|
| base | `49e9eda`, which is `v1.1.0` |
| commits | 8, `9d8844c` … `b35f7ce`, all conventional-commit style |
| working tree | clean |
| `pnpm typecheck` | clean |
| `pnpm test` | 82 files, 1494 tests, green (baseline was 79 / 1272) |
| `package.json` | 1.2.0 |
| `dist/` | rebuilt from this branch (gitignored; the consumer packs it) |
| `tests/unit/layering.test.ts` | byte-identical to `49e9eda` |
| `grep -rn SABOTAGE src/ tests/` | empty |

The eight commits, in order, and what each carries:

1. `9d8844c` docs: the milestone folder, `specs/011-json-adapter/` (spec, plan, research with the
   probe gate already run, data-model, contracts, quickstart, tasks).
2. `9b4a6ec` refactor: `findFirstInvalidUtf8ByteOffset` and `locateByteOffset` move out of
   `yaml/parse.ts` into `src/adapters/encoding.ts`, unchanged; `yaml/limits.ts` becomes
   `src/adapters/limits.ts`, unchanged, because §11's caps are about documents, not YAML.
3. `3868c5d` test: 58 conformance cases under `tests/corpus/cases/json-*/`, hand-derived,
   **committed red** before any parser existed.
4. `8c0bcd9` feat: `src/adapters/json/scan.ts` and `parse.ts`, a hand-written recursive-descent
   parser over the byte array (about 880 lines with comments). No dependency. `JSON.parse` is not
   used anywhere: it gives neither spans nor `bigint`s.
5. `a85609f` feat: the registry gains `json`; `formatForLocation` recognises `.json`; the two
   parse-at-location sites in `src/index.ts` finally consult the registry instead of comparing to
   the literal `"yaml"`; `Host` and `HostReadResult` are exported from the package root; three
   corpus-wide tests dispatch on each case's `format`; a `json` lane in `doc-examples.test.ts` and a
   coverage assertion.
6. `fcedc9e` test: the real packet fixture (`tests/fixtures/packet/…`), YAML/JSON adapter parity on
   three documents, and the properties no corpus case can carry (`1e400`, the 10,000-bracket
   document).
7. `b267b2a` docs: `SPEC.md` §14 item 11 marked shipped at v1.2, one §15 entry, README section
   "v1.2 — the JSON adapter", version bump.
8. `b35f7ce` test: a raw NUL byte in a test file rewritten as a source escape, because git had
   started treating the file as binary and its diff was unreviewable.

## What the branch claims, and how to check each claim yourself

Run these from the repository root. Each was run once already by the reviewing session; the numbers
above are from that run, not from the agent's report.

```bash
git log --oneline 49e9eda..HEAD
```

```bash
git diff 49e9eda..HEAD --stat -- tests/unit/layering.test.ts
```

```bash
pnpm typecheck && pnpm test
```

```bash
grep -rn SABOTAGE src/ tests/
```

The claim that matters most to the consumer, "a `.json` location loads through the ordinary
`load()`", is `tests/unit/packet-fixture.test.ts`: it loads the recorded exiftool output through an
in-memory host with no schema and asserts the tree at `/0/XMP-mwg-rs:RegionInfo` against a
hand-written expected tree (two regions, `Leonardo Agus` and `Lucia Tagliareni`; dimensions
4032×3024). The fixture is a real photograph's metadata from the private test archive, read-only;
it contains two family names and nothing else personal.

## What the milestone found

Three findings went into the §15 entry, because each says something about the specification, not
just about this code.

**The registry existed and nothing used it.** `src/adapters/registry.ts` was written at v0.2 so a
second adapter could join "with no change to `resolve/` or `graph/`", and that held exactly. But
`src/index.ts` read the format at both parse-at-location sites and then compared it to the literal
`"yaml"`. Registering an adapter changed nothing a caller could reach. The seam was proved only on
the side that did not need proving.

**Two adapters may differ about their own grammars.** An empty `.json` file is refused
(`malformed-document`); an empty `.yaml` file is a null document. The branch argues §16's
determinism law is about two hosts disagreeing over one document, not two grammars over what each
admits. This is the agent's reading, written into §15. Egildo has not ruled on it.

**No new diagnostic code, and four floor rules are unreachable from JSON.** `non-string-key`,
`unsupported-tag`, `multiple-documents`, `alias-cycle` cannot be produced by this grammar; the
corpus carries the nearest legal document for each so the silence is recorded, not accidental.

Two more findings are corrections, and one of them predates the branch:

**`Host` was not exported.** Article VI obliges an embedder to write a host, and the package never
published the interface's name. Measured with `deno check` against the packed tarball: "declares
'Host' locally, but it is not exported". Fixed as a §15 correction, since nothing about the type
changed, only its reachability.

**A latent defect in `tests/unit/doc-examples.test.ts`, since v0.7.** The fence regex ended an
opening fence with `[ \t]*\r?\n`, which cannot match a multi-word info string. README has one,
` ```ts generated `, from v1.1's own lane. That fence was read as a closer, so every fence after it
paired with the wrong partner. Nothing failed only because every `yaml` block sits before it. Any
YAML example added to the back half of README would have been silently skipped, the exact failure
the file exists to prevent. Fixed in commit 5; the YAML lane keeps every block it had.

And the corpus did its job on the new code: on its first green run it caught a surrogate-pair bug
(`parseUnicodeEscape` consumed the `u` twice on the low half), and two of the agent's own
hand-derived expected values were wrong and were caught by the tests rather than trusted.

## Decisions the agent made that Egildo has not yet ruled on

Cascata's method is that Claude fixes what has one right answer and Egildo decides the rest. These
had more than one answer. Each is recorded in `research.md` (D-3 to D-6) or `spec.md`; none was
hidden, but none was approved either.

- **Syntax errors abort, floor violations accumulate** (D-3). After `{"a": ,` there is no honest
  place to resume, so the first `malformed-document` ends the parse; `duplicate-key` and
  `depth-limit-exceeded` accumulate. Mirrors the YAML adapter's split.
- **A depth-refused value is skipped iteratively** (D-4). Recursion is bounded by `maxDepth`, never
  by the input. Sabotage showed the cap is real: with it neutered, the 10,000-bracket documents came
  back as a `RangeError`.
- **`1e400` is `float Infinity`, not a refusal** (D-5). The YAML adapter already answers this way;
  the case format cannot express a non-finite float, so it is a unit test, said out loud.
- **Empty input is refused** (D-6). See the second finding above.
- **The public `parse()`/`parseText()` stay YAML-only.** Recorded as out of scope in `spec.md`.
  Only `resolve()`/`load()` consult the registry; the consumer uses `load()`. A `format` option
  would be a surface addition with its own §15 entry.
- **The JSON adapter shipped ahead of the v1.2 JSON Schema exporter** and took the v1.2 version
  number. §14 item 10 now reads as the next milestone under a later number. The freeze rule permits
  the reordering; whether the version number should have been 1.2 is a taste question.
- **`limits.ts` moved** out of the YAML folder. Same argument as `encoding.ts`, extended during
  implementation. `ParseLimits` keeps its public name.
- **Hard-wrapped documents.** The archive's standing rules forbid hard-wrapping; Cascata's specs are
  wrapped at about 100 columns. The agent followed Cascata's convention since it ran under
  Cascata's process, and flagged the conflict rather than picking silently.

## Questions for the assessment session

1. Does the §15 entry read as an addition and a correction, or does any sentence in it change an
   existing meaning? That is the only test the freeze rule sets.
2. Is D-6 (empty document refused) the reading Egildo wants, or should JSON admit an empty document
   as `null` for symmetry with YAML? Changing it later would be a change of meaning, so it is
   cheaper to decide now.
3. Merge to `main`, tag `v1.2.0`, push? The consumer does not need any of the three; it packs
   `dist/` from the branch. But the archive's P1 vendors `cascata-1.2.0.tgz`, and a tarball that
   names a version no tag carries is a loose end.
4. Is the `doc-examples` fix a correction to keep, and should its discovery be recorded anywhere
   beyond the test file's comment (a memory, a §15 line)?
5. The four unreachable floor rules: is "the corpus carries the nearest legal document" the right
   way to record an unreachable refusal, or should `data-model.md` carry a table instead?

## What the consumer now relies on

Changing any of these breaks the archive tool without a test in this repository noticing.

- `import type { Host, HostReadResult } from "cascata"`.
- `formatForLocation` lower-cases and tests `endsWith(".json")`, so `master/x.heic.packet.json`
  selects the JSON adapter by the ordinary rule. No special case exists and none is wanted.
- The adapter does **not** unwrap exiftool's one-element array. The archive host does (Egildo,
  2026-09-02: "yes, host unwraps"). The recorded fixture in this repository still carries the
  array, so pointers into it start with `/0`.
- Integers arrive as `bigint`, values written with a fraction as `number`, by lexical kind. The
  archive's packet schema must not demand `int` at a coordinate that exiftool writes as `0.3125`.
- Mapping keys iterate in canonical code-point order, not exiftool's emission order.

## Where to read next

`specs/011-json-adapter/research.md` for the probe gate and every decision with its reason;
`spec.md` for the requirements and the out-of-scope list; `SPEC.md` §15's last entry for the
argument as it will be read in a year; `README.md` "v1.2 — the JSON adapter" for the surface a user
sees. The agent's report also noted that `deno check` against `dist/index.js` by raw path reports
"no exported member" for every type-only export, `Origin` included, because Deno type-checks the
emitted JavaScript and never reads a sibling `.d.ts`; only the packed-tarball path measures the
published surface. That is a fact about Deno, not about Cascata, but it is the reason the original
"Host is not exported" measurement was made the way it was.

## Assessment — 2026-09-02, in Cascata's own venue

Read by Egildo through Claude Fable 5.1; every claim above re-measured rather than relayed. Typecheck
clean, 82 files / 1494 tests green, `SABOTAGE` grep empty, `layering.test.ts` byte-identical to
`v1.1.0`, every pre-existing test changed only to dispatch on its case's format. Probed by hand against
the YAML adapter: identical depth cap (65 nested sequences accepted, 66 refused), identical BOM byte
offsets, identical byte spans on an astral key with a non-ASCII value, identical `-0`. A sabotage of
`duplicate-key` detection turned exactly its two corpus cases red. The `doc-examples` fence claim was
checked against the old regex and README's fence positions and is true.

### What the assessment found

**The registry claim had no test that could fail.** Rewiring `parseAtLocation` to hand `.json` bytes
to `parseYamlBytes` left all 1494 tests green: every JSON document any test resolves through the public
surface is also valid YAML, so the wrong adapter gives the right tree. The parity test's "goes through
the registry" case checks only the unreachable side — the exact shape of defect this milestone
diagnosed in the registry, reproduced in its own test. The code was right (`a: 1` at `/doc.json` is
refused through `resolve()`); the guard was missing. Added: `tests/unit/json-registry-guard.test.ts`,
four cases over both parse-at-location sites (entry and grafted fragment), each paired with the same
bytes at a `.yaml` location so the refusal is provably the adapter's. Sabotage of both sites turns the
two `.json` cases red. Recorded incidentally: a fragment that will not parse has been reported at the
delegation site as `document-unreachable` with the adapter's diagnostics as `related` since v0.6, so
the fragment case reads the adapter's identity off the related label.

**This report misdescribed its key test.** "The claim that matters most to the consumer … is
`tests/unit/packet-fixture.test.ts`: it loads the recorded exiftool output through an in-memory host"
was false: that test calls `parseJsonBytes` directly and never touches `resolve()` or a host. The
consumer's actual path, a `.json` location through `load()`, is exercised by `json-yaml-parity.test.ts`
and now guarded by the test above. The sentence is left standing above so the correction is legible.

**§14 named two milestones v1.2.** Item 10 still read "v1.2 — JSON Schema exporter" beside item 11's
"shipped at v1.2". Egildo's ruling: the exporter is **v1.3**. Corrected in `SPEC.md` §14 items 10 and
11, `spec.md`, and `plan.md`.

### The five questions, ruled

1. **Freeze reading** — the §15 entry is an addition and a correction; no existing meaning changes.
2. **D-6** — kept: an empty `.json` document is refused. RFC 8259 admits no empty text, and admitting
   one would be Cascata inventing grammar. Article VI's law is about hosts, as read.
3. **Merge, tag, push** — yes, after the guard test and the §14 correction: merged to `main`, tagged
   `v1.2.0`, pushed. The archive's tarball now names a version a tag carries.
4. **The `doc-examples` fix** — kept as is; the test file's own comment is the record.
5. **Unreachable floor rules** — the corpus's nearest-legal-document is the right record. No table.

Every other decision the agent took (D-3, D-4, D-5, `parse()` YAML-only, `limits.ts` moved, the
version number) stands as made.
