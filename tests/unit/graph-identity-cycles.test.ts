/**
 * v1.13 Part B — identity is physical (FR-005 to FR-009). Written before the code that judges them.
 *
 * Every position is counted by hand. `$adopts: ./copy.yaml` puts the value at byte 9 (`$adopts: ` is nine
 * bytes: `$`, `a`, `d`, `o`, `p`, `t`, `s`, `:`, space) and `./copy.yaml` is eleven bytes, so 9..20; the
 * 1-based column of byte 9 is 10. A value of n bytes after `$adopts: ` is 9..9+n.
 *
 * Most cases assert `host.reads`: a cycle through another spelling is refused BEFORE the second spelling is
 * read, which is what separates the physical key (FR-005) from the content-hash net under it (FR-006) --
 * a document read twice and found identical would be the hash's catch, not the path's.
 */
import { describe, expect, it } from "vitest";
import { editTarget, merge, resolve, type Diagnostic } from "../../src/index.js";
import { GraphBuilder, type GraphDocument } from "../../src/graph/build.js";
import { createNullScalar } from "../../src/model/node.js";
import { createOrigin, createSourceSpan } from "../../src/model/span.js";
import { InMemoryHost } from "./host-test-double.js";
import { failureOf, resolveAt, vhost } from "./graph-identity-helpers.js";

const only = (diagnostics: readonly Diagnostic[]): Diagnostic => {
  expect(diagnostics).toHaveLength(1);
  const d = diagnostics[0];
  if (d === undefined) throw new Error("unreachable");
  return d;
};

describe("v1.13 FR-005: the adoption graph keys by physical path", () => {
  it("1. a schema that adopts itself under a case variant is reference-cycle, refused before the variant is read", async () => {
    // Same bytes under both spellings, as on a case-folding disk; the host says both are /v/Base.yaml.
    const text = "$adopts: ./BASE.YAML\n";
    const host = vhost({ "/v/e.yaml": "$schema: ./Base.yaml\n", "/v/Base.yaml": text, "/v/BASE.YAML": text }, { "/v/BASE.YAML": "/v/Base.yaml" });
    const d = only(failureOf(await resolveAt(host, "/v/e.yaml")));
    expect(d.code).toBe("reference-cycle");
    expect(d.primary).toMatchObject({ origin: { id: "/v/Base.yaml" }, start: 9, end: 20, line: 1, column: 10 });
    expect(d.related).toEqual([]);
    expect(host.reads).not.toContain("/v/BASE.YAML");
  });

  it("2a. the same through a symbolic link to the schema", async () => {
    const text = "$adopts: ./alias.yaml\n";
    const host = vhost({ "/v/e.yaml": "$schema: ./s.yaml\n", "/v/s.yaml": text, "/v/alias.yaml": text }, { "/v/alias.yaml": "/v/s.yaml" });
    const d = only(failureOf(await resolveAt(host, "/v/e.yaml")));
    expect(d.code).toBe("reference-cycle");
    expect(d.primary).toMatchObject({ origin: { id: "/v/s.yaml" }, start: 9, end: 21, line: 1, column: 10 });
    expect(host.reads).not.toContain("/v/alias.yaml");
  });

  it("2b. the same through a linked directory: ../dl/s.yaml, where dl is a link to d", async () => {
    // /v/d/s.yaml writes `$adopts: ../dl/s.yaml`; lexically that is /v/dl/s.yaml, physically /v/d/s.yaml.
    const text = "$adopts: ../dl/s.yaml\n";
    const host = vhost({ "/v/e.yaml": "$schema: ./d/s.yaml\n", "/v/d/s.yaml": text, "/v/dl/s.yaml": text }, { "/v/dl/s.yaml": "/v/d/s.yaml" });
    const d = only(failureOf(await resolveAt(host, "/v/e.yaml")));
    expect(d.code).toBe("reference-cycle");
    expect(d.primary).toMatchObject({ origin: { id: "/v/d/s.yaml" }, start: 9, end: 21, line: 1, column: 10 });
    expect(host.reads).not.toContain("/v/dl/s.yaml");
  });

  it("3a. the entry adopted back under another spelling is a cycle, and its closing reference is the second schema's", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: ./s.yaml\n", "/v/s.yaml": "$adopts: ./E.yaml\n", "/v/E.yaml": "$schema: ./s.yaml\n" }, { "/v/E.yaml": "/v/e.yaml" });
    const d = only(failureOf(await resolveAt(host, "/v/e.yaml")));
    expect(d.code).toBe("reference-cycle");
    expect(d.primary).toMatchObject({ origin: { id: "/v/s.yaml" }, start: 9, end: 17 });
    // The one other reference in the loop is the entry's own `$schema`, `./s.yaml` at bytes 9..17.
    expect(d.related.map((r) => [r.label, r.span.origin.id, r.span.start, r.span.end])).toEqual([["cycle position 1", "/v/e.yaml", 9, 17]]);
    expect(host.reads).not.toContain("/v/E.yaml");
  });

  it("a different document is not a cycle, and the same document reached twice is not one either (controls)", async () => {
    const host = vhost({ "/v/e.yaml": "$schema: ./a.yaml\n", "/v/a.yaml": "$adopts: ./b.yaml\n", "/v/b.yaml": "x: 1\n" });
    const result = await resolveAt(host, "/v/e.yaml");
    expect(result.ok).toBe(true);
  });

  it("GraphBuilder, directly: a second spelling of a finished document is a duplicate, of an active one a cycle naming both spellings", () => {
    const builder = new GraphBuilder();
    expect(builder.beginVisit("/v/a.yaml", undefined, "/v/a.yaml").kind).toBe("new");
    const spelled = builder.beginVisit("/v/A.yaml", undefined, "/v/a.yaml");
    expect(spelled.kind).toBe("cycle");
    if (spelled.kind !== "cycle") return;
    expect(spelled.chain.map((f) => [f.location, f.physical])).toEqual([
      ["/v/a.yaml", "/v/a.yaml"],
      ["/v/A.yaml", "/v/a.yaml"],
    ]);
  });

  it("GraphBuilder, directly: once a document is finished, another spelling of it is a duplicate that reads nothing", () => {
    const builder = new GraphBuilder();
    expect(builder.beginVisit("/v/a.yaml", undefined, "/v/a.yaml").kind).toBe("new");
    const doc = fake("/v/a.yaml", "c");
    builder.finishVisit("/v/a.yaml", builder.registerContent("/v/a.yaml", doc));
    const again = builder.beginVisit("/v/A.yaml", undefined, "/v/a.yaml");
    expect(again.kind).toBe("duplicate");
    if (again.kind === "duplicate") expect(again.document).toBe(doc);
    // A different file is new.
    expect(builder.beginVisit("/v/b.yaml", undefined, "/v/b.yaml").kind).toBe("new");
  });
});

describe("v1.13 FR-006: content identity on the active chain is a cycle, not a dedup", () => {
  it("3b. a byte-identical copy of the entry adopted by a schema on the chain: reference-cycle, not an internal error (the crash, reproduced first)", async () => {
    // e.yaml and copy.yaml are the same eighteen bytes. s.yaml adopts copy.yaml, which hashes as the entry.
    const host = vhost({ "/v/e.yaml": "$schema: ./s.yaml\n", "/v/s.yaml": "$adopts: ./copy.yaml\n", "/v/copy.yaml": "$schema: ./s.yaml\n" });
    const d = only(failureOf(await resolveAt(host, "/v/e.yaml")));
    expect(d.code).toBe("reference-cycle");
    expect(d.primary).toMatchObject({ origin: { id: "/v/s.yaml" }, start: 9, end: 20, line: 1, column: 10 });
    expect(d.related.map((r) => [r.label, r.span.origin.id, r.span.start, r.span.end])).toEqual([["cycle position 1", "/v/e.yaml", 9, 17]]);
    expect(d.message).toContain("/v/copy.yaml");
    expect(d.message).toContain("/v/e.yaml");
  });

  it("a byte-identical copy of a schema ancestor is a cycle too", async () => {
    // s1 adopts s2 adopts s3; s3 is a copy of s1's bytes ("$adopts: ./s2.yaml" would mean s2 again, so s1 is made path-neutral).
    const host = vhost({ "/v/e.yaml": "$schema: ./s1.yaml\n", "/v/s1.yaml": "$adopts: ./s2.yaml\n", "/v/s2.yaml": "$adopts: ./sub/s1.yaml\n", "/v/sub/s1.yaml": "$adopts: ./s2.yaml\n" });
    const d = only(failureOf(await resolveAt(host, "/v/e.yaml")));
    expect(d.code).toBe("reference-cycle");
    expect(d.primary).toMatchObject({ origin: { id: "/v/s2.yaml" } });
  });

  it("controls: identical bytes off the active chain still converge (the dedup is unchanged), as graph-content-dedup.test.ts pins", async () => {
    // Direct: finished documents are not on the stack, so registerContent hands back the earlier one and contentCycle says nothing.
    const builder = new GraphBuilder();
    expect(builder.beginVisit("/v/x.yaml", undefined).kind).toBe("new");
    const x = fake("/v/x.yaml", "a");
    const canonicalX = builder.registerContent("/v/x.yaml", x);
    expect(builder.contentCycle(canonicalX)).toBeUndefined();
    builder.finishVisit("/v/x.yaml", canonicalX);
    expect(builder.beginVisit("/v/y.yaml", undefined).kind).toBe("new");
    const canonicalY = builder.registerContent("/v/y.yaml", fake("/v/y.yaml", "a"));
    expect(canonicalY).toBe(x);
    expect(builder.contentCycle(canonicalY)).toBeUndefined();
  });
});

describe("v1.13 FR-007: delegated fragments too", () => {
  const GRANTS = "keys:\n  network:\n    demand:\n      type: mapping\n      keys:\n        network:\n          demand:\n            type: mapping\n          delegate: allow\n    delegate: allow\n";

  it("4a. a fragment that delegates to itself under another spelling is reference-cycle at its first hop, and the variant is never read (before v1.13 the variant was read and grafted)", async () => {
    // a.yaml: `network: ./A.yaml`, the value ./A.yaml at bytes 9..17. The host says /v/A.yaml is /v/a.yaml.
    const host = vhost({ "/v/e.yaml": "$schema: ./s.yaml\nnetwork: ./a.yaml\n", "/v/s.yaml": GRANTS, "/v/a.yaml": "network: ./A.yaml\n", "/v/A.yaml": "network: ./A.yaml\n" }, { "/v/A.yaml": "/v/a.yaml" });
    const d = only(failureOf(await resolveAt(host, "/v/e.yaml")));
    expect(d.code).toBe("reference-cycle");
    expect(d.primary).toMatchObject({ origin: { id: "/v/a.yaml #graft=1", label: "/v/a.yaml" }, start: 9, end: 17, line: 1, column: 10 });
    expect(host.reads).not.toContain("/v/A.yaml");
  });

  it("4b. through a directory that links to itself: reference-cycle on the first hop, where every lexical spelling is new (before v1.13 this resolved, the file grafted twice and silently)", async () => {
    // /v/d/L is a link to /v/d: `./L/f.yaml` from /v/d/f.yaml is /v/d/L/f.yaml, from there /v/d/L/L/f.yaml, and so on forever.
    // (The grant tree below is two levels deep, which bounds how far a graft is followed; the spec expected the depth limit to answer
    // here, and measured on v1.12 it does not: the second graft is the last, nothing is refused, and f.yaml is in the result twice.)
    class SelfLinkedHost extends InMemoryHost {
      private static flatten(path: string): string {
        return path.replace(/\/L(?=\/)/g, "");
      }
      override async read(location: string) {
        return super.read(SelfLinkedHost.flatten(location));
      }
      override async canonicalize(location: string) {
        return super.canonicalize(SelfLinkedHost.flatten(location));
      }
    }
    const enc = new TextEncoder();
    const host = new SelfLinkedHost({ files: new Map([["/v/e.yaml", enc.encode("$schema: ./s.yaml\nnetwork: ./d/f.yaml\n")], ["/v/s.yaml", enc.encode(GRANTS)], ["/v/d/f.yaml", enc.encode("network: ./L/f.yaml\n")]]) });
    const d = only(failureOf(await resolveAt(host, "/v/e.yaml")));
    expect(d.code).toBe("reference-cycle");
    expect(d.primary).toMatchObject({ origin: { id: "/v/d/f.yaml #graft=1" }, start: 9, end: 19 });
  });

  it("controls: a fragment delegated twice under one spelling is two grafts (v0.6 FR-013a), not a cycle", async () => {
    const files = { "/v/e.yaml": "$schema: ./s.yaml\nleft: ./f.yaml\nright: ./f.yaml\n", "/v/s.yaml": TWO_GRANTS, "/v/f.yaml": "host: a\n" };
    const result = await resolveAt(vhost(files), "/v/e.yaml");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.delegationBreadcrumbs.keys()]).toEqual(["/v/f.yaml #graft=1", "/v/f.yaml #graft=2"]);
  });
});

const TWO_GRANTS = "keys:\n  left:\n    demand:\n      type: mapping\n    delegate: allow\n  right:\n    demand:\n      type: mapping\n    delegate: allow\n";

describe("v1.13 FR-008: whether a file is shared is physical", () => {
  const files = { "/v/e.yaml": "$schema: ./s.yaml\nleft: ./f.yaml\nright: ./F.yaml\n", "/v/s.yaml": TWO_GRANTS, "/v/f.yaml": "host: a\n", "/v/F.yaml": "host: a\n" };
  const canonical = { "/v/F.yaml": "/v/f.yaml" };

  it("5. one file grafted twice under two spellings is edit-target-shared under refuse, from either spelling, and the bytes are read once", async () => {
    const host = vhost(files, canonical);
    const resolved = await resolveAt(host, "/v/e.yaml");
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
    // The byte cache is keyed by where the file is: the second spelling is a hit, never a read.
    expect(host.reads.filter((location) => location.toLowerCase() === "/v/f.yaml")).toEqual(["/v/f.yaml"]);
    const merged = merge(resolved);
    if (!merged.ok) throw new Error(JSON.stringify(merged.diagnostics));
    for (const pointer of ["/left/host", "/right/host"]) {
      const refused = editTarget(merged.configuration, pointer);
      expect(refused.ok, pointer).toBe(false);
      if (refused.ok) continue;
      expect(only(refused.diagnostics).code, pointer).toBe("edit-target-shared");
    }
  });

  it("under warn it is answered with the logical location, the physical beside it where it differs, and the other graft named", async () => {
    const resolved = await resolveAt(vhost(files, canonical), "/v/e.yaml");
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
    const merged = merge(resolved);
    if (!merged.ok) throw new Error(JSON.stringify(merged.diagnostics));
    const left = editTarget(merged.configuration, "/left/host", { sharedEdits: "warn" });
    expect(left).toMatchObject({ ok: true, location: "/v/f.yaml", pointer: "/host" });
    expect(left.ok && "physicalLocation" in left).toBe(false);
    const right = editTarget(merged.configuration, "/right/host", { sharedEdits: "warn" });
    expect(right).toMatchObject({ ok: true, location: "/v/F.yaml", physicalLocation: "/v/f.yaml", pointer: "/host" });
    if (!left.ok) return;
    expect(only(left.diagnostics).level).toBe("info");
    expect(only(left.diagnostics).related).toHaveLength(1);
  });

  it("controls: two files that merely read alike, with two physical paths, are not shared", async () => {
    const resolved = await resolveAt(vhost(files), "/v/e.yaml");
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
    const merged = merge(resolved);
    if (!merged.ok) throw new Error(JSON.stringify(merged.diagnostics));
    expect(editTarget(merged.configuration, "/left/host")).toEqual({ ok: true, location: "/v/f.yaml", pointer: "/host", format: "yaml", diagnostics: [] });
  });
});

describe("v1.13 FR-009: overrides are unchanged", () => {
  it("two spellings of one override file are two layers, each with its own physical path", async () => {
    const host = vhost({ "/v/e.yaml": "x: 1\n", "/v/o.yaml": "y: 1\n", "/v/O.yaml": "y: 1\n" }, { "/v/O.yaml": "/v/o.yaml" });
    const result = await resolve("/v/e.yaml", { host, sandboxRoot: "/v", overrides: ["./o.yaml", "./O.yaml"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.overrides?.map((o) => [o.identity.location, o.identity.physical])).toEqual([
      ["/v/o.yaml", "/v/o.yaml"],
      ["/v/O.yaml", "/v/o.yaml"],
    ]);
  });
});

function fake(location: string, hashChar: string): GraphDocument {
  const origin = createOrigin(location, location);
  const span = createSourceSpan({ origin, start: 0, end: 0, line: 1, column: 1, documentLength: 0 });
  return { identity: { location, physical: location, hash: hashChar.repeat(64) }, tree: createNullScalar(span), verified: false };
}
