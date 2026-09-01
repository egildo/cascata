/**
 * T040 (User Story 3 conformance case): the pedigree distinguishes
 * hash-verified entries from unpinned ones — spec.md Acceptance Scenario
 * 7 (US3), v0.2 FR-026, `SPEC.md` §11's amendment ("a pin is verified
 * whenever present, absolutely... this is what makes a published root's
 * future demand for pinned adoption auditable").
 *
 * Chain: config `--($schema, pinned)-->` schema-a `--($adopts,
 * unpinned)-->` schema-b (root, no further `$adopts`). Root-to-leaf
 * pedigree order is therefore [schema-b, schema-a] — schema-b unverified
 * (nothing pins it), schema-a verified (config's `$pin` names it
 * exactly).
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { makeTempCacheDir, removeTempCacheDir } from "./remote-test-helpers.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases", "remote-audit");
const CONFIG_PATH = join(FIXTURE_DIR, "config.yaml");

const SCHEMA_A_BYTES = new TextEncoder().encode("$adopts: https://example.test/schema-b.yaml\ntitle: middle schema\n");
const SCHEMA_B_BYTES = new TextEncoder().encode("title: leaf schema\n");
// Both hand-derived via `shasum -a 256` outside this codebase.
const SCHEMA_A_HASH = "f57d5299795e751a7527e051541b251e220b36292a14dd15874e0c3e11b30fa8";
const SCHEMA_B_HASH = "951944e36d557d7f0fe5622de73e9d44fd97b6a1c9e533f74883c07f26679342";

describe("T040: pedigree distinguishes verified (pinned) from unverified (unpinned) entries", () => {
  let cacheDir: string;

  afterEach(() => {
    if (cacheDir !== undefined) {
      removeTempCacheDir(cacheDir);
    }
  });

  it("marks the pinned link verified:true and the unpinned link verified:false", async () => {
    cacheDir = makeTempCacheDir();
    const recordings: Recording[] = [
      { url: "https://example.test/schema-a.yaml", method: "GET", outcome: { kind: "response", response: { status: 200, headers: {}, body: SCHEMA_A_BYTES } } },
      { url: "https://example.test/schema-b.yaml", method: "GET", outcome: { kind: "response", response: { status: 200, headers: {}, body: SCHEMA_B_BYTES } } },
    ];
    const transport = new RecordedTransport(recordings);

    const result = await resolve(CONFIG_PATH, { host: createNodeHost({ cacheDir }), sandboxRoot: FIXTURE_DIR, transport });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`unreachable: ${JSON.stringify(result.diagnostics)}`);
    expect(result.pedigree).toHaveLength(2);

    // Root-to-leaf: schema-b (root, unpinned) then schema-a (leaf, pinned).
    expect(result.pedigree[0]?.identity.hash).toBe(SCHEMA_B_HASH);
    expect(result.pedigree[0]?.verified).toBe(false);

    expect(result.pedigree[1]?.identity.hash).toBe(SCHEMA_A_HASH);
    expect(result.pedigree[1]?.verified).toBe(true);

    expect(() => transport.assertAllConsumed()).not.toThrow();
  });
});
