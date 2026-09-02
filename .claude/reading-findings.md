# Findings from an outside reading

Read on 2026-09-02 by a session working on **BelType**, which is planning to embed Cascata as its configuration cascade. Nothing here was found by working on Cascata; it was found by reading Cascata closely enough to depend on it. Nothing was modified. This is the report section `CLAUDE.md` asks for — *flag governance defects; do not fix them* — filed by a reader rather than an implementer.

Every claim below was verified in this session against the working tree at `f5e653d`. Where a claim came from somewhere else and turned out to be wrong, that is recorded too, because two of them did.

---

## `parse-bypasses-the-registry`

**`src/index.ts:106-113` and `:129-136`.** The package root's two parse entry points call the YAML adapter directly:

```ts
export function parse(bytes: Uint8Array, options: ParseOptions): ParseResult {
  requireOrigin(options, "parse");
  const outcome = parseYamlBytes(bytes, options.origin, options.limits);
```

```ts
export function parseText(text: string, options: ParseOptions): ParseResult {
  requireOrigin(options, "parseText");
  const outcome = parseYaml(text, options.origin, options.limits);
```

Neither consults `adapterForFormat` or `formatForLocation`. A caller holding JSON bytes cannot reach the JSON adapter through the public `parse()` at all — the format is decided by which function you call, and only one exists.

This is the same defect `src/adapters/registry.ts:18-28` describes v1.2 finding and fixing, one layer up. That header records that `src/index.ts`'s two *parse-at-location* sites read `formatForLocation` and then compared the answer to the literal `"yaml"`, so "registering an adapter changed nothing a caller could reach until those two sites were made to look the answer up." Those two were fixed. These two were not, and they are the ones a caller reaches first.

Whether it matters is a scope question rather than a bug question, and it is yours: if `parse()` is meant to be the YAML-only door and format selection lives at resolve time by design, then the defect is that neither the function's doc comment nor the registry's header says so — the registry's header names `src/index.ts` as "its only consumer", which reads as covering these. If `parse()` is meant to be format-agnostic, it is a correction under the freeze rule.

---

## Two source headers have drifted, both understating the project

Both of these were reported to me as findings by a reading agent that quoted the headers as fact. Both headers are stale. I am recording them because the drift runs in the direction that makes Cascata look *less* finished than it is, which is the direction nobody re-checks.

### `src/host/node.ts:38-45` — "no test ever calls this" is false

The header states:

> **No test in this codebase ever constructs or calls anything in this file** — every test passes an explicit in-memory host test double or `RecordedTransport` … so this module's own behavior is unverified by the suite

Measured: `createNodeHost` appears **145 times across `tests/`**, constructed and driven — `tests/unit/remote-offline.test.ts` alone runs it through `resolve()` four times in the lines I read, with a real `cacheDir`, exercising `cacheRead`/`cacheWrite`. `nodeMetaSchemaLocation` has six call sites across three metaschema suites.

The claim is accurate for exactly one export: `createNodeTransport`, which `tests/unit/resource.test.ts:113` covers with a smoke test whose own name says it is "deliberately untested beyond construction … no test in this codebase performs real network access". That is the sentence the header generalised from, and the generalisation stopped being true.

The consequence is not a missing test. It is that a reader — human or otherwise — takes the file at its word and concludes the shipped Node host is unverified. I did, until I checked.

### `src/merge/provenance.ts:6-11` — "not in data-model.md's own field table" is false

The header states:

> **`Layer.tree` is not in data-model.md's own field table.** That table lists only `identity`, `role`, and `rank` … This is resolved pragmatically by carrying `tree` on `Layer` too

Measured: `specs/003-merge-engine/data-model.md:18` carries the row, and carries its own note about the history —

> \| `tree` \| The layer's parsed tree — what it actually contributes. Omitted from an earlier draft of this table, which listed only identity, role and rank; the fold cannot merge without it, and v0.2's `Pedigree` deliberately does not carry it \|

So the spec was corrected and the source header describing the gap was not. `Layer.tree` is not off-spec and not pragmatic; it is documented, with its reasoning. The header now reports a defect that was fixed, which under this project's own rules is the more expensive kind of drift: it makes a settled question look open.

**One observation on both.** These headers are the best I have read anywhere, and that is what makes the drift matter — a codebase whose comments are load-bearing has more to lose when one goes stale than one whose comments nobody trusts. The sabotage discipline in `CLAUDE.md` is aimed at green tests that prove nothing; this is its mirror, a header that claims a gap that no longer exists. Whatever check would catch it is not one I can propose from outside.

---

## `hashbytes-blocks-the-browser`

**`src/resolve/identity.ts:19` and `:34`.**

```ts
import { createHash } from "node:crypto";
…
export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
```

`createHash` is synchronous and has no browser equivalent. The web's only SHA-256 is `crypto.subtle.digest`, which is a Promise. So this one function is what stops Cascata running in a browser tab.

Everything else in `src/` outside `src/host/` is algebra: `node:path` in `resolve/location.ts`, `validate/resource.ts`, `resolve/delegate.ts`, and `node:os`'s `homedir` in `resolve/location.ts`. All three are routinely shimmed — BelType already ships POSIX-only `path`, `os` and `url` shims for exactly this. `node:crypto` is the only one that is a capability rather than arithmetic.

Making `hashBytes` async is contained: it is not on the package root's export list, and its one caller is `createDocumentIdentity`, whose callers are already async. `CLAUDE.md`'s dependency rule permits it — `crypto.subtle` is a built-in wherever `node:crypto` is — and the change strictly widens where Article VI's "the library performs no I/O" can actually be true. BelType's own `fingerprint.js` made this exact move and recorded why: `globalThis.crypto.subtle` plus `btoa`, no `Buffer`, so the module runs wherever its host does.

Whether it is worth doing is a question about who else might embed Cascata, and it is yours. Recorded here rather than raised as a request.

---

## A note on the reading itself

Two of the four things I was handed as findings were stale comments rather than defects, and I only learned that because I checked before writing them down. The failure mode is worth naming for whoever reads next: **a header this good reads like a measurement.** It is not one. `CLAUDE.md`'s own rule covers it — *sabotage-test every empirical claim* — and the claims in question here were about the project rather than about the code, which is exactly where that rule is easiest to forget to apply.
