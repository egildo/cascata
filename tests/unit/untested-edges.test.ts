/**
 * v1.12.1 — two refusals the v1.12 handoff named "untested though true". Every position is counted by hand
 * from the text beside it.
 */
import { describe, expect, it } from "vitest";
import { generateTypes, validate } from "../../src/index.js";
import { build, files } from "./edit-target-fixture.js";
import { InMemoryHost } from "./host-test-double.js";

async function refusals(schema: string, config: string) {
  const configuration = await build("/virtual/c.yaml", { "/virtual/s.yaml": schema, "/virtual/c.yaml": config });
  const result = validate(configuration);
  if (result.ok) throw new Error("expected a refusal");
  return result.diagnostics.map((d) => [d.code, d.primary.origin.label, d.primary.line, d.primary.column]);
}

// v1.12.1: these were computed since v0.5 and reported nowhere (SPEC.md §15, v1.1 entry); now by validate() and generateTypes().
describe("v1.12.1 — a type entry's own vocabulary", () => {
  const USE = ["keys:", "  a:", "    demand:", "      type: t", ""];
  const rows = [
    { name: "an unknown keyword, at its value (line 5: `    bogus: ` is 11 columns)", entry: ["types:", "  t:", "    demand:", "      type: int", "    bogus: 1"], code: "unknown-type-entry-keyword", line: 5, column: 12 },
    { name: "a demand that is not a mapping (line 3: `    demand: ` is 12 columns)", entry: ["types:", "  t:", "    demand: 5"], code: "malformed-demand-value", line: 3, column: 13 },
    { name: "an accept that is not a list of strings (line 5: `    accept: ` is 12 columns)", entry: ["types:", "  t:", "    demand:", "      type: int", "    accept: 5"], code: "malformed-demand-value", line: 5, column: 13 },
  ];
  for (const row of rows) {
    const schema = [...row.entry, ...USE].join("\n");
    it(`validate(): ${row.name}`, async () => {
      expect(await refusals(schema, "$schema: ./s.yaml\na: 1\n")).toEqual([[row.code, "/virtual/s.yaml", row.line, row.column]]);
    });
    it(`generateTypes(): ${row.name}`, async () => {
      const result = await generateTypes("/virtual/s.yaml", { host: new InMemoryHost({ files: files({ "/virtual/s.yaml": schema }) }), sandboxRoot: "/virtual" });
      expect(result.ok).toBe(false);
      expect(result.diagnostics.filter((d) => d.level === "error").map((d) => [d.code, d.primary.line, d.primary.column])).toEqual([[row.code, row.line, row.column]]);
    });
  }
});

describe("v1.12.1 — a malformed seal", () => {
  it("top level: `seal: sometimes` is malformed-demand-value at `sometimes` (line 1, column 7)", async () => {
    const schema = ["seal: sometimes", "keys:", "  a:", "    demand:", "      type: int", ""].join("\n");
    expect(await refusals(schema, "$schema: ./s.yaml\na: 1\n")).toEqual([["malformed-demand-value", "/virtual/s.yaml", 1, 7]]);
  });

  it("in a demand: `      seal: sometimes` is malformed-demand-value at column 13 (line 5)", async () => {
    const schema = ["keys:", "  a:", "    demand:", "      type: mapping", "      seal: sometimes", ""].join("\n");
    expect(await refusals(schema, "$schema: ./s.yaml\na: {}\n")).toEqual([["malformed-demand-value", "/virtual/s.yaml", 5, 13]]);
  });
});
