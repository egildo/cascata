/**
 * v1.16.1 (specs/026-shift-and-amend FR-005): a writer's refusal carries the diagnostic's code beside its message,
 * so a caller can tell "the key exists" from "the parent is gone" without reading prose. Hand-derived.
 */

import { describe, expect, it } from "vitest";
import { jsonWriter, yamlWriter } from "../../src/writers.js";

const ENC = new TextEncoder();
const code = (result: { ok: boolean; code?: string }) => (result.ok ? "ok" : result.code);

describe("v1.16.1 FR-005 -- every writer refusal names its code", () => {
  const writer = yamlWriter();
  const bytes = ENC.encode("a: 1\nl: [1]\n");
  it("the one-shot verbs", () => {
    expect(code(writer.locate(bytes, "/x"))).toBe("edit-target-absent");
    expect(code(writer.write(bytes, "/x", 1n))).toBe("edit-target-absent");
  });
  it("an opened document's verbs", () => {
    const opened = writer.open(bytes);
    if (!opened.ok) throw new Error("did not open");
    const doc = opened.document;
    expect(code(doc.locate("/x"))).toBe("edit-target-absent");
    expect(code(doc.write("/x", 1n))).toBe("edit-target-absent");
    expect(code(doc.add("/a", 2n))).toBe("edit-target-exists");
    expect(code(doc.add("/a/b", 2n))).toBe("edit-parent-scalar");
    expect(code(doc.add("/q/b", 2n))).toBe("edit-target-absent");
    expect(code(doc.add("/l/5", 2n))).toBe("edit-target-absent");
    expect(code(doc.remove(""))).toBe("edit-remove-document");
    expect(code(doc.remove("/x"))).toBe("edit-target-absent");
  });
  it("a document that does not parse names the parse's code", () => {
    expect(code(writer.open(ENC.encode("a: [1\n")))).toBe("malformed-document");
    expect(code(jsonWriter().open(ENC.encode('{"a": ')))).toBe("malformed-document");
  });
  it("the message is still there", () => {
    const result = writer.write(bytes, "/x", 1n);
    expect(!result.ok && result.reason.length > 0).toBe(true);
  });
});
