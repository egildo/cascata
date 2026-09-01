/**
 * v0.7 FR-016 through FR-021, SPEC.md §6.3, §11 — the `authority:`
 * section: `demandPinnedAdoption`, `finalAgainstForking`.
 *
 * **A derivation worth recording, because it contradicts a naive reading
 * of Acceptance Scenario 1's own prose**: "a descendant adopting it [the
 * root] with no $pin" cannot be tested with a plain two-layer chain
 * (root + config). FR-019 states the demand "MUST NOT apply to the fetch
 * of the declaring document itself", and SPEC.md §11 explains why: "a
 * root's demand can only be read after that root has been fetched, so it
 * hardens every subsequent resolution but not the first." In a two-layer
 * chain, the **only** reference in the whole resolution is exactly the
 * one that fetches the root — there is no "subsequent" reference left to
 * hardened at all, so a two-layer fixture cannot exercise the refusal
 * without contradicting FR-019. A genuine test of the refusal therefore
 * needs **three** layers (root, middle, config): root's own fetch
 * (middle's `$adopts: root.yaml`) stays exempt; the refusal fires on
 * *config's* reference to *middle* — the first reference discovered
 * after root's own `authority:` section has actually been read. Found
 * by deriving the expected chain independently before writing the
 * fixture (CLAUDE.md's method), not by running a first implementation
 * attempt and copying whatever it did.
 */
import { describe, expect, it } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "../../src/index.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { makeTempCacheDir, removeTempCacheDir } from "./remote-test-helpers.js";

const CASES_DIR = join(__dirname, "..", "corpus", "cases", "authority");

describe("v0.7 FR-017 — demandPinnedAdoption refuses an unpinned reference below the declaring root", () => {
  it("demand-pinned-unpinned-refused: config's reference to 'middle' is refused, citing 'root'", async () => {
    const dir = join(CASES_DIR, "demand-pinned-unpinned-refused");
    const result = await resolve(join(dir, "config.yaml"), { sandboxRoot: dir });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("adoption-not-pinned");
    expect(result.diagnostics[0]?.level).toBe("error");
    expect(result.diagnostics[0]?.message).toContain("root.yaml");
    // Positioned at config's own $schema reference (config.yaml line 1), not at middle's own $adopts.
    expect(result.diagnostics[0]?.primary.origin.id).toBe(join(dir, "config.yaml"));
  });

  it("demand-pinned-pinned-accepted: the same chain, correctly pinned, resolves", async () => {
    const dir = join(CASES_DIR, "demand-pinned-pinned-accepted");
    const result = await resolve(join(dir, "config.yaml"), { sandboxRoot: dir });
    expect(result.ok).toBe(true);
  });
});

describe("v0.7 FR-018 — the demand is not retractable", () => {
  it("a descendant declaring demandPinnedAdoption: false has no effect -- the demand set by an ancestor still binds", async () => {
    const dir = makeTempCacheDir();
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(
        join(dir, "root.yaml"),
        "$id: test/root\nauthority:\n  demandPinnedAdoption: true\nkeys:\n  title:\n    demand:\n      type: string\n",
      );
      writeFileSync(join(dir, "middle.yaml"), "$adopts: ./root.yaml\nauthority:\n  demandPinnedAdoption: false\n");
      writeFileSync(join(dir, "config.yaml"), "$schema: ./middle.yaml\ntitle: hello\n");
      const result = await resolve(join(dir, "config.yaml"), { sandboxRoot: dir });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.diagnostics.some((d) => d.code === "adoption-not-pinned")).toBe(true);
    } finally {
      removeTempCacheDir(dir);
    }
  });
});

describe("v0.7 FR-019 — the demand never protects the declaring document's own fetch (SPEC.md §11's inherent limit)", () => {
  it("demand-pinned-own-fetch-exempt: a genuine two-layer chain (config's $schema names root directly) with root reached unpinned is NOT refused -- there is no 'subsequent' reference to harden", async () => {
    // Deliberately its own fixture, distinct from demand-pinned-unpinned-refused's
    // three-layer chain: config's $schema is the ONLY reference in this whole
    // resolution, and it is exactly the reference that fetches root itself --
    // the one case FR-019 says can never be protected by root's own demand.
    const dir = join(CASES_DIR, "demand-pinned-own-fetch-exempt");
    const result = await resolve(join(dir, "config.yaml"), { sandboxRoot: dir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
  });
});

describe("v0.7 FR-020 — finalAgainstForking is recorded and queryable, and produces zero diagnostics", () => {
  it("final-against-forking-recorded: ok:true, no diagnostics at all, and the pedigree entry carries finalAgainstForking:true", async () => {
    const dir = join(CASES_DIR, "final-against-forking-recorded");
    const result = await resolve(join(dir, "config.yaml"), { sandboxRoot: dir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(result.pedigree).toHaveLength(1);
    expect(result.pedigree[0]?.finalAgainstForking).toBe(true);
  });
});

describe("v0.7 FR-016 — an authority: member this version does not implement is refused, naming what is supported", () => {
  it("unknown-authority-member: refused at the member's own position", async () => {
    const dir = join(CASES_DIR, "unknown-authority-member");
    const result = await resolve(join(dir, "config.yaml"), { sandboxRoot: dir });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("unknown-authority-member");
  });
});

describe("v0.7 FR-021 — an authority: section declared by a config has no effect", () => {
  it("config-authority-ignored: ok:true -- the config's own 'authority:' is never read", async () => {
    const dir = join(CASES_DIR, "config-authority-ignored");
    const result = await resolve(join(dir, "config.yaml"), { sandboxRoot: dir });
    expect(result.ok).toBe(true);
  });
});

describe("v0.7 FR-017 (Acceptance Scenario 2, verified via the remote pin mechanism) -- a root demanding pinned adoption, correctly pinned, resolves and verifies", () => {
  const SCHEMA_BYTES = new TextEncoder().encode("$id: test/remote-root\nauthority:\n  demandPinnedAdoption: true\nkeys:\n  title:\n    demand:\n      type: string\n");
  // Hand-derived via `shasum -a 256` over the exact bytes above (not copied from any implementation run).
  const SCHEMA_HASH = "311d3c6d936cf536ec5a026aa62946a0f7906cbab012ad56cff6b8ce5616a6d6";
  const URL = "https://example.test/remote-root.yaml";

  it("a config pinning a remote root correctly resolves and marks the pedigree entry verified:true", async () => {
    const cacheDir = makeTempCacheDir();
    const configDir = makeTempCacheDir();
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(configDir, "config.yaml"), `$schema: ${URL}\n$pin: sha256:${SCHEMA_HASH}\ntitle: hello\n`);
      const recording: Recording = { url: URL, method: "GET", outcome: { kind: "response", response: { status: 200, headers: {}, body: SCHEMA_BYTES } } };
      const transport = new RecordedTransport([recording]);
      const result = await resolve(join(configDir, "config.yaml"), { sandboxRoot: configDir, cacheDir, transport });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`unreachable: ${JSON.stringify(result.diagnostics)}`);
      expect(result.pedigree).toHaveLength(1);
      expect(result.pedigree[0]?.verified).toBe(true);
    } finally {
      removeTempCacheDir(cacheDir);
      removeTempCacheDir(configDir);
    }
  });
});
