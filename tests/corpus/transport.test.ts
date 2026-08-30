/**
 * Direct tests of RecordedTransport (T009, T010) — the hermetic
 * transport seam User Story 3's fetch layer (out of scope for this
 * slice) will depend on. Proven here, in isolation, the same way
 * tests/corpus/harness.test.ts proves the case runner's own guarantees
 * rather than relying on real cases to happen to exercise them —
 * especially apt here, since no case in this slice uses a transport at
 * all yet (nothing fetches).
 */

import { describe, expect, it } from "vitest";
import { RecordedTransport, type Recording } from "./transport.js";

const okRecording: Recording = {
  url: "https://example.com/schema.yaml",
  method: "GET",
  outcome: { kind: "response", response: { status: 200, headers: {}, body: new TextEncoder().encode("a: 1\n") } },
};

describe("RecordedTransport", () => {
  it("returns the recorded outcome for a matching request", async () => {
    const transport = new RecordedTransport([okRecording]);
    const outcome = await transport.request("https://example.com/schema.yaml", "GET");
    expect(outcome.kind).toBe("response");
    if (outcome.kind !== "response") throw new Error("unreachable");
    expect(outcome.response.status).toBe(200);
    expect([...outcome.response.body]).toEqual([...new TextEncoder().encode("a: 1\n")]);
  });

  it("fails loudly (throws) on a request with no matching recording, rather than passing through", async () => {
    const transport = new RecordedTransport([]);
    await expect(transport.request("https://example.com/nope.yaml", "GET")).rejects.toThrow(/no recorded response/);
  });

  it("distinguishes requests by method, not just URL", async () => {
    const transport = new RecordedTransport([okRecording]);
    await expect(transport.request("https://example.com/schema.yaml", "POST")).rejects.toThrow(/no recorded response/);
  });

  it("consumes multiple recordings for the same request in order (revalidation shape)", async () => {
    const withEtag: Recording = {
      url: "https://example.com/s.yaml",
      method: "GET",
      outcome: { kind: "response", response: { status: 200, headers: { etag: '"v1"' }, body: new TextEncoder().encode("a: 1\n") } },
    };
    const notModified: Recording = {
      url: "https://example.com/s.yaml",
      method: "GET",
      outcome: { kind: "response", response: { status: 304, headers: {}, body: new Uint8Array() } },
    };
    const transport = new RecordedTransport([withEtag, notModified]);
    const first = await transport.request("https://example.com/s.yaml", "GET");
    const second = await transport.request("https://example.com/s.yaml", "GET");
    if (first.kind !== "response" || second.kind !== "response") throw new Error("unreachable");
    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(304);
    expect(() => transport.assertAllConsumed()).not.toThrow();
  });

  it("can record a failure (connection-refused/timeout) instead of a response", async () => {
    const failing: Recording = { url: "https://example.com/down.yaml", method: "GET", outcome: { kind: "failure", failure: { kind: "timeout" } } };
    const transport = new RecordedTransport([failing]);
    const outcome = await transport.request("https://example.com/down.yaml", "GET");
    expect(outcome).toEqual({ kind: "failure", failure: { kind: "timeout" } });
  });

  describe("T010: assertAllConsumed", () => {
    it("passes when every recording was consumed", async () => {
      const transport = new RecordedTransport([okRecording]);
      await transport.request("https://example.com/schema.yaml", "GET");
      expect(() => transport.assertAllConsumed()).not.toThrow();
    });

    it("fails when a case expected a fetch that never happened", () => {
      const transport = new RecordedTransport([okRecording]);
      // Deliberately never calling .request() — the recorded fetch never occurs.
      expect(() => transport.assertAllConsumed()).toThrow(/never consumed/);
    });

    it("fails when only one of two queued recordings for the same request was consumed", async () => {
      const withEtag: Recording = {
        url: "https://example.com/s.yaml",
        method: "GET",
        outcome: { kind: "response", response: { status: 200, headers: {}, body: new Uint8Array() } },
      };
      const notModified: Recording = {
        url: "https://example.com/s.yaml",
        method: "GET",
        outcome: { kind: "response", response: { status: 304, headers: {}, body: new Uint8Array() } },
      };
      const transport = new RecordedTransport([withEtag, notModified]);
      await transport.request("https://example.com/s.yaml", "GET"); // only the first
      expect(() => transport.assertAllConsumed()).toThrow(/1 unconsumed/);
    });
  });
});
