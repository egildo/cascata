/**
 * Confirms the suite performs no network access (contracts/parse-api.md
 * point 6: "No I/O. This milestone reads text it is handed. It opens no
 * file and touches no network"), keeping the corpus hermetic — a green
 * run offline is the expected result, not a lucky one (quickstart.md).
 *
 * Two checks, for two different failure modes:
 *   1. A static scan of every source file under src/ for an import of a
 *      networking module, so an accidental network-capable dependency is
 *      caught even if no test happens to exercise the code path that
 *      would use it.
 *   2. A dynamic check that runs an actual parse over the whole corpus
 *      with the global `fetch` replaced by one that throws, proving the
 *      absence of network calls is a real, exercised property of this
 *      pass and not just an absence of imports.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceOf } from "../corpus/case.js";
import { loadCases } from "../corpus/runner.js";
import { parseYamlInput } from "../corpus/yaml-adapter.js";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus", "cases");

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
  });
});
