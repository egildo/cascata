/**
 * v1.2 assessment (specs/011-json-adapter/report.md, "What the assessment
 * found") — **the registry is consulted, and this is the test that can tell.**
 *
 * The branch's own parity test resolves `.json` locations through
 * `resolve()`, but every JSON document it uses is also valid YAML, so
 * rewiring `src/index.ts` to hand `.json` bytes to the YAML adapter left
 * the whole suite green — measured by sabotage on 2026-09-02. That is the
 * same defect the milestone diagnosed in the registry itself (a seam proved
 * only on the side that did not need proving), reproduced in its test.
 *
 * The discriminating document is bytes that YAML admits and JSON refuses:
 * `a: 1`. Refusal proves the JSON adapter was the one that looked. Both
 * parse-at-location sites are covered — the entry document, and a
 * delegated fragment grafted by `performGraft` (Article V §8.3, "format
 * freedom").
 */

import { describe, expect, it } from "vitest";
import { resolve } from "../../src/index.js";
import { InMemoryHost } from "./host-test-double.js";

const ENCODER = new TextEncoder();

/** Valid YAML (a one-key block mapping), invalid JSON (no quoted member name). */
const YAML_ONLY = "a: 1\n";

function hostOf(files: Record<string, string>): InMemoryHost {
  return new InMemoryHost({ files: new Map(Object.entries(files).map(([location, text]) => [location, ENCODER.encode(text)] as const)), canonicalizeIsIdentity: true });
}

describe("v1.2 — a .json location is parsed by the JSON adapter, not by whichever adapter came first", () => {
  it("entry document: YAML-only bytes at a .json location are refused as malformed JSON", async () => {
    const result = await resolve("/doc.json", { host: hostOf({ "/doc.json": YAML_ONLY }), sandboxRoot: "/" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable — asserted above");
    expect(result.diagnostics.map((d) => d.code)).toContain("malformed-document");
  });

  it("the same bytes at a .yaml location are accepted, so the refusal above is the adapter's and not the bytes'", async () => {
    const result = await resolve("/doc.yaml", { host: hostOf({ "/doc.yaml": YAML_ONLY }), sandboxRoot: "/" });
    expect(result.ok).toBe(true);
  });

  it("delegated fragment: YAML-only bytes in a grafted .json fragment are refused by the JSON adapter", async () => {
    const host = hostOf({
      "/v/schema.yaml": "$id: guard\nkeys:\n  network:\n    demand:\n      type: mapping\n    delegate: allow\n",
      "/v/config.yaml": "$schema: ./schema.yaml\nnetwork: ./net.json\n",
      "/v/net.json": YAML_ONLY,
    });
    const result = await resolve("/v/config.yaml", { host, sandboxRoot: "/v" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable — asserted above");
    // A fragment that will not parse is reported at the delegation site as
    // `document-unreachable` since v0.6, with the adapter's own diagnostics
    // as `related` — so the adapter's identity is read off the related label.
    const unreachable = result.diagnostics.find((d) => d.code === "document-unreachable");
    expect(unreachable).toBeDefined();
    expect(unreachable?.primary.origin.id).toBe("/v/config.yaml");
    expect(unreachable?.related?.map((r) => r.label).join(" | ")).toMatch(/Expected a JSON value/);
  });

  it("delegated fragment: the same fragment as .yaml grafts, so the refusal above is the adapter's", async () => {
    const host = hostOf({
      "/v/schema.yaml": "$id: guard\nkeys:\n  network:\n    demand:\n      type: mapping\n    delegate: allow\n",
      "/v/config.yaml": "$schema: ./schema.yaml\nnetwork: ./net.yaml\n",
      "/v/net.yaml": YAML_ONLY,
    });
    const result = await resolve("/v/config.yaml", { host, sandboxRoot: "/v" });
    expect(result.ok, result.ok ? "" : result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; ")).toBe(true);
  });
});
