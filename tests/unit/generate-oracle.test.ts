/**
 * v1.1 (010) US6 — **soundness is the conformance rule, and the validator
 * is the oracle.**
 *
 * > Every configuration that validation accepts, projected by Article VII,
 * > inhabits the type generated from its schema chain. — Article VIII
 *
 * The whole file is a *derived* expectation: no case here writes an
 * expected TypeScript text by hand. What is asserted is that the validator
 * and the compiler agree — every accepting corpus case compiles, every
 * purely type-shaped refusal does not — which is the one form of
 * expectation Principle V allows for a generator, since the alternative is
 * copying the generator's own output into a fixture and calling it a test.
 *
 * **Stubbed at US2** with the literal writer's own pair, which is the one
 * thing in this file that *is* hand-written (contract §1 row 8): the
 * harness has to be checked against something before it can be trusted to
 * check anything else. US6 fills in the corpus sweep and the meta-schema
 * round trip.
 */

import { describe, expect, it } from "vitest";
import { toLiteral, compileInMemory, renderProblems } from "./generate-literal.js";
import type { ConfigValue } from "../../src/project/value.js";

describe("contract §1 row 8 — the literal writer, on one hand-written pair", () => {
  /**
   * One value carrying every case the writer has a rule for: a `bigint`
   * (which has no JSON form at all), a key needing quotes, a key that is an
   * ordinary own property only because `project()` uses a null prototype, a
   * nested array, `null`, and a key ordering that ECMA-262 would enumerate
   * differently from §4.2's canonical order.
   */
  const VALUE: ConfigValue = (() => {
    // **Built with a null prototype, and it has to be.** Written as an
    // ordinary object literal, `"__proto__": true` sets the prototype and
    // creates no own property at all, so the fixture would silently be
    // testing a five-key object — which is exactly why `project()` builds
    // the value view with `Object.create(null)` (Article VII, FR-010). The
    // first run of this case caught it, in the test rather than in the
    // writer.
    const built: Record<string, ConfigValue> = Object.create(null);
    built["10"] = "hoisted-by-ecma-262";
    built["__proto__"] = true;
    built["a-key"] = null;
    built["port"] = 8080n;
    built["ratio"] = 1.5;
    built["tags"] = ["x", ["y"]];
    return Object.freeze(built);
  })();

  const EXPECTED = '{ "10": "hoisted-by-ecma-262", "__proto__": true, "a-key": null, "port": 8080n, "ratio": 1.5, "tags": ["x", ["y"]] }';

  it("writes exactly the text the contract's table specifies", () => {
    expect(toLiteral(VALUE)).toBe(EXPECTED);
  });

  it("and that text is TypeScript the compiler accepts against the shape it describes", () => {
    const source = `export type T = {
  readonly "10": string;
  readonly "__proto__": boolean;
  readonly "a-key": null;
  readonly port: bigint;
  readonly ratio: number;
  readonly tags: readonly (string | readonly string[])[];
};
export const value: T = ${EXPECTED};
`;
    const problems = compileInMemory(source);
    expect(problems, renderProblems(problems)).toEqual([]);
  });

  it("`-0` keeps its sign, which `String(-0)` does not", () => {
    expect(toLiteral(-0)).toBe("-0");
    expect(toLiteral(0)).toBe("0");
  });

  it("the compiler harness can fail — a check that never refuses proves nothing", () => {
    expect(compileInMemory(`export const v: string = 1;`).length).toBeGreaterThan(0);
  });
});
