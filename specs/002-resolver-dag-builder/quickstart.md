# Quickstart: Validating the Resolver & DAG Builder

**Date**: 2026-08-30 | **Plan**: [plan.md](./plan.md)

How to run this milestone and confirm it does what the spec claims. Implementation belongs to
`tasks.md`; this is the validation guide.

## Prerequisites

- Node LTS and `pnpm`
- **No network access, ever** — not as a convenience but as a requirement. Remote behavior runs
  against recorded responses, so a green run offline is the expected result. A suite that needs the
  network has a defect.

## Setup and run

```bash
pnpm install
pnpm test
```

## Validation scenarios

Each maps to a user story in [spec.md](./spec.md).

### 1. Bytes at the boundary (US1, SC-010)

Read a document as bytes containing an invalid UTF-8 sequence.

**Expected**: refused, with the offending **byte** offset. The point of this scenario is what does
*not* happen — the bytes are not silently repaired into replacement characters. Then read the same
document as valid UTF-8 bytes and confirm the tree, spans included, matches what v0.1 produced from
the equivalent text.

### 2. A local chain resolves into a pedigree (US2, SC-001)

Resolve a config whose `$schema` names a local schema that itself `$adopts` another.

**Expected**: all three documents read, pedigree listing their identities root-to-leaf, each entry
naming the reference that brought it in and where that reference was written. No network.

### 3. Relative paths resolve against the referring document (US2)

Put the config and its schema in different directories, with the schema referencing its parent
relatively.

**Expected**: resolution succeeds. This fails if anything resolves against the working directory or
the entry document instead — a mistake that stays invisible while every file sits in one directory,
which is why the fixture deliberately does not.

### 4. Pins are verified, mismatches refused (US3, SC-004)

Resolve against a recording whose body does not hash to the stated pin.

**Expected**: `pin-mismatch` naming expected and actual, and — the part worth asserting explicitly —
the graph does not contain the document. Refusing to *use* unverified bytes is the requirement;
reporting them is not enough.

### 5. HTTPS is not negotiable (US3, SC-005)

Reference `http://`, then reference `https://` against a recording that redirects to `http://`.

**Expected**: `unsupported-scheme` with no request attempted, and `insecure-redirect` on the second.
The redirect case is the one that matters — it is how the first check gets bypassed if hops are
followed automatically.

### 6. Offline resolution from cache (US3, SC-003)

Resolve a remote chain with recordings, then resolve again with a transport that fails every
request.

**Expected**: the second run succeeds entirely from cache. Then clear the cache and repeat:
`document-not-cached`, which must be distinguishable from a document that is merely malformed.

### 7. A schema cannot read the filesystem (US4, SC-006)

A schema referencing `../../etc/passwd`, and a schema referencing a symlink inside the sandbox whose
target is outside it.

**Expected**: `sandbox-escape` for both. The symlink case is the one that catches a lexical-path
check masquerading as a sandbox.

### 8. A config may reference outside the sandbox (US4)

A config whose own `$schema` points outside the root.

**Expected**: **permitted.** This is the asymmetry §8.1's razor requires, and `SPEC.md` §9's own
worked example depends on it — a test that forbids this would make the specification's own example
illegal.

### 9. Cycles and over-long chains terminate (SC-008)

A self-referencing schema, a mutual pair, and a chain past `maxChainLength`.

**Expected**: `reference-cycle` naming every reference in the loop in chain order, and
`chain-limit-exceeded`. All in bounded time — the failure mode being guarded against is a hang, so a
test that merely checks the code would pass even against an implementation that took an hour.

### 10. The layering boundary still holds (Principle IV)

```bash
pnpm vitest run tests/unit/layering.test.ts
```

**Expected**: passes, now policing `src/resolve/` and `src/graph/` alongside `src/model/` and
`src/diagnostics/`. `resolve/` must not import an adapter; `graph/` must not import `resolve/`.

## What is not validated here

Nothing here merges layers, checks a constraint, or resolves a `demand` — those are v0.3 and v0.4. A
green run means the documents are found, verified, and assembled in the right order, with every
failure traceable to a reference someone wrote.
