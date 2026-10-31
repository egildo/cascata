/**
 * v1.10 (specs/018-write-value): properties of `locate` and `setValue` that a
 * table of hand-counted cases cannot say — every string the probe gate
 * (plan.md) tried, in every context, comes back as the string set; nothing
 * throws for a document or a value; the arguments that are programmer error
 * do throw.
 */

import { describe, expect, it } from "vitest";
import { locate, parse, setValue } from "../../src/index.js";
import type { EditOptions, EditValue } from "../../src/index.js";
import { parseJsonBytes } from "../../src/adapters/json/parse.js";
import { resolvePointer } from "../../src/model/pointer.js";

const origin = { id: "w", label: "<w>" };
const yaml: EditOptions = { format: "yaml", origin };
const json: EditOptions = { format: "json", origin };
const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

function apply(bytes: Uint8Array, edit: { start: number; end: number; bytes: Uint8Array }): Uint8Array {
  return Uint8Array.from([...bytes.subarray(0, edit.start), ...edit.bytes, ...bytes.subarray(edit.end)]);
}

/** Set, apply, read back with the reader; returns the value at the pointer. */
function roundTrip(options: EditOptions, text: string, pointer: string, value: EditValue) {
  const input = enc(text);
  const result = setValue(input, options, pointer, value);
  if (!result.ok) return { ok: false as const, codes: result.diagnostics.map((d) => d.code) };
  const applied = apply(input, result.edit);
  const outcome = options.format === "yaml" ? parse(applied, { origin }) : parseJsonBytes(applied, origin);
  if (!outcome.ok) return { ok: false as const, codes: ["does-not-parse"] };
  const node = resolvePointer(outcome.tree, pointer);
  return { ok: true as const, node, applied };
}

// The strings of the probe gate: non-ASCII, boundary, adversarial, and every clause of FR-008.
const STRINGS: readonly string[] = [
  "ü", "é", "日本", "😀x", "", " ", "x", "- x", "*a", "!t", "%", "%x", "key: v #c", "a\rb", "a\nb", "a\r\nb", "yes", "No", "ON", "off", "y", "N", "true", "null", "~", "1e3", "3", "3.2",
  ".inf", "-.inf", ".nan", "0x1F", "0o7", "0755", "0b101", "1_000", "1:30", "2001-12-14", "2001-12-14 21:59:43.10 -5", "<<", "=", "a: b", "a #b", "a#b", "'x", "x'", "@x", "`x", "x:", ":x",
  "a:b", "a, b", "a]", "a[", "-", "?", "- ", "---", "...", "-x", "?x", "﻿x", "x\u0085y", "x y", "tab\there", "#c", "x ", " x", "a  b", "&a", "|x", ">x", "{x", "}x", "[x", '"x',
  "a:  b", "Null", "True", "inf", "nan", "+1", "-1", "1.", ".5", "5e", "x\u0000y", "x\u007Fy", " x", "it's", 'say "hi"', "back\\slash", "a\tb", "😀", "x￾y",
];

describe("FR-008, the probe gate: every string comes back as the string set", () => {
  const contexts: readonly [string, string, string][] = [
    ["block, plain", "k: x\n", "/k"],
    ["block, single-quoted", "k: 'x'\n", "/k"],
    ["block, double-quoted", 'k: "x"\n', "/k"],
    ["flow sequence", "[a, b]\n", "/1"],
    ["flow mapping", "{k: v}\n", "/k"],
    ["root scalar", "x\n", ""],
    ["sequence item", "- x\n", "/0"],
    ["after a comment", "k: x # note\n", "/k"],
    ["a number replaced", "k: 3\n", "/k"],
  ];
  for (const [label, text, pointer] of contexts) {
    it(`YAML, ${label}`, () => {
      for (const s of STRINGS) {
        const result = roundTrip(yaml, text, pointer, s);
        expect(result.ok, `${JSON.stringify(s)} was refused: ${result.ok ? "" : result.codes.join()}`).toBe(true);
        if (result.ok) {
          expect(result.node?.type === "scalar" && result.node.kind === "string" && result.node.value === s, JSON.stringify(s)).toBe(true);
        }
      }
    });
  }
  it("JSON", () => {
    for (const s of STRINGS) {
      const result = roundTrip(json, '{"k": [1, "x"]}', "/k/1", s);
      expect(result.ok, JSON.stringify(s)).toBe(true);
      if (result.ok) expect(result.node?.type === "scalar" && result.node.kind === "string" && result.node.value === s).toBe(true);
    }
  });
  it("a 1 MiB string, in YAML and in JSON", () => {
    const big = "word ".repeat(1 << 18);
    for (const [options, text] of [[yaml, "k: x\n"], [json, '{"k": "x"}']] as const) {
      const result = roundTrip(options, text, "/k", big);
      expect(result.ok && result.node?.type === "scalar" && result.node.value === big).toBe(true);
    }
  });
  it("a lone surrogate is unrepresentable, never a throw", () => {
    for (const options of [yaml, json]) {
      const result = setValue(enc(options.format === "yaml" ? "k: x\n" : '{"k": "x"}'), options, "/k", "a\ud800");
      expect(result.ok ? [] : result.diagnostics.map((d) => d.code)).toEqual(["edit-unrepresentable"]);
    }
  });
});

describe("FR-006: numbers read back as the kind the rule names", () => {
  const numbers: readonly number[] = [0, -0, 1, -1, 3, 3.5, 0.1 + 0.2, 1e21, 1e-7, 1.5e300, 5e-324, Number.MAX_SAFE_INTEGER, 2 ** 70, -(2 ** 53)];
  for (const [label, text, pointer, options] of [
    ["YAML over a float", "k: 1.5\n", "/k", yaml],
    ["YAML over an int", "k: 1\n", "/k", yaml],
    ["YAML over a string", "k: x\n", "/k", yaml],
    ["JSON over a float", '{"k": 1.5}', "/k", json],
    ["JSON over an int", '{"k": 1}', "/k", json],
  ] as const) {
    it(label, () => {
      for (const n of numbers) {
        const result = roundTrip(options, text, pointer, n);
        expect(result.ok, String(n)).toBe(true);
        if (result.ok && result.node?.type === "scalar") {
          // v1.15: a whole number keeps an integer's kind; over anything else a `number` is a decimal.
          const overInt = label.endsWith("over an int");
          const kind = overInt && Number.isInteger(n) ? "int" : "float";
          expect(result.node.kind, String(n)).toBe(kind);
          expect(Number(result.node.value) === n, String(n)).toBe(true); // -0 over an int is the int 0, and 0 === -0 in the model
        }
      }
    });
  }
});

describe("never throws for a document or a value; throws for programmer error", () => {
  it("garbage and empty bytes give diagnostics", () => {
    for (const options of [yaml, json]) {
      for (const bytes of [new Uint8Array(), enc("{"), enc("[1,"), Uint8Array.of(0xff, 0xfe), enc("a: *nope\n")]) {
        expect(() => locate(bytes, options, "/a")).not.toThrow();
        expect(() => setValue(bytes, options, "/a", 1)).not.toThrow();
      }
    }
  });
  it("a missing origin, an unknown format, a pointer or a value of the wrong type is programmer error", () => {
    const doc = enc("a: 1\n");
    expect(() => locate(doc, { format: "yaml" } as unknown as EditOptions, "/a")).toThrow(/origin/);
    expect(() => locate(doc, { format: "toml", origin } as unknown as EditOptions, "/a")).toThrow(/format/);
    // v1.17 FR-002 and FR-003: a pointer that is not a string throws a TypeError; a malformed one is refused.
    expect(() => locate(doc, yaml, 1 as unknown as string)).toThrow(TypeError);
    expect(locate(doc, yaml, "a")).toMatchObject({ ok: false, diagnostics: [{ code: "path-malformed", primary: { start: 0, end: 0 } }] });
    // v1.15 FR-007: a value is a scalar, an array or a Map; a plain object still throws, and the message names what it found.
    expect(() => setValue(doc, yaml, "/a", {} as unknown as EditValue)).toThrow(/plain object/);
  });
  it("pointer escapes: ~1 is a slash in a key, ~0 a tilde, any other ~ malformed", () => {
    const doc = enc("'a/b': 1\n'c~d': 2\n");
    expect(locate(doc, yaml, "/a~1b")).toMatchObject({ ok: true, start: 7, end: 8 });
    const tilde = locate(doc, yaml, "/c~0d");
    expect(tilde).toMatchObject({ ok: true, kind: "int" });
    for (const pointer of ["/c~d", "/c~2d", "/a~"]) expect(locate(doc, yaml, pointer)).toMatchObject({ ok: false, diagnostics: [{ code: "path-malformed" }] });
  });
  it("an empty root pointer on a scalar document", () => {
    const result = roundTrip(yaml, "3\n", "", 4);
    expect(result.ok && result.node?.type === "scalar" && result.node.value).toBe(4n);
  });
});
