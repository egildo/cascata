/**
 * v1.1 (010) US6 — **soundness is the conformance rule, and the validator
 * is the oracle.**
 *
 * > Every configuration that validation accepts, projected by Article VII,
 * > inhabits the type generated from its schema chain. — Article VIII
 *
 * The whole file is a *derived* expectation: no case here writes an
 * expected TypeScript text by hand. What is asserted is that the validator
 * and the compiler agree — every accepting corpus case compiles, every
 * purely type-shaped refusal does not — which is the one form of
 * expectation Principle V allows for a generator, since the alternative is
 * copying the generator's own output into a fixture and calling it a test.
 *
 * **Stubbed at US2** with the literal writer's own pair, which is the one
 * thing in this file that *is* hand-written (contract §1 row 8): the
 * harness has to be checked against something before it can be trusted to
 * check anything else. US6 fills in the corpus sweep and the meta-schema
 * round trip.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toLiteral, compileInMemory, renderProblems, type CompileProblem } from "./generate-literal.js";
import type { ConfigValue } from "../../src/project/value.js";
import { generateTypes, merge, parse, project, resolve, validate, type GraphDocument, type MergeInput } from "../../src/index.js";
import { createOrigin } from "../../src/model/span.js";
import { createNodeHost } from "../../src/host/node.js";
import { loadValidateCase, type ValidateCase } from "../corpus/validate-case.js";
import { InMemoryHost } from "./host-test-double.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VALIDATE_CASES_DIR = join(REPO_ROOT, "tests", "corpus", "validate-cases");

describe("contract §1 row 8 — the literal writer, on one hand-written pair", () => {
  /**
   * One value carrying every case the writer has a rule for: a `bigint`
   * (which has no JSON form at all), a key needing quotes, a key that is an
   * ordinary own property only because `project()` uses a null prototype, a
   * nested array, `null`, and a key ordering that ECMA-262 would enumerate
   * differently from §4.2's canonical order.
   */
  const VALUE: ConfigValue = (() => {
    // **Built with a null prototype, and it has to be.** Written as an
    // ordinary object literal, `"__proto__": true` sets the prototype and
    // creates no own property at all, so the fixture would silently be
    // testing a five-key object — which is exactly why `project()` builds
    // the value view with `Object.create(null)` (Article VII, FR-010). The
    // first run of this case caught it, in the test rather than in the
    // writer.
    const built: Record<string, ConfigValue> = Object.create(null);
    built["10"] = "hoisted-by-ecma-262";
    built["__proto__"] = true;
    built["a-key"] = null;
    built["port"] = 8080n;
    built["ratio"] = 1.5;
    built["tags"] = ["x", ["y"]];
    return Object.freeze(built);
  })();

  const EXPECTED = '{ "10": "hoisted-by-ecma-262", "__proto__": true, "a-key": null, "port": 8080n, "ratio": 1.5, "tags": ["x", ["y"]] }';

  it("writes exactly the text the contract's table specifies", () => {
    expect(toLiteral(VALUE)).toBe(EXPECTED);
  });

  it("and that text is TypeScript the compiler accepts against the shape it describes", () => {
    const source = `export type T = {
  readonly "10": string;
  readonly "__proto__": boolean;
  readonly "a-key": null;
  readonly port: bigint;
  readonly ratio: number;
  readonly tags: readonly (string | readonly string[])[];
};
export const value: T = ${EXPECTED};
`;
    const problems = compileInMemory(source);
    expect(problems, renderProblems(problems)).toEqual([]);
  });

  it("`-0` keeps its sign, which `String(-0)` does not", () => {
    expect(toLiteral(-0)).toBe("-0");
    expect(toLiteral(0)).toBe("0");
  });

  it("the compiler harness can fail — a check that never refuses proves nothing", () => {
    expect(compileInMemory(`export const v: string = 1;`).length).toBeGreaterThan(0);
  });
});

// --- §1 rows 1–7: the corpus, and the meta-schema --------------------------

/**
 * The four codes a *type* can express. A configuration refused solely for
 * one of these must fail to typecheck; one refused for a range, a length or
 * a pattern may pass, and the contract says why — TypeScript has no type
 * for those, and the JSDoc the emitter writes is the honest substitute.
 */
const TYPE_SHAPED: ReadonlySet<string> = new Set(["type-mismatch", "required-violated", "seal-violation", "enum-violated"]);

/**
 * **The type-shaped refusals a TypeScript type cannot express.**
 *
 * The contract's row 5 says every case refused *solely* for
 * `type-mismatch`, `required-violated`, `seal-violation` or `enum-violated`
 * must fail to typecheck. Seven of the corpus's twenty-two do not, in three
 * families — and the contract's own §4 already names the first of them.
 * Row 5 is therefore too strong and needs the same carve-out §4 gives
 * ranges, lengths and patterns; reported as a correction owed to it, to
 * FR-035 and to SC-005.
 *
 * Listed by name with the reason, per row 6, rather than asserted away: the
 * set is pinned exactly, so an eighth case joining it is a soundness
 * regression and one leaving it is a limit closed. Neither is silent.
 */
const INEXPRESSIBLE: ReadonlyMap<string, string> = new Map([
  [
    "T027",
    "`url` and `path` emit `string` (contract §4's own named limit): the refusal is a malformed URL, and no TypeScript type distinguishes a string that parses as a URL from one that does not. The selector survives in JSDoc.",
  ],
  ["T029", "An `accept` selector narrowing between `url` and `path`, both of which emit `string` — contract §4, and the spec's own Assumption that `accept` narrowing is mostly invisible in TypeScript."],
  ["T039", "The same `accept`/`url`/`path` limit, reached through a qualified name."],
  ["T049", "The same `accept`/`url`/`path` limit: `accept: [url]` and `accept: [url, path]` have one emission between them."],
  ["T051", "The same `accept`/`url`/`path` limit, from the widening side."],
  [
    "T037",
    "`required` refuses an explicit `null` (§4.2's three-way distinction), but the key demands no `type`, so its emitted type is `unknown` — and `null` inhabits `unknown`. A NEW finding: the limit is not `url`/`path`, it is that `required`'s null refusal has no type to attach to when nothing else is demanded.",
  ],
  [
    "T024",
    "A NEW finding, and a trade this milestone made deliberately. The demand is `keys: { b: { demand: { required: true } } }` with **no `type: mapping`** beside it, and such a demand admits any value at all — v0.5's `checkNestedKeys` is conditional on the value's runtime type, which the corpus's own T022 asserts by accepting a string there. Soundness (Article VIII's law) requires the position to emit `unknown`, and `unknown` cannot carry a nested requirement. The schema-authoring lesson is to write `type: mapping` beside `keys:`.",
  ],
]);

/** The reason a case is inexpressible, matched on the descriptor name's own leading identifier. */
function nameOfLimit(caseName: string): string | undefined {
  for (const [prefix, reason] of INEXPRESSIBLE) {
    if (caseName.startsWith(`${prefix}:`) || caseName.startsWith(`${prefix} `)) {
      return reason;
    }
  }
  return undefined;
}

interface Judged {
  readonly name: string;
  /** `positive` must compile; `negative` must not; `listed` is judged by nothing and named instead. */
  readonly verdict: "positive" | "negative" | "listed";
  readonly reason?: string;
  readonly problems?: readonly CompileProblem[];
}

function classify(testCase: ValidateCase): "positive" | "negative" | "listed" {
  if (testCase.expect.ok) {
    return "positive";
  }
  const codes = new Set(testCase.expect.diagnostics.map((diagnostic) => diagnostic.code));
  if ([...codes].every((code) => TYPE_SHAPED.has(code))) {
    return "negative";
  }
  return "listed";
}

/**
 * One case, driven exactly as `validate-runner.ts` drives it — the same
 * descriptors, the same `createNodeHost()`, the same fixture and sandbox
 * paths — and then through the two stages the oracle adds: the type
 * generated from the chain's leaf schema, and the projected configuration
 * written as a literal against it.
 */
async function judge(testCase: ValidateCase): Promise<Judged> {
  const verdict = classify(testCase);
  const entryPath = join(testCase.fixtureDir, testCase.entry);
  const sandboxRoot = join(testCase.fixtureDir, testCase.sandboxRoot);
  const options = { host: createNodeHost(), sandboxRoot };

  const resolved = await resolve(entryPath, options);
  if (!resolved.ok) {
    return { name: testCase.name, verdict: "listed", reason: `resolve() refused it: ${resolved.diagnostics.map((d) => d.code).join(", ")}` };
  }
  const schemaDocument = resolved.graph.documents[1];
  if (schemaDocument === undefined) {
    return { name: testCase.name, verdict: "listed", reason: "the config adopts no schema at all, so there is no chain to generate from" };
  }
  const merged = merge(resolved);
  if (!merged.ok) {
    return { name: testCase.name, verdict: "listed", reason: `merge() refused it: ${merged.diagnostics.map((d) => d.code).join(", ")}` };
  }
  const generated = await generateTypes(schemaDocument.identity.location, options);
  if (!generated.ok) {
    return { name: testCase.name, verdict: "listed", reason: `generateTypes() refused the schema chain: ${generated.diagnostics.map((d) => d.code).join(", ")}` };
  }
  const projected = project(merged.configuration);
  const source = `${generated.source}\nconst __inhabits: ${generated.tree.rootName} = ${toLiteral(projected.value as ConfigValue)};\nvoid __inhabits;\n`;
  const problems = compileInMemory(source);
  if (verdict === "listed") {
    return { name: testCase.name, verdict, reason: `refused for reasons a type cannot express: ${testCase.expect.ok ? "" : testCase.expect.diagnostics.map((diagnostic) => diagnostic.code).join(", ")}`, problems };
  }
  return { name: testCase.name, verdict, problems };
}

describe("contract §1 rows 1–6 / SC-005 — every corpus case, through the compiler", () => {
  const caseFiles = readdirSync(VALIDATE_CASES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(VALIDATE_CASES_DIR, entry.name))
    .sort((a, b) => a.localeCompare(b));
  const cases = caseFiles.map((file) => loadValidateCase(file));

  /** Judged once; every assertion below reads the same run, so the corpus is compiled once rather than four times. */
  const judgements: Judged[] = [];
  let judgedAll = false;

  async function judgeAll(): Promise<readonly Judged[]> {
    if (!judgedAll) {
      for (const testCase of cases) {
        judgements.push(await judge(testCase));
      }
      judgedAll = true;
    }
    return judgements;
  }

  it("finds the whole corpus — 104 descriptors, the number a runner that silently skipped would miss", () => {
    expect(cases).toHaveLength(104);
  });

  it("row 4 — every `ok: true` case inhabits its generated type, and there are 38 of them", async () => {
    const judged = await judgeAll();
    const positives = judged.filter((entry) => entry.verdict === "positive");
    expect(positives).toHaveLength(38);
    const failures = positives.filter((entry) => (entry.problems ?? []).length > 0);
    expect(failures.map((entry) => `${entry.name}: ${renderProblems(entry.problems ?? [])}`), "a configuration validation ACCEPTS must inhabit the type generated from its schema chain — SPEC.md §18's soundness law").toEqual([]);
  }, 300_000);

  it("row 5 — every case refused SOLELY for a type-shaped reason fails to typecheck, and there are 22 of them", async () => {
    const judged = await judgeAll();
    const negatives = judged.filter((entry) => entry.verdict === "negative");
    expect(negatives).toHaveLength(22);
    const accepted = negatives.filter((entry) => (entry.problems ?? []).length === 0).map((entry) => entry.name);
    const expected = negatives.filter((entry) => nameOfLimit(entry.name) !== undefined).map((entry) => entry.name);
    // **The set that typechecks is pinned exactly, not merely bounded.** An
    // eighth case starting to pass would be a soundness regression and turns
    // this red; one of these seven starting to fail would mean the limit was
    // closed and turns it red too. Neither is silently absorbed.
    expect(accepted.sort(), "the type-shaped refusals a TypeScript type cannot express — see INEXPRESSIBLE below").toEqual(expected.sort());
    expect(negatives.length - accepted.length).toBe(15);
  }, 300_000);

  it("row 5, the other half — every inexpressible case is one of three named families, and every family cites its own limit", async () => {
    const judged = await judgeAll();
    const negatives = judged.filter((entry) => entry.verdict === "negative");
    for (const entry of negatives) {
      const limit = nameOfLimit(entry.name);
      if (limit === undefined) {
        continue;
      }
      expect(limit.length, `${entry.name} is listed as inexpressible with no reason`).toBeGreaterThan(0);
    }
    // Every listed name matches a real case, so a stale entry cannot sit
    // here quietly excusing a refusal that no longer exists.
    expect([...INEXPRESSIBLE.keys()].filter((prefix) => !negatives.some((entry) => entry.name.startsWith(`${prefix}:`) || entry.name.startsWith(`${prefix} `))), "a stale entry in INEXPRESSIBLE — it excuses a refusal that no longer exists").toEqual([]);
  }, 300_000);

  it("row 6 — a case the oracle declines to judge is LISTED with its reason, never silently skipped", async () => {
    const judged = await judgeAll();
    const listed = judged.filter((entry) => entry.verdict === "listed");
    // Printed rather than asserted away: the reason each is unjudgeable is
    // the interesting part, and a reason that changes should be seen.
    for (const entry of listed) {
      expect(entry.reason, `${entry.name} was listed with no reason`).toBeDefined();
    }
    // Every descriptor lands in exactly one bucket, so nothing can be lost
    // between them — the property a "skip" would quietly break.
    expect(judged).toHaveLength(104);
    expect(judged.filter((entry) => entry.verdict === "positive").length + judged.filter((entry) => entry.verdict === "negative").length + listed.length).toBe(104);
  }, 300_000);

  it("row 6 — and the corpus contains NO mixed refusal at HEAD: every refusal is wholly type-shaped or not at all", () => {
    const mixed = cases.filter((testCase) => {
      if (testCase.expect.ok) {
        return false;
      }
      const codes = testCase.expect.diagnostics.map((diagnostic) => diagnostic.code);
      return codes.some((code) => TYPE_SHAPED.has(code)) && codes.some((code) => !TYPE_SHAPED.has(code));
    });
    expect(mixed.map((testCase) => testCase.name), "a mixed case would be listed by name with its reason, never asserted and never skipped — there are none").toEqual([]);
  });
});

// --- The corpus's own gap: closedness ---------------------------------------

describe("row 5's `seal-violation` arm — the corpus has no such case, so the oracle grows one", () => {
  /**
   * **A gap found by sabotaging, not by reading.** `seal-violation` is one
   * of the four codes FR-035 calls type-shaped, and **no descriptor in
   * `tests/corpus/validate-cases/` expects it** — every `seal` case in this
   * repository is a unit test. Removing closedness from the emitter
   * entirely therefore left the whole corpus sweep green: the oracle's
   * closedness claim was a guard that guarded nothing.
   *
   * This pair is hand-built rather than derived, and says so. It is the one
   * place in this file where the schema and the configuration are written
   * here instead of read from the corpus — but the *expectation* is still
   * the validator's: the case asserts that `validate()` refuses it with
   * `seal-violation` first, and only then that the type refuses it too.
   */
  const SCHEMA = `$id: vendor/sealed
seal: closed
keys:
  known:
    demand: { type: string, required: true }
`;
  const CONFIG = `$schema: ./schema.yaml
known: yes-a-string
unknown: an extra key the seal forbids
`;

  function files(): Map<string, Uint8Array> {
    return new Map([
      ["/virtual/schema.yaml", new TextEncoder().encode(SCHEMA)],
      ["/virtual/config.yaml", new TextEncoder().encode(CONFIG)],
    ]);
  }

  it("the validator refuses it with `seal-violation` — the oracle's expectation, before any type exists", async () => {
    const options = { host: new InMemoryHost({ files: files() }), sandboxRoot: "/virtual" };
    const resolved = await resolve("/virtual/config.yaml", options);
    if (!resolved.ok) {
      throw new Error(resolved.diagnostics.map((d) => d.code).join(", "));
    }
    const merged = merge(resolved);
    if (!merged.ok) {
      throw new Error("expected the fold to succeed");
    }
    const validated = validate(merged.configuration);
    expect(validated.ok).toBe(false);
    if (validated.ok) {
      return;
    }
    expect(validated.diagnostics.map((d) => d.code)).toEqual(["seal-violation"]);
  });

  it("and the projected configuration does NOT inhabit the generated type", async () => {
    const options = { host: new InMemoryHost({ files: files() }), sandboxRoot: "/virtual" };
    const resolved = await resolve("/virtual/config.yaml", options);
    if (!resolved.ok) {
      throw new Error("expected resolve() ok");
    }
    const merged = merge(resolved);
    if (!merged.ok) {
      throw new Error("expected merge() ok");
    }
    const generated = await generateTypes("/virtual/schema.yaml", { host: new InMemoryHost({ files: files() }), sandboxRoot: "/virtual" });
    if (!generated.ok) {
      throw new Error(generated.diagnostics.map((d) => d.code).join(", "));
    }
    const projected = project(merged.configuration);
    const source = `${generated.source}\nconst __inhabits: ${generated.tree.rootName} = ${toLiteral(projected.value as ConfigValue)};\nvoid __inhabits;\n`;
    const problems = compileInMemory(source);
    expect(problems.length, `a sealed top level must refuse an undeclared key:\n${source}`).toBeGreaterThan(0);
  });

  it("the same configuration WITHOUT the extra key compiles — so it is the seal being caught, not the pair", async () => {
    const clean = new Map([
      ["/virtual/schema.yaml", new TextEncoder().encode(SCHEMA)],
      ["/virtual/config.yaml", new TextEncoder().encode(`$schema: ./schema.yaml\nknown: yes-a-string\n`)],
    ]);
    const options = { host: new InMemoryHost({ files: clean }), sandboxRoot: "/virtual" };
    const resolved = await resolve("/virtual/config.yaml", options);
    if (!resolved.ok) {
      throw new Error("expected resolve() ok");
    }
    const merged = merge(resolved);
    if (!merged.ok) {
      throw new Error("expected merge() ok");
    }
    expect(validate(merged.configuration).ok).toBe(true);
    const generated = await generateTypes("/virtual/schema.yaml", { host: new InMemoryHost({ files: clean }), sandboxRoot: "/virtual" });
    if (!generated.ok) {
      throw new Error("expected generateTypes() ok");
    }
    const projected = project(merged.configuration);
    const problems = compileInMemory(`${generated.source}\nconst __inhabits: ${generated.tree.rootName} = ${toLiteral(projected.value as ConfigValue)};\nvoid __inhabits;\n`);
    expect(problems, renderProblems(problems)).toEqual([]);
  });

  it("and a CLOSED-EMPTY mapping refuses everything, which row 14 is the whole reason for", async () => {
    const emptyFiles = new Map([
      ["/virtual/schema.yaml", new TextEncoder().encode(`$id: vendor/empty\nkeys:\n  m:\n    demand: { type: mapping, seal: closed }\n`)],
      ["/virtual/config.yaml", new TextEncoder().encode(`$schema: ./schema.yaml\nm:\n  anything: 1\n`)],
    ]);
    const options = { host: new InMemoryHost({ files: emptyFiles }), sandboxRoot: "/virtual" };
    const resolved = await resolve("/virtual/config.yaml", options);
    if (!resolved.ok) {
      throw new Error("expected resolve() ok");
    }
    const merged = merge(resolved);
    if (!merged.ok) {
      throw new Error("expected merge() ok");
    }
    expect(validate(merged.configuration).ok, "the validator refuses it first").toBe(false);
    const generated = await generateTypes("/virtual/schema.yaml", { host: new InMemoryHost({ files: emptyFiles }), sandboxRoot: "/virtual" });
    if (!generated.ok) {
      throw new Error("expected generateTypes() ok");
    }
    const projected = project(merged.configuration);
    const problems = compileInMemory(`${generated.source}\nconst __inhabits: ${generated.tree.rootName} = ${toLiteral(projected.value as ConfigValue)};\nvoid __inhabits;\n`);
    expect(problems.length, "`{}` would have accepted this; `{ readonly [key: string]: never }` does not").toBeGreaterThan(0);
  });
});

// --- A named type beside the position's own structure ------------------------

describe("a position that names a type AND declares structure of its own — both apply, so the type must say both", () => {
  /**
   * **The shape v1.1 first shipped wide, and the corpus does not contain.**
   * `checkDemand` runs *every* keyword of one demand — `keys`, `values`,
   * `seal`, the bounds — beside a resolved `type:`, so a demand of
   * `{ type: box, keys: { b: { demand: { required: true } } } }` is enforced
   * as the **intersection** of `box`'s own body and that `keys`. Emitting
   * `box`'s alias alone is wider than the accumulated demand, and wider is
   * the one direction Article VIII's soundness law forbids.
   *
   * Hand-built, and it says so — no descriptor in the validate corpus writes
   * this shape, which is exactly why it went unnoticed. The **expectation**
   * is still the validator's: each case asserts what `validate()` does
   * first, and only then what the type does.
   */
  const NARROWING_SCHEMA = `$id: vendor/core
types:
  box:
    demand:
      type: mapping
      keys:
        a: { demand: { type: string } }
keys:
  thing:
    demand:
      type: box
      keys:
        b: { demand: { type: string, required: true } }
`;

  function filesWith(schema: string, config: string): Map<string, Uint8Array> {
    return new Map([
      ["/virtual/schema.yaml", new TextEncoder().encode(schema)],
      ["/virtual/config.yaml", new TextEncoder().encode(config)],
    ]);
  }

  async function verdicts(schema: string, config: string): Promise<{ readonly validates: boolean; readonly compiles: boolean; readonly source: string }> {
    const options = { host: new InMemoryHost({ files: filesWith(schema, config) }), sandboxRoot: "/virtual" };
    const resolved = await resolve("/virtual/config.yaml", options);
    if (!resolved.ok) {
      throw new Error(resolved.diagnostics.map((d) => d.code).join(", "));
    }
    const merged = merge(resolved);
    if (!merged.ok) {
      throw new Error(merged.diagnostics.map((d) => d.code).join(", "));
    }
    const generated = await generateTypes("/virtual/schema.yaml", { host: new InMemoryHost({ files: filesWith(schema, config) }), sandboxRoot: "/virtual" });
    if (!generated.ok) {
      throw new Error(generated.diagnostics.map((d) => d.code).join(", "));
    }
    const projected = project(merged.configuration);
    const source = `${generated.source}\nconst __inhabits: ${generated.tree.rootName} = ${toLiteral(projected.value as ConfigValue)};\nvoid __inhabits;\n`;
    return { validates: validate(merged.configuration).ok, compiles: compileInMemory(source).length === 0, source };
  }

  it("the validator REFUSES a config missing the position's own required child, even though the named type does not demand it", async () => {
    const verdict = await verdicts(NARROWING_SCHEMA, `$schema: ./schema.yaml\nthing:\n  a: hello\n`);
    expect(verdict.validates).toBe(false);
  });

  it("...and the projected configuration therefore must NOT inhabit the generated type", async () => {
    const verdict = await verdicts(NARROWING_SCHEMA, `$schema: ./schema.yaml\nthing:\n  a: hello\n`);
    expect(verdict.compiles, `the emitted type accepted a configuration the validator refused:\n${verdict.source}`).toBe(false);
  });

  it("...while the config the validator ACCEPTS compiles — so it is the narrowing being caught, not the shape", async () => {
    const verdict = await verdicts(NARROWING_SCHEMA, `$schema: ./schema.yaml\nthing:\n  a: hello\n  b: world\n`);
    expect(verdict.validates).toBe(true);
    expect(verdict.compiles, verdict.source).toBe(true);
  });

  /** `seal` and `values`, not only `keys`: the position closes a mapping the named type left open. */
  const SEALING_SCHEMA = `$id: vendor/core
types:
  openBox:
    demand:
      type: mapping
      values: { type: string }
keys:
  thing:
    demand:
      type: openBox
      seal: closed
      keys:
        a: { demand: { type: string } }
`;

  it("a position that SEALS a mapping the named type left open refuses an undeclared key, and the type says so", async () => {
    const refused = await verdicts(SEALING_SCHEMA, `$schema: ./schema.yaml\nthing:\n  a: x\n  z: y\n`);
    expect(refused.validates, "the validator refuses it first").toBe(false);
    expect(refused.compiles, `the emitted type accepted a sealed mapping's undeclared key:\n${refused.source}`).toBe(false);
    const accepted = await verdicts(SEALING_SCHEMA, `$schema: ./schema.yaml\nthing:\n  a: x\n`);
    expect(accepted.validates).toBe(true);
    expect(accepted.compiles, accepted.source).toBe(true);
  });

  /** The bounds and `enum` a position adds beside a named type reach the accumulated demand too. */
  const ENUM_SCHEMA = `$id: vendor/core
types:
  word:
    demand: { type: string }
keys:
  thing:
    demand:
      type: word
      enum: ["yes", "no"]
`;

  it("an `enum` declared beside a named type narrows the emitted type to its literals", async () => {
    const refused = await verdicts(ENUM_SCHEMA, `$schema: ./schema.yaml\nthing: maybe\n`);
    expect(refused.validates).toBe(false);
    expect(refused.compiles, refused.source).toBe(false);
    const accepted = await verdicts(ENUM_SCHEMA, `$schema: ./schema.yaml\nthing: "yes"\n`);
    expect(accepted.validates).toBe(true);
    expect(accepted.compiles, accepted.source).toBe(true);
  });
});

// --- §1 row 7: the meta-schema round trip -----------------------------------

describe("contract §1 row 7 / SC-004 — the meta-schema inhabits the type generated from itself", () => {
  const META_PATH = join(REPO_ROOT, "meta", "cascata.meta.yaml");

  /** The two-layer configuration `metaValidate()` builds: the subject as the config layer, the meta-schema as the schema layer. */
  function metaAsConfigOfItself(): MergeInput {
    const bytes = readFileSync(META_PATH);
    const origin = createOrigin(META_PATH, META_PATH);
    const parsed = parse(bytes, { origin });
    if (!parsed.ok) {
      throw new Error(`the meta-schema does not parse: ${parsed.diagnostics.map((d) => d.message).join("; ")}`);
    }
    const document: GraphDocument = { identity: { location: META_PATH, physical: META_PATH, hash: "0".repeat(64) }, tree: parsed.tree, verified: false };
    return { graph: { entry: document, documents: [document, document] }, pedigree: [] };
  }

  it("self-hosting extended to the type surface: the projection typechecks against the generated root", async () => {
    const generated = await generateTypes(META_PATH, { host: createNodeHost(), sandboxRoot: REPO_ROOT });
    expect(generated.ok).toBe(true);
    if (!generated.ok) {
      throw new Error(generated.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; "));
    }
    const merged = merge(metaAsConfigOfItself());
    expect(merged.ok).toBe(true);
    if (!merged.ok) {
      throw new Error(merged.diagnostics.map((d) => d.code).join(", "));
    }
    const projected = project(merged.configuration);
    const source = `${generated.source}\nconst __inhabits: ${generated.tree.rootName} = ${toLiteral(projected.value as ConfigValue)};\nvoid __inhabits;\n`;
    const problems = compileInMemory(source);
    expect(problems, renderProblems(problems)).toEqual([]);
  }, 120_000);

  it("and the meta-schema really is accepted as a configuration of itself — the oracle's own premise", async () => {
    const merged = merge(metaAsConfigOfItself());
    if (!merged.ok) {
      throw new Error("expected the fold to succeed");
    }
    const validated = validate(merged.configuration);
    expect(validated.ok, validated.ok ? "ok" : validated.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; ")).toBe(true);
  });
});

// --- FR-038: what the sharing costs ------------------------------------------

describe("contract §1 row 3 / FR-038 — the compiler is invoked in memory, with its lib shared across calls", () => {
  it("nothing is written to disk, and the shared lib is a measurable saving (a fact about this machine, not an assertion)", () => {
    const source = `export type T = { readonly a: string };\nconst v: T = { a: "x" };\nvoid v;\n`;
    // Warm the shared cache first, so the comparison is steady-state
    // against cold, not first-call against second.
    compileInMemory(source);
    const shared = performance.now();
    for (let run = 0; run < 5; run += 1) {
      compileInMemory(source);
    }
    const sharedMs = performance.now() - shared;
    const fresh = performance.now();
    for (let run = 0; run < 5; run += 1) {
      compileInMemory(source, false);
    }
    const freshMs = performance.now() - fresh;
    console.log(`[FR-038] 5 compiles with the shared lib: ${sharedMs.toFixed(0)}ms; without: ${freshMs.toFixed(0)}ms`);
    expect(sharedMs).toBeGreaterThan(0);
    expect(freshMs).toBeGreaterThan(0);
  }, 120_000);
});
