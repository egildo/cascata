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
import { parse } from "../../src/index.js";
import { createOrigin } from "../../src/model/span.js";

const REPO_ROOT = join(__dirname, "..", "..");
const ENCODER = new TextEncoder();

/** `SPEC.md`, `README.md`, and every `specs/**\/*.md` — FR-021a's own list. */
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
function yamlBlocks(text: string, file: string): Block[] {
  const blocks: Block[] = [];
  const fence = /^```(\w*)[ \t]*\r?\n([\s\S]*?)^```/gm;
  let match = fence.exec(text);
  while (match !== null) {
    const tag = (match[1] ?? "").toLowerCase();
    if (tag === "yaml" || tag === "yml") {
      blocks.push({ file, line: text.slice(0, match.index).split("\n").length, body: match[2] ?? "" });
    }
    match = fence.exec(text);
  }
  return blocks;
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
