/**
 * Asserts the Principle IV dependency direction mechanically: nothing in
 * `src/model/` or `src/diagnostics/` may import from `src/adapters/`
 * (constitution "Pipeline Stages Are Isolated and Format-Blind"; plan.md
 * "Structure Decision").
 *
 * This scans actual file contents at test time rather than asserting a
 * fixed list, so the boundary keeps being checked as files are added in
 * later phases — the same property tasks.md T017 asks for ("make that
 * test real, not a stub").
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FORMAT_BLIND_DIRS = ["src/model", "src/diagnostics"];

// Matches the module specifier of any `import ... from "spec"` or
// `export ... from "spec"` statement, static or type-only.
const IMPORT_SPECIFIER_PATTERN = /(?:import|export)(?:\s+type)?\s+(?:[^'";]*?\bfrom\s+)?["']([^"']+)["']/g;

// A specifier crosses into the adapters boundary if one of its path
// segments is exactly "adapters" (avoids false positives on names that
// merely contain the substring, e.g. a hypothetical "adaptersFoo").
const CROSSES_ADAPTERS_BOUNDARY = /(^|\/)adapters(\/|$)/;

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
  return [...content.matchAll(IMPORT_SPECIFIER_PATTERN)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => specifier !== undefined);
}

describe("Principle IV: format-blindness boundary", () => {
  for (const relativeDir of FORMAT_BLIND_DIRS) {
    const absoluteDir = join(REPO_ROOT, relativeDir);
    const files = listTsFiles(absoluteDir);

    it(`${relativeDir} contains at least one file to check`, () => {
      // Guards against this test silently passing because the directory
      // it is supposed to be policing went missing or was renamed.
      expect(files.length).toBeGreaterThan(0);
    });

    for (const file of files) {
      const relativeFile = file.slice(REPO_ROOT.length + 1);
      it(`${relativeFile} does not import from src/adapters`, () => {
        const offending = importSpecifiersOf(file).filter((specifier) => CROSSES_ADAPTERS_BOUNDARY.test(specifier));
        expect(offending).toEqual([]);
      });
    }
  }
});
