/**
 * v0.6 FR-024, FR-025 -- remote delegation, written against Article VI
 * (SPEC.md Sec16, commit c71adc7): "the host answered, or the host
 * refused", never "the library fetched". `performGraft`'s remote branch
 * (`src/index.ts`) reuses the identical `Transport` seam remote
 * `$schema`/`$adopts` fetches have used since v0.2 -- there is no
 * delegation-specific fetch mechanism to test here, only the two
 * outcomes a host can produce for one request (`RecordingOutcome`,
 * `src/resolve/transport.ts`): a `"response"` (the host answered) or a
 * `"failure"` (the host declined -- `connection-refused`/`timeout`).
 * Written this way deliberately: v0.7 unifies local reads into this
 * same seam (SPEC.md's own Sec15 amendment entry), and a case phrased
 * in terms of what the host did, rather than how the current transport
 * plumbing is wired, survives that unification with only the wiring
 * moving underneath it.
 *
 * T035 (no opt-in at all) needs **no transport recording whatsoever**:
 * `allowRemoteDelegation` is checked before any request is ever made,
 * so a zero-recording `RecordedTransport` would throw if the
 * implementation ever attempted to ask -- the same "no network access,
 * ever" guarantee `remote-fetch.test.ts`'s own http:// case already
 * relies on for the identical reason.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolve, merge, validate } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { makeTempCacheDir, removeTempCacheDir } from "./remote-test-helpers.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases", "delegation-remote");
const CONFIG_PATH = join(FIXTURE_DIR, "config.yaml");
const NETWORK_BYTES = readFileSync(join(FIXTURE_DIR, "network.yaml"));

// Hand-derived via `shasum -a 256 tests/corpus/cases/delegation-remote/network.yaml`
// outside this codebase -- an external oracle, never copied from a test run.
const NETWORK_HASH = "1ba1999cab1cab115940fc2e231806bcac2b3fafd94d41321eb4084eebe54001";

describe("v0.6 FR-024/FR-025 -- remote delegation is the host answering or the host refusing", () => {
  let cacheDir: string;

  afterEach(() => {
    if (cacheDir !== undefined) {
      removeTempCacheDir(cacheDir);
    }
  });

  it("T035: with no caller opt-in, a remote delegation target is refused before the host is ever asked -- an ordinary diagnostic naming the missing opt-in, never a network attempt", async () => {
    // Zero recordings: RecordedTransport throws on any unmatched request,
    // so if the implementation ever asked the host despite the missing
    // opt-in, this test would fail loudly rather than silently pass.
    const transport = new RecordedTransport([]);
    cacheDir = makeTempCacheDir();
    const result = await resolve(CONFIG_PATH, { host: createNodeHost({ cacheDir }), sandboxRoot: FIXTURE_DIR, transport });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("remote-delegation-not-permitted");
    expect(result.diagnostics[0]?.primary.line).toBe(2);
    expect(result.diagnostics[0]?.primary.column).toBe(10);
    expect(transport.assertAllConsumed()).toBeUndefined();
  });

  it("T036: with the caller's opt-in, the host answering (a 200 response) grafts the fragment exactly like a local one", async () => {
    cacheDir = makeTempCacheDir();
    const recording: Recording = {
      url: "https://example.test/network.yaml",
      method: "GET",
      outcome: { kind: "response", response: { status: 200, headers: {}, body: NETWORK_BYTES } },
    };
    const transport = new RecordedTransport([recording]);

    const resolved = await resolve(CONFIG_PATH, { host: createNodeHost({ cacheDir }), sandboxRoot: FIXTURE_DIR, transport, allowRemoteDelegation: true });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const merged = merge(resolved);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;

    const result = validate(merged.configuration);
    expect(result.ok).toBe(true);

    expect(() => transport.assertAllConsumed()).not.toThrow();
  });

  it("the host refusing (a connection failure) is an ordinary diagnostic, not a thrown exception, even with opt-in granted", async () => {
    cacheDir = makeTempCacheDir();
    const recording: Recording = {
      url: "https://example.test/network.yaml",
      method: "GET",
      outcome: { kind: "failure", failure: { kind: "connection-refused" } },
    };
    const transport = new RecordedTransport([recording]);

    const result = await resolve(CONFIG_PATH, { host: createNodeHost({ cacheDir }), sandboxRoot: FIXTURE_DIR, transport, allowRemoteDelegation: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    // Whatever code resolveRemoteDocument's own failure-translation
    // produces for a connection failure with nothing cached (v0.2's own
    // existing behaviour, unchanged by delegation) -- asserted against
    // the same catalogue remote $schema/$adopts fetches already use,
    // not a delegation-specific code, since this is the identical seam.
    expect(result.diagnostics[0]?.code).toBe("document-not-cached");
    expect(() => transport.assertAllConsumed()).not.toThrow();
  });
});
