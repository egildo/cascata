# Quickstart: Validating the Information Model & YAML Adapter

**Date**: 2026-08-29 | **Plan**: [plan.md](./plan.md)

How to run this milestone and confirm it does what the spec claims. Implementation belongs to
`tasks.md`; this is the validation guide.

## Prerequisites

- Node LTS and `pnpm`
- No network access is required at any point — by design. The corpus is entirely local fixtures, so
  a green run offline is the expected result, not a lucky one.

## Setup

```bash
pnpm install
```

## Run everything

```bash
pnpm test
```

Expected: every conformance case reports individually, and the unit suites for equality, immutability,
and layering pass. A failing case names itself, what it expected, and what it got.

## Run just the corpus

```bash
pnpm vitest run tests/corpus
```

## Validation scenarios

Each maps to a user story in [spec.md](./spec.md). Together they prove the milestone end to end.

### 1. Every node knows where it came from (User Story 1, SC-001)

Read a nested document and confirm that a chosen deep node's reported position selects exactly the
characters that produced it, then walk the whole tree and find no node lacking a position.

**Expected**: zero unpositioned nodes across the entire corpus. Because positions are required by the
node factories, a regression here is a compile error rather than a test failure — the test is the
backstop, not the primary defense.

### 2. The floor holds (User Story 2, SC-002, SC-004)

Read the refusing fixtures — duplicate keys, a complex key, `1:` as a key, `!!binary`, a multi-document
stream, invalid UTF-8.

**Expected**: each is refused with the code from
[contracts/diagnostics.md](./contracts/diagnostics.md), and the reported line and column select the
offending construct exactly. A duplicate key reports **both** occurrences.

### 3. Everything at once (SC-003)

Read the fixture that breaks several rules far apart in one document.

**Expected**: one read, every violation reported, ordered by position. This is the scenario that
fails if anyone reintroduces fail-fast.

### 4. The Norway problem is impossible (SC-005)

Read `norwegian: no`, `enabled: true`, `version: 2`, `ratio: 2.0`.

**Expected**: `no` is text, `true` is boolean, `2` is an integer and `2.0` a float, and the two
numbers are **not** equal.

### 5. Hostile input is refused, not survived (SC-007)

Read a document past the depth cap, one past the size cap, and one containing an alias cycle.

**Expected**: all three refused promptly with their own codes. The alias-cycle case is the one worth
watching — research established the underlying library reports nothing and builds a circular
structure, so this is entirely Cascata's detection.

### 6. Adding a case costs no code (SC-006, FR-024)

Copy a corpus case file, change its name and input, run the suite.

**Expected**: the new case executes. If this requires touching the runner or the adapter, FR-024 is
not met.

### 7. The layering boundary is real (Principle IV)

```bash
pnpm vitest run tests/unit/layering.test.ts
```

**Expected**: passes, asserting that nothing in `src/model/` or `src/diagnostics/` imports from
`src/adapters/`. This is what makes "format-blind" a fact rather than an intention — the JSON and TOML
adapters depend on it holding.

## What is not validated here

Nothing in this milestone resolves references, merges layers, or checks constraints — those arrive in
v0.2 through v0.4. A green run means one document becomes a trustworthy positioned tree, or is
refused with precise reasons. That is the whole claim.
