/**
 * Direct unit test of `GraphBuilder`'s two-stage dedup (research D5:
 * "deduplicate by location before fetching... deduplicate by content
 * hash after") — exercised against the class itself, not through
 * `resolve()`.
 *
 * **Why this exists, and why not through a resolve() corpus case
 * (T021's original home)**: T021 originally tested "a schema reachable
 * by two routes... read once and appears once" by giving `$adopts` a
 * two-item sequence, both items resolving to the same target — legal
 * under an earlier, implementer-invented reading of `$adopts`'s shape.
 * `SPEC.md` §9 has since settled that reading the other way: `$adopts`
 * and `$schema` are single string scalars, and *any* sequence value is
 * refused with `multiple-adoption`, regardless of what its items name
 * (T032). That withdraws the only mechanism this milestone had for
 * constructing two distinct edges into the same node — and, per §6.1
 * ("adoption is single-parent... diamonds cannot arise") and
 * research.md's corrected D5 citation, no other mechanism exists in v0.2
 * User Story 2 either: a pure `$schema`/`$adopts` chain is structurally
 * a straight line, one edge per node, so a genuine diamond cannot occur
 * end-to-end until delegation (§8, v0.6) or future multi-adoption exist.
 *
 * Content-hash dedup is still real, tested machinery `GraphBuilder`
 * needs regardless (a future stage will exercise it end-to-end) — this
 * file proves it directly: two different locations serving
 * byte-identical content converge to the same `GraphDocument` object,
 * and a location already fully resolved is answered as `"duplicate"`
 * without re-registering anything.
 */

import { describe, expect, it } from "vitest";
import { GraphBuilder, type GraphDocument } from "../../src/graph/build.js";
import { createNullScalar } from "../../src/model/node.js";
import { createOrigin, createSourceSpan } from "../../src/model/span.js";

function fakeDocument(location: string, hash: string): GraphDocument {
  const origin = createOrigin(location, location);
  const span = createSourceSpan({ origin, start: 0, end: 0, line: 1, column: 1, documentLength: 0 });
  return { identity: { location, hash }, tree: createNullScalar(span), verified: false };
}

describe("GraphBuilder content-hash dedup (research D5, second stage)", () => {
  it("two different locations with identical content-hash converge to the same GraphDocument object", () => {
    const builder = new GraphBuilder();
    const sameHash = "a".repeat(64);

    const visitA = builder.beginVisit("/a/schema.yaml", undefined);
    expect(visitA.kind).toBe("new");
    const docA = fakeDocument("/a/schema.yaml", sameHash);
    const canonicalA = builder.registerContent("/a/schema.yaml", docA);
    expect(canonicalA).toBe(docA); // first time this hash is seen: itself is canonical
    builder.finishVisit("/a/schema.yaml", canonicalA);

    const visitB = builder.beginVisit("/b/schema.yaml", undefined);
    expect(visitB.kind).toBe("new"); // never visited by *location* before
    const docB = fakeDocument("/b/schema.yaml", sameHash); // byte-identical content, different location
    const canonicalB = builder.registerContent("/b/schema.yaml", docB);
    builder.finishVisit("/b/schema.yaml", canonicalB);

    expect(canonicalB).not.toBe(docB); // NOT the object just built...
    expect(canonicalB).toBe(canonicalA); // ...it's the earlier, byte-identical one — one graph node, not two.
  });

  it("a location already fully resolved is answered as 'duplicate' without registering anything new", () => {
    const builder = new GraphBuilder();
    const doc = fakeDocument("/x/schema.yaml", "b".repeat(64));

    const first = builder.beginVisit("/x/schema.yaml", undefined);
    expect(first.kind).toBe("new");
    const canonical = builder.registerContent("/x/schema.yaml", doc);
    builder.finishVisit("/x/schema.yaml", canonical);

    const second = builder.beginVisit("/x/schema.yaml", undefined);
    expect(second.kind).toBe("duplicate");
    if (second.kind !== "duplicate") throw new Error("unreachable");
    expect(second.document).toBe(canonical); // reused, not re-read/re-registered
  });

  it("two distinct locations with genuinely different content are not deduped", () => {
    const builder = new GraphBuilder();

    builder.beginVisit("/p/schema.yaml", undefined);
    const docP = fakeDocument("/p/schema.yaml", "c".repeat(64));
    const canonicalP = builder.registerContent("/p/schema.yaml", docP);
    builder.finishVisit("/p/schema.yaml", canonicalP);

    builder.beginVisit("/q/schema.yaml", undefined);
    const docQ = fakeDocument("/q/schema.yaml", "d".repeat(64)); // different hash
    const canonicalQ = builder.registerContent("/q/schema.yaml", docQ);
    builder.finishVisit("/q/schema.yaml", canonicalQ);

    expect(canonicalQ).toBe(docQ);
    expect(canonicalQ).not.toBe(canonicalP);
  });
});
