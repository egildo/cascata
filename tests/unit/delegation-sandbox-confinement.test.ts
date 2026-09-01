/**
 * v0.6 SC-004 -- a delegated path is confined to the sandbox root; every
 * path that would resolve outside it is refused (`sandbox-escape`), and
 * every path that resolves inside it (including right at the boundary)
 * is honored. `sandbox-escape/config.yaml` (T033) checks one fixed
 * escaping path by hand; this discharges the same claim as a property
 * across many depths and many `..` counts, including the exact boundary.
 *
 * Each trial nests the delegating config `depth` directories below a
 * sandbox root (SPEC.md Sec8.4: paths resolve relative to the
 * *delegating config's own directory*, confined to the sandbox root), then
 * asks it to delegate to a path built from `hops` `../` segments followed
 * by a filename. `hops <= depth` lands at-or-inside the sandbox root
 * (`isWithinSandbox` treats the root itself as inside, per its own doc
 * comment); `hops > depth` walks past the root into the surrounding temp
 * directory, which must be refused regardless of how far past it goes.
 * The fragment file is written at the literal resolved location for
 * every trial, escaping or not, so the only variable under test is the
 * sandbox check itself -- never a coincidental `document-unreachable`.
 */

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { resolve } from "../../src/index.js";
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

describe("v0.6 SC-004 -- delegated paths are confined to the sandbox root", () => {
  for (let trial = 0; trial < TRIALS; trial += 1) {
    it(`trial ${trial}: exactly the hop counts that walk past the sandbox root are refused`, async () => {
      const rng = mulberry32(trial + 1000);
      const depth = randInt(rng, 1, 4);
      const hops = randInt(rng, 0, depth + 3);
      const escapes = hops > depth;

      const outerDir = mkdtempSync(join(tmpdir(), "cascata-sandbox-confinement-"));
      try {
        const sandboxRoot = join(outerDir, "sandbox");
        const segments = Array.from({ length: depth }, (_, i) => `d${i}`);
        const configDir = join(sandboxRoot, ...segments);
        mkdirSync(configDir, { recursive: true });

        const schemaLines = ["keys:", "  network:", "    demand:", "      type: mapping", "    delegate: allow"];
        writeFileSync(join(configDir, "schema.yaml"), schemaLines.join("\n") + "\n");

        const relativePath = "../".repeat(hops) + "target.yaml";
        writeFileSync(join(configDir, "config.yaml"), `$schema: ./schema.yaml\nnetwork: ${relativePath}\n`);

        // Write the fragment at the literal resolved location, whether that
        // lands inside or outside the sandbox -- existence is never the
        // thing under test here, confinement is.
        const targetDir = resolvePath(configDir, "../".repeat(hops));
        mkdirSync(targetDir, { recursive: true });
        writeFileSync(join(targetDir, "target.yaml"), "host: example.com\n");

        const result = await resolve(join(configDir, "config.yaml"), { host: createNodeHost(), sandboxRoot });

        if (escapes) {
          expect(result.ok, `trial ${trial}: depth=${depth} hops=${hops} should be refused`).toBe(false);
          if (!result.ok) {
            expect(result.diagnostics.some((d) => d.code === "sandbox-escape"), `trial ${trial}: expected a sandbox-escape diagnostic, got ${JSON.stringify(result.diagnostics.map((d) => d.code))}`).toBe(true);
          }
        } else {
          expect(result.ok, `trial ${trial}: depth=${depth} hops=${hops} should resolve within the sandbox`).toBe(true);
        }
      } finally {
        rmSync(outerDir, { recursive: true, force: true });
      }
    });
  }
});
