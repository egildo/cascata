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
 *
 * **v0.4 (specs/004-constraint-checker/tasks.md T008)**: `src/validate/`
 * joins both policed sets, before it has any code in it — the same
 * precedent this file's own v0.2/v0.3 additions set. `src/validate/` may
 * import `model/`, `diagnostics/`, `graph/`, and `merge/`; it may import
 * neither `adapters/` nor `resolve/`.
 *
 * **v0.7 (specs/007-sealing-and-embedding, FR-023/FR-024, gate 7)**: a
 * third, broader sweep — Article VI, "the library performs no I/O". No
 * file under all of `src/` (not a fixed subset — every existing and
 * future module) may statically import `"node:fs"` or call the bare
 * `fetch` identifier, **except** `src/host/node.ts`, the shipped host,
 * named here explicitly as the one permitted exception (FR-024: "MUST be
 * named explicitly by the boundary test"). A socket is not checked
 * separately — nothing in this codebase opens one directly; `fetch` is
 * the only network primitive used anywhere, so checking it is checking
 * the whole surface FR-023 names. This sweep is additive: it does not
 * touch either assertion above (FR-023: "MUST NOT weaken anything this
 * file already asserts").
 */

import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Every directory that may not import an adapter. v0.1 policed the first
// two; v0.2 (plan.md) extends the set to resolve/ and graph/; v0.3 adds merge/.
// **v1.0 (009 FR-028)**: `src/project/` joins both policed sets, following
// the precedent v0.2/v0.3/v0.4 each set for `resolve/`, `merge/` and
// `validate/` — a new stage is added to the boundary before it has much
// code in it, not after someone notices. The value view is the most
// world-blind stage there is: it consumes a `MergedConfiguration` that is
// already entirely in hand, and has no business knowing what format any of
// it arrived in or where any of it came from.
// **v1.1 (010 FR-032)**: `src/generate/` joins both policed sets **before
// the directory has code in it**, the precedent every stage has followed
// (`resolve/`+`graph/` at v0.2, `merge/` at v0.3, `validate/` at v0.4,
// `project/` at v1.0). The accumulated demand is computed from schema
// layers alone and the emitter is a string printer: neither has any
// business knowing what format a layer arrived in, nor where it came from.
const NO_ADAPTER_IMPORT_DIRS = ["src/model", "src/diagnostics", "src/resolve", "src/graph", "src/merge", "src/validate", "src/project", "src/generate"];

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
// first module that is both format-blind *and* location-blind. v0.4
// (specs/004-constraint-checker/tasks.md T008) adds validate/.
// v1.0 adds project/; v1.1 (010) adds generate/ — see NO_ADAPTER_IMPORT_DIRS above.
const NO_RESOLVE_IMPORT_DIRS = ["src/graph", "src/merge", "src/validate", "src/project", "src/generate"];

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

// --- v0.7 gate 7: the host boundary (Article VI, FR-023/FR-024) -----------
//
// No module under ALL of src/ may import "node:fs" (statically or
// dynamically), require(...) it, or call the bare `fetch` identifier,
// except the one named exemption below. Unlike the two sweeps above (a
// fixed, growing list of directories), this one scans every file under
// src/ unconditionally — the boundary this article draws is total, not
// confined to a subset of stages.
//
// **The static-import check below (`importsNodeFs`) only sees an
// `ImportDeclaration`/`ExportDeclaration`'s own specifier string — a
// dynamic `import("node:fs")` (or its CommonJS twin, `require("node:fs")`)
// walks straight through it, since neither is a static import/export
// statement at all.** Found by the coordinator sabotaging this gate
// directly: a static `import` prepended to a file was caught (exactly one
// test failed, the right one); an `async function` containing
// `await import("node:fs")` was not caught at all — the suite passed with
// a live filesystem escape hatch sitting in `src/validate/check.ts`.
// `DYNAMIC_FS_IMPORT_OR_REQUIRE_PATTERN` below closes that gap.

/** The shipped host — the library's one permitted exemption from gate 7 (FR-024), named explicitly rather than inferred from a pattern. */
const HOST_BOUNDARY_EXEMPTION = "src/host/node.ts";

const NODE_FS_SPECIFIERS: ReadonlySet<string> = new Set(["node:fs", "fs"]);

// A call to the bare, global `fetch` identifier — not `foo.fetch(...)` (a
// method on some other object), not an identifier merely containing
// "fetch" (`myFetch(...)`, `refetch(...)`), and — the false positive an
// earlier version of this pattern actually hit, caught before this file
// was ever trusted (this codebase's own prose uses "fetch" as an
// ordinary noun, e.g. "the document's own fetch (FR-019)") — not the
// word "fetch" followed by unrelated whitespace and an unrelated later
// "(", which an earlier `\s*` between "fetch" and "(" happily matched
// across a comment's own prose. Real call sites in this codebase are
// always written with no space before the parenthesis (`fetch(url, ...)`),
// so requiring that exactly is what tells a call apart from a sentence.
const BARE_FETCH_CALL_PATTERN = /(?<![.\w$])fetch\(/;

// A dynamic `import(...)` call or a CommonJS `require(...)` call whose
// first argument is literally the string "node:fs" or "fs" — the two
// call forms `importsNodeFs`'s static-specifier scan cannot see (see this
// section's own header comment). Anchored on the call form for the
// identical reason `BARE_FETCH_CALL_PATTERN` is: this codebase's own
// prose and identifiers use "import" and "require" as ordinary words —
// `requireHost`, `requireSandboxRoot`, and error text like "resolve()
// requires 'host'..." all contain the substring "require" immediately
// followed by a letter, never by "(". No whitespace is permitted between
// the keyword and "(" for the same reason bare fetch requires none: real
// call sites in this codebase are always written with no space
// (`import("...")`, `require("...")`), so requiring that exactly is what
// tells a call apart from a sentence — and it is why `requireHost(`
// cannot match: the character after "require" there is "H", never "(".
// Whitespace *inside* the parens, before the opening quote, is tolerated
// (`import( "node:fs" )`), since nothing here needs to forbid that.
//
// The quote class covers all three JS string delimiters — `"`, `'`, and
// the backtick — not just the two ordinary-quote forms. A first version
// of this pattern omitted the backtick; the coordinator's own probe,
// ``await import(`node:fs`)`` (a template literal, no interpolation —
// valid, unremarkable JavaScript some codebases use uniformly, not an
// adversarial input), walked straight through it. Sabotage-verified
// separately from the double-quote case below, specifically so the
// backtick branch's own contribution could be seen rather than assumed
// to ride along with `"`/`'` (see the milestone report for both runs).
const DYNAMIC_FS_IMPORT_OR_REQUIRE_PATTERN = /(?<![.\w$])(?:import|require)\(\s*["'`](?:node:fs|fs)["'`]/;

// **What this sweep is, and is not, good for.** It is textual — a regex
// over each file's raw source, not a parse of any kind — so it catches
// the *accidental* reintroduction of I/O: a static import restored by a
// bad merge, a lazily-added `await import("node:fs")` reached for out of
// habit, a stray `require(...)` from copied CommonJS code. That is the
// actual risk this milestone's own history has produced (see this
// section's own header comment), and this sweep can be trusted for it.
// It is not, and cannot be, a defense against *deliberate* evasion: a
// computed specifier built at runtime (`import("node:" + "fs")`, a
// specifier assembled from an imported constant, `String.fromCharCode`
// tricks and the like), an unusual-but-legal whitespace form the anchor
// deliberately does not chase (`import ("node:fs")` — a space before the
// paren; declining to match it is a documented, deliberate limit, not an
// oversight — widening the anchor to catch it would also let it start
// matching `requireHost (` and this file's own prose, which is a worse
// trade), or a filesystem handle obtained through any indirection this
// pattern was never told to look for (a re-exported binding, a
// dependency that itself wraps `node:fs`, a global some other module
// attaches). `SPEC.md` Article VI calls the host boundary "structural
// rather than self-policed" — this test is the part of that claim that
// is actually true: it makes the boundary hard to cross *by accident*.
// It does not make the boundary impossible to cross on purpose, and nothing
// here should be read as claiming otherwise.

function importsNodeFs(filePath: string): boolean {
  return importSpecifiersOf(filePath).some((specifier) => NODE_FS_SPECIFIERS.has(specifier));
}

function callsBareFetch(filePath: string): boolean {
  const content = readFileSync(filePath, "utf-8");
  return BARE_FETCH_CALL_PATTERN.test(content);
}

function callsDynamicFsImportOrRequire(filePath: string): boolean {
  const content = readFileSync(filePath, "utf-8");
  return DYNAMIC_FS_IMPORT_OR_REQUIRE_PATTERN.test(content);
}

// --- v1.0 (009): the new stage's direction is one-way ---------------------
//
// `src/project/` is §3's last stage and may read `src/validate/` — the
// accumulated numeric demand is a *demand*, and reading one is validate's
// job (research.md D-3). The converse must never be true: validation that
// could see the value view would be a stage consuming a *later* stage's
// output, which is Principle IV's whole subject. Policed mechanically here
// rather than left to review, the same way every other direction in this
// file is.

const CROSSES_PROJECT_BOUNDARY = crossesBoundary("project");

describe("Principle IV: src/validate/ does not import src/project/ — the last stage is downstream of every other, never upstream", () => {
  const files = listTsFiles(join(REPO_ROOT, "src", "validate"));

  it("src/validate has files — a direction test over an empty directory passes vacuously", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const relativeFile = file.slice(REPO_ROOT.length + 1);
    it(`${relativeFile} does not import from src/project`, () => {
      expect(importSpecifiersOf(file).filter((specifier) => CROSSES_PROJECT_BOUNDARY.test(specifier))).toEqual([]);
    });
  }
});

// --- v1.1 (010): the emitter's direction is one-way too -------------------
//
// `src/generate/` reads `src/validate/` — a demand is what it accumulates,
// and reading one is validate's job (the type-expression parser, the
// per-layer resolver, and the numeric lattice all live there). The converse
// must never be true: validation that could see the emitter would be a
// stage consuming a *later* stage's output, which is Principle IV's whole
// subject. The identical rule v1.0 drew for `project/`, drawn again for the
// same reason rather than assumed to carry over.

const CROSSES_GENERATE_BOUNDARY = crossesBoundary("generate");

describe("Principle IV: src/validate/ does not import src/generate/ — the emitter is downstream of validation, never upstream", () => {
  const files = listTsFiles(join(REPO_ROOT, "src", "validate"));

  it("src/validate has files — a direction test over an empty directory passes vacuously", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const relativeFile = file.slice(REPO_ROOT.length + 1);
    it(`${relativeFile} does not import from src/generate`, () => {
      expect(importSpecifiersOf(file).filter((specifier) => CROSSES_GENERATE_BOUNDARY.test(specifier))).toEqual([]);
    });
  }
});

describe("Principle IV / Article VI: the host boundary — no import (static or dynamic) of node:fs, no require(...) of it, no call to fetch, except the shipped host", () => {
  const allSrcFiles = listTsFiles(join(REPO_ROOT, "src"));
  const policedFiles = allSrcFiles.filter((file) => file.slice(REPO_ROOT.length + 1) !== HOST_BOUNDARY_EXEMPTION);

  it(`the exemption (${HOST_BOUNDARY_EXEMPTION}) actually exists on disk — a boundary test naming a file that isn't there would pass vacuously`, () => {
    const exemptionPath = join(REPO_ROOT, ...HOST_BOUNDARY_EXEMPTION.split("/"));
    expect(allSrcFiles).toContain(exemptionPath);
  });

  for (const file of policedFiles) {
    const relativeFile = file.slice(REPO_ROOT.length + 1);
    it(`${relativeFile} does not import "node:fs"`, () => {
      expect(importsNodeFs(file), `${relativeFile} imports node:fs — only ${HOST_BOUNDARY_EXEMPTION} may`).toBe(false);
    });
    it(`${relativeFile} does not call fetch(...)`, () => {
      expect(callsBareFetch(file), `${relativeFile} calls fetch(...) — only ${HOST_BOUNDARY_EXEMPTION} may`).toBe(false);
    });
    it(`${relativeFile} does not dynamically import(...) or require(...) "node:fs"`, () => {
      expect(callsDynamicFsImportOrRequire(file), `${relativeFile} dynamically imports or requires node:fs — only ${HOST_BOUNDARY_EXEMPTION} may`).toBe(false);
    });
  }
});

// --- issue #1: the realm sweep — src/ loads where node does not ----------
//
// Gate 7 above polices *I/O* (`node:fs`, `fetch`): the library must not
// reach past the host seam to touch the world. This sweep polices
// something adjacent and narrower — the library must not reach past the
// seam for a **platform facility** either, because doing so makes it
// fail at *module evaluation* in any realm that is not node, before a
// line of Cascata code runs and with no partial mode to fall back to.
//
// Reported from outside (issue #1) by an embedder whose editing tools run
// the whole cascade inside a browser tab. Two sites were found:
// `node:crypto`'s `createHash` in `src/resolve/identity.ts` (now
// `src/resolve/sha256.ts`) and the `Buffer` global in
// `src/adapters/yaml/parse.ts` (now `utf8ByteLength` in
// `src/adapters/encoding.ts`). Neither was a rule violation — `CLAUDE.md`
// lists `node:crypto` among the permitted built-ins — which is exactly
// why nothing mechanical caught them, and why this sweep exists rather
// than a note asking reviewers to remember.
//
// **The exemption is the same one gate 7 names**, `src/host/node.ts`: a
// node host is entitled to be a node host, and an embedder in a browser
// supplies its own `Host` rather than importing that file. The check is
// therefore total over `src/` minus that one file, like gate 7's, rather
// than a directory list like the two boundary sweeps above.
//
// Additive: this touches no assertion already in this file.

// Any `node:`-prefixed specifier at all, not a list of known ones — a
// built-in nobody thought to enumerate is exactly the case that would
// slip through a list, and the whole point is that `node:crypto` was on
// the *permitted* list when it broke a realm. The bare-name forms of the
// same modules ("fs", "path", "crypto") are checked separately, since a
// bundler resolves those to the built-in too.
const NODE_BUILTIN_SPECIFIER_PATTERN = /^node:/;
const BARE_NODE_BUILTIN_SPECIFIERS: ReadonlySet<string> = new Set([
  "assert", "buffer", "child_process", "crypto", "dns", "events", "fs", "http", "https", "net",
  "os", "path", "process", "readline", "stream", "tls", "url", "util", "worker_threads", "zlib",
]);

// A *use* of a node-only global: `Buffer.…`, `process.…`, `__dirname`,
// `__filename`, `require(…)`. Anchored on the property access (or the
// call, for `require`) for the same reason gate 7's patterns are anchored
// on a call: this codebase's prose says "Buffer" and "process" as
// ordinary English words all over its comments ("Buffer for !!binary",
// "the parsing process"), and a bare-word match would fire on every one
// of them. `response.arrayBuffer()` and `ArrayBuffer` must not match
// either, which is what the leading `(?<![.\w$])` is for.
//
// This is textual, with exactly the limits gate 7's own header spells out
// at length: it catches the accidental reintroduction — a `Buffer.byteLength`
// reached for out of habit, a `process.env` read added while debugging —
// and it is not a defense against `globalThis["Buf" + "fer"]`. Nothing
// here claims otherwise.
//
// **Comments are stripped before this scan, and that is load-bearing.**
// Gate 7's patterns get away with scanning raw source because a call
// written `fetch(` cannot appear in this codebase's prose. `Buffer.` and
// `process.` can and do: `src/resolve/location.ts` explains itself in
// terms of "relative to `process.cwd()`", and the very function that
// replaced `Buffer.byteLength` documents what it replaced. A raw-source
// scan reported four failures on this repository the moment it was
// written, every one of them a sentence. Stripping first is what makes
// the sweep about code.
const NODE_GLOBAL_USE_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["Buffer", /(?<![.\w$])Buffer\s*\./],
  ["process", /(?<![.\w$])process\s*\./],
  ["__dirname", /(?<![.\w$])__dirname(?![\w$])/],
  ["__filename", /(?<![.\w$])__filename(?![\w$])/],
  ["require", /(?<![.\w$])require\(/],
];

/**
 * `source` with its comments removed and nothing else changed — string
 * and template literals are walked through rather than scanned, so a
 * `"https://…"` inside one is not mistaken for the start of a line
 * comment (which would silently swallow the rest of a real line and turn
 * this sweep into one that reports less than it appears to). Regex
 * literals are not tracked: a `/` that begins one is treated as
 * division, which cannot hide code from the patterns above — the worst
 * it can do is leave a comment's text in place, i.e. a false positive,
 * which is the direction a boundary test should fail in.
 */
function stripComments(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      out += char;
      index += 1;
      while (index < source.length) {
        const inner = source[index];
        out += inner;
        index += 1;
        if (inner === "\\") {
          out += source[index] ?? "";
          index += 1;
          continue;
        }
        if (inner === quote) {
          break;
        }
      }
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

function importsNodeBuiltin(filePath: string): string[] {
  return importSpecifiersOf(filePath).filter(
    (specifier) => NODE_BUILTIN_SPECIFIER_PATTERN.test(specifier) || BARE_NODE_BUILTIN_SPECIFIERS.has(specifier),
  );
}

// The dynamic/`require` twin of the above, for the same reason gate 7
// needed one: a static-specifier scan cannot see `await import("node:crypto")`.
const DYNAMIC_NODE_BUILTIN_PATTERN = /(?<![.\w$])(?:import|require)\(\s*["'`](?:node:[a-z_/]+|assert|buffer|child_process|crypto|dns|events|fs|http|https|net|os|path|process|readline|stream|tls|url|util|worker_threads|zlib)["'`]/;

describe("issue #1 / Article VI: src/ evaluates in a realm that is not node — no node built-in, no node-only global, except the shipped host", () => {
  const allSrcFiles = listTsFiles(join(REPO_ROOT, "src"));
  const policedFiles = allSrcFiles.filter((file) => file.slice(REPO_ROOT.length + 1) !== HOST_BOUNDARY_EXEMPTION);

  it("polices more than one file — a sweep whose exemption swallowed everything would pass vacuously", () => {
    expect(policedFiles.length).toBeGreaterThan(1);
  });

  it(`the one node-only file (${HOST_BOUNDARY_EXEMPTION}) does import a node built-in — otherwise this exemption is guarding nothing and the sweep proves less than it appears to`, () => {
    const exemptionPath = join(REPO_ROOT, ...HOST_BOUNDARY_EXEMPTION.split("/"));
    expect(importsNodeBuiltin(exemptionPath).length).toBeGreaterThan(0);
  });

  for (const file of policedFiles) {
    const relativeFile = file.slice(REPO_ROOT.length + 1);
    it(`${relativeFile} imports no node built-in`, () => {
      expect(
        importsNodeBuiltin(file),
        `${relativeFile} imports a node built-in — only ${HOST_BOUNDARY_EXEMPTION} may; a bare "node:" import fails at module evaluation in a browser realm`,
      ).toEqual([]);
    });

    it(`${relativeFile} does not dynamically import(...) or require(...) a node built-in`, () => {
      const content = stripComments(readFileSync(file, "utf-8"));
      expect(DYNAMIC_NODE_BUILTIN_PATTERN.test(content), `${relativeFile} reaches a node built-in through import(...) or require(...)`).toBe(false);
    });

    for (const [name, pattern] of NODE_GLOBAL_USE_PATTERNS) {
      it(`${relativeFile} does not use the node-only global \`${name}\``, () => {
        const content = stripComments(readFileSync(file, "utf-8"));
        expect(pattern.test(content), `${relativeFile} uses \`${name}\`, which does not exist in a browser realm`).toBe(false);
      });
    }
  }
});
