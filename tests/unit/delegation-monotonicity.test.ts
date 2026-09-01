/**
 * v0.6 FR-014, SC-001 -- a configuration split across fragments is
 * semantically identical to the same configuration written inline. This
 * is the milestone's own central claim (spec.md US2 / SPEC.md Sec8.2 --
 * "a config with twelve fragments is semantically identical to the same
 * config written inline"), discharged here as a property across many
 * random splits rather than the single hand-built pair
 * `delegation-inline-identity.test.ts` already checks.
 *
 * Each granted key demands `type: mapping`, not `type: string` --
 * deliberately. SPEC.md Sec8's own worked example makes a string value at a
 * granted key trigger a graft unconditionally ("a string value here means:
 * load and graft"), regardless of the key's own demand type; there is no
 * such thing as a granted key holding an inline string literal; that is
 * exactly what `basic-grant`/`grant-not-compelled` establish and what this
 * test's first draft (comparing inline *string* values against delegated
 * ones) got wrong -- every "inline" string at a granted key was itself
 * treated as a delegation target and refused as a sandbox escape, which is
 * the razor working as designed, not a bug in the pipeline. Using a
 * one-field mapping as the unit of data sidesteps that: a mapping can
 * always be written inline (`grant-not-compelled`'s own case), and the
 * identical mapping can always be the root of a fragment file, so the two
 * forms are genuinely comparable.
 *
 * Each trial writes one random flat mapping of single-field mappings to a
 * real temp directory, twice: once with every key inline, once with a
 * random subset of keys split into their own one-key fragment files (every
 * granted key is *eligible* to be split, per key, independently -- not
 * "all or nothing"). Both are resolved and merged for real (delegation
 * needs actual files on disk, unlike v0.5's synthetic-tree property
 * tests, which never touched `resolve()` at all) and the two merged
 * trees are compared with `nodesEqual` -- SPEC.md Sec4.2's own model
 * equality, not a hand-rolled comparison.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve, merge, nodesEqual } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

const TRIALS = 25;

describe("v0.6 FR-014/SC-001 -- inline vs. randomly-split configurations merge identically", () => {
  for (let trial = 0; trial < TRIALS; trial += 1) {
    it(`trial ${trial}: a random subset of keys delegated produces the same merged tree as fully inline`, async () => {
      const rng = mulberry32(trial + 1);
      const keyCount = randInt(rng, 2, 5);
      const keys = Array.from({ length: keyCount }, (_, i) => `k${i}`);
      const values = keys.map((_, i) => `value-${trial}-${i}`);
      const delegated = keys.map(() => rng() < 0.5);

      const dir = mkdtempSync(join(tmpdir(), "cascata-delegation-monotonicity-"));
      try {
        const schemaLines = ["keys:"];
        for (const key of keys) {
          schemaLines.push(`  ${key}:`, "    demand:", "      type: mapping", "    delegate: allow");
        }
        writeFileSync(join(dir, "schema.yaml"), schemaLines.join("\n") + "\n");

        const configLines = ["$schema: ./schema.yaml"];
        keys.forEach((key, i) => {
          if (delegated[i] === true) {
            writeFileSync(join(dir, `${key}.yaml`), `v: ${values[i]}\n`);
            configLines.push(`${key}: ./${key}.yaml`);
          } else {
            configLines.push(`${key}:`, `  v: ${values[i]}`);
          }
        });
        writeFileSync(join(dir, "config.yaml"), configLines.join("\n") + "\n");

        const inlineConfigLines = [
          "$schema: ./schema.yaml",
          ...keys.flatMap((key, i) => [`${key}:`, `  v: ${values[i]}`]),
        ];
        writeFileSync(join(dir, "config-inline.yaml"), inlineConfigLines.join("\n") + "\n");

        const splitResolved = await resolve(join(dir, "config.yaml"), { host: createNodeHost(), sandboxRoot: dir });
        const inlineResolved = await resolve(join(dir, "config-inline.yaml"), { host: createNodeHost(), sandboxRoot: dir });
        expect(splitResolved.ok, `trial ${trial}: split should resolve`).toBe(true);
        expect(inlineResolved.ok, `trial ${trial}: inline should resolve`).toBe(true);
        if (!splitResolved.ok || !inlineResolved.ok) return;

        const splitMerged = merge(splitResolved);
        const inlineMerged = merge(inlineResolved);
        expect(splitMerged.ok).toBe(true);
        expect(inlineMerged.ok).toBe(true);
        if (!splitMerged.ok || !inlineMerged.ok) return;

        expect(nodesEqual(splitMerged.configuration.tree, inlineMerged.configuration.tree), `trial ${trial}: delegated=${JSON.stringify(delegated)}`).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
