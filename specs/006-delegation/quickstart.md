# Quickstart: Delegation (Transclusion)

## Setup and run

```bash
pnpm install
pnpm test
```

## Validation scenarios

1. **A granted key accepts a path and grafts the fragment** (US1, AS1) — `keys.network.delegate: allow`,
   config supplies `"./conf.network.yaml"`; expected: the fragment's contents appear at `/network`.
2. **§8.1's razor: an ungranted key stays a string** (US1, AS2) — the identical string at an ungranted
   key; expected: the merged tree holds the literal string, unchanged.
3. **A grant never compels: an inline mapping at a granted key is used as written** (US1, AS3).
4. **An unrecognized `delegate:` value is refused at its own position** (US1, AS4) —
   `delegate-value-unimplemented`.
5. **A config's own `delegate:` has no effect** (US1, AS5).
6. **Inline vs. split produce identical merged trees** (US2, AS1) — the milestone's own acceptance
   test, run against a real fixture pair.
7. **A fragment's `$`-key is refused** (US2, AS4) — `fragment-reserved-key`.
8. **A violation inside a fragment carries the breadcrumb; a non-delegated violation carries none**
   (US3, AS1-2).
9. **Sandbox escape, absolute path, and un-opted-in remote target are each refused** (US4, AS1-3);
   **the same remote case succeeds with opt-in** (US4, AS4).
10. **A delegation cycle is refused** (US4, AS6).
11. **The depth-limit sabotage-relevant case**: `tests/corpus/cases/validate-delegation/depth-limit/`,
    a generated chain of 65 fragment files, each delegating to the next — expected `depth-limit-exceeded`
    at hop 65, confirmed reachable (unlike v0.5's own depth guard) since each hop is a real file, not
    bounded by any single parse call's own depth cap.

```bash
pnpm vitest run tests/corpus/validate-corpus.test.ts tests/unit/delegation-monotonicity.test.ts tests/unit/layering.test.ts
```

## What is not validated here

`items`-nested delegation grants (D2, out of scope this milestone); `delegate: { allow: true,
formats: [...] }` selector parameters (§8.4, future door); a "delegate and start a layer" construct
(§8.4, explicitly a future new keyword).
