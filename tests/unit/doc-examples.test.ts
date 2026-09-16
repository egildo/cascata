/**
 * v0.7 part 2 (008) FR-021a / SC-009 — **every documented YAML example is
 * executed.**
 *
 * This exists because five of `SPEC.md`'s own worked examples were
 * malformed YAML for six milestones (§15, research.md W-6):
 * `demand: { type: resource[] }` is well-formed Cascata and invalid YAML —
 * inside a flow mapping, `[` opens a flow sequence — and nothing caught it
 * because no *executed* fixture is written in flow style. They were prose
 * that had never been run. An example is worth what executing it costs.
 *
 * **An abbreviated example is substituted, never skipped.** Skipping is
 * exactly how a broken block hides: the two blocks carrying an ellipsis are
 * the ones a "just skip the ones with `…`" rule would have exempted, and
 * one of them is a flow mapping — the very construct that broke the other
 * five. Each ellipsis therefore has a **declared substitution** below, and
 * a block containing an ellipsis with no rule to cover it **fails**. The
 * rules are asserted to be used, too, so a stale one breaks the test rather
 * than sitting dead.
 *
 * The parser is the project's own (`parse`), not a second YAML reader:
 * asserting against something else would say nothing about what Cascata
 * does with these documents.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { accumulate, generate, parse } from "../../src/index.js";
import { parseJsonBytes } from "../../src/adapters/json/parse.js";
import { createOrigin } from "../../src/model/span.js";
import type { Layer } from "../../src/merge/provenance.js";

const REPO_ROOT = join(__dirname, "..", "..");
const ENCODER = new TextEncoder();

/** `SPEC.md`, `README.md`, every `docs/*.md`, and every `specs/**\/*.md` — FR-021a's own list, plus `docs/`, where the reference moved when the README became an introduction. */
function documentationFiles(): string[] {
  const out = [join(REPO_ROOT, "SPEC.md"), join(REPO_ROOT, "README.md")];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (path.endsWith(".md")) {
        out.push(path);
      }
    }
  };
  walk(join(REPO_ROOT, "docs"));
  walk(join(REPO_ROOT, "specs"));
  return out.sort();
}

interface Block {
  readonly file: string;
  readonly line: number;
  readonly body: string;
}

/**
 * Every fenced block tagged `yaml`/`yml`. Deliberately tag-driven: an
 * untagged fence in this repository is prose or a shell transcript, and
 * guessing at which of those is "really YAML" would make the sweep's scope
 * depend on a heuristic rather than on what the author wrote.
 */
/**
 * Every fenced block whose info string *begins* with one of `tags`.
 *
 * **The trailing `[^\r\n]*` is load-bearing, and its absence was a latent
 * defect this file carried from v0.7 until v1.2.** The pattern used to end
 * the opening fence with `[ \t]*\r?\n`, which does not match an info
 * string of more than one word — and this README has one, ` ```ts
 * generated `, introduced by v1.1's own lane. A fence the regex fails to
 * recognize as an *opener* is then matched as the *closer* of the previous
 * block, so every fence after it pairs with the wrong partner and the
 * parity is inverted for the rest of the file.
 *
 * Nothing failed, because every `yaml` block in the repository happens to
 * sit before that fence. Found at v1.2 by adding a ```json block after it
 * and watching the sweep report zero blocks in a file that plainly
 * contained one. Any `yaml` example added to the back half of `README.md`
 * would have been silently skipped, which is exactly the failure mode this
 * whole file exists to prevent.
 */
function blocksTagged(text: string, file: string, tags: ReadonlySet<string>): Block[] {
  const blocks: Block[] = [];
  const fence = /^```(\w*)[^\r\n]*\r?\n([\s\S]*?)^```/gm;
  let match = fence.exec(text);
  while (match !== null) {
    const tag = (match[1] ?? "").toLowerCase();
    if (tags.has(tag)) {
      blocks.push({ file, line: text.slice(0, match.index).split("\n").length, body: match[2] ?? "" });
    }
    match = fence.exec(text);
  }
  return blocks;
}

function yamlBlocks(text: string, file: string): Block[] {
  return blocksTagged(text, file, new Set(["yaml", "yml"]));
}

/**
 * The `json` lane (v1.2, specs/011-json-adapter FR-023). The reasoning is
 * the one this file opens with, applied to a second grammar: an example is
 * worth what executing it costs, and a documented JSON document nobody has
 * ever parsed is prose. Same tag-driven scope, same failure mode, a
 * different adapter — this one calls `parseJsonBytes` directly, because
 * the public `parse()` is hard-wired to YAML (011 spec.md, Out of Scope).
 *
 * No substitution machinery here: the abbreviation rules above exist for
 * blocks `SPEC.md` actually abbreviates, and no JSON block in this
 * repository does. An abbreviated JSON block would fail, loudly, which is
 * the same answer the YAML lane gives an uncovered ellipsis.
 */
function jsonBlocks(text: string, file: string): Block[] {
  return blocksTagged(text, file, new Set(["json"]));
}

/**
 * Ellipsis substitutions, keyed by the exact abbreviated text.
 *
 * Each replacement is the **most ordinary plausible content** for that
 * position, chosen so the resulting document is one an author might really
 * write — a substitution that quietly sidesteps the construct the example
 * is about would defeat the point. `{ … }` becomes a real nested `keys:`
 * mapping *in flow style*, because flow style is what broke five examples;
 * `sha256:9f2c…` becomes a real 64-hex digest, because §6.1's syntax is the
 * thing that block is illustrating.
 */
const SUBSTITUTIONS: readonly (readonly [abbreviated: string, substituted: string, why: string])[] = [
  ["{ … }", "{ host: { demand: { type: string } } }", "§8's delegation example abbreviates a nested `keys:` mapping. The skeleton stays a FLOW mapping, which is the construct W-6 found broken elsewhere."],
  ["sha256:9f2c…", `sha256:${"9f2c".repeat(16)}`, "§9's worked chain abbreviates a digest. Substituted with a real `sha256:<64 hex>` value, matching §6.1's own syntax."],
];

/** Every marker that means "abbreviated" — U+2026, and the ASCII form, which YAML additionally reads as a document-end marker. */
const ELLIPSIS_MARKERS = ["…", "..."];

function substitute(body: string): { readonly text: string; readonly used: readonly string[] } {
  let text = body;
  const used: string[] = [];
  for (const [abbreviated, substituted] of SUBSTITUTIONS) {
    if (text.includes(abbreviated)) {
      used.push(abbreviated);
      text = text.split(abbreviated).join(substituted);
    }
  }
  return { text, used };
}

describe("v0.7 part 2 FR-021a / SC-009 — every documented YAML example parses", () => {
  const blocks = documentationFiles().flatMap((file) => yamlBlocks(readFileSync(file, "utf-8"), file));

  it("finds the blocks at all — a sweep that finds nothing passes vacuously", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(12);
  });

  it("every abbreviated block has a declared substitution — an unmatched ellipsis is a FAILURE, never a skip", () => {
    const uncovered: string[] = [];
    for (const block of blocks) {
      const { text, used } = substitute(block.body);
      if (used.length > 0) continue;
      if (ELLIPSIS_MARKERS.some((marker) => text.includes(marker))) {
        uncovered.push(`${relative(REPO_ROOT, block.file)}:${block.line}`);
      }
    }
    expect(uncovered, "add a substitution rule for each — skipping is exactly how a broken block hides (research.md W-6)").toEqual([]);
  });

  it("every substitution rule is used — a stale rule is dead weight that hides a block it no longer matches", () => {
    const used = new Set(blocks.flatMap((block) => substitute(block.body).used));
    expect([...SUBSTITUTIONS].map(([abbreviated]) => abbreviated).filter((abbreviated) => !used.has(abbreviated))).toEqual([]);
  });

  for (const block of blocks) {
    const label = `${relative(REPO_ROOT, block.file)}:${block.line}`;
    it(`parses ${label}`, () => {
      const { text } = substitute(block.body);
      const origin = createOrigin(label, label);
      const result = parse(ENCODER.encode(text), { origin });
      expect(result.ok, result.ok ? "ok" : `${result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; ")}\n---\n${text}`).toBe(true);
    });
  }
});

describe("v1.2 (011) FR-023 — every documented JSON example parses", () => {
  const blocks = documentationFiles().flatMap((file) => jsonBlocks(readFileSync(file, "utf-8"), file));

  it("finds the blocks at all — a sweep that finds nothing passes vacuously", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(2);
  });

  for (const block of blocks) {
    const label = `${relative(REPO_ROOT, block.file)}:${block.line}`;
    it(`parses ${label}`, () => {
      const origin = createOrigin(label, label);
      const result = parseJsonBytes(ENCODER.encode(block.body), origin);
      expect(result.ok, result.ok ? "ok" : `${result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; ")}\n---\n${block.body}`).toBe(true);
    });
  }

  it("catches a deliberately broken JSON example — a trailing comma, which every JavaScript author's fingers produce", () => {
    const broken = ["```json", '{ "a": 1, }', "```", ""].join("\n");
    const found = jsonBlocks(broken, "synthetic.md");
    expect(found).toHaveLength(1);
    const origin = createOrigin("synthetic.md", "synthetic.md");
    expect(parseJsonBytes(ENCODER.encode(found[0]?.body ?? ""), origin).ok).toBe(false);
  });

  it("and accepts the same example with the comma removed — so it is the break being caught, not the block", () => {
    const fixed = ["```json", '{ "a": 1 }', "```", ""].join("\n");
    const origin = createOrigin("synthetic.md", "synthetic.md");
    expect(parseJsonBytes(ENCODER.encode(jsonBlocks(fixed, "synthetic.md")[0]?.body ?? ""), origin).ok).toBe(true);
  });
});

describe("SC-009 — the sweep fails when a deliberately-broken example is introduced", () => {
  /**
   * The machinery is turned on a synthetic document rather than on the
   * repository, so the proof is permanent instead of a note saying somebody
   * once broke `SPEC.md` on purpose and put it back.
   *
   * The break is **the real one**: an unquoted type expression inside a
   * flow mapping. That is the exact form that sat undetected in five of
   * `SPEC.md`'s examples for six milestones, and a test that only caught,
   * say, a tab-indentation error would not prove this sweep catches the
   * thing it was built for.
   */
  const BROKEN = ["# a deliberately broken example", "```yaml", "keys:", "  styles:", "    demand: { type: resource[] }", "```", ""].join("\n");
  const FIXED = BROKEN.replace("type: resource[]", 'type: "resource[]"');

  it("catches the unquoted-flow-mapping break W-6 found in SPEC.md itself", () => {
    const blocks = yamlBlocks(BROKEN, "synthetic.md");
    expect(blocks).toHaveLength(1);
    const body = blocks[0]?.body ?? "";
    const origin = createOrigin("synthetic.md", "synthetic.md");
    expect(parse(ENCODER.encode(body), { origin }).ok).toBe(false);
  });

  it("and accepts the same example once the quotes are added — so it is the break being caught, not the block", () => {
    const blocks = yamlBlocks(FIXED, "synthetic.md");
    const body = blocks[0]?.body ?? "";
    const origin = createOrigin("synthetic.md", "synthetic.md");
    expect(parse(ENCODER.encode(body), { origin }).ok).toBe(true);
  });

  it("an abbreviated block with no substitution rule is reported, not skipped", () => {
    const abbreviated = ["```yaml", "keys:", "  network:", "    demand: { keys: ⋯unknown⋯ }", "```", ""].join("\n").replace("⋯unknown⋯", "……");
    const blocks = yamlBlocks(abbreviated, "synthetic.md");
    const body = blocks[0]?.body ?? "";
    const { used } = substitute(body);
    expect(used).toEqual([]);
    expect(ELLIPSIS_MARKERS.some((marker) => body.includes(marker))).toBe(true);
    // Which is precisely the condition the second test above turns into a failure.
  });
});


// --- v1.1 (010) FR-039 — the `ts generated` lane -----------------------------
//
// A fenced ```yaml block **immediately** followed by a fenced block whose
// info string is `ts generated` is a pair: the YAML is a single-layer
// schema, and the `ts` block is what `generate()` must produce for it, byte
// for byte after trimming. The `generated` word is the marker, so an
// ordinary ```ts block in the documentation — a consumer snippet, an API
// signature — is not compared against anything.
//
// **The YAML lane above is untouched** (FR-042), and cannot be otherwise:
// its own fence pattern captures the info string as `\w*`, so a
// ```ts generated fence never matched it in the first place. This lane
// brings its own scanner rather than generalizing that one.

interface GeneratedPair {
  readonly file: string;
  readonly line: number;
  readonly yaml: string;
  readonly expected: string;
}

/** Every fenced block, with its info string and its position, so "immediately followed by" can be decided on the text between them. */
function fencedBlocks(text: string): readonly { readonly info: string; readonly body: string; readonly line: number; readonly start: number; readonly end: number }[] {
  const blocks: { info: string; body: string; line: number; start: number; end: number }[] = [];
  const fence = /^```([^\n]*)\r?\n([\s\S]*?)^```[ \t]*$/gm;
  let match = fence.exec(text);
  while (match !== null) {
    blocks.push({
      info: (match[1] ?? "").trim(),
      body: match[2] ?? "",
      line: text.slice(0, match.index).split("\n").length,
      start: match.index,
      end: match.index + match[0].length,
    });
    match = fence.exec(text);
  }
  return blocks;
}

function generatedPairs(text: string, file: string): readonly GeneratedPair[] {
  const blocks = fencedBlocks(text);
  const pairs: GeneratedPair[] = [];
  blocks.forEach((block, index) => {
    const next = blocks[index + 1];
    if (next === undefined || next.info !== "ts generated") {
      return;
    }
    const info = block.info.toLowerCase();
    if (info !== "yaml" && info !== "yml") {
      return;
    }
    // "Immediately followed": only whitespace between the two fences.
    if (text.slice(block.end, next.start).trim() !== "") {
      return;
    }
    pairs.push({ file, line: block.line, yaml: block.body, expected: next.body });
  });
  return pairs;
}

/** What `generate()` produces for one documented schema, read as a single layer. */
function generatedFor(pair: GeneratedPair): string {
  const label = `${relative(REPO_ROOT, pair.file)}:${pair.line}`;
  const origin = createOrigin(label, label);
  const parsed = parse(ENCODER.encode(pair.yaml), { origin });
  if (!parsed.ok) {
    throw new Error(`${label}: the paired YAML does not parse: ${parsed.diagnostics.map((d) => d.message).join("; ")}`);
  }
  const layer: Layer = { identity: { location: label, hash: "0".repeat(64) }, role: "schema", rank: 0, tree: parsed.tree };
  return generate(accumulate([layer]).tree).source;
}

describe("v1.1 FR-039 / SC-008 — every documented `ts generated` block is what the generator actually produces", () => {
  const pairs = documentationFiles().flatMap((file) => generatedPairs(readFileSync(file, "utf-8"), file));

  it("finds the pairs at all — a lane that finds nothing passes vacuously", () => {
    expect(pairs.length).toBeGreaterThanOrEqual(1);
  });

  it("every paired schema is a single layer — a documented pair with `$adopts` would be showing half a chain", () => {
    const adopting = pairs.filter((pair) => /^\$adopts:/m.test(pair.yaml)).map((pair) => `${relative(REPO_ROOT, pair.file)}:${pair.line}`);
    expect(adopting).toEqual([]);
  });

  for (const pair of pairs) {
    const label = `${relative(REPO_ROOT, pair.file)}:${pair.line}`;
    it(`the pair at ${label} matches the generator`, () => {
      expect(generatedFor(pair).trim()).toBe(pair.expected.trim());
    });
  }
});

describe("FR-039 — the lane's own sensitivity, proven on a synthetic mismatch", () => {
  const SCHEMA = ["```yaml", "keys:", "  a:", "    demand: { type: string }", "```", ""].join("\n");

  it("a pair whose `ts` block disagrees with the generator FAILS", () => {
    const broken = `${SCHEMA}${["```ts generated", "export type Configuration = { readonly a?: number };", "```", ""].join("\n")}`;
    const pairs = generatedPairs(broken, "synthetic.md");
    expect(pairs).toHaveLength(1);
    const pair = pairs[0];
    if (pair === undefined) {
      throw new Error("expected one pair");
    }
    expect(generatedFor(pair).trim()).not.toBe(pair.expected.trim());
  });

  it("and the same pair passes once the `ts` block says what the generator says — so it is the mismatch being caught, not the pairing", () => {
    const pairs = generatedPairs(`${SCHEMA}${["```ts generated", "PLACEHOLDER", "```", ""].join("\n")}`, "synthetic.md");
    const pair = pairs[0];
    if (pair === undefined) {
      throw new Error("expected one pair");
    }
    const actual = generatedFor(pair).trim();
    const fixed = generatedPairs(`${SCHEMA}${["```ts generated", actual, "```", ""].join("\n")}`, "synthetic.md")[0];
    if (fixed === undefined) {
      throw new Error("expected one pair");
    }
    expect(generatedFor(fixed).trim()).toBe(fixed.expected.trim());
  });

  it("a `ts` block WITHOUT the `generated` marker is not a pair — not every documented TypeScript is generator output", () => {
    const notAPair = `${SCHEMA}${["```ts", "const x: unknown = 1;", "```", ""].join("\n")}`;
    expect(generatedPairs(notAPair, "synthetic.md")).toEqual([]);
  });

  it("a `ts generated` block separated from its YAML by prose is not a pair either", () => {
    const separated = `${SCHEMA}\nSome prose in between.\n\n${["```ts generated", "export type Configuration = unknown;", "```", ""].join("\n")}`;
    expect(generatedPairs(separated, "synthetic.md")).toEqual([]);
  });
});
