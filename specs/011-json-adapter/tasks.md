# Tasks: The JSON Format Adapter

Phases run in order. Within a phase, tasks marked **[P]** touch disjoint files and may be done in
any order. Every task cites the FR it discharges.

## Phase 1 — Foundational

- [x] **T001** Extract `findFirstInvalidUtf8ByteOffset` and `locateByteOffset` from
  `src/adapters/yaml/parse.ts` into `src/adapters/encoding.ts`, byte for byte, and import them back.
  No logic changes. (FR-003, research P-2)
- [x] **T002** Run `pnpm test` and confirm `tests/corpus/cases/bytes-encoding/` and
  `tests/corpus/cases/bytes-parity/` are still green — the regression evidence for T001.
- [x] **T003** Commit. Nothing has changed behaviourally and the suite says so.

## Phase 2 — The conformance corpus, before the parser (FR-020)

Every expected value derived by hand: byte offsets counted from the document's own bytes, kinds
read off RFC 8259's grammar, never from a parser's output.

- [x] **T004 [P]** `json-structure/` — a nested document with objects, arrays and every scalar kind;
  `{}` and `[]`; a root scalar; a root array; an empty key; a `__proto__` key. (US1, FR-014)
- [x] **T005 [P]** `json-numbers/` — every lexical kind with spans: `0`, `-0`, `12`, `2.0`, `-0.0`,
  `1e2`, `1E2`, `1e+2`, `1e-2`, `0e0`, a 32-digit integer. Refusals: `01`, `+1`, `.5`, `1.`, `1e`,
  `Infinity`, `NaN`, `0x10`. (US2, FR-008, FR-009)
- [x] **T006 [P]** `json-strings/` — every escape; a surrogate-pair escape; a legitimate U+FFFD;
  refusals for an unknown escape, a raw control byte, an unpaired high surrogate escape, an
  unpaired low surrogate escape. (FR-010)
- [x] **T007 [P]** `json-unicode/` — non-ASCII keys and values with **byte** spans and **code-point**
  columns asserted, including an astral character; the same document as bytes and as text
  (`bytes-parity`'s shape). (FR-012)
- [x] **T008 [P]** `json-duplicate-keys/` — the refusal with both spans; a nested object where the
  outer and inner both use the key (legal); a near-miss where two keys differ only by case. (FR-007)
- [x] **T009 [P]** `json-encoding/` — invalid UTF-8 at a byte offset (`inputBytes`); a BOM stripped
  with spans unchanged; a legitimate U+FFFD accepted. (FR-003, FR-004)
- [x] **T010 [P]** `json-limits/` — depth at the boundary and one past; size at the boundary and one
  past. (FR-013)
- [x] **T011 [P]** `json-document-shape/` — empty input; whitespace only; trailing content; two
  values; an unterminated object; a document containing `---` and `&a`/`*a` as ordinary content (the
  accepting cases for YAML's unreachable floor rules). (US4, FR-005, FR-006)
- [x] **T012 [P]** `json-equality/` — an `equalTo` pair proving the single definition of equality:
  two documents differing only in whitespace and key order parse to model-equal trees. (FR-014)
- [x] **T013** Observe the whole family **fail**: the runner refuses an unregistered format loudly
  (`names format 'json', which has no registered adapter`), which is the red this discipline wants.
  The shim and the registry line land with the parser rather than here, so that no commit in the
  history fails `pnpm typecheck` on an import of a module that does not exist yet.
- [x] **T014** Commit the cases, red.

## Phase 3 — The parser (FR-001, FR-002)

- [x] **T015** `src/adapters/json/scan.ts` — the byte cursor and its position triple. (research P-1)
- [x] **T016** `src/adapters/json/parse.ts` — values, objects, arrays, strings, numbers, literals;
  the depth cap checked before descending and an iterative skip for a refused value (research D-4);
  duplicate-key detection with both spans; the one-value-then-end rule.
- [x] **T017** Corpus green. `pnpm typecheck` clean.
- [x] **T018** Commit.

## Phase 4 — The seam (FR-015, FR-016, FR-017, FR-019)

- [x] **T019** `src/adapters/registry.ts`: the `json` entry and `.json` in `formatForLocation`.
- [x] **T020** `src/index.ts`: both parse-at-location sites dispatch through `adapterForFormat`
  (research P-7).
- [x] **T021** `src/index.ts`: `export type { Host, HostReadResult }`. (FR-017)
- [x] **T022** `tests/unit/{totality,hermetic,entry-parity}.test.ts` dispatch on `testCase.format`
  (research P-6).
- [x] **T023** `tests/corpus/coverage.test.ts` gains a JSON section. (FR-024)
- [x] **T024** `tests/unit/doc-examples.test.ts` gains a `json` lane. (FR-023) — and, found by adding
  it, the sweep's fence regex could not recognize a multi-word info string (` ```ts generated `),
  which inverted fence parity for the rest of `README.md`. Fixed; the YAML lane keeps every block it
  had.
- [x] **T025** `tests/unit/layering.test.ts` untouched and green. Commit.

## Phase 5 — The motivating consumer, and verification

- [x] **T026** Record the exiftool rendering as
  `tests/fixtures/packet/20221030_203857_1265d2.packet.json`, byte for byte, and note its provenance
  in the test that reads it. (FR-022)
- [x] **T027** `tests/unit/packet-fixture.test.ts` — no diagnostics; the `/0/XMP-mwg-rs:RegionInfo`
  subtree equals a hand-written tree; parsing twice gives identical trees.
- [x] **T028** `tests/unit/json-yaml-parity.test.ts` — three documents through `resolve()` in both
  formats, `nodesEqual` both ways. (FR-021)
- [x] **T029** `tests/unit/json-adapter.test.ts` — the properties no corpus case can carry:
  `1e400` → `float Infinity`; a 10,000-deep nesting is a diagnostic and not a `RangeError`; totality
  over a list of adversarial inputs.
- [x] **T030** Five sabotage runs, each broken, the specific tests observed red, restored:
  duplicate-key detection (2 cases red), the exact-integer path (3 red, across the corpus, the unit
  suite and the parity test), the code-point column (the 3 `json-unicode` cases), the depth cap
  (6 red — and the two ten-thousand-bracket documents came back as a real `RangeError`, so the cap
  is a genuine second line of defence and not a decoration), and `.json` in `formatForLocation`
  (the whole parity suite, refused as `document-unreachable`).
  `grep -rn SABOTAGE src/ tests/` clean.

## Phase 6 — Documentation

- [ ] **T031** `README.md`: a `### JSON adapter` section beside the YAML one, and the dependency
  policy line left alone (nothing was added).
- [ ] **T032** `SPEC.md` §14: item 11's JSON adapter ticked as shipped. §15: one entry recording the
  addition, the early take, and the `Host`/`HostReadResult` export correction.
- [ ] **T033** `pnpm typecheck`, `pnpm test`, `pnpm build`. Commit.
