# Feature Specification: Edit Targets, and Writers

**Feature Branch**: `020-edit-targets` (committed on `main`)

**Created**: 2026-10-08

**Status**: Draft

**Input**: the two pieces issue #7 moved to the joining step, plus the writer shape the joining step
needs. The joining step itself is Provenance's (its `specs/joining/`), and depends on this release.

**Implements**: `SPEC.md` Article IX's two new laws (§19, "Which document an edit belongs in" and
"The shape of a writer"), §14 item 13, §15 entry "Edit targets, and writers" (v1.11). All written.
**Do not edit `SPEC.md`.** Additions only: nothing read changes, nothing accepted is refused.

## Requirements

- **FR-001** **`why()` entries carry `pointer`**: the RFC 6901 pointer of the entry's value *inside its
  own document* (`span.origin`), for every entry of a `chain` and every contributor of a
  `synthesized` result. For a config layer it usually equals the merged pointer; for a value grafted
  from a delegated fragment, the fragment's own pointer; for a schema's `provide`, the pointer to the
  provided value inside the schema document. Derive it from the document's own tree (the node whose
  span is the entry's span), not by string arithmetic on the merged pointer.
- **FR-002** **`editTarget(configuration, pointer)`** answers `{ ok: true, location, pointer, format }`
  — the winning value's document (its `origin.id`), the pointer inside it (FR-001), and `"yaml"` or
  `"json"` — or `{ ok: false, diagnostics }`. It reads no file.
- **FR-003** **Refusals**, each `level: "error"`:
  - `edit-target-absent` — no value at the merged pointer (`why()` answers `unknown-pointer`);
  - `edit-unsupported` — a container (`synthesized`, or a chain whose winning value is a mapping or
    sequence);
  - `edit-target-inherited` (new) — the winning value was supplied by a **schema** layer's `provide`;
    primary at that value's span, message naming the schema's location and saying the edit would
    change a default every document under it shares;
  - `edit-target-remote` (new) — the winning value's document was read over `https://`.
- **FR-004** **Accumulated lists**: a pointer to one item of a key under `cascade: append` targets the
  document that contributed that item. A pointer to the whole list is a container (FR-003).
- **FR-005** **Writers**, from a new entry point `@egildo/cascata/writers`: `yamlWriter()` claims
  `.yaml` and `.yml`, `jsonWriter()` claims `.json` (case-insensitive extension). Each is
  `{ claims(location), locate(bytes, path), write(bytes, path, value) }`, where `path` is a pointer and
  `locate`/`write` answer `{ ok: true, start, end }` / `{ ok: true, edit: { start, end, bytes } }` or
  `{ ok: false, reason }`, the reason being the first diagnostic's message. They are `locate` and
  `setValue` with a synthetic origin; they add no behaviour. Nothing names or imports Provenance.
- **FR-006** **Exports and docs**: `editTarget` and its result type from `@egildo/cascata`; the two new
  codes in `src/diagnostics/codes.ts` with contract rows in `docs/reference.md`; the new entry point
  in `package.json`'s `exports` (both spellings, as `paths` has).

## Conformance

A small cascade fixture, in memory: a root schema that `provide`s `defaults: { height: 3.0 }` and
`walls` items demanding `height`; a project config adopting it with `walls: { W1: { height: 3.2 } }`;
an override document with `walls: { W2: { height: 2.8 } }`; a config key delegating to a fragment
`levels.yaml` holding `L1: { elevation: 0 }`. Expected answers by hand:

| Merged pointer | Expect |
|---|---|
| `/walls/W1/height` | project config, `/walls/W1/height`, yaml |
| `/walls/W2/height` | override document, `/walls/W2/height` |
| `/defaults/height` | `edit-target-inherited`, naming the root schema |
| the delegating key's `/L1/elevation` | `levels.yaml`, `/L1/elevation` |
| `/walls/W3/height` | `edit-target-absent` |
| `/walls/W1` | `edit-unsupported` |
| a value from a document read over `https://` (recorded transport) | `edit-target-remote` |

Plus `why()` on each of those carrying the same in-document pointer (FR-001), and a JSON variant of
the project config. **Writers**: for every 018 write case, `yamlWriter().write` / `jsonWriter().write`
give the same edit as `setValue`, and `locate` the same range; `claims` by extension, including
`.YAML` and a location with no extension (unclaimed).

**Sabotage**, each watched red and restored: derive the in-document pointer from the merged pointer
(the delegated row red); treat schema layers as targets (the inherited row red); drop the remote
check (the remote row red); claim `.yaml` in the JSON writer (a claims case red).

## Plan and tasks

One plan file. Commit each step when `pnpm typecheck && pnpm test` is green: (1) FR-001; (2) FR-002 to
FR-004; (3) FR-005; (4) FR-006, docs, `specs/020-edit-targets/report.md`. Do not bump the version.
Check every sentence of Article IX's two new laws against the code and report each disagreement.
