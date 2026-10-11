/**
 * v1.13 FR-021 -- a remote document's format comes from its URL's path, not from its whole text. Written before the code.
 *
 * `https://x/a.yaml?v=2` has the extension `.yaml` (the WHATWG `pathname` is `/a.yaml`); before v1.13 the format was read from
 * the end of the text, which is `?v=2`, and the document was "not readable". A local location is read as it always was.
 * The probe for a format is a path's extension; `Content-Type` is not consulted.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { editTarget, merge, resolve } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { hashBytes } from "../../src/resolve/identity.js";
import { failureOf, resolveAt, vhost } from "./graph-identity-helpers.js";

const ENCODER = new TextEncoder();
const ok = (url: string, text: string): Recording => ({ url, method: "GET", outcome: { kind: "response", response: { status: 200, headers: {}, body: ENCODER.encode(text) } } });
const redirect = (from: string, to: string): Recording => ({ url: from, method: "GET", outcome: { kind: "response", response: { status: 302, headers: { location: to }, body: new Uint8Array() } } });
const offline = (url: string): Recording => ({ url, method: "GET", outcome: { kind: "failure", failure: { kind: "connection-refused" } } });
const GRANTS = "keys:\n  network:\n    demand:\n      type: mapping\n    delegate: allow\n";

describe("v1.13 FR-021: a query no longer hides the extension", () => {
  it("a remote $schema to a.yaml?v=2 reads as YAML", async () => {
    const transport = new RecordedTransport([ok("https://example.test/a.yaml?v=2", "x: 1\n")]);
    const result = await resolveAt(vhost({ "/v/e.yaml": "$schema: https://example.test/a.yaml?v=2\n" }), "/v/e.yaml", { transport });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.pedigree.map((p) => p.identity.location)).toEqual(["https://example.test/a.yaml?v=2"]);
  });

  it("a remote $adopts to b.json?v=2 reads as JSON: JSON text parses, and YAML-only text is refused by the JSON reader", async () => {
    const files = { "/v/e.yaml": "$schema: https://example.test/a.yaml\n" };
    const good = new RecordedTransport([ok("https://example.test/a.yaml", "$adopts: https://example.test/b.json?v=2\n"), ok("https://example.test/b.json?v=2", '{"x": 1}\n')]);
    expect((await resolveAt(vhost(files), "/v/e.yaml", { transport: good })).ok).toBe(true);
    // `x: 1` is a YAML mapping and not JSON: only the JSON reader refuses it, so this proves which reader ran.
    const bad = new RecordedTransport([ok("https://example.test/a.yaml", "$adopts: https://example.test/b.json?v=2\n"), ok("https://example.test/b.json?v=2", "x: 1\n")]);
    const d = failureOf(await resolveAt(vhost(files), "/v/e.yaml", { transport: bad }));
    expect(d.map((x) => x.code)).toEqual(["document-unreachable"]);
    // The reason is the JSON reader's own, not "no adapter recognizes the format".
    expect(d[0]?.message).toContain("is not readable as a document");
    expect(d[0]?.related.map((r) => r.label).join(" ")).not.toContain("No adapter recognizes");
  });

  it("a URL whose query contains .json but whose path is .yaml reads as YAML", async () => {
    const transport = new RecordedTransport([ok("https://example.test/a.yaml?f=b.json", "x: 1\n")]);
    const result = await resolveAt(vhost({ "/v/e.yaml": "$schema: https://example.test/a.yaml?f=b.json\n" }), "/v/e.yaml", { transport });
    expect(result.ok).toBe(true);
  });

  it("a URL whose path has no recognised extension is still unreadable, whatever its query says (control)", async () => {
    const transport = new RecordedTransport([ok("https://example.test/a?f=b.yaml", "x: 1\n")]);
    const d = failureOf(await resolveAt(vhost({ "/v/e.yaml": "$schema: https://example.test/a?f=b.yaml\n" }), "/v/e.yaml", { transport }));
    expect(d[0]?.related.map((r) => r.label).join(" ")).toContain("No adapter recognizes the format of 'https://example.test/a?f=b.yaml'");
  });

  it("every caller: the launching schema, an override, a delegated remote fragment", async () => {
    const entry = vhost({ "/v/e.yaml": "x: 1\n" });
    const launching = await resolve("/v/e.yaml", { host: entry, sandboxRoot: "/v", transport: new RecordedTransport([ok("https://example.test/s.yaml?v=2", "y: 1\n")]), schema: "https://example.test/s.yaml?v=2" });
    expect(launching.ok).toBe(true);
    const override = await resolve("/v/e.yaml", { host: vhost({ "/v/e.yaml": "x: 1\n" }), sandboxRoot: "/v", transport: new RecordedTransport([ok("https://example.test/o.yaml?v=2", "k: 2\n")]), overrides: ["https://example.test/o.yaml?v=2"] });
    expect(override.ok).toBe(true);
    const delegated = await resolveAt(vhost({ "/v/e.yaml": "$schema: ./s.yaml\nnetwork: https://example.test/f.yaml?v=2\n", "/v/s.yaml": GRANTS }), "/v/e.yaml", { transport: new RecordedTransport([ok("https://example.test/f.yaml?v=2", "host: a\n")]), allowRemoteDelegation: true });
    if (!delegated.ok) throw new Error(JSON.stringify(delegated.diagnostics));
    expect([...delegated.delegationBreadcrumbs.keys()]).toEqual(["https://example.test/f.yaml?v=2 #graft=1"]);
  });

  it("editTarget still refuses a value from such a document as edit-target-remote, before it asks for a writer", async () => {
    const resolved = await resolve("/v/e.yaml", { host: vhost({ "/v/e.yaml": "x: 1\n" }), sandboxRoot: "/v", transport: new RecordedTransport([ok("https://example.test/o.yaml?v=2", "k: 2\n")]), overrides: ["https://example.test/o.yaml?v=2"] });
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
    const merged = merge(resolved);
    if (!merged.ok) throw new Error(JSON.stringify(merged.diagnostics));
    const answer = editTarget(merged.configuration, "/k");
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.diagnostics[0]?.code).toBe("edit-target-remote");
  });
});

describe("v1.13 FR-021 (refined): the extension is read from the physical URL, after redirects", () => {
  const entry = { "/v/e.yaml": "$schema: https://example.test/schemas/latest\n" };

  it("a redirect from an extensionless URL to .yaml reads as YAML", async () => {
    const transport = new RecordedTransport([redirect("https://example.test/schemas/latest", "https://cdn.test/v2.yaml"), ok("https://cdn.test/v2.yaml", "x: 1\n")]);
    const result = await resolveAt(vhost(entry), "/v/e.yaml", { transport });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.graph.documents[1]?.identity).toMatchObject({ location: "https://example.test/schemas/latest", physical: "https://cdn.test/v2.yaml" });
  });

  it("a redirect to .json reads as JSON: JSON text parses and YAML-only text is refused by the JSON reader", async () => {
    const good = new RecordedTransport([redirect("https://example.test/schemas/latest", "https://cdn.test/v2.json"), ok("https://cdn.test/v2.json", '{"x": 1}\n')]);
    expect((await resolveAt(vhost(entry), "/v/e.yaml", { transport: good })).ok).toBe(true);
    const bad = new RecordedTransport([redirect("https://example.test/schemas/latest", "https://cdn.test/v2.json"), ok("https://cdn.test/v2.json", "x: 1\n")]);
    const d = failureOf(await resolveAt(vhost(entry), "/v/e.yaml", { transport: bad }));
    expect(d[0]?.message).toContain("is not readable as a document");
    expect(d[0]?.related.map((r) => r.label).join(" ")).not.toContain("No adapter recognizes");
  });

  it("offline, the cache's recorded final URL gives the same format", async () => {
    const host = vhost(entry);
    const first = await resolveAt(host, "/v/e.yaml", { transport: new RecordedTransport([redirect("https://example.test/schemas/latest", "https://cdn.test/v2.yaml"), ok("https://cdn.test/v2.yaml", "x: 1\n")]) });
    expect(first.ok).toBe(true);
    const second = await resolveAt(host, "/v/e.yaml", { transport: new RecordedTransport([offline("https://example.test/schemas/latest")]) });
    expect(second.ok).toBe(true);
  });

  it("a cache entry stored before v1.13 has no final URL and is read by its own URL's extension", async () => {
    const url = "https://example.test/a.yaml?v=2";
    const bytes = ENCODER.encode("x: 1\n");
    const host = vhost({ "/v/e.yaml": `$schema: ${url}\n` });
    await host.cacheWrite(`blob/${hashBytes(bytes)}`, bytes);
    await host.cacheWrite(`meta/${hashBytes(ENCODER.encode(url))}`, ENCODER.encode(JSON.stringify({ hash: hashBytes(bytes), freshness: { fetchedAt: 0, immutable: true, noCache: false } })));
    expect((await resolveAt(host, "/v/e.yaml", { transport: new RecordedTransport([]) })).ok).toBe(true);
  });

  it("the mirror consequence: a redirect from a.yaml to an extensionless URL is now unreadable", async () => {
    const transport = new RecordedTransport([redirect("https://example.test/a.yaml", "https://cdn.test/blob/a"), ok("https://cdn.test/blob/a", "x: 1\n")]);
    const d = failureOf(await resolveAt(vhost({ "/v/e.yaml": "$schema: https://example.test/a.yaml\n" }), "/v/e.yaml", { transport }));
    expect(d[0]?.related.map((r) => r.label).join(" ")).toContain("No adapter recognizes the format of 'https://cdn.test/blob/a'");
  });

  it("an un-redirected a.yaml?v=2 still reads", async () => {
    const transport = new RecordedTransport([ok("https://example.test/a.yaml?v=2", "x: 1\n")]);
    expect((await resolveAt(vhost({ "/v/e.yaml": "$schema: https://example.test/a.yaml?v=2\n" }), "/v/e.yaml", { transport })).ok).toBe(true);
  });

  it("a delegated remote fragment and an override follow the same rule", async () => {
    const delegated = await resolveAt(vhost({ "/v/e.yaml": "$schema: ./s.yaml\nnetwork: https://example.test/frag\n", "/v/s.yaml": GRANTS }), "/v/e.yaml", { transport: new RecordedTransport([redirect("https://example.test/frag", "https://cdn.test/frag.yaml"), ok("https://cdn.test/frag.yaml", "host: a\n")]), allowRemoteDelegation: true });
    if (!delegated.ok) throw new Error(JSON.stringify(delegated.diagnostics));
    const override = await resolve("/v/e.yaml", { host: vhost({ "/v/e.yaml": "x: 1\n" }), sandboxRoot: "/v", transport: new RecordedTransport([redirect("https://example.test/o", "https://cdn.test/o.yaml"), ok("https://cdn.test/o.yaml", "k: 2\n")]), overrides: ["https://example.test/o"] });
    expect(override.ok).toBe(true);
  });
});

describe("v1.13 FR-021: a local location is read as it always was", () => {
  it("c.yaml?x, in memory: no extension, not readable (as before)", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: ./c.yaml?x\n", "/v/c.yaml?x": "x: 1\n" });
    const d = failureOf(await resolveAt(host, "/v/e.yaml"));
    expect(d[0]?.related.map((r) => r.label).join(" ")).toContain("No adapter recognizes the format of '/v/c.yaml?x'");
  });

  const BASE = mkdtempSync(join(tmpdir(), "cascata-format-"));
  let canMakeQuestionMark = true;
  try {
    writeFileSync(join(BASE, "c.yaml?x"), "x: 1\n");
    canMakeQuestionMark = existsSync(join(BASE, "c.yaml?x"));
  } catch {
    canMakeQuestionMark = false;
  }
  it.skipIf(!canMakeQuestionMark)("c.yaml?x, on the real disk -- skipped where this file system cannot name a file with a '?'", async () => {
    try {
      writeFileSync(join(BASE, "e.yaml"), "$schema: ./c.yaml?x\n");
      const result = await resolve(join(BASE, "e.yaml"), { host: createNodeHost(), sandboxRoot: BASE });
      const d = failureOf(result);
      expect(d[0]?.related.map((r) => r.label).join(" ")).toContain("No adapter recognizes the format");
    } finally {
      rmSync(BASE, { recursive: true, force: true });
    }
  });
});
