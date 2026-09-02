/**
 * v1.4 (013) FR-001 through FR-006 — a host-resolvable identity, through
 * the one call and at the edges the resolve-conformance corpus cannot
 * reach: a host with no namespace at all, a located document that is
 * *remote*, an `$id` written in the same shape (which is never resolved),
 * and a delegation target (whose scheme handling this milestone leaves
 * alone).
 *
 * The corpus (`tests/corpus/resolve-cases/host-identity-*.json`) pins the
 * two routes BelType needs — the launching option and a venue's
 * `$adopts` — against the real Node host wearing a namespace. This file
 * pins what that format has no field for.
 *
 * In-memory host throughout, so `host.locates` and `host.reads` are the
 * record of what was and was not asked for.
 */
import { describe, expect, it } from "vitest";
import { load, resolve } from "../../src/index.js";
import { InMemoryHost } from "./host-test-double.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";

const ENCODER = new TextEncoder();

const ROOT = ENCODER.encode("$id: beltype:document\nkeys:\n  title:\n    demand:\n      type: string\n    provide: Untitled\n");
const VENUE = ENCODER.encode("$adopts: beltype:document\n");
const ENTRY = ENCODER.encode("$schema: ./venue.yaml\nname: standalone\n");
const SILENT_ENTRY = ENCODER.encode("name: standalone\n");

function files(): Map<string, Uint8Array> {
  return new Map([
    ["/venue/entry.yaml", ENTRY],
    ["/venue/silent.yaml", SILENT_ENTRY],
    ["/venue/venue.yaml", VENUE],
    ["/pkg/root.yaml", ROOT],
  ]);
}

const NAMESPACE = new Map([["beltype:document", "/pkg/root.yaml"]]);

describe("v1.4 FR-004 — a host with no namespace is exactly the library v1.3 was", () => {
  it("refuses the identity as unsupported-scheme, and never calls a method the host does not have", async () => {
    const host = new InMemoryHost({ files: files() });
    expect(host.locate).toBeUndefined();

    const result = await resolve("/venue/silent.yaml", { host, sandboxRoot: "/venue", schema: "beltype:document" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("unsupported-scheme");
    expect(host.reads).toEqual(["/venue/silent.yaml"]);
  });

  it("a host that owns beltype: still refuses a scheme it does not own, having been asked", async () => {
    const host = new InMemoryHost({ files: files(), identities: NAMESPACE });

    const result = await resolve("/venue/silent.yaml", { host, sandboxRoot: "/venue", schema: "other:thing" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics[0]?.code).toBe("unsupported-scheme");
    expect(host.locates).toEqual(["other:thing"]);
    expect(host.reads).toEqual(["/venue/silent.yaml"]);
  });
});

describe("v1.4 FR-006 — an $id in the same shape is a name, not a location", () => {
  it("the located root's own $id: beltype:document is never asked about", async () => {
    const host = new InMemoryHost({ files: files(), identities: NAMESPACE });

    const result = await load<{ readonly title: string }>("/venue/entry.yaml", { host, sandboxRoot: "/venue" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.title).toBe("Untitled");
    // Asked once, by the venue's $adopts — never a second time on account
    // of the root document's own $id.
    expect(host.locates).toEqual(["beltype:document"]);
  });
});

describe("v1.4 FR-005 — a located document the host then cannot read is a refusal, not a throw", () => {
  it("document-unreachable naming both the location and the reference text", async () => {
    const host = new InMemoryHost({ files: files(), identities: new Map([["beltype:document", "/pkg/absent.yaml"]]) });

    const result = await resolve("/venue/silent.yaml", { host, sandboxRoot: "/venue", schema: "beltype:document" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("document-unreachable");
    expect(result.diagnostics[0]?.message).toContain("/pkg/absent.yaml");
    expect(result.diagnostics[0]?.message).toContain("beltype:document");
  });
});

describe("v1.4 FR-002 — what the host returns is a location, and locations already have kinds", () => {
  it("an https:// location is fetched through the transport, cached, and joins the pedigree as a remote document", async () => {
    const host = new InMemoryHost({ files: files(), identities: new Map([["beltype:document", "https://example.test/root.yaml"]]) });
    const recording: Recording = {
      url: "https://example.test/root.yaml",
      method: "GET",
      outcome: { kind: "response", response: { status: 200, headers: {}, body: ROOT } },
    };
    const transport = new RecordedTransport([recording]);

    const result = await resolve("/venue/silent.yaml", { host, sandboxRoot: "/venue", schema: "beltype:document", transport });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.pedigree).toHaveLength(1);
    expect(result.pedigree[0]?.identity.location).toBe("https://example.test/root.yaml");
    // The local read side was never used for it — the host answered with a
    // remote location and the remote machinery took over unchanged.
    expect(host.reads).toEqual(["/venue/silent.yaml"]);
    expect(() => transport.assertAllConsumed()).not.toThrow();
  });

  it("a relative $adopts written inside the located document resolves against that document's own location — and is sandbox-checked like any other schema-authored reference", async () => {
    const chained = new Map(files());
    chained.set("/pkg/root.yaml", ENCODER.encode("$adopts: ./base.yaml\n"));
    chained.set("/pkg/base.yaml", ENCODER.encode("$id: beltype/base\nkeys:\n  title:\n    demand:\n      type: string\n    provide: Based\n"));

    const confined = new InMemoryHost({ files: chained, identities: NAMESPACE });
    const refused = await resolve("/venue/silent.yaml", { host: confined, sandboxRoot: "/venue", schema: "beltype:document" });

    // The base directory is the *located* document's, not the entry's:
    // the refusal names /pkg/base.yaml, which is the only way "./base.yaml"
    // could have been read. The located document itself is exempt (FR-003);
    // what it writes for itself is not.
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.diagnostics[0]?.code).toBe("sandbox-escape");
    expect(refused.diagnostics[0]?.message).toContain("./base.yaml");

    // v1.4 FR-007: with the sandbox at the filesystem root, the same chain
    // is admitted — the root contains everything beneath it.
    const open = new InMemoryHost({ files: chained, identities: NAMESPACE });
    const admitted = await load<{ readonly title: string }>("/venue/silent.yaml", { host: open, sandboxRoot: "/", schema: "beltype:document" });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) throw new Error(JSON.stringify(admitted.diagnostics));
    expect(admitted.value.title).toBe("Based");
  });
});

describe("v1.4 FR-006 — delegation's scheme handling is unchanged", () => {
  it("a delegated identity is still unsupported-scheme, and the host is never asked to locate it", async () => {
    const delegating = new Map([
      ["/venue/config.yaml", ENCODER.encode("$schema: ./schema.yaml\nnetwork: beltype:fragment\n")],
      ["/venue/schema.yaml", ENCODER.encode("keys:\n  network:\n    demand:\n      type: mapping\n    delegate: allow\n")],
    ]);
    const host = new InMemoryHost({ files: delegating, identities: new Map([["beltype:fragment", "/pkg/fragment.yaml"]]) });

    const result = await resolve("/venue/config.yaml", { host, sandboxRoot: "/venue" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.diagnostics[0]?.code).toBe("unsupported-scheme");
    expect(host.locates).toEqual([]);
  });
});
