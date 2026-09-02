/**
 * The motivating consumer's real document — v1.2 (specs/011-json-adapter
 * US5, FR-022).
 *
 * `tests/fixtures/packet/20221030_203857_1265d2.packet.json` is the exact
 * bytes of
 *
 *     exiftool -json -struct -G1 \
 *       ~/Privata/test-archive/pristine/master/2022/2022-10/20221030_203857_1265d2.heic
 *
 * run on 2026-09-02 with exiftool 13.55, and recorded byte for byte: 8716
 * bytes, 204 lines, SHA-256
 * 46930b15f982659a4379a27fcc27ef1ee031c71b5507f9bc6067c05f79b97457. The
 * photograph itself is not in this repository and is never read here — a
 * test that shelled out to exiftool would be neither hermetic nor
 * reproducible, and the constitution's "no I/O in tests beyond their own
 * fixtures" is the same rule that keeps the remote suite off the network.
 *
 * **The expected tree below is written by hand from the recorded text**,
 * not captured from the parser. It is the subtree at
 * `/0/XMP-mwg-rs:RegionInfo`: two face regions, `Leonardo Agus` and
 * `Lucia Tagliareni`, and the dimensions the coordinates are normalized
 * against. Every number's kind is read off RFC 8259's grammar — `3024` has
 * no fraction and no exponent, so it is an `int`; `0.0727513` has a
 * fraction, so it is a `float` — and not off what the value looks like.
 *
 * **What this fixture cannot prove**, recorded so nobody mistakes it for a
 * complete test (research P-8): it contains no non-ASCII byte, no integer
 * outside the safe double range, no escape but `\"`, and no duplicate key.
 * A milestone verified only against this document would have shipped a
 * broken span converter and an inexact integer path and never known. The
 * non-ASCII and big-integer probes are synthetic corpus cases, and they
 * have to be.
 *
 * **The top level is an array of one object**, which is what `exiftool
 * -json` always emits, one element per file, even for a single file. That
 * wrapper is real and this adapter does not remove it — a parser that
 * unwrapped it would be supplying meaning, which is the host's job and not
 * the library's (SPEC.md §16). Hence `/0/...` in every pointer below.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseJsonBytes } from "../../src/adapters/json/parse.js";
import { nodesEqual } from "../../src/model/equality.js";
import { createFloatScalar, createIntScalar, createMapping, createSequence, createStringScalar, type Node } from "../../src/model/node.js";
import { resolvePointer } from "../../src/model/pointer.js";
import { createOrigin, createSourceSpan, type Origin } from "../../src/model/span.js";
import { identicalTrees } from "./tree-equality.js";

const FIXTURE = new URL("../fixtures/packet/20221030_203857_1265d2.packet.json", import.meta.url).pathname;
const ORIGIN: Origin = createOrigin("20221030_203857_1265d2.packet.json", "20221030_203857_1265d2.packet.json");

/**
 * A placeholder span for the *expected* tree only. `nodesEqual` compares
 * (kind, value) and structure and ignores spans entirely (§4.2's single
 * definition of equality), which is exactly why an expected tree may carry
 * one position for every node — and why the span assertions below are made
 * separately, against the real tree, rather than folded in here.
 */
function anySpan(): ReturnType<typeof createSourceSpan> {
  return createSourceSpan({ origin: ORIGIN, start: 0, end: 0, line: 1, column: 1, documentLength: 0 });
}

const str = (value: string): Node => createStringScalar(value, anySpan());
const int = (value: bigint): Node => createIntScalar(value, anySpan());
const flt = (value: number): Node => createFloatScalar(value, anySpan());
const map = (entries: readonly (readonly [string, Node])[]): Node => createMapping(entries, anySpan());
const seq = (items: readonly Node[]): Node => createSequence(items, anySpan());

/** Written out of the recorded text at lines 131-158, by hand. */
const EXPECTED_REGION_INFO: Node = map([
  [
    "AppliedToDimensions",
    map([
      ["H", int(3024n)],
      ["Unit", str("pixel")],
      ["W", int(4032n)],
    ]),
  ],
  [
    "RegionList",
    seq([
      map([
        [
          "Area",
          map([
            ["H", flt(0.0727513)],
            ["Unit", str("normalized")],
            ["W", flt(0.0421627)],
            ["X", flt(0.533234)],
            ["Y", flt(0.3125)],
          ]),
        ],
        ["Name", str("Leonardo Agus")],
        ["Type", str("Face")],
      ]),
      map([
        [
          "Area",
          map([
            ["H", flt(0.106481)],
            ["Unit", str("normalized")],
            ["W", flt(0.0749008)],
            ["X", flt(0.65129)],
            ["Y", flt(0.484127)],
          ]),
        ],
        ["Name", str("Lucia Tagliareni")],
        ["Type", str("Face")],
      ]),
    ]),
  ],
]);

function parseFixture(): { readonly tree: Node } {
  const bytes = new Uint8Array(readFileSync(FIXTURE));
  const outcome = parseJsonBytes(bytes, ORIGIN);
  if (!outcome.ok) {
    throw new Error(`the recorded packet was refused: ${outcome.diagnostics.map((d) => `${d.code} at ${d.primary.line}:${d.primary.column} — ${d.message}`).join("; ")}`);
  }
  return { tree: outcome.tree };
}

describe("v1.2 FR-022 — a real exiftool packet", () => {
  it("is the bytes it was recorded as — a fixture that drifted would make every assertion below say something else", () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    expect(bytes.length).toBe(8716);
    expect(bytes.filter((byte) => byte > 0x7f).length, "the packet is pure ASCII, which is precisely why it cannot serve as this milestone's non-ASCII probe").toBe(0);
  });

  it("parses with no diagnostics at all", () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const outcome = parseJsonBytes(bytes, ORIGIN);
    expect(outcome.ok, outcome.ok ? "ok" : outcome.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; ")).toBe(true);
  });

  it("is an array holding exactly one object of 167 keys — exiftool's wrapper is real, and the adapter does not remove it", () => {
    const { tree } = parseFixture();
    expect(tree.type).toBe("sequence");
    if (tree.type !== "sequence") throw new Error("unreachable — asserted above");
    expect(tree.items).toHaveLength(1);
    const packet = tree.items[0];
    expect(packet?.type).toBe("mapping");
    if (packet?.type !== "mapping") throw new Error("unreachable — asserted above");
    expect(packet.entries.size).toBe(167);
  });

  it("carries the two face regions, matching a tree written by hand from the recorded text", () => {
    const { tree } = parseFixture();
    const actual = resolvePointer(tree, "/0/XMP-mwg-rs:RegionInfo");
    expect(actual, "the packet has no /0/XMP-mwg-rs:RegionInfo").toBeDefined();
    if (actual === undefined) throw new Error("unreachable — asserted above");
    expect(nodesEqual(actual, EXPECTED_REGION_INFO)).toBe(true);
  });

  it("names the people it names — asserted separately, so a structural match cannot pass while the names are wrong", () => {
    const { tree } = parseFixture();
    const first = resolvePointer(tree, "/0/XMP-mwg-rs:RegionInfo/RegionList/0/Name");
    const second = resolvePointer(tree, "/0/XMP-mwg-rs:RegionInfo/RegionList/1/Name");
    expect(first?.type === "scalar" ? first.value : undefined).toBe("Leonardo Agus");
    expect(second?.type === "scalar" ? second.value : undefined).toBe("Lucia Tagliareni");
  });

  it("gives the dimensions as ints and the areas as floats — lexical kind, not the shape of the value", () => {
    const { tree } = parseFixture();
    const width = resolvePointer(tree, "/0/XMP-mwg-rs:RegionInfo/AppliedToDimensions/W");
    const y = resolvePointer(tree, "/0/XMP-mwg-rs:RegionInfo/RegionList/0/Area/Y");
    expect(width?.type === "scalar" ? [width.kind, width.value] : undefined).toEqual(["int", 4032n]);
    // 0.3125 is exactly representable as a double and is a whole number of
    // 1/16ths; it is a float because it was *written* with a fraction, which
    // is the whole of §4.2's lexical rule.
    expect(y?.type === "scalar" ? [y.kind, y.value] : undefined).toEqual(["float", 0.3125]);
  });

  it("puts RegionInfo where the bytes put it — a span into the packet, not a guess", () => {
    const { tree } = parseFixture();
    const regionInfo = resolvePointer(tree, "/0/XMP-mwg-rs:RegionInfo");
    // The quoted key `"XMP-mwg-rs:RegionInfo"` starts at byte 5734 in the
    // recorded file and is 23 bytes long; a colon and a space follow, so the
    // value's `{` opens at 5734 + 23 + 2 = 5759, on line 131. (The first
    // draft of this assertion said 5758 — 21 characters counted without
    // their quotes — and the test caught the arithmetic, which is the point
    // of writing the number down rather than reading it off the parser.)
    expect(regionInfo?.span.start).toBe(5759);
    expect(regionInfo?.span.line).toBe(131);
  });

  it("parses to an identical tree, spans included, every time", () => {
    expect(identicalTrees(parseFixture().tree, parseFixture().tree)).toBe(true);
  });
});
