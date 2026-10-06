/**
 * v1.9 (specs/017-stored-bytes): offsets count the document's stored bytes
 * — a leading byte-order mark included — through every entry point.
 *
 * The expected numbers are written out by hand from the bytes, not read
 * from a run. "Slicing the input's bytes at any node's span gives exactly
 * that node's text" (FR-001, FR-008) is checked by walking the whole tree.
 */

import { describe, expect, it } from "vitest";
import { parse, parseText } from "../../src/index.js";
import { parseJsonBytes, parseJsonText } from "../../src/adapters/json/parse.js";
import type { Node } from "../../src/model/node.js";
import { createDocumentIdentity, hashBytes } from "../../src/resolve/identity.js";

const origin = { id: "stored-bytes", label: "<stored-bytes>" };
const MARK = "﻿";
const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);

/** Every `[pointer, node]` in a tree. */
function nodes(node: Node, pointer = ""): [string, Node][] {
  const found: [string, Node][] = [[pointer, node]];
  if (node.type === "mapping") {
    for (const [key, child] of node.entries) found.push(...nodes(child, `${pointer}/${key}`));
  } else if (node.type === "sequence") {
    node.items.forEach((child, index) => found.push(...nodes(child, `${pointer}/${index}`)));
  }
  return found;
}

describe("a marked YAML document", () => {
  const text = `${MARK}a: 1\nb: "é"\nc: [x, y]\n`;
  const bytes = new TextEncoder().encode(text);

  it("parseText and parse agree span for span, and both count the mark's three bytes", () => {
    const fromText = parseText(text, { origin });
    const fromBytes = parse(bytes, { origin });
    if (!fromText.ok || !fromBytes.ok) throw new Error("expected both to parse");
    const spans = (tree: Node) => nodes(tree).map(([pointer, node]) => [pointer, node.span.start, node.span.end, node.span.line, node.span.column]);
    expect(spans(fromText.tree)).toEqual(spans(fromBytes.tree));
    const a = nodes(fromBytes.tree).find(([pointer]) => pointer === "/a");
    expect([a?.[1].span.start, a?.[1].span.end, a?.[1].span.column]).toEqual([6, 7, 4]); // "1" is the 7th byte; the mark is no column
  });

  it("slices the stored bytes at every scalar's span to exactly the text that produced it", () => {
    const parsed = parse(bytes, { origin });
    if (!parsed.ok) throw new Error("expected a tree");
    const sliced = nodes(parsed.tree).filter(([, node]) => node.type === "scalar").map(([pointer, node]) => [pointer, decode(bytes.subarray(node.span.start, node.span.end))]);
    expect(sliced).toEqual([["/a", "1"], ["/b", '"é"'], ["/c/0", "x"], ["/c/1", "y"]]);
  });
});

describe("a marked JSON document", () => {
  const text = `${MARK}{"a":1,"b":"é"}`;
  const bytes = new TextEncoder().encode(text);

  it("the text entry point counts the mark exactly as the bytes entry point does, and slices exactly", () => {
    const fromText = parseJsonText(text, origin);
    const fromBytes = parseJsonBytes(bytes, origin);
    if (!fromText.ok || !fromBytes.ok) throw new Error("expected both to parse");
    const spans = (tree: Node) => nodes(tree).map(([pointer, node]) => [pointer, node.span.start, node.span.end, node.span.line, node.span.column]);
    expect(spans(fromText.tree)).toEqual(spans(fromBytes.tree));
    expect(nodes(fromBytes.tree).filter(([, node]) => node.type === "scalar").map(([pointer, node]) => [pointer, decode(bytes.subarray(node.span.start, node.span.end))])).toEqual([["/a", "1"], ["/b", '"é"']]);
  });
});

describe("FR-006: identity hashes every stored byte, the mark included", () => {
  it("a marked document and its unmarked twin have different identities", () => {
    const plain = new TextEncoder().encode("a: 1\n");
    const marked = new TextEncoder().encode(`${MARK}a: 1\n`);
    expect(hashBytes(marked)).not.toBe(hashBytes(plain));
    expect(createDocumentIdentity("x", marked).hash).toBe(hashBytes(marked));
  });
});
