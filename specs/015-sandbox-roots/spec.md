# Feature Specification: Sandbox Roots

**Feature Branch**: `015-sandbox-roots`

**Created**: 2026-09-21

**Status**: Draft

**Input**: GitHub issue #2 (Egildo, 2026-09-21), found while BelType's TypeScript round typed its side of the `Host` seam and measured on v1.6.0 through BelType's node host on macOS. Three things that share one question: **how does a caller let a schema reach a file outside the project, and how does the sandbox tell "outside" from "absent"?**

**Implements**: `SPEC.md` §8.4 and §11 (the sandbox), §9 (tilde expansion), Article VI (§16, the host answers platform facts). Two **corrections** and two **additions** under §15's freeze rule, decided by Egildo on 2026-09-21 and recorded in §15 ("Sandbox roots", v1.7):

- **Correction 1 — absent is not outside.** `isWithinSandbox`'s own documentation says that "cannot be canonicalized" must not become a verdict in either direction. Under a symlinked root it does: the root exists and is canonicalized, the missing location falls back to its lexical path, the two prefixes disagree, and a file that is merely absent is refused as `sandbox-escape`. On macOS this is the ordinary case (`/tmp` → `/private/tmp`, `/var` → `/private/var`).
- **Correction 2 — a schema's `~/` expands, then is confined.** `SPEC.md` §5.3's worked chain has a project *schema* write `$adopts: ~/.config/house.yaml`, while §15's "tilde paths" entry limits expansion to config-authored references. The document contradicted itself, and the example could not resolve. The entry's reason — expansion "grants schemas no new reach" only if schemas do not get it — was wrong about where reach comes from: reach is what **containment** grants, and containment is enforced on every schema-authored local reference whether or not its text was expanded first. The one bounded change of behavior is named in FR-007.
- **Addition 1 — the caller may grant more than one sandbox root.** Granted, never ambient, exactly as before.
- **Addition 2 — `posixPaths` is exported** from a `cascata/paths` entry point.

## User Scenarios & Testing

The user is again **the embedder**. Their venues live in temporary directories on macOS, and their operators keep a house schema under their home directory, shared by every project on the machine.

- **Absent, not outside.** A sandbox root that is a symlink to a real directory; the venue schema writes `$adopts: ./missing.yaml`. The answer is `document-unreachable`, the same as under the real directory. (unit FR-001, FR-002)
- **Still outside.** The same symlinked root; `$adopts: ../outside.yaml`, where `outside.yaml` does not exist either. The answer is `sandbox-escape`. Absence must not become a pass any more than it becomes a refusal. (unit FR-002)
- **Delegation agrees.** A delegated path to a missing file under a symlinked root is `document-unreachable`, and a missing `../` target is still the delegation's sandbox refusal: `isWithinSandbox` has three callers and one fix. (unit FR-002)
- **In the host's terms.** The same two verdicts under a win32 path facility: root `C:\link\venue` canonicalizing to `C:\real\venue`, missing file, missing `..\outside.yaml`. (unit FR-003)
- **A second root, granted.** `sandboxRoot: [venue, houseDir]`; the venue schema writes `$adopts: ~/schemas/house.yaml` with the host's home directory pointing at a fixture whose `schemas/` is `houseDir`. The house schema is read and heads the pedigree. (unit FR-004, FR-007)
- **Not granted.** The same without the second root: `sandbox-escape`, and the message names the **expanded** path, every granted root, and the option that grants one. (unit FR-007, FR-009)
- **Absolute, granted.** `$adopts: /abs/path/to/house.yaml` under a granted second root resolves; without it, `sandbox-escape` as today. (unit FR-004)
- **Config-authored, unchanged.** `$schema: ~/…` in a config expands and is not sandbox-checked, exactly as v1.6. (unit FR-007)
- **No home.** A host with `homeDirectory: undefined`: a schema's `~/x` stays the literal relative path it looks like, as a config's does today. (unit FR-007)
- **Never into a URL.** A schema read over `https://` writes `$adopts: ~/x`: the reference resolves as the relative URL it always was, and the user's home path appears in no URL offered to the transport. (unit FR-008)
- **Nothing granted.** `sandboxRoot: []` throws v0.2 FR-022's error, as `undefined` and `""` do. (unit FR-005)
- **Spread.** `import { posixPaths } from "cascata/paths"`; `{ ...posixPaths, homeDirectory: "/home/u" }` is a `PathFacility`, and the entry point evaluates in a realm with no Node built-ins. (unit FR-010; the realm sweep)

## Requirements

- **FR-001** Containment judges a location that does not exist through its **nearest existing ancestor**: the longest leading directory `host.canonicalize` answers for, with the remaining segments appended in the host's path terms. The same treatment applies to a root that does not exist. Where no ancestor canonicalizes at all, the lexical path stands, as before — a host that answers `canonicalize` for documents only is unchanged. The remaining segments need no canonicalization: they do not exist, so none of them is a link.
- **FR-002** Consequently, under a root that is or sits beneath a symbolic link, a reference to an absent file inside the root is `document-unreachable` and a reference to an absent file outside it is `sandbox-escape` — for `$adopts`/`$schema` and for delegation alike, since both judge through `isWithinSandbox`.
- **FR-003** FR-001 is computed with the host's `PathFacility` and no other notion of a path (SPEC.md §11, v1.5): the verdicts of FR-002 hold under a win32 facility. No new `PathFacility` member is expected; if one proves necessary, stop and report rather than add it.
- **FR-004** `ResolveOptions.sandboxRoot` (and so `LoadOptions`, and every other option bag that carries it) is `string | readonly string[]`. A string is the one-element list. Each member is resolved to an absolute path as `toAbsoluteSandboxRoot` does today. A location is within the sandbox when it is within **any** granted root.
- **FR-005** v0.2 FR-022 holds member-wise: `undefined`, `null`, `""`, `[]`, and a list with a member that is not a non-empty string all throw its error. No root is inferred, none is read from a document, and nothing in a document can add one.
- **FR-006** Delegation's containment (§8.4) is judged against the same set of roots. There is one sandbox, not one per mechanism.
- **FR-007** A leading `~/` in a reference written by a **local** document expands to the host's home directory **whatever the reference's authority**, where the host has one. A schema-authored reference is then confined as every schema-authored local reference is (v0.2 FR-021, unchanged); a config-authored one is exempt as before (v0.2 FR-020, unchanged). With no home directory, the text stays literal, as before. **The one bounded change of behavior**: a schema that wrote `~/x` meaning a directory literally named `~` beside itself must now write `./~/x`.
- **FR-008** A `~/` in a document that was read over `https://` is never expanded, under either authority: a remote document has no home on the reader's machine, and the user's home path must never be joined into a URL. *Probe `main` first and report what it does today for a config-authored `~/` with a remote referrer* — `classifyReferenceLocation` expands before it looks at the referrer.
- **FR-009** The `sandbox-escape` message names the location as resolved (expanded, and canonicalized where FR-001 could), every granted root, and the lawful door: a caller grants roots through `sandboxRoot`. The code, the level, the primary span and the `v0.2 FR-021` citation are unchanged.
- **FR-010** `package.json` gains `./paths` and `./paths.js` exports (the `./generate` precedent), serving `posixPaths` and the `PathFacility` type from `src/paths.ts`. The entry point passes `tests/unit/layering.test.ts`'s realm sweep, and the `-dist` build ships it.
- **FR-011** Unchanged and to be shown unchanged: a host-located reference is not sandbox-checked (v1.4); an override's and a launching schema's text is not sandbox-checked (v1.3, v1.6); `/sandboxfoo` is not inside `/sandbox`, and `sandboxRoot: "/"` contains everything (v1.4 FR-007) — now for each member of a list.

## Out of scope

- **The window between the check and the read.** A dangling link inside the root that points outside it cannot be canonicalized, is judged through its ancestor as inside, and then fails to read: `document-unreachable`. If its target appears between the two calls the read succeeds. This is v0.2's behavior exactly (the lexical fallback judged it inside too) and closing it needs a host verb that reads *and* reports the real path, which is a different amendment.
- **A root read from a document, an environment variable, or the entry's location.** Granted, never ambient.
- **A per-root policy** (this root for `$adopts` only, that one for delegation). One sandbox.
- **`~user/`, `$HOME`, `%USERPROFILE%`.** `~/` is the whole of the expansion, as it has been since v0.2.
- **BelType's wrapper forwarding `Host.paths`.** Its fix, made there.
- **Tagging and pushing `v1.7.0-dist`.** Done after verification, not by the implementer.

## Conformance

The symlink verdicts cannot live in the resolve corpus if its runner's host has no links to follow: say in the report which host the runner uses and where the cases therefore went. Expected: `tests/unit/sandbox-roots.test.ts`, in two halves.

- **A scripted host** (an in-memory `Host` whose `canonicalize` is a table written by hand in the test, with a POSIX and a win32 facility): FR-001 to FR-003 and FR-008 without touching a disk. The table *is* the oracle — every expected verdict is derived from it by hand, never from a run.
- **The node host over a real temporary directory**: a `real/` directory and a `link` → `real` symlink built by the test itself, so that the case is red on Linux too, where `/tmp` is not a link; the "real" half must start from the *canonicalized* temporary directory, or on macOS both halves are the symlinked case and the comparison proves nothing.

Probe gate (constitution, Principle V), before FR-001's conclusion is written down: one **non-ASCII** path (a venue directory named `città/` under the link), one **boundary** (the root itself absent; the location *is* the root; the root is `/`), one **adversarial** (a dangling link inside the root pointing outside; a granted root that is a prefix of a sibling's name, `/house` vs `/housekeeping`, as a list member).

Sabotage, each watched red and restored: FR-001 (return the lexical path again — the symlink cases must fail, and *only* they should); FR-004 (`some` → `every`, and first-member-only); FR-007 (restore the authority condition); FR-008 (drop the remote guard — the test must see the home path in the URL the transport was offered); FR-005 (accept `[]`). `grep -rn SABOTAGE src/ tests/` before every commit.

Existing tests that pin the old `sandbox-escape` message text, if any, change with FR-009; name each in the report. No other existing assertion should need to move — if one does, that is a finding, not a chore.

## Plan and tasks

`/speckit-plan` then `/speckit-tasks` if the design wants more room than this; the 012–014 precedent (one file and a report) is acceptable if it does not, with the Complexity Tracking note saying so. One commit per story, tree green at each, in this order, so that the first commit can be tagged as a patch on its own if the rest stalls:

1. **Absent is not outside** — FR-001 to FR-003. Tests first, red against `main`. Rewrite `isWithinSandbox`'s and `safeCanonicalize`'s doc comments: the "deliberate judgment call" paragraph defends the behavior this story corrects.
2. **Granted roots** — FR-004 to FR-006, FR-009, FR-011.
3. **A schema's `~/`** — FR-007, FR-008. `expandTilde`'s doc comment and `PathFacility.homeDirectory`'s both say "config-authored"; both change.
4. **`cascata/paths`** — FR-010.
5. **Derived artifacts** — `README.md`, `docs/reference.md`, any `contracts/` file that states `sandboxRoot`'s type or the tilde rule; a one-line forward pointer ("amended by v1.7 FR-n, `specs/015-sandbox-roots/`") at v0.2 FR-022 and v0.2 FR-029 in `specs/002-resolver-dag-builder/spec.md`, leaving their text as history; `package.json` to `1.7.0`; `specs/015-sandbox-roots/report.md`.

`SPEC.md` is already amended on this branch (§5.3, §8.4, §9, §15, §16). **Do not edit it.** Check every sentence of the amendment against what the code turned out to do, and report each disagreement unsoftened — the drafter of that text has not been checked by anyone.
