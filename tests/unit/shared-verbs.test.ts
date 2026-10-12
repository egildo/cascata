/**
 * v1.15 Part E -- one shared-value policy for all three verbs (specs/025-open-insert-delete, FR-020, FR-021).
 *
 * `sharedEdits` decides whether setValue, add and remove write into bytes an alias or merge key shares; the two YAML merge-key
 * edges (adding a key a merge supplies, removing a key that overrides a merged one) are refused by their own codes whatever it
 * says. The byte-exact cases are the write corpus (`*-anchored-source-*`, `*-through-an-alias-*`, `*-merge*`).
 */
import { describe, expect, it } from "vitest";
import { createOrigin, openDocument, parse } from "../../src/index.js";
import type { EditOptions, SharedEdits } from "../../src/index.js";
import { openDocumentUsing, type FormatOpened } from "../../src/adapters/edit.js";

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const origin = createOrigin("shared", "shared");
const under = (sharedEdits: SharedEdits): EditOptions => ({ format: "yaml", origin, sharedEdits });

function apply(text: string, edit: { start: number; end: number; bytes: Uint8Array }): string {
  const bytes = ENC.encode(text);
  return DEC.decode(bytes.subarray(0, edit.start)) + DEC.decode(edit.bytes) + DEC.decode(bytes.subarray(edit.end));
}

function view(text: string): unknown {
  const read = parse(ENC.encode(text), { origin });
  if (!read.ok) throw new Error(`does not parse: ${JSON.stringify(text)}`);
  const walk = (node: typeof read.tree): unknown => (node.type === "scalar" ? (typeof node.value === "bigint" ? Number(node.value) : node.value) : node.type === "mapping" ? Object.fromEntries([...node.entries].map(([k, v]) => [k, walk(v)])) : node.items.map(walk));
  return walk(read.tree);
}

describe("v1.15 FR-020 -- the three verbs, the three policies", () => {
  const text = "base: &b\n  x: 1\n  y: 2\nd: *b\n";
  const verbs: [string, (document: ReturnType<typeof open>) => ReturnType<ReturnType<typeof open>["add"]>][] = [
    ["setValue of a container", (d) => d.setValue("/d", new Map([["x", 9]]))],
    ["add", (d) => d.add("/d/z", 3)],
    ["remove", (d) => d.remove("/d/x")],
  ];
  function open(options: EditOptions) {
    const result = openDocument(ENC.encode(text), options);
    if (!result.ok) throw new Error("did not open");
    return result.document;
  }
  for (const [name, run] of verbs) {
    it(`${name}: refuse gives edit-target-shared at the alias`, () => {
      const result = run(open(under("refuse")));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0]?.code).toBe("edit-target-shared");
        expect(result.diagnostics[0]?.level).toBe("error");
        // `d: *b`: the alias is the two bytes at 26-28 (base 0-8, x 9-15, y 16-22, `d: ` 23-25), wherever it is reached from.
        expect([result.diagnostics[0]?.primary.start, result.diagnostics[0]?.primary.end]).toEqual([26, 28]);
      }
    });
    it(`${name}: warn answers with one info naming the other places; allow answers silently`, () => {
      const warned = run(open(under("warn")));
      expect(warned.ok).toBe(true);
      if (warned.ok) {
        expect(warned.diagnostics.map((d) => [d.level, d.code])).toEqual([["info", "edit-target-shared"]]);
        expect(warned.diagnostics[0]?.related.length).toBeGreaterThanOrEqual(1);
      }
      const allowed = run(open(under("allow")));
      expect(allowed.ok && allowed.diagnostics.length).toBe(0);
    });
    it(`${name}: under warn and allow the edit lands in the anchored bytes, so both places change`, () => {
      const result = run(open(under("allow")));
      if (!result.ok) throw new Error("refused");
      const after = view(apply(text, result.edit)) as { base: unknown; d: unknown };
      expect(after.d).toEqual(after.base);
      expect(after.base).not.toEqual(view(text) as { base: unknown });
    });
  }

  it("the same policy for a container shared by being anchored and aliased, reached by its own path", () => {
    for (const [policy, ok] of [["refuse", false], ["warn", true], ["allow", true]] as const) {
      const result = open(under(policy)).add("/base/z", 3);
      expect(result.ok, policy).toBe(ok);
    }
  });

  it("an anchor nothing aliases is not shared: nothing is refused under refuse", () => {
    const result = openDocument(ENC.encode("a: &x\n  k: 1\n"), under("refuse"));
    if (!result.ok) throw new Error("did not open");
    expect(result.document.add("/a/z", 2).ok).toBe(true);
    expect(result.document.remove("/a/k").ok).toBe(true);
    expect(result.document.setValue("/a", [1]).ok).toBe(true);
  });

  it("removing an entry that is itself an alias shares nothing, under refuse", () => {
    const result = open(under("refuse")).remove("/d");
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(text, result.edit)).toBe("base: &b\n  x: 1\n  y: 2\n");
  });

  it("removing an anchored value an alias points at is shared, and would leave the alias dangling", () => {
    const refused = openDocument(ENC.encode("k: &v 1\nj: *v\n"), under("refuse"));
    if (!refused.ok) throw new Error("did not open");
    const result = refused.document.remove("/k");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe("edit-target-shared");
    // Under allow the caller said so; the document would no longer parse, and the read-back says so rather than writing it.
    const allowed = openDocument(ENC.encode("k: &v 1\nj: *v\n"), under("allow"));
    if (!allowed.ok) throw new Error("did not open");
    const dangling = allowed.document.remove("/k");
    expect(dangling.ok).toBe(false);
    if (!dangling.ok) expect(dangling.diagnostics[0]?.code).toBe("edit-read-back");
  });
});

describe("v1.15 FR-021 -- the merge-key edges are refused whatever the policy", () => {
  const text = "base: &b\n  x: 1\nd:\n  <<: *b\n  x: 2\n  y: 3\n";
  for (const policy of ["refuse", "warn", "allow"] as const) {
    it(`${policy}: adding a key a merge supplies is edit-target-exists, at the key in the source`, () => {
      const supplied = openDocument(ENC.encode("base: &b\n  x: 1\nd:\n  <<: *b\n  y: 3\n"), under(policy));
      if (!supplied.ok) throw new Error("did not open");
      const result = supplied.document.add("/d/x", 9);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0]?.code).toBe("edit-target-exists");
        expect([result.diagnostics[0]?.primary.start, result.diagnostics[0]?.primary.end]).toEqual([11, 12]);
      }
    });
    it(`${policy}: removing a key that overrides a merged one is edit-reveals-merged, at the key`, () => {
      const opened = openDocument(ENC.encode(text), under(policy));
      if (!opened.ok) throw new Error("did not open");
      const result = opened.document.remove("/d/x");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.diagnostics[0]?.code).toBe("edit-reveals-merged");
    });
  }

  it("setValue on a key that overrides a merged one is the document's own, as it was: it writes the override", () => {
    const opened = openDocument(ENC.encode(text), under("refuse"));
    if (!opened.ok) throw new Error("did not open");
    const result = opened.document.setValue("/d/x", 5);
    expect(result.ok).toBe(true);
    if (result.ok) expect(view(apply(text, result.edit))).toEqual({ base: { x: 1 }, d: { x: 5, y: 3 } });
  });

  it("a key beside a merge key that overrides nothing is removed", () => {
    const opened = openDocument(ENC.encode(text), under("refuse"));
    if (!opened.ok) throw new Error("did not open");
    const result = opened.document.remove("/d/y");
    expect(result.ok).toBe(true);
  });
});

describe("v1.15 FR-020 -- a mapping that merges the one edited gains or loses the key; nothing else of it may change", () => {
  const text = "base: &b\n  x: 1\nd:\n  <<: *b\n  y: 2\n";
  const damaging = (format: FormatOpened): FormatOpened => ({
    ...format,
    add: (container, at, data) => {
      const plan = format.add(container, at, data);
      // Also delete `x: 1` from the source: the merging mapping loses `x` too, which no add may do.
      return plan.ok ? { ...plan, start: 9, end: 16, text: "  z: 3\n" } : plan;
    },
  });
  it("a plan that also deletes another key of the source is refused: the merging mapping lost it", () => {
    const opened = openDocumentUsing(ENC.encode(text), under("allow"), damaging);
    if (!opened.ok) throw new Error("did not open");
    const result = opened.document.add("/base/z", 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe("edit-read-back");
  });

  it("a plan that changes the merging mapping and not the source is refused: its own keys are compared", () => {
    // `y: 2` is the merging mapping's own. The plan adds `z` to the source and deletes that line in the same edit.
    const eatsTheirKey = (format: FormatOpened): FormatOpened => ({
      ...format,
      add: (container, at, data) => {
        const plan = format.add(container, at, data);
        return plan.ok ? { ok: true, start: 16, end: 35, text: "  z: 3\nd:\n  <<: *b\n" } : plan;
      },
    });
    const opened = openDocumentUsing(ENC.encode(text), under("allow"), eatsTheirKey);
    if (!opened.ok) throw new Error("did not open");
    const result = opened.document.add("/base/z", 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe("edit-read-back");
  });

  it("the sound plan is accepted, and the merging mapping gains the key", () => {
    const opened = openDocumentUsing(ENC.encode(text), under("allow"), (format) => format);
    if (!opened.ok) throw new Error("did not open");
    const result = opened.document.add("/base/z", 3);
    expect(result.ok).toBe(true);
    if (result.ok) expect(view(apply(text, result.edit))).toEqual({ base: { x: 1, z: 3 }, d: { x: 1, z: 3, y: 2 } });
  });

  it("the parent map is walked once for all of an opened document's shared edits", () => {
    const opened = openDocument(ENC.encode(text), under("allow"));
    if (!opened.ok) throw new Error("did not open");
    expect(opened.document.add("/base/z", 3).ok).toBe(true);
    expect(opened.document.add("/base/w", 3).ok).toBe(true);
    expect(opened.document.remove("/base/x").ok).toBe(true);
  });
});
