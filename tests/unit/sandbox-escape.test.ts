/**
 * T053 (User Story 4 conformance cases) — a **schema-authored** local
 * reference resolving outside the caller-supplied sandbox root is
 * refused as `sandbox-escape`, in three ways: a relative `../` escape, an
 * absolute path outside the root, and a symlink whose lexical target
 * sits *inside* the sandbox but whose real target resolves *outside* it
 * (v0.2 FR-021; research D6; `SPEC.md` §8.4).
 *
 * **Why a direct `.test.ts` file rather than the JSON `resolve-cases/`
 * corpus format**: the absolute-path sub-case must embed a real
 * filesystem path that only exists once the test creates its own temp
 * directory at run time — a path baked into a static fixture `.yaml`
 * file would be specific to whichever machine/checkout wrote it, and
 * would not travel with the repository. All three sub-cases are built
 * here, in one file, from a fresh `mkdtempSync` root per test, so the
 * fixtures are genuinely portable and the relative/symlink sub-cases
 * (which *could* have been static) share one construction style with the
 * one that cannot be.
 *
 * **The trap this file exists to catch (CLAUDE.md, tasks.md's own Notes
 * section, T059)**: a sandbox judged on the *lexical* path is
 * indistinguishable from a real sandbox until a symlink inside the root
 * points outside it — the third case below is the one that actually
 * exercises symlink-following (`fs.realpathSync`), not merely lexical
 * `..`-normalization. See the milestone report for the sabotage run that
 * confirms a lexical-only check passes the first two cases but not the
 * third.
 */

import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "../../src/index.js";
import { removeTempCacheDir } from "./remote-test-helpers.js";

describe("T053: a schema-authored reference escaping the sandbox is refused as sandbox-escape", () => {
  let root: string;

  afterEach(() => {
    if (root !== undefined) {
      removeTempCacheDir(root);
    }
  });

  it("refuses a schema's relative ../ escape, naming the $adopts reference's own position", async () => {
    root = mkdtempSync(join(tmpdir(), "cascata-sandbox-relative-"));
    const sandboxRoot = join(root, "sandbox");
    mkdirSync(sandboxRoot, { recursive: true });
    writeFileSync(join(sandboxRoot, "config.yaml"), "$schema: ./schema.yaml\n");
    const adoptsLine = "$adopts: ../outside.yaml\n";
    writeFileSync(join(sandboxRoot, "schema.yaml"), adoptsLine);
    writeFileSync(join(root, "outside.yaml"), "title: Outside\n");

    const result = await resolve(join(sandboxRoot, "config.yaml"), { sandboxRoot });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("sandbox-escape");
    const valueStart = adoptsLine.indexOf("../outside.yaml");
    const valueEnd = valueStart + "../outside.yaml".length;
    expect(result.diagnostics[0]?.primary.origin.id).toBe(join(sandboxRoot, "schema.yaml"));
    expect(result.diagnostics[0]?.primary.start).toBe(valueStart);
    expect(result.diagnostics[0]?.primary.end).toBe(valueEnd);
    expect(result.diagnostics[0]?.primary.line).toBe(1);
    expect(result.diagnostics[0]?.primary.column).toBe(valueStart + 1);
  });

  it("refuses a schema's absolute path outside the sandbox, naming the $adopts reference's own position", async () => {
    root = mkdtempSync(join(tmpdir(), "cascata-sandbox-absolute-"));
    const sandboxRoot = join(root, "sandbox");
    mkdirSync(sandboxRoot, { recursive: true });
    const outsidePath = join(root, "outside2.yaml");
    writeFileSync(outsidePath, "title: Outside2\n");
    writeFileSync(join(sandboxRoot, "config.yaml"), "$schema: ./schema.yaml\n");
    const adoptsLine = `$adopts: ${outsidePath}\n`;
    writeFileSync(join(sandboxRoot, "schema.yaml"), adoptsLine);

    const result = await resolve(join(sandboxRoot, "config.yaml"), { sandboxRoot });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("sandbox-escape");
    const valueStart = adoptsLine.indexOf(outsidePath);
    const valueEnd = valueStart + outsidePath.length;
    expect(result.diagnostics[0]?.primary.start).toBe(valueStart);
    expect(result.diagnostics[0]?.primary.end).toBe(valueEnd);
  });

  it("refuses a schema's reference through a symlink whose real target lies outside the sandbox — judged on the resolved target, not the lexical path (D6, T059)", async () => {
    root = mkdtempSync(join(tmpdir(), "cascata-sandbox-symlink-"));
    const sandboxRoot = join(root, "sandbox");
    mkdirSync(sandboxRoot, { recursive: true });
    writeFileSync(join(sandboxRoot, "config.yaml"), "$schema: ./schema.yaml\n");
    const adoptsLine = "$adopts: ./link-out.yaml\n";
    writeFileSync(join(sandboxRoot, "schema.yaml"), adoptsLine);
    writeFileSync(join(root, "outside3.yaml"), "title: Outside3\n");
    // The symlink itself sits INSIDE the sandbox (lexically confined) —
    // only its *target* escapes. A lexical-only sandbox check would see
    // "./link-out.yaml" resolve to a path under sandboxRoot and wrongly
    // permit it.
    symlinkSync(join("..", "outside3.yaml"), join(sandboxRoot, "link-out.yaml"));

    const result = await resolve(join(sandboxRoot, "config.yaml"), { sandboxRoot });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("sandbox-escape");
    const valueStart = adoptsLine.indexOf("./link-out.yaml");
    const valueEnd = valueStart + "./link-out.yaml".length;
    expect(result.diagnostics[0]?.primary.start).toBe(valueStart);
    expect(result.diagnostics[0]?.primary.end).toBe(valueEnd);
  });
});
