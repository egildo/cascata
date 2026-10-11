/**
 * T039 (User Story 3 conformance case): one remote identity referenced
 * twice is fetched once — spec.md Acceptance Scenario 6 (US3), v0.2
 * FR-019.
 *
 * **Retargeted, for exactly `tests/unit/graph-content-dedup.test.ts`'s
 * reason (T021), applied to the remote case**: `$adopts`/`$schema` are
 * single string scalars (`SPEC.md` §9), so a resolution is structurally
 * a straight chain — config → schema → its one parent → its one parent
 * … From the entry down to the root, **every node has exactly one
 * outgoing edge**, and cycle detection refuses the only way a location
 * could otherwise be revisited (pointing back into the chain already
 * being walked). There is therefore no fixture, anywhere in this
 * milestone's `$schema`/`$adopts` vocabulary, in which two *different*
 * documents' references can name the identical remote URL within one
 * `resolve()` call — the diamond this acceptance scenario describes
 * cannot arise end-to-end until delegation (§8, v0.6) or multi-adoption
 * exist, exactly as `tests/unit/graph-content-dedup.test.ts`'s own
 * module doc found for the local case.
 *
 * What *is* real and tested here is the mechanism FR-019 depends on:
 * `walkAdoptsChain` (src/index.ts) routes a remote location through
 * `GraphBuilder.beginVisit`/`finishVisit` (`registerContent` went in v1.13, FR-006 revised) — the exact
 * same location-keyed protocol FR-009's local dedup already uses
 * (research D5: "no diamond can arise from `$adopts` in v1... this
 * machinery is for delegation and future multi-adoption"). This file
 * drives that protocol directly, twice, with two distinct `Reference`
 * objects naming the identical URL (standing in for "two documents"),
 * sharing one `GraphBuilder` and one fetch/cache context, and proves the
 * transport is asked for that URL only once.
 */

import { describe, expect, it } from "vitest";
import { GraphBuilder, type GraphDocument } from "../../src/graph/build.js";
import { createDocumentIdentity } from "../../src/resolve/identity.js";
import { DocumentCache } from "../../src/resolve/cache.js";
import { DEFAULT_FETCH_LIMITS, resolveRemoteDocument, type RemoteResolveContext } from "../../src/resolve/fetch.js";
import { createReference, type Reference } from "../../src/resolve/reference.js";
import { createNullScalar } from "../../src/model/node.js";
import { createOrigin, createSourceSpan } from "../../src/model/span.js";
import { RecordedTransport, type Recording } from "../corpus/transport.js";
import { makeTempCacheDir, removeTempCacheDir } from "./remote-test-helpers.js";
import { createNodeHost } from "../../src/host/node.js";

const URL = "https://example.test/shared-schema.yaml";
const BODY = new TextEncoder().encode("title: shared\n");

function fakeReference(documentLabel: string): Reference {
  const origin = createOrigin(documentLabel, documentLabel);
  const span = createSourceSpan({ origin, start: 0, end: 4, line: 1, column: 1, documentLength: 4 });
  return createReference({ text: URL, span, kind: "adopts", authority: "schema-authored" });
}

/** Reproduces exactly the protocol `src/index.ts`'s `walkAdoptsChain` uses for a `"new"` remote visit: beginVisit -> fetch -> finishVisit. A `"duplicate"` decision short-circuits before ever calling `resolveRemoteDocument` — which is the property under test. */
async function visitOnce(url: string, reference: Reference, builder: GraphBuilder, remote: RemoteResolveContext): Promise<{ readonly wasDuplicate: boolean; readonly document: GraphDocument }> {
  const decision = builder.beginVisit(url, reference);
  if (decision.kind === "duplicate") {
    return { wasDuplicate: true, document: decision.document };
  }
  if (decision.kind === "cycle") {
    throw new Error("test setup error: unexpected cycle");
  }
  const fetched = await resolveRemoteDocument(url, reference.pin, remote);
  if (!fetched.ok) {
    builder.abandonVisit(url);
    throw new Error(`test setup error: unexpected fetch failure ${JSON.stringify(fetched.failure)}`);
  }
  const identity = createDocumentIdentity(url, fetched.bytes);
  const origin = createOrigin(url, url);
  const span = createSourceSpan({ origin, start: 0, end: 0, line: 1, column: 1, documentLength: 0 });
  const document: GraphDocument = { identity, tree: createNullScalar(span), via: reference, verified: fetched.verified };
  builder.finishVisit(url, document);
  return { wasDuplicate: false, document };
}

describe("T039: one remote identity referenced twice is fetched once (v0.2 FR-019)", () => {
  it("the second visit to the same URL is answered as a duplicate, with no second request", async () => {
    const cacheDir = makeTempCacheDir();
    try {
      const recording: Recording = { url: URL, method: "GET", outcome: { kind: "response", response: { status: 200, headers: {}, body: BODY } } };
      const transport = new RecordedTransport([recording]);
      const remote: RemoteResolveContext = { transport, cache: new DocumentCache(createNodeHost({ cacheDir })), limits: DEFAULT_FETCH_LIMITS };
      const builder = new GraphBuilder();

      const first = await visitOnce(URL, fakeReference("document-a.yaml"), builder, remote);
      expect(first.wasDuplicate).toBe(false);

      const second = await visitOnce(URL, fakeReference("document-b.yaml"), builder, remote);
      expect(second.wasDuplicate).toBe(true);
      expect(second.document).toBe(first.document);

      // Runner contract point 2 (contracts/recorded-responses.md): if the
      // mechanism had fetched twice, the second `transport.request` would
      // have found no recording left — this assertion is what proves it
      // did not even try.
      expect(() => transport.assertAllConsumed()).not.toThrow();
    } finally {
      removeTempCacheDir(cacheDir);
    }
  });
});
