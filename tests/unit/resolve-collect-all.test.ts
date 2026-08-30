/**
 * Direct unit test of `resolveAllBranches` (`src/graph/build.ts`) —
 * FR-025's collect-all guarantee ("Resolution MUST report every failure
 * it can determine independently, rather than only the first").
 *
 * **Why this exists, and why not through a `resolve()` corpus case
 * (T058's original home, `tests/corpus/cases/fail-multi/`)**: T058 asks
 * for "independent failures in separate branches — a missing local file
 * and a disallowed scheme — asserting both are reported from one
 * attempt." No fixture in this milestone's `$schema`/`$adopts`
 * vocabulary can construct that. `data-model.md`'s "Graph" entry states
 * it outright: with adoption single-parent (`SPEC.md` §9), the pedigree
 * "is a chain, never a tree... branching is a refusal rather than a
 * shape to handle." Traced through `src/index.ts`'s `walkAdoptsChain`:
 * at any point in a resolution, there is exactly one reference being
 * resolved (the current document's one outgoing edge); each step's
 * success is a precondition for even discovering the next one's
 * reference text. So a single `resolve()` call can produce *at most one*
 * reference-resolution diagnostic in this milestone — never two
 * independent ones from "separate branches," because there are never two
 * simultaneous branches to have failures in. This is the identical
 * structural fact T021 (`tests/unit/graph-content-dedup.test.ts`) and
 * T039 (`tests/unit/graph-remote-dedup.test.ts`) already record for
 * dedup, applied to FR-025; see the milestone report for the full
 * account, including why `tasks.md`'s Phase 6 does not carry the same
 * retargeting note Phase 4/5 do for the identical root cause.
 *
 * What *is* real and testable is the collect-all **mechanism**
 * `resolveAllBranches` provides, for when genuine branches exist
 * (delegation, `SPEC.md` §8, v0.6: several simultaneous `delegate`
 * references in one document). Proven here with two synthetic candidates
 * that fail for two independent, unrelated reasons — standing in for
 * T058's "a missing local file" and "a disallowed scheme" — and
 * confirming *both* failures come back from one call, in order, not just
 * the first.
 *
 * **Sabotage-tested (T065's risk note: "code that stops at the first
 * failure passes every single-failure case")** — see the milestone
 * report for the full protocol; the short version: `resolveAllBranches`
 * was temporarily changed to `return { ok: false, failures: outcome.failures }`
 * immediately upon the first failure (never visiting the remaining
 * candidates), and the "collects every failure" test below was confirmed
 * to fail specifically (it received one failure, not two) before the
 * sabotage was reverted.
 */

import { describe, expect, it } from "vitest";
import { resolveAllBranches, type BranchOutcome } from "../../src/graph/build.js";

type SyntheticFailure = { readonly reason: "missing-local-file" | "disallowed-scheme"; readonly candidate: string };

async function resolveSyntheticCandidate(candidate: string): Promise<BranchOutcome<string, SyntheticFailure>> {
  if (candidate === "ok") {
    return { ok: true, value: candidate };
  }
  if (candidate === "missing") {
    return { ok: false, failures: [{ reason: "missing-local-file", candidate }] };
  }
  if (candidate === "bad-scheme") {
    return { ok: false, failures: [{ reason: "disallowed-scheme", candidate }] };
  }
  throw new Error(`unreachable: unexpected synthetic candidate '${candidate}'`);
}

describe("resolveAllBranches: independent failures across branches are all collected (FR-025, T065)", () => {
  it("collects every failure from independent branches, not just the first — a missing local file and a disallowed scheme", async () => {
    const result = await resolveAllBranches(["missing", "bad-scheme"], resolveSyntheticCandidate);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    // Both branches' failures present, in candidate order — proof this
    // is not a first-failure-wins short circuit (T065's named risk).
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]?.reason).toBe("missing-local-file");
    expect(result.failures[1]?.reason).toBe("disallowed-scheme");
  });

  it("collects failures from three independent branches, including ones after the first failure", async () => {
    const result = await resolveAllBranches(["missing", "ok", "bad-scheme"], resolveSyntheticCandidate);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failures).toHaveLength(2);
    expect(result.failures.map((f) => f.reason)).toEqual(["missing-local-file", "disallowed-scheme"]);
  });

  it("succeeds with every value when every branch succeeds", async () => {
    const result = await resolveAllBranches(["ok", "ok"], resolveSyntheticCandidate);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual(["ok", "ok"]);
  });

  it("succeeds vacuously with no candidates", async () => {
    const result = await resolveAllBranches<string, string, SyntheticFailure>([], resolveSyntheticCandidate);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual([]);
  });
});
