/**
 * Confirms the suite performs no network access (contracts/parse-api.md
 * point 6: "No I/O. This milestone reads text it is handed. It opens no
 * file and touches no network"), keeping the corpus hermetic — a green
 * run offline is the expected result, not a lucky one (quickstart.md).
 *
 * **T072 re-assertion (tasks.md Phase 7)**: this file predates
 * `src/resolve/fetch.ts`. A real network path now exists —
 * `createNetworkTransport` (src/resolve/fetch.ts), which `resolve()`
 * falls back to whenever a caller omits `transport` (see `src/index.ts`'s
 * `buildRemoteContext`) — so "no import of a networking module" is no
 * longer the whole story: `fetch.ts` uses the WHATWG global `fetch`, not
 * `node:http`, so the v0.1-era static scan below cannot see it at all,
 * and every resolve() call in this suite instead relies on always
 * supplying an explicit `transport` (`RecordedTransport`, tests/corpus/
 * transport.ts) or never reaching a remote reference in the first place.
 * Checks 3 and 4 below verify that reliance is actually true, the same
 * "dynamic, not just an absence of imports" standard check 2 already
 * holds parse() to.
 *
 * Four checks, for four different failure modes:
 *   1. A static scan of every source file under src/ for an import of a
 *      networking module, so an accidental network-capable dependency is
 *      caught even if no test happens to exercise the code path that
 *      would use it.
 *   2. A dynamic check that runs an actual parse over the whole corpus
 *      with the global `fetch` replaced by one that throws, proving the
 *      absence of network calls is a real, exercised property of this
 *      pass and not just an absence of imports.
 *   3. A dynamic check that runs the entire local resolve()-conformance
 *      corpus (tests/corpus/resolve-cases/) — every US2/US4 case, none
 *      of which supplies a `transport` — with the global `fetch` replaced
 *      by one that throws, proving that a local resolution genuinely
 *      never touches the network rather than merely never being asked to
 *      supply a fake one.
 *   4. A static invariant that makes check 3 durable rather than
 *      accidental: no fixture document reachable from
 *      tests/corpus/resolve-cases/ names an `https://` reference. If one
 *      ever did, `resolve()` would build a real `createNetworkTransport`
 *      for it (no `transport` is threaded through `runResolveCase`), and
 *      check 3 would start making a genuine network request in CI rather
 *      than failing loudly — this check is what turns that into an
 *      immediate, obvious failure instead.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceOf } from "../corpus/case.js";
import { loadCases } from "../corpus/runner.js";
import { parseYamlInput } from "../corpus/yaml-adapter.js";
import { loadResolveCase } from "../corpus/resolve-case.js";
import { runResolveCase } from "../corpus/resolve-runner.js";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases");
const RESOLVE_CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "resolve-cases");

const NETWORK_MODULE_PATTERN = /\b(?:node:)?(?:http|https|net|dgram|dns|tls)\b/;

function listTsFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listTsFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      found.push(entryPath);
    }
  }
  return found;
}

/** Every regular file under `dir`, recursively, regardless of extension — unlike `listTsFiles`, since a fixture whose "https://" reference lives in a `.yaml` file is exactly what check 4 below needs to see. */
function listAllFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listAllFiles(entryPath));
    } else if (entry.isFile()) {
      found.push(entryPath);
    }
  }
  return found;
}

function importSpecifiersOf(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  const pattern = /(?:import|export)(?:\s+type)?\s+(?:[^'";]*?\bfrom\s+)?["']([^"']+)["']/g;
  return [...content.matchAll(pattern)].map((match) => match[1]).filter((specifier): specifier is string => specifier !== undefined);
}

describe("hermetic: no network access", () => {
  it("no file under src/ imports a networking module", () => {
    const files = listTsFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const offending = importSpecifiersOf(file).filter((specifier) => NETWORK_MODULE_PATTERN.test(specifier));
      expect(offending, `${file} imports a networking module`).toEqual([]);
    }
  });

  describe("actually running the corpus never calls fetch", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("parses every case in the corpus with a fetch that throws if called, and nothing calls it", () => {
      globalThis.fetch = vi.fn(() => {
        throw new Error("Network access attempted during a hermetic test run");
      }) as unknown as typeof fetch;

      const cases = loadCases(CASES_DIR);
      expect(cases.length).toBeGreaterThan(0);
      for (const testCase of cases) {
        const origin = { id: testCase.name, label: testCase.name };
        expect(() => parseYamlInput(sourceOf(testCase), { origin, limits: testCase.limits })).not.toThrow();
      }
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("resolves every case in the local resolve()-conformance corpus with a fetch that throws if called, and nothing calls it", async () => {
      globalThis.fetch = vi.fn(() => {
        throw new Error("Network access attempted during a hermetic test run");
      }) as unknown as typeof fetch;

      const caseFiles = readdirSync(RESOLVE_CASES_DIR, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => join(RESOLVE_CASES_DIR, entry.name));
      expect(caseFiles.length).toBeGreaterThan(0);

      for (const file of caseFiles) {
        const testCase = loadResolveCase(file);
        // None of these cases supply a `transport` (they run through
        // `runResolveCase`, exactly as `resolve-corpus.test.ts` runs
        // them) — so a passing result here means `resolve()` truly never
        // reached `createNetworkTransport`'s real `fetch`, not merely
        // that a fake one absorbed the call.
        const result = await runResolveCase(testCase);
        expect(result.failures, `${testCase.name}: ${result.failures.join("\n")}`).toEqual([]);
      }
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  it("no fixture reachable from the local resolve()-conformance corpus names an https:// reference (what keeps the check above meaningful rather than accidental)", () => {
    const caseFiles = readdirSync(RESOLVE_CASES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => join(RESOLVE_CASES_DIR, entry.name));
    expect(caseFiles.length).toBeGreaterThan(0);

    const fixtureDirs = new Set(caseFiles.map((file) => loadResolveCase(file).fixtureDir));
    expect(fixtureDirs.size).toBeGreaterThan(0);

    for (const fixtureDir of fixtureDirs) {
      for (const file of listAllFiles(fixtureDir)) {
        const content = readFileSync(file, "utf-8");
        expect(content, `${file} names an https:// reference — resolve() would attempt a real network fetch for it`).not.toContain("https://");
      }
    }
  });
});
