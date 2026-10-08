/**
 * v1.11 FR-005 — `yamlWriter()` and `jsonWriter()`, from `@egildo/cascata/writers`: `locate` and
 * `setValue` in the shape a source-graph library's editing stage expects, with a synthetic origin
 * and no behaviour of their own. The equivalence cases run every v1.10 write case through both.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { locate, setValue, createOrigin } from "../../src/index.js";
import type { Diagnostic, EditValue } from "../../src/index.js";
import { jsonWriter, yamlWriter } from "../../src/writers.js";
import { loadWriteCase, writeSourceOf } from "../corpus/write-case.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CASES = join(ROOT, "tests", "corpus", "write-cases");
const ENCODER = new TextEncoder();

describe("v1.11 FR-005 — claims", () => {
  it("yamlWriter claims .yaml and .yml in any case, and nothing else", () => {
    const writer = yamlWriter();
    for (const location of ["/a/b.yaml", "b.yml", "/a/B.YAML", "c.Yml", "https://example.test/x.yaml", "/a.json.yaml"]) {
      expect(writer.claims(location), location).toBe(true);
    }
    for (const location of ["/a/b.json", "b", "/a/yaml", "/a.yaml.json", "", "/a/b.yaml/", "b.yamll", ".yaml.bak"]) {
      expect(writer.claims(location), location).toBe(false);
    }
  });

  it("jsonWriter claims .json in any case, and nothing else", () => {
    const writer = jsonWriter();
    for (const location of ["/a/b.json", "B.JSON", "x.packet.json", "/a.yaml.json"]) {
      expect(writer.claims(location), location).toBe(true);
    }
    for (const location of ["/a/b.yaml", "b.yml", "b", "/a/json", "/a.json.yaml", "", "b.jsonl"]) {
      expect(writer.claims(location), location).toBe(false);
    }
  });

  it("no two writers claim one location", () => {
    for (const location of ["a.yaml", "a.yml", "a.json", "a.YAML", "a.JSON", "a"]) {
      expect([yamlWriter(), jsonWriter()].filter((w) => w.claims(location)).length, location).toBeLessThanOrEqual(1);
    }
  });
});

describe("v1.11 FR-005 — the shape", () => {
  it("a writer is exactly claims, locate and write", () => {
    expect(Object.keys(yamlWriter()).sort()).toEqual(["claims", "locate", "write"]);
    expect(Object.keys(jsonWriter()).sort()).toEqual(["claims", "locate", "write"]);
  });

  it("YAML: `a: 1` is bytes 3-4; writing 2 replaces exactly them", () => {
    const bytes = ENCODER.encode("a: 1\n");
    expect(yamlWriter().locate(bytes, "/a")).toEqual({ ok: true, start: 3, end: 4 });
    const written = yamlWriter().write(bytes, "/a", 2);
    expect(written).toEqual({ ok: true, edit: { start: 3, end: 4, bytes: ENCODER.encode("2") }, diagnostics: [] });
  });

  it("JSON: `{\"a\": 1}` is bytes 6-7; writing 2.5 replaces exactly them", () => {
    const bytes = ENCODER.encode('{"a": 1}');
    expect(jsonWriter().locate(bytes, "/a")).toEqual({ ok: true, start: 6, end: 7 });
    expect(jsonWriter().write(bytes, "/a", 2.5)).toEqual({ ok: true, edit: { start: 6, end: 7, bytes: ENCODER.encode("2.5") }, diagnostics: [] });
  });

  it("a refusal is { ok: false, reason } with the first diagnostic's message — absent, container, unreadable", () => {
    const yaml = yamlWriter();
    const bytes = ENCODER.encode("a:\n  b: 1\n");
    const absent = yaml.locate(bytes, "/zzz");
    expect(absent.ok).toBe(false);
    if (!absent.ok) expect(absent.reason).toContain("zzz");
    const container = yaml.write(bytes, "/a", 1);
    expect(container.ok).toBe(false);
    if (!container.ok) expect(container.reason).toMatch(/mapping/);
    const unreadable = yaml.locate(ENCODER.encode("a: [1, 2\n"), "/a");
    expect(unreadable.ok).toBe(false);
    if (!unreadable.ok) expect(typeof unreadable.reason).toBe("string");
  });
});

describe("v1.11 FR-005 — equivalence with locate and setValue over every v1.10 write case", () => {
  const files = readdirSync(CASES).filter((name) => name.endsWith(".json")).sort();
  const origin = createOrigin("other", "other");

  it("there are cases to run", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  for (const file of files) {
    const testCase = loadWriteCase(join(CASES, file));
    const bytes = writeSourceOf(testCase);
    // v1.12: each made under the case's own policy.
    const writer = testCase.format === "yaml" ? yamlWriter({ sharedEdits: testCase.sharedEdits }) : jsonWriter({ sharedEdits: testCase.sharedEdits });

    it(`${testCase.name}: locate`, () => {
      const direct = locate(bytes, { format: testCase.format, origin }, testCase.pointer);
      const viaWriter = writer.locate(bytes, testCase.pointer);
      if (direct.ok) {
        expect(viaWriter).toEqual({ ok: true, start: direct.start, end: direct.end });
      } else {
        expect(viaWriter).toEqual({ ok: false, reason: direct.diagnostics[0]?.message });
      }
    });

    if (testCase.call === "setValue") {
      it(`${testCase.name}: write`, () => {
        const value = testCase.value as EditValue;
        const direct = setValue(bytes, { format: testCase.format, origin, sharedEdits: testCase.sharedEdits }, testCase.pointer, value);
        const viaWriter = writer.write(bytes, testCase.pointer, value);
        if (direct.ok) {
          // The diagnostics' origins differ (the writer's is synthetic); everything else is the same.
          const plain = (ds: readonly Diagnostic[]) => ds.map((d) => [d.level, d.code, d.message, d.primary.start, d.primary.end, d.related.map((r) => [r.label, r.span.start, r.span.end])]);
          expect(viaWriter.ok && { ...viaWriter, diagnostics: plain(viaWriter.diagnostics) }).toEqual({ ok: true, edit: direct.edit, diagnostics: plain(direct.diagnostics) });
        } else {
          expect(viaWriter).toEqual({ ok: false, reason: direct.diagnostics[0]?.message });
        }
      });
    }
  }
});

describe("v1.11 FR-005 — the writers module imports nothing but the two verbs, the extension rule and the origin", () => {
  it("and names no other library", () => {
    const text = readFileSync(join(ROOT, "src", "writers.ts"), "utf-8");
    const specifiers = [...text.matchAll(/(?:import|export)[^'";]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specifiers.sort()).toEqual(["./adapters/edit.js", "./adapters/registry.js", "./model/span.js"]);
  });
});

describe("v1.11 FR-006 — the entry point", () => {
  it("package.json exports ./writers and ./writers.js, as paths has", () => {
    const manifest: unknown = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
    const exportsField = (manifest as { exports: Record<string, unknown> }).exports;
    const expected = { types: "./dist/writers.d.ts", import: "./dist/writers.js" };
    expect(exportsField["./writers"]).toEqual(expected);
    expect(exportsField["./writers.js"]).toEqual(expected);
  });
});
