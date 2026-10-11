/**
 * The resolution-conformance case format — User Story 2 (tasks.md
 * T019-T023) and beyond.
 *
 * `tests/corpus/case.ts`/`runner.ts` (v0.1) assert one parsed tree against
 * one expected shape, for a single document. Resolution is a genuinely
 * different kind of case: it spans several files on disk, needs a
 * `sandboxRoot`, and its expected outcome is a *graph* and an ordered
 * *pedigree*, not a tree. Retrofitting the v0.1 format would have meant
 * bending `ExpectedNode`/`Expect` into shapes they were never designed
 * for; a sibling format, sharing the same design values (data over code,
 * hand-derived expected values, one case = one file), is cleaner.
 *
 * **Why this lives outside `tests/corpus/cases/`'s JSON sweep**: v0.1's
 * `discoverCaseFiles` (`runner.ts`) recursively matches every `*.json`
 * under `tests/corpus/cases/` and feeds it to the *parse*-conformance
 * loader (`case.ts`'s `loadCase`), which requires `format`/`input`/
 * `expect: {tree|diagnostics|equalTo}` — fields a resolution case does not
 * have. Placing a resolution case's JSON descriptor inside that directory
 * tree would make the v0.1 corpus runner try to load it as a parse case
 * and fail (or, worse, silently pass by accident). tasks.md's paths
 * ("in tests/corpus/cases/chain-local/", etc.) are honored for the
 * *fixture documents* — the actual `.yaml` files a chain resolves through,
 * which the v0.1 sweep ignores (it only matches `.json`) — while each
 * case's JSON *descriptor* (expected outcome) lives in the sibling
 * `tests/corpus/resolve-cases/` directory this file's loader reads,
 * keeping the two discovery sweeps disjoint by construction.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DiagnosticCode } from "../../src/diagnostics/codes.js";
import { isDiagnosticCode } from "../../src/diagnostics/codes.js";

/** A span assertion anchored to a fixture file rather than to `pointer` into one already-parsed tree (case.ts's `ExpectedSpan`) — resolution spans live in *different documents*, so each assertion names its own document explicitly. */
export interface ExpectedResolveSpan {
  /** Path of the document this position is in, relative to the case's fixture directory. */
  readonly document: string;
  readonly line: number;
  readonly column: number;
  readonly start?: number;
  readonly end?: number;
}

export type ExpectedReferenceKind = "schema" | "adopts";
export type ExpectedReferenceAuthority = "config-authored" | "schema-authored";

/** One expected pedigree entry (data-model.md "Pedigree"), root-to-leaf order matching array order. */
export interface ExpectedPedigreeEntry {
  /** The schema document's location, relative to the case's fixture directory. */
  readonly location: string;
  /** SHA-256 hex of that document's exact bytes (research D1/D2) — hand-derived via `shasum -a 256`, never copied from a test run. */
  readonly hash: string;
  readonly kind: ExpectedReferenceKind;
  readonly authority: ExpectedReferenceAuthority;
  /** Where the reference that brought this entry in was written. */
  readonly via: ExpectedResolveSpan;
  /** Whether this entry was hash-verified. Always `false` in this slice — v0.2 US2 does not wire up local `$pin` verification (see report). */
  readonly verified: boolean;
}

/** One expected document in the resolved graph, identity only — `location` relative to the fixture directory. */
export interface ExpectedGraphDocument {
  readonly location: string;
  readonly hash: string;
}

export interface ExpectedRelatedResolveSpan extends ExpectedResolveSpan {
  readonly label?: string;
}

/** One expected diagnostic from a failed resolution. */
export interface ExpectedResolveDiagnostic {
  readonly code: DiagnosticCode;
  readonly primary: ExpectedResolveSpan;
  readonly related?: readonly ExpectedRelatedResolveSpan[];
}

export type ResolveExpect =
  | { readonly ok: true; readonly graph: readonly ExpectedGraphDocument[]; readonly pedigree: readonly ExpectedPedigreeEntry[]; readonly overrides?: readonly ExpectedGraphDocument[] }
  | { readonly ok: false; readonly diagnostics: readonly ExpectedResolveDiagnostic[] };

/** One resolution-conformance case. */
export interface ResolveCase {
  readonly name: string;
  /** The `SPEC.md`/spec.md section or FR this case is the oracle for, e.g. `"v0.2 FR-006"`. */
  readonly cites: string;
  /** Absolute path to the directory holding this case's fixture `.yaml` documents. */
  readonly fixtureDir: string;
  /** Entry document path, relative to `fixtureDir`. */
  readonly entry: string;
  /** Sandbox root, relative to `fixtureDir` (not enforced in this slice — see report; required per contracts/resolve-api.md regardless). */
  readonly sandboxRoot: string;
  /**
   * Optional: a directory, relative to `fixtureDir`, that the runner
   * points `$HOME` at for the duration of this case's `resolve()` call
   * (T024, v0.2 FR-029 — tilde expansion). `os.homedir()` honors `$HOME`
   * on POSIX, so this lets a case exercise a config-authored `~/…`
   * reference against a **fixture** directory rather than the real
   * user's home. Absent for every case that doesn't touch `~/`.
   */
  readonly homeDir?: string;
  /**
   * Optional: overrides `resolve()`'s `maxChainLength` (default 32,
   * contracts/resolve-api.md's "Limits" table) for this case. Lets
   * `chain-limit-exceeded` (T056, v0.2 FR-010) be exercised against a
   * small, hand-writable fixture chain rather than 33+ files authored
   * just to reach the production default.
   */
  readonly maxChainLength?: number;
  /**
   * Optional: `resolve()`'s `schema` option (v1.3 FR-001) — the launching
   * schema consulted only when the entry names no `$schema`. Passed
   * verbatim: it is read as if the entry had written `$schema: <schema>`,
   * so a relative text resolves against the entry document's directory
   * and a leading `~/` expands (the case sets `homeDir` for that).
   */
  readonly schema?: string;
  /**
   * Optional: the host namespace this case runs against (v1.4 FR-001) —
   * a map from a scheme'd reference text (`"beltype:document"`) to the
   * fixture-relative path the host locates it at. The runner wraps
   * `createNodeHost()` with a `locate` backed by exactly this map, so a
   * case can exercise a namespace the shipped host does not have without
   * either inventing a second host format or letting the namespace leak
   * between cases. Absent for every case that names no scheme.
   */
  readonly identities?: Readonly<Record<string, string>>;
  /**
   * Optional: `resolve()`'s `overrides` option (v1.6 FR-001) — config
   * documents the embedder names, read after the entry's chain and ranked
   * after it in this order. Passed verbatim: each text is read as a
   * config-authored reference from the entry document, so a relative text
   * resolves against the entry's directory and a scheme'd one goes to the
   * case's `identities`. A successful case asserts them under
   * `expect.overrides`, in order; absent there, none is expected.
   */
  readonly overrides?: readonly string[];
  readonly expect: ResolveExpect;
}

/** Parse a case's optional `identities` map (v1.4 FR-001) into a plain string-to-string record, refusing anything else. Built entry by entry rather than asserted, so the loader's own type is earned the way every other field's is. */
function parseIdentities(raw: unknown, source: string): Readonly<Record<string, string>> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isPlainObject(raw)) {
    fail(source, `'identities' must be an object if present`);
  }
  const identities: Record<string, string> = {};
  for (const [reference, location] of Object.entries(raw)) {
    if (typeof location !== "string") {
      fail(source, `'identities.${reference}' must be a string, got ${JSON.stringify(location)}`);
    }
    identities[reference] = location;
  }
  return identities;
}

function fail(source: string, reason: string): never {
  throw new Error(`Resolve conformance case at '${source}' cannot be interpreted: ${reason}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(raw: Record<string, unknown>, field: string, source: string, at: string): string {
  const value = raw[field];
  if (typeof value !== "string") {
    fail(source, `'${at}' needs a string '${field}', got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireNumber(raw: Record<string, unknown>, field: string, source: string, at: string): number {
  const value = raw[field];
  if (typeof value !== "number") {
    fail(source, `'${at}' needs a numeric '${field}', got ${JSON.stringify(value)}`);
  }
  return value;
}

function parseSpan(raw: unknown, source: string, at: string): ExpectedResolveSpan {
  if (!isPlainObject(raw)) {
    fail(source, `'${at}' must be an object`);
  }
  const document = requireString(raw, "document", source, at);
  const line = requireNumber(raw, "line", source, at);
  const column = requireNumber(raw, "column", source, at);
  const start = raw["start"];
  const end = raw["end"];
  if (start !== undefined && typeof start !== "number") {
    fail(source, `'${at}.start' must be a number if present`);
  }
  if (end !== undefined && typeof end !== "number") {
    fail(source, `'${at}.end' must be a number if present`);
  }
  return { document, line, column, ...(typeof start === "number" ? { start } : {}), ...(typeof end === "number" ? { end } : {}) };
}

function parseRelatedSpan(raw: unknown, source: string, at: string): ExpectedRelatedResolveSpan {
  const span = parseSpan(raw, source, at);
  const label = isPlainObject(raw) ? raw["label"] : undefined;
  if (label !== undefined && typeof label !== "string") {
    fail(source, `'${at}.label' must be a string if present`);
  }
  return { ...span, ...(typeof label === "string" ? { label } : {}) };
}

function parseKind(raw: unknown, source: string, at: string): ExpectedReferenceKind {
  if (raw !== "schema" && raw !== "adopts") {
    fail(source, `'${at}' must be "schema" or "adopts", got ${JSON.stringify(raw)}`);
  }
  return raw;
}

function parseAuthority(raw: unknown, source: string, at: string): ExpectedReferenceAuthority {
  if (raw !== "config-authored" && raw !== "schema-authored") {
    fail(source, `'${at}' must be "config-authored" or "schema-authored", got ${JSON.stringify(raw)}`);
  }
  return raw;
}

function parsePedigreeEntry(raw: unknown, source: string, at: string): ExpectedPedigreeEntry {
  if (!isPlainObject(raw)) {
    fail(source, `'${at}' must be an object`);
  }
  const location = requireString(raw, "location", source, at);
  const hash = requireString(raw, "hash", source, at);
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    fail(source, `'${at}.hash' must be 64 lowercase hex characters, got ${JSON.stringify(hash)}`);
  }
  const kind = parseKind(raw["kind"], source, `${at}.kind`);
  const authority = parseAuthority(raw["authority"], source, `${at}.authority`);
  const via = parseSpan(raw["via"], source, `${at}.via`);
  const verified = raw["verified"];
  if (typeof verified !== "boolean") {
    fail(source, `'${at}.verified' must be a boolean`);
  }
  return { location, hash, kind, authority, via, verified };
}

function parseGraphDocument(raw: unknown, source: string, at: string): ExpectedGraphDocument {
  if (!isPlainObject(raw)) {
    fail(source, `'${at}' must be an object`);
  }
  const location = requireString(raw, "location", source, at);
  const hash = requireString(raw, "hash", source, at);
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    fail(source, `'${at}.hash' must be 64 lowercase hex characters, got ${JSON.stringify(hash)}`);
  }
  return { location, hash };
}

function parseDiagnostic(raw: unknown, source: string, at: string): ExpectedResolveDiagnostic {
  if (!isPlainObject(raw)) {
    fail(source, `'${at}' must be an object`);
  }
  const codeRaw = raw["code"];
  if (typeof codeRaw !== "string" || !isDiagnosticCode(codeRaw)) {
    fail(source, `'${at}.code' must be a known DiagnosticCode, got ${JSON.stringify(codeRaw)}`);
  }
  const primary = parseSpan(raw["primary"], source, `${at}.primary`);
  const relatedRaw = raw["related"];
  let related: ExpectedRelatedResolveSpan[] | undefined;
  if (relatedRaw !== undefined) {
    if (!Array.isArray(relatedRaw)) {
      fail(source, `'${at}.related' must be an array if present`);
    }
    related = relatedRaw.map((item, index) => parseRelatedSpan(item, source, `${at}.related[${index}]`));
  }
  return { code: codeRaw, primary, ...(related !== undefined ? { related } : {}) };
}

function parseExpect(raw: unknown, source: string): ResolveExpect {
  if (!isPlainObject(raw)) {
    fail(source, `'expect' must be an object`);
  }
  const ok = raw["ok"];
  if (ok === true) {
    const graphRaw = raw["graph"];
    const pedigreeRaw = raw["pedigree"];
    if (!Array.isArray(graphRaw)) {
      fail(source, `'expect.graph' must be an array when ok is true`);
    }
    if (!Array.isArray(pedigreeRaw)) {
      fail(source, `'expect.pedigree' must be an array when ok is true`);
    }
    const overridesRaw = raw["overrides"];
    if (overridesRaw !== undefined && !Array.isArray(overridesRaw)) {
      fail(source, `'expect.overrides' must be an array if present`);
    }
    return {
      ok: true,
      graph: graphRaw.map((item, index) => parseGraphDocument(item, source, `expect.graph[${index}]`)),
      pedigree: pedigreeRaw.map((item, index) => parsePedigreeEntry(item, source, `expect.pedigree[${index}]`)),
      ...(Array.isArray(overridesRaw) ? { overrides: overridesRaw.map((item, index) => parseGraphDocument(item, source, `expect.overrides[${index}]`)) } : {}),
    };
  }
  if (ok === false) {
    const diagnosticsRaw = raw["diagnostics"];
    if (!Array.isArray(diagnosticsRaw) || diagnosticsRaw.length === 0) {
      fail(source, `'expect.diagnostics' must be a non-empty array when ok is false`);
    }
    return {
      ok: false,
      diagnostics: diagnosticsRaw.map((item, index) => parseDiagnostic(item, source, `expect.diagnostics[${index}]`)),
    };
  }
  fail(source, `'expect.ok' must be true or false`);
}

const CITES_PATTERN = /^v(0\.2|1\.3|1\.4|1\.6|1\.7|1\.13) FR-\d+$/;

/** Load and validate one resolve-conformance case from `file`. `fixtureDir` resolves relative to `file`'s directory, per each case's own `fixtureDir` field. */
export function loadResolveCase(file: string): ResolveCase {
  const raw: unknown = JSON.parse(readFileSync(file, "utf-8"));
  if (!isPlainObject(raw)) {
    fail(file, "top level must be an object");
  }
  const name = requireString(raw, "name", file, "$");
  const cites = requireString(raw, "cites", file, "$");
  if (!CITES_PATTERN.test(cites)) {
    fail(file, `'cites' must look like "v0.2 FR-006", got ${JSON.stringify(cites)}`);
  }
  const fixtureDirField = requireString(raw, "fixtureDir", file, "$");
  const entry = requireString(raw, "entry", file, "$");
  const sandboxRoot = requireString(raw, "sandboxRoot", file, "$");
  const homeDirRaw = raw["homeDir"];
  if (homeDirRaw !== undefined && typeof homeDirRaw !== "string") {
    fail(file, `'homeDir' must be a string if present, got ${JSON.stringify(homeDirRaw)}`);
  }
  const schemaRaw = raw["schema"];
  if (schemaRaw !== undefined && typeof schemaRaw !== "string") {
    fail(file, `'schema' must be a string if present, got ${JSON.stringify(schemaRaw)}`);
  }
  const identities = parseIdentities(raw["identities"], file);
  const overridesRaw = raw["overrides"];
  if (overridesRaw !== undefined && (!Array.isArray(overridesRaw) || !overridesRaw.every((item) => typeof item === "string"))) {
    fail(file, `'overrides' must be an array of strings if present, got ${JSON.stringify(overridesRaw)}`);
  }
  const maxChainLengthRaw = raw["maxChainLength"];
  if (maxChainLengthRaw !== undefined && (typeof maxChainLengthRaw !== "number" || !Number.isInteger(maxChainLengthRaw))) {
    fail(file, `'maxChainLength' must be an integer if present, got ${JSON.stringify(maxChainLengthRaw)}`);
  }
  const expect = parseExpect(raw["expect"], file);
  const fixtureDir = join(dirname(file), "..", "cases", fixtureDirField);
  return {
    name,
    cites,
    fixtureDir,
    entry,
    sandboxRoot,
    expect,
    ...(typeof homeDirRaw === "string" ? { homeDir: homeDirRaw } : {}),
    ...(typeof maxChainLengthRaw === "number" ? { maxChainLength: maxChainLengthRaw } : {}),
    ...(typeof schemaRaw === "string" ? { schema: schemaRaw } : {}),
    ...(identities !== undefined ? { identities } : {}),
    ...(Array.isArray(overridesRaw) ? { overrides: overridesRaw.filter((item): item is string => typeof item === "string") } : {}),
  };
}
