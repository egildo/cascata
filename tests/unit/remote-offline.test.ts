/**
 * T038 (User Story 3 conformance cases): offline resolution from cache,
 * a document neither cached nor reachable, and a **stale** cached
 * document with no network (v0.2 FR-018) — spec.md Acceptance Scenarios
 * 4 and 5 (US3).
 *
 * Three scenarios, three separate `resolve()` calls against the same
 * on-disk `cacheDir` (a real `DocumentCache` — v0.2 FR-016 is explicitly
 * about surviving *across* calls, so an in-memory stand-in would prove
 * nothing):
 *
 *   1. Fresh cache, no network needed at all — proven with a hand-rolled
 *      counting `Transport` rather than `RecordedTransport`, because
 *      `RecordedTransport` with zero recordings still lets a wrongly-
 *      issued request *succeed* here: `resolveRemoteDocument`'s FR-018
 *      fallback would catch the rejected promise and quietly serve the
 *      (still-present) cached bytes anyway, masking exactly the bug this
 *      case exists to catch. Counting the actual call count is the only
 *      assertion that cannot be fooled by that fallback.
 *   2. Never fetched, no network available — `document-not-cached`.
 *   3. Cached but stale, no network available — still resolves,
 *      unchanged bytes, per FR-018's "a content-addressed body cannot
 *      silently drift, so staleness is a revalidation hint rather than
 *      grounds for refusal."
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "../../src/index.js";
import type { RecordingOutcome, Transport } from "../../src/resolve/transport.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { makeTempCacheDir, removeTempCacheDir } from "./remote-test-helpers.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases", "remote-offline");
const CONFIG_PATH = join(FIXTURE_DIR, "config.yaml");
const SCHEMA_BYTES = new TextEncoder().encode("title: offline schema\n");
// Hand-derived via `shasum -a 256 tests/corpus/cases/remote-offline/schema-offline.yaml`.
const SCHEMA_HASH = "c8fdf1f2b5158d1466b29dc6551f74acba02a4e17cb37ac8e210913a60cb62aa";
const URL = "https://example.test/schema-offline.yaml";

/** A `Transport` that counts every call and always fails — used only to prove a call count of zero, which `RecordedTransport` cannot (see this file's module doc). */
class CountingTransport implements Transport {
  calls = 0;
  async request(): Promise<RecordingOutcome> {
    this.calls += 1;
    return { kind: "failure", failure: { kind: "connection-refused" } };
  }
}

describe("T038: offline resolution — fresh cache, absent cache, stale cache", () => {
  let cacheDir: string;

  afterEach(() => {
    if (cacheDir !== undefined) {
      removeTempCacheDir(cacheDir);
    }
  });

  it("a fresh cache entry resolves with zero network calls", async () => {
    cacheDir = makeTempCacheDir();
    const firstRecording: Recording = {
      url: URL,
      method: "GET",
      outcome: { kind: "response", response: { status: 200, headers: { "cache-control": "max-age=3600" }, body: SCHEMA_BYTES } },
    };
    const first = await resolve(CONFIG_PATH, { sandboxRoot: FIXTURE_DIR, cacheDir, transport: new RecordedTransport([firstRecording]) });
    expect(first.ok).toBe(true);

    const counting = new CountingTransport();
    const second = await resolve(CONFIG_PATH, { sandboxRoot: FIXTURE_DIR, cacheDir, transport: counting });

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(`unreachable: ${JSON.stringify(second.diagnostics)}`);
    expect(second.pedigree[0]?.identity.hash).toBe(SCHEMA_HASH);
    expect(counting.calls).toBe(0);
  });

  it("a document neither cached nor reachable refuses with document-not-cached", async () => {
    cacheDir = makeTempCacheDir();
    const failing: Recording = { url: URL, method: "GET", outcome: { kind: "failure", failure: { kind: "connection-refused" } } };
    const result = await resolve(CONFIG_PATH, { sandboxRoot: FIXTURE_DIR, cacheDir, transport: new RecordedTransport([failing]) });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("document-not-cached");
  });

  it("a stale cache entry still resolves with no network available (FR-018)", async () => {
    cacheDir = makeTempCacheDir();
    // No Cache-Control at all -> stale immediately (DocumentCache.isFresh's
    // conservative default), forcing revalidation on the very next call.
    const firstRecording: Recording = { url: URL, method: "GET", outcome: { kind: "response", response: { status: 200, headers: {}, body: SCHEMA_BYTES } } };
    const first = await resolve(CONFIG_PATH, { sandboxRoot: FIXTURE_DIR, cacheDir, transport: new RecordedTransport([firstRecording]) });
    expect(first.ok).toBe(true);

    const offlineOnRevalidate: Recording = { url: URL, method: "GET", outcome: { kind: "failure", failure: { kind: "connection-refused" } } };
    const second = await resolve(CONFIG_PATH, { sandboxRoot: FIXTURE_DIR, cacheDir, transport: new RecordedTransport([offlineOnRevalidate]) });

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(`unreachable: ${JSON.stringify(second.diagnostics)}`);
    expect(second.pedigree[0]?.identity.hash).toBe(SCHEMA_HASH);
  });
});
