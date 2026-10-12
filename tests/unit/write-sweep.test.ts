/**
 * v1.15 FR-024, FR-023 -- the adversarial sweep: every document in the repository's own corpora (the parse corpus and the write corpus:
 * anchors, tags, merge keys, explicit keys, flow, odd whitespace, BOMs, non-ASCII), asked for every add, remove and container write
 * the document's tree allows.
 *
 * Whatever the document: nothing throws; an answered edit parses and is the original tree with the operation applied (judged here by a
 * restatement, under the default policy, where nothing shared is written); and the writer's safety net, `edit-read-back`, is not what
 * it answers -- except for the shapes it is documented to refuse, listed in `KNOWN` by name.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseJsonBytes } from "../../src/adapters/json/parse.js";
import { createOrigin, openDocument, parse } from "../../src/index.js";
import type { EditData, EditOptions } from "../../src/index.js";

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const origin = createOrigin("sweep", "sweep");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus");

interface Doc {
  readonly name: string;
  readonly format: "yaml" | "json";
  readonly bytes: Uint8Array;
}

function collect(dir: string, into: Doc[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collect(path, into);
    else if (entry.name.endsWith(".json")) {
      const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
      if (typeof raw !== "object" || raw === null) continue;
      const fields = raw as Record<string, unknown>;
      const format = fields["format"];
      if (format !== "yaml" && format !== "json") continue;
      if (typeof fields["input"] === "string") into.push({ name: path.slice(ROOT.length + 1), format, bytes: ENC.encode(fields["input"]) });
      else if (Array.isArray(fields["inputBytes"])) into.push({ name: path.slice(ROOT.length + 1), format, bytes: Uint8Array.from((fields["inputBytes"] as number[]).map(Number)) });
    }
  }
}

type Plain = { s: string } | { m: Map<string, Plain> } | { q: Plain[] };

function plainOf(bytes: Uint8Array, format: "yaml" | "json"): Plain | undefined {
  const read = format === "yaml" ? parse(bytes, { origin }) : parseJsonBytes(bytes, origin);
  if (!read.ok) return undefined;
  const walk = (node: typeof read.tree): Plain => (node.type === "scalar" ? { s: `${node.kind}:${String(node.value)}` } : node.type === "mapping" ? { m: new Map([...node.entries].map(([k, v]) => [k, walk(v)] as const)) } : { q: node.items.map(walk) });
  return walk(read.tree);
}

const canon = (p: Plain): string => ("s" in p ? JSON.stringify(p.s) : "m" in p ? `{${[...p.m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${JSON.stringify(k)}:${canon(v)}`).join(",")}}` : `[${p.q.map(canon).join(",")}]`);

function places(plain: Plain, prefix: string[] = [], out: { path: string[]; plain: Plain }[] = []): { path: string[]; plain: Plain }[] {
  out.push({ path: prefix, plain });
  if (out.length > 40) return out;
  if ("m" in plain) for (const [k, v] of plain.m) places(v, [...prefix, k], out);
  if ("q" in plain) plain.q.forEach((v, i) => places(v, [...prefix, String(i)], out));
  return out;
}

const esc = (s: string): string => s.replace(/~/g, "~0").replace(/\//g, "~1");
const pointerOf = (segments: readonly string[]): string => segments.map((s) => `/${esc(s)}`).join("");

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

const plainOfData = (data: EditData): Plain => {
  if (Array.isArray(data)) return { q: data.map(plainOfData) };
  if (data instanceof Map) return { m: new Map([...data].map(([k, v]) => [k, plainOfData(v)] as const)) };
  const kind = typeof data === "string" ? "string" : typeof data === "boolean" ? "bool" : data === null ? "null" : typeof data === "bigint" ? "int" : "float"; // v1.15: a new `number` is a decimal
  return { s: `${kind}:${String(data)}` };
};

function applyEdit(bytes: Uint8Array, edit: { start: number; end: number; bytes: Uint8Array }): Uint8Array {
  const out = new Uint8Array(bytes.length - (edit.end - edit.start) + edit.bytes.length);
  out.set(bytes.subarray(0, edit.start), 0);
  out.set(edit.bytes, edit.start);
  out.set(bytes.subarray(edit.end), edit.start + edit.bytes.length);
  return out;
}

const PAYLOADS: EditData[] = [7, "café", [1, "two"], new Map<string, EditData>([["k", 1], ["yes", [true]]]), new Map(), []];

describe("v1.15 FR-024 -- the adversarial sweep over the repository's own documents", () => {
  const docs: Doc[] = [];
  collect(join(ROOT, "cases"), docs);
  collect(join(ROOT, "write-cases"), docs);

  it("there are documents to sweep", () => {
    expect(docs.length).toBeGreaterThan(250);
  });

  for (const policy of ["refuse", "allow"] as const) it(`${policy}: nothing throws, every answered edit parses${policy === "refuse" ? " and is the original with the operation applied, and the safety net is never what answers" : " (what is shared is written through, so the original is not the oracle)"}`, { timeout: 300_000 }, () => {
    const options = (format: "yaml" | "json"): EditOptions => ({ format, origin, sharedEdits: policy });
    const failures: string[] = [];
    const refused: Record<string, number> = {};
    let swept = 0;
    let answered = 0;
    const seen = new Set<string>();
    for (const doc of docs) {
      const key = `${doc.format}:${DEC.decode(doc.bytes)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const before = plainOf(doc.bytes, doc.format);
      if (before === undefined) continue;
      const opened = openDocument(doc.bytes, options(doc.format));
      if (!opened.ok) continue;
      const { document } = opened;
      swept += 1;
      const note = (message: string): void => void failures.push(`${doc.name}: ${message}\n    ${JSON.stringify(DEC.decode(doc.bytes))}`);
      for (const place of places(before)) {
        const pointer = pointerOf(place.path);
        const attempts: [string, () => ReturnType<typeof document.remove>, ((plain: Plain) => Plain) | undefined][] = [];
        if (place.path.length > 0) {
          attempts.push([`remove ${pointer}`, () => document.remove(pointer), (plain) => without(plain, place.path, (c, last) => ("m" in c ? { m: new Map([...c.m].filter(([k]) => k !== last)) } : { q: (c as { q: Plain[] }).q.filter((_item: Plain, i: number) => i !== Number(last)) }))]);
        }
        if ("m" in place.plain || "q" in place.plain) {
          for (const [at, data] of PAYLOADS.entries()) {
            const target = "m" in place.plain ? [...place.path, `zz${at}`] : [...place.path, at % 2 === 0 ? "-" : "0"];
            const where = pointerOf(target);
            attempts.push([`add ${where}`, () => document.add(where, data), (plain) => without(plain, target, (c, last) => ("m" in c ? { m: new Map([...c.m, [last, plainOfData(data)]]) } : { q: last === "-" ? [...(c as { q: Plain[] }).q, plainOfData(data)] : [plainOfData(data), ...(c as { q: Plain[] }).q] }))]);
          }
        }
        for (const data of PAYLOADS.slice(1, 4)) {
          attempts.push([`set ${pointer} ${JSON.stringify(data instanceof Map ? [...data] : data)}`, () => document.setValue(pointer, data), (plain) => (place.path.length === 0 ? plainOfData(data) : without(plain, place.path, (c, last) => ("m" in c ? { m: new Map([...c.m, [last, plainOfData(data)]]) } : { q: (c as { q: Plain[] }).q.map((item: Plain, i: number) => (i === Number(last) ? plainOfData(data) : item)) })))]);
        }
        for (const [label, run, expectedOf] of attempts) {
          let result: ReturnType<typeof run>;
          try {
            result = run();
          } catch (error) {
            note(`${label} threw: ${error instanceof Error ? error.message : String(error)}`);
            continue;
          }
          if (!result.ok) {
            const code = result.diagnostics[0]?.code ?? "?";
            refused[code] = (refused[code] ?? 0) + 1;
            // Documented: a container that carries an explicit tag is not re-tagged, so a value its tag cannot hold is refused as edit-read-back.
            const known = /is tagged, and the tag cannot hold/.test(result.diagnostics[0]?.message ?? "");
            if (code === "edit-read-back" && !known && process.env["PROP_ALLOW"] !== undefined && policy === "allow") note(`ALLOW ${label}: ${result.diagnostics[0]?.message ?? ""}`);
            if (code === "edit-read-back" && !known && policy === "refuse") note(`${label} was refused as edit-read-back: ${result.diagnostics[0]?.message ?? ""}`);
            continue;
          }
          answered += 1;
          const after = plainOf(applyEdit(doc.bytes, result.edit), doc.format);
          if (after === undefined) note(`${label}: the edited document does not parse`);
          else if (policy === "refuse" && expectedOf !== undefined && canon(after) !== canon(expectedOf(before))) note(`${label}: not the original with the operation applied`);
        }
      }
    }
    if (process.env["PROP_STATS"] !== undefined) console.log("sweep", policy, JSON.stringify({ swept, answered, refused }));
    expect(failures.slice(0, Number(process.env["PROP_SHOW"] ?? 8))).toEqual([]);
    expect(swept).toBeGreaterThan(150);
  });
});
