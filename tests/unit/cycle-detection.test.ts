/**
 * Termination proof for T029 — "cycle detection runs on location, before
 * bytes exist" (CLAUDE.md's named trap for this slice; v0.2 FR-008).
 *
 * The full `reference-cycle` **conformance** corpus (exact diagnostic
 * shape: every reference in the loop, labelled, in chain order) belongs
 * to User Story 4 (tasks.md T048), out of scope for this Phase 4 slice.
 * What this file exists to prove instead — per the milestone assignment's
 * explicit instruction — is narrower and more load-bearing: that
 * `resolve()` actually **terminates** on a cycle, in bounded time, rather
 * than hanging or blowing the stack. A test that only checks the
 * diagnostic *code* would pass against an implementation that took an
 * hour (or forever) to produce it; a bounded Vitest test timeout is what
 * turns "hangs forever" into "fails this test" if that regresses.
 *
 * Sabotage-tested (see the milestone report for the full account,
 * including a genuine defect this sabotage run caught before it shipped —
 * `GraphBuilder` originally popped a location off the active path as
 * soon as its own bytes were read, before recursing into its *own*
 * further references, which turned a self-reference into a false
 * "duplicate" instead of a "cycle"; fixed by splitting that into
 * `registerContent`/`finishVisit`). With `GraphBuilder.beginVisit`'s
 * cycle check (the `stack`-based lookup) disabled outright, both tests
 * here were confirmed to fail — but not by hanging: `resolve()` returned
 * `ok:true`, because a *second*, independent safety net
 * (`registerContent`'s content-hash dedup) still bounds recursion depth
 * for local, static files — re-reading the same location always
 * reproduces the same hash, which the dedup short-circuits on. What it
 * does *not* do is refuse the graph: the returned result silently
 * contained the same document twice in the discovery order, violating
 * data-model.md's "each identity appears exactly once" — a silent
 * correctness defect, arguably worse than a hang, and exactly the kind
 * of thing `expect(result.ok).toBe(false)` below exists to catch. The
 * hang scenario the trap more literally describes becomes load-bearing
 * once remote fetching (User Story 3, out of scope here) makes "just
 * read it again and let hash-dedup sort it out" neither cheap nor safe.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolve } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "cycle");

describe("cycle detection terminates (T029)", () => {
  it(
    "a schema that $adopts itself is refused as reference-cycle, not followed forever",
    async () => {
      const result = await resolve(join(FIXTURES, "self", "config.yaml"), { host: createNodeHost(), sandboxRoot: join(FIXTURES, "self") });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.code).toBe("reference-cycle");
    },
    2000,
  );

  it(
    "two schemas that mutually $adopt each other are refused as reference-cycle, not followed forever",
    async () => {
      const result = await resolve(join(FIXTURES, "mutual", "config.yaml"), { host: createNodeHost(), sandboxRoot: join(FIXTURES, "mutual") });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.code).toBe("reference-cycle");
    },
    2000,
  );
});
