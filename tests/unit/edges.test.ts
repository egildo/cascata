/**
 * v1.12 FR-009, FR-010 — the reader's two edges, read rather than written (the writes are write
 * cases). Every span is counted by hand from the bytes beside it.
 */
import { describe, expect, it } from "vitest";
import { parse } from "../../src/index.js";
import type { Node } from "../../src/model/node.js";

const origin = { id: "edges", label: "<edges>" };

function read(bytes: Uint8Array | string): Node {
  const result = parse(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes, { origin });
  if (!result.ok) throw new Error(result.diagnostics.map((d) => d.code).join(", "));
  return result.tree;
}

const where = (node: Node | undefined) => (node === undefined ? undefined : [node.span.start, node.span.end, node.span.line, node.span.column]);
const entry = (node: Node, key: string) => (node.type === "mapping" ? node.entries.get(key) : undefined);

describe("v1.12 FR-009 — an empty document is located after its marks", () => {
  it("a mark alone (EF BB BF): null at 3..3, line 1, column 1", () => {
    const tree = read(Uint8Array.from([0xef, 0xbb, 0xbf]));
    expect(tree.type === "scalar" && tree.kind).toBe("null");
    expect(where(tree)).toEqual([3, 3, 1, 1]);
  });

  it("a mark and `# c\\n`: null at 3..3", () => {
    expect(where(read(Uint8Array.from([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x63, 0x0a])))).toEqual([3, 3, 1, 1]);
  });

  it("no mark: 0..0, as before", () => {
    expect(where(read("# c\n"))).toEqual([0, 0, 1, 1]);
    expect(where(read(""))).toEqual([0, 0, 1, 1]);
  });
});

describe("v1.12 FR-010 — a key with no value is a null", () => {
  it("`? a` reads {a: null}, the null at the end of the key (?0 sp1 a2 → 3..3, column 4)", () => {
    const value = entry(read("? a\n"), "a");
    expect(value?.type === "scalar" && value.kind).toBe("null");
    expect(where(value)).toEqual([3, 3, 1, 4]);
  });

  it("`{a}` reads {a: null} too ({0 a1 → 2..2)", () => {
    const value = entry(read("{a}\n"), "a");
    expect(value?.type === "scalar" && value.kind).toBe("null");
    expect(where(value)).toEqual([2, 2, 1, 3]);
  });

  it("three states stay distinguishable (§4.2): `? a` and `a:` are null, `{}` has no key, `a: ''` is a string", () => {
    expect(entry(read("? a\n"), "a")).toBeDefined();
    expect(entry(read("a:\n"), "a")?.type).toBe("scalar");
    expect(entry(read("{}\n"), "a")).toBeUndefined();
    const empty = entry(read("a: ''\n"), "a");
    expect(empty?.type === "scalar" && empty.kind).toBe("string");
  });

  it("a duplicate bare key is still a duplicate", () => {
    const result = parse(new TextEncoder().encode("? a\n? a\n"), { origin });
    expect(result.ok ? [] : result.diagnostics.map((d) => d.code)).toEqual(["duplicate-key"]);
  });
});
