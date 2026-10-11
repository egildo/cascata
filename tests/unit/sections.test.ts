/**
 * v1.0 (009) FR-001, FR-002, FR-003 / SC-001 — **a malformed top-level
 * section is refused, not ignored.**
 *
 * `SPEC.md` §9 declares four top-level sections — `types`, `keys`,
 * `directives`, `authority` — each a mapping of named entries. Until v1.0
 * a schema writing `types: oops` parsed, merged, validated, and did
 * **nothing**: every section reader in the codebase treats a non-mapping
 * section as "nothing to read, never an error", and no pass refused it.
 * v0.7's meta-schema corpus sweep found the hole from the other side and
 * recorded it as a divergence rather than fixing it, because closing it
 * changes a verdict. v1.0 is the last release at which that is a
 * correction rather than a v2.0-requiring meaning change, so this is
 * where it lands.
 *
 * The corpus (`tests/corpus/validate-cases/T100`–`T106`) carries the
 * position-precise cases. This file carries the three properties a
 * table-driven case cannot state:
 *
 *   1. **one rule, not four** — the four sections are refused by one
 *      code, one message shape, and one loop, established by asserting
 *      all four together rather than one at a time;
 *   2. **absent ≠ malformed** — a schema declaring none of them is legal,
 *      and stays legal;
 *   3. **the config layer is exempt** — a *config* carrying `types: oops`
 *      is ordinary data, which is what v0.3's `inert-vocabulary` fixtures
 *      have always said and what FR-002 keeps true.
 *
 * Layers are hand-built and fed through `fold()` + `validate()`, following
 * `tests/unit/recursion-termination.test.ts`'s precedent: the property
 * under test belongs to `validate()`, whose contract takes a
 * `MergedConfiguration` from anywhere, and building the layers directly is
 * what lets a *config* layer carry a malformed section without a schema
 * having to permit it first.
 */
import { describe, expect, it } from "vitest";
import { validate } from "../../src/index.js";
import { TOP_LEVEL_SECTIONS } from "../../src/validate/vocabulary.js";
import { createBoolScalar, createIntScalar, createMapping, createSequence, createStringScalar, type Node } from "../../src/model/node.js";
import { createOrigin, createSourceSpan, type SourceSpan } from "../../src/model/span.js";
import { fold } from "../../src/merge/fold.js";
import type { Layer } from "../../src/merge/provenance.js";

const ORIGIN_SCHEMA = createOrigin("sections-schema", "sections-schema");
const ORIGIN_CONFIG = createOrigin("sections-config", "sections-config");

let offset = 0;
function span(origin: ReturnType<typeof createOrigin>): SourceSpan {
  offset += 1;
  return createSourceSpan({ origin, start: offset, end: offset + 1, line: offset, column: 1, documentLength: 100_000 });
}

function configurationOf(schemaEntries: readonly (readonly [string, Node])[], configEntries: readonly (readonly [string, Node])[]): Parameters<typeof validate>[0] {
  const schemaLayer: Layer = {
    identity: { location: "sections-schema", physical: "sections-schema", hash: "0".repeat(64) },
    role: "schema",
    rank: 0,
    tree: createMapping(schemaEntries, span(ORIGIN_SCHEMA)),
  };
  const configLayer: Layer = {
    identity: { location: "sections-config", physical: "sections-config", hash: "1".repeat(64) },
    role: "config",
    rank: 1,
    tree: createMapping(configEntries, span(ORIGIN_CONFIG)),
  };
  const layers = [schemaLayer, configLayer];
  return { tree: fold(layers), provenance: new Map(), pedigree: [], layers, delegationBreadcrumbs: new Map(), finalState: new Map() };
}

/** A well-formed `keys:` section, so a case about `types:` is not accidentally a case about a schema with nothing in it. */
function wellFormedKeys(): Node {
  return createMapping([["name", createMapping([["demand", createMapping([["type", createStringScalar("string", span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA))]], span(ORIGIN_SCHEMA));
}

describe("v1.0 FR-001 — a top-level section that is not a mapping is refused", () => {
  // One rule covering four sections. Written as a table so that adding a
  // fifth section without adding it to the rule fails here, not in review.
  const malformedValues: readonly (readonly [string, () => Node])[] = [
    ["a string scalar", () => createStringScalar("oops", span(ORIGIN_SCHEMA))],
    ["an int scalar", () => createIntScalar(7n, span(ORIGIN_SCHEMA))],
    ["a bool scalar", () => createBoolScalar(true, span(ORIGIN_SCHEMA))],
    ["a sequence", () => createSequence([createStringScalar("not", span(ORIGIN_SCHEMA))], span(ORIGIN_SCHEMA))],
  ];

  for (const section of TOP_LEVEL_SECTIONS) {
    for (const [description, make] of malformedValues) {
      it(`refuses '${section}:' when it is ${description}, at that node's own position`, () => {
        const node = make();
        const result = validate(configurationOf([[section, node], ...(section === "keys" ? [] : ([["keys", wellFormedKeys()]] as const))], [["name", createStringScalar("ok", span(ORIGIN_CONFIG))]]));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        const section_ = result.diagnostics.filter((d) => d.code === "malformed-section");
        expect(section_).toHaveLength(1);
        const only = section_[0];
        expect(only?.level).toBe("error");
        // Principle III's never-phasing obligation: the position is the
        // offending construct's own, not the document's or the layer's.
        expect(only?.primary).toBe(node.span);
        expect(only?.demand?.pointer).toBe(`/${section}`);
        expect(only?.pedigreePosition).toBe(0);
        expect(only?.message).toContain(`'${section}:'`);
      });
    }
  }

  it("all four malformed at once produce exactly four diagnostics, one per section, in canonical section order", () => {
    const result = validate(
      configurationOf(
        TOP_LEVEL_SECTIONS.map((name) => [name, createStringScalar("nope", span(ORIGIN_SCHEMA))] as const),
        [["name", createStringScalar("ok", span(ORIGIN_CONFIG))]],
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const pointers = result.diagnostics.filter((d) => d.code === "malformed-section").map((d) => d.demand?.pointer);
    // Four sections, one rule: four diagnostics, and the order is the
    // sections' own canonical order, so nothing has to sort anything.
    expect(pointers).toEqual(["/authority", "/directives", "/keys", "/types"]);
  });

  it("FR-002: a schema omitting every section is legal — absent and malformed are different, and only one is an error", () => {
    const result = validate(configurationOf([["$id", createStringScalar("sections/empty", span(ORIGIN_SCHEMA))]], [["name", createStringScalar("ok", span(ORIGIN_CONFIG))]]));
    expect(result.ok).toBe(true);
  });

  it("FR-002: an EMPTY mapping section is legal too — the rule is 'not a mapping', never 'not useful'", () => {
    const result = validate(
      configurationOf(
        TOP_LEVEL_SECTIONS.map((name) => [name, createMapping([], span(ORIGIN_SCHEMA))] as const),
        [["name", createStringScalar("ok", span(ORIGIN_CONFIG))]],
      ),
    );
    expect(result.ok).toBe(true);
  });

  it("FR-002: a CONFIG layer's own malformed sections are inert data, not refusals", () => {
    // v0.3's `merge-fold/inert-vocabulary/` fixtures have said this since
    // the fold was built, and it must keep being true: a config's
    // `types:`/`keys:` is a key whose name happens to collide with a
    // section name, and the config layer is not where sections live.
    const result = validate(
      configurationOf(
        [["keys", wellFormedKeys()]],
        [
          ["name", createStringScalar("ok", span(ORIGIN_CONFIG))],
          ["types", createStringScalar("oops", span(ORIGIN_CONFIG))],
          ["authority", createIntScalar(7n, span(ORIGIN_CONFIG))],
        ],
      ),
    );
    expect(result.ok).toBe(true);
  });
});
