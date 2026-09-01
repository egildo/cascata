/**
 * v0.7 US6, SPEC.md §7, §16, §8.1 — `resource(configuration, pointer)`.
 * FR-035 through FR-039.
 */
import { describe, expect, it } from "vitest";
import { join, resolve as resolvePath } from "node:path";
import { load, resource } from "../../src/index.js";
import { createNodeHost, createNodeTransport } from "../../src/host/node.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { makeTempCacheDir, removeTempCacheDir } from "./remote-test-helpers.js";
import type { MergedConfiguration } from "../../src/index.js";

const CASES_DIR = join(__dirname, "..", "corpus", "cases", "resource");

async function loadCertified(entry: string, sandboxRoot: string): Promise<MergedConfiguration> {
  const result = await load(entry, { host: createNodeHost(), sandboxRoot });
  if (!result.ok) {
    throw new Error(`expected load() ok:true: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.configuration;
}

describe("v0.7 FR-035 — a path value's resolved location is available, against the directory of the document that declared it", () => {
  it("basic: a config-declared path resolves against the config's own directory", async () => {
    const dir = join(CASES_DIR, "basic");
    const configuration = await loadCertified(join(dir, "config.yaml"), dir);
    const resolved = resource(configuration, "/logo");
    expect(resolved).toEqual({ kind: "path", location: resolvePath(dir, "images/logo.png") });
  });
});

describe("v0.7 FR-036 — a url value resolves to itself", () => {
  it("basic: homepage resolves to the literal URL string, untouched", async () => {
    const dir = join(CASES_DIR, "basic");
    const configuration = await loadCertified(join(dir, "config.yaml"), dir);
    const resolved = resource(configuration, "/homepage");
    expect(resolved).toEqual({ kind: "url", location: "https://example.com/" });
  });
});

describe("v0.7 FR-035/SC-006 — a path provided by an ancestor layer in a different directory resolves against the ANCESTOR's directory, not the config's", () => {
  it("ancestor-path: 'stylesheet', never touched by the config, resolves against the house schema's own directory", async () => {
    const houseDir = join(CASES_DIR, "ancestor-path", "house");
    const projectDir = join(CASES_DIR, "ancestor-path", "project");
    const configuration = await loadCertified(join(projectDir, "config.yaml"), join(CASES_DIR, "ancestor-path"));
    const resolved = resource(configuration, "/stylesheet");
    // The discriminating assertion: NOT resolvePath(projectDir, ...) -- that would be the bug this test exists to catch.
    expect(resolved).toEqual({ kind: "path", location: resolvePath(houseDir, "assets/theme.css") });
  });
});

describe("v0.7 FR-037 — a value declared inside a delegated fragment resolves against the FRAGMENT's own directory", () => {
  it("delegated-fragment-path: 'network.cert' resolves against fragments/, not the config's own directory", async () => {
    const dir = join(CASES_DIR, "delegated-fragment-path");
    const configuration = await loadCertified(join(dir, "config.yaml"), dir);
    const resolved = resource(configuration, "/network/cert");
    expect(resolved).toEqual({ kind: "path", location: resolvePath(dir, "fragments", "certs/server.pem") });
  });
});

describe("v0.7 FR-038 — a resource path resolving outside the sandbox root is NOT refused; the resolved location is reported anyway", () => {
  it("outside-sandbox: load() itself succeeds (the value is data, not an instruction to load), and resource() reports the escaping location honestly", async () => {
    const dir = join(CASES_DIR, "outside-sandbox", "sandbox");
    const configuration = await loadCertified(join(dir, "config.yaml"), dir);
    const resolved = resource(configuration, "/asset");
    expect(resolved).toEqual({ kind: "path", location: resolvePath(dir, "../../outside/secret.css") });
    // The resolved location is genuinely outside the sandbox root, confirming this is a real escape, not a vacuous case.
    expect(resolved.kind === "path" ? resolved.location.startsWith(dir) : true).toBe(false);
  });
});

describe("v0.7 FR-039 — resolution is lexical: nothing is read, existence is never checked", () => {
  it("nonexistent-path: a path naming a file that does not exist anywhere still resolves, with no error", async () => {
    const dir = join(CASES_DIR, "nonexistent-path");
    const configuration = await loadCertified(join(dir, "config.yaml"), dir);
    const resolved = resource(configuration, "/asset");
    expect(resolved).toEqual({ kind: "path", location: resolvePath(dir, "does/not/exist.css") });
  });
});

describe("Edge Cases — a resource path in a document reached over https://", () => {
  // The declaring document must be the REMOTE schema, not the local config
  // -- `logo` is left unset by the config so the merged value keeps the
  // schema's own `provide` and its own (remote) span.
  const SCHEMA_BYTES = new TextEncoder().encode("keys:\n  logo:\n    demand:\n      type: path\n    provide: images/remote-logo.png\n");
  const URL = "https://example.test/remote-resource-schema.yaml";

  it("resolves against the schema's own URL, not a filesystem path", async () => {
    const cacheDir = makeTempCacheDir();
    const configDir = makeTempCacheDir();
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(configDir, "config.yaml"), `$schema: ${URL}\ntitle: hello\n`);
      const recording: Recording = { url: URL, method: "GET", outcome: { kind: "response", response: { status: 200, headers: {}, body: SCHEMA_BYTES } } };
      const result = await load(join(configDir, "config.yaml"), { host: createNodeHost({ cacheDir }), sandboxRoot: configDir, transport: new RecordedTransport([recording]) });
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const resolved = resource(result.configuration, "/logo");
      expect(resolved).toEqual({ kind: "path", location: new globalThis.URL("images/remote-logo.png", URL).toString() });
    } finally {
      removeTempCacheDir(cacheDir);
      removeTempCacheDir(configDir);
    }
  });
});

describe("v0.7 — unknown-pointer and not-a-resource", () => {
  it("a pointer naming nothing in the tree answers unknown-pointer", async () => {
    const dir = join(CASES_DIR, "basic");
    const configuration = await loadCertified(join(dir, "config.yaml"), dir);
    expect(resource(configuration, "/does-not-exist")).toEqual({ kind: "unknown-pointer" });
  });

  it("createNodeTransport exists and is exported (smoke — it is deliberately untested beyond construction, matching v0.2's createNetworkTransport precedent: no test in this codebase performs real network access)", () => {
    expect(typeof createNodeTransport).toBe("function");
    expect(typeof createNodeTransport()).toBe("object");
  });
});
