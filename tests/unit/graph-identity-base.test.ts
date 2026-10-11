/**
 * v1.13 Part C -- where a relative reference starts (FR-010, FR-011, FR-012). Written before the code.
 *
 * In a file a relative reference starts from the LOGICAL path (as the shell's `cd` resolves `..`); in a remote
 * document from the PHYSICAL URL (as a browser resolves against a response's URL). Where the other rule would
 * have named a different document, `link-changes-reference` (info) says so at the reference.
 *
 * Counts are by hand: `$adopts: ` is nine bytes, `../base.yaml` is twelve (9..21), `./base.yaml` eleven (9..20),
 * `network: ` is nine bytes and `../frag.yaml` twelve.
 */
import { describe, expect, it } from "vitest";
import { merge, resolve, resource } from "../../src/index.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { resolveAt, vhost } from "./graph-identity-helpers.js";

const ENCODER = new TextEncoder();
const ok = (url: string, text: string): Recording => ({ url, method: "GET", outcome: { kind: "response", response: { status: 200, headers: {}, body: ENCODER.encode(text) } } });
const redirect = (from: string, to: string): Recording => ({ url: from, method: "GET", outcome: { kind: "response", response: { status: 302, headers: { location: to }, body: new Uint8Array() } } });
const offline = (url: string): Recording => ({ url, method: "GET", outcome: { kind: "failure", failure: { kind: "connection-refused" } } });

/** /v/proj/lnk is a link to /v/real/deep. A reference `../base.yaml` in a file reached through it is /v/proj/base.yaml logically and /v/real/base.yaml physically. */
const LINK = { "/v/proj/lnk": "/v/real/deep", "/v/proj/lnk/s.yaml": "/v/real/deep/s.yaml" };
const ENTRY = { "/v/proj/e.yaml": "$schema: ./lnk/s.yaml\n", "/v/proj/lnk/s.yaml": "$adopts: ../base.yaml\n" };

describe("v1.13 FR-010: local, from the logical path -- nothing that resolves today moves", () => {
  it("6. a reference through a linked directory loads the logical file, and the notice names both", async () => {
    const host = vhost({ ...ENTRY, "/v/proj/base.yaml": "logical: 1\n", "/v/real/base.yaml": "physical: 1\n" }, LINK);
    const result = await resolveAt(host, "/v/proj/e.yaml");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pedigree.map((p) => p.identity.location)).toEqual(["/v/proj/base.yaml", "/v/proj/lnk/s.yaml"]);
    expect(result.diagnostics).toHaveLength(1);
    const notice = result.diagnostics[0];
    expect(notice?.code).toBe("link-changes-reference");
    expect(notice?.level).toBe("info");
    expect(notice?.primary).toMatchObject({ origin: { id: "/v/proj/lnk/s.yaml" }, start: 9, end: 21, line: 1, column: 10 });
    for (const named of ["/v/proj/base.yaml", "/v/real/base.yaml", "/v/proj/lnk/s.yaml", "/v/real/deep/s.yaml"]) expect(notice?.message, named).toContain(named);
    expect(host.reads).not.toContain("/v/real/base.yaml");
  });

  it("a linked directory where both answers name the same file: no notice", async () => {
    // The link points one level deeper in the same directory, so `../base.yaml` is /v/proj/base.yaml either way.
    const host = vhost({ ...ENTRY, "/v/proj/base.yaml": "x: 1\n" }, { "/v/proj/lnk": "/v/proj/deep", "/v/proj/lnk/s.yaml": "/v/proj/deep/s.yaml" });
    const result = await resolveAt(host, "/v/proj/e.yaml");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
  });

  it("two spellings of one file in the linked directory are one document, so a sibling reference raises no notice", async () => {
    const files = { "/v/proj/e.yaml": "$schema: ./lnk/s.yaml\n", "/v/proj/lnk/s.yaml": "$adopts: ./t.yaml\n", "/v/proj/lnk/t.yaml": "x: 1\n", "/v/real/deep/t.yaml": "x: 1\n" };
    const host = vhost(files, { ...LINK, "/v/proj/lnk/t.yaml": "/v/real/deep/t.yaml" });
    const result = await resolveAt(host, "/v/proj/e.yaml");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(result.pedigree.map((p) => p.identity.location)).toEqual(["/v/proj/lnk/t.yaml", "/v/proj/lnk/s.yaml"]);
  });

  it("a document on the other side that does not exist counts as different", async () => {
    // Only directories canonicalize; /v/real/base.yaml is absent, and is judged through /v/real.
    const host = vhost({ ...ENTRY, "/v/proj/base.yaml": "x: 1\n" }, { ...LINK, "/v": "/v", "/v/proj": "/v/proj", "/v/real": "/v/real", "/v/proj/base.yaml": "/v/proj/base.yaml" }, false);
    const result = await resolveAt(host, "/v/proj/e.yaml");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.map((d) => d.code)).toEqual(["link-changes-reference"]);
  });

  it("a delegated location is judged the same way, at the delegating value", async () => {
    const files = {
      "/v/proj/lnk/e.yaml": "$schema: /v/s.yaml\nnetwork: ../frag.yaml\n",
      "/v/s.yaml": "keys:\n  network:\n    demand:\n      type: mapping\n    delegate: allow\n",
      "/v/proj/frag.yaml": "host: logical\n",
      "/v/real/frag.yaml": "host: physical\n",
    };
    const result = await resolveAt(vhost(files, { "/v/proj/lnk": "/v/real/deep", "/v/proj/lnk/e.yaml": "/v/real/deep/e.yaml" }), "/v/proj/lnk/e.yaml");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.delegationBreadcrumbs.keys()]).toEqual(["/v/proj/frag.yaml #graft=1"]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("link-changes-reference");
    expect(result.diagnostics[0]?.primary).toMatchObject({ origin: { id: "/v/proj/lnk/e.yaml" }, start: 28, end: 40, line: 2, column: 10 });
  });

  it("an override and a launching schema, which the embedder names relative to the entry, are judged from the entry's logical path too, at a phantom span", async () => {
    const files = { "/v/proj/lnk/e.yaml": "x: 1\n", "/v/proj/o.yaml": "y: 1\n", "/v/real/o.yaml": "y: 2\n", "/v/proj/s.yaml": "z: 1\n", "/v/real/s.yaml": "z: 2\n" };
    const host = vhost(files, { "/v/proj/lnk": "/v/real/deep", "/v/proj/lnk/e.yaml": "/v/real/deep/e.yaml" });
    const result = await resolve("/v/proj/lnk/e.yaml", { host, sandboxRoot: "/v", overrides: ["../o.yaml"], schema: "../s.yaml" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.overrides?.map((o) => o.identity.location)).toEqual(["/v/proj/o.yaml"]);
    expect(result.pedigree.map((p) => p.identity.location)).toEqual(["/v/proj/s.yaml"]);
    expect(result.diagnostics.map((d) => [d.code, d.primary.origin.id, d.primary.start, d.primary.end])).toEqual([
      ["link-changes-reference", "/v/proj/lnk/e.yaml", 0, 0],
      ["link-changes-reference", "/v/proj/lnk/e.yaml", 0, 0],
    ]);
    expect(result.diagnostics[0]?.message).toContain("'../s.yaml'");
    expect(result.diagnostics[1]?.message).toContain("'../o.yaml'");
  });

  it("an absolute reference, or a file that is not behind a link, raises nothing", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: ./s.yaml\n", "/v/s.yaml": "$adopts: /v/root.yaml\n", "/v/root.yaml": "x: 1\n" });
    const result = await resolveAt(host, "/v/e.yaml");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.diagnostics).toEqual([]);
  });
});

describe("v1.13 FR-011: remote, from the physical URL", () => {
  const entry = { "/v/e.yaml": "$schema: https://example.test/a.yaml\n" };
  const recordings = (): Recording[] => [redirect("https://example.test/a.yaml", "https://cdn.test/v1/a.yaml"), ok("https://cdn.test/v1/a.yaml", "$adopts: ./base.yaml\n"), ok("https://cdn.test/v1/base.yaml", "x: 1\n")];

  it("7. a relative $adopts in a document reached through a redirect resolves from the final URL, with the notice", async () => {
    const transport = new RecordedTransport(recordings());
    const result = await resolveAt(vhost(entry), "/v/e.yaml", { transport });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pedigree.map((p) => p.identity.location)).toEqual(["https://cdn.test/v1/base.yaml", "https://example.test/a.yaml"]);
    expect(result.diagnostics).toHaveLength(1);
    const notice = result.diagnostics[0];
    expect(notice?.code).toBe("link-changes-reference");
    expect(notice?.primary).toMatchObject({ origin: { id: "https://example.test/a.yaml" }, start: 9, end: 20, line: 1, column: 10 });
    for (const named of ["https://cdn.test/v1/base.yaml", "https://example.test/base.yaml", "https://example.test/a.yaml", "https://cdn.test/v1/a.yaml"]) expect(notice?.message, named).toContain(named);
    expect(() => transport.assertAllConsumed()).not.toThrow();
  });

  it("7. offline, the same answers come from the cache", async () => {
    const host = vhost(entry);
    expect((await resolveAt(host, "/v/e.yaml", { transport: new RecordedTransport(recordings()) })).ok).toBe(true);
    const result = await resolveAt(host, "/v/e.yaml", { transport: new RecordedTransport([offline("https://example.test/a.yaml"), offline("https://cdn.test/v1/base.yaml")]) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pedigree.map((p) => p.identity.location)).toEqual(["https://cdn.test/v1/base.yaml", "https://example.test/a.yaml"]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["link-changes-reference"]);
  });

  it("controls: a document fetched without a redirect resolves as it always did, with no notice", async () => {
    const transport = new RecordedTransport([ok("https://example.test/a.yaml", "$adopts: ./base.yaml\n"), ok("https://example.test/base.yaml", "x: 1\n")]);
    const result = await resolveAt(vhost(entry), "/v/e.yaml", { transport });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pedigree.map((p) => p.identity.location)).toEqual(["https://example.test/base.yaml", "https://example.test/a.yaml"]);
    expect(result.diagnostics).toEqual([]);
  });

  it("a redirect that stays in the same directory leaves both rules naming one URL: no notice; and an absolute reference is no relative one", async () => {
    const transport = new RecordedTransport([
      redirect("https://example.test/v1/a.yaml", "https://example.test/v1/a-new.yaml"),
      ok("https://example.test/v1/a-new.yaml", "$adopts: ./base.yaml\n"),
      ok("https://example.test/v1/base.yaml", "$adopts: https://example.test/root.yaml\n"),
      ok("https://example.test/root.yaml", "x: 1\n"),
    ]);
    const result = await resolveAt(vhost({ "/v/e.yaml": "$schema: https://example.test/v1/a.yaml\n" }), "/v/e.yaml", { transport });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pedigree.map((p) => p.identity.location)).toEqual(["https://example.test/root.yaml", "https://example.test/v1/base.yaml", "https://example.test/v1/a.yaml"]);
    expect(result.diagnostics).toEqual([]);
  });

  it("a remote fragment's own delegation starts from its physical URL too", async () => {
    const grants = "keys:\n  network:\n    demand:\n      type: mapping\n      keys:\n        network:\n          demand:\n            type: mapping\n          delegate: allow\n    delegate: allow\n";
    const files = { "/v/e.yaml": "$schema: ./s.yaml\nnetwork: https://example.test/f.yaml\n", "/v/s.yaml": grants };
    const transport = new RecordedTransport([redirect("https://example.test/f.yaml", "https://cdn.test/v1/f.yaml"), ok("https://cdn.test/v1/f.yaml", "network: ./g.yaml\n"), ok("https://cdn.test/v1/g.yaml", "host: a\n")]);
    const result = await resolveAt(vhost(files), "/v/e.yaml", { transport, allowRemoteDelegation: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.delegationBreadcrumbs.keys()]).toEqual(["https://example.test/f.yaml #graft=1", "https://cdn.test/v1/g.yaml #graft=2"]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["link-changes-reference"]);
    expect(() => transport.assertAllConsumed()).not.toThrow();
  });
});

describe("v1.13 FR-010/FR-011/FR-012: a resource value (a query, so it carries the other answer rather than raising a notice)", () => {
  const schema = "keys:\n  file:\n    demand:\n      type: path\n";

  it("a path in a document behind a link is resolved from the logical path and carries the other answer", async () => {
    const files = { "/v/proj/lnk/e.yaml": "$schema: /v/s.yaml\nfile: ./data.csv\n", "/v/s.yaml": schema };
    const resolved = await resolveAt(vhost(files, { "/v/proj/lnk": "/v/real/deep", "/v/proj/lnk/e.yaml": "/v/real/deep/e.yaml" }), "/v/proj/lnk/e.yaml");
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
    const merged = merge(resolved);
    if (!merged.ok) throw new Error(JSON.stringify(merged.diagnostics));
    expect(resource(merged.configuration, "/file")).toEqual({ kind: "path", location: "/v/proj/lnk/data.csv", otherLocation: "/v/real/deep/data.csv" });
  });

  it("controls: the same value in a document that is not behind a link has no other answer", async () => {
    const files = { "/v/e.yaml": "$schema: ./s.yaml\nfile: ./data.csv\n", "/v/s.yaml": schema };
    const resolved = await resolveAt(vhost(files), "/v/e.yaml");
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
    const merged = merge(resolved);
    if (!merged.ok) throw new Error(JSON.stringify(merged.diagnostics));
    expect(resource(merged.configuration, "/file")).toEqual({ kind: "path", location: "/v/data.csv" });
  });

  it("a path provided by a remote schema behind a redirect resolves from the final URL, and carries the requested URL's answer", async () => {
    const remote = "keys:\n  file:\n    demand:\n      type: path\n    provide: ./data.csv\n";
    const transport = new RecordedTransport([redirect("https://example.test/s.yaml", "https://cdn.test/v1/s.yaml"), ok("https://cdn.test/v1/s.yaml", remote)]);
    const resolved = await resolve("/v/e.yaml", { host: vhost({ "/v/e.yaml": "$schema: https://example.test/s.yaml\n" }), sandboxRoot: "/v", transport });
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
    const merged = merge(resolved);
    if (!merged.ok) throw new Error(JSON.stringify(merged.diagnostics));
    expect(resource(merged.configuration, "/file")).toEqual({ kind: "path", location: "https://cdn.test/v1/data.csv", otherLocation: "https://example.test/data.csv" });
  });
});
