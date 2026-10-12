# Feature Specification: `shifted` and `amend` — Two Verbs for a Caller That Rebases

**Feature Branch**: `026-shift-and-amend` (committed on `main`)

**Created**: 2026-10-12

**Status**: Approved by the owner, 2026-10-12 (implemented by the coordinator)

**Input**: Provenance's insert-and-delete round (that repository's `specs/insert-delete/spec.md`). Two of the
owner's rulings there need an answer only the format can give, because Provenance keeps paths opaque —
"the writer owns them":

- **The shift guard** (Provenance ruling 7): a staged edit whose path runs through a list that changed length
  since its base is conflicted, so an index never silently names another item. Only the format knows which
  steps of a path are list indexes.
- **Amending inside a staged insertion** (Provenance ruling 6, and the owner's ruling that the writer amends, not
  Provenance): an edit whose path lies inside a staged insert changes the staged value. Only the format knows
  whether a path is inside another and how to apply an operation below it.

**Ships as v1.16.** `SPEC.md` Article IX, §14 and §15 are amended in the same commit.

- **FR-001** `OpenedDocument.shifted(pointer, newer)`: true when some step of `pointer` whose parent is a sequence
  in either version is not `-` and the two versions do not both hold sequences of one length there. A prefix
  absent from either version stops the walk with false (that is `locate`'s "gone", not a shift). The two trees
  are the models, so formats may differ. `newer` must be a document this library opened; anything else is
  programmer error (`TypeError`).
- **FR-002** `OpenedDocument.amend(staged, operation)`: `{ inside: false }` unless `operation.path` is strictly
  below `staged.path` (RFC 6901 prefix plus `/`); else RFC 6902 applied to `staged.value` at the remainder, with
  Cascata's meanings — `add` creates (a key that exists is refused; an index up to the length, or `-`), `set`
  changes (an absent key or the end is refused), `remove` deletes (`-` names nothing). Refusals are answers with
  a reason. The staged value is never changed: every container along the path is rebuilt. Values are checked as
  `setValue` checks them; malformed pointers and non-`EditData` throw.
  `inside(pointer, within)` answers the question `amend` asks first, for a caller that only needs to know (a staged
  delete, inside which every edit is refused).
- **FR-003** A writer's opened document answers all three; its `shifted` takes another writer document of this library.
- **FR-004** Cases before code (`tests/unit/shift-amend.test.ts`, hand-derived); each rule sabotaged: shifted
  always false (6 red), the `-` exemption (1), a kind change (1), an absent prefix (1), the slash in the prefix test
  (1), the copy along the path (5), `add` over an existing key (1), `set` at the end (0 red at first — two cases
  added, then 1).

## Revision after Provenance's report (v1.16.1)

- **FR-005** **A writer's refusal names its code.** Every `{ ok: false }` a writer answers — the one-shot verbs, an
  opened document's, and `open` itself — carries `code`, the first diagnostic's code, beside `reason`, its message.
  Provenance's implementer found that a rebase cannot tell "the key exists" from "the parent is gone" from a message:
  paths are opaque, so it had guessed by locating the key again, which mislabels an index insert. Cascata already had
  the codes (`edit-target-exists`, `edit-parent-scalar`, `edit-target-absent`, …) and flattened them to prose. A
  refusal with no diagnostic is now an internal error rather than a made-up message. Cases in
  `tests/unit/writer-codes.test.ts`; the v1.11 equivalence test now also requires the code. Sabotage (every code
  `edit-target-absent`): 34 red.
