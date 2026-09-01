/**
 * The invariant research D1 accepted the risk of losing by keeping
 * provenance beside the tree rather than on the node (tasks.md T048):
 * every pointer that resolves in the merged tree gets a real `why()`
 * answer (`chain` or `synthesized`, never `unknown-pointer`), and every
 * pointer `unknown-pointer` is answered for genuinely does not resolve.
 * "The two structures can disagree" is a defect this design *admits*, not
 * one it is exempt from — this test is the thing that would catch it, so
 * it is load-bearing rather than ceremonial (per the milestone brief).
 *
 * The invariant is checked two ways:
 *
 * 1. Exhaustively over several real merged configurations (`resolve()` +
 *    `merge()` against existing corpus fixtures, so no hand-built tree
 *    could accidentally omit a case the real fold produces): every
 *    pointer `enumeratePointers` finds by walking the tree itself —
 *    including into sequence items, which `src/merge/provenance.ts`'s own
 *    recording granularity does not address directly (its own module
 *    doc) — must get `chain` or `synthesized`, never `unknown-pointer`.
 * 2. A handful of pointers that name nothing in each tree — a made-up
 *    top-level key, and a pointer one segment too deep under it — must
 *    answer `unknown-pointer`, confirming the other direction is not
 *    vacuously satisfied by `why()` never refusing anything.
 *
 * Also checks the raw `ProvenanceRecord` map directly (not just `why()`):
 * every pointer it stores a chain under resolves in the tree — the
 * literal reading of T048's "every chain's pointer resolves in the tree".
 * The reverse ("every pointer resolving in the tree has an entry in the
 * raw map") is deliberately **not** asserted here — `provenance.ts`'s own
 * module doc explains why a `synthesized` container has no raw entry by
 * design, and `ProvenanceRecord`'s own doc comment says so.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { merge, resolve, why, type MergedConfiguration, type Node } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";

const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases");

const FIXTURES: readonly { readonly name: string; readonly dir: string }[] = [
  { name: "three-layer chain (T038)", dir: join(CASES_DIR, "merge-provenance", "three-layer-chain") },
  { name: "overridden, absent from tree (T039)", dir: join(CASES_DIR, "merge-provenance", "overridden") },
  { name: "append, no winner (T040)", dir: join(CASES_DIR, "merge-provenance", "append") },
  { name: "chain / synthesized / unknown-pointer (T041)", dir: join(CASES_DIR, "merge-provenance", "negatives") },
  { name: "synthesized, including a recursively-synthesized child (T042)", dir: join(CASES_DIR, "merge-provenance", "synthesized") },
  { name: "byte-identical values (T043)", dir: join(CASES_DIR, "merge-provenance", "agreement") },
  { name: "deep mapping merge, three layers (Phase 3)", dir: join(CASES_DIR, "merge-fold", "deep", "three-layer-nested") },
  { name: "cascade confined to the top level (T035)", dir: join(CASES_DIR, "merge-fold", "top-level-only") },
];

async function mergeFixture(dir: string): Promise<MergedConfiguration> {
  const resolved = await resolve(join(dir, "config.yaml"), { host: createNodeHost(), sandboxRoot: dir });
  if (!resolved.ok) {
    throw new Error(`fixture at '${dir}' failed to resolve: ${resolved.diagnostics.map((d) => d.code).join(", ")}`);
  }
  const result = merge({ graph: resolved.graph, pedigree: resolved.pedigree });
  if (!result.ok) {
    throw new Error(`fixture at '${dir}' failed to merge: ${result.diagnostics.map((d) => d.code).join(", ")}`);
  }
  return result.configuration;
}

function escapeSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Every pointer that resolves in `tree` — walked from the actual tree structure, never assumed, so this cannot miss a shape the real fold produces. Includes the root (`""`), every mapping key at every depth, and every sequence index at every depth (T048 cares about these precisely because `src/merge/provenance.ts` does not record them directly — see this file's own module doc). */
function enumeratePointers(node: Node, prefix: string, into: string[]): void {
  into.push(prefix);
  if (node.type === "mapping") {
    for (const [key, child] of node.entries) {
      enumeratePointers(child, `${prefix}/${escapeSegment(key)}`, into);
    }
  } else if (node.type === "sequence") {
    node.items.forEach((item, index) => {
      enumeratePointers(item, `${prefix}/${index}`, into);
    });
  }
}

describe("provenance consistency (research D1, tasks.md T048) — the tree and the record must agree on what resolves", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: every pointer that resolves in the tree gets a real why() answer, never unknown-pointer`, async () => {
      const configuration = await mergeFixture(fixture.dir);
      const pointers: string[] = [];
      enumeratePointers(configuration.tree, "", pointers);
      expect(pointers.length).toBeGreaterThan(0);
      for (const pointer of pointers) {
        const result = why(configuration, pointer);
        expect(result.kind, `why('${pointer}') must not be unknown-pointer — it resolves in the tree`).not.toBe("unknown-pointer");
      }
    });

    it(`${fixture.name}: a pointer that names nothing in the tree answers unknown-pointer`, async () => {
      const configuration = await mergeFixture(fixture.dir);
      const bogus = ["/this-key-does-not-exist-anywhere", "/this-key-does-not-exist-anywhere/nested"];
      for (const pointer of bogus) {
        const result = why(configuration, pointer);
        expect(result.kind, `why('${pointer}') must be unknown-pointer — it names nothing in this fixture's tree`).toBe("unknown-pointer");
      }
    });

    it(`${fixture.name}: every pointer the raw provenance record stores a chain under resolves in the tree`, async () => {
      const configuration = await mergeFixture(fixture.dir);
      for (const pointer of configuration.provenance.keys()) {
        const result = why(configuration, pointer);
        expect(result.kind, `the record has an entry for '${pointer}', but it does not resolve in the tree`).not.toBe("unknown-pointer");
      }
    });
  }
});
