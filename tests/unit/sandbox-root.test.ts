/**
 * v1.4 (013) FR-007 — **the correction**: a `sandboxRoot` that is a
 * filesystem root contains every absolute path beneath it.
 *
 * Until v1.4 the containment test was `location === root || location
 * .startsWith(root + sep)`, and for `sandboxRoot: "/"` the second half
 * read `startsWith("//")`, which no absolute path satisfies. The one
 * value that plainly means *contain nothing, admit everything* therefore
 * refused every reference except the root document itself — measured
 * against v1.3, same reference, same host, `ok` under a real directory
 * and `sandbox-escape` under `/`.
 *
 * The half that must NOT change comes with it: `/sandbox` still does not
 * contain `/sandboxfoo`. A fix that appended nothing at all — plain
 * `startsWith(root)` — would pass the first test here and fail the
 * second, which is why both live in one file.
 *
 * In-memory host, so the roots under test are virtual and the case runs
 * the same on any machine.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "../../src/index.js";
import { InMemoryHost } from "./host-test-double.js";

const ENCODER = new TextEncoder();

function hostWith(adoptsTarget: string): InMemoryHost {
  return new InMemoryHost({
    files: new Map([
      ["/sandbox/config.yaml", ENCODER.encode("$schema: ./schema.yaml\nname: standalone\n")],
      ["/sandbox/schema.yaml", ENCODER.encode(`$adopts: ${adoptsTarget}\n`)],
      ["/sandbox/inside.yaml", ENCODER.encode("$id: sandbox/inside\n")],
      ["/elsewhere/base.yaml", ENCODER.encode("$id: sandbox/base\n")],
      ["/sandboxfoo/base.yaml", ENCODER.encode("$id: sandbox/lookalike\n")],
    ]),
  });
}

describe("v1.4 FR-007 — a sandbox root that is a filesystem root contains everything beneath it", () => {
  it("admits an absolute path under `/` when sandboxRoot is `/`", async () => {
    const host = hostWith("/elsewhere/base.yaml");

    const result = await resolve("/sandbox/config.yaml", { host, sandboxRoot: "/" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.pedigree.map((entry) => entry.identity.location)).toEqual(["/elsewhere/base.yaml", "/sandbox/schema.yaml"]);
  });

  it("still refuses the same path when the sandbox is a real directory", async () => {
    const host = hostWith("/elsewhere/base.yaml");

    const result = await resolve("/sandbox/config.yaml", { host, sandboxRoot: "/sandbox" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics[0]?.code).toBe("sandbox-escape");
  });

  it("does not admit `/sandboxfoo` into `/sandbox` — the separator is load-bearing, not decoration", async () => {
    const host = hostWith("/sandboxfoo/base.yaml");

    const result = await resolve("/sandbox/config.yaml", { host, sandboxRoot: "/sandbox" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics[0]?.code).toBe("sandbox-escape");
  });

  it("admits a path genuinely inside a real sandbox root, which is what the second half of the test is for", async () => {
    const host = hostWith("/sandbox/inside.yaml");

    const result = await resolve("/sandbox/config.yaml", { host, sandboxRoot: "/sandbox" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.pedigree.map((entry) => entry.identity.location)).toEqual(["/sandbox/inside.yaml", "/sandbox/schema.yaml"]);
  });
});
