# Working on Cascata

A TypeScript library for schema-governed cascading configuration. Format-agnostic, self-hosting,
provenance-rich. This file is the working method; it is not a substitute for the documents below.

## The document hierarchy — read in this order

1. **`SPEC.md`** — the product constitution. Normative for every semantic question. Amend by explicit
   article with an entry in §15; never by drift. It outranks everything else in this repository.
2. **`.specify/memory/constitution.md`** — the engineering constitution. Normative for process. Where
   it and `SPEC.md` disagree on product semantics, `SPEC.md` wins (Principle I).
3. **`specs/NNN-*/`** — per-milestone spec, plan, research, data model, contracts, tasks.

**Requirement numbers are milestone-local.** v0.1 FR-016 (invalid UTF-8) and v0.2 FR-016 (offline
cache resolution) are different requirements. **New citations must be qualified** — "v0.2 FR-016",
never bare — in code comments, commit messages, and instructions to agents. Unqualified citations
survive in v0.1-era files under `src/model/`, `src/diagnostics/`, and `src/adapters/`; read those as
v0.1. Do not retro-qualify them in bulk: the churn is not worth it, and the ambiguity only bites
where the two milestones' code sits side by side, which is `src/index.ts` and `src/resolve/`.

## Non-negotiables

- **`yaml` is the only runtime dependency.** `picomatch` arrived in v0.4 for §7's `glob` → gitignore
  syntax and left again in v0.5 when `glob` itself was dropped as a built-in type (SPEC.md §15) —
  the second time this line has needed correcting for the same dependency; the constitution's own
  "Technology & Security Constraints" list is a *ceiling* ("limited to..."), so it still names
  `picomatch` and needs no amendment for using fewer than it allows. Node built-ins (`node:crypto`,
  `fetch`, WHATWG `URL`, `TextDecoder`) are not dependencies. Adding anything else needs a
  constitution amendment.
- **No network access in tests, ever.** Remote behavior runs against recorded responses.
- **TypeScript `strict` + `noUncheckedIndexedAccess`. No `any`. No assertion casts on the node
  model** (`Scalar`/`Mapping`/`Sequence`/`Node`). One documented cast exists, on `yaml`'s own AST
  types, in `src/adapters/yaml/expand.ts`.
- **The format-blindness boundary is enforced by a test**, not by convention. `src/model/`,
  `src/diagnostics/`, `src/resolve/`, `src/graph/`, `src/merge/`, `src/validate/`, `src/project/` and
  `src/generate/` may not import adapters; `graph/`, `merge/`, `validate/`, `project/` and
  `generate/` may not import `resolve/`; `validate/` may not import `project/` **or** `generate/`
  (the last stages are downstream of every other, never upstream). `src/generate/` may import
  `validate/`, `merge/`, `model/` and `diagnostics/`, and imports no compiler: `typescript` is a
  devDependency and the emitter is a string printer, invoked in memory by the oracle under `tests/`
  and nowhere else. See `tests/unit/layering.test.ts`. Never weaken any of it for convenience.
- **Positions are structural.** A node without a span must be unconstructible, not merely
  discouraged. Same for a `Reference`.

## Method

**Conformance cases before the code that judges them.** Constitution Principle V. A case written
after the code, to match its output, proves nothing. Derive expected values independently — by hand,
or against an external oracle — never by copying the implementation's output.

**The probe gate (Principle V).** Research concluding a dependency handles something "for free" must
have been exercised against at least one **non-ASCII**, one **boundary**, and one **adversarial**
input before that conclusion is written down. This exists because two conclusions drawn from an
ASCII-only probe were both wrong and would have silently corrupted every span in a non-ASCII
document.

**Sabotage-test every empirical claim.** A green test proves nothing until you have watched it go
red. Deliberately break the code a test claims to guard, confirm that specific test fails, restore.
Protocol:

1. Back up to `/tmp` **before** sabotaging. `git checkout --` on uncommitted work destroys it.
2. Mark the sabotage with a `SABOTAGE` comment.
3. `grep -rn SABOTAGE src/ tests/` before trusting any result, and before committing.

This discipline has found real defects every time it has been applied: a merge-precedence guard that
passed while broken, BOM handling that was correct only by an unexamined default, and the depth cap
turning out to be a genuine second line of defence against runaway recursion.

**Flag governance defects; do not fix them.** If `SPEC.md` or the constitution is wrong, say so in
your report. Amending them is not an implementer's call — Principle I exists precisely so those
documents cannot be edited by whoever finds them inconvenient.

**Report ambiguities unsoftened.** Every place a document was silent, contradictory, or wrong, and
every detail you had to invent. Do not omit them because the code works anyway. Across five
milestones, nearly every substantive defect has been in the artifacts rather than the code — this
section of a report has been worth more than the diff.

## Known traps, all discovered the hard way

- **`yaml`'s `range` values are UTF-16 code-unit indices, not byte offsets**, and
  `LineCounter#linePos().col` counts code units, not code points. Both must be converted. They agree
  for ASCII, which is why an ASCII-only probe missed it.
- **`Object.freeze` does nothing to a `Map`.** `.set()`/`.delete()` operate on an internal slot, not
  a property. `src/model/freeze.ts` wraps entries in a Proxy.
- **`TextDecoder`'s `ignoreBOM` is a double negative.** The default `false` means the decoder *does*
  strip a leading BOM. Set it `true` so stripping happens in exactly one place.
- **`JSON.stringify` renders any `Map` as `{}`.** Debug output showing an empty tree is probably your
  tooling, not the bug.
- **A synchronous `throw` inside a non-`async` function returning a Promise is not a rejection.**
  `.rejects.toThrow()` will not catch it.
- **`yaml` silently accepts** complex keys, non-string scalar keys (`1:`, `true:`), and non-core tags
  (`!!binary`, `!!timestamp`, `!!set`, `!!omap`), and builds a **circular structure** for alias cycles
  without error. All four are Cascata's to enforce.
- **Sorting strings by JS default (`<`, `sort()`, `localeCompare`) is UTF-16 order, not code point
  order.** They disagree above the BMP. The model sorts by code point.
- **A JS object cannot enumerate in canonical order.** ECMA-262's `OrdinaryOwnPropertyKeys` returns
  every **array-index** key — a canonical numeric string in `[0, 2^32−2]` — first, in ascending
  numeric order, ahead of every other key, which then follow in insertion order. `"4294967295"` is
  one past the last index and is *not* hoisted; neither are `"-0"` or `"01"`. `Object.create(null)`
  changes nothing about this. Article VII says the value view *inserts* keys canonically, which is
  all that is achievable.
- **`Number.isSafeInteger` is the wrong test for "is this `bigint` exactly a double".** 2^53, 3·2^52
  and 2^60 are all exactly representable and all fail it. The predicate is the round trip,
  `Number.isFinite(n) && BigInt(n) === v` — and the `isFinite` guard is load-bearing, since
  `Number(2n ** 1024n)` is `Infinity` and `BigInt(Infinity)` throws.
- **`Object.create(null)` is what makes `__proto__` an ordinary key.** On `{}`, `o["__proto__"] = v`
  sets the prototype and creates no own property at all — silently, and a configuration key is
  author-controlled. This bit v1.1 again, in a *test fixture*: an object literal written to exercise
  the literal writer had five own properties instead of six, and the assertion was right.
- **TypeScript's `{}` admits every non-nullish value**, so it is never the type of "a mapping with no
  keys". That is `{ readonly [key: string]: never }`.
- **TypeScript's excess-property check fires on object literals only.** A value reaching a closed
  type through a variable is accepted structurally. It is why the soundness oracle writes literals,
  and why `seal: closed` is a partial promise in the emitted type rather than a total one.
- **`number & bigint` is `never`, and an open index signature survives `&` with a closed object
  type.** Both are why v1.1 emits from one accumulated tree rather than joining per-layer emissions:
  `&` preserves neither the numeric rule nor a seal.
- **`url` and `path` are refinements of `string` (§7), not siblings of it.** A rule that intersects
  built-ins "only with themselves" makes `string ∩ (url | path)` empty and turns §7's own worked
  `resource` into `never`. The corpus caught it; nothing else would have.

## Conventions

- **`SPEC.md` is frozen as of v1.0** (§15's freeze rule). A *correction* is always permitted; an
  *addition* is permitted while no existing meaning changes; **changing an existing meaning requires
  v2.0**. The engineering constitution does not freeze — it governs process, not the language.
- Conventional commits. End messages with the co-author trailer for whichever model authored them.
- Never amend, rebase, or force-push. Add commits.
- Tick task checkboxes in `specs/NNN-*/tasks.md` as you complete them.
- `pnpm typecheck` and `pnpm test` green before you stop. Never leave the tree dirty.
- **Existing tests must stay green, and must not be weakened to accommodate new work.** If a test
  needs changing, say why in the report — a passing suite achieved by relaxing an assertion is worse
  than a failing one.
