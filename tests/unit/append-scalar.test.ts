/**
 * v1.8 (016) — **a scalar under `append` is a list of one.**
 *
 * Issue #3, reported by BelType on v1.6.0. A key under `cascade: append`
 * refused every contribution that was not a sequence, and the commonest
 * contribution to an accumulated list — one stylesheet, one component — is
 * a scalar. `styles: ./report.css` is what an author writes first;
 * `styles: [./report.css]` is what they write after reading the error.
 *
 * Every expected value here is derived by hand from `SPEC.md` §5.2's
 * accumulation rule and §5.3's amended paragraph, and from the fixture text
 * in each case (line and column counted off the string literal that
 * produced them), never read off a run. The file was written and watched
 * red before `src/merge/` knew what a wrap was.
 *
 * The posture is `precision-narrowed`'s (§17, `src/diagnostics/codes.ts`):
 * the value is changed, the author is told at their own position, the build
 * continues. Never silent.
 */

import { describe, expect, it } from "vitest";
import { load, merge, resolve, why } from "../../src/index.js";
import type { Diagnostic } from "../../src/diagnostics/diagnostic.js";
import { InMemoryHost } from "./host-test-double.js";

const ENCODER = new TextEncoder();

function host(files: Record<string, string>): InMemoryHost {
  return new InMemoryHost({ files: new Map(Object.entries(files).map(([location, text]) => [location, ENCODER.encode(text)])) });
}

function codesOf(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

/** The one diagnostic with `code`, or a failure naming what was actually there — an assertion helper, so a missing notice reads as a missing notice rather than as `undefined`. */
function only(diagnostics: readonly Diagnostic[], code: string): Diagnostic {
  const found = diagnostics.filter((diagnostic) => diagnostic.code === code);
  expect(found.length, `expected exactly one '${code}', got [${codesOf(diagnostics).join(", ")}]`).toBe(1);
  return found[0] as Diagnostic;
}

// A schema that accumulates `styles` and demands nothing of it, so the
// fold's behaviour is observed with no validation in the way.
const APPEND_ONLY = "keys:\n  styles:\n    cascade: append\n";

// `styles: ./report.css` — "styles:" is columns 1-7, the space is 8, so the
// scalar starts at column 9 of line 2. Counted, not measured.
const CONFIG_SCALAR = "$schema: ./schema.yaml\nstyles: ./report.css\n";

describe("v1.8 FR-001/FR-002 — a scalar contribution is taken as a list of one, and the author is told", () => {
  it("folds to a one-item sequence and reports exactly one info at the scalar's own span", async () => {
    const result = await load<{ readonly styles: readonly string[] }>("/v/config.yaml", {
      host: host({ "/v/config.yaml": CONFIG_SCALAR, "/v/schema.yaml": APPEND_ONLY }),
      sandboxRoot: "/v",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.styles).toEqual(["./report.css"]);
    const notice = only(result.diagnostics, "append-scalar-wrapped");
    expect(notice.level).toBe("info");
    expect(notice.primary.origin.id).toBe("/v/config.yaml");
    expect(notice.primary.line).toBe(2);
    expect(notice.primary.column).toBe(9);
  });

  it("the message names the key, the value as written, and the explicit spelling", async () => {
    const result = await load("/v/config.yaml", {
      host: host({ "/v/config.yaml": CONFIG_SCALAR, "/v/schema.yaml": APPEND_ONLY }),
      sandboxRoot: "/v",
    });

    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const message = only(result.diagnostics, "append-scalar-wrapped").message;
    expect(message).toContain("'styles'");
    expect(message).toContain("cascade: append");
    expect(message).toContain("'./report.css'");
    expect(message).toContain("[./report.css]");
  });

  it("info never makes the call ok:false, and the tree is not discarded for it (v0.7 FR-002)", async () => {
    const resolved = await resolve("/v/config.yaml", {
      host: host({ "/v/config.yaml": CONFIG_SCALAR, "/v/schema.yaml": APPEND_ONLY }),
      sandboxRoot: "/v",
    });
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics));

    const merged = merge(resolved);

    expect(merged.ok).toBe(true);
    if (!merged.ok) throw new Error(JSON.stringify(merged.diagnostics));
    expect(codesOf(merged.diagnostics)).toEqual(["append-scalar-wrapped"]);
  });

  it("a null scalar is wrapped like any other — [null], not a special case", async () => {
    const result = await load<{ readonly styles: readonly unknown[] }>("/v/config.yaml", {
      host: host({ "/v/config.yaml": "$schema: ./schema.yaml\nstyles: null\n", "/v/schema.yaml": APPEND_ONLY }),
      sandboxRoot: "/v",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.styles).toEqual([null]);
    expect(codesOf(result.diagnostics)).toContain("append-scalar-wrapped");
  });

  it("a sequence under append is untouched — no notice, same tree as v1.7", async () => {
    const result = await load<{ readonly styles: readonly string[] }>("/v/config.yaml", {
      host: host({ "/v/config.yaml": "$schema: ./schema.yaml\nstyles: [./report.css]\n", "/v/schema.yaml": APPEND_ONLY }),
      sandboxRoot: "/v",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.styles).toEqual(["./report.css"]);
    expect(codesOf(result.diagnostics)).not.toContain("append-scalar-wrapped");
  });

  it("a scalar under replace is a scalar — only append promises a list (out of scope, pinned)", async () => {
    const result = await load<{ readonly styles: string }>("/v/config.yaml", {
      host: host({ "/v/config.yaml": CONFIG_SCALAR, "/v/schema.yaml": "keys:\n  styles:\n    cascade: replace\n" }),
      sandboxRoot: "/v",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.styles).toBe("./report.css");
    expect(codesOf(result.diagnostics)).not.toContain("append-scalar-wrapped");
  });
});

describe("v1.8 FR-003 — the wrapped item extends the inherited list, in rank order", () => {
  it("a root schema's [a.css] plus a config's scalar is [a.css, ./b.css], in that order", async () => {
    const result = await load<{ readonly styles: readonly string[] }>("/v/config.yaml", {
      host: host({
        "/v/config.yaml": "$schema: ./schema.yaml\nstyles: ./b.css\n",
        "/v/schema.yaml": "keys:\n  styles:\n    cascade: append\n    provide:\n      - ./a.css\n",
      }),
      sandboxRoot: "/v",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.styles).toEqual(["./a.css", "./b.css"]);
  });

  it("a scalar never replaces an inherited list — §5.2's monotonicity, stated as a test", async () => {
    const result = await load<{ readonly styles: readonly string[] }>("/v/config.yaml", {
      host: host({
        "/v/config.yaml": "$schema: ./mid.yaml\nstyles: ./c.css\n",
        "/v/mid.yaml": "$adopts: ./root.yaml\nkeys:\n  styles:\n    provide:\n      - ./b.css\n",
        "/v/root.yaml": "keys:\n  styles:\n    cascade: append\n    provide:\n      - ./a.css\n",
      }),
      sandboxRoot: "/v",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.styles).toEqual(["./a.css", "./b.css", "./c.css"]);
  });
});

// `    provide: a-scalar` — four spaces, "provide:" spans columns 5-12, the
// space is 13, so the scalar starts at column 14 of line 3.
const ROOT_SCALAR_UNDER_REPLACE = "keys:\n  styles:\n    provide: a-scalar\n";

describe("v1.8 FR-004 — a scalar pre-existing the transition to append is wrapped, noticed at the ancestor", () => {
  it("wraps the value the fold already had when a descendant first declares append", async () => {
    const result = await load<{ readonly styles: readonly string[] }>("/v/config.yaml", {
      host: host({
        "/v/config.yaml": "$schema: ./mid.yaml\n",
        "/v/mid.yaml": "$adopts: ./root.yaml\nkeys:\n  styles:\n    cascade: append\n",
        "/v/root.yaml": ROOT_SCALAR_UNDER_REPLACE,
      }),
      sandboxRoot: "/v",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.styles).toEqual(["a-scalar"]);
    const notice = only(result.diagnostics, "append-scalar-wrapped");
    // The document that WROTE the value, not the one that declared the
    // strategy — the rule `append-over-non-sequence` already followed.
    expect(notice.primary.origin.id).toBe("/v/root.yaml");
    expect(notice.primary.line).toBe(3);
    expect(notice.primary.column).toBe(14);
  });

  it("a later layer then accumulates onto the wrapped value rather than replacing it", async () => {
    const result = await load<{ readonly styles: readonly string[] }>("/v/config.yaml", {
      host: host({
        "/v/config.yaml": "$schema: ./mid.yaml\nstyles: [./late.css]\n",
        "/v/mid.yaml": "$adopts: ./root.yaml\nkeys:\n  styles:\n    cascade: append\n",
        "/v/root.yaml": ROOT_SCALAR_UNDER_REPLACE,
      }),
      sandboxRoot: "/v",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.styles).toEqual(["a-scalar", "./late.css"]);
  });
});

describe("v1.8 FR-005 — a mapping has no one-item reading and is still refused", () => {
  it("a mapping freshly contributed under append is append-over-non-sequence, error", async () => {
    const result = await load("/v/config.yaml", {
      host: host({ "/v/config.yaml": "$schema: ./schema.yaml\nstyles:\n  bad: value\n", "/v/schema.yaml": APPEND_ONLY }),
      sandboxRoot: "/v",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(codesOf(result.diagnostics)).toEqual(["append-over-non-sequence"]);
    expect(result.diagnostics[0]?.level).toBe("error");
  });

  it("a mapping pre-existing the transition is refused too — both moments still refuse it", async () => {
    const result = await load("/v/config.yaml", {
      host: host({
        "/v/config.yaml": "$schema: ./mid.yaml\n",
        "/v/mid.yaml": "$adopts: ./root.yaml\nkeys:\n  styles:\n    cascade: append\n",
        "/v/root.yaml": "keys:\n  styles:\n    provide:\n      bad: value\n",
      }),
      sandboxRoot: "/v",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(codesOf(result.diagnostics)).toEqual(["append-over-non-sequence"]);
    expect(result.diagnostics[0]?.primary.origin.id).toBe("/v/root.yaml");
  });

  it("the refusal no longer claims a scalar is refused", async () => {
    const result = await load("/v/config.yaml", {
      host: host({ "/v/config.yaml": "$schema: ./schema.yaml\nstyles:\n  bad: value\n", "/v/schema.yaml": APPEND_ONLY }),
      sandboxRoot: "/v",
    });

    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics[0]?.message).toContain("mapping");
    expect(result.diagnostics[0]?.message).not.toMatch(/not a sequence/);
  });
});

describe("v1.8 FR-006 — the fold does not consult the demand; the demand refuses the item afterwards", () => {
  it("wraps and notices, and the item is then refused by its own demand at the scalar's span", async () => {
    // `styles: 42` — the scalar starts at column 9 of line 2.
    //
    // The spec's scenario writes `demand: { type: "resource[]" }`, which is
    // BelType's own named type: `resource` is declared in SPEC.md §7's
    // worked example, not a built-in, so a standalone fixture naming it is
    // refused as `unknown-type-name` by the type namespace before the item
    // demand is ever reached (measured — see the report). `string[]`
    // exercises the identical path with a built-in: the wrap produces
    // `[42]`, and `42` is not a string.
    const result = await load("/v/config.yaml", {
      host: host({
        "/v/config.yaml": "$schema: ./schema.yaml\nstyles: 42\n",
        "/v/schema.yaml": "keys:\n  styles:\n    cascade: append\n    demand:\n      type: \"string[]\"\n",
      }),
      sandboxRoot: "/v",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const codes = codesOf(result.diagnostics);
    // Both present: the wrap happened, and the demand then refused what it
    // wrapped. The call fails on the error, never on the notice.
    expect(codes).toContain("append-scalar-wrapped");
    expect(codes.filter((code) => code !== "append-scalar-wrapped")).not.toEqual([]);
    const refusal = result.diagnostics.find((diagnostic) => diagnostic.level === "error");
    expect(refusal?.primary.origin.id).toBe("/v/config.yaml");
    expect(refusal?.primary.line).toBe(2);
    expect(refusal?.primary.column).toBe(9);
  });

  it("a scalar the demand does admit passes, with the notice alongside", async () => {
    const result = await load<{ readonly styles: readonly string[] }>("/v/config.yaml", {
      host: host({
        "/v/config.yaml": CONFIG_SCALAR,
        "/v/schema.yaml": "keys:\n  styles:\n    cascade: append\n    demand:\n      type: \"string[]\"\n",
      }),
      sandboxRoot: "/v",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.styles).toEqual(["./report.css"]);
    expect(codesOf(result.diagnostics)).toContain("append-scalar-wrapped");
  });
});

describe("v1.8 FR-007 — why() on the wrapped item names the scalar's own document and line", () => {
  it("answers with the author's own position, not the schema that declared append", async () => {
    const result = await load("/v/config.yaml", {
      host: host({ "/v/config.yaml": CONFIG_SCALAR, "/v/schema.yaml": APPEND_ONLY }),
      sandboxRoot: "/v",
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));

    const answer = why(result.configuration, "/styles/0");

    expect(answer.kind).toBe("chain");
    if (answer.kind !== "chain") throw new Error("unreachable");
    const last = answer.entries[answer.entries.length - 1];
    expect(last?.span.origin.id).toBe("/v/config.yaml");
    expect(last?.span.line).toBe(2);
    expect(last?.span.column).toBe(9);
  });

  it("the synthetic sequence itself is attributed to the same layer", async () => {
    const result = await load("/v/config.yaml", {
      host: host({ "/v/config.yaml": CONFIG_SCALAR, "/v/schema.yaml": APPEND_ONLY }),
      sandboxRoot: "/v",
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));

    const answer = why(result.configuration, "/styles");

    expect(answer.kind).toBe("chain");
    if (answer.kind !== "chain") throw new Error("unreachable");
    expect(answer.entries[answer.entries.length - 1]?.span.origin.id).toBe("/v/config.yaml");
  });
});
