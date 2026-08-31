/**
 * Asserts the Principle IV dependency direction mechanically:
 *   - `src/model/` and `src/diagnostics/` may not import from `src/adapters/`
 *   - `src/resolve/` and `src/graph/` may not import from `src/adapters/` either (v0.2)
 *   - `src/graph/` may not import from `src/resolve/` (v0.2, plan.md's Structure Decision:
 *     resolve/ deals in bytes and locations; graph/ deals in parsed trees; neither may
 *     reach into the other's concern)
 *
 * This scans actual file contents at test time rather than asserting a
 * fixed list, so the boundary keeps being checked as files are added in
 * later phases (the same property v0.1's T017 asked for).
 *
 * `src/resolve/` and `src/graph/` are extended into the policed set
 * *before* either has much code in it (tasks.md T012, Phase 2 —
 * Foundational): `src/graph/` in particular has no files at all yet in
 * this milestone's slice (User Story 2, which populates it, is out of
 * scope for T001-T018). A directory with nothing in it passes every
 * check here vacuously, but that is asserted explicitly below, not
 * silently skipped — and because it has no committed files, git will not
 * even preserve the directory itself across a fresh clone until Phase 4
 * adds one; this test tolerates the directory being absent on disk for
 * exactly that reason.
 *
 * **v0.3 (tasks.md T011)**: `src/merge/` joins the policed set — the first
 * module that is both format-blind *and* location-blind
 * (plan.md's Structure Decision). `src/merge/` may import `model/`,
 * `diagnostics/`, and `graph/`; it may import neither `adapters/` nor
 * `resolve/`. It is therefore added to `NO_ADAPTER_IMPORT_DIRS` (already
 * policed against `adapters/`) *and* to a new resolve-boundary check
 * alongside `src/graph/`'s existing one.
 */

import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Every directory that may not import an adapter. v0.1 policed the first
// two; v0.2 (plan.md) extends the set to resolve/ and graph/; v0.3 adds merge/.
const NO_ADAPTER_IMPORT_DIRS = ["src/model", "src/diagnostics", "src/resolve", "src/graph", "src/merge"];

// Matches the module specifier of any `import ... from "spec"` or
// `export ... from "spec"` statement, static or type-only.
const IMPORT_SPECIFIER_PATTERN = /(?:import|export)(?:\s+type)?\s+(?:[^'";]*?\bfrom\s+)?["']([^"']+)["']/g;

// A specifier crosses a boundary if one of its path segments is exactly
// the boundary name (avoids false positives on a name that merely
// contains the substring, e.g. a hypothetical "adaptersFoo").
function crossesBoundary(segment: string): RegExp {
  return new RegExp(`(^|/)${segment}(/|$)`);
}

const CROSSES_ADAPTERS_BOUNDARY = crossesBoundary("adapters");
const CROSSES_RESOLVE_BOUNDARY = crossesBoundary("resolve");

/** Lists `.ts` files under `dir`, recursively. A directory that does not exist on disk (never had a file committed to it) is treated as empty, not an error — see the module doc. */
function listTsFiles(dir: string): string[] {
  const found: string[] = [];
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: "utf-8" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  for (const entry of entries) {
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

describe("Principle IV: format-blindness boundary — no import of src/adapters", () => {
  for (const relativeDir of NO_ADAPTER_IMPORT_DIRS) {
    const absoluteDir = join(REPO_ROOT, relativeDir);
    const files = listTsFiles(absoluteDir);

    if (files.length === 0) {
      it(`${relativeDir} has no files yet — an explicit, currently-vacuous fact, not a skip`, () => {
        expect(files).toEqual([]);
      });
      continue;
    }

    for (const file of files) {
      const relativeFile = file.slice(REPO_ROOT.length + 1);
      it(`${relativeFile} does not import from src/adapters`, () => {
        const offending = importSpecifiersOf(file).filter((specifier) => CROSSES_ADAPTERS_BOUNDARY.test(specifier));
        expect(offending).toEqual([]);
      });
    }
  }
});

// Every directory that may not import src/resolve/. v0.2 (plan.md) policed
// graph/ alone; v0.3 (T011, plan.md's Structure Decision) adds merge/ — the
// first module that is both format-blind *and* location-blind.
const NO_RESOLVE_IMPORT_DIRS = ["src/graph", "src/merge"];

for (const relativeDir of NO_RESOLVE_IMPORT_DIRS) {
  describe(`Principle IV: ${relativeDir}/ does not import src/resolve/`, () => {
    const absoluteDir = join(REPO_ROOT, ...relativeDir.split("/"));
    const files = listTsFiles(absoluteDir);

    if (files.length === 0) {
      it(`${relativeDir} has no files yet — an explicit, currently-vacuous fact, not a skip`, () => {
        expect(files).toEqual([]);
      });
    } else {
      for (const file of files) {
        const relativeFile = file.slice(REPO_ROOT.length + 1);
        it(`${relativeFile} does not import from src/resolve`, () => {
          const offending = importSpecifiersOf(file).filter((specifier) => CROSSES_RESOLVE_BOUNDARY.test(specifier));
          expect(offending).toEqual([]);
        });
      }
    }
  });
}
