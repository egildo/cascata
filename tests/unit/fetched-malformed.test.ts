/**
 * T057 (User Story 4 conformance case): a fetched document that is not
 * readable as a document at all is attributed to the reference that
 * fetched it — `document-unreachable`, anchored to the `$schema`
 * reference in `config.yaml`, never to an anonymous position inside the
 * fetched body (v0.2 FR-024; spec.md Acceptance Scenario 6, US4).
 *
 * Same file-organization convention as `tests/unit/remote-fetch.test.ts`
 * (T036): `resolve-case.ts`'s JSON descriptor format has no field for a
 * `Transport`, so this is a direct unit test. `malformed.yaml` is kept on
 * disk purely for readability (`shasum`-able, diffable) — it is never
 * read from the local filesystem by `resolve()`; its bytes are served as
 * the recorded HTTPS response body.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "../../src/index.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { makeTempCacheDir, removeTempCacheDir } from "./remote-test-helpers.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases", "fail-fetched-malformed");
const CONFIG_PATH = join(FIXTURE_DIR, "config.yaml");
const MALFORMED_BYTES = readFileSync(join(FIXTURE_DIR, "malformed.yaml"));

describe("T057: a fetched-but-unparseable document is attributed to the reference that fetched it", () => {
  let cacheDir: string;

  afterEach(() => {
    if (cacheDir !== undefined) {
      removeTempCacheDir(cacheDir);
    }
  });

  it("reports document-unreachable at the $schema reference's own position, not an anonymous parse error", async () => {
    cacheDir = makeTempCacheDir();
    const recording: Recording = {
      url: "https://example.test/schema-root.yaml",
      method: "GET",
      outcome: { kind: "response", response: { status: 200, headers: {}, body: MALFORMED_BYTES } },
    };
    const transport = new RecordedTransport([recording]);

    const result = await resolve(CONFIG_PATH, { sandboxRoot: FIXTURE_DIR, cacheDir, transport });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics).toHaveLength(1);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.code).toBe("document-unreachable");
    // Anchored to config.yaml's own $schema reference — the document the
    // author actually wrote — never to a position inside schema-root.yaml.
    expect(diagnostic?.primary.origin.id).toBe(CONFIG_PATH);
    expect(diagnostic?.primary.line).toBe(1);
    expect(diagnostic?.primary.column).toBe(10);
    expect(diagnostic?.primary.start).toBe(9);
    expect(diagnostic?.primary.end).toBe(46);
    // The underlying parse failure (a duplicate key in the fetched body)
    // is still surfaced, just as `related` context rather than the
    // diagnostic's own anchor.
    expect(diagnostic?.related.length).toBeGreaterThan(0);

    expect(() => transport.assertAllConsumed()).not.toThrow();
  });
});
