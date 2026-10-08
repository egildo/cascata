# Feature Specification: The Node host answers a path's true spelling

**Feature Branch**: `021-native-realpath` (committed on `main`)

**Created**: 2026-10-08

**Status**: Draft

**Input**: found by the owner's session while checking Provenance's write sandbox on macOS. Cascata's
Node host (`src/host/node.ts`) canonicalizes with `realpathSync`, Node's JavaScript implementation,
which resolves symbolic links but **keeps the casing it was given**. On a case-insensitive file
system (macOS's default, and Windows), `/T/Case-x` and `/T/case-x` name one directory, and
`realpathSync` answers each as spelled; `realpathSync.native` (the operating system's `realpath(3)`)
answers the directory's true spelling for both. Provenance's Node host already uses the native call.

**A correction** under §15's freeze rule: Article VI says `canonicalize` answers a location's
canonical identity; two spellings of one file answered as two identities is not that.

## Requirements

- **FR-001** `createNodeHost`'s `canonicalize` uses `realpathSync.native`. Nothing else changes.
- **FR-002** **Consequences, each a test on a real temporary directory**, skipped (with a stated reason)
  where the file system is case-sensitive — detect it by probing, never by platform name:
  - one document adopted under two spellings is **one** document: one identity, one layer;
  - a `sandboxRoot` given in a different case from the disk still contains its files.
  Red against the current code on this machine.
- **FR-003** Probe first (the probe gate): a non-ASCII directory name (composed versus decomposed
  `é`, which macOS normalises), a symbolic link in the path, and a path that does not exist (both
  calls throw; `canonicalize` must still answer `undefined`). Record what each call answers.
- **FR-004** `SPEC.md` is not edited by the implementer; report what §15 should record.

## Sabotage

Back to `realpathSync` (both FR-002 tests red on this machine).

## Plan

One commit for the probe and the tests (red), one for the fix, one for
`specs/021-native-realpath/report.md`. Do not bump the version.
