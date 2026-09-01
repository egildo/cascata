# Quickstart: The Accumulated Demand, and the TypeScript Type Generator

**Milestone**: v1.1 (`specs/010-type-generator`). A validation guide, not an implementation guide.

## Run everything

```bash
pnpm typecheck && pnpm test
```

Expected: typecheck clean; every pre-existing test green and unmodified (1039 at the start of this
milestone); the new suites green; `grep -rn SABOTAGE src/ tests/` empty.

## The six things this milestone claims, each in one command

```bash
pnpm test tests/unit/accumulate.test.ts        # the tree: intersection per keyword, per-layer resolution, empty ⇒ lint
pnpm test tests/unit/generate-shapes.test.ts   # keys/values/items/seal/optionality, quoted keys
pnpm test tests/unit/generate-leaves.test.ts   # numeric rule, unions, null, enum and constant literals
pnpm test tests/unit/generate-types.test.ts    # named aliases, qualifiers, escapes, recursion
pnpm test tests/unit/generate-oracle.test.ts   # every corpus case + the meta-schema, typechecked in memory
pnpm test tests/unit/doc-examples.test.ts      # the ts lane finds the README pair and diffs it
```

## What a consumer writes now

```ts
import { generateTypes } from "cascata";
import { createNodeHost } from "cascata/host/node";

const result = await generateTypes("./schema/project.yaml", { host: createNodeHost(), sandboxRoot: process.cwd() });
if (result.ok) {
  await fs.writeFile("./generated/config.d.ts", result.source);   // the caller writes; the library never does
  result.diagnostics;                                              // info lints, e.g. demand-unsatisfiable
}
```

Then, unchanged from v1.0:

```ts
import type { project as Project } from "./generated/config.js";
const cfg = await load<Project>("./site.yaml", { host: createNodeHost(), sandboxRoot: process.cwd() });
```

`load<T>()` still checks nothing. What changed is that `T` is now *derived*, and the oracle is the
proof that a derived `T` is inhabited by every configuration the schema accepts.

## Expected outcomes

- `pnpm test tests/unit/generate-oracle.test.ts` prints the two asserted counts (accepting cases,
  type-shaped refusals) and the list of mixed cases it declines to judge.
- A root `int | float` with a house `int` emits `bigint`; the same chain projected yields a `bigint`;
  the oracle compiles.
- The meta-schema's generated type has six aliases, `demand` self-referencing, and the meta-schema's
  own projection compiles against it.
- `README.md`'s `generate` section shows a schema and its emitted type, and the doc lane fails if
  either drifts.
