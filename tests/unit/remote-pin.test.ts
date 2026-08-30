/**
 * T037 (User Story 3 conformance cases): a `$pin` that matches, one that
 * mismatches, and one that is malformed — spec.md Acceptance Scenario 3
 * (US3), v0.2 FR-014, FR-015; contracts/diagnostics.md's `pin-mismatch`
 * / `malformed-pin`.
 *
 * **T048's own trap (CLAUDE.md)**: a pin mismatch must **discard** the
 * fetched bytes, not merely report them alongside a diagnostic — an
 * implementation that emits `pin-mismatch` but still admits the document
 * into the graph would pass an assertion that only checks the
 * diagnostic's *code*. The mismatch test below therefore asserts
 * `result.ok === false` — `resolve()`'s result type is a strict
 * either/or (contracts/resolve-api.md: "Terminal states are a graph or a
 * non-empty diagnostic list, never both"), so `ok === false` is
 * equivalent here to "no graph exists containing the bad bytes," not
 * merely "a diagnostic happened to also be produced." A dedicated
 * sabotage run (see the milestone report) confirmed this distinction is
 * load-bearing: an implementation that returns `verified:false` on
 * mismatch instead of failing outright passes a diagnostic-only check
 * but fails this one.
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "../../src/index.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { makeTempCacheDir, removeTempCacheDir } from "./remote-test-helpers.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases", "remote-pin");
const SCHEMA_BYTES = new TextEncoder().encode("title: pinned schema\n");
// Hand-derived via `shasum -a 256 tests/corpus/cases/remote-pin/schema-pinned.yaml`.
const SCHEMA_HASH = "a99f9ed290b231b6eac71550fac6684390c32ad9d8f66b88e7224411f5b2ffad";
const URL = "https://example.test/schema-pinned.yaml";

function recording(): Recording {
  return { url: URL, method: "GET", outcome: { kind: "response", response: { status: 200, headers: {}, body: SCHEMA_BYTES } } };
}

describe("T037: $pin verification — matching, mismatching, malformed", () => {
  let cacheDir: string;

  afterEach(() => {
    if (cacheDir !== undefined) {
      removeTempCacheDir(cacheDir);
    }
  });

  it("a matching pin verifies: the pedigree entry is marked verified:true", async () => {
    cacheDir = makeTempCacheDir();
    const transport = new RecordedTransport([recording()]);
    const result = await resolve(join(FIXTURE_DIR, "config-match.yaml"), { sandboxRoot: FIXTURE_DIR, cacheDir, transport });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`unreachable: ${JSON.stringify(result.diagnostics)}`);
    expect(result.pedigree[0]?.identity.hash).toBe(SCHEMA_HASH);
    expect(result.pedigree[0]?.verified).toBe(true);
  });

  it("a mismatching (but well-formed) pin refuses with pin-mismatch, and the bytes never enter a graph", async () => {
    cacheDir = makeTempCacheDir();
    const transport = new RecordedTransport([recording()]);
    const result = await resolve(join(FIXTURE_DIR, "config-mismatch.yaml"), { sandboxRoot: FIXTURE_DIR, cacheDir, transport });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error(`unreachable — a mismatched pin must never produce a graph, but got one with ${result.graph.documents.length} document(s)`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("pin-mismatch");
    expect(result.diagnostics[0]?.message).toContain(SCHEMA_HASH);
    expect(result.diagnostics[0]?.message).toContain("0000000000000000000000000000000000000000000000000000000000000000".slice(0, 64));
  });

  it("a malformed pin refuses with malformed-pin, distinctly from a mismatch", async () => {
    cacheDir = makeTempCacheDir();
    const transport = new RecordedTransport([recording()]);
    const result = await resolve(join(FIXTURE_DIR, "config-malformed.yaml"), { sandboxRoot: FIXTURE_DIR, cacheDir, transport });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("malformed-pin");
  });
});
