# Implementation Plan: The JSON Format Adapter

**Branch**: `011-json-adapter` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-json-adapter/spec.md`

## Summary

Five user stories. US1–US4 are one artifact — a hand-written, byte-scanning RFC 8259 parser — split
by what each story asserts about it: acceptance and model equality (US1), numbers (US2), the
portability floor (US3), document shape (US4). US5 is the motivating consumer's real document,
recorded as a fixture and checked against a hand-written subtree.

Around the parser there are four small pieces of plumbing, each of which is the milestone's real
risk rather than the parser: the shared encoding module, the two `src/index.ts` dispatch sites, the
three whole-corpus tests that ignore a case's `format`, and the `Host` export.

**Findings made before any code was written**, all in [research.md](./research.md):

1. **`BigInt("0007")` is `7n`.** The host primitive accepts leading zeros; RFC 8259 forbids them. The
   number grammar must be the parser's own, and the primitives are converters only (P-3).
2. **The UTF-8 validator already exists**, module-private in the YAML adapter, and is the kind of
   code that is wrong the second time it is written. It is extracted, unchanged (P-2).
3. **`totality`, `hermetic` and `entry-parity` feed every corpus case to the YAML adapter**,
   whatever the case's `format` says. Measured after the cases landed: all 23 accepting JSON text
   cases are accepted by the YAML adapter too, so nothing fails — `entry-parity` simply asserts its
   property about the wrong adapter, twice, and about the new one never (P-6).
4. **`src/index.ts` never uses its own registry** — both parse-at-location sites compare the format
   to the literal `"yaml"`. Without changing them, registering the JSON adapter changes nothing that
   a consumer can reach (P-7).
5. **`-0` is `int 0n` and `1e400` is `float Infinity` in the YAML adapter today** (measured through
   the shipped surface). The JSON adapter inherits both rather than inventing a position (P-4).

## Technical Context

**Language/Version**: TypeScript 5.9, `strict` + `noUncheckedIndexedAccess`, Node ≥ 20

**Primary Dependencies**: none added. `yaml` remains the only runtime dependency, and the JSON
adapter does not import it.

**Testing**: Vitest. New corpus family `tests/corpus/cases/json-*/` (nine directories), a
`tests/corpus/json-adapter.ts` shim beside the YAML one, a `tests/corpus/adapters.ts` shared
registry, and three new unit suites: parity, the packet fixture, and the adapter's own edge
properties.

**Scale/Scope**: 24 FRs. New files: `src/adapters/json/{scan,parse}.ts`,
`src/adapters/encoding.ts`, `src/adapters/limits.ts` (moved from `yaml/`),
`tests/corpus/{json-adapter,adapters}.ts`,
`tests/unit/{json-adapter,json-yaml-parity,packet-fixture}.test.ts`,
`tests/fixtures/packet/20221030_203857_1265d2.packet.json`, and the corpus cases. Changed:
`src/adapters/registry.ts`, `src/adapters/yaml/parse.ts` (imports moved out, no logic touched),
`src/index.ts` (two dispatch sites, one export), `tests/corpus/corpus.test.ts` (one registry line),
`tests/corpus/coverage.test.ts` (a JSON section), `tests/unit/{totality,hermetic,entry-parity,doc-examples}.test.ts`
(format dispatch, and a `json` documentation lane), `README.md`, `SPEC.md` (§14, §15).

## Constitution Check

| gate | verdict |
|---|---|
| 1. `tsc` clean, no `any`, no cast on the node model | the parser builds every node through `src/model/node.ts`'s factories |
| 2. conformance corpus green for every standard touched | RFC 8259 gains a corpus family, written first (FR-020) |
| 3. monotonicity table | untouched — an adapter adds no construct to the cascade |
| 4. no new runtime dependency | none (FR-018) |
| 5. every diagnostic carries code, level, sentence, positioned span | five codes reused, no new code; each is constructed with an explicit `level` |
| 6. no import crosses the format-blindness boundary | `src/adapters/json/` is format-aware by definition; nothing outside `src/adapters/` and `src/index.ts` imports it, enforced by the untouched layering test |
| 7. no import crosses the host boundary | the adapter takes bytes and returns nodes; it opens nothing |

**Principle I.** Every requirement cites `SPEC.md`. The two places this milestone touches `SPEC.md`
itself are §14 (ticking item 11's JSON adapter) and §15 (one entry, recording the addition and the
`Host` correction). Neither changes an existing meaning.

**Principle V.** Cases before code, hand-derived from RFC 8259 and from each document's own bytes.
The probe gate is discharged in research.md's own table, against the host primitives the parser
leans on, before any conclusion about them was written down.

## Complexity Tracking

| deviation | why | simpler alternative rejected because |
|---|---|---|
| **Taken ahead of its §14 position** (item 11, after the exporter, then numbered v1.2) | a consumer exists now: an archive host that renders a photograph's metadata as JSON and cannot be built until Cascata reads it. §15's freeze rule permits an addition at any time, and the adapter and the exporter are independent — neither reads the other's output | doing the exporter first would delay the only thing anyone is waiting for, and would not make the adapter one line simpler |
| **A hand-written parser rather than `JSON.parse`** | `JSON.parse` yields no positions and no `bigint`s. §4.1 makes an unpositioned node unconstructible and §4.2 makes integers exact; a `JSON.parse` tree can satisfy neither | using `JSON.parse` and then re-scanning the text to attach positions is a second parser wearing a disguise, and one that must agree with the first about every token boundary |
| **Extracting the UTF-8 validator out of `yaml/parse.ts`** | it is shared, security-relevant, and exactly right today | duplicating it makes two things that must stay identical; importing it from the YAML adapter makes one sibling depend on another |
| **Changing three existing tests** | they ignore the `format` field they were given (P-6) | leaving them would keep feeding JSON documents to the YAML parser, which — measured — passes, so the new adapter's bytes/text parity would be untested while looking tested |

## Structure Decision

```
src/adapters/
  encoding.ts        # UTF-8 well-formedness + byte->line/column, shared by both adapters
  limits.ts          # SPEC.md §11's caps, moved up from yaml/ for the same reason
  registry.ts        # + the json entry, + .json in formatForLocation
  json/
    scan.ts          # the byte cursor: offset, line, code-point column, and the token primitives
    parse.ts         # the recursive-descent parser: parseJsonBytes, parseJsonText
  yaml/              # unchanged but for the two imports moved to encoding.ts
```

`json/` is two files rather than one for the same reason `yaml/` is four: the cursor's position
arithmetic is the part that must be read carefully and independently of what a value looks like, and
a file that mixes "where am I" with "what is this" makes both harder to check.

## Phases

1. **Foundational** — `src/adapters/encoding.ts` extracted from `yaml/parse.ts`, with the existing
   `bytes-encoding` corpus cases asserted still green. No new behaviour.
2. **US1–US4 cases** — the whole `json-*` corpus family, committed before the parser, every expected
   value derived by hand. Registered in `corpus.test.ts` against an adapter that does not exist yet,
   so the cases are observed failing.
3. **The parser** — `scan.ts` then `parse.ts`, until the corpus is green.
4. **The seam** — the registry entry, the two `src/index.ts` dispatch sites, the `Host` export, the
   three format-dispatching tests, the coverage section, the documentation lane.
5. **US5 and verification** — the recorded packet fixture, the parity test, the sabotage runs,
   `pnpm build`.
6. **Documentation** — README's `### JSON adapter`, `SPEC.md` §14 and §15.
