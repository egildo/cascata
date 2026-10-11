/**
 * v1.13 FR-020 -- a fragment in an https reference's URL is refused (`reference-fragment`). Written before the code.
 *
 * Counts by hand: `$schema: ` is nine bytes, `$adopts: ` nine, `network: ` nine. `https://example.test/a.yaml` is
 * 8 ("https://") + 12 ("example.test") + 7 ("/a.yaml") = 27 bytes; with `#x` 29, with a bare `#` 28.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "../../src/index.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { InMemoryHost } from "./host-test-double.js";
import { failureOf, resolveAt, vhost } from "./graph-identity-helpers.js";

const ENCODER = new TextEncoder();
const ok = (url: string, text: string): Recording => ({ url, method: "GET", outcome: { kind: "response", response: { status: 200, headers: {}, body: ENCODER.encode(text) } } });
const redirect = (from: string, to: string): Recording => ({ url: from, method: "GET", outcome: { kind: "response", response: { status: 302, headers: { location: to }, body: new Uint8Array() } } });
const NONE = (): RecordedTransport => new RecordedTransport([]);

describe("v1.13 FR-020: refused, at the reference, before any request", () => {
  it("an absolute reference with a fragment", async () => {
    const d = failureOf(await resolveAt(vhost({ "/v/e.yaml": "$schema: https://example.test/a.yaml#x\n" }), "/v/e.yaml", { transport: NONE() }));
    expect(d.map((x) => x.code)).toEqual(["reference-fragment"]);
    expect(d[0]?.level).toBe("error");
    expect(d[0]?.primary).toMatchObject({ origin: { id: "/v/e.yaml" }, start: 9, end: 38, line: 1, column: 10 });
    expect(d[0]?.message).toContain("'https://example.test/a.yaml#x'");
    expect(d[0]?.message).toContain("fragment '#x'");
  });

  it("an empty fragment is still a fragment", async () => {
    const d = failureOf(await resolveAt(vhost({ "/v/e.yaml": "$schema: https://example.test/a.yaml#\n" }), "/v/e.yaml", { transport: NONE() }));
    expect(d.map((x) => x.code)).toEqual(["reference-fragment"]);
    expect(d[0]?.primary).toMatchObject({ start: 9, end: 37 });
    expect(d[0]?.message).toContain("an empty fragment ('#')");
  });

  it("a relative reference in a remote document: ./b.yaml#y, and a bare #x", async () => {
    // A bare #x is written in quotes: unquoted, YAML reads `#x` as a comment and the value is empty.
    for (const [text, written] of [["./b.yaml#y", "./b.yaml#y"], ["#x", '"#x"']] as const) {
      const transport = new RecordedTransport([ok("https://example.test/a.yaml", `$adopts: ${written}\n`)]);
      const d = failureOf(await resolveAt(vhost({ "/v/e.yaml": "$schema: https://example.test/a.yaml\n" }), "/v/e.yaml", { transport }));
      expect(d.map((x) => x.code), text).toEqual(["reference-fragment"]);
      expect(d[0]?.primary, text).toMatchObject({ origin: { id: "https://example.test/a.yaml" }, start: 9, end: 9 + written.length });
    }
  });

  it("a Host.locate answer with a fragment", async () => {
    const host = new InMemoryHost({ files: new Map([["/v/e.yaml", ENCODER.encode("$schema: beltype:doc\n")]]), identities: new Map([["beltype:doc", "https://example.test/a.yaml#x"]]) });
    const d = failureOf(await resolveAt(host, "/v/e.yaml", { transport: NONE() }));
    expect(d.map((x) => x.code)).toEqual(["reference-fragment"]);
    expect(d[0]?.primary).toMatchObject({ origin: { id: "/v/e.yaml" }, start: 9, end: 20 });
  });

  it("an override, whose reference is the embedder's", async () => {
    const result = await resolve("/v/e.yaml", { host: vhost({ "/v/e.yaml": "x: 1\n" }), sandboxRoot: "/v", transport: NONE(), overrides: ["https://example.test/o.yaml#x"] });
    expect(failureOf(result).map((x) => x.code)).toEqual(["reference-fragment"]);
  });

  it("a delegated remote reference, and a remote fragment's own delegation", async () => {
    const grants = "keys:\n  network:\n    demand:\n      type: mapping\n      keys:\n        network:\n          demand:\n            type: mapping\n          delegate: allow\n    delegate: allow\n";
    const direct = await resolveAt(vhost({ "/v/e.yaml": "$schema: ./s.yaml\nnetwork: https://example.test/f.yaml#x\n", "/v/s.yaml": grants }), "/v/e.yaml", { transport: NONE(), allowRemoteDelegation: true });
    const d1 = failureOf(direct);
    expect(d1.map((x) => x.code)).toEqual(["reference-fragment"]);
    // `https://example.test/f.yaml#x` is 29 bytes. `network: ` after the 18 bytes of `$schema: ./s.yaml\n` puts the value at 27.
    expect(d1[0]?.primary).toMatchObject({ origin: { id: "/v/e.yaml" }, start: 27, end: 56, line: 2, column: 10 });
    const nested = await resolveAt(vhost({ "/v/e.yaml": "$schema: ./s.yaml\nnetwork: https://example.test/f.yaml\n", "/v/s.yaml": grants }), "/v/e.yaml", { transport: new RecordedTransport([ok("https://example.test/f.yaml", "network: ./g.yaml#z\n")]), allowRemoteDelegation: true });
    const d2 = failureOf(nested);
    expect(d2.map((x) => x.code)).toEqual(["reference-fragment"]);
    expect(d2[0]?.primary).toMatchObject({ origin: { label: "https://example.test/f.yaml" }, start: 9, end: 19 });
  });
});

describe("v1.13 FR-020: what it does not touch", () => {
  it("a local file whose name has a # in it still loads: # is an ordinary filename character there", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: ./a#b.yaml\n", "/v/a#b.yaml": "$adopts: ./#c.yaml\n", "/v/#c.yaml": "x: 1\n" });
    const result = await resolveAt(host, "/v/e.yaml");
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.pedigree.map((p) => p.identity.location)).toEqual(["/v/#c.yaml", "/v/a#b.yaml"]);
  });

  it("a redirect whose Location has a fragment loads, and the fragment is not part of the physical URL (nor requested)", async () => {
    // Only the fragment-less URL is recorded: a request that carried `#z` would find no recording.
    const transport = new RecordedTransport([redirect("https://example.test/a.yaml", "https://example.test/b.yaml#z"), ok("https://example.test/b.yaml", "x: 1\n")]);
    const result = await resolveAt(vhost({ "/v/e.yaml": "$schema: https://example.test/a.yaml\n" }), "/v/e.yaml", { transport });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.graph.documents[1]?.identity).toMatchObject({ location: "https://example.test/a.yaml", physical: "https://example.test/b.yaml" });
    expect(() => transport.assertAllConsumed()).not.toThrow();
  });

  it("a reference without a fragment is untouched (control; a query string is a separate matter: a URL with one has no recognizable format extension and was unreadable before v1.13)", async () => {
    const result = await resolveAt(vhost({ "/v/e.yaml": "$schema: https://example.test/a.yaml\n" }), "/v/e.yaml", { transport: new RecordedTransport([ok("https://example.test/a.yaml", "x: 1\n")]) });
    expect(result.ok).toBe(true);
  });
});
