/**
 * T044's own trap (CLAUDE.md): the response size cap must be enforced
 * against bytes actually received, never against an advertised
 * `Content-Length` — a hostile (or merely careless) server can claim a
 * small body and deliver an unbounded one. "A fixture with an honest
 * body passes either way, so the test has to use a dishonest one"
 * (CLAUDE.md) — the recording below advertises `content-length: 10`
 * while its actual body is 40 bytes, well past a `maxBytes: 20` limit
 * this test supplies. `src/resolve/fetch.ts`'s `checkSizeCap` is
 * documented as checking `response.body.length`, never the header; this
 * test is what proves that claim rather than merely stating it — see
 * the milestone report for the sabotage run that confirmed it (checking
 * the header instead turns this test red).
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "../../src/index.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { makeTempCacheDir, removeTempCacheDir } from "./remote-test-helpers.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases", "remote-fetch");
const CONFIG_PATH = join(FIXTURE_DIR, "config.yaml");

describe("T044: the size cap trusts actual bytes received, never an advertised Content-Length", () => {
  let cacheDir: string;

  afterEach(() => {
    if (cacheDir !== undefined) {
      removeTempCacheDir(cacheDir);
    }
  });

  it("refuses an oversized body even when Content-Length dishonestly claims a small one", async () => {
    cacheDir = makeTempCacheDir();
    // 40 real bytes, advertised as 10 — and 40 > this test's 20-byte cap.
    const dishonestBody = new TextEncoder().encode("x".repeat(40));
    expect(dishonestBody.length).toBe(40);

    const recording: Recording = {
      url: "https://example.test/schema-root.yaml",
      method: "GET",
      outcome: { kind: "response", response: { status: 200, headers: { "content-length": "10" }, body: dishonestBody } },
    };
    const transport = new RecordedTransport([recording]);

    const result = await resolve(CONFIG_PATH, { sandboxRoot: FIXTURE_DIR, cacheDir, transport, limits: { maxBytes: 20 } });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error(`unreachable — an oversized body must never enter the graph, but got one with ${result.graph.documents.length} document(s)`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("size-limit-exceeded");
  });

  it("control: the same 40-byte body is accepted once the cap is raised above it", async () => {
    cacheDir = makeTempCacheDir();
    const body = new TextEncoder().encode("x".repeat(40));
    const recording: Recording = {
      url: "https://example.test/schema-root.yaml",
      method: "GET",
      outcome: { kind: "response", response: { status: 200, headers: { "content-length": "10" }, body } },
    };
    const transport = new RecordedTransport([recording]);

    const result = await resolve(CONFIG_PATH, { sandboxRoot: FIXTURE_DIR, cacheDir, transport, limits: { maxBytes: 41 } });

    expect(result.ok).toBe(true);
  });
});
