# Contract: the soundness oracle, and the executed documentation

**Milestone**: v1.1. Implements `SPEC.md` **Article VIII (§18)**, the soundness law; constitution
Principle V (cases before the code that judges them; expected values derived, never copied).

> Every configuration that validation accepts, projected by Article VII, inhabits the type generated
> from its schema chain.

## 1. The oracle (`tests/unit/generate-oracle.test.ts`)

| # | obligation | FR |
|---|---|---|
| 1 | Iterates **every** descriptor in `tests/corpus/validate-cases/`, using the corpus runner's own resolution so the same fixtures and host are used. | FR-034 |
| 2 | For each: `generateTypes()` from the config's `$schema` target; `project()` the merged configuration; write the value as a TypeScript literal; typecheck `const x: <Root> = <literal>` against the emitted source, in memory. | FR-034 |
| 3 | The compiler is invoked through `ts.createProgram` with a `CompilerHost` serving one in-memory file; `strict: true`; `lib: ["lib.es2022.d.ts"]`; `noEmit`. No file is written. The lib's parsed source files are shared across cases. | FR-038 |
| 4 | Every `ok: true` case compiles; the number of such cases is asserted (38 at HEAD) so a runner that skips fails. | FR-034 |
| 5 | Every case whose expected diagnostics are **all** in `{type-mismatch, required-violated, seal-violation, enum-violated}` fails to compile; their number is asserted. | FR-035 |
| 6 | A case with a mixed refusal (one type-shaped, one range/length/pattern) is listed by name in the test with the reason, and neither asserted nor silently skipped. | FR-035 |
| 7 | `meta/cascata.meta.yaml`: type generated from the meta-schema; the meta-schema loaded as a configuration of itself (as `metaValidate()` builds it) and projected; the projection compiles. | FR-036 |
| 8 | The literal writer is itself checked on one hand-written pair: a `ConfigValue` and the exact text it must produce, covering `bigint`, a quoted key, a nested array, `null`. | FR-034 |
| 9 | A sabotage task swaps `bigint` for `number` in the emitter and records which cases went red; at least one must. | FR-037 |
| 10 | The oracle is a **derived** expectation: no test in this milestone asserts the generator's text except the doc lane (§3), whose blocks are written by hand from the mapping table, not copied from output. | Principle V |

## 2. The literal writer (test harness, not library)

| value | text |
|---|---|
| `string` | JSON double-quoted |
| `bigint` | `<digits>n` |
| `number` | shortest round-trip (`String(n)`); `-0` as `-0` |
| `boolean`, `null` | as is |
| array | `[a, b]` |
| object | `{ "k": v, … }` — every key quoted, canonical order |

## 3. The `ts` lane of the doc-examples sweep (`tests/unit/doc-examples.test.ts`)

| # | obligation | FR |
|---|---|---|
| 1 | A fenced `yaml` block immediately followed by a fenced block whose info string is `ts generated` is a pair; nothing else is compared. | FR-039 |
| 2 | The YAML is a single-layer schema with no `$adopts`; `accumulate()` + `generate()` run on it; the emitted source, trimmed, equals the block, trimmed. | FR-039 |
| 3 | At least one pair exists (the README's `generate` section); the count is asserted. | FR-039 |
| 4 | A synthetic pair with a deliberate mismatch makes the lane fail — the sweep's sensitivity proven, as the YAML lane already proves its own. | FR-039 |
| 5 | The YAML lane is unchanged: every `yaml` block still parses, including the new pairs' schemas. | FR-042 |
