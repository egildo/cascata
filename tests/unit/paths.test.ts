/**
 * The path facility (issue #1, the second half).
 *
 * `src/resolve/location.ts`, `src/resolve/delegate.ts` and
 * `src/validate/resource.ts` each imported `node:path` — and
 * `location.ts` also `node:os` — which is the same load-time failure in a
 * browser realm that `node:crypto` was, one module further along. Path
 * semantics are a **platform fact**, not lexical arithmetic: `C:\x`,
 * `\\server\share`, a backslash separator and drive-relative `C:foo` are
 * all things only the platform knows. Article VI already says the host
 * answers what only the host can know, so the host answers this too —
 * `createNodeHost` hands over `node:path`'s own functions, unchanged, and
 * Windows keeps exactly the semantics it had.
 *
 * Two claims are worth evidence, and this file carries both:
 *
 * 1. **The node host's facility is node's own path module**, not a
 *    reimplementation of it — asserted behaviourally against `node:path`
 *    on whatever platform the suite runs on, including `path.win32`
 *    directly, which is the only way a POSIX CI machine can see the
 *    Windows semantics at all.
 * 2. **The POSIX default** (`posixPaths`, what a realm with no host
 *    facility gets) agrees with `node:path.posix` — differentially, over
 *    the cases where lexical path handling is normally wrong: `..` past
 *    the root, repeated and trailing separators, the empty string.
 */

import { posix, win32, sep as nativeSep, dirname, dirname as nativeDirname, isAbsolute as nativeIsAbsolute, join, resolve as nativeResolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { dirname as pathDirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { posixPaths, type PathFacility } from "../../src/paths.js";
import { load, resolve, resource, type MergedConfiguration } from "../../src/index.js";
import { createMapping, createStringScalar } from "../../src/model/node.js";
import { createOrigin, createSourceSpan } from "../../src/model/span.js";

/** The repository root, for the v1.7 FR-010 cases at the end of this file. */
const REPO_ROOT_FOR_EXPORTS = join(pathDirname(fileURLToPath(import.meta.url)), "..", "..");
import { createNodeHost } from "../../src/host/node.js";
import { InMemoryHost } from "./host-test-double.js";

const POSIX_CASES: readonly string[] = [
  "/",
  "/a",
  "/a/b",
  "/a/b/",
  "/a//b",
  "a",
  "a/b",
  "./a",
  "../a",
  "/a/../b",
  "/a/./b",
  "/../..",
  "",
  ".",
  "..",
  "/a/b/../../../c",
  "/日本語/キー.yaml",
  "/a b/c d.yaml",
  "~/config.yaml",
  "/trailing/slash/",
];

describe("posixPaths — the default facility agrees with node:path.posix", () => {
  for (const input of POSIX_CASES) {
    it(`dirname(${JSON.stringify(input)})`, () => {
      expect(posixPaths.dirname(input)).toBe(posix.dirname(input));
    });

    it(`isAbsolute(${JSON.stringify(input)})`, () => {
      expect(posixPaths.isAbsolute(input)).toBe(posix.isAbsolute(input));
    });

    it(`resolve(${JSON.stringify(input)}) — relative input resolves against "/", the only base a realm with no working directory has`, () => {
      expect(posixPaths.resolve(input)).toBe(posix.resolve("/", input));
    });
  }

  const pairs: ReadonlyArray<readonly [string, string]> = [
    ["/base/dir", "child.yaml"],
    ["/base/dir", "./child.yaml"],
    ["/base/dir", "../sibling.yaml"],
    ["/base/dir", "/absolute/override.yaml"],
    ["/base/dir", ""],
    ["/base/dir", "a/../b"],
    ["/", "child.yaml"],
    ["relative/base", "child.yaml"],
    ["/base", "日本語.yaml"],
  ];

  for (const [base, child] of pairs) {
    it(`resolve(${JSON.stringify(base)}, ${JSON.stringify(child)})`, () => {
      expect(posixPaths.resolve(base, child)).toBe(posix.resolve("/", base, child));
    });
  }

  it("reports the POSIX separator", () => {
    expect(posixPaths.separator).toBe(posix.sep);
  });

  it("has no home directory — a realm with no host facility cannot expand `~/`, and inventing one would be worse than leaving it literal", () => {
    expect(posixPaths.homeDirectory).toBeUndefined();
  });

  it("never leaves a relative result, whatever it is handed", () => {
    for (const input of POSIX_CASES) {
      expect(posixPaths.isAbsolute(posixPaths.resolve(input))).toBe(true);
    }
  });
});

describe("createNodeHost().paths — node's own path module, so Windows semantics are node's", () => {
  const paths = createNodeHost().paths;

  it("is present — a host that answers no path facility silently falls back to POSIX, which on Windows would be wrong", () => {
    expect(paths).toBeDefined();
  });

  it("reports the platform's own separator", () => {
    expect(paths?.separator).toBe(nativeSep);
  });

  it("reports the platform's own home directory", () => {
    expect(paths?.homeDirectory).toBe(homedir());
  });

  for (const input of POSIX_CASES) {
    it(`dirname/isAbsolute/resolve match node:path natively for ${JSON.stringify(input)}`, () => {
      expect(paths?.dirname(input)).toBe(nativeDirname(input));
      expect(paths?.isAbsolute(input)).toBe(nativeIsAbsolute(input));
      expect(paths?.resolve(input)).toBe(nativeResolve(input));
    });
  }

  // The Windows cases a POSIX machine can still check: node's own
  // `path.win32` is what a Windows run would be using, so asserting the
  // facility *is* `node:path` means these hold there by construction.
  // Written out anyway, because "it is node's module" is the claim, and a
  // claim with no case attached is the kind that quietly stops being true.
  const WINDOWS_CASES: readonly string[] = [
    "C:\\",
    "C:\\Users\\egildo\\config.yaml",
    "C:\\Users\\egildo\\..\\other\\config.yaml",
    "C:config.yaml",
    "\\\\server\\share\\config.yaml",
    "\\\\?\\C:\\config.yaml",
    "relative\\child.yaml",
    "mixed/separators\\child.yaml",
  ];

  for (const input of WINDOWS_CASES) {
    it(`node:path.win32 handles ${JSON.stringify(input)} in ways no POSIX-only implementation would — dirname`, () => {
      // Not an assertion about the facility on this machine: an assertion
      // that these inputs genuinely need win32 semantics, so that a future
      // "just write a small POSIX path module" shortcut fails here.
      expect(win32.dirname(input)).not.toBe(posix.dirname(input));
    });
  }

  it("treats a drive-absolute path as absolute under win32 and not under posix", () => {
    expect(win32.isAbsolute("C:\\x")).toBe(true);
    expect(posix.isAbsolute("C:\\x")).toBe(false);
  });
});

describe("the facility reaches the two places that used to import node:path directly", () => {
  // `resource()` resolves a `path` value against the directory of the
  // document that declared it (v0.7 FR-035). That `dirname` used to come
  // from `node:path`; it now comes from whatever facility the resolution
  // stamped onto the configuration. On a POSIX machine the default and
  // the node host agree, so a test that only ran the POSIX path would pass
  // whether or not the stamping works at all — the win32 facility below is
  // what makes the difference visible.
  const win32Facility: PathFacility = {
    separator: win32.sep,
    homeDirectory: "C:\\Users\\egildo",
    dirname: win32.dirname,
    isAbsolute: win32.isAbsolute,
    resolve: (base: string, segment?: string) => (segment === undefined ? win32.resolve(base) : win32.resolve(base, segment)),
  };

  function configurationWith(paths: PathFacility | undefined, declaringDocument: string, value: string): MergedConfiguration {
    const origin = createOrigin(declaringDocument, declaringDocument);
    const span = createSourceSpan({ origin, start: 0, end: value.length, line: 1, column: 1, documentLength: value.length });
    const tree = createMapping([["logo", createStringScalar(value, span)]], span);
    return {
      tree,
      provenance: new Map(),
      pedigree: [],
      layers: [],
      delegationBreadcrumbs: new Map(),
      finalState: new Map(),
      ...(paths === undefined ? {} : { paths }),
    } as unknown as MergedConfiguration;
  }

  it("resource() resolves a path value with the configuration's own facility, not with POSIX rules", () => {
    const configuration = configurationWith(win32Facility, "C:\\projects\\app\\config.yaml", "images\\logo.png");
    expect(resource(configuration, "/logo")).toEqual({ kind: "path", location: "C:\\projects\\app\\images\\logo.png" });
  });

  it("resource() falls back to POSIX when no facility was stamped", () => {
    const configuration = configurationWith(undefined, "/projects/app/config.yaml", "images/logo.png");
    expect(resource(configuration, "/logo")).toEqual({ kind: "path", location: "/projects/app/images/logo.png" });
  });

  it("a resolution stamps the host's facility onto the configuration it produces", async () => {
    const host = createNodeHost();
    const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases", "resource", "basic");
    const result = await load(join(directory, "config.yaml"), { host, sandboxRoot: directory });
    if (!result.ok) {
      throw new Error(`expected load() ok:true: ${JSON.stringify(result.diagnostics)}`);
    }
    expect(result.configuration.paths).toBe(host.paths);
  });
});

describe("resolve() asks the host's facility, not the default, for the entry and the sandbox root", () => {
  // A POSIX machine cannot tell `posixPaths` from `createNodeHost().paths`
  // by behavior — they agree on every POSIX-shaped location — so a test
  // that used either would pass with the threading removed. A host whose
  // facility is *win32* can tell them apart on the first call:
  // `posixPaths.resolve("C:\\app\\config.yaml")` is not absolute in POSIX
  // terms and comes back as "/C:\app\config.yaml", a location the host
  // holds no file at. Found by sabotage — an earlier version of this
  // suite passed with `host.paths` replaced by `posixPaths` in
  // `resolveEntry`.
  const win32Facility: PathFacility = {
    separator: win32.sep,
    homeDirectory: "C:\\Users\\egildo",
    dirname: win32.dirname,
    isAbsolute: win32.isAbsolute,
    resolve: (base: string, segment?: string) => (segment === undefined ? win32.resolve(base) : win32.resolve(base, segment)),
  };

  const encoder = new TextEncoder();

  it("reads the entry at the win32 location the host's own facility produces", async () => {
    const entry = "C:\\app\\config.yaml";
    const host = new InMemoryHost({
      files: new Map([[entry, encoder.encode("key: value\n")]]),
      canonicalizeIsIdentity: true,
      paths: win32Facility,
    });

    await resolve(entry, { host, sandboxRoot: "C:\\app" });

    expect(host.reads).toContain(entry);
    expect(host.reads.some((location) => location.startsWith("/C:"))).toBe(false);
  });

  it("resolves a relative reference against the declaring document's directory in win32 terms", async () => {
    const entry = "C:\\app\\config.yaml";
    const schema = "C:\\app\\schemas\\house.yaml";
    const host = new InMemoryHost({
      files: new Map([
        [entry, encoder.encode("$schema: schemas\\house.yaml\nkey: value\n")],
        [schema, encoder.encode("keys:\n  key:\n    type: string\n")],
      ]),
      canonicalizeIsIdentity: true,
      paths: win32Facility,
    });

    await resolve(entry, { host, sandboxRoot: "C:\\app" });

    expect(host.reads).toContain(schema);
  });
});

describe("the absolute-delegated-path refusal is judged in the host's terms — a security check, not a formatting one", () => {
  // SPEC.md §8.4 / v0.6 FR-023: a delegated path may never be absolute.
  // `C:\\secrets\\creds.yaml` **is** absolute on Windows and is not, to
  // POSIX rules, which would let exactly the reference the rule exists to
  // refuse through on a Windows host. This is why `isAbsoluteDelegatedPath`
  // takes the facility rather than importing `node:path`.
  const win32Facility: PathFacility = {
    separator: win32.sep,
    homeDirectory: "C:\\Users\\egildo",
    dirname: win32.dirname,
    isAbsolute: win32.isAbsolute,
    resolve: (base: string, segment?: string) => (segment === undefined ? win32.resolve(base) : win32.resolve(base, segment)),
  };

  const encoder = new TextEncoder();

  it("refuses a drive-absolute delegated path", async () => {
    const entry = "C:\\app\\config.yaml";
    const schema = "C:\\app\\schema.yaml";
    const host = new InMemoryHost({
      files: new Map([
        [entry, encoder.encode("$schema: schema.yaml\nnetwork: C:\\secrets\\creds.yaml\n")],
        [schema, encoder.encode("keys:\n  network:\n    demand:\n      type: mapping\n    delegate: allow\n")],
      ]),
      canonicalizeIsIdentity: true,
      paths: win32Facility,
    });

    const result = await resolve(entry, { host, sandboxRoot: "C:\\app" });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("absolute-delegated-path");
  });
});

// --- v1.7 FR-010: `cascata/paths`, an entry point ------------------------
//
// Reported from outside (issue #2, §3): a host with no filesystem of its
// own but a known remote realm — a browser tab editing a server's POSIX
// paths — needs "POSIX rules plus a home directory", and had to
// re-implement the whole facility to add one member to it. The addition is
// an export, not a feature: `{ ...posixPaths, homeDirectory }`.
//
// The realm requirement rides on `tests/unit/layering.test.ts`'s sweep,
// which is total over `src/` minus the shipped node host — so the only
// thing that could put this entry point outside it is the file moving.
// That is what the last case below pins.

describe("v1.7 FR-010 — posixPaths is exported from a `cascata/paths` entry point", () => {
  const packageJson: unknown = JSON.parse(readFileSync(join(REPO_ROOT_FOR_EXPORTS, "package.json"), "utf-8"));

  function exportsEntry(subpath: string): unknown {
    const root = packageJson as { readonly exports?: Record<string, unknown> };
    return root.exports?.[subpath];
  }

  for (const subpath of ["./paths", "./paths.js"]) {
    it(`package.json exports ${subpath}, following the ./generate precedent`, () => {
      expect(exportsEntry(subpath)).toEqual({ types: "./dist/paths.d.ts", import: "./dist/paths.js" });
    });
  }

  it("the `-dist` build ships it — the source the exports name is inside the build's own rootDir", () => {
    const build: unknown = JSON.parse(readFileSync(join(REPO_ROOT_FOR_EXPORTS, "tsconfig.build.json"), "utf-8"));
    const include = (build as { readonly include?: readonly string[] }).include ?? [];
    expect(include).toContain("src");
    expect(existsSync(join(REPO_ROOT_FOR_EXPORTS, "src", "paths.ts"))).toBe(true);
  });

  it("the spread is what the consumer asked for: POSIX rules plus a home directory, and still a PathFacility", () => {
    const facility: PathFacility = { ...posixPaths, homeDirectory: "/home/u" };

    expect(facility.homeDirectory).toBe("/home/u");
    expect(facility.separator).toBe(posix.sep);
    expect(facility.dirname("/a/b/c.yaml")).toBe(posix.dirname("/a/b/c.yaml"));
    expect(facility.isAbsolute("/a")).toBe(posix.isAbsolute("/a"));
    expect(facility.resolve("/a/b", "../c.yaml")).toBe(posix.resolve("/a/b", "../c.yaml"));
    // The exported constant is not mutated by the spread — the whole
    // point is that a host may make several facilities from it.
    expect(posixPaths.homeDirectory).toBeUndefined();
  });

  it("the entry point's source sits under src/, so the realm sweep already polices it", () => {
    // `tests/unit/layering.test.ts` walks every `.ts` under `src/` except
    // the shipped node host. A file outside `src/` would be swept by
    // nothing, and this entry point is one an embedder imports *because*
    // its realm is not node.
    const pathsSource = join(REPO_ROOT_FOR_EXPORTS, "src", "paths.ts");
    expect(existsSync(pathsSource)).toBe(true);
    expect(readFileSync(pathsSource, "utf-8")).not.toMatch(/from\s+"node:/);
  });
});
