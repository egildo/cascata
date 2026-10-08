/**
 * v1.11.x (specs/021-native-realpath) — the Node host answers a path's true spelling.
 *
 * `canonicalize` followed symbolic links but kept the casing, and the Unicode
 * normalization, it was given (`fs.realpathSync`); on a case-insensitive file system that made
 * `/T/Case-x` and `/T/case-x` two identities for one directory. `fs.realpathSync.native` (the
 * operating system's `realpath(3)`) answers the directory's own spelling for both.
 *
 * Every test builds its own directory on the real disk. The ones that need a file system which
 * folds case (or normalizes Unicode) are skipped, with the reason stated, where it does not —
 * **detected by probing the directory this file just made, never by platform name.**
 *
 * Expected spellings are what the tests created, written down by hand: `Case-x` is the true
 * name; `case-x` and `CASE-X` are other ways to ask for it.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolve } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";

/** The temporary venue, itself canonicalized (on macOS `/var` is a link to `/private/var`), so what the tests compare is the case alone. */
const BASE = realpathSync(mkdtempSync(join(tmpdir(), "cascata-spelling-")));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));

const COMPOSED = "café"; // é as one code point
const DECOMPOSED = "café"; // e, then a combining acute

mkdirSync(join(BASE, "Case-x"));
mkdirSync(join(BASE, COMPOSED));
mkdirSync(join(BASE, "Real"));
mkdirSync(join(BASE, "Other"));
symlinkSync(join(BASE, "Real"), join(BASE, "link"));
writeFileSync(join(BASE, "Case-x", "root.yaml"), "keys:\n  title:\n    demand: { type: string }\n    provide: Untitled\n");
writeFileSync(join(BASE, "Case-x", "mid.yaml"), "$adopts: ../Case-x/root.yaml\n");
writeFileSync(join(BASE, "Other", "root.yaml"), "keys:\n  title:\n    demand: { type: string }\n");
writeFileSync(join(BASE, "Real", "x.yaml"), "a: 1\n");
writeFileSync(join(BASE, "entry.yaml"), "$schema: ./Case-x/mid.yaml\ntitle: Mine\n");
writeFileSync(join(BASE, "entry-wrong-case.yaml"), "$schema: ./Case-x/mid.yaml\n");
writeFileSync(join(BASE, "Case-x", "to-other.yaml"), "$adopts: ../CASE-X/../Other/root.yaml\n");
writeFileSync(join(BASE, "entry-other.yaml"), "$schema: ./Case-x/to-other.yaml\n");

/** Whether this file system folds case: ask it, about the directory just made. */
const FOLDS_CASE = existsSync(join(BASE, "case-x")) && existsSync(join(BASE, "CASE-X"));
/** Whether it treats a decomposed name as the composed one it holds (APFS and HFS+ do, most others do not). */
const FOLDS_UNICODE = existsSync(join(BASE, DECOMPOSED));

const WHY_CASE = "this file system is case-sensitive (probed: /case-x does not name /Case-x)";
const WHY_UNICODE = "this file system does not treat a decomposed name as its composed one (probed)";

const host = createNodeHost();

describe("the Node host's canonicalize answers the true spelling", () => {
  it.skipIf(!FOLDS_CASE)(`two spellings of one directory are one identity -- skipped where ${WHY_CASE}`, async () => {
    const truth = join(BASE, "Case-x");
    expect(await host.canonicalize(join(BASE, "Case-x"))).toBe(truth);
    expect(await host.canonicalize(join(BASE, "case-x"))).toBe(truth);
    expect(await host.canonicalize(join(BASE, "CASE-X"))).toBe(truth);
    expect(await host.canonicalize(join(BASE, "CASE-X", "ROOT.YAML"))).toBe(join(truth, "root.yaml"));
  });

  it.skipIf(!FOLDS_UNICODE)(`a decomposed name is answered as the composed one the directory holds -- skipped where ${WHY_UNICODE}`, async () => {
    expect(await host.canonicalize(join(BASE, DECOMPOSED))).toBe(join(BASE, COMPOSED));
    expect(await host.canonicalize(join(BASE, COMPOSED))).toBe(join(BASE, COMPOSED));
  });

  it("a symbolic link in the path is followed", async () => {
    expect(await host.canonicalize(join(BASE, "link", "x.yaml"))).toBe(join(BASE, "Real", "x.yaml"));
  });

  it.skipIf(!FOLDS_CASE)(`a link in the path and a wrong case together: followed, and spelled truly -- skipped where ${WHY_CASE}`, async () => {
    expect(await host.canonicalize(join(BASE, "LINK", "X.YAML"))).toBe(join(BASE, "Real", "x.yaml"));
  });

  it("a path that does not exist is undefined, whichever spelling its parent was given", async () => {
    expect(await host.canonicalize(join(BASE, "Case-x", "nope.yaml"))).toBeUndefined();
    expect(await host.canonicalize(join(BASE, "case-x", "nope.yaml"))).toBeUndefined();
    expect(await host.canonicalize(join(BASE, "nowhere", "at", "all"))).toBeUndefined();
  });
});

describe("a sandboxRoot spelled differently from the disk still contains its files", () => {
  it("control: the root spelled as the disk spells it contains the chain", async () => {
    const result = await resolve(join(BASE, "entry.yaml"), { host, sandboxRoot: join(BASE, "Case-x") });
    // entry.yaml is config-authored and may leave the root; the schemas it reaches are inside Case-x.
    expect(result.ok, result.ok ? "" : result.diagnostics.map((d) => d.message).join("; ")).toBe(true);
  });

  it.skipIf(!FOLDS_CASE)(`a root in the wrong case contains them -- skipped where ${WHY_CASE}`, async () => {
    for (const spelling of ["case-x", "CASE-X"]) {
      const result = await resolve(join(BASE, "entry.yaml"), { host, sandboxRoot: join(BASE, spelling) });
      expect(result.ok, `${spelling}: ${result.ok ? "" : result.diagnostics.map((d) => d.message).join("; ")}`).toBe(true);
    }
  });

  it.skipIf(!FOLDS_CASE)(`and a reference in the wrong case is contained by a root spelled truly -- skipped where ${WHY_CASE}`, async () => {
    writeFileSync(join(BASE, "Case-x", "wrong-case-ref.yaml"), "$adopts: ../case-x/root.yaml\n");
    writeFileSync(join(BASE, "entry-wrong-case-ref.yaml"), "$schema: ./Case-x/wrong-case-ref.yaml\n");
    const result = await resolve(join(BASE, "entry-wrong-case-ref.yaml"), { host, sandboxRoot: join(BASE, "Case-x") });
    expect(result.ok, result.ok ? "" : result.diagnostics.map((d) => d.message).join("; ")).toBe(true);
  });

  it("control: a root in any case still refuses what is outside it", async () => {
    for (const spelling of ["Case-x", "case-x"]) {
      if (spelling === "case-x" && !FOLDS_CASE) continue;
      const result = await resolve(join(BASE, "entry-other.yaml"), { host, sandboxRoot: join(BASE, spelling) });
      expect(result.ok, spelling).toBe(false);
      if (!result.ok) expect(result.diagnostics.map((d) => d.code)).toContain("sandbox-escape");
    }
  });
});
