/**
 * T036 (User Story 3 conformance cases): a successful HTTPS fetch joins
 * the graph like a local document — spec.md Acceptance Scenario 1 (US3),
 * v0.2 FR-013.
 *
 * **Why a direct `.test.ts` file rather than the JSON `resolve-cases/`
 * corpus format (User Story 2's convention)**: `resolve-case.ts`'s
 * descriptor format (`tests/corpus/resolve-case.ts`) has no field for a
 * `Transport`, a `cacheDir`, or a sequence of recorded HTTP responses —
 * it was designed for local-file-only chains (User Story 2) and adding
 * those fields would be a second, ad hoc format grown just for this
 * milestone slice. Every remote-* conformance file in this milestone
 * (T036-T042) follows the same convention this one sets: real fixture
 * `.yaml` documents on disk (for readability and independently
 * hand-derivable hashes, `shasum -a 256`, never copied from a test run),
 * driven directly against `resolve()` with an explicit `RecordedTransport`
 * and a disposable on-disk cache directory.
 *
 * Fixtures: tests/corpus/cases/remote-fetch/config.yaml (`$schema:
 * https://example.test/schema-root.yaml`) and .../schema-root.yaml (the
 * document served as the fetch response body — kept on disk purely for
 * readability; it is never read from the local filesystem by `resolve()`
 * itself, since nothing at that path is ever opened).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "../../src/index.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { makeTempCacheDir, removeTempCacheDir } from "./remote-test-helpers.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases", "remote-fetch");
const CONFIG_PATH = join(FIXTURE_DIR, "config.yaml");
const SCHEMA_ROOT_BYTES = readFileSync(join(FIXTURE_DIR, "schema-root.yaml"));

// Hand-derived via `shasum -a 256 tests/corpus/cases/remote-fetch/schema-root.yaml`
// outside this codebase — an external oracle, never copied from a test run
// (CLAUDE.md's "Conformance cases before the code that judges them").
const SCHEMA_ROOT_HASH = "6554b0b7544b00d566fd3c2f9aaaeda6cb8a3be92a82b0f33ec1ccf0284106ed";

describe("T036: a successful HTTPS fetch joins the graph like a local document", () => {
  let cacheDir: string;

  afterEach(() => {
    if (cacheDir !== undefined) {
      removeTempCacheDir(cacheDir);
    }
  });

  it("fetches the remote $schema and includes it in the graph and pedigree, unverified (no $pin)", async () => {
    cacheDir = makeTempCacheDir();
    const recording: Recording = {
      url: "https://example.test/schema-root.yaml",
      method: "GET",
      outcome: { kind: "response", response: { status: 200, headers: {}, body: SCHEMA_ROOT_BYTES } },
    };
    const transport = new RecordedTransport([recording]);

    const result = await resolve(CONFIG_PATH, { sandboxRoot: FIXTURE_DIR, cacheDir, transport });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`unreachable: ${JSON.stringify(result.diagnostics)}`);
    }
    expect(result.graph.documents).toHaveLength(2);
    const remoteDoc = result.graph.documents.find((d) => d.identity.location === "https://example.test/schema-root.yaml");
    expect(remoteDoc).toBeDefined();
    expect(remoteDoc?.identity.hash).toBe(SCHEMA_ROOT_HASH);

    expect(result.pedigree).toHaveLength(1);
    expect(result.pedigree[0]?.identity.location).toBe("https://example.test/schema-root.yaml");
    expect(result.pedigree[0]?.identity.hash).toBe(SCHEMA_ROOT_HASH);
    expect(result.pedigree[0]?.via.kind).toBe("schema");
    expect(result.pedigree[0]?.via.authority).toBe("config-authored");
    // FR-026: unpinned is visible, not silent.
    expect(result.pedigree[0]?.verified).toBe(false);

    // Runner contract point 2 (contracts/recorded-responses.md): the case
    // asserted a fetch happens, so the recording must have been consumed.
    expect(() => transport.assertAllConsumed()).not.toThrow();
  });

  it("refuses http:// (plain HTTP) before any request is made — v0.2 FR-013", async () => {
    cacheDir = makeTempCacheDir();
    // Zero recordings: if the implementation ever attempted a request
    // despite the scheme, RecordedTransport would throw rather than
    // silently permit it (constitution: no network access, ever).
    const transport = new RecordedTransport([]);
    const httpConfig = join(FIXTURE_DIR, "config-http.yaml");

    const result = await resolve(httpConfig, { sandboxRoot: FIXTURE_DIR, cacheDir, transport });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("unsupported-scheme");
  });
});
