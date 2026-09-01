/**
 * T072/T068 — SC-009: "the same inputs and cache state produce the same
 * graph, the same pedigree order, and the same diagnostics in the same
 * order on every run." contracts/resolve-api.md's Behavioral Contract
 * point 3 restates it verbatim.
 *
 * `tests/unit/determinism.test.ts` (v0.1) already covers `parse()`/
 * `parseText()` determinism — a single document's tree and diagnostics.
 * It says nothing about `resolve()`: graph assembly order, pedigree
 * order, or diagnostics from a multi-document resolution, none of which
 * existed before this milestone. This file is that missing coverage,
 * against the real `resolve()` (no mocking of `GraphBuilder` or
 * `DocumentCache` — determinism is a property of the whole pipeline, not
 * of one module in isolation).
 *
 * Three scenarios, matching SC-009's three nouns:
 *   1. **graph / pedigree** — a successful local chain, resolved twice.
 *   2. **diagnostics** — a failing chain (a cycle), resolved twice.
 *   3. **cache state** — a remote chain resolved twice from an
 *      already-populated cache with the network unavailable both times,
 *      confirming "same inputs and cache state" holds across separate
 *      calls, not just within one process's happenstance ordering.
 *
 * `resolve()` should be deterministic by construction — no clock, no
 * `Math.random`, and `GraphBuilder`'s traversal order is fixed by the
 * document's own `$adopts` chain — so this is a backstop, the same
 * relationship v0.1's determinism test has to `parse()`.
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolve } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";
import type { Graph, Pedigree } from "../../src/index.js";
import type { RecordingOutcome, Transport } from "../../src/resolve/transport.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { makeTempCacheDir, removeTempCacheDir } from "./remote-test-helpers.js";

const CORPUS_CASES = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases");
const CYCLE_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "cycle");

/** A projection of `Graph` that `toEqual` can compare structurally without tripping over `Node`'s internal `Map`/frozen-object machinery — location and hash are exactly what identity and dedup are defined by (data-model.md "Document Identity"), so this is a faithful, order-sensitive summary of "the same graph". */
function projectGraph(graph: Graph): readonly { location: string; hash: string }[] {
  return graph.documents.map((doc) => ({ location: doc.identity.location, hash: doc.identity.hash }));
}

/** A projection of `Pedigree` covering every field SC-009/FR-011/FR-012/FR-026 promise stays stable: identity, the reference that brought each entry in (kind, authority, and its position), and verification status. Order-sensitive, since the pedigree is root-to-leaf by contract (graph/pedigree.ts). */
function projectPedigree(pedigree: Pedigree): readonly { location: string; hash: string; kind: string; authority: string; verified: boolean; viaLine: number; viaColumn: number }[] {
  return pedigree.map((entry) => ({
    location: entry.identity.location,
    hash: entry.identity.hash,
    kind: entry.via.kind,
    authority: entry.via.authority,
    verified: entry.verified,
    viaLine: entry.via.span.line,
    viaColumn: entry.via.span.column,
  }));
}

/** A projection of a diagnostic list: code, primary position, and each related span's label and position, in order — everything contracts/diagnostics.md promises is stable for a given input. */
function projectDiagnostics(diagnostics: readonly { code: string; primary: { line: number; column: number }; related: readonly { label: string; span: { line: number; column: number } }[] }[]): unknown {
  return diagnostics.map((d) => ({
    code: d.code,
    primaryLine: d.primary.line,
    primaryColumn: d.primary.column,
    related: d.related.map((r) => ({ label: r.label, line: r.span.line, column: r.span.column })),
  }));
}

describe("resolve() determinism (SC-009)", () => {
  it("a successful local chain produces the same graph and pedigree order across repeated resolutions", async () => {
    const fixtureDir = join(CORPUS_CASES, "chain-local");
    const entry = join(fixtureDir, "config.yaml");

    const first = await resolve(entry, { host: createNodeHost(), sandboxRoot: fixtureDir });
    const second = await resolve(entry, { host: createNodeHost(), sandboxRoot: fixtureDir });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error("unreachable — checked above");
    }
    expect(projectGraph(second.graph)).toEqual(projectGraph(first.graph));
    expect(projectPedigree(second.pedigree)).toEqual(projectPedigree(first.pedigree));
    // Guards the assertions above against vacuously holding for an empty chain.
    expect(first.pedigree.length).toBeGreaterThan(1);
  });

  it("running the same successful local chain ten times in a row never diverges", async () => {
    const fixtureDir = join(CORPUS_CASES, "chain-local");
    const entry = join(fixtureDir, "config.yaml");

    const results = await Promise.all(Array.from({ length: 10 }, () => resolve(entry, { host: createNodeHost(), sandboxRoot: fixtureDir })));
    for (const result of results) {
      expect(result.ok).toBe(true);
    }
    const [first, ...rest] = results;
    if (first === undefined || !first.ok) {
      throw new Error("unreachable — checked above");
    }
    for (const result of rest) {
      if (!result.ok) {
        throw new Error("unreachable — checked above");
      }
      expect(projectGraph(result.graph)).toEqual(projectGraph(first.graph));
      expect(projectPedigree(result.pedigree)).toEqual(projectPedigree(first.pedigree));
    }
  });

  it("a failing chain (a cycle) produces the same, identically-ordered diagnostics across repeated resolutions", async () => {
    const fixtureDir = join(CYCLE_FIXTURES, "mutual");
    const entry = join(fixtureDir, "config.yaml");

    const first = await resolve(entry, { host: createNodeHost(), sandboxRoot: fixtureDir });
    const second = await resolve(entry, { host: createNodeHost(), sandboxRoot: fixtureDir });

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (first.ok || second.ok) {
      throw new Error("unreachable — checked above");
    }
    expect(projectDiagnostics(second.diagnostics)).toEqual(projectDiagnostics(first.diagnostics));
    expect(first.diagnostics[0]?.code).toBe("reference-cycle");
  });

  it("the same cache state produces the same graph and pedigree across separate offline resolve() calls (the 'cache state' half of SC-009)", async () => {
    const fixtureDir = join(CORPUS_CASES, "remote-fetch");
    const entry = join(fixtureDir, "config.yaml");
    const cacheDir = makeTempCacheDir();
    try {
      const schemaBytes = new TextEncoder().encode("title: determinism schema\n");
      const url = "https://example.test/schema-root.yaml";

      // Populate the cache once, over the network.
      const seeding: Recording = { url, method: "GET", outcome: { kind: "response", response: { status: 200, headers: { "cache-control": "max-age=3600" }, body: schemaBytes } } };
      const seeded = await resolve(entry, { host: createNodeHost({ cacheDir }), sandboxRoot: fixtureDir, transport: new RecordedTransport([seeding]) });
      expect(seeded.ok).toBe(true);

      // Two further calls against the same cache directory, with a
      // transport that fails every request — both must be served
      // entirely from the cache populated above, and identically so.
      const alwaysFails: Transport = {
        request: (): Promise<RecordingOutcome> => Promise.resolve<RecordingOutcome>({ kind: "failure", failure: { kind: "connection-refused" } }),
      };
      const offlineFirst = await resolve(entry, { host: createNodeHost({ cacheDir }), sandboxRoot: fixtureDir, transport: alwaysFails });
      const offlineSecond = await resolve(entry, { host: createNodeHost({ cacheDir }), sandboxRoot: fixtureDir, transport: alwaysFails });

      expect(offlineFirst.ok).toBe(true);
      expect(offlineSecond.ok).toBe(true);
      if (!offlineFirst.ok || !offlineSecond.ok) {
        throw new Error("unreachable — checked above");
      }
      expect(projectGraph(offlineSecond.graph)).toEqual(projectGraph(offlineFirst.graph));
      expect(projectPedigree(offlineSecond.pedigree)).toEqual(projectPedigree(offlineFirst.pedigree));
    } finally {
      removeTempCacheDir(cacheDir);
    }
  });
});
