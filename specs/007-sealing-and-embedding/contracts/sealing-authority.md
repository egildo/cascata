# Contract: Sealing, Authority, Diagnostic Levels

## Diagnostic levels

- `Diagnostic.level` is `"error" | "info"`, always present, never inferred (FR-001).
- `createDiagnostic()` requires `level` in its input — no default value, no optional field
  (contrast with `pointer`/`demand`/`pedigreePosition`, which stay optional/phased).
- A result whose diagnostics are **all** `info` is `{ ok: true, ... }` carrying both the value and
  the diagnostics (FR-002) — this changes `ValidateResult`/`LoadResult`'s own shape (see below);
  it does **not** change `ParseResult`/`ResolveResult`/`MergeResult`, none of which can produce an
  `info`-only outcome in this milestone (their own diagnostic catalogues are unchanged and remain
  all-`error`).

## `seal`

- Values: `open` (default) | `closed`. Anything else: `unknown-seal-value` at its own position
  (FR-006).
- `closed` on a key demanding a mapping refuses any child key present in the merged value but
  absent from the accumulated `demand.keys` vocabulary at that position: `seal-violation`,
  positioned at the child (FR-007).
- `open → closed` is legal, silent, and takes effect from the declaring layer downward. `closed →
  open` is refused: `seal-weakened`, primary span the descendant's own declared value — the same
  shape `cascade-strategy-weakened` has (FR-009).
- `seal: closed` on a key whose demand is not a mapping is accepted and inert — there are no
  children to close over the door (Edge Cases).

## `final`

- Once declared by any schema layer, **any** further declaration of that key by a descendant
  schema layer — `demand`, `provide`, `cascade`, `seal`, or `final` again — is refused:
  `final-key-redeclared`, even when the later declaration would be a legal narrowing (FR-010).
- `final` **with** `provide`: a config setting that key is refused (`final-key-set`, FR-011). A
  config **not** setting it is unaffected — the schema's `provide` supplies the value as normal.
- `final` **without** `provide`: a config setting the key is accepted (FR-012) — only the demand is
  frozen.
- `required: true` at a key that is `final` with `provide`: an `info` lint, `required-vacuous`
  (FR-013, §5.5 verbatim), fired only when the config did **not** illegally override the key (a
  `final-key-set` refusal already says everything the lint would).
- `seal`/`final` declared by a **config** have no effect (FR-014) — the same structural exemption
  `cascade`'s config declarations already have.
- `seal`/`final` take effect from the declaring layer downward (FR-015) — the identical rule
  `cascade`, and named-type narrowing, already state.

## `authority:` (per-schema)

- Closed vocabulary: `demandPinnedAdoption`, `finalAgainstForking`. An unrecognized member:
  `unknown-authority-member` at its own position (FR-016).
- `demandPinnedAdoption: true` on a schema `D`: every `$adopts` reference for a pedigree entry
  **strictly below** `D` (nearer the leaf) that lacks a `$pin` is refused: `adoption-not-pinned`,
  positioned at that `$adopts`, citing `D` (FR-017).
- The demand is **not retractable** — there is no `false`-branch semantics; a descendant can only
  ever fail to *also* declare `true` (FR-018).
- The demand never applies to `D`'s own fetch (FR-019, §11's inherent limit).
- `finalAgainstForking: true` is recorded and queryable, and produces **no diagnostic at all**
  (FR-020).
- An `authority:` section declared by a **config** has no effect (FR-021).

## `resource` resolution — `resource(configuration, pointer): ResolvedResource`

- `url`-shaped values resolve to themselves (FR-036).
- `path`-shaped values resolve against the directory of the document that declared them —
  read off the value node's own `span.origin.id` — never the entry document's directory and never
  the demanding schema's (FR-035).
- A value inside a delegated fragment resolves against the fragment's own directory (FR-037) —
  falls out of `origin.id` alone; no special-casing.
- A `resource` path resolving outside the sandbox root is **never** refused by this function
  (FR-038) — it has no diagnostic-producing path at all.
- Purely lexical: nothing is read, existence is never checked (FR-039).

## `load()`

```ts
type LoadResult = { ok: true; configuration: MergedConfiguration; diagnostics: readonly Diagnostic[] }
                 | { ok: false; diagnostics: Diagnostic[] };
function load(entryPath: string, options: LoadOptions): Promise<LoadResult>;
```

- Composes `resolve()` → `merge()` → `validate()` in sequence (FR-032, FR-033) — never a second
  implementation of the pipeline.
- `ok: true`'s `diagnostics` holds every `info` lint the run produced (possibly empty); `ok: false`
  is reached the moment any stage produces an `error` (FR-032: "never a configuration together with
  errors").
- Throws exactly where the staged calls would (missing `host`/`sandboxRoot`) — FR-032's last
  clause.
- The staged functions (`parse`, `resolve`, `merge`, `validate`, `why`) remain public (FR-034).
