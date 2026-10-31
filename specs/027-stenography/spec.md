# Feature Specification: The Stenographer Contract

**Feature Branch**: `027-stenography` (committed on `main`)

**Created**: 2026-10-31

**Status**: Approved by the owner, 2026-10-31

**Input**: the stenographer contract (0km's `proposals/stenography-contract.md`), published as
`@stenographers/stenography` 0.1.0: seven laws a writer meets, and a suite that checks them. The plan ruled there
is that Cascata's YAML and JSON writers run the suite inside Cascata first. Its first run found three places where
they broke the laws, and the owner ruled that Cascata changes to meet them.

**Ships as v1.17.** `SPEC.md` Article IX, §14 and §15 are amended in the same commit.

- **FR-001** *Nothing changed* first. A value set to what it already holds answers the edit whose bytes are the
  bytes already there before any refusal is asked: a shared value (anchored and aliased, or reached through an
  alias or merge key, under `refuse`) and a block scalar included. Reached through an alias, the edit is over the
  bytes that hold the value. Under `warn` such an edit carries no notice: it changes no other place.
- **FR-002** A pointer that is not a string throws a `TypeError`, as a value that is not `EditData` already did.
- **FR-003** A pointer that is not RFC 6901 — neither empty nor led by `/`, or a `~` not followed by `0` or `1` — is
  refused as `path-malformed` by `locate`, `setValue`, `add` and `remove`, one-shot and opened, positioned at the
  document's start (0 to 0), as a size refusal is. `inside`, `amend` and `shifted` answer no refusal and still throw.
- **FR-004** The suite runs in `tests/unit/stenography.test.ts` on both writers, through `check` (vitest, not
  `node:test`). The host reads with Cascata's own parsers; its corpus is every write case's input that parses; its
  edits add one to each integer, in YAML only where the document has no alias, since a shared value is refused by
  default. **Known, by name:** the refusal law is a recorded skip until the contract rules on `open-unreadable`;
  `open` answers the parser's code.

Cases before code: nine write cases (`unchanged-*`, `pointer-*`, `*-malformed-pointer`), and the two unit tests
that asserted a malformed pointer throws now assert the refusal (the rule changed by ruling; no assertion was
relaxed). The corpus runner's check that no edit is answered for a shared value under `refuse` now exempts the
edit that changes nothing, which is FR-001. Sabotage: no early nothing-changed (2 suite laws and 11 cases red),
no nothing-changed through an alias (2), no `~` rule (5), `Error` for `TypeError` (2).
