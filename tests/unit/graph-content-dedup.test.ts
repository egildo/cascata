/**
 * **Revised in v1.13 (FR-006, by the owner's ruling).** The dedup this file was written to pin, the second
 * stage by content hash, is gone: identity is the physical path alone, and two documents with identical
 * bytes are two documents (a legal chain can pass through byte-identical files that resolve their relative
 * references from different places). The assertions below that said the opposite now say this; what stayed
 * is the location-keyed `"duplicate"`. The history that follows is as it was written.
 *
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
  return { identity: { location, physical: location, hash }, tree: createNullScalar(span), verified: false };
}

describe("GraphBuilder: no content-hash dedup (v1.13 FR-006, revised -- this file pinned the opposite until then)", () => {
  it("two different locations with identical content-hash stay two GraphDocuments: identity is the physical path, not the bytes", () => {
    const builder = new GraphBuilder();
    const sameHash = "a".repeat(64);

    expect(builder.beginVisit("/a/schema.yaml", undefined).kind).toBe("new");
    const docA = fakeDocument("/a/schema.yaml", sameHash);
    builder.finishVisit("/a/schema.yaml", docA);

    expect(builder.beginVisit("/b/schema.yaml", undefined).kind).toBe("new"); // never visited by *physical path* before
    const docB = fakeDocument("/b/schema.yaml", sameHash); // byte-identical content, different location
    builder.finishVisit("/b/schema.yaml", docB);

    // Each is memoized as itself: asking again for either answers that document, never the other.
    const again = builder.beginVisit("/b/schema.yaml", undefined);
    expect(again.kind).toBe("duplicate");
    if (again.kind === "duplicate") expect(again.document).toBe(docB);
    const first = builder.beginVisit("/a/schema.yaml", undefined);
    expect(first.kind).toBe("duplicate");
    if (first.kind === "duplicate") expect(first.document).toBe(docA);
  });

  it("a location already fully resolved is answered as 'duplicate' without registering anything new", () => {
    const builder = new GraphBuilder();
    const doc = fakeDocument("/x/schema.yaml", "b".repeat(64));

    const first = builder.beginVisit("/x/schema.yaml", undefined);
    expect(first.kind).toBe("new");
    builder.finishVisit("/x/schema.yaml", doc);

    const second = builder.beginVisit("/x/schema.yaml", undefined);
    expect(second.kind).toBe("duplicate");
    if (second.kind !== "duplicate") throw new Error("unreachable");
    expect(second.document).toBe(doc); // reused, not re-read
  });

  it("two distinct locations with genuinely different content are two documents", () => {
    const builder = new GraphBuilder();

    builder.beginVisit("/p/schema.yaml", undefined);
    const docP = fakeDocument("/p/schema.yaml", "c".repeat(64));
    builder.finishVisit("/p/schema.yaml", docP);

    builder.beginVisit("/q/schema.yaml", undefined);
    const docQ = fakeDocument("/q/schema.yaml", "d".repeat(64)); // different hash
    builder.finishVisit("/q/schema.yaml", docQ);

    const q = builder.beginVisit("/q/schema.yaml", undefined);
    expect(q.kind === "duplicate" && q.document === docQ).toBe(true);
    expect(docQ).not.toBe(docP);
  });
});
