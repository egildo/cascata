/**
 * Direct tests of the harness itself — case.ts's loader and runner.ts's
 * comparison logic — as distinct from corpus.test.ts, which uses the
 * harness to test the *adapter*. These prove tasks.md T051, T053, T054,
 * T055, and T056 hold as properties of the harness, rather than merely
 * being implied by every real corpus case happening to pass.
 *
 * T052 (recursive directory discovery) and T058 (copy-and-edit costs no
 * code) are not re-proven here: corpus.test.ts's own "discovers cases by
 * scanning the corpus directory" assertion, finding every real case
 * across a dozen subdirectories every run, already is that proof: adding
 * this session's several new case files and directories required no
 * change to discoverCaseFiles or its test.
 */

import { describe, expect, it } from "vitest";
import { createNullScalar } from "../../src/model/node.js";
import { createOrigin, createSourceSpan } from "../../src/model/span.js";
import { parseCase } from "./case.js";
import { runCase, type Adapter, type AdapterRegistry, type ParseOutcome } from "./runner.js";

function trivialTree(): ParseOutcome {
  const origin = createOrigin("t", "<t>");
  const span = createSourceSpan({ origin, start: 0, end: 0, line: 1, column: 1, documentLength: 0 });
  return { ok: true, tree: createNullScalar(span) };
}

describe("T053: fails loudly on a case that cannot be interpreted, rather than skipping it", () => {
  it("throws on a case object missing required fields", () => {
    expect(() => parseCase({}, "test-source")).toThrow(/cannot be interpreted/);
  });

  it("throws on a non-canonical 'cites' value", () => {
    expect(() =>
      parseCase({ name: "x", cites: "SPEC.md §4.2", format: "yaml", input: "", expect: { tree: { kind: "null" } } }, "test-source"),
    ).toThrow(/canonical section reference/);
  });

  it("throws on 'expect' naming more than one of tree/diagnostics/equalTo", () => {
    expect(() =>
      parseCase({ name: "x", cites: "§4.2", format: "yaml", input: "", expect: { tree: { kind: "null" }, diagnostics: [] } }, "test-source"),
    ).toThrow(/exactly one/);
  });

  it("throws — rather than silently reporting nothing — when a case names a format with no registered adapter", () => {
    const testCase = parseCase({ name: "x", cites: "§4.2", format: "does-not-exist", input: "a", expect: { tree: { kind: "null" } } }, "test-source");
    expect(() => runCase(testCase, {})).toThrow(/no registered adapter/);
  });
});

describe("T051: the runner selects an adapter purely by the case's `format` field", () => {
  it("dispatches to whichever adapter a made-up format name resolves to, proving no format is hardcoded", () => {
    let received: string | undefined;
    const adapters: AdapterRegistry = {
      "a-made-up-format": ((input) => {
        received = input;
        return trivialTree();
      }) as Adapter,
    };
    const testCase = parseCase(
      { name: "probe", cites: "§4.2", format: "a-made-up-format", input: "probe-input-text", expect: { tree: { kind: "null" } } },
      "test-source",
    );
    const result = runCase(testCase, adapters);
    expect(received).toBe("probe-input-text");
    expect(result.passed).toBe(true);
  });
});

describe("T054: diagnostics are compared as a set — missing and unexpected are both caught", () => {
  const adapters: AdapterRegistry = {
    yaml: ((input) => {
      // A stub, not the real adapter: returns exactly the diagnostics the
      // test wants to assert against, decoupled from actual YAML parsing.
      const origin = createOrigin("t", "<t>");
      const span = createSourceSpan({ origin, start: 0, end: 1, line: 1, column: 1, documentLength: 1 });
      if (input === "one-actual") {
        return { ok: false, diagnostics: [{ code: "malformed-document", message: "stub", primary: span, related: [] }] };
      }
      if (input === "produces-nothing") {
        return { ok: false, diagnostics: [] };
      }
      return trivialTree();
    }) as Adapter,
  };

  it("reports a missing diagnostic when the case expects one the adapter did not produce", () => {
    const testCase = parseCase(
      { name: "x", cites: "§4.2", format: "yaml", input: "produces-nothing", expect: { diagnostics: [{ code: "malformed-document", line: 1, column: 1 }] } },
      "test-source",
    );
    const result = runCase(testCase, adapters);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes("missing expected diagnostic"))).toBe(true);
  });

  it("reports an unexpected diagnostic when the adapter produced one the case did not expect", () => {
    const testCase = parseCase({ name: "x", cites: "§4.2", format: "yaml", input: "one-actual", expect: { diagnostics: [] } }, "test-source");
    const result = runCase(testCase, adapters);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes("unexpected diagnostic"))).toBe(true);
  });
});

describe("T055: selective span assertion by RFC 6901 pointer", () => {
  it("reports a clear failure when a pointer does not resolve in the actual tree", () => {
    const adapters: AdapterRegistry = { yaml: (() => trivialTree()) as Adapter };
    const testCase = parseCase(
      { name: "x", cites: "§4.2", format: "yaml", input: "irrelevant", expect: { tree: { kind: "null" }, spans: [{ pointer: "/does/not/exist", line: 1, column: 1 }] } },
      "test-source",
    );
    const result = runCase(testCase, adapters);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes("no node at that pointer"))).toBe(true);
  });
});

describe("T056: a failure names the case and the expected-versus-actual difference", () => {
  it("includes both the expected and actual value in a span mismatch", () => {
    const origin = createOrigin("t", "<t>");
    const adapters: AdapterRegistry = {
      yaml: (() => {
        const span = createSourceSpan({ origin, start: 5, end: 6, line: 2, column: 3, documentLength: 6 });
        return { ok: true, tree: createNullScalar(span) };
      }) as Adapter,
    };
    const testCase = parseCase(
      { name: "x", cites: "§4.2", format: "yaml", input: "irrelevant", expect: { tree: { kind: "null" }, spans: [{ pointer: "", line: 1, column: 1 }] } },
      "test-source",
    );
    const result = runCase(testCase, adapters);
    expect(result.passed).toBe(false);
    // Names both what was expected (1:1) and what was actually produced (2:3).
    expect(result.failures.some((f) => f.includes("1:1") && f.includes("2:3"))).toBe(true);
  });
});
