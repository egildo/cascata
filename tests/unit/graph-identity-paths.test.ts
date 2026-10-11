/**
 * v1.13 Part A — two paths per document (FR-002, FR-003, FR-004). Written before the code that judges them.
 *
 * The host is the in-memory double: `files` is keyed by the LOGICAL path (that is what `read` is handed, and
 * on a real disk the link is followed by the read), `canonical` answers the PHYSICAL path.
 */
import { describe, expect, it } from "vitest";
import { createOrigin } from "../../src/model/span.js";
import type { Mapping } from "../../src/index.js";
import { resolveAt, vhost } from "./graph-identity-helpers.js";

const LINKED = { "/v/e.yaml": "$schema: ./link/base.yaml\n", "/v/link/base.yaml": "x: 1\n" };

describe("v1.13 FR-002: the physical path is the host's canonical answer", () => {
  it("a file behind a linked directory: logical as written, physical as the host says; the entry is its own physical path", async () => {
    const host = vhost(LINKED, { "/v/link/base.yaml": "/real/base.yaml" });
    const result = await resolveAt(host, "/v/e.yaml");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.documents.map((d) => [d.identity.location, d.identity.physical])).toEqual([
      ["/v/e.yaml", "/v/e.yaml"],
      ["/v/link/base.yaml", "/real/base.yaml"],
    ]);
    expect(result.pedigree.map((p) => [p.identity.location, p.identity.physical])).toEqual([["/v/link/base.yaml", "/real/base.yaml"]]);
  });

  it("where the host answers undefined, the nearest answering ancestor stands, with the rest appended (the sandbox's own rule)", async () => {
    // Only directories canonicalize: `/v` is itself, `/v/link` is `/real`. The files answer undefined.
    const host = vhost(LINKED, { "/v": "/v", "/v/link": "/real" }, false);
    const result = await resolveAt(host, "/v/e.yaml");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.documents.map((d) => d.identity.physical)).toEqual(["/v/e.yaml", "/real/base.yaml"]);
  });

  it("where no ancestor answers either, the logical path is the physical one", async () => {
    const host = vhost(LINKED, {}, false);
    const result = await resolveAt(host, "/v/e.yaml");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.documents.map((d) => d.identity.physical)).toEqual(["/v/e.yaml", "/v/link/base.yaml"]);
  });
});

describe("v1.13 FR-003: one canonicalize per local document per resolution", () => {
  const sorted = (log: readonly string[]) => [...log].sort();

  it("a chain of four documents asks the host once for each, and once for the sandbox root: five questions, not eight", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: ./s1.yaml\n", "/v/s1.yaml": "$adopts: ./s2.yaml\n", "/v/s2.yaml": "$adopts: ./s3.yaml\n", "/v/s3.yaml": "x: 1\n" });
    const result = await resolveAt(host, "/v/e.yaml");
    expect(result.ok).toBe(true);
    expect(sorted(host.canonicalizes)).toEqual(["/v", "/v/e.yaml", "/v/s1.yaml", "/v/s2.yaml", "/v/s3.yaml"]);
  });

  it("a delegated fragment is asked once, for its identity and its sandbox check together", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: ./s.yaml\nnetwork: ./frag.yaml\n", "/v/s.yaml": "keys:\n  network:\n    demand:\n      type: mapping\n    delegate: allow\n", "/v/frag.yaml": "host: a\n" });
    const result = await resolveAt(host, "/v/e.yaml");
    expect(result.ok).toBe(true);
    expect(sorted(host.canonicalizes)).toEqual(["/v", "/v/e.yaml", "/v/frag.yaml", "/v/s.yaml"]);
  });

  it("where the host cannot answer, the walk up is asked once per directory too", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: ./s1.yaml\n", "/v/s1.yaml": "$adopts: ./s2.yaml\n", "/v/s2.yaml": "x: 1\n" }, {}, false);
    const result = await resolveAt(host, "/v/e.yaml");
    expect(result.ok).toBe(true);
    expect(host.canonicalizes.length).toBe(new Set(host.canonicalizes).size);
  });
});

describe("v1.13 FR-004: the model carries both", () => {
  it("origin.physical is present only when it differs; id and label stay logical", async () => {
    const host = vhost(LINKED, { "/v/link/base.yaml": "/real/base.yaml" });
    const result = await resolveAt(host, "/v/e.yaml");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.documents[1]?.tree.span.origin).toEqual({ id: "/v/link/base.yaml", label: "/v/link/base.yaml", physical: "/real/base.yaml" });
    const entryOrigin = result.graph.entry.tree.span.origin;
    expect(entryOrigin).toEqual({ id: "/v/e.yaml", label: "/v/e.yaml" });
    expect("physical" in entryOrigin).toBe(false);
  });

  it("a fragment's origin gains its own physical path: id `<location> #graft=N`, label the location", async () => {
    const files = { "/v/e.yaml": "$schema: ./s.yaml\nnetwork: ./link/frag.yaml\n", "/v/s.yaml": "keys:\n  network:\n    demand:\n      type: mapping\n    delegate: allow\n", "/v/link/frag.yaml": "host: a\n" };
    // The sandbox judges the physical path, so `/real` must be granted for the link to be followed at all.
    const result = await resolveAt(vhost(files, { "/v/link/frag.yaml": "/real/frag.yaml" }), "/v/e.yaml", { sandboxRoot: "/" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const network = (result.graph.entry.tree as Mapping).entries.get("network");
    expect(network?.span.origin).toEqual({ id: "/v/link/frag.yaml #graft=1", label: "/v/link/frag.yaml", physical: "/real/frag.yaml" });
  });

  it("createOrigin keeps a physical path only when it differs from the label, and refuses an empty one", () => {
    expect(createOrigin("/a", "/a", "/a")).toEqual({ id: "/a", label: "/a" });
    expect(createOrigin("/a", "/a")).toEqual({ id: "/a", label: "/a" });
    expect(createOrigin("/a", "/a", "/b")).toEqual({ id: "/a", label: "/a", physical: "/b" });
    expect(() => createOrigin("/a", "/a", "")).toThrow(/physical/);
  });
});
