# Quickstart: Validating v0.7 Works End-to-End

## Prerequisites

```bash
pnpm install
pnpm typecheck
pnpm test
```

Baseline: 610 tests, 50 files, clean typecheck, clean tree, at `6f55ac3`.

## US1 — diagnostic levels

```bash
pnpm vitest run tests/unit/diagnostic-levels.test.ts tests/unit/delegate-lint.test.ts
```
Expect: every diagnostic in the suite carries `level`; a schema granting `delegate: allow` on a
`type: string` key resolves `ok: true` with one `info` diagnostic.

## US2 — sealing

```bash
pnpm vitest run tests/unit/seal.test.ts tests/unit/final.test.ts tests/corpus/seal-corpus.test.ts
```
Expect: a `final` key redeclared with a strictly narrower `demand` is still refused
(`final-key-redeclared`) — the discriminating case FR-010 names explicitly.

## US3 — authority

```bash
pnpm vitest run tests/unit/authority.test.ts
```
Expect: a root demanding pinned adoption refuses an unpinned descendant and admits a pinned one;
`finalAgainstForking` is recorded but produces zero diagnostics.

## US4 — the host seam

```bash
pnpm vitest run tests/unit/layering.test.ts tests/unit/host-*.test.ts tests/unit/determinism.test.ts
pnpm vitest run tests/unit/remote-*.test.ts tests/corpus/resolve-corpus.test.ts
```
Expect: `layering.test.ts` fails if any file under `src/` (other than `src/host/node.ts`) is made
to import `node:fs` (sabotage this deliberately — see the milestone report). Every pre-existing
remote fixture in `tests/unit/remote-*.test.ts` and `tests/corpus/` still passes, driven through
the new `host`-shaped `resolve()` call.

## US5 — `load()`

```bash
pnpm vitest run tests/unit/load.test.ts
```
Expect: one `load()` call reproduces exactly what `resolve()` → `merge()` → `validate()` produce
in sequence, diagnostic order included.

## US6 — `resource` resolution

```bash
pnpm vitest run tests/unit/resource.test.ts
```
Expect: a `path` provided by a house layer in one directory, inherited by a config in another,
resolves against the house layer's own directory — the discriminating case FR-035/SC-006 name.

## Full gate

```bash
pnpm typecheck && pnpm test && grep -rn SABOTAGE src/ tests/
```
The `grep` must return nothing before any commit.
