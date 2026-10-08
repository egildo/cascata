# Implementation Plan: Edit Targets, and Writers

**Spec**: [spec.md](./spec.md) · **Implements**: `SPEC.md` §19 (Article IX, the two v1.11 laws), §14 item 13, §15 "Edit targets, and writers" (v1.11)

**Complexity Tracking note**: one plan file on the 012-019 precedent. One new public function (`editTarget`),
two new codes, one new entry point (`@egildo/cascata/writers`), one new field on an existing result. No version bump.

## Approach

| FR | Where | How |
|---|---|---|
| FR-001 | `src/model/pointer.ts` (`pointerInDocument`), `src/merge/provenance.ts` | An iterative walk of the entry layer's own tree for the node whose span (origin id, start, end) is the entry's span; the pointer is built from that walk, restarting at a delegated fragment's root. Aliases and merge keys give several nodes one span (positions attribute to the anchor's content, §4.2), so among equal spans the one equal to the merged pointer being asked about wins, else the first in walk order. `why()` attaches it at answer time, as it attaches `delegatedFrom`: the stored record is untouched. |
| FR-002 | `src/edit-target.ts` | Resolve the merged node; the document is the layer whose own tree holds a node with that node's span (nearest layer first). Location is `origin.id`, or `origin.label` for a delegated fragment (its id is `<location> #graft=N`). Format from `formatForLocation`. Outside the policed directories, because it needs the adapter registry. |
| FR-003 | same | Order of refusals: absent, container, inherited (schema role), remote (`https://`). Primary spans: nearest existing ancestor (absent), the merged node (container), the value in its own document (inherited, remote). |
| FR-004 | same | An item of an accumulated list is a merged node with its own span, so the same lookup finds its own document and its index inside it. |
| FR-005 | `src/writers.ts` | `yamlWriter()`, `jsonWriter()`: `claims` by case-insensitive extension; `locate`/`write` call `locate`/`setValue` with a synthetic origin and answer `{ok:false, reason}` with the first diagnostic's message. |
| FR-006 | `codes.ts`, `docs/reference.md`, `package.json`, `src/index.ts` | `EDIT_TARGET_CODES`; contract rows; `./writers` and `./writers.js` exports. |

## Tasks

- [x] T1 (step 1): tests for `why()` pointers, red; `pointerInDocument`, `why()`; green; commit.
- [x] T2 (step 2): tests for `editTarget`, red; the module, codes, export; green; commit.
- [x] T3 (step 3): tests for writers (018 write-cases equivalence, claims), red; `src/writers.ts`, `package.json`; green; commit.
- [x] T4 (step 4): docs/reference.md, report, sabotage table; green; commit.
- [x] T5: sabotage runs (four from the spec, plus mine), each watched red and restored.
