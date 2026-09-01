# Contract: the meta-schema and `metaValidate()`

**Milestone**: v0.7, part 2.

## 1. The artifact

`meta/cascata.meta.yaml` is a **document**, not a constant. It is shipped in the published package
and is read through the `Host` seam like any other document (FR-019). No module under `src/` embeds
its text.

`src/host/node.ts` — the one file exempt from the host boundary — exports
`nodeMetaSchemaLocation(): string`, the absolute path of that document in the installed package. The
library proper never computes a path.

## 2. What it describes (FR-015)

`types`, `keys`, `directives`, `authority`, a schema's own top-level `seal`; the full per-key
vocabulary (`demand`, `provide`, `cascade`, `final`, `delegate`) for a **top-level** key
declaration, and the smaller `{demand, delegate}` vocabulary for a **nested** one (§9 amended, §15);
and §9's full closed `demand` keyword set including `values`.

## 3. What it cannot describe, and says so

- **§9.1's leaf DSL** (research.md W-1). The grammar is non-regular. `typeExpr`'s `pattern` is a
  deliberate **superset** under one governing rule: *it must accept every string the grammar
  accepts.* Over-acceptance is safe; one false rejection would put the pattern and the parser in
  contradiction. The pattern MUST stay linear — see the artifact's own comment.
- **Relational and cross-layer law** (research.md W-3): that a `provide` satisfies its own key's
  demands, §5.2's monotonicity table, and §7's namespace resolution. All stay hand-written checks.
  FR-017/FR-018 subsume the **shape** checks only.

## 4. `metaValidate()`

```ts
metaValidate(options: MetaValidateOptions): Promise<MetaValidateResult>
```

1. Reads `options.metaSchema` and `options.subject` through `options.host`. Neither is read any
   other way.
2. Builds a two-layer configuration: the meta-schema as the schema layer (rank 0), the subject as
   the config layer (rank 1), folded by the real `fold()`.
3. Returns the real `validate()`'s outcome.
4. It is **never** called from `load()` (research.md D-2). Meta-validation is a publishing act.
5. It performs no reference resolution: the subject's own `$schema`/`$adopts` are **not** followed.
   The subject is judged as one document's shape, which is all a meta-schema can judge (W-3).

## 5. The obligations

| id | obligation |
|---|---|
| FR-016 | `metaValidate({subject: meta, metaSchema: meta})` succeeds. The fixed point. |
| FR-017 | Every schema document in the conformance corpus passes, or its failure is triaged and reported. |
| FR-018 | For every schema-vocabulary error the codebase already refuses, the meta-schema **agrees on the verdict**. Diagnostic *codes* may differ; each difference is reported (research.md W-4). |
| FR-020 | `$version` is readable from the meta-schema's own pedigree. |
