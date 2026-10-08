/**
 * v0.7 part 2 (008) FR-015 through FR-020 — **the meta-schema**.
 * `SPEC.md` §2.6 (self-hosting), §9, §9.1, §11, §14 item 7.
 *
 * The milestone's fixed point lives here: the meta-schema validates
 * against itself. A language that cannot describe its own description has
 * not self-hosted; it has described everything except the hardest
 * document.
 *
 * **A green fixed point proves nothing on its own**, which is why the
 * second block exists. A meta-schema that constrained nothing would pass
 * itself just as cleanly, and the version of `checkNamedType` this
 * milestone replaced would have made exactly that happen — a named type's
 * own `keys:` was silently unchecked, and the meta-schema's central
 * construct is a recursive named type whose entire content is a `keys:`
 * mapping. Each corruption below is a real vocabulary error in a real
 * schema, and each must be refused *by the meta-schema*, not by some
 * hand-written check that would have fired anyway.
 *
 * Corruptions are served from memory, never written over the shipped file.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { metaValidate, parse, type Diagnostic } from "../../src/index.js";
import { createNodeHost, nodeMetaSchemaLocation } from "../../src/host/node.js";
import { InMemoryHost } from "./host-test-double.js";
import { createOrigin } from "../../src/model/span.js";

const ENCODER = new TextEncoder();
const META_LOCATION = nodeMetaSchemaLocation();
const META_TEXT = readFileSync(META_LOCATION, "utf-8");

/** Validate `subjectText` against the shipped meta-schema, both served from memory — no filesystem reachable. */
async function metaValidateText(subjectText: string): Promise<{ ok: boolean; diagnostics: readonly Diagnostic[] }> {
  const host = new InMemoryHost({
    files: new Map([
      ["/mem/meta.yaml", ENCODER.encode(META_TEXT)],
      ["/mem/subject.yaml", ENCODER.encode(subjectText)],
    ]),
  });
  return metaValidate({ host, subject: "/mem/subject.yaml", metaSchema: "/mem/meta.yaml" });
}

describe("v0.7 part 2 FR-016 / SC-001 — the fixed point: the meta-schema validates against itself", () => {
  it("passes, read from disk through the shipped Node host", async () => {
    const result = await metaValidate({ host: createNodeHost(), subject: META_LOCATION, metaSchema: META_LOCATION });
    expect(result.ok, result.ok ? "ok" : JSON.stringify(result.diagnostics.map((d) => `${d.code}: ${d.message}`), null, 2)).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("passes with itself served from memory too — the verdict is about the document, not about where it came from", async () => {
    const result = await metaValidateText(META_TEXT);
    expect(result.ok).toBe(true);
  });
});

describe("v0.7 part 2 FR-015 — the meta-schema has teeth: each corruption is refused, and refused BY IT", () => {
  /** One corruption: a `[find, replace]` edit on the meta-schema's own text, and the code it must draw. */
  const CORRUPTIONS: readonly (readonly [label: string, find: string, replace: string, code: string])[] = [
    [
      "an undeclared demand keyword inside a nested demand",
      "        pattern:   { demand: { type: string } }",
      "        pattern:   { demand: { type: string, formatt: 1 } }",
      "seal-violation",
    ],
    [
      "an undeclared keyword in a types: entry",
      "  typeDecl:\n    demand:",
      "  typeDecl:\n    bogus: 1\n    demand:",
      "seal-violation",
    ],
    [
      "a type expression that does not parse",
      "        required:  { demand: { type: bool } }",
      '        required:  { demand: { type: "bool||" } }',
      "pattern-mismatch",
    ],
    [
      "a top-level section the vocabulary does not name",
      "$id: cascata/meta",
      "$id: cascata/meta\nnotASection:\n  x: 1",
      "seal-violation",
    ],
    [
      "a $pin that is not sha256:<64 hex>",
      "$id: cascata/meta",
      "$id: cascata/meta\n$pin: sha256:nothex",
      "pattern-mismatch",
    ],
    [
      "a $version that is not an integer",
      "$version: 1",
      "$version: one",
      "type-mismatch",
    ],
    [
      "a demand keyword given the wrong shape",
      "        minLength: { demand: { type: int, min: 0 } }",
      "        minLength: { demand: { type: int, min: zero } }",
      "type-mismatch",
    ],
  ];

  for (const [label, find, replace, code] of CORRUPTIONS) {
    it(`refuses ${label} with ${code}`, async () => {
      expect(META_TEXT.includes(find), `corruption anchor not found: ${find}`).toBe(true);
      const corrupted = META_TEXT.replace(find, replace);
      expect(corrupted).not.toBe(META_TEXT);
      const result = await metaValidateText(corrupted);
      expect(result.ok, "expected the meta-schema to refuse this").toBe(false);
      expect(result.diagnostics.map((d) => d.code)).toContain(code);
    });
  }

  it("a well-formed schema that is NOT the meta-schema passes — the corruptions above are not just 'anything fails'", async () => {
    const ordinary = ["$id: example/one", "$version: 2", "types:", "  resource:", "    accept: [url, path]", "    demand: { type: string }", "keys:", "  styles:", "    demand: { type: \"resource[]\" }", "    cascade: append", "    provide: []", ""].join("\n");
    const result = await metaValidateText(ordinary);
    expect(result.ok, result.ok ? "ok" : JSON.stringify(result.diagnostics.map((d) => `${d.code}: ${d.message}`))).toBe(true);
  });
});

// --- §9.1's grammar versus `typeExpr`'s superset pattern (research.md W-1) ---

/**
 * The one rule governing `typeExpr`'s `pattern`: **it must accept every
 * string §9.1's grammar accepts.** Over-acceptance is safe — the parser is
 * the authority and refuses the rest — while one false rejection would put
 * two authorities in contradiction, each saying the opposite about the
 * same document.
 *
 * "Established, not assumed" means generating **from the productions**,
 * never from a list of examples: an example set is a guess about which
 * shapes matter, and the false rejection this milestone actually found
 * (`core / resource` — whitespace around the qualifier separator, which
 * `typeexpr.ts`'s tokenizer skips like every other whitespace) is exactly
 * the shape no example list would have contained.
 *
 * The pattern is read **out of the meta-schema document**, after a
 * round-trip through the project's own `yaml` dependency. A pattern that
 * does not survive YAML is no pattern at all, and testing the string as
 * typed here rather than as parsed there would test the wrong thing.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The `pattern` the shipped meta-schema declares for `typeExpr`, as the parser hands it back. */
function typeExprPattern(): RegExp {
  const parsed = parse(ENCODER.encode(META_TEXT), { origin: createOrigin(META_LOCATION, META_LOCATION) });
  if (!parsed.ok || parsed.tree.type !== "mapping") throw new Error("meta-schema does not parse");
  const types = parsed.tree.entries.get("types");
  if (types === undefined || types.type !== "mapping") throw new Error("no types section");
  const typeExpr = types.entries.get("typeExpr");
  if (typeExpr === undefined || typeExpr.type !== "mapping") throw new Error("no typeExpr");
  const demand = typeExpr.entries.get("demand");
  if (demand === undefined || demand.type !== "mapping") throw new Error("no typeExpr.demand");
  const pattern = demand.entries.get("pattern");
  if (pattern === undefined || pattern.type !== "scalar" || pattern.kind !== "string") throw new Error("no typeExpr.demand.pattern");
  return new RegExp(pattern.value, "u");
}

/** Tokens, so whitespace can be injected at every position where §9.1 says it is insignificant — which is every position between tokens. */
type Tok = string;

function generateTokens(rng: () => number, budget: number): Tok[] {
  // Union := Array ( "|" Array )*
  const parts: Tok[][] = [genArray(rng, budget)];
  while (rng() < 0.35 && parts.length < 4) {
    parts.push(genArray(rng, budget));
  }
  const out: Tok[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push("|");
    out.push(...part);
  });
  return out;
}

function genArray(rng: () => number, budget: number): Tok[] {
  // Array := Primary "[]"*
  const out = genPrimary(rng, budget);
  let depth = 0;
  while (rng() < 0.4 && depth < 3) {
    out.push("[", "]");
    depth += 1;
  }
  return out;
}

function genPrimary(rng: () => number, budget: number): Tok[] {
  // Primary := Name | "(" Union ")"
  if (budget > 0 && rng() < 0.3) {
    return ["(", ...generateTokens(rng, budget - 1), ")"];
  }
  return genName(rng);
}

const IDENT_START = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_";
const IDENT_CONT = `${IDENT_START}0123456789-`;

function genName(rng: () => number): Tok[] {
  const ident = (): string => {
    const startIndex = Math.floor(rng() * IDENT_START.length);
    let out = IDENT_START[startIndex] ?? "a";
    const length = Math.floor(rng() * 6);
    for (let index = 0; index < length; index += 1) {
      out += IDENT_CONT[Math.floor(rng() * IDENT_CONT.length)] ?? "a";
    }
    return out;
  };
  // Name := Ident ( "/" Ident )?
  return rng() < 0.3 ? [ident(), "/", ident()] : [ident()];
}

const WHITESPACE = [" ", "\t", "\n", "  ", " \t "];

/** Join tokens with whitespace at every boundary — "whitespace insignificant" (§9.1) made concrete. */
function render(tokens: readonly Tok[], rng: () => number, whitespaceProbability: number): string {
  let out = rng() < whitespaceProbability ? (WHITESPACE[Math.floor(rng() * WHITESPACE.length)] ?? " ") : "";
  tokens.forEach((token, index) => {
    if (index > 0 && rng() < whitespaceProbability) {
      out += WHITESPACE[Math.floor(rng() * WHITESPACE.length)] ?? " ";
    }
    out += token;
  });
  if (rng() < whitespaceProbability) out += WHITESPACE[Math.floor(rng() * WHITESPACE.length)] ?? " ";
  return out;
}

describe("v0.7 part 2 / research.md W-1 — typeExpr's pattern is a SUPERSET of §9.1's grammar", () => {
  it("accepts every expression generated from §9.1's own productions, with whitespace at every legal boundary — zero false rejects", () => {
    const pattern = typeExprPattern();
    const rejected: string[] = [];
    for (let seed = 1; seed <= 20_000; seed += 1) {
      const rng = mulberry32(seed);
      const tokens = generateTokens(rng, 2);
      // Two renderings per shape: dense (no whitespace) and whitespace-heavy.
      for (const probability of [0, 0.85]) {
        const text = render(tokens, mulberry32(seed * 7919 + 13), probability);
        if (!pattern.test(text)) rejected.push(text);
      }
    }
    expect(rejected.slice(0, 10)).toEqual([]);
    expect(rejected).toHaveLength(0);
  });

  it("the corrected qualifier boundary is the one the draft got wrong — `core / resource` parses, so the pattern MUST accept it", () => {
    const pattern = typeExprPattern();
    expect(pattern.test("core / resource")).toBe(true);
    expect(pattern.test("core/resource")).toBe(true);
    // The draft's form, kept here as the counter-example it turned out to be.
    const draftPattern = /^[\s(]*[A-Za-z_][A-Za-z0-9_-]*(?:\/[A-Za-z_][A-Za-z0-9_-]*)?[\s)]*(?:\[[\s]*\][\s)]*)*(?:\|[\s(]*[A-Za-z_][A-Za-z0-9_-]*(?:\/[A-Za-z_][A-Za-z0-9_-]*)?[\s)]*(?:\[[\s]*\][\s)]*)*)*$/u;
    expect(draftPattern.test("core / resource")).toBe(false);
  });

  it("still refuses strings the grammar refuses — over-acceptance is safe, but it is not licence to accept everything", () => {
    const pattern = typeExprPattern();
    for (const bad of ["", "|", "bool||", "string|", "1bad", "a,b", "a?", "string[", "*"]) {
      expect(pattern.test(bad), `expected the pattern to refuse ${JSON.stringify(bad)}`).toBe(false);
    }
  });
});

describe("v0.7 part 2 — the depth cap versus the deepest document this project has produced", () => {
  it("the meta-schema validating itself stays far inside MAX_DEMAND_DEPTH", async () => {
    // Measured with a temporary instrument in `check.ts` during
    // implementation: **structural depth 8, type hops 1**, against a cap of
    // 64. Recorded rather than asserted numerically, because the numbers
    // would move for reasons that are not defects; what is asserted is the
    // thing that matters — no `depth-limit-exceeded` anywhere. `typeHops`
    // peaking at 1 is the more interesting figure: every recursion in the
    // meta-schema passes through a structural level, which is §7's
    // guarded-recursion property showing up as a measurement rather than as
    // a claim.
    const result = await metaValidate({ host: createNodeHost(), subject: META_LOCATION, metaSchema: META_LOCATION });
    expect(result.diagnostics.some((d) => d.code === "depth-limit-exceeded")).toBe(false);
  });
});
