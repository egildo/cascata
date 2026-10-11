/**
 * The fetch transport seam — contracts/resolve-api.md's "Transport seam",
 * contracts/recorded-responses.md, research D7; tasks.md T043 (User
 * Story 3).
 *
 * One HTTP request in, one outcome out — the contract `src/resolve/
 * fetch.ts` fetches through. `fetch.ts`'s own `createNetworkTransport`
 * implements it against the real network (used only when a caller of
 * `resolve()` supplies no `transport`); `tests/corpus/transport.ts`'s
 * `RecordedTransport` implements it against canned data instead, so the
 * suite never touches the network (constitution, Technology & Security
 * Constraints; CLAUDE.md's non-negotiable).
 *
 * **Why this moved here, out of tests/corpus/transport.ts**: these shapes
 * were originally declared directly in that file (Phase 2 scaffolding,
 * T009/T010 — written before `fetch.ts` or any production code needed to
 * reference them at all). Now that `fetch.ts` needs the same contract
 * `RecordedTransport` implements, declaring it twice would repeat the
 * exact mistake `model/reference.ts`'s module doc already recorded and
 * withdrew for `Reference`/`DocumentIdentity`: two structurally identical
 * shapes kept in sync only by luck. `src/` is the honest home — a
 * production contract belongs in production code, and a test fake
 * (`RecordedTransport`) implements it, not the reverse.
 * `tests/corpus/transport.ts` now imports these types from here and
 * re-exports them, so every existing import site
 * (`tests/corpus/transport.test.ts`, and this milestone's remote-* test
 * files) needs no change.
 *
 * `src/resolve/` must never import from `src/adapters/` — enforced by
 * tests/unit/layering.test.ts. This file imports nothing.
 */
export {};
//# sourceMappingURL=transport.js.map