/**
 * **`SPEC.md` §16 (Article VI): "Nothing about the state of the world
 * throws."** A programmer error throws; a fact about the world returns
 * diagnostics. A **legal, cap-obeying document is a fact about the world**,
 * so a `RangeError` escaping `validate()`/`load()` is a violation of the
 * article, not a rough edge.
 *
 * The defect: `target.push(...source)` passes one argument per element and
 * V8 refuses past roughly 125,000 of them. Every accumulation in the
 * pipeline is over a *document's own* contents, and §11 allows a document
 * to be 8 MB — so several ordinary shapes crossed the limit while staying
 * comfortably inside the cap.
 *
 * **The history matters more than the fix, and is why the last test in this
 * file is a static sweep rather than a fourth case.** The first pass at
 * this defect, in v0.7 part 2, was found by the FR-010 termination property
 * test reaching the accumulation in `check.ts`. That pass fixed the two
 * instances the property test reached — `check.ts` and `vocabulary.ts` —
 * and **did not sweep for siblings**. Four remained, one of them
 * demonstrably reachable by a 3 MB schema. Fixing what a probe happens to
 * reach is not fixing a class of defect; the sweep is what makes the
 * omission unrepeatable, and it is the reason `src/extend.ts` exists as one
 * shared helper rather than as a local copy per file.
 *
 * Cases A–C exercise the three sites in `src/validate/types.ts`. A is the
 * end-to-end reproduction on a real document; B and C drive the affected
 * functions directly, because a document large enough to reach them
 * end-to-end costs a minute of CPU for reasons unrelated to this defect
 * (see this file's closing note).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { load } from "../../src/index.js";
import { InMemoryHost } from "./host-test-double.js";
import { allDeclarations, cycleDiagnostics, type TypeDeclaration } from "../../src/validate/types.js";
import { parseTypeExpression } from "../../src/validate/typeexpr.js";
import { createMapping, createStringScalar, type Node } from "../../src/model/node.js";
import { createOrigin, createSourceSpan, type SourceSpan } from "../../src/model/span.js";
import type { Layer, MergedConfiguration } from "../../src/merge/provenance.js";

const ENCODER = new TextEncoder();
const REPO_ROOT = join(__dirname, "..", "..");

/** Comfortably past V8's ~125,000-argument spread limit, and small enough that every document below stays inside §11's 8 MB cap. */
const OVER_THE_SPREAD_LIMIT = 200_000;

const ORIGIN = createOrigin("totality-schema", "totality-schema");
let offset = 0;
function span(): SourceSpan {
  offset += 1;
  return createSourceSpan({ origin: ORIGIN, start: offset, end: offset + 1, line: 1, column: offset, documentLength: 100_000_000 });
}

describe("Article VI — a legal document never makes validate()/load() throw", () => {
  it("A: a 3 MB schema whose named type carries a 200,000-entry accept: returns a verdict, end to end", async () => {
    // The demonstrated reproduction. Before the fix this threw
    // `RangeError: Maximum call stack size exceeded` from
    // `referencedNames` (`src/validate/types.ts`), reached through
    // `cycleDiagnostics` -> `checkConfiguration` -> `validate` -> `load`.
    const accept = Array.from({ length: OVER_THE_SPREAD_LIMIT }, (_, index) => `      - n${index}`).join("\n");
    const schema = `types:\n  t:\n    demand: { type: string }\n    accept:\n${accept}\nkeys:\n  k:\n    demand: { type: t }\n`;
    // Inside §11's 8 MB cap — the whole point: this is a document the
    // library is obliged to have an opinion about, not to choke on.
    expect(schema.length).toBeLessThan(8 * 1024 * 1024);

    const host = new InMemoryHost({
      files: new Map([
        ["/v/schema.yaml", ENCODER.encode(schema)],
        ["/v/config.yaml", ENCODER.encode("$schema: ./schema.yaml\nk: hi\n")],
      ]),
    });
    const result = await load("/v/config.yaml", { host, sandboxRoot: "/v" });
    // The verdict itself is not the point and is deliberately loose: what
    // is asserted is that a verdict was *reached*. `type-accept-widened`
    // is what it happens to be — the usage selects names the type never
    // declared — and that is a fact about the world, correctly reported.
    expect(typeof result.ok).toBe("boolean");
    expect(result.diagnostics.length).toBeGreaterThan(0);
  }, 120_000);

  it("B: a declared type whose own demand.type is a 200,000-alternative union does not throw", () => {
    // `src/validate/types.ts`'s second spread, in the same function as A's.
    // **Demonstrated end to end as well**: a 1.5 MB schema of this shape
    // threw `RangeError` from `load()` in 386 ms before the fix. Driven
    // directly here rather than through the pipeline only because the
    // function is the whole subject and 1.5 MB of YAML is not.
    const union = Array.from({ length: OVER_THE_SPREAD_LIMIT }, (_, index) => `n${index}`).join("|");
    const declaration: TypeDeclaration = {
      name: "t",
      demand: new Map([["type", createStringScalar(union, span())]]),
      accept: undefined,
      layer: { identity: { location: "totality-schema", hash: "0".repeat(64) }, role: "schema", rank: 0, tree: createMapping([], span()) },
      layerRank: 0,
      pointer: "/types/t",
      span: span(),
    };
    expect(() => cycleDiagnostics([declaration])).not.toThrow();
  }, 120_000);

  it("C: a types: section with 200,000 entries does not throw while its declarations are collected", () => {
    // `src/validate/types.ts`'s third spread, in `allDeclarations`.
    //
    // **Reachability through `load()` is unproven, and is stated that way
    // rather than assumed.** A `types:` section with this many entries is
    // about 7.5 MB of YAML — inside §11's 8 MB cap, but the parse alone
    // dominates and the attempt did not finish inside ten minutes. So this
    // case establishes that the function throws, not that a document
    // reaches it. The fix is applied on the strength of the shape being
    // identical to A's and B's, which are both demonstrated.
    const entries: [string, Node][] = [];
    for (let index = 0; index < OVER_THE_SPREAD_LIMIT; index += 1) {
      entries.push([`t${index}`, createMapping([["demand", createMapping([["type", createStringScalar("string", span())]], span())]], span())]);
    }
    const tree = createMapping([["types", createMapping(entries, span())]], span());
    const layer: Layer = { identity: { location: "totality-schema", hash: "0".repeat(64) }, role: "schema", rank: 0, tree };
    const configuration = { tree: createMapping([], span()), provenance: new Map(), pedigree: [], layers: [layer], delegationBreadcrumbs: new Map(), finalState: new Map() } as unknown as MergedConfiguration;
    expect(() => allDeclarations(configuration)).not.toThrow();
    expect(allDeclarations(configuration)).toHaveLength(OVER_THE_SPREAD_LIMIT);
  }, 120_000);
});

/**
 * The durable half. Cases A–C are three shapes somebody thought of; this is
 * every shape nobody has.
 *
 * A **call-site** spread (`f(...xs)`) is the dangerous form — it becomes
 * one argument per element. An **array-literal** spread (`[...a, ...b]`)
 * has no such limit and is used freely throughout this codebase, so it is
 * deliberately not matched. Comments are stripped first: `src/extend.ts`'s
 * own doc comment quotes the forbidden form in order to explain it.
 */
describe("Article VI — no call-site spread survives anywhere under src/", () => {
  /**
   * Deliberately empty, and it should stay that way. An entry here is a
   * claim that some array's length is bounded by a **constant** rather than
   * by document size — which needs saying out loud, next to the code, in
   * the same spirit `tests/unit/layering.test.ts` names its one host
   * exemption rather than inferring it from a pattern.
   */
  const EXEMPT: ReadonlySet<string> = new Set<string>();

  /** Strip block and line comments, so prose about the pattern is not mistaken for the pattern. */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  }

  /** `foo(...bar)` / `a.b(...c)` — a call whose argument list opens with a spread of an identifier. Not `[...a]`, not `{...a}`. */
  const CALL_SITE_SPREAD = /[A-Za-z_$][A-Za-z0-9_$]*\s*\(\s*\.\.\.[A-Za-z_$]/;

  function sourceFiles(directory: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        out.push(...sourceFiles(path));
      } else if (path.endsWith(".ts")) {
        out.push(path);
      }
    }
    return out;
  }

  it("finds the source files at all — a sweep over nothing passes vacuously", () => {
    expect(sourceFiles(join(REPO_ROOT, "src")).length).toBeGreaterThan(30);
  });

  it("no file under src/ contains one", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(REPO_ROOT, "src"))) {
      const relativePath = relative(REPO_ROOT, file).split("\\").join("/");
      if (EXEMPT.has(relativePath)) continue;
      stripComments(readFileSync(file, "utf-8"))
        .split("\n")
        .forEach((line, index) => {
          if (CALL_SITE_SPREAD.test(line)) {
            offenders.push(`${relativePath}:${index + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders, "use src/extend.ts, or add an EXEMPT entry saying why this array's length is bounded by a constant").toEqual([]);
  });

  it("the sweep actually matches the forbidden form — a regex that matches nothing would pass the test above forever", () => {
    expect(CALL_SITE_SPREAD.test("    diagnostics.push(...memberDiagnostics);")).toBe(true);
    expect(CALL_SITE_SPREAD.test("      names.push(...decl.accept);")).toBe(true);
    expect(CALL_SITE_SPREAD.test("  return Math.max(...lengths);")).toBe(true);
    // And leaves the safe forms alone.
    expect(CALL_SITE_SPREAD.test("  const merged = [...a, ...b];")).toBe(false);
    expect(CALL_SITE_SPREAD.test("  return { ...fields, level };")).toBe(false);
    expect(CALL_SITE_SPREAD.test("    extend(target, source);")).toBe(false);
  });
});

/**
 * The neighbouring finding, which turned out to be one line.
 *
 * A schema carrying a 130,000-alternative union — 907 KB, inside §11's cap
 * — took **68 seconds** to `load()` and returned normally. Not a totality
 * violation, since a verdict was reached; but §11 caps a document's
 * **size** and nothing caps the **work** it can demand, so a legal document
 * bought a minute of CPU.
 *
 * The cause was exact rather than diffuse: `Parser.parseUnion` accumulated
 * with `alternatives = [...alternatives, ...more]`, reallocating and
 * copying the whole list once per `|` — Θ(n²). Measured before the fix at a
 * clean 4x per doubling (62 ms / 496 ms / 2.3 s / 8.9 s / 34 s for 10k →
 * 160k alternatives) and after it at 2x (17 ms / 30 ms / 56 ms / 109 ms /
 * 221 ms). The 68-second `load()` is now 594 ms.
 *
 * This test is what keeps it from coming back. It measures a ratio rather
 * than an absolute, so it says something about *scaling* rather than about
 * this machine — the same shape `tests/unit/metaschema.test.ts` uses for
 * the `typeExpr` pattern's own linearity, and for the same reason: the
 * quadratic form there is likewise the one somebody would reach for while
 * "simplifying".
 */
describe("legal input, bounded cost — the type-expression parser is linear in alternatives", () => {
  function timeUnion(alternatives: number): number {
    const union = Array.from({ length: alternatives }, (_, index) => `n${index}`).join("|");
    const started = process.hrtime.bigint();
    const parsed = parseTypeExpression(union);
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.alternatives).toHaveLength(alternatives);
    return elapsed;
  }

  it("doubling the alternatives does not quadruple the work", () => {
    timeUnion(2_000); // warm up, so the first measurement is not JIT time
    const small = Math.max(timeUnion(20_000), 0.001);
    const large = timeUnion(80_000);
    // Two doublings. Quadratic was measured at 4x per doubling — 16x here.
    // A ceiling of 8x fails that comfortably and passes anything linear,
    // without turning a timing measurement into a flaky assertion.
    expect(large / small, `20,000: ${small}ms, 80,000: ${large}ms`).toBeLessThan(8);
  }, 120_000);

  it("a 907 KB, 130,000-alternative union — the measured case — returns in well under the minute it used to cost", async () => {
    const union = Array.from({ length: 130_000 }, (_, index) => `n${index}`).join("|");
    const schema = `keys:\n  k:\n    demand: { type: "${union}" }\n`;
    expect(schema.length).toBeLessThan(8 * 1024 * 1024);
    const host = new InMemoryHost({
      files: new Map([
        ["/v/schema.yaml", ENCODER.encode(schema)],
        ["/v/config.yaml", ENCODER.encode("$schema: ./schema.yaml\nk: hi\n")],
      ]),
    });
    const started = Date.now();
    const result = await load("/v/config.yaml", { host, sandboxRoot: "/v" });
    const elapsed = Date.now() - started;
    expect(typeof result.ok).toBe("boolean");
    // Ten seconds is a ceiling, not a target — it was 68 seconds, and is
    // now around 0.6. Anything near the old figure is the quadratic back.
    expect(elapsed, `${elapsed}ms`).toBeLessThan(10_000);
  }, 120_000);
});
