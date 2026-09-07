# Feature Specification: Overrides

**Feature Branch**: `014-overrides`

**Created**: 2026-09-07

**Status**: Implemented

**Input**: Egildo, designing a command-line door for BelType's configuration (2026-09-06): "either you add flags in your shell command, or there is a conf piece of file for it (frontmatter, yamls anywhere Cascata can point you), you compose a configuration. The rest follows." BelType's embedding held the operator's values in a deep merge applied *after* `load()` returned, where no demand, no `final` and no `why()` could reach them. Cascata had exactly one config-role layer, the entry document, and no seat nearer than it.

**Implements**: `SPEC.md` Article VI (§16), the "one call" law, carried one step further than the launching schema took it: v1.3 let the embedder name the schema an entry did not write; this milestone lets the embedder name **config documents the entry did not write**, ranked after it. Article II's cascade semantics (§5) apply to them unchanged, which is the whole reason to do it inside the library rather than beside it.

**This is an addition under §15's freeze rule.** Absent the option, resolution is v1.5's to the byte: no document that resolved before this milestone resolves differently after it, no keyword changes meaning, and the only new diagnostic code fires on a document that could not exist before the option did.

**Why it is not a document.** Three shapes were tried against the vocabulary and none of them holds. A file nearer than the entry has no seat: §6.1's chain excludes the entry document, so nothing stands below it. Delegation grafts a fragment into the delegating document's *own* layer (§8.2), horizontally, and can neither outrank its parent nor carry a `$`-key. And "delegate and start a layer" is a keyword §8.4 and §14 reserve for the future, with laws of its own that this milestone does not write. The one thing that fits is what the launching schema already is: an embedder's option, supplied in the one call, standing in for a line nobody wrote.

**Why it is not the embedder's merge.** Merging over the projected value after `load()` returns is what BelType did, and it works until it matters: a venue that demands `depth ≤ 3` does not see `--set depth=9`, a key the house sealed `final` is set anyway, and `why()` answers with the document that lost. Cascata's promise to the organization (§1: a house standard five layers down is still a standard) stops at the entry, and the command line is where a scripted build most needs it to hold.

## User Scenarios & Testing

The user is **the embedder**, Article VI's host author. Their tool takes `-c extra.yaml` and `--set key=value` on its command line, mints each into a document behind a location its host answers, and wants every rule of the cascade to bind them exactly as it binds the document's own frontmatter.

- **Used.** An entry with a `$schema`, one override: the chain is walked from the entry as before, the override is read after it, and the merged value carries the override's `title` where the entry's was. The graph lists the override beside the entry and its chain, and the pedigree is unchanged, because an override is a layer and not a rung of the chain. (`overrides-used.json`; unit FR-001)
- **Absent.** The same entry with no option: v1.5's result, and the override is never asked for. (unit FR-001)
- **Ordered.** Two overrides: the later outranks the earlier, and both outrank the entry. Reversing the list reverses the answer. (`overrides-ordered.json`; unit FR-002)
- **Governed.** A schema's demand refuses an override's value with the override's own span as primary; a key an ancestor sealed `final` with `provide` is refused when an override sets it. (unit FR-003)
- **Accumulated.** A key under `cascade: append` accumulates the entry's items and then each override's, in rank order. (unit FR-004)
- **No directives.** An override whose root mapping carries a `$`-prefixed key is refused as `override-reserved-key`, primary at that key's value. (`overrides-reserved-key.json`; unit FR-005)
- **Answerable.** `why()` on a value an override won names the override's layer: role `config`, its own identity, the highest rank in the configuration. (unit FR-006)
- **Located.** The option's text may be a scheme the host owns: `beltype:cli` is offered to `locate` and read at the location the host answers, exactly as a `$schema` in that scheme would be (v1.4). A scheme no host claims is `unsupported-scheme`, anchored at the entry. (`overrides-located.json`; unit FR-007)
- **Unreachable.** An override the host cannot supply is `document-unreachable`, anchored at the entry document, never a throw. (`overrides-unreachable.json`; unit FR-008)
- **Delegating.** A key the pedigree grants `delegate: allow` delegates from inside an override as it does from the entry, relative to the override's own location. (unit FR-009)
- **Two of a kind.** Two overrides with identical bytes are two layers. Nothing is deduplicated, because an override is a layer and not a node of the adoption graph. (unit FR-010)
- **Not for schemas.** `generateTypes()` ignores the option: its entry is a schema, and there is no configuration for an override to outrank. (unit FR-010)

## Requirements

- **FR-001** `ResolveOptions` (and so `LoadOptions`) accepts `overrides?: readonly string[]`. Each text is read as a **config-authored** reference anchored at a phantom span in the entry document: a relative text resolves against the entry document's directory, a leading `~/` expands, a scheme the library does not understand is offered to `Host.locate`, an `https://` text goes through the transport. Each document read becomes a config-role layer ranked after the entry, in the order given. Absent or empty, nothing changes.
- **FR-002** The fold treats an override as it treats any layer: mappings merge deeply, everything else replaces, and a later override outranks an earlier one and the entry.
- **FR-003** Whole-chain validation runs over the merged tree with the overrides folded in, so every demand, every `final` and every seal refuses an override's value the way it refuses the entry's, with the override's own span as the diagnostic's primary.
- **FR-004** A key a schema declared `cascade: append` accumulates the overrides' contributions after the entry's, in rank order.
- **FR-005** An override's root mapping carries no `$`-prefixed key. One is refused as `override-reserved-key`, `level: "error"`, primary at the offending key's value. The pedigree is the entry's; an override starts none.
- **FR-006** An override is a `Layer` with `role: "config"` and its own identity, so `why()` and every diagnostic name it at its own location, line and column.
- **FR-007** A located or remote override is read by the code that reads every other located or remote document. A scheme no host claims is `unsupported-scheme` at the phantom span.
- **FR-008** An override the host cannot supply is `document-unreachable`, anchored at the entry document's phantom span. Nothing about the state of the world throws.
- **FR-009** The pedigree's delegation grants graft into each override as they graft into the entry, resolved against the override's own location, under the same sandbox and remote rules.
- **FR-010** Overrides are not registered with the graph builder: identical bytes are two layers, and `generateTypes()` ignores the option.
- **FR-011** `Graph` gains an additive optional `overrides` field; absent reads as none, so every hand-built graph in the test suite is unchanged. `deriveLayers` pushes them after the entry.

## Out of scope

- A `$`-key in an override. An override that named its own `$schema` would be a second entry, which is the "delegate and start a layer" question with its own laws, not this one.
- A default. There is none; nothing is inferred from the entry's location or the process.
- A sandbox check on the option's text. The embedder chose it, which is the same consent §8.1 reads into a config's own reference and v1.3 reads into the launching schema. What an override's own text then reaches (its delegations) is checked as any config's is.
- A merge-corpus case at the value level. The resolve corpus pins the graph; the unit tests pin the value, provenance and refusals through `load()`, as 012's report noted the format cannot.

## Conformance

Five resolve-conformance cases under `tests/corpus/resolve-cases/overrides-*.json` with fixtures under `tests/corpus/cases/overrides/`, hashes derived with `sha256sum` over the fixture bytes and never copied from a run; `tests/unit/overrides.test.ts` for the embedder's view through `load()`, `why()` and `generateTypes()`. The corpus case format gains an optional `overrides` list on the case and an optional `overrides` list under `expect` for a successful resolution, and admits `v1.6 FR-n` citations.

## Plan and tasks

One file and a report, on 012's and 013's precedent: the change is one optional field, one loop after the chain walk, one push in `deriveLayers`, one diagnostic code, and a walk of each override for delegation. Complexity Tracking: the constitution's seven-file flow was shortened for a change whose whole design fits the requirement list above; the report says what was found. Tasks, in the order done: the corpus cases and the unit test first, red against `main`; then the option, the loop, the field and the push; then `SPEC.md` §16 and §15, the README, the version.
