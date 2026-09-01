/**
 * The soundness oracle's two instruments — v1.1 (010) FR-034, FR-038;
 * specs/010-type-generator/contracts/soundness-oracle.md §1 rows 2–3 and §2.
 *
 * **Test harness, not library.** `typescript` is a devDependency and is
 * invoked here, in memory, with nothing written to disk (FR-038). Nothing
 * under `src/` imports it, and nothing under `src/` may: the emitter is a
 * string printer, and the compiler is how this suite *checks* the printer,
 * not how the printer works.
 *
 * Two things live here because both are needed before either is used:
 *
 * - `compileInMemory` — `ts.createProgram` over one in-memory file, under
 *   the settings a consumer of the emitted `.d.ts` would use (`strict`,
 *   `lib: ["lib.es2022.d.ts"]`, `noEmit`). Every shape and leaf case in
 *   this milestone runs its hand-written expected text through it, so an
 *   expectation that is not valid TypeScript fails loudly rather than
 *   sitting in a string comparison forever.
 * - `toLiteral` — a `ConfigValue` written as TypeScript source. The oracle
 *   typechecks a **literal**, not a runtime value, for two reasons: a
 *   projected `bigint` has no JSON form, and TypeScript's excess-property
 *   check — which is what makes `seal: closed` testable at all — fires on
 *   object literals only (research F-3).
 *
 * **The lib's parsed source files are shared across calls**, which is the
 * difference between a corpus sweep that takes a second and one that takes
 * a minute: `createProgram` re-parses `lib.es2022.d.ts` and everything it
 * references on every call otherwise, and that parse dwarfs the work of
 * checking one small file.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";
import type { ConfigValue } from "../../src/project/value.js";
import { compareByCodePoint } from "../../src/model/node.js";

const MAIN_FILE = "/generated.ts";
const DEFAULT_LIB = "lib.es2022.d.ts";
const LIB_DIR = dirname(createRequire(import.meta.url).resolve("typescript"));

const COMPILER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  lib: [DEFAULT_LIB],
  types: [],
  moduleDetection: ts.ModuleDetectionKind.Force,
  skipLibCheck: true,
};

/** Parsed lib files, kept for the life of the process — see this module's doc. */
const libCache = new Map<string, ts.SourceFile | undefined>();

function libSourceFile(fileName: string): ts.SourceFile | undefined {
  const bare = fileName.startsWith("/") ? fileName.slice(1) : fileName;
  if (libCache.has(bare)) {
    return libCache.get(bare);
  }
  let parsed: ts.SourceFile | undefined;
  try {
    parsed = ts.createSourceFile(bare, readFileSync(join(LIB_DIR, bare), "utf-8"), ts.ScriptTarget.ES2022, false, ts.ScriptKind.TS);
  } catch {
    parsed = undefined;
  }
  libCache.set(bare, parsed);
  return parsed;
}

/** One rendered compiler complaint: the message, and where in the source it sits. */
export interface CompileProblem {
  readonly message: string;
  readonly line: number;
  readonly code: number;
}

/** Typecheck `source` as a standalone module. An empty result is a clean compile. */
export function compileInMemory(source: string): readonly CompileProblem[] {
  const main = ts.createSourceFile(MAIN_FILE, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const host: ts.CompilerHost = {
    getSourceFile: (fileName) => (fileName === MAIN_FILE ? main : libSourceFile(fileName)),
    getDefaultLibFileName: () => DEFAULT_LIB,
    writeFile: () => undefined,
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (fileName) => fileName === MAIN_FILE || libSourceFile(fileName) !== undefined,
    readFile: (fileName) => (fileName === MAIN_FILE ? source : libSourceFile(fileName)?.text),
  };
  const program = ts.createProgram([MAIN_FILE], COMPILER_OPTIONS, host);
  const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics(), ...program.getGlobalDiagnostics()];
  return diagnostics.map((diagnostic) => ({
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    line: diagnostic.file !== undefined && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : 0,
    code: diagnostic.code,
  }));
}

/** `compileInMemory`'s problems as one message, for an assertion's failure text. */
export function renderProblems(problems: readonly CompileProblem[]): string {
  return problems.map((problem) => `TS${problem.code} at line ${problem.line}: ${problem.message}`).join("\n");
}

/**
 * A `ConfigValue` as TypeScript source (contract §2).
 *
 * Every mapping key is quoted and every mapping is written in §4.2's
 * canonical order. Quoting unconditionally is what makes `__proto__` and
 * `constructor` ordinary property names in the literal, exactly as
 * `project()`'s null-prototype object makes them ordinary own properties;
 * sorting is what makes the text a function of the value rather than of
 * ECMA-262's own enumeration order, which hoists array-index keys.
 *
 * `undefined` is never written: an absent key is an absent property (§17),
 * so the emitted `?` means the same thing whether or not a consumer enables
 * `exactOptionalPropertyTypes` (research F-3).
 */
export function toLiteral(value: ConfigValue): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value === "number") {
    // `String(-0)` is `"0"`, which is a different literal type and, more to
    // the point, a different number. The sign has to be put back by hand.
    return Object.is(value, -0) ? "-0" : String(value);
  }
  if (typeof value === "boolean" || value === null) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(toLiteral).join(", ")}]`;
  }
  const entries = Object.keys(value)
    .sort(compareByCodePoint)
    .map((key) => `${JSON.stringify(key)}: ${toLiteral((value as { readonly [key: string]: ConfigValue })[key] ?? null)}`);
  return `{ ${entries.join(", ")} }`;
}
