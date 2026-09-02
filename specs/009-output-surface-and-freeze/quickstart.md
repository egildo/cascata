# Quickstart: validating v1.0

**Milestone**: v1.0 (`specs/009-output-surface-and-freeze`)

Prerequisites: `pnpm install`. No network access is used or permitted (constitution, Technology &
Security Constraints).

## Run everything

```bash
pnpm typecheck && pnpm test
grep -rn SABOTAGE src/ tests/     # must print nothing
git status --short                 # must print nothing
```

## The five things this milestone claims, each in one command

```bash
# US1 — a malformed top-level section is refused, and the divergence table is zero
npx vitest run tests/unit/sections.test.ts tests/unit/metaschema-corpus.test.ts

# US2 — the keys+values composition is bounded, with identical diagnostics
npx vitest run tests/unit/composition-bound.test.ts tests/unit/recursion-termination.test.ts

# US3 — a configuration reads as ordinary data; __proto__ pollutes nothing
npx vitest run tests/unit/value-view.test.ts

# US4 — the schema decides the numeric type, not the punctuation
npx vitest run tests/unit/numeric-projection.test.ts

# US5 — one call, one type
npx vitest run tests/unit/load-typed.test.ts

# US6 — every documented YAML example still parses
npx vitest run tests/unit/doc-examples.test.ts
```

## What a consumer writes now

```typescript
import { load } from "cascata";
import { createNodeHost } from "cascata/host/node";

interface Site {
  readonly styles: readonly string[];   // `required` + `provide` = a non-optional property (§5.5)
  readonly port: bigint;                // the schema demands `type: int`
}

const result = await load<Site>("./site.yaml", { host: createNodeHost(), sandboxRoot: "." });

if (result.ok) {
  result.value.styles[0];          // ordinary data — no walk, no tagged union, no spans
  result.configuration.tree;       // still there: spans, provenance, pedigree
  result.diagnostics;              // any info-level lints the configuration earned
}
```

`T` is the caller's claim and the library never checks it (Article VII). Deriving it from the schema
chain is the v1.x generator's job (§14) — **shipped at v1.1 as `generateTypes()`** (specs/010-type-generator).

## Expected outcomes

| command | expectation |
|---|---|
| `pnpm typecheck` | clean, no output beyond the banner |
| `pnpm test` | all files pass; the count is above the 901 this milestone started from |
| `tests/unit/composition-bound.test.ts` | the depth-18 case is within a small constant multiple of depth-10 — a **ratio**, never a wall-clock threshold |
| `tests/unit/metaschema-corpus.test.ts` | the divergence count asserts **zero** |
| `node -e "JSON.stringify({a:1n})"` | throws `TypeError` — documented, not hidden (contracts/value-view.md §3) |
