/**
 * v0.7 part 2 (008) FR-019, FR-020 / SC-006 — **the library loads its own
 * meta-schema through its own seam.** `SPEC.md` §16 (Article VI), §11.
 *
 * §16 names the bootstrap as `load()`'s first real consumer, and says
 * self-hosting is "the embedding story exercising itself". The claim only
 * means something if it is true of the *one document that could most
 * easily have been exempted*: a meta-schema read from a bundled constant
 * would be the single document in the system outside the article that
 * governs every other one, and nobody would notice until an embedder with
 * no filesystem tried to use it.
 *
 * So the assertions here are about **who did the reading**, not only about
 * the verdict:
 *
 * - the meta-schema arrives through `Host.read`, and the host can say what
 *   it was asked for;
 * - a host with no filesystem at all serves it;
 * - no module under `src/` embeds the meta-schema's text — checked
 *   mechanically, in the spirit of `tests/unit/layering.test.ts`, because
 *   a constant is exactly the kind of shortcut that would be added later
 *   "just for the default case".
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { metaValidate, parse, resolve } from "../../src/index.js";
import { createNodeHost, nodeMetaSchemaLocation } from "../../src/host/node.js";
import { InMemoryHost } from "./host-test-double.js";
import { createOrigin } from "../../src/model/span.js";

const ENCODER = new TextEncoder();
const META_LOCATION = nodeMetaSchemaLocation();
const META_TEXT = readFileSync(META_LOCATION, "utf-8");
const SRC_DIR = join(__dirname, "..", "..", "src");

describe("v0.7 part 2 FR-019 / SC-006 — the meta-schema is obtained through the host seam", () => {
  it("a host with no filesystem serves it, and can say it was asked", async () => {
    const host = new InMemoryHost({
      files: new Map([
        ["/nowhere/meta.yaml", ENCODER.encode(META_TEXT)],
        ["/nowhere/subject.yaml", ENCODER.encode("keys:\n  title:\n    demand: { type: string }\n")],
      ]),
    });
    const result = await metaValidate({ host, subject: "/nowhere/subject.yaml", metaSchema: "/nowhere/meta.yaml" });
    expect(result.ok, result.ok ? "ok" : JSON.stringify(result.diagnostics.map((d) => d.code))).toBe(true);
    // The seam, not a constant: the host was asked for both documents.
    expect(host.reads).toEqual(["/nowhere/subject.yaml", "/nowhere/meta.yaml"]);
  });

  it("a host that declines to supply the meta-schema refuses with a diagnostic, never an exception", async () => {
    const host = new InMemoryHost({ files: new Map([["/nowhere/subject.yaml", ENCODER.encode("keys: {}\n")]]) });
    const result = await metaValidate({ host, subject: "/nowhere/subject.yaml", metaSchema: "/nowhere/meta.yaml" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.code)).toEqual(["document-unreachable"]);
  });

  it("metaValidate called with no host throws — a programmer error, not a fact about the world", async () => {
    const broken = { subject: "/a", metaSchema: "/b" } as unknown as Parameters<typeof metaValidate>[0];
    await expect(metaValidate(broken)).rejects.toThrow(/requires 'host'/);
  });

  it("no module under src/ embeds the meta-schema's text — the one document that could most easily have been exempted is not", () => {
    // A distinctive line no other file has any reason to contain.
    const fingerprint = "$id: cascata/meta";
    const offenders: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (path.endsWith(".ts") && readFileSync(path, "utf-8").includes(fingerprint)) {
          offenders.push(path);
        }
      }
    };
    walk(SRC_DIR);
    expect(offenders).toEqual([]);
  });
});

describe("v0.7 part 2 FR-020 — the schema language's version, and what \"readable from the pedigree\" can actually mean", () => {
  /**
   * **A gap in `SPEC.md` §11, found by trying to discharge FR-020.**
   *
   * §11's last clause reads "the schema language itself is versioned via
   * the meta-schema's own pedigree", and FR-020 turns that into a MUST.
   * Two facts make the literal reading impossible today:
   *
   * 1. **A `PedigreeEntry` carries no version.** It is
   *    `{identity: {location, hash}, via, verified, finalAgainstForking}`.
   *    `$version` is nowhere in it, so nothing is readable "from the
   *    pedigree" in the sense of reading a field off it.
   * 2. **The pedigree deliberately excludes the entry document**
   *    (`src/graph/pedigree.ts`, settled in v0.2 against two loosely-worded
   *    clauses of that milestone's own spec). Resolving the meta-schema *as
   *    its own entry* therefore yields an **empty** pedigree — its own
   *    version is not in its own pedigree by construction.
   *
   * What is true, and what this discharges, is the useful half: the
   * meta-schema appears in the pedigree of any schema that adopts it,
   * identified by location **and content hash**, and the version is read
   * from the document that identity names. That is exactly what `$id` and
   * `$pin` are for, and it is enough to answer "which version of the schema
   * language governs this document". Reported rather than papered over:
   * closing it properly means putting `$id`/`$version` on `PedigreeEntry`,
   * which is a governance decision, not an implementer's.
   */
  it("a schema adopting the meta-schema carries it in its pedigree, identified by location and content hash", async () => {
    // Served from memory so the assertion is about the pedigree, not about
    // where the shipped copy happens to sit on this machine.
    const memoryHost = new InMemoryHost({
      files: new Map([
        ["/mem/config.yaml", ENCODER.encode("$schema: ./adopter.yaml\n")],
        ["/mem/adopter.yaml", ENCODER.encode("$adopts: ./meta.yaml\n$id: example/adopter\nkeys: {}\n")],
        ["/mem/meta.yaml", ENCODER.encode(META_TEXT)],
      ]),
    });
    const chain = await resolve("/mem/config.yaml", { host: memoryHost, sandboxRoot: "/mem" });
    expect(chain.ok, chain.ok ? "ok" : JSON.stringify(chain.diagnostics.map((d) => `${d.code}: ${d.message}`))).toBe(true);
    if (!chain.ok) return;
    // Root to leaf: the meta-schema first, then the schema that adopted it.
    expect(chain.pedigree.map((entry) => entry.identity.location)).toEqual(["/mem/meta.yaml", "/mem/adopter.yaml"]);
    const root = chain.pedigree[0];
    expect(root?.identity.hash).toMatch(/^[0-9a-f]{64}$/);

    // And the version is read from the document that identity names — the
    // half of §11's clause that is true.
    const bytes = await memoryHost.read(root?.identity.location ?? "");
    expect(bytes.ok).toBe(true);
    if (!bytes.ok) return;
    const parsed = parse(bytes.bytes, { origin: createOrigin(META_LOCATION, META_LOCATION) });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.tree.type !== "mapping") return;
    const version = parsed.tree.entries.get("$version");
    expect(version?.type === "scalar" && version.kind === "int" ? version.value : undefined).toBe(1n);
  });

  it("resolving the meta-schema as its own ENTRY yields an EMPTY pedigree — recorded, because it is the literal reading FR-020 asks for and it cannot hold", async () => {
    const resolved = await resolve(META_LOCATION, { host: createNodeHost(), sandboxRoot: join(META_LOCATION, "..") });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.pedigree).toEqual([]);
  });

  it("the document itself agrees — $id and $version read straight off the parsed tree", () => {
    const parsed = parse(new Uint8Array(readFileSync(META_LOCATION)), { origin: createOrigin(META_LOCATION, META_LOCATION) });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.tree.type !== "mapping") return;
    const id = parsed.tree.entries.get("$id");
    const version = parsed.tree.entries.get("$version");
    expect(id?.type === "scalar" && id.kind === "string" ? id.value : undefined).toBe("cascata/meta");
    expect(version?.type === "scalar" && version.kind === "int" ? version.value : undefined).toBe(1n);
    // It adopts nothing. A meta-schema that adopted something would need
    // *that* document validated by something else, and the regress has to
    // stop somewhere the library can reach without asking anyone
    // (research.md D-1).
    expect(parsed.tree.entries.has("$adopts")).toBe(false);
  });
});
