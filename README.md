<p align="center"><img src="docs/logo.svg" alt="Cascata" width="360"></p>

**Configuration that cascades like CSS, but where the house rules can't be overridden.**

Cascata is a TypeScript library a tool embeds to turn a folder of human-readable documents into one validated configuration object. Every document in the chain is both data and contract: it can provide values, impose rules on the documents below it, and say how far those documents may go. The library walks the chain, enforces every rule it finds, and hands back an object that knows where each value came from — or refuses, naming the document, the line, and the rule that was broken.

```
$ my-tool build
site.yaml:3  expected min 3000, got 80
             constraint from house.yaml:8 rejected value from site.yaml:3
```

- **One runtime dependency** (`yaml`). No I/O of its own: it asks its host for every byte, so it runs in Node, in a browser, or inside your own sandbox.
- **Monotone.** A descendant can tighten what an ancestor demanded and can never loosen it. An organization's standards stay standards five layers down.
- **Provenance on every value.** `why(config, "/port")` answers the `git config --show-origin` question for any key.
- **Self-hosting.** The schema language is described by a schema written in itself and validated by the same pipeline.
- **Types for free.** `generateTypes()` prints a TypeScript declaration from the schema chain, sound against the validator.
- **Format-blind.** YAML and JSON today, one positioned information model above the adapter; provenance survives whichever format a document was written in.

## The problem

Every tool that reads configuration ends up with layers: a built-in default, an organization-wide file, a per-project file, a flag on the command line. Every configuration library will merge those layers for you. None of them will let the organization say *"and the project may not change this"* and have it hold.

So the house standard becomes a convention, enforced by code review, and it erodes. And when a value finally comes out wrong, the question *which file set this?* has no answer except reading all of them.

Cascata makes the guarantee structural. Constraints only accumulate down the chain. Authority flows one way: an ancestor declares what descendants may do, and a child cannot grant itself permissions. There is no `!important`, and the specificity war CSS is famous for cannot start.

## Sixty seconds

A root schema, published by whoever owns the tool:

```yaml
# core.yaml — the root schema
$id: site-builder/core
$version: 1
types:
  resource:
    accept: [url, path]
    demand:
      type: string
keys:
  styles:
    demand:
      type: "resource[]"
      required: true
    cascade: append
  port:
    demand:
      type: int
      min: 1024
      max: 65535
    provide: 8080
```

A house layer, adopting it and tightening it. It adds a default stylesheet and raises the floor on `port`, then seals it:

```yaml
# house.yaml — the organization's layer
$id: site-builder/house
$adopts: ./core.yaml
keys:
  styles:
    provide: [https://cdn.house.dev/base.css]
  port:
    demand:
      min: 3000
    final: true
```

And the config a project author actually writes:

```yaml
# site.yaml — the config
$schema: ./house.yaml
styles:
  - ./theme.css
```

Load it:

```typescript
import { load, why } from "@egildo/cascata";
import { createNodeHost } from "@egildo/cascata/host/node";

const result = await load("./site.yaml", { host: createNodeHost(), sandboxRoot: process.cwd() });

if (result.ok) {
  result.value;
  // { port: 8080n, styles: ["https://cdn.house.dev/base.css", "./theme.css"] }

  const origin = why(result.configuration, "/styles");
  if (origin.kind === "chain") {
    origin.entries.map((e) => [e.span.line, e.outcome]);
    // [[5, "accumulated"], [3, "accumulated"]] — house.yaml:5, then site.yaml:3; nobody "won"
  }
}
```

`styles` accumulated because the root declared `cascade: append`. `port` is `8080n`, a `bigint`, because the schema said `int` and Cascata keeps integers exact at any magnitude rather than rounding them through a double.

Now a project author writes `port: 80`. The result is not `ok`, and the diagnostics say why, twice — once per layer whose rule was broken, root first:

```
range-violated  site.yaml:3  expected min 1024, got 80 — constraint from core.yaml:17 (/keys/port/demand/min) rejected value from site.yaml:3
range-violated  site.yaml:3  expected min 3000, got 80 — constraint from house.yaml:8 (/keys/port/demand/min) rejected value from site.yaml:3
```

Every diagnostic carries the position of the value, the position of the demand it violated, a JSON pointer to both, and which layer of the pedigree made the demand. The message is one rendering of that; a tool is free to make its own. The library never prints.

## What a document can say

Rules are written in the host format, the way JSON Schema is JSON describing JSON. The vocabulary is closed and declarative, so two schemas can be compared without running anything:

| Keyword | Meaning | Composes by |
|---|---|---|
| `demand` | a constraint: `type`, `required`, `enum`, `min`/`max`, `minLength`/`maxLength`, `pattern`, `accept`, `keys`, `items`, `values`, `seal` | intersection, only ever narrower |
| `provide` | a value injected where the config is silent | replaced or appended downstream, unless sealed |
| `cascade` | `replace` (default) or `append`, per key | may tighten toward `append`, never back; under `append` a single value is taken as a list of one, with a notice |
| `final` | freezes a key from this layer down | cannot be undeclared |
| `delegate` | lets a config load a fragment from another file into this key, sandboxed and validated in place | per-key grant, never inherited by accident |
| `types` | named types, narrowable by descendants | narrowing tightens every usage at once |

Type expressions are a tiny algebra of names: `string | string[]`, `resource[]`, `(int | float)[]`. No literals, no lambdas, no template language. That restraint is what makes subsumption between two schemas decidable, and what keeps a schema readable by someone who did not write it.

The full vocabulary, its monotonicity table, and the worked examples live in [`SPEC.md`](SPEC.md).

## Types from the chain

The same chain that validates a config can describe its shape:

```typescript
import { generateTypes } from "@egildo/cascata";

const generated = await generateTypes("./house.yaml", { host: createNodeHost(), sandboxRoot: process.cwd() });
console.log(generated.source);
```

```ts
export type resource = string;

export type house = {
  /**
   * @demand max: 65535 (core:16)
   * @demand min: 3000 (house:8)
   */
  readonly port: bigint;
  readonly styles: readonly resource[];
  readonly [key: string]: unknown;
};
```

The emitted type is checked for soundness against the validator: every configuration the validator accepts, over the whole conformance corpus and the meta-schema itself, is typechecked against the type generated from its chain. Where TypeScript cannot express a demand (a range, a pattern), the demand appears in a doc comment with its origin, so the type never claims a precision it cannot keep.

## Where it runs

The library performs no I/O. `load()` takes a `host`, and the host answers for reading a document, canonicalizing a location, and caching. A Node host ships in the box:

```typescript
import { createNodeHost, createNodeTransport } from "@egildo/cascata/host/node";

await load("./site.yaml", {
  host: createNodeHost({ cacheDir: ".cascata-cache" }),
  transport: createNodeTransport(), // only if schemas live behind https://
  sandboxRoot: process.cwd(),
});
```

Everything under `src/` except that one file is free of `node:` imports, and a test enforces it. A browser, a Deno worker, a virtual filesystem in a test suite, or a host that resolves `$adopts: myapp:document` to a package-local file are all a `Host` implementation away.

Remote schemas are pinned by SHA-256 (`$pin`), fetched over HTTPS only, cached per RFC 9111, and a document's own text can never reach outside the sandbox roots the embedder chose — `sandboxRoot` is a location or a list of them, granted and never inferred, so a house schema shared across projects is reachable exactly when the embedder says so. Delegation to a remote fragment is available only where the host supplies it and the user has opted in, never because a schema asked.

## Install

Cascata is not on npm yet (the name is taken by an unrelated package). Install from git, using a `-dist` tag, which carries the built output so consumers need no compiler:

```bash
pnpm add "git+ssh://git@github.com/egildo/cascata.git#v1.15.0-dist"
```

Node 22 or later. TypeScript declarations are included. Exports: `@egildo/cascata`, `@egildo/cascata/generate`, `@egildo/cascata/paths`, `@egildo/cascata/writers`, `@egildo/cascata/host/node`.

## Read next

| | |
|---|---|
| [`docs/reference.md`](docs/reference.md) | the API, release by release: every function, every type, every diagnostic code |
| [`SPEC.md`](SPEC.md) | the language — motivation, design principles, the cascade semantics, the syntax, the security model, and the amendment log that records every decision and why |
| [`specs/`](specs/) | one folder per milestone: spec, plan, research, data model, contracts, and the implementer's report |
| [`meta/cascata.meta.yaml`](meta/cascata.meta.yaml) | the meta-schema. Cascata describing itself, and validating itself with the same pipeline |
| [`tests/corpus/`](tests/corpus/) | the conformance corpus: format-agnostic cases each adapter must pass |

## Status

**v1.15.0.** v1.13 gave every document a logical and a physical path, identity being the physical one. v1.14 brought `glob` back: checked like a `path`, expanded by `expand()` through the host. v1.15 opens a document once and answers many lookups and edits against it, adds `add` and `remove` (entries inserted in their neighbours' style, removed with their attached comments), and writes containers. A new whole `number` is written as a decimal and a `bigint` as an integer, and each release's changes of behaviour are named in `SPEC.md` §15.

The specification was frozen from v1.0 to v1.12 — every release in that span was an addition, a correction, or both, and nothing a schema meant changed. At v1.12.1 the freeze was retired: `SPEC.md` is now a living document, amended by named article with an entry in its §15, which names every change of behaviour in a sentence. v1.12.1 itself refuses three things that used to load (a second `<<` merge key, an unknown keyword in a type entry, a malformed type entry) and splits one diagnostic code into four.

The pipeline, in the order the library runs it:

```
text → adapter → positioned model → resolve → graph → merge → validate → project → typed value
```

Each stage is public and independently callable. `load()` is the composition.

Not in v1, by decision rather than omission: rewriting whole configuration files (Cascata writes back one value at a time, in place — `SPEC.md` Article IX), arbitrary computation in schemas, and a command-line tool. Cascata is the library a tool embeds; the tool owns the command line.

## Working on it

```bash
pnpm install
pnpm test        # the conformance corpus and the unit suite, then the wall-clock tests, serially
pnpm typecheck   # tsc --noEmit, strict, noUncheckedIndexedAccess
pnpm build       # emit dist/
```

`CLAUDE.md` describes the working method; the short version is that conformance cases are written before the code that judges them, every empirical claim is sabotage-tested, and no test may reach the network.

## License

MIT.
