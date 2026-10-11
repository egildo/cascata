/**
 * v1.13 Part D -- names stay logical, the physical path beside them (FR-013). Written before the code.
 *
 * Every message names a document as the route taken to it; where the file really is differs, the physical
 * path follows in parentheses. A message about a document that is not behind a link is exactly what it was.
 */
import { describe, expect, it } from "vitest";
import { merge, why } from "../../src/index.js";
import { failureOf, resolveAt, vhost } from "./graph-identity-helpers.js";

const GRANTS = "keys:\n  network:\n    demand:\n      type: mapping\n      keys:\n        network:\n          demand:\n            type: mapping\n          delegate: allow\n    delegate: allow\n";

describe("v1.13 FR-013: reference-cycle names both spellings, and the physical path where it differs", () => {
  it("a cycle closed through a second spelling names the first, the second, and the file they are", async () => {
    const text = "$adopts: ./BASE.YAML\n";
    const host = vhost({ "/v/e.yaml": "$schema: ./Base.yaml\n", "/v/Base.yaml": text }, { "/v/BASE.YAML": "/v/Base.yaml" });
    const d = failureOf(await resolveAt(host, "/v/e.yaml"));
    expect(d[0]?.message).toBe("Reference './BASE.YAML' closes a cycle back to an already-visited document: '/v/Base.yaml' is reached again as '/v/BASE.YAML' (the file '/v/Base.yaml')");
  });

  it("a cycle closed under the same spelling, for a document behind a link, appends the file it is", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: ./lnk/s.yaml\n", "/v/lnk/s.yaml": "$adopts: ./s.yaml\n" }, { "/v/lnk/s.yaml": "/real/s.yaml" });
    const d = failureOf(await resolveAt(host, "/v/e.yaml", { sandboxRoot: "/" }));
    expect(d[0]?.message).toBe("Reference './s.yaml' closes a cycle back to an already-visited document: '/v/lnk/s.yaml' (the file '/real/s.yaml')");
  });

  it("controls: a cycle among documents that are not behind a link reads exactly as it did before v1.13", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: ./s.yaml\n", "/v/s.yaml": "$adopts: ./s.yaml\n" });
    const d = failureOf(await resolveAt(host, "/v/e.yaml"));
    expect(d[0]?.message).toBe("Reference './s.yaml' closes a cycle back to an already-visited document");
  });
});

describe("v1.13 FR-013: the delegation cycle message", () => {
  it("names each fragment on the path, the second spelling with the file it is", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: ./s.yaml\nnetwork: ./a.yaml\n", "/v/s.yaml": GRANTS, "/v/a.yaml": "network: ./A.yaml\n" }, { "/v/A.yaml": "/v/a.yaml" });
    const d = failureOf(await resolveAt(host, "/v/e.yaml"));
    expect(d[0]?.message).toContain("(/v/a.yaml -> /v/A.yaml (the file /v/a.yaml))");
  });

  it("controls: a fragment cycle with one spelling and no link is worded as it was", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: ./s.yaml\nnetwork: ./a.yaml\n", "/v/s.yaml": GRANTS, "/v/a.yaml": "network: ./a.yaml\n" });
    const d = failureOf(await resolveAt(host, "/v/e.yaml"));
    expect(d[0]?.message).toContain("(/v/a.yaml -> /v/a.yaml)");
  });
});

describe("v1.13 FR-013: sandbox-escape names the route and the file", () => {
  it("an adopted schema that a link carries out of the roots: the logical location, then the file it really is", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: ./s.yaml\n", "/v/s.yaml": "$adopts: ./lnk/root.yaml\n", "/v/lnk/root.yaml": "x: 1\n" }, { "/v/lnk/root.yaml": "/outside/root.yaml" });
    const d = failureOf(await resolveAt(host, "/v/e.yaml"));
    expect(d[0]?.code).toBe("sandbox-escape");
    expect(d[0]?.message).toContain("resolves to '/v/lnk/root.yaml' (the file '/outside/root.yaml'), outside every granted sandbox root ('/v')");
  });

  it("controls: a plain escape names the path once", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: ./s.yaml\n", "/v/s.yaml": "$adopts: /outside/root.yaml\n", "/outside/root.yaml": "x: 1\n" });
    const d = failureOf(await resolveAt(host, "/v/e.yaml"));
    expect(d[0]?.message).toContain("resolves to '/outside/root.yaml', outside every granted sandbox root");
  });

  it("a delegated fragment a link carries out of the roots", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: ./s.yaml\nnetwork: ./lnk/a.yaml\n", "/v/s.yaml": GRANTS, "/v/lnk/a.yaml": "x: 1\n" }, { "/v/lnk/a.yaml": "/outside/a.yaml" });
    const d = failureOf(await resolveAt(host, "/v/e.yaml"));
    expect(d[0]?.code).toBe("sandbox-escape");
    expect(d[0]?.message).toContain("resolves to '/v/lnk/a.yaml' (the file '/outside/a.yaml'), outside every granted sandbox root");
  });
});

describe("v1.13 FR-013: why() and the layers keep the route taken, the physical path beside it", () => {
  it("a value from a document behind a link is attributed to its logical location, with origin.physical beside it", async () => {
    const files = { "/v/e.yaml": "$schema: ./lnk/s.yaml\ntitle: Mine\n", "/v/lnk/s.yaml": "keys:\n  title:\n    demand:\n      type: string\n    provide: Untitled\n" };
    const resolved = await resolveAt(vhost(files, { "/v/lnk/s.yaml": "/real/s.yaml" }), "/v/e.yaml");
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
    const merged = merge(resolved);
    if (!merged.ok) throw new Error(JSON.stringify(merged.diagnostics));
    const layer = merged.configuration.layers.find((l) => l.identity.location === "/v/lnk/s.yaml");
    expect(layer?.identity).toMatchObject({ location: "/v/lnk/s.yaml", physical: "/real/s.yaml" });
    // The invariant that has held since v0.3: a layer's identity is its tree's origin id.
    expect(layer?.tree.span.origin.id).toBe("/v/lnk/s.yaml");
    expect(layer?.tree.span.origin.physical).toBe("/real/s.yaml");
    const answer = why(merged.configuration, "/title");
    expect(answer.kind).toBe("chain");
    const entries = answer.kind === "chain" ? answer.entries : [];
    // Winner first (the config), then the schema's provide: named by the route taken, and only the one behind the link carries a physical path.
    expect(entries.map((e) => [e.span.origin.label, e.span.origin.physical])).toEqual([
      ["/v/e.yaml", undefined],
      ["/v/lnk/s.yaml", "/real/s.yaml"],
    ]);
  });
});
