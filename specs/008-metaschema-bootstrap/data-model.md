# Data Model: The Meta-Schema Bootstrap

**Milestone**: v0.7, part 2 (`specs/008-metaschema-bootstrap`)

Additive only. No existing entity loses a field.

## `values` — a demand keyword

`DEMAND_KEYWORDS` (`src/validate/vocabulary.ts`) gains `"values"`, making thirteen. §9's list is
closed, so this is an amendment to a closed set and is cited as such (`SPEC.md` §9, §15, v0.7).

| aspect | `keys` | `values` |
|---|---|---|
| value shape | mapping of *name* → key declaration | **one** key declaration |
| key declaration | `{ demand?, delegate? }` (nested form) | `{ demand?, delegate? }` (nested form) |
| covers | the entries it names | **every** entry, whatever its key |
| against a non-mapping | no-op | no-op (FR-006) |
| composition where both cover an entry | intersection (§5.1) — both run, independently | as `keys` |

`values` is **not** shaped like `items`, whose value is a demand mapping directly. See
plan.md P-1; the asymmetry is real and is reported.

## `directives:` — a top-level section

```text
directives:
  <$reserved-key>:        # one of exactly six
    demand:   { ... }     # the same per-key vocabulary a `keys:` entry takes
    provide:  ...         # accepted, inert (a directive is never merged)
    cascade:  ...         # accepted, inert
    final:    ...         # accepted, inert
    delegate: ...         # accepted, inert
```

- **Closed** to `$id`, `$version`, `$adopts`, `$pin`, `$schema`, `$extends` — the same set
  `src/merge/fold.ts`'s `RESERVED_DOCUMENT_KEYS` strips, now exported so there is one definition.
- Read from **schema** layers only. A config's own `directives:` is inert (FR-014), exactly as a
  config's own `keys:`/`types:` already are.
- Checked against the **config layer's own parsed tree** (`layer.tree`), never the merged tree.
- Produces no `Diagnostic.pointer`: a directive has no merged-configuration position (FR-013).

### New diagnostic code

| code | level | when |
|---|---|---|
| `unknown-directive-key` | `error` | a `directives:` entry naming something outside the six (FR-011) |

Everything else a directive can go wrong with reuses an existing code: `malformed-demand-value`,
`type-mismatch`, `pattern-mismatch`, `required-violated`, and the rest — because a directive's
`demand` **is** an ordinary demand and is checked by the ordinary machinery.

## The meta-schema

One document, `meta/cascata.meta.yaml`, shipped in the package (`package.json` `files`).

| property | value |
|---|---|
| `$id` | `cascata/meta` |
| `$version` | `1` — §11's "the schema language itself is versioned via the meta-schema's own pedigree" |
| `$adopts` | **absent**. It is the root; the regress stops at the document the library ships (research.md D-1) |
| top-level `seal` | `closed` — a schema document has no top-level keys beyond those it declares |
| named types | `typeExpr`, `typeName`, `demand`, `keyDecl`, `nestedKeyDecl`, `typeDecl` |

## `MetaValidateResult`

```ts
export interface MetaValidateOptions {
  readonly host: Host;
  /** Location of the document under test — read through the host. */
  readonly subject: string;
  /** Location of the meta-schema — read through the host (FR-019). */
  readonly metaSchema: string;
}
export type MetaValidateResult =
  | { readonly ok: true;  readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };
```

`ok: true` may still carry `info` lints, matching `LoadResult`'s own contract (§10, v0.7 FR-002).
