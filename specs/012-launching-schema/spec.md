# Feature Specification: The Launching Schema

**Feature Branch**: `012-launching-schema`

**Created**: 2026-09-02

**Status**: Implemented

**Input**: Egildo, planning BelType's embedding of Cascata (2026-09-02): "loadOptions seems fine. I think we can spot the absence of frontmatter and search for something for Cascata to eat." The embedder's shell knows which schema governs a document whose author wrote no `$schema`; Cascata had no way to be told.

**Implements**: `SPEC.md` Article VI (§16), the "one call" law: an embedding is a single `load()` from a launching point to a configuration. The launching point was the entry document; this milestone lets the embedder also name the launching **schema** for an entry that names none. §8.1's reading of a config's own reference as author consent is what decides the option's authority.

**This is an addition under §15's freeze rule.** An entry document that resolved before this milestone resolves to the same graph, pedigree and value after it: the option is consulted only where the entry names no `$schema`, and then only when the embedder passes it. No keyword changes meaning; no document that was valid becomes invalid.

**Why it is not written into the document instead.** The embedder this was built for hands Cascata a Markdown file's frontmatter as a position-preserving redaction: the whole file with every byte outside the frontmatter blanked, so that every diagnostic lands on the author's real line. Inserting a `$schema:` line would shift every offset by one line and reintroduce the arithmetic the redaction exists to remove. The only other alternative, synthesizing a second document that `$adopts` the schema and somehow admits the frontmatter's values, has no shape in this vocabulary: a schema carries values only as `provide`, and a config cannot be adopted.

## User Scenarios & Testing

The user is **the embedder**, Article VI's host author. Their tool serves documents written by people who never heard of Cascata. Some of those documents name a `$schema`; most do not; a few carry no frontmatter at all. The tool knows, by its own probe, which schema governs a silent document: the nearest venue file walking up from the document's directory, or the schema the tool ships. They want to say so in the one call, and to have every other rule apply unchanged.

- **Used.** An entry with no `$schema`, the option naming `./root.yaml`: the chain is walked from that schema, the root's `provide` reaches the value, the pedigree carries the schema as config-authored, and the reference that brought it in is anchored at a phantom span in the entry document (line 1, column 1, zero width), since no position in any document wrote it. (`launching-schema-used.json`; unit FR-001)
- **Ignored.** An entry with an authored `$schema`, the same option: the authored chain governs and the option's document is never asked for. (`launching-schema-ignored.json`; unit FR-002)
- **Config-authored.** The option's text is read exactly as if the entry had written `$schema: <text>`: relative to the entry document's directory, a leading `~/` expanded, exempt from the sandbox. (`launching-schema-tilde.json`)
- **Unreachable.** The option names a document the host cannot supply: `document-unreachable`, anchored at the entry document, never a throw. (`launching-schema-unreachable.json`; unit FR-004)
- **Not for schemas.** `generateTypes()` takes the same options type and ignores the field: its entry is a schema, and a schema with no `$adopts` is simply the chain's root. (unit)

## Requirements

- **FR-001** `ResolveOptions` (and so `LoadOptions`) accepts `schema?: string`. When the entry names no `$schema` and the option is present, resolution proceeds as if the entry had written `$schema: <schema>`.
- **FR-002** An authored `$schema` always wins. The option is not read, fetched, or validated when the entry names one.
- **FR-003** The reference the option becomes is `kind: "schema"`, `authority: "config-authored"`, with a zero-width span at the entry document's origin. Every rule that reads authority (tilde expansion, sandbox exemption) applies as for a config's own reference.
- **FR-004** A launching schema the host cannot supply is refused with the same diagnostic an unreadable authored `$schema` produces, anchored at the entry document. Nothing about the state of the world throws.
- **FR-005** `generateTypes()` ignores the option.

## Out of scope

- A default for the option. There is none; Cascata infers nothing from the entry's location (v0.2 FR-022's posture, kept).
- A way for the embedder to name a schema **in addition to** an authored one. The chain is authored; the option is a stand-in, not a rung.

## Conformance

Four resolve-conformance cases under `tests/corpus/resolve-cases/launching-schema-*.json` with fixtures under `tests/corpus/cases/launching-schema/`, hashes hand-derived with `shasum -a 256`; `tests/unit/launching-schema.test.ts` for the embedder's view through `load()` and `generateTypes()`. The corpus case format gains an optional `schema` field and admits `v1.3 FR-n` citations.

## Plan and tasks

One file rather than the milestone folder's usual seven. The change is one optional field, one branch in `resolveEntry`, and one `createReference` call; a `plan.md`, `research.md`, `data-model.md` and `contracts/` would each be a paragraph restating this page. Complexity Tracking: the constitution's flow was shortened for a change whose whole design fits in the requirement list above, and the report says what was found. Tasks, in the order done: the corpus cases and the unit test first (all five red against `main`), then the option and the branch, then `SPEC.md` §16 and §15, the README, the version.
