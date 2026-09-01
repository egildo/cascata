/**
 * T042 (User Story 3 conformance cases): redirect safety — an HTTPS
 * response redirecting to plain HTTP, and a redirect loop exceeding the
 * hop cap — spec.md Acceptance Scenarios 8 and 9 (US3), v0.2 FR-027,
 * FR-028; contracts/diagnostics.md's `insecure-redirect` /
 * `too-many-redirects`.
 *
 * **T045's own trap (CLAUDE.md, "redirects are followed one hop at a
 * time, and every hop must satisfy v0.2 FR-013")**: checking only the
 * *final* destination is the bypass FR-013 exists to prevent — by the
 * time only the last URL is inspected, the insecure request has already
 * been made. The insecure-redirect case below proves the stronger
 * property: the transport is asked for the **first** (HTTPS) URL only —
 * `transport.assertAllConsumed()` on a `RecordedTransport` supplying
 * *only* that one recording would fail loudly if the implementation ever
 * attempted the `http://` hop, since no recording exists for it.
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { makeTempCacheDir, removeTempCacheDir } from "./remote-test-helpers.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases", "remote-redirect");

describe("T042: redirect safety", () => {
  let cacheDir: string;

  afterEach(() => {
    if (cacheDir !== undefined) {
      removeTempCacheDir(cacheDir);
    }
  });

  it("refuses a redirect from HTTPS to plain HTTP before the insecure hop is followed", async () => {
    cacheDir = makeTempCacheDir();
    // Only ONE recording: the initial HTTPS request. If the
    // implementation ever issued a request to the http:// Location
    // instead of refusing before following it, RecordedTransport would
    // have nothing queued for that URL.
    const redirectToHttp: Recording = {
      url: "https://example.test/redirect-start.yaml",
      method: "GET",
      outcome: { kind: "response", response: { status: 302, headers: { location: "http://example.test/insecure.yaml" }, body: new Uint8Array() } },
    };
    const transport = new RecordedTransport([redirectToHttp]);

    const result = await resolve(join(FIXTURE_DIR, "config-insecure.yaml"), { host: createNodeHost({ cacheDir }), sandboxRoot: FIXTURE_DIR, transport });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("insecure-redirect");
    expect(() => transport.assertAllConsumed()).not.toThrow();
  });

  it("refuses a redirect loop once the hop cap is exceeded, rather than following it indefinitely", async () => {
    cacheDir = makeTempCacheDir();
    const redirect = (from: string, to: string): Recording => ({
      url: from,
      method: "GET",
      outcome: { kind: "response", response: { status: 302, headers: { location: to }, body: new Uint8Array() } },
    });
    // maxRedirects: 2 — hop 1 (loop-1 -> loop-2), hop 2 (loop-2 -> loop-3)
    // are within the cap; hop 3 (loop-3 -> loop-4) exceeds it and must be
    // refused *before* loop-4 is ever requested (no recording for it
    // exists — same "loudly fails if attempted" property as above).
    const recordings: Recording[] = [
      redirect("https://example.test/loop-1.yaml", "https://example.test/loop-2.yaml"),
      redirect("https://example.test/loop-2.yaml", "https://example.test/loop-3.yaml"),
      redirect("https://example.test/loop-3.yaml", "https://example.test/loop-4.yaml"),
    ];
    const transport = new RecordedTransport(recordings);

    const result = await resolve(join(FIXTURE_DIR, "config-loop.yaml"), { host: createNodeHost({ cacheDir }), sandboxRoot: FIXTURE_DIR, transport, limits: { maxRedirects: 2 } });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("too-many-redirects");
    expect(() => transport.assertAllConsumed()).not.toThrow();
  });
});
