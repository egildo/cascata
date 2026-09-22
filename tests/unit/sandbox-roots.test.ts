/**
 * v1.7 (015) — sandbox roots. Issue #2, measured by the consumer on
 * v1.6.0 through a node host on macOS.
 *
 * **Story 1, absent is not outside (v1.7 FR-001 to FR-003).** The
 * containment check canonicalizes both sides through the host and, for a
 * location the host cannot canonicalize — i.e. one that does not exist —
 * fell back to the *lexical* path. The root exists, so under a root that
 * is or sits beneath a symbolic link the two sides were compared in
 * different spaces and a merely **absent** file inside the root was
 * refused as `sandbox-escape`. On macOS that is the ordinary case, not a
 * corner: `/tmp` and `/var` are links, so every `mkdtemp` venue is behind
 * one.
 *
 * The file is in two halves, as the spec's Conformance section requires.
 *
 * - **A scripted host** — `InMemoryHost` with `canonicalizeIsIdentity:
 *   false` and an explicit `canonical` table. **The table is the oracle**:
 *   every expected verdict below is derived from it by hand (each case
 *   writes the derivation down), never read off a run. No disk is
 *   touched, so the win32 half (v1.7 FR-003) runs on any platform.
 * - **The node host over a real temporary directory** — a `real/`
 *   directory and a `link` → `real` symlink the test builds itself, so
 *   the case is red on Linux too, where `/tmp` is not a link. The "real"
 *   half starts from the **canonicalized** temporary directory: on macOS,
 *   `mkdtemp` under `os.tmpdir()` already sits behind `/var` → `/private/var`,
 *   so without that both halves would be the symlinked case and the
 *   comparison would prove nothing.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";
import { classifyReferenceLocation } from "../../src/resolve/location.js";
import { createReference } from "../../src/resolve/reference.js";
import { createOrigin, createSourceSpan } from "../../src/model/span.js";
import { posixPaths, type PathFacility } from "../../src/paths.js";
import { InMemoryHost } from "./host-test-double.js";

const ENCODER = new TextEncoder();

/**
 * `node:path.win32`'s own rules as a `PathFacility` — the same shape
 * `tests/unit/paths.test.ts` builds, for the same reason: a Windows
 * verdict must be checked with Windows path semantics, and node is the
 * oracle for what those are (SPEC.md §11, v1.5).
 */
const win32Paths: PathFacility = {
  separator: win32.sep,
  homeDirectory: undefined,
  dirname: win32.dirname,
  isAbsolute: win32.isAbsolute,
  resolve: (base: string, segment?: string) => (segment === undefined ? win32.resolve(base) : win32.resolve(base, segment)),
};

function files(entries: Record<string, string>): Map<string, Uint8Array> {
  return new Map(Object.entries(entries).map(([location, text]) => [location, ENCODER.encode(text)]));
}

function codesOf(result: Awaited<ReturnType<typeof resolve>>): string[] {
  return result.ok ? [] : result.diagnostics.map((diagnostic) => diagnostic.code);
}

// --- Half one: the scripted host ------------------------------------------
//
// One venue, reachable two ways. The canonical table below says `/link`
// is a symbolic link to `/real`, that everything which exists under it
// canonicalizes into `/real`, and — by omission, since
// `canonicalizeIsIdentity` is false — that everything else does not exist.

const POSIX_CANONICAL: ReadonlyMap<string, string> = new Map([
  ["/", "/"],
  ["/real", "/real"],
  ["/real/venue", "/real/venue"],
  ["/real/venue/config.yaml", "/real/venue/config.yaml"],
  ["/real/venue/schema.yaml", "/real/venue/schema.yaml"],
  ["/real/città", "/real/città"],
  ["/link", "/real"],
  ["/link/venue", "/real/venue"],
  ["/link/venue/config.yaml", "/real/venue/config.yaml"],
  ["/link/venue/schema.yaml", "/real/venue/schema.yaml"],
  ["/link/città", "/real/città"],
  ["/link/città/config.yaml", "/real/città/config.yaml"],
  ["/link/città/schema.yaml", "/real/città/schema.yaml"],
  ["/house", "/house"],
  ["/house/config.yaml", "/house/config.yaml"],
  ["/house/schema.yaml", "/house/schema.yaml"],
  ["/housekeeping", "/housekeeping"],
]);

/** A venue at `<dir>` whose config adopts `<adoptsTarget>` through a schema beside it. `dir` is the *lexical* directory the library will compute locations in — `/link/venue` for the symlinked half, `/real/venue` for the control. */
function posixVenue(dir: string, adoptsTarget: string): InMemoryHost {
  return new InMemoryHost({
    files: files({
      [`${dir}/config.yaml`]: "$schema: ./schema.yaml\n",
      [`${dir}/schema.yaml`]: `$adopts: ${adoptsTarget}\n`,
    }),
    canonical: POSIX_CANONICAL,
    canonicalizeIsIdentity: false,
  });
}

describe("v1.7 FR-001/FR-002 (scripted host, POSIX): an absent file is judged through its nearest existing ancestor", () => {
  it("under a symlinked root, an absent file inside the root is document-unreachable, not sandbox-escape", async () => {
    // Derived from the table by hand:
    //   location  /link/venue/missing.yaml  -> absent; ancestor /link/venue -> /real/venue
    //                                       -> /real/venue/missing.yaml
    //   root      /link/venue               -> /real/venue
    //   /real/venue/missing.yaml starts with "/real/venue/"  => inside
    // Inside, and unreadable, so the verdict is the ordinary read failure.
    const result = await resolve("/link/venue/config.yaml", { host: posixVenue("/link/venue", "./missing.yaml"), sandboxRoot: "/link/venue" });

    expect(codesOf(result)).toEqual(["document-unreachable"]);
  });

  it("gives the identical verdict under the real directory — the two halves must agree, which is the whole bug", async () => {
    // root /real/venue -> /real/venue; location /real/venue/missing.yaml
    // -> absent, ancestor /real/venue -> /real/venue => inside.
    const result = await resolve("/real/venue/config.yaml", { host: posixVenue("/real/venue", "./missing.yaml"), sandboxRoot: "/real/venue" });

    expect(codesOf(result)).toEqual(["document-unreachable"]);
  });

  it("still refuses an absent file OUTSIDE a symlinked root — absence is not a pass either", async () => {
    // location /link/outside.yaml -> absent; ancestor /link -> /real
    //                             -> /real/outside.yaml
    // root     /link/venue        -> /real/venue, prefix "/real/venue/"
    // "/real/outside.yaml" is neither equal to nor prefixed by it => outside.
    const result = await resolve("/link/venue/config.yaml", { host: posixVenue("/link/venue", "../outside.yaml"), sandboxRoot: "/link/venue" });

    expect(codesOf(result)).toEqual(["sandbox-escape"]);
  });

  it("refuses the same absent outside file under the real directory too", async () => {
    const result = await resolve("/real/venue/config.yaml", { host: posixVenue("/real/venue", "../outside.yaml"), sandboxRoot: "/real/venue" });

    expect(codesOf(result)).toEqual(["sandbox-escape"]);
  });
});

// v1.7 FR-002: `isWithinSandbox` has three callers and one fix —
// `$schema`/`$adopts` above, and delegation here (§8.4). A delegated
// reference is judged by the same primitive, so the same two verdicts
// must follow from the same table.

const DELEGATING_SCHEMA = "keys:\n  network:\n    demand:\n      type: mapping\n    delegate: allow\n";

function posixDelegatingVenue(dir: string, delegatedTarget: string): InMemoryHost {
  return new InMemoryHost({
    files: files({
      [`${dir}/config.yaml`]: `$schema: ./schema.yaml\nnetwork: ${delegatedTarget}\n`,
      [`${dir}/schema.yaml`]: DELEGATING_SCHEMA,
    }),
    canonical: POSIX_CANONICAL,
    canonicalizeIsIdentity: false,
  });
}

describe("v1.7 FR-002 (scripted host, POSIX): delegation agrees, because it judges through the same isWithinSandbox", () => {
  it("an absent delegated fragment under a symlinked root is document-unreachable", async () => {
    // /link/venue/missing-fragment.yaml -> ancestor /link/venue -> /real/venue
    //   => /real/venue/missing-fragment.yaml, inside /real/venue.
    const result = await resolve("/link/venue/config.yaml", { host: posixDelegatingVenue("/link/venue", "./missing-fragment.yaml"), sandboxRoot: "/link/venue" });

    expect(codesOf(result)).toEqual(["document-unreachable"]);
  });

  it("an absent delegated ../ target is still the delegation's own sandbox refusal", async () => {
    // /link/outside-fragment.yaml -> ancestor /link -> /real
    //   => /real/outside-fragment.yaml, outside /real/venue.
    const result = await resolve("/link/venue/config.yaml", { host: posixDelegatingVenue("/link/venue", "../outside-fragment.yaml"), sandboxRoot: "/link/venue" });

    expect(codesOf(result)).toEqual(["sandbox-escape"]);
  });
});

// --- v1.7 FR-003: the same two verdicts in the host's own terms ----------

const WIN32_CANONICAL: ReadonlyMap<string, string> = new Map([
  ["C:\\", "C:\\"],
  ["C:\\real", "C:\\real"],
  ["C:\\real\\venue", "C:\\real\\venue"],
  ["C:\\link", "C:\\real"],
  ["C:\\link\\venue", "C:\\real\\venue"],
  ["C:\\link\\venue\\config.yaml", "C:\\real\\venue\\config.yaml"],
  ["C:\\link\\venue\\schema.yaml", "C:\\real\\venue\\schema.yaml"],
]);

function win32Venue(adoptsTarget: string): InMemoryHost {
  return new InMemoryHost({
    files: files({
      "C:\\link\\venue\\config.yaml": "$schema: ./schema.yaml\n",
      "C:\\link\\venue\\schema.yaml": `$adopts: ${adoptsTarget}\n`,
    }),
    canonical: WIN32_CANONICAL,
    canonicalizeIsIdentity: false,
    paths: win32Paths,
  });
}

describe("v1.7 FR-003 (scripted host, win32): computed with the host's PathFacility and no other notion of a path", () => {
  it("an absent file under C:\\link\\venue is document-unreachable", async () => {
    // C:\link\venue\missing.yaml -> absent; ancestor C:\link\venue -> C:\real\venue
    //   => C:\real\venue\missing.yaml; root C:\link\venue -> C:\real\venue,
    //   prefix "C:\real\venue\" => inside.
    const result = await resolve("C:\\link\\venue\\config.yaml", { host: win32Venue(".\\missing.yaml"), sandboxRoot: "C:\\link\\venue" });

    expect(codesOf(result)).toEqual(["document-unreachable"]);
  });

  it("an absent ..\\outside.yaml is still sandbox-escape", async () => {
    // C:\link\outside.yaml -> absent; ancestor C:\link -> C:\real
    //   => C:\real\outside.yaml, outside C:\real\venue.
    const result = await resolve("C:\\link\\venue\\config.yaml", { host: win32Venue("..\\outside.yaml"), sandboxRoot: "C:\\link\\venue" });

    expect(codesOf(result)).toEqual(["sandbox-escape"]);
  });
});

// --- The probe gate (constitution, Principle V) ---------------------------
//
// Non-ASCII, boundary and adversarial inputs, exercised before FR-001's
// conclusion was written down. Two ASCII-only probes have been wrong in
// this repository's history; these are here so the conclusion rests on
// something.

describe("v1.7 FR-001 probe gate — non-ASCII, boundary, adversarial", () => {
  it("non-ASCII: a venue directory named città/ under the link", async () => {
    // /link/città/missing.yaml -> absent; ancestor /link/città -> /real/città
    //   => /real/città/missing.yaml, inside /real/città. The remainder is
    //   sliced out of the very string its own ancestor was taken from, so
    //   no re-encoding of the non-ASCII segment happens at all.
    const host = new InMemoryHost({
      files: files({
        "/link/città/config.yaml": "$schema: ./schema.yaml\n",
        "/link/città/schema.yaml": "$adopts: ./missing.yaml\n",
      }),
      canonical: POSIX_CANONICAL,
      canonicalizeIsIdentity: false,
    });

    const result = await resolve("/link/città/config.yaml", { host, sandboxRoot: "/link/città" });

    expect(codesOf(result)).toEqual(["document-unreachable"]);
  });

  it("boundary: the root itself does not exist — the same treatment applies to it", async () => {
    // root /link/venue/nowhere -> absent; ancestor /link/venue -> /real/venue
    //   => /real/venue/nowhere.
    // location /link/venue/nowhere/missing.yaml -> absent; same ancestor
    //   => /real/venue/nowhere/missing.yaml, inside.
    const host = new InMemoryHost({
      files: files({
        "/link/venue/config.yaml": "$schema: ./schema.yaml\n",
        "/link/venue/schema.yaml": "$adopts: ./nowhere/missing.yaml\n",
      }),
      canonical: POSIX_CANONICAL,
      canonicalizeIsIdentity: false,
    });

    const result = await resolve("/link/venue/config.yaml", { host, sandboxRoot: "/link/venue/nowhere" });

    expect(codesOf(result)).toEqual(["document-unreachable"]);
  });

  it("boundary: the location IS the root", async () => {
    // `$adopts: .` resolves to /link/venue itself -> /real/venue, which
    // equals the canonicalized root => inside (a directory, so the read
    // then fails, which is the point: the verdict is not sandbox-escape).
    const result = await resolve("/link/venue/config.yaml", { host: posixVenue("/link/venue", "."), sandboxRoot: "/link/venue" });

    expect(codesOf(result)).toEqual(["document-unreachable"]);
  });

  it("boundary: the root is `/` — an absent file anywhere is inside it", async () => {
    // root / -> /, prefix "/" (already ends in the separator, v1.4 FR-007).
    // location /elsewhere/missing.yaml -> absent; ancestor / -> /
    //   => /elsewhere/missing.yaml, which starts with "/" => inside.
    const result = await resolve("/link/venue/config.yaml", { host: posixVenue("/link/venue", "/elsewhere/missing.yaml"), sandboxRoot: "/" });

    expect(codesOf(result)).toEqual(["document-unreachable"]);
  });

  it("adversarial: /housekeeping is not inside /house, even when the target does not exist", async () => {
    // /housekeeping/missing.yaml -> absent; ancestor /housekeeping ->
    //   /housekeeping => /housekeeping/missing.yaml.
    // root /house -> /house, prefix "/house/". Not equal, not prefixed.
    const host = new InMemoryHost({
      files: files({
        "/house/config.yaml": "$schema: ./schema.yaml\n",
        "/house/schema.yaml": "$adopts: ../housekeeping/missing.yaml\n",
      }),
      canonical: POSIX_CANONICAL,
      canonicalizeIsIdentity: false,
    });

    const result = await resolve("/house/config.yaml", { host, sandboxRoot: "/house" });

    expect(codesOf(result)).toEqual(["sandbox-escape"]);
  });

  it("boundary: a host that canonicalizes nothing at all is unchanged — the lexical path stands", async () => {
    // Every canonicalize answers undefined, including for `/`, so no
    // ancestor is ever found and both sides fall back to the lexical path,
    // exactly as v0.2 through v1.6 behaved for such a host.
    const host = new InMemoryHost({
      files: files({
        "/link/venue/config.yaml": "$schema: ./schema.yaml\n",
        "/link/venue/schema.yaml": "$adopts: ./missing.yaml\n",
      }),
      canonical: new Map(),
      canonicalizeIsIdentity: false,
    });

    const result = await resolve("/link/venue/config.yaml", { host, sandboxRoot: "/link/venue" });

    expect(codesOf(result)).toEqual(["document-unreachable"]);
  });

  it("the POSIX facility this suite leans on is the library's own — resolve() collapses `..` before any of the above is judged", () => {
    expect(posixPaths.resolve("/link/venue", "../outside.yaml")).toBe("/link/outside.yaml");
    expect(posixPaths.dirname("/link/venue/missing.yaml")).toBe("/link/venue");
  });
});

// --- Half two: the node host over a real temporary directory --------------

describe("v1.7 FR-001/FR-002 (node host, real symlink): the case the consumer measured", () => {
  let root: string;

  afterEach(() => {
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * `realpathSync` on the `mkdtemp` result is load-bearing: on macOS
   * `os.tmpdir()` is `/var/folders/…` and `/var` is a link to
   * `/private/var`, so without it the "real" half below would *also* be a
   * symlinked case and the comparison would prove nothing.
   */
  function buildVenue(adoptsTarget: string, venueName = "venue"): { readonly realVenue: string; readonly linkVenue: string } {
    root = realpathSync(mkdtempSync(join(tmpdir(), "cascata-v17-")));
    const realVenue = join(root, "real", venueName);
    mkdirSync(realVenue, { recursive: true });
    writeFileSync(join(realVenue, "config.yaml"), "$schema: ./schema.yaml\n");
    writeFileSync(join(realVenue, "schema.yaml"), `$adopts: ${adoptsTarget}\n`);
    symlinkSync(join(root, "real"), join(root, "link"));
    return { realVenue, linkVenue: join(root, "link", venueName) };
  }

  it("an absent file inside a symlinked root is document-unreachable, exactly as under the real directory", async () => {
    const { realVenue, linkVenue } = buildVenue("./missing.yaml");

    const throughLink = await resolve(join(linkVenue, "config.yaml"), { host: createNodeHost(), sandboxRoot: linkVenue });
    const throughReal = await resolve(join(realVenue, "config.yaml"), { host: createNodeHost(), sandboxRoot: realVenue });

    expect(codesOf(throughLink)).toEqual(["document-unreachable"]);
    expect(codesOf(throughReal)).toEqual(["document-unreachable"]);
  });

  it("an absent ../ target outside a symlinked root is still sandbox-escape", async () => {
    const { realVenue, linkVenue } = buildVenue("../outside.yaml");

    const throughLink = await resolve(join(linkVenue, "config.yaml"), { host: createNodeHost(), sandboxRoot: linkVenue });
    const throughReal = await resolve(join(realVenue, "config.yaml"), { host: createNodeHost(), sandboxRoot: realVenue });

    expect(codesOf(throughLink)).toEqual(["sandbox-escape"]);
    expect(codesOf(throughReal)).toEqual(["sandbox-escape"]);
  });

  it("probe gate, non-ASCII on a real filesystem: a venue directory named città/", async () => {
    const { linkVenue } = buildVenue("./missing.yaml", "città");

    const result = await resolve(join(linkVenue, "config.yaml"), { host: createNodeHost(), sandboxRoot: linkVenue });

    expect(codesOf(result)).toEqual(["document-unreachable"]);
  });

  it("probe gate, adversarial: a dangling link inside the root pointing outside it is judged inside and then fails to read — the window this milestone leaves open, pinned rather than left implicit", async () => {
    const { linkVenue } = buildVenue("./dangling.yaml");
    // The link's target does not exist, so `realpath` answers nothing for
    // it and it is judged through its ancestor — the venue, inside the
    // root. It is then unreadable. v0.2 judged it identically (its lexical
    // fallback put it inside too); see the spec's "Out of scope".
    symlinkSync(join(linkVenue, "..", "..", "escaped.yaml"), join(linkVenue, "dangling.yaml"));

    const result = await resolve(join(linkVenue, "config.yaml"), { host: createNodeHost(), sandboxRoot: linkVenue });

    expect(codesOf(result)).toEqual(["document-unreachable"]);
  });

  it("probe gate, adversarial: a granted root that is a prefix of a sibling's name", async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "cascata-v17-")));
    const house = join(root, "house");
    mkdirSync(join(root, "housekeeping"), { recursive: true });
    mkdirSync(house, { recursive: true });
    writeFileSync(join(house, "config.yaml"), "$schema: ./schema.yaml\n");
    writeFileSync(join(house, "schema.yaml"), "$adopts: ../housekeeping/missing.yaml\n");

    const result = await resolve(join(house, "config.yaml"), { host: createNodeHost(), sandboxRoot: house });

    expect(codesOf(result)).toEqual(["sandbox-escape"]);
  });

  it("a symlink inside the root whose real target lies outside it is still refused — the v0.2 guarantee this milestone must not loosen", async () => {
    const { linkVenue } = buildVenue("./escape.yaml");
    writeFileSync(join(root, "outside.yaml"), "title: Outside\n");
    symlinkSync(join(root, "outside.yaml"), join(linkVenue, "escape.yaml"));

    const result = await resolve(join(linkVenue, "config.yaml"), { host: createNodeHost(), sandboxRoot: linkVenue });

    expect(codesOf(result)).toEqual(["sandbox-escape"]);
  });
});

// --- Story 2: granted roots (v1.7 FR-004 to FR-006, FR-009, FR-011) -------
//
// The lawful door the second correction needs. `sandboxRoot` accepts a
// list; a location is inside the sandbox when it is inside **any** member.
// The posture does not move: granted, never ambient. No root is inferred,
// none is read from a document, and nothing a document says can add one.
//
// Flat in-memory filesystems below (`canonicalizeIsIdentity` left at its
// default, so every location canonicalizes to itself): story 1 is what
// tests the canonicalization, and mixing the two would make it unclear
// which rule a verdict came from.

const HOUSE_FILES = {
  "/venue/config.yaml": "$schema: ./schema.yaml\n",
  "/venue/schema.yaml": "$adopts: /house/house.yaml\n",
  "/house/house.yaml": "title: House\n",
};

describe("v1.7 FR-004 — the caller may grant more than one sandbox root", () => {
  it("a second granted root admits an absolute path under it, and the house schema heads the pedigree", async () => {
    const result = await resolve("/venue/config.yaml", { host: new InMemoryHost({ files: files(HOUSE_FILES) }), sandboxRoot: ["/venue", "/house"] });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.pedigree.map((entry) => entry.identity.location)).toEqual(["/house/house.yaml", "/venue/schema.yaml"]);
  });

  it("without the second root the same reference is sandbox-escape, exactly as today", async () => {
    const result = await resolve("/venue/config.yaml", { host: new InMemoryHost({ files: files(HOUSE_FILES) }), sandboxRoot: "/venue" });

    expect(codesOf(result)).toEqual(["sandbox-escape"]);
  });

  it("a bare string is the one-element list — the two spellings agree", async () => {
    const asString = await resolve("/venue/config.yaml", { host: new InMemoryHost({ files: files(HOUSE_FILES) }), sandboxRoot: "/venue" });
    const asList = await resolve("/venue/config.yaml", { host: new InMemoryHost({ files: files(HOUSE_FILES) }), sandboxRoot: ["/venue"] });

    expect(codesOf(asList)).toEqual(codesOf(asString));
    expect(codesOf(asList)).toEqual(["sandbox-escape"]);
  });

  it("the grant is per-member, not first-member-only — the second member is what admits it", async () => {
    const first = await resolve("/venue/config.yaml", { host: new InMemoryHost({ files: files(HOUSE_FILES) }), sandboxRoot: ["/house", "/venue"] });
    const second = await resolve("/venue/config.yaml", { host: new InMemoryHost({ files: files(HOUSE_FILES) }), sandboxRoot: ["/venue", "/house"] });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it("granting a root that contains neither changes nothing — a list is not a loophole", async () => {
    const result = await resolve("/venue/config.yaml", { host: new InMemoryHost({ files: files(HOUSE_FILES) }), sandboxRoot: ["/venue", "/unrelated"] });

    expect(codesOf(result)).toEqual(["sandbox-escape"]);
  });
});

describe("v1.7 FR-009 — the refusal names the resolved location, every granted root, and the lawful door", () => {
  it("names all three, keeping the code, the level, the span and the citation", async () => {
    const schemaText = "$adopts: /house/house.yaml\n";
    const result = await resolve("/venue/config.yaml", { host: new InMemoryHost({ files: files(HOUSE_FILES) }), sandboxRoot: ["/venue", "/other"] });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.code).toBe("sandbox-escape");
    expect(diagnostic?.level).toBe("error");
    expect(diagnostic?.message).toContain("/house/house.yaml");
    expect(diagnostic?.message).toContain("'/venue'");
    expect(diagnostic?.message).toContain("'/other'");
    expect(diagnostic?.message).toContain("sandboxRoot");
    expect(diagnostic?.message).toContain("v0.2 FR-021");
    // The primary span is still the $adopts value's own position in the
    // schema that wrote it — unchanged by this milestone.
    const valueStart = schemaText.indexOf("/house/house.yaml");
    expect(diagnostic?.primary.origin.id).toBe("/venue/schema.yaml");
    expect(diagnostic?.primary.start).toBe(valueStart);
    expect(diagnostic?.primary.end).toBe(valueStart + "/house/house.yaml".length);
  });
});

describe("v1.7 FR-005 — v0.2 FR-022 holds member-wise", () => {
  const host = () => new InMemoryHost({ files: files(HOUSE_FILES) });
  const bad: ReadonlyArray<readonly [string, unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["the empty string", ""],
    ["the empty list", []],
    ["a list whose only member is empty", [""]],
    ["a list with one good member and one empty one", ["/venue", ""]],
    ["a list with a member that is not a string", ["/venue", 42]],
    ["a list with a null member", ["/venue", null]],
  ];

  for (const [label, value] of bad) {
    it(`throws for ${label}`, async () => {
      const options = { host: host(), sandboxRoot: value } as unknown as Parameters<typeof resolve>[1];
      await expect(resolve("/venue/config.yaml", options)).rejects.toThrow(/requires 'sandboxRoot'/);
    });
  }

  it("no root is inferred from the entry document's location — a granted list that contains nothing refuses", async () => {
    const result = await resolve("/venue/config.yaml", { host: host(), sandboxRoot: ["/elsewhere"] });

    expect(codesOf(result)).toEqual(["sandbox-escape"]);
  });
});

const DELEGATION_FILES = {
  "/venue/config.yaml": "$schema: ./schema.yaml\nnetwork: ../house/frag.yaml\n",
  "/venue/schema.yaml": DELEGATING_SCHEMA,
  "/house/frag.yaml": "host: example.com\n",
};

describe("v1.7 FR-006 — delegation is confined by the same set of roots; there is one sandbox, not one per mechanism", () => {
  it("a delegated target under a second granted root is honored", async () => {
    const result = await resolve("/venue/config.yaml", { host: new InMemoryHost({ files: files(DELEGATION_FILES) }), sandboxRoot: ["/venue", "/house"] });

    expect(result.ok).toBe(true);
  });

  it("the same target without that root is the delegation's own sandbox refusal", async () => {
    const result = await resolve("/venue/config.yaml", { host: new InMemoryHost({ files: files(DELEGATION_FILES) }), sandboxRoot: ["/venue"] });

    expect(codesOf(result)).toEqual(["sandbox-escape"]);
  });

  it("the delegation refusal names every granted root and the option that grants one", async () => {
    const result = await resolve("/venue/config.yaml", { host: new InMemoryHost({ files: files(DELEGATION_FILES) }), sandboxRoot: ["/venue", "/other"] });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics[0]?.message).toContain("'/venue'");
    expect(result.diagnostics[0]?.message).toContain("'/other'");
    expect(result.diagnostics[0]?.message).toContain("sandboxRoot");
  });
});

describe("v1.7 FR-011 — unchanged, and shown unchanged, now for each member of a list", () => {
  it("/sandboxfoo is not inside /sandbox, whichever member /sandbox is", async () => {
    const host = new InMemoryHost({
      files: files({
        "/sandbox/config.yaml": "$schema: ./schema.yaml\n",
        "/sandbox/schema.yaml": "$adopts: /sandboxfoo/base.yaml\n",
        "/sandboxfoo/base.yaml": "title: Lookalike\n",
      }),
    });

    const result = await resolve("/sandbox/config.yaml", { host, sandboxRoot: ["/other", "/sandbox"] });

    expect(codesOf(result)).toEqual(["sandbox-escape"]);
  });

  it("a filesystem root as a list member still contains everything beneath it", async () => {
    const result = await resolve("/venue/config.yaml", { host: new InMemoryHost({ files: files(HOUSE_FILES) }), sandboxRoot: ["/nothing-here", "/"] });

    expect(result.ok).toBe(true);
  });

  it("a host-located reference is not sandbox-checked, list or no list (v1.4)", async () => {
    const host = new InMemoryHost({
      files: files({
        "/venue/config.yaml": "$schema: ./schema.yaml\n",
        "/venue/schema.yaml": "$adopts: beltype:document\n",
        "/pkg/root.yaml": "title: Packaged\n",
      }),
      identities: new Map([["beltype:document", "/pkg/root.yaml"]]),
    });

    const result = await resolve("/venue/config.yaml", { host, sandboxRoot: ["/venue"] });

    expect(result.ok).toBe(true);
  });

  it("an override's own text is not sandbox-checked (v1.6), and a launching schema's is not either (v1.3)", async () => {
    const host = new InMemoryHost({
      files: files({
        "/venue/config.yaml": "name: entry\n",
        "/house/house.yaml": "title: House\n",
        "/house/over.yaml": "name: overridden\n",
      }),
    });

    const result = await resolve("/venue/config.yaml", { host, sandboxRoot: ["/venue"], schema: "/house/house.yaml", overrides: ["/house/over.yaml"] });

    expect(result.ok).toBe(true);
  });
});

// --- Story 3: a schema's `~/` (v1.7 FR-007, FR-008) -----------------------
//
// `SPEC.md` §5.3's worked chain has a project *schema* write
// `$adopts: ~/.config/house.yaml`, while §15's "tilde paths" entry limited
// expansion to config-authored references. The document contradicted
// itself and its own example could not resolve. The entry's reason —
// expansion "grants schemas no new reach" — located reach in the wrong
// place: reach is what **containment** grants, and containment binds every
// schema-authored local reference whether or not its text was expanded
// first. So a schema's `~/` expands, and is then confined exactly as any
// other path it writes.

const HOME = "/home/u";

/** The library's POSIX facility with a home directory — precisely the spread `cascata/paths` exists to make possible (v1.7 FR-010). */
const homePaths: PathFacility = { ...posixPaths, homeDirectory: HOME };

const TILDE_FILES = {
  "/venue/config.yaml": "$schema: ./schema.yaml\n",
  "/venue/schema.yaml": "$adopts: ~/schemas/house.yaml\n",
  "/home/u/schemas/house.yaml": "title: House\n",
};

function tildeHost(overrides?: Partial<Record<string, string>>, paths: PathFacility = homePaths): InMemoryHost {
  return new InMemoryHost({ files: files({ ...TILDE_FILES, ...overrides }), paths });
}

describe("v1.7 FR-007 — a local document's leading ~/ expands whatever the reference's authority, and is then confined", () => {
  it("a venue schema's ~/schemas/house.yaml resolves when a root containing it is granted, and the house schema heads the pedigree", async () => {
    const result = await resolve("/venue/config.yaml", { host: tildeHost(), sandboxRoot: ["/venue", "/home/u/schemas"] });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.pedigree.map((entry) => entry.identity.location)).toEqual(["/home/u/schemas/house.yaml", "/venue/schema.yaml"]);
  });

  it("without that root it is sandbox-escape, and the message names the EXPANDED path — not the literal <venue>/~/… that misled the consumer's own maintainer", async () => {
    const result = await resolve("/venue/config.yaml", { host: tildeHost(), sandboxRoot: ["/venue"] });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const message = result.diagnostics[0]?.message ?? "";
    expect(result.diagnostics[0]?.code).toBe("sandbox-escape");
    expect(message).toContain("/home/u/schemas/house.yaml");
    expect(message).not.toContain("/venue/~/");
    expect(message).toContain("'/venue'");
    expect(message).toContain("sandboxRoot");
  });

  it("a config-authored ~/ is what it was: expanded, and not sandbox-checked at all (v0.2 FR-020, unchanged)", async () => {
    const host = tildeHost({ "/venue/config.yaml": "$schema: ~/schemas/house.yaml\n" });

    const result = await resolve("/venue/config.yaml", { host, sandboxRoot: ["/venue"] });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.pedigree.map((entry) => entry.identity.location)).toEqual(["/home/u/schemas/house.yaml"]);
  });

  it("with no home directory the text stays literal, as a config's does today", async () => {
    // `posixPaths.homeDirectory` is `undefined` — a browser realm. The
    // schema's `~/schemas/house.yaml` is then the ordinary relative path
    // it looks like: `/venue/~/schemas/house.yaml`, which is INSIDE
    // `/venue`, so the verdict is the read failure and never a refusal.
    const result = await resolve("/venue/config.yaml", { host: tildeHost(undefined, posixPaths), sandboxRoot: ["/venue"] });

    expect(codesOf(result)).toEqual(["document-unreachable"]);
  });

  it("the one bounded change of behavior has an escape hatch: `./~/x` still reaches a directory literally named `~`", async () => {
    const host = tildeHost({
      "/venue/schema.yaml": "$adopts: ./~/parent.yaml\n",
      "/venue/~/parent.yaml": "title: Literal tilde\n",
    });

    const result = await resolve("/venue/config.yaml", { host, sandboxRoot: ["/venue"] });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.pedigree.map((entry) => entry.identity.location)).toEqual(["/venue/~/parent.yaml", "/venue/schema.yaml"]);
  });

  it("expansion grants no reach on its own — a granted root is still what admits it (v0.2 FR-021, unchanged)", async () => {
    // `~/../escape.yaml` expands and normalizes to `/home/escape.yaml`,
    // outside both granted roots. Expansion is supply; containment is
    // meaning.
    const host = tildeHost({ "/venue/schema.yaml": "$adopts: ~/../escape.yaml\n", "/home/escape.yaml": "title: Escaped\n" });

    const result = await resolve("/venue/config.yaml", { host, sandboxRoot: ["/venue", "/home/u/schemas"] });

    expect(codesOf(result)).toEqual(["sandbox-escape"]);
  });

  it("a delegated ~/ is unchanged — delegation was already config-authored, so it already expanded, and is still confined", async () => {
    const host = new InMemoryHost({
      files: files({
        "/venue/config.yaml": "$schema: ./schema.yaml\nnetwork: ~/schemas/frag.yaml\n",
        "/venue/schema.yaml": DELEGATING_SCHEMA,
        "/home/u/schemas/frag.yaml": "host: example.com\n",
      }),
      paths: homePaths,
    });

    const refused = await resolve("/venue/config.yaml", { host, sandboxRoot: ["/venue"] });
    const admitted = await resolve("/venue/config.yaml", { host, sandboxRoot: ["/venue", "/home/u/schemas"] });

    expect(codesOf(refused)).toEqual(["sandbox-escape"]);
    expect(admitted.ok).toBe(true);
  });
});

/** A `Transport` that answers every request from a table and writes down the URL it was offered — which is what v1.7 FR-008 is actually about: the user's home path must never be joined into a URL. */
class SpyTransport {
  readonly requested: string[] = [];
  constructor(private readonly bodies: ReadonlyMap<string, string>) {}
  async request(url: string, _method: string): Promise<{ readonly kind: "response"; readonly response: { readonly status: number; readonly headers: Record<string, string>; readonly body: Uint8Array } }> {
    this.requested.push(url);
    const body = this.bodies.get(url);
    return { kind: "response", response: { status: body === undefined ? 404 : 200, headers: {}, body: ENCODER.encode(body ?? "") } };
  }
}

describe("v1.7 FR-008 — a ~/ in a document read over https:// is never expanded, under either authority", () => {
  const REMOTE_SCHEMA = "https://example.test/schemas/base.yaml";

  it("resolves as the relative URL it always was, and the home path reaches no URL the transport is offered", async () => {
    const transport = new SpyTransport(
      new Map([
        [REMOTE_SCHEMA, "$adopts: ~/x.yaml\n"],
        ["https://example.test/schemas/~/x.yaml", "title: Remote parent\n"],
      ]),
    );
    const host = new InMemoryHost({ files: files({ "/venue/config.yaml": `$schema: ${REMOTE_SCHEMA}\n` }), paths: homePaths });

    const result = await resolve("/venue/config.yaml", { host, sandboxRoot: ["/venue"], transport });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(transport.requested).toEqual([REMOTE_SCHEMA, "https://example.test/schemas/~/x.yaml"]);
    expect(transport.requested.some((url) => url.includes(HOME))).toBe(false);
  });

  it("classifies a remote referrer's ~/ as the relative URL under BOTH authorities", () => {
    const origin = createOrigin(REMOTE_SCHEMA, "base.yaml");
    const span = createSourceSpan({ origin, start: 0, end: 0, line: 1, column: 1, documentLength: 64 });
    for (const authority of ["config-authored", "schema-authored"] as const) {
      const reference = createReference({ text: "~/x.yaml", span, kind: authority === "config-authored" ? "schema" : "adopts", authority });

      expect(classifyReferenceLocation(reference, REMOTE_SCHEMA, homePaths)).toEqual({ kind: "https", url: "https://example.test/schemas/~/x.yaml" });
    }
  });

  it("the same two references against a LOCAL referrer do expand — the guard is the referrer, not the authority", () => {
    const origin = createOrigin("/venue/schema.yaml", "schema.yaml");
    const span = createSourceSpan({ origin, start: 0, end: 0, line: 1, column: 1, documentLength: 64 });
    for (const authority of ["config-authored", "schema-authored"] as const) {
      const reference = createReference({ text: "~/x.yaml", span, kind: authority === "config-authored" ? "schema" : "adopts", authority });

      expect(classifyReferenceLocation(reference, "/venue/schema.yaml", homePaths)).toEqual({ kind: "local", location: "/home/u/x.yaml" });
    }
  });
});
