/**
 * v1.13 FR-017, FR-018 -- the real disk. Part one is the probe gate: what `createNodeHost`'s `canonicalize`
 * answers on this machine's disk, recorded as assertions. Part two runs the graph-identity cases against
 * the real filesystem, wherever the disk allows them (skipped, with the reason stated, where it does not).
 *
 * The venue is made under `os.tmpdir()` and is NOT canonicalized first: on macOS that is `/var/folders/...`,
 * itself under a link (`/var` -> `/private/var`), so every test here meets FR-013's naming rule whether it
 * means to or not. The expected physical paths come from the operating system (`realpathSync.native` on the
 * venue), never from the library, and the messages are built from the spec's rule, not from the code.
 *
 * What depends on the disk: case folding (APFS and NTFS by default, not ext4) and Unicode folding (APFS
 * folds a decomposed name to the composed one it holds; most Linux file systems do not). Both are
 * PROBED on the directory this file makes, never assumed from a platform name.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { editTarget, merge, resolve } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";

const BASE = mkdtempSync(join(tmpdir(), "cascata-identity-"));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));
const REAL = realpathSync.native(BASE);
/** What the operating system says the physical path of a venue-relative path is, for a path whose directory exists. */
const physicalOf = (relative: string): string => join(REAL, relative);
const at = (relative: string): string => join(BASE, relative);
const named = (logical: string, physical: string): string => (logical === physical ? `'${logical}'` : `'${logical}' (the file '${physical}')`);

const COMPOSED = "café";
const DECOMPOSED = "café";

const put = (relative: string, text: string): void => {
  mkdirSync(join(at(relative), ".."), { recursive: true });
  writeFileSync(at(relative), text);
};
const link = (target: string, relative: string): void => {
  mkdirSync(join(at(relative), ".."), { recursive: true });
  symlinkSync(target, at(relative));
};

// --- the probe gate ---------------------------------------------------------------------------------------
mkdirSync(at("Case-x"));
mkdirSync(at(COMPOSED));
put("Real/f.yaml", "a: 1\n");
put(`${COMPOSED}/g.yaml`, "a: 1\n");
link(at("Real/f.yaml"), "flink.yaml");
link(at("Real"), "dlink");
link(at("flink.yaml"), "chain2.yaml");
link(at("chain2.yaml"), "chain3.yaml");
link(at("loopB"), "loopA");
link(at("loopA"), "loopB");
link(at("selfl"), "selfl");

const FOLDS_CASE = existsSync(at("case-x")) && existsSync(at("CASE-X"));
const FOLDS_UNICODE = existsSync(at(DECOMPOSED));
const WHY_CASE = "this file system is case-sensitive (probed: /case-x does not name /Case-x)";
const WHY_UNICODE = "this file system does not fold a decomposed name to its composed one (probed)";
const host = createNodeHost();

describe("v1.13 FR-017 (probe gate): what the Node host's canonicalize answers on this disk", () => {
  it.skipIf(!FOLDS_UNICODE)(`a non-ASCII name, composed and decomposed, is one answer: the composed one the directory holds -- skipped where ${WHY_UNICODE}`, async () => {
    const composed = await host.canonicalize(at(`${COMPOSED}/g.yaml`));
    const decomposed = await host.canonicalize(at(`${DECOMPOSED}/g.yaml`));
    expect(composed).toBe(physicalOf(`${COMPOSED}/g.yaml`));
    expect(decomposed).toBe(composed);
  });

  it("a non-ASCII name asked as it is spelled is answered, whatever the disk folds", async () => {
    expect(await host.canonicalize(at(`${COMPOSED}/g.yaml`))).toBe(physicalOf(`${COMPOSED}/g.yaml`));
  });

  it.skipIf(!FOLDS_CASE)(`a wrong-case spelling is answered with the true one -- skipped where ${WHY_CASE}`, async () => {
    expect(await host.canonicalize(at("CASE-X"))).toBe(physicalOf("Case-x"));
    expect(await host.canonicalize(at("REAL/F.YAML"))).toBe(physicalOf("Real/f.yaml"));
  });

  it("a symbolic link to a file, to a directory, and a chain of links, are followed to the one file", async () => {
    const f = physicalOf("Real/f.yaml");
    expect(await host.canonicalize(at("flink.yaml"))).toBe(f);
    expect(await host.canonicalize(at("dlink"))).toBe(physicalOf("Real"));
    expect(await host.canonicalize(at("dlink/f.yaml"))).toBe(f);
    expect(await host.canonicalize(at("chain3.yaml"))).toBe(f);
  });

  it("a link loop, and a link to itself, are undefined: neither a hang nor a throw", async () => {
    expect(await host.canonicalize(at("loopA"))).toBeUndefined();
    expect(await host.canonicalize(at("loopA/x.yaml"))).toBeUndefined();
    expect(await host.canonicalize(at("selfl"))).toBeUndefined();
  });

  it("a missing file under a linked directory is undefined, so the graph judges it through the directory", async () => {
    expect(await host.canonicalize(at("dlink/missing.yaml"))).toBeUndefined();
    expect(await host.canonicalize(at("dlink/a/b.yaml"))).toBeUndefined();
    // ...and a resolution that meets one names it as the directory's real path plus the rest.
    put("probe/e.yaml", "$schema: ./dl/absent.yaml\n");
    link(at("Real"), "probe/dl");
    const result = await resolve(at("probe/e.yaml"), { host, sandboxRoot: BASE });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe("document-unreachable");
  });

  it("the filesystem root is itself", async () => {
    expect(await host.canonicalize("/")).toBe("/");
  });
});

// --- the cases, on the real disk --------------------------------------------------------------------------
const GRANTS = "keys:\n  network:\n    demand:\n      type: mapping\n      keys:\n        network:\n          demand:\n            type: mapping\n          delegate: allow\n    delegate: allow\n";
const resolveOn = (entry: string) => resolve(at(entry), { host: createNodeHost(), sandboxRoot: BASE });
const refusal = async (entry: string) => {
  const result = await resolveOn(entry);
  if (result.ok) throw new Error(`expected a refusal, resolved ${result.graph.documents.map((d) => d.identity.location).join(", ")}`);
  expect(result.diagnostics).toHaveLength(1);
  const d = result.diagnostics[0];
  if (d === undefined) throw new Error("unreachable");
  return d;
};

describe("v1.13 FR-018 on the real disk: identity is physical", () => {
  it.skipIf(!FOLDS_CASE)(`1. a self-adoption under a case variant is reference-cycle -- skipped where ${WHY_CASE}`, async () => {
    put("c1/e.yaml", "$schema: ./Base.yaml\n");
    put("c1/Base.yaml", "$adopts: ./BASE.YAML\n");
    const d = await refusal("c1/e.yaml");
    expect(d.code).toBe("reference-cycle");
    expect(d.primary).toMatchObject({ start: 9, end: 20, line: 1, column: 10 });
    expect(d.message).toContain(`${named(at("c1/Base.yaml"), physicalOf("c1/Base.yaml"))} is reached again as ${named(at("c1/BASE.YAML"), physicalOf("c1/Base.yaml"))}`);
  });

  it("2a. a self-adoption through a symbolic link to the schema is reference-cycle", async () => {
    put("c2a/e.yaml", "$schema: ./s.yaml\n");
    put("c2a/s.yaml", "$adopts: ./alias.yaml\n");
    link("s.yaml", "c2a/alias.yaml");
    const d = await refusal("c2a/e.yaml");
    expect(d.code).toBe("reference-cycle");
    expect(d.primary).toMatchObject({ origin: { id: at("c2a/s.yaml") }, start: 9, end: 21, line: 1, column: 10 });
    expect(d.message).toContain(`is reached again as ${named(at("c2a/alias.yaml"), physicalOf("c2a/s.yaml"))}`);
  });

  it("2b. a self-adoption through a linked directory is reference-cycle", async () => {
    put("c2b/d/s.yaml", "$adopts: ../dl/s.yaml\n");
    put("c2b/e.yaml", "$schema: ./d/s.yaml\n");
    link("d", "c2b/dl");
    const d = await refusal("c2b/e.yaml");
    expect(d.code).toBe("reference-cycle");
    expect(d.primary).toMatchObject({ origin: { id: at("c2b/d/s.yaml") }, start: 9, end: 21 });
  });

  it("3a. the entry adopted back through a link to it is reference-cycle, not an internal error", async () => {
    put("c3a/e.yaml", "$schema: ./s.yaml\n");
    put("c3a/s.yaml", "$adopts: ./elink.yaml\n");
    link("e.yaml", "c3a/elink.yaml");
    const d = await refusal("c3a/e.yaml");
    expect(d.code).toBe("reference-cycle");
    expect(d.primary).toMatchObject({ origin: { id: at("c3a/s.yaml") }, start: 9, end: 21 });
  });

  it("3b. a byte-identical copy of the entry on the chain is reference-cycle, not an internal error", async () => {
    put("c3b/e.yaml", "$schema: ./s.yaml\n");
    put("c3b/s.yaml", "$adopts: ./copy.yaml\n");
    put("c3b/copy.yaml", "$schema: ./s.yaml\n");
    const d = await refusal("c3b/e.yaml");
    expect(d.code).toBe("reference-cycle");
    expect(d.primary).toMatchObject({ origin: { id: at("c3b/s.yaml") }, start: 9, end: 20 });
  });

  it("4. a fragment that delegates to itself through a link is reference-cycle at its first hop", async () => {
    put("c4/e.yaml", "$schema: ./s.yaml\nnetwork: ./a.yaml\n");
    put("c4/s.yaml", GRANTS);
    put("c4/a.yaml", "network: ./alink.yaml\n");
    link("a.yaml", "c4/alink.yaml");
    const d = await refusal("c4/e.yaml");
    expect(d.code).toBe("reference-cycle");
    expect(d.primary).toMatchObject({ origin: { id: `${at("c4/a.yaml")} #graft=1` }, start: 9, end: 21 });
  });

  it("5. one file grafted twice under two spellings (a link) is edit-target-shared under refuse", async () => {
    put("c5/e.yaml", "$schema: ./s.yaml\nleft: ./f.yaml\nright: ./flink.yaml\n");
    put("c5/s.yaml", "keys:\n  left:\n    demand:\n      type: mapping\n    delegate: allow\n  right:\n    demand:\n      type: mapping\n    delegate: allow\n");
    put("c5/f.yaml", "host: a\n");
    link("f.yaml", "c5/flink.yaml");
    const resolved = await resolveOn("c5/e.yaml");
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));
    const merged = merge(resolved);
    if (!merged.ok) throw new Error(JSON.stringify(merged.diagnostics));
    for (const pointer of ["/left/host", "/right/host"]) {
      const answer = editTarget(merged.configuration, pointer);
      expect(answer.ok, pointer).toBe(false);
      if (!answer.ok) expect(answer.diagnostics[0]?.code, pointer).toBe("edit-target-shared");
    }
    const warned = editTarget(merged.configuration, "/right/host", { sharedEdits: "warn" });
    expect(warned).toMatchObject({ ok: true, location: at("c5/flink.yaml"), physicalLocation: physicalOf("c5/f.yaml") });
  });

  it("controls: a chain on the real disk with no link in it resolves, and names only logical paths in its identities", async () => {
    put("c0/e.yaml", "$schema: ./s.yaml\n");
    put("c0/s.yaml", "x: 1\n");
    const result = await resolveOn("c0/e.yaml");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.documents.map((d) => [d.identity.location, d.identity.physical])).toEqual([
      [at("c0/e.yaml"), physicalOf("c0/e.yaml")],
      [at("c0/s.yaml"), physicalOf("c0/s.yaml")],
    ]);
  });
});

describe("v1.13 FR-018 on the real disk: where a relative reference starts", () => {
  it("6. a linked directory whose ../base.yaml names different files: the logical one loads, and the notice names both", async () => {
    put("c6/proj/e.yaml", "$schema: ./lnk/s.yaml\n");
    put("c6/real/deep/s.yaml", "$adopts: ../base.yaml\n");
    put("c6/proj/base.yaml", "logical: 1\n");
    put("c6/real/base.yaml", "physical: 1\n");
    link("../real/deep", "c6/proj/lnk");
    const result = await resolveOn("c6/proj/e.yaml");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pedigree.map((p) => p.identity.location)).toEqual([at("c6/proj/base.yaml"), at("c6/proj/lnk/s.yaml")]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["link-changes-reference"]);
    expect(result.diagnostics[0]?.message).toContain(physicalOf("c6/real/base.yaml"));
    expect(result.diagnostics[0]?.message).toContain(at("c6/proj/base.yaml"));
  });

  it("6. a linked directory where both answers name the same file raises no notice", async () => {
    put("c6b/proj/e.yaml", "$schema: ./lnk/s.yaml\n");
    put("c6b/proj/deep/s.yaml", "$adopts: ../base.yaml\n");
    put("c6b/proj/base.yaml", "x: 1\n");
    link("deep", "c6b/proj/lnk");
    const result = await resolveOn("c6b/proj/e.yaml");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
  });
});
