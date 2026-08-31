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
11. **The depth-limit guard, tested directly, not end to end** — **this line originally claimed a
    65-real-file fixture reaches `MAX_DELEGATION_DEPTH` and was wrong; corrected here, not
    appended-to, because a quickstart is meant to be run, and running the original claim would have
    sent a reader looking for a fixture that does not exist.** A real hop-to-hop delegation chain is
    schema-nesting-bound, not file-count-bound: `walkForDelegation` re-checks each further hop
    against the *same* grant node's own `.keys` map (`src/index.ts`'s own comment at the recursive
    call), so permitting hop *N+1* costs the schema one more `demand.keys.<name>.delegate: allow`
    level of raw nesting — the identical "named nesting costs raw YAML depth" fact v0.5 found for
    `MAX_DEMAND_DEPTH`. A schema deep enough to permit 64 real hops needs roughly 3 x 64 = 192 YAML
    nesting levels, which trips v0.1's own 64-level parse-depth cap (`depth-limit-exceeded` from
    `parse()`) at semantic hop depth ~21 — 43 hops short of `MAX_DELEGATION_DEPTH`. This was
    confirmed by actually generating and running such a schema, not reasoned about in the abstract
    (`research.md` D5's own correction). `MAX_DELEGATION_DEPTH` and its tracker (`DelegationCycleTracker`)
    are therefore exported from `src/index.ts` specifically so `tests/unit/delegation-depth-limit.test.ts`
    can exercise the guard's own logic directly — exact-boundary acceptance/overflow, cycle-vs-depth
    distinction — bypassing both file I/O and the now-proven-unreachable schema-nesting path. Treat
    this guard as defence in depth whose own trigger condition is not reachable through the public
    pipeline, exactly like v0.5's `MAX_DEMAND_DEPTH` and `type-name-collision` before it.

```bash
pnpm vitest run tests/corpus/validate-corpus.test.ts tests/unit/delegation-monotonicity.test.ts tests/unit/delegation-sandbox-confinement.test.ts tests/unit/delegation-depth-limit.test.ts tests/unit/layering.test.ts
```

## What is not validated here

`items`-nested delegation grants (D2, out of scope this milestone); `delegate: { allow: true,
formats: [...] }` selector parameters (§8.4, future door); a "delegate and start a layer" construct
(§8.4, explicitly a future new keyword).
