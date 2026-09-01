/**
 * v1.0 (009) FR-022, FR-023 / SC-003 — **one call, one type.**
 *
 * `SPEC.md` Article VI's "one call" and Article VII's `load<T>()`. The
 * ordinary embedding is a single call from a launching point to a validated
 * configuration — and, from v1.0, to the **value** a consumer actually
 * reads, beside the node tree rather than instead of it.
 *
 * Three things this file exists to hold still:
 *
 *   - **`T` is the caller's claim and the library never checks it.**
 *     Validation enforces the *schema* against the value; it cannot enforce
 *     the caller's belief about what the schema says. A `T` that disagrees
 *     with its schema is a bug in the calling code, and the v1.x generator
 *     (§14) exists to remove the guesswork. Until then the mismatch is real
 *     and is named here rather than discovered.
 *   - **A projection, never a replacement.** `configuration` stays on the
 *     result, so `why()` still answers by RFC 6901 pointer and every span,
 *     provenance chain and pedigree entry is still reachable.
 *   - **"Never both" is about errors, not diagnostics** (§16, §10). A
 *     successful `load()` carries whatever `info` lints the configuration
 *     earned — including the projection's own — because a result that had
 *     to be discarded to see its warnings would guarantee nobody reads
 *     them.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { load, project, why, type ConfigValue } from "../../src/index.js";
import { createNodeHost } from "../../src/host/node.js";

const CASES = join(__dirname, "..", "corpus", "cases", "numeric");

/** What a tool developer would actually write: the shape they believe the schema chain guarantees. */
interface Budget {
  readonly budget: number;
  readonly name: string;
}

describe("v1.0 FR-022 — load<T>() returns the caller's T, and checks nothing about it", () => {
  it("without a type argument, T is `unknown` — the honest default for an arbitrary schema", async () => {
    const host = createNodeHost();
    const root = join(CASES, "int-vs-float-lexical");
    const result = await load(join(root, "config-int.yaml"), { host, sandboxRoot: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // `unknown` is not `any`: reading a property off it needs a narrowing
    // step, which is exactly the friction the v1.x generator removes. The
    // narrowing is written out here rather than hidden behind a cast so
    // the cost is visible.
    const value: unknown = result.value;
    expect(typeof value).toBe("object");
    expect(Object.getPrototypeOf(value)).toBe(null);
  });

  it("with a T, the configuration is typed T and reads as ordinary data", async () => {
    const host = createNodeHost();
    const root = join(CASES, "lint-through-load");
    const result = await load<Budget>(join(root, "config.yaml"), { host, sandboxRoot: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // SC-003: `config.name` with no node-model knowledge whatsoever.
    expect(result.value.name).toBe("quarterly");
    expect(typeof result.value.budget).toBe("number");
  });

  it("a T that DISAGREES with its schema is accepted silently — the library performs no check of it", async () => {
    const host = createNodeHost();
    const root = join(CASES, "lint-through-load");
    // A deliberately wrong claim: the schema demands `type: string` for
    // `name`, and this asks for a boolean, and names a key the schema
    // never mentions. Article VII: "a `T` that disagrees with its schema
    // is a caller bug the library cannot catch." This case is that
    // sentence, executable — if it ever starts failing, the library has
    // begun checking `T`, which is the v1.x generator's job and not this
    // signature's.
    const result = await load<{ readonly name: boolean; readonly missing: string }>(join(root, "config.yaml"), { host, sandboxRoot: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.every((d) => d.level === "info")).toBe(true);
    // At runtime the value is what the documents said, not what `T`
    // claimed — the type is a claim, and the data is the data.
    const asUnknown: unknown = result.value;
    expect((asUnknown as { readonly name: unknown }).name).toBe("quarterly");
  });
});

describe("v1.0 FR-012 — a projection, never a replacement", () => {
  it("the node tree, provenance and pedigree are all still on the result, and why() still answers by pointer", async () => {
    const host = createNodeHost();
    const root = join(CASES, "lint-through-load");
    const result = await load<Budget>(join(root, "config.yaml"), { host, sandboxRoot: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tree = result.configuration.tree;
    expect(tree.type).toBe("mapping");
    // The lexical kind is still there: the projection does not impose it,
    // and does not erase it either.
    if (tree.type === "mapping") {
      const budget = tree.entries.get("budget");
      expect(budget?.type === "scalar" && budget.kind).toBe("int");
      expect(budget?.span.origin.label.endsWith("config.yaml")).toBe(true);
    }
    const answer = why(result.configuration, "/name");
    expect(answer.kind).toBe("chain");
    expect(result.configuration.pedigree.length).toBeGreaterThan(0);
  });

  it("the value and the tree agree about the data, and disagree only about the numeric type the demand imposed", async () => {
    const host = createNodeHost();
    const root = join(CASES, "lint-through-load");
    const result = await load<Budget>(join(root, "config.yaml"), { host, sandboxRoot: root });
    if (!result.ok) return;
    const tree = result.configuration.tree;
    if (tree.type !== "mapping") return;
    const budget = tree.entries.get("budget");
    expect(budget?.type === "scalar" && budget.value).toBe(9007199254740993n);
    expect(result.value.budget).toBe(9007199254740992);
  });
});

describe("v1.0 §16/§10 — a successful load() carries its lints, including the projection's own", () => {
  it("the precision lint rides along on an ok: true result", async () => {
    const host = createNodeHost();
    const root = join(CASES, "lint-through-load");
    const result = await load<Budget>(join(root, "config.yaml"), { host, sandboxRoot: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lint = result.diagnostics.find((d) => d.code === "precision-narrowed");
    expect(lint).toBeDefined();
    expect(lint?.level).toBe("info");
    expect(lint?.pointer).toBe("/budget");
    // "Never both" has always been about errors, not diagnostics (§16).
    expect(result.diagnostics.some((d) => d.level === "error")).toBe(false);
  });

  it("a configuration with nothing to say carries no diagnostics at all", async () => {
    const host = createNodeHost();
    const root = join(CASES, "int-vs-float-lexical");
    const result = await load(join(root, "config-int.yaml"), { host, sandboxRoot: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
  });
});

describe("v1.0 FR-023 — the value view is reachable independently of load()", () => {
  it("project() on a configuration a caller assembled through the staged calls gives the same value load() would", async () => {
    const host = createNodeHost();
    const root = join(CASES, "lint-through-load");
    const loaded = await load<Budget>(join(root, "config.yaml"), { host, sandboxRoot: root });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // One implementation, two entry points (Principle IV: a stage consumes
    // only the previous stage's output, and `load()` composes the stages
    // rather than reimplementing them).
    const staged = project<Budget>(loaded.configuration);
    expect(staged.value).toEqual(loaded.value);
    expect(staged.diagnostics.map((d) => d.code)).toEqual(loaded.diagnostics.filter((d) => d.code === "precision-narrowed").map((d) => d.code));
  });

  it("the projected value is deeply frozen when it arrives through load(), exactly as through project()", async () => {
    const host = createNodeHost();
    const root = join(CASES, "lint-through-load");
    const result = await load(join(root, "config.yaml"), { host, sandboxRoot: root });
    if (!result.ok) return;
    const value = result.value as Record<string, ConfigValue>;
    expect(Object.isFrozen(value)).toBe(true);
    expect(() => {
      value["name"] = "changed";
    }).toThrow(TypeError);
  });
});
