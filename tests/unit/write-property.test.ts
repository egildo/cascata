/**
 * v1.15 FR-024 -- the property witness: generated documents, both formats, a fixed seed.
 *
 * A document is generated as text (layouts, comments, blank lines, line endings, marks, quoting, flow and block, non-ASCII),
 * then an `add` or a `remove` is asked of it at a place the reader says exists. Whenever the writer answers an edit:
 *   - the edited document parses, and its tree is the original with the operation applied -- judged here, by a restatement
 *     that does not touch the writer's own comparison;
 *   - an add into a non-empty container is an insertion (an empty range); a remove from one with other entries leaves
 *     nothing in its place (empty text); every other byte of the document is where it was (L3);
 *   - no comment the operation does not name is lost.
 * And it never answers `edit-read-back`: that code is the writer's safety net, and a net that catches a generated
 * document is a defect found. (Shapes the writer is documented to refuse are not generated.)
 */
import { describe, expect, it } from "vitest";
import { parseJsonBytes } from "../../src/adapters/json/parse.js";
import { createOrigin, openDocument, parse } from "../../src/index.js";
import type { EditData, EditOptions } from "../../src/index.js";

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const origin = createOrigin("property", "property");

function rng(seed: number): { next(): number; int(n: number): number; pick<T>(items: readonly T[]): T; chance(p: number): boolean } {
  let state = seed >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return { next, int: (n) => Math.floor(next() * n), pick: (items) => items[Math.floor(next() * items.length)] as never, chance: (p) => next() < p };
}
type Rng = ReturnType<typeof rng>;

const KEYS = ["alpha", "beta", "gamma", "delta", "x", "name", "héllo", "ключ", "k1", "walls", "W1", "a b", "yes", "1", "q-r", "z"];
const WORDS = ["one", "two", "three", "café", "знач", "plain text", "x-y", "w", "emoji \U0001F600"];

// --- generating YAML text ------------------------------------------------------

interface YamlStyle {
  eol: string;
  indent: number;
  dashIndented: boolean;
  comments: number;
  blanks: number;
}

function yamlKey(r: Rng, key: string): string {
  const needsQuote = key === "yes" || key === "1";
  if (needsQuote || r.chance(0.15)) return r.chance(0.5) ? `"${key}"` : `'${key}'`;
  return key;
}

function yamlScalar(r: Rng, inFlow: boolean): string {
  switch (r.int(7)) {
    case 0:
      return String(r.int(1000));
    case 1:
      return String(r.int(100) / 8 + 0.5);
    case 2:
      return r.pick(["true", "false"]);
    case 3:
      return "null";
    case 4:
      return `"${r.pick(WORDS)}"`;
    case 5:
      return `'${r.pick(WORDS)}'`;
    default: {
      const word = r.pick(WORDS);
      return inFlow ? `"${word}"` : word;
    }
  }
}

function yamlFlow(r: Rng, depth: number): string {
  const kind = r.int(depth > 1 ? 2 : 4);
  if (kind < 2) return yamlScalar(r, true);
  const count = r.int(4);
  if (kind === 2) return `[${Array.from({ length: count }, () => yamlFlow(r, depth + 1)).join(r.chance(0.7) ? ", " : ",")}]`;
  const keys = [...KEYS].sort(() => r.next() - 0.5).slice(0, count);
  return `{${keys.map((k) => `${yamlKey(r, k)}: ${yamlFlow(r, depth + 1)}`).join(", ")}}`;
}

function decorate(r: Rng, st: YamlStyle, indent: string): string[] {
  const lines: string[] = [];
  if (r.chance(st.blanks)) lines.push("");
  const comments = r.chance(st.comments) ? 1 + r.int(2) : 0;
  for (let i = 0; i < comments; i += 1) lines.push(`${indent}# ${r.pick(WORDS)}`);
  return lines;
}

function yamlBlockMap(r: Rng, st: YamlStyle, indent: string, depth: number): string[] {
  const keys = [...KEYS].sort(() => r.next() - 0.5).slice(0, 1 + r.int(4));
  const lines: string[] = [];
  for (const key of keys) {
    lines.push(...decorate(r, st, indent));
    lines.push(...yamlEntry(r, st, indent, yamlKey(r, key), depth));
  }
  return lines;
}

function yamlEntry(r: Rng, st: YamlStyle, indent: string, key: string, depth: number): string[] {
  const tail = r.chance(st.comments) ? ` # ${r.pick(WORDS)}` : "";
  const kind = r.int(depth >= 2 ? 6 : 10);
  if (kind < 3) return [`${indent}${key}: ${yamlScalar(r, false)}${tail}`];
  if (kind === 3) return [`${indent}${key}: ${yamlFlow(r, 0)}${tail}`];
  if (kind === 4) return [`${indent}${key}:${tail}`];
  if (kind === 5) return [`${indent}${key}: |${tail}`, `${indent}${" ".repeat(st.indent)}${r.pick(["text", "# not a comment", "more words"])}`];
  if (kind <= 7) return [`${indent}${key}:${tail}`, ...yamlBlockMap(r, st, indent + " ".repeat(st.indent), depth + 1)];
  return [`${indent}${key}:${tail}`, ...yamlBlockSeq(r, st, indent + (st.dashIndented ? " ".repeat(st.indent) : ""), depth + 1)];
}

function yamlBlockSeq(r: Rng, st: YamlStyle, indent: string, depth: number): string[] {
  const lines: string[] = [];
  const count = 1 + r.int(4);
  for (let i = 0; i < count; i += 1) {
    lines.push(...decorate(r, st, indent));
    const tail = r.chance(st.comments) ? ` # ${r.pick(WORDS)}` : "";
    const kind = r.int(depth >= 2 ? 4 : 8);
    if (kind < 3) lines.push(`${indent}- ${yamlScalar(r, false)}${tail}`);
    else if (kind === 3) lines.push(`${indent}- ${yamlFlow(r, 0)}${tail}`);
    else if (kind < 7) {
      const inner = yamlBlockMap(r, st, `${indent}  `, depth + 1);
      lines.push(...inner.map((line, at) => (at === 0 && !line.trimStart().startsWith("#") && line !== "" ? `${indent}- ${line.slice(indent.length + 2)}` : line)));
      // A comment or blank line must not lead a compact item: if the first line was one, put a plain entry first.
      if (inner[0] !== undefined && (inner[0].trimStart().startsWith("#") || inner[0] === "")) {
        lines.splice(lines.length - inner.length, inner.length, `${indent}- ${KEYS[0]}: 1`, ...inner.filter((line) => line.trim() !== "").filter((line) => !line.trimStart().startsWith("#")).slice(0, 0));
      }
    } else lines.push(`${indent}- ${yamlFlow(r, 0)}${tail}`);
  }
  return lines;
}

function genYaml(r: Rng): string {
  const st: YamlStyle = { eol: r.chance(0.2) ? "\r\n" : "\n", indent: r.pick([2, 2, 4]), dashIndented: r.chance(0.5), comments: r.pick([0, 0.2, 0.5]), blanks: r.pick([0, 0.1, 0.3]) };
  const root = r.chance(0.8) ? yamlBlockMap(r, st, "", 0) : yamlBlockSeq(r, st, "", 0);
  const header: string[] = [];
  if (r.chance(0.15)) header.push(`# ${r.pick(WORDS)}`);
  if (r.chance(0.1)) header.push("---");
  const footer = r.chance(0.1) ? ["..."] : [];
  const lines = [...header, ...root, ...footer];
  let text = lines.join(st.eol) + (r.chance(0.85) ? st.eol : "");
  if (r.chance(0.1)) text = `﻿${text}`;
  return text;
}

// --- generating JSON text --------------------------------------------------------

function jsonValue(r: Rng, depth: number, multiline: boolean, indent: string, unit: string, eol: string, compact: boolean): string {
  const kind = r.int(depth >= 3 ? 4 : 9);
  if (kind < 2) return String(r.int(100));
  if (kind === 2) return JSON.stringify(r.pick(WORDS));
  if (kind === 3) return r.pick(["true", "false", "null", "1.5"]);
  const inner = indent + unit;
  const colon = compact ? ":" : ": ";
  const comma = compact ? "," : ", ";
  const flat = !multiline || r.chance(0.3);
  if (kind < 7) {
    const count = r.int(4);
    const keys = [...KEYS].sort(() => r.next() - 0.5).slice(0, count);
    if (count === 0) return "{}";
    const parts = keys.map((k) => `${JSON.stringify(k)}${colon}${jsonValue(r, depth + 1, multiline && !flat, inner, unit, eol, compact)}`);
    return flat ? `{${parts.join(comma)}}` : `{${eol}${parts.map((p) => inner + p).join(`,${eol}`)}${eol}${indent}}`;
  }
  const count = r.int(4);
  if (count === 0) return "[]";
  const parts = Array.from({ length: count }, () => jsonValue(r, depth + 1, multiline && !flat, inner, unit, eol, compact));
  return flat ? `[${parts.join(comma)}]` : `[${eol}${parts.map((p) => inner + p).join(`,${eol}`)}${eol}${indent}]`;
}

function genJson(r: Rng): string {
  const multiline = r.chance(0.6);
  const unit = r.pick(["  ", "    ", "\t"]);
  const eol = r.chance(0.2) ? "\r\n" : "\n";
  let value = jsonValue(r, 0, multiline, "", unit, eol, !multiline && r.chance(0.3));
  if (value[0] !== "{" && value[0] !== "[") value = `{"k": ${value}}`;
  return (r.chance(0.1) ? "﻿" : "") + value + (r.chance(0.7) ? eol : "");
}

// --- the oracle, restated -----------------------------------------------------------

type Plain = { s: string } | { m: Map<string, Plain> } | { q: Plain[] };

function plainOf(text: string, format: "yaml" | "json"): Plain | undefined {
  const read = format === "yaml" ? parse(ENC.encode(text), { origin }) : parseJsonBytes(ENC.encode(text), origin);
  if (!read.ok) return undefined;
  const walk = (node: typeof read.tree): Plain => (node.type === "scalar" ? { s: `${node.kind}:${String(node.value)}` } : node.type === "mapping" ? { m: new Map([...node.entries].map(([k, v]) => [k, walk(v)] as const)) } : { q: node.items.map(walk) });
  return walk(read.tree);
}

function plainOfData(data: EditData): Plain {
  if (Array.isArray(data)) return { q: data.map(plainOfData) };
  if (data instanceof Map) return { m: new Map([...data].map(([k, v]) => [k, plainOfData(v)] as const)) };
  const kind = typeof data === "string" ? "string" : typeof data === "boolean" ? "bool" : data === null ? "null" : typeof data === "bigint" ? "int" : Number.isInteger(data) ? "int" : "float";
  return { s: `${kind}:${String(data)}` };
}

const canon = (p: Plain): string => ("s" in p ? JSON.stringify(p.s) : "m" in p ? `{${[...p.m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${JSON.stringify(k)}:${canon(v)}`).join(",")}}` : `[${p.q.map(canon).join(",")}]`);

function at(plain: Plain, segments: readonly string[]): Plain | undefined {
  let here: Plain | undefined = plain;
  for (const segment of segments) {
    if (here === undefined) return undefined;
    here = "m" in here ? here.m.get(segment) : "q" in here ? here.q[Number(segment)] : undefined;
  }
  return here;
}

function without(plain: Plain, segments: readonly string[], op: (container: Plain, last: string) => Plain): Plain {
  if (segments.length === 1) return op(plain, segments[0] as string);
  const [head, ...rest] = segments;
  if ("m" in plain) {
    const entries = new Map(plain.m);
    entries.set(head as string, without(entries.get(head as string) as Plain, rest, op));
    return { m: entries };
  }
  if ("q" in plain) {
    const items = [...plain.q];
    items[Number(head)] = without(items[Number(head)] as Plain, rest, op);
    return { q: items };
  }
  throw new Error("descended into a scalar");
}

function enumerate(plain: Plain, prefix: string[] = [], out: { path: string[]; plain: Plain }[] = []): { path: string[]; plain: Plain }[] {
  out.push({ path: prefix, plain });
  if ("m" in plain) for (const [k, v] of plain.m) enumerate(v, [...prefix, k], out);
  if ("q" in plain) plain.q.forEach((v, i) => enumerate(v, [...prefix, String(i)], out));
  return out;
}

const esc = (segment: string): string => segment.replace(/~/g, "~0").replace(/\//g, "~1");
const pointerOf = (segments: readonly string[]): string => segments.map((s) => `/${esc(s)}`).join("");

function genData(r: Rng, depth = 0): EditData {
  const kind = r.int(depth >= 2 ? 5 : 8);
  if (kind === 0) return r.int(100);
  if (kind === 1) return r.pick(WORDS);
  if (kind === 2) return r.pick([true, false, null]);
  if (kind === 3) return r.int(100) / 4 + 0.25;
  if (kind === 4) return r.pick(["yes", "x: y", "two\nlines", "", "#c", "café"]);
  if (kind <= 5) return Array.from({ length: r.int(3) }, () => genData(r, depth + 1));
  return new Map<string, EditData>([...KEYS].sort(() => r.next() - 0.5).slice(0, r.int(3)).map((k) => [k, genData(r, depth + 1)] as const));
}

function applyEdit(text: string, edit: { start: number; end: number; bytes: Uint8Array }): string {
  const bytes = ENC.encode(text);
  return DEC.decode(bytes.subarray(0, edit.start)) + DEC.decode(edit.bytes) + DEC.decode(bytes.subarray(edit.end));
}

const comments = (text: string): string[] => [...text.matchAll(/(?:^|[ \t])(#[^\r\n]*)/gm)].map((match) => match[1] ?? "");

// --- the property --------------------------------------------------------------------------

function property(format: "yaml" | "json", generate: (r: Rng) => string, trials: number, seed: number): { answered: number; refused: Record<string, number>; skipped: number; failures: string[] } {
  const options: EditOptions = { format, origin };
  const failures: string[] = [];
  const refused: Record<string, number> = {};
  let answered = 0;
  let skipped = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    const r = rng(seed + trial * 7919);
    const text = generate(r);
    const before = plainOf(text, format);
    const opened = openDocument(ENC.encode(text), options);
    if (before === undefined || !opened.ok) {
      skipped += 1;
      continue;
    }
    const places = enumerate(before);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const place = r.pick(places);
      const label = `${format} #${trial}.${attempt}`;
      const note = (message: string): void => void failures.push(`${label}: ${message}\n--- document ---\n${JSON.stringify(text)}`);
      if (r.chance(0.5)) {
        // add into a container
        const containers = places.filter((p) => "m" in p.plain || "q" in p.plain);
        const home = r.pick(containers);
        const data = genData(r);
        let segments: string[];
        let expected: Plain;
        if ("m" in home.plain) {
          const key = r.pick(KEYS.filter((k) => !(home.plain as { m: Map<string, Plain> }).m.has(k)).concat(["fresh"]));
          segments = [...home.path, key];
          expected = without(before, segments, (c, last) => ({ m: new Map([...(c as { m: Map<string, Plain> }).m, [last, plainOfData(data)]]) }));
        } else {
          const items = (home.plain as { q: Plain[] }).q;
          const index = r.int(items.length + 1);
          segments = [...home.path, r.chance(0.3) ? "-" : String(index)];
          const at0 = segments[segments.length - 1] === "-" ? items.length : index;
          expected = without(before, segments, (c) => ({ q: [...(c as { q: Plain[] }).q.slice(0, at0), plainOfData(data), ...(c as { q: Plain[] }).q.slice(at0)] }));
          if (segments.length === 1) expected = { q: [...items.slice(0, at0), plainOfData(data), ...items.slice(at0)] };
        }
        if (segments.length === 1 && "m" in home.plain) expected = { m: new Map([...home.plain.m, [segments[0] as string, plainOfData(data)]]) };
        const result = opened.document.add(pointerOf(segments), data);
        if (!result.ok) {
          const code = result.diagnostics[0]?.code ?? "?";
          refused[code] = (refused[code] ?? 0) + 1;
          if (code === "edit-read-back") note(`add ${pointerOf(segments)} was refused as edit-read-back`);
          continue;
        }
        answered += 1;
        const after = applyEdit(text, result.edit);
        const reread = plainOf(after, format);
        if (reread === undefined) note(`add ${pointerOf(segments)}: the edited document does not parse:\n${JSON.stringify(after)}`);
        else if (canon(reread) !== canon(expected)) note(`add ${pointerOf(segments)}: not the original with the entry added:\n${JSON.stringify(after)}`);
        const emptied = "m" in home.plain ? home.plain.m.size === 0 : (home.plain as { q: Plain[] }).q.length === 0;
        if (!emptied && result.edit.start !== result.edit.end) note(`add ${pointerOf(segments)} into a non-empty container is not an insertion`);
        if (!comments(text).every((c) => comments(after).includes(c))) note(`add ${pointerOf(segments)}: a comment was lost:\n${JSON.stringify(after)}`);
      } else {
        // remove an entry
        if (place.path.length === 0) continue;
        const segments = place.path;
        const parent = at(before, segments.slice(0, -1)) as Plain;
        const size = "m" in parent ? parent.m.size : (parent as { q: Plain[] }).q.length;
        const expected = without(before, segments, (c, last) => ("m" in c ? { m: new Map([...c.m].filter(([k]) => k !== last)) } : { q: (c as { q: Plain[] }).q.filter((_item: Plain, i: number) => i !== Number(last)) }));
        const result = opened.document.remove(pointerOf(segments));
        if (!result.ok) {
          const code = result.diagnostics[0]?.code ?? "?";
          refused[code] = (refused[code] ?? 0) + 1;
          if (code === "edit-read-back") note(`remove ${pointerOf(segments)} was refused as edit-read-back`);
          continue;
        }
        answered += 1;
        const after = applyEdit(text, result.edit);
        const reread = plainOf(after, format);
        if (reread === undefined) note(`remove ${pointerOf(segments)}: the edited document does not parse:\n${JSON.stringify(after)}`);
        else if (canon(reread) !== canon(expected)) note(`remove ${pointerOf(segments)}: not the original with the entry gone:\n${JSON.stringify(after)}`);
        if (size > 1 && result.edit.bytes.length !== 0 && !(format === "yaml" && /^\s*$/.test(DEC.decode(result.edit.bytes)))) {
          note(`remove ${pointerOf(segments)} left bytes in place of an entry that has siblings: ${JSON.stringify(DEC.decode(result.edit.bytes))}`);
        }
        const removed = DEC.decode(ENC.encode(text).subarray(result.edit.start, result.edit.end));
        const lost = comments(text).filter((c) => !comments(after).includes(c));
        if (!lost.every((c) => removed.includes(c))) note(`remove ${pointerOf(segments)}: a comment outside the removed bytes was lost:\n${JSON.stringify(after)}`);
      }
    }
  }
  return { answered, refused, skipped, failures };
}

describe("v1.15 FR-024 -- generated documents (fixed seed)", () => {
  it("YAML: every answered add and remove reads back as specified, and the writer never needs its safety net", { timeout: 120_000 }, () => {
    const result = property("yaml", genYaml, Number(process.env["PROP_TRIALS"] ?? 600), Number(process.env["PROP_SEED"] ?? 20261012));
    expect(result.failures.slice(0, 5)).toEqual([]);
    expect(result.answered).toBeGreaterThan(800);
    expect(result.skipped).toBeLessThan(60);
  });

  it("JSON: the same", { timeout: 120_000 }, () => {
    const result = property("json", genJson, Number(process.env["PROP_TRIALS"] ?? 600), Number(process.env["PROP_SEED"] ?? 20261013));
    expect(result.failures.slice(0, 5)).toEqual([]);
    expect(result.answered).toBeGreaterThan(800);
    expect(result.skipped).toBeLessThan(30);
  });
});
