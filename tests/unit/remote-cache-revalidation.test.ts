/**
 * T041 (User Story 3 conformance cases): revalidation — a first response
 * carrying an `ETag`, a second returning `304 Not Modified` —
 * research D3, v0.2 FR-017, contracts/recorded-responses.md's own
 * example of why recordings for one URL are consumed in order ("first
 * request returns a body and an `ETag`, second returns `304 Not
 * Modified`").
 *
 * Three `resolve()` calls against one on-disk cache:
 *   1. `Cache-Control: max-age=0` (immediately stale) + `ETag` — cached,
 *      but must be revalidated on the very next use.
 *   2. `304 Not Modified` — the cached bytes are kept, and (this file's
 *      own addition, past the two-response shape T041 names) the 304's
 *      own `Cache-Control: max-age=3600` refreshes freshness metadata.
 *   3. Proves that refresh actually happened: zero network calls needed
 *      (`CountingTransport`, for the same reason `remote-offline.test.ts`
 *      needs it rather than an empty `RecordedTransport` — see that
 *      file's module doc).
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "../../src/index.js";
import type { RecordingOutcome, Transport } from "../../src/resolve/transport.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { makeTempCacheDir, removeTempCacheDir } from "./remote-test-helpers.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases", "remote-cache");
const CONFIG_PATH = join(FIXTURE_DIR, "config.yaml");
const SCHEMA_BYTES = new TextEncoder().encode("title: revalidated schema\n");
// Hand-derived via `shasum -a 256 tests/corpus/cases/remote-cache/schema-revalidate.yaml`.
const SCHEMA_HASH = "0a84fe7b13c8ca10997cbfc4db773b312ff478b95cc18379e53cc88c12a437e2";
const URL = "https://example.test/schema-revalidate.yaml";

class CountingTransport implements Transport {
  calls = 0;
  async request(): Promise<RecordingOutcome> {
    this.calls += 1;
    return { kind: "failure", failure: { kind: "connection-refused" } };
  }
}

describe("T041: revalidation — ETag then 304, freshness metadata refreshed on revalidation", () => {
  let cacheDir: string;

  afterEach(() => {
    if (cacheDir !== undefined) {
      removeTempCacheDir(cacheDir);
    }
  });

  it("a stale cached entry is revalidated (304) and keeps its bytes", async () => {
    cacheDir = makeTempCacheDir();

    const withEtag: Recording = {
      url: URL,
      method: "GET",
      outcome: { kind: "response", response: { status: 200, headers: { etag: '"v1"', "cache-control": "max-age=0" }, body: SCHEMA_BYTES } },
    };
    const first = await resolve(CONFIG_PATH, { sandboxRoot: FIXTURE_DIR, cacheDir, transport: new RecordedTransport([withEtag]) });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(`unreachable: ${JSON.stringify(first.diagnostics)}`);
    expect(first.pedigree[0]?.identity.hash).toBe(SCHEMA_HASH);

    const notModified: Recording = {
      url: URL,
      method: "GET",
      outcome: { kind: "response", response: { status: 304, headers: { etag: '"v1"', "cache-control": "max-age=3600" }, body: new Uint8Array() } },
    };
    const secondTransport = new RecordedTransport([notModified]);
    const second = await resolve(CONFIG_PATH, { sandboxRoot: FIXTURE_DIR, cacheDir, transport: secondTransport });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(`unreachable: ${JSON.stringify(second.diagnostics)}`);
    expect(second.pedigree[0]?.identity.hash).toBe(SCHEMA_HASH);
    expect(() => secondTransport.assertAllConsumed()).not.toThrow();

    // The 304's own Cache-Control refreshed freshness — a third call
    // needs no network at all.
    const counting = new CountingTransport();
    const third = await resolve(CONFIG_PATH, { sandboxRoot: FIXTURE_DIR, cacheDir, transport: counting });
    expect(third.ok).toBe(true);
    if (!third.ok) throw new Error(`unreachable: ${JSON.stringify(third.diagnostics)}`);
    expect(third.pedigree[0]?.identity.hash).toBe(SCHEMA_HASH);
    expect(counting.calls).toBe(0);
  });
});
