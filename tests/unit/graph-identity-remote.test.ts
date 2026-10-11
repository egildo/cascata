/**
 * v1.13 Part E -- remote documents (FR-014, FR-015, FR-016). Written before the code that judges them.
 *
 * A remote document is a URL, and a redirect is the web's symbolic link: the LOGICAL URL is the reference
 * normalized by the WHATWG URL Standard, the PHYSICAL one is where the fetch ended. Everything runs through
 * the in-memory host (its cache included) and a recorded transport; nothing touches a network.
 *
 * Positions are counted by hand. `$adopts: ` is nine bytes, so a value starts at byte 9; the value
 * `https://example.test/alias.yaml` is 8 ("https://") + 12 ("example.test") + 11 ("/alias.yaml") = 31 bytes,
 * so it ends at 40, and `HTTPS://EXAMPLE.TEST:443/a.yaml` is 8 + 12 + 4 (":443") + 7 ("/a.yaml") = 31 bytes too.
 */
import { describe, expect, it } from "vitest";
import { GraphBuilder, type GraphDocument } from "../../src/graph/build.js";
import { createNullScalar } from "../../src/model/node.js";
import { createOrigin, createSourceSpan } from "../../src/model/span.js";
import { hashBytes } from "../../src/resolve/identity.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { failureOf, resolveAt, vhost } from "./graph-identity-helpers.js";

const ENCODER = new TextEncoder();

function ok(url: string, text: string, headers: Record<string, string> = {}): Recording {
  return { url, method: "GET", outcome: { kind: "response", response: { status: 200, headers, body: ENCODER.encode(text) } } };
}
function redirect(from: string, to: string): Recording {
  return { url: from, method: "GET", outcome: { kind: "response", response: { status: 302, headers: { location: to }, body: new Uint8Array() } } };
}
function offline(url: string): Recording {
  return { url, method: "GET", outcome: { kind: "failure", failure: { kind: "connection-refused" } } };
}

describe("v1.13 FR-014: the logical URL is normalized by the WHATWG URL Standard", () => {
  it("8. HTTPS://Example.test:443/a.yaml is labelled, requested and cached as https://example.test/a.yaml", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: HTTPS://Example.test:443/a.yaml\n", "/v/e2.yaml": "$schema: https://example.test:443/a.yaml\n" });
    // Only the normalized URL is recorded: a request under any other spelling finds nothing and the run fails.
    const transport = new RecordedTransport([ok("https://example.test/a.yaml", "x: 1\n", { "cache-control": "immutable" })]);
    const result = await resolveAt(host, "/v/e.yaml", { transport });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.documents[1]?.identity).toMatchObject({ location: "https://example.test/a.yaml", physical: "https://example.test/a.yaml" });
    expect(result.graph.documents[1]?.tree.span.origin).toEqual({ id: "https://example.test/a.yaml", label: "https://example.test/a.yaml" });
    expect(() => transport.assertAllConsumed()).not.toThrow();
    // The entry cache is keyed by the normalized URL, so another spelling is a fresh hit that makes no request at all.
    const second = await resolveAt(host, "/v/e2.yaml", { transport: new RecordedTransport([]) });
    expect(second.ok).toBe(true);
  });

  it("8b. a schema that adopts itself under the other spelling is one document, hence a cycle, and one request", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: https://example.test/a.yaml\n" });
    const transport = new RecordedTransport([ok("https://example.test/a.yaml", "$adopts: HTTPS://EXAMPLE.TEST:443/a.yaml\n")]);
    const d = failureOf(await resolveAt(host, "/v/e.yaml", { transport }));
    expect(d).toHaveLength(1);
    expect(d[0]?.code).toBe("reference-cycle");
    expect(d[0]?.primary).toMatchObject({ origin: { id: "https://example.test/a.yaml" }, start: 9, end: 40, line: 1, column: 10 });
    expect(() => transport.assertAllConsumed()).not.toThrow();
  });
});

describe("v1.13 FR-014: text the URL Standard cannot parse is left as written, so the refusal that follows is the one that always followed", () => {
  it("an absolute https:// reference that is not a URL is unsupported-scheme from the fetch, as before", async () => {
    const d = failureOf(await resolveAt(vhost({ "/v/e.yaml": "$schema: https://[::1\n" }), "/v/e.yaml", { transport: new RecordedTransport([]) }));
    expect(d.map((x) => x.code)).toEqual(["unsupported-scheme"]);
    expect(d[0]?.message).toContain("'https://[::1' is not a valid URL");
  });

  it("a relative reference in a remote document that is not a URL is a refusal, not a thrown TypeError (the old code threw)", async () => {
    const transport = new RecordedTransport([ok("https://example.test/a.yaml", "$adopts: //[x\n")]);
    const d = failureOf(await resolveAt(vhost({ "/v/e.yaml": "$schema: https://example.test/a.yaml\n" }), "/v/e.yaml", { transport }));
    expect(d.map((x) => x.code)).toEqual(["unsupported-scheme"]);
    expect(d[0]?.primary).toMatchObject({ origin: { id: "https://example.test/a.yaml" } });
    // It names the text and says what is wrong with it, not an empty scheme.
    expect(d[0]?.message).toContain("'//[x' is not a valid URL");
    expect(d[0]?.message).not.toContain("scheme ''");
  });
});

describe("v1.13 FR-015: the physical URL is the URL after redirects", () => {
  it("a document behind a redirect has the requested URL as its logical one and the final URL as its physical one", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: https://example.test/a.yaml\n" });
    const transport = new RecordedTransport([redirect("https://example.test/a.yaml", "https://cdn.test/v1/a.yaml"), ok("https://cdn.test/v1/a.yaml", "x: 1\n")]);
    const result = await resolveAt(host, "/v/e.yaml", { transport });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.documents[1]?.identity).toMatchObject({ location: "https://example.test/a.yaml", physical: "https://cdn.test/v1/a.yaml" });
    expect(result.graph.documents[1]?.tree.span.origin).toEqual({ id: "https://example.test/a.yaml", label: "https://example.test/a.yaml", physical: "https://cdn.test/v1/a.yaml" });
  });

  it("offline, the same physical URL comes back from the cache, where it was recorded when the document was stored", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: https://example.test/a.yaml\n" });
    const first = await resolveAt(host, "/v/e.yaml", { transport: new RecordedTransport([redirect("https://example.test/a.yaml", "https://cdn.test/v1/a.yaml"), ok("https://cdn.test/v1/a.yaml", "x: 1\n")]) });
    expect(first.ok).toBe(true);
    // No max-age: the entry is stale at once, so the second run asks, is refused, and falls back to the stored copy.
    const second = await resolveAt(host, "/v/e.yaml", { transport: new RecordedTransport([offline("https://example.test/a.yaml")]) });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.graph.documents[1]?.identity).toMatchObject({ location: "https://example.test/a.yaml", physical: "https://cdn.test/v1/a.yaml" });
  });

  it("a cache entry stored before v1.13 has no final URL and answers its own URL as physical; no refetch is forced", async () => {
    const url = "https://example.test/a.yaml";
    const bytes = ENCODER.encode("x: 1\n");
    const host = vhost({ "/v/e.yaml": `$schema: ${url}\n` });
    await host.cacheWrite(`blob/${hashBytes(bytes)}`, bytes);
    // The metadata exactly as v1.12 wrote it: a hash and freshness, and nothing else.
    await host.cacheWrite(`meta/${hashBytes(ENCODER.encode(url))}`, ENCODER.encode(JSON.stringify({ hash: hashBytes(bytes), freshness: { fetchedAt: 0, immutable: true, noCache: false } })));
    const result = await resolveAt(host, "/v/e.yaml", { transport: new RecordedTransport([]) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.documents[1]?.identity).toMatchObject({ location: url, physical: url });
  });
});

describe("v1.13 FR-016: remote cycles and duplicates by physical URL", () => {
  // a.yaml adopts alias.yaml; both URLs redirect to the one file at cdn.test. The second answer is a different body on purpose:
  // the decision is the final URL's, made before the bytes could settle it.
  const recordings = (): Recording[] => [
    redirect("https://example.test/a.yaml", "https://cdn.test/a.yaml"),
    ok("https://cdn.test/a.yaml", "$adopts: https://example.test/alias.yaml\n"),
    redirect("https://example.test/alias.yaml", "https://cdn.test/a.yaml"),
    ok("https://cdn.test/a.yaml", "x: 1\n"),
  ];

  it("7b. a schema that adopts itself through a redirect is reference-cycle, naming both URLs", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: https://example.test/a.yaml\n" });
    const transport = new RecordedTransport(recordings());
    const d = failureOf(await resolveAt(host, "/v/e.yaml", { transport }));
    expect(d).toHaveLength(1);
    expect(d[0]?.code).toBe("reference-cycle");
    expect(d[0]?.primary).toMatchObject({ origin: { id: "https://example.test/a.yaml" }, start: 9, end: 40, line: 1, column: 10 });
    expect(d[0]?.related).toEqual([]);
    expect(d[0]?.message).toContain("'https://example.test/a.yaml' (the file 'https://cdn.test/a.yaml') is reached again as 'https://example.test/alias.yaml' (the file 'https://cdn.test/a.yaml')");
    expect(() => transport.assertAllConsumed()).not.toThrow();
  });

  it("7b. offline, the same refusal comes from the cache", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: https://example.test/a.yaml\n" });
    failureOf(await resolveAt(host, "/v/e.yaml", { transport: new RecordedTransport(recordings()) }));
    const d = failureOf(await resolveAt(host, "/v/e.yaml", { transport: new RecordedTransport([offline("https://example.test/a.yaml"), offline("https://example.test/alias.yaml")]) }));
    expect(d[0]?.code).toBe("reference-cycle");
    expect(d[0]?.primary).toMatchObject({ origin: { id: "https://example.test/a.yaml" }, start: 9, end: 40 });
  });

  it("GraphBuilder, directly: a remote visit learns its physical URL after the fetch, and that is judged like a local one", () => {
    const builder = new GraphBuilder();
    expect(builder.beginVisit("https://x.test/a", undefined).kind).toBe("new");
    // A finished document at the final URL: the new visit is a duplicate and its frame is gone.
    expect(builder.beginVisit("https://x.test/b", undefined).kind).toBe("new");
    expect(builder.learnPhysical("https://x.test/b", "https://cdn.test/f").kind).toBe("new");
    builder.finishVisit("https://x.test/b", fake("https://x.test/b", "d"));
    expect(builder.beginVisit("https://x.test/c", undefined).kind).toBe("new");
    const duplicate = builder.learnPhysical("https://x.test/c", "https://cdn.test/f");
    expect(duplicate.kind).toBe("duplicate");
    // An active document at the final URL: a cycle, naming both.
    expect(builder.beginVisit("https://x.test/d", undefined).kind).toBe("new");
    expect(builder.learnPhysical("https://x.test/d", "https://x.test/a").kind).toBe("cycle");
  });
});

function fake(location: string, hashChar: string): GraphDocument {
  const origin = createOrigin(location, location);
  const span = createSourceSpan({ origin, start: 0, end: 0, line: 1, column: 1, documentLength: 0 });
  return { identity: { location, physical: location, hash: hashChar.repeat(64) }, tree: createNullScalar(span), verified: false };
}
