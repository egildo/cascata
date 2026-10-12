/**
 * How a YAML scalar is spelled -- SPEC.md Article IX (§19, v1.10); specs/018-write-value FR-008.
 *
 * A plain scalar is the nicest spelling and the easiest to get wrong, so the rule is conservative on
 * purpose: **plain only if it reads back as the same string under Cascata's reader and under YAML
 * 1.1's** (`yes`, `no`, `on`, `off`, `y`, `n` are strings to Cascata and booleans to a reader that
 * has not heard of YAML 1.2). Whatever is not plainly safe is quoted -- in the style the replaced
 * scalar used where that style can hold the text, double-quoted with YAML escapes where it cannot.
 * The probe behind each clause is in `specs/018-write-value/plan.md`. Since v1.15 the same rule
 * spells a mapping's keys and the strings of a container written whole.
 */

import type { Found } from "../edit.js";

/** YAML spells the three non-finite floats `.nan`, `.inf`, `-.inf`. */
export function yamlNonFinite(value: number): string {
  return Number.isNaN(value) ? ".nan" : value > 0 ? ".inf" : "-.inf";
}

/**
 * A value that has no bytes yet (`a:` followed by a line break, `a: # c`) is
 * replaced at an empty range, so the text needs the space the colon wanted
 * before it, and the space a comment needs after it. Both are inside the
 * edit; no byte outside it moves.
 */
export function yamlPadding(bytes: Uint8Array, at: number, text: string): string {
  const before = bytes[at - 1];
  const after = bytes[at];
  // Nor after a byte-order mark: the value of an empty document starts right after the prefix marks (v1.12 FR-009).
  const afterMark = at >= 3 && bytes[at - 3] === 0xef && bytes[at - 2] === 0xbb && before === 0xbf;
  const needsBefore = before !== undefined && before !== 0x20 && before !== 0x09 && before !== 0x0a && before !== 0x0d && !afterMark;
  return `${needsBefore ? " " : ""}${text}${after === 0x23 ? " " : ""}`;
}

/** Controls (tab excepted), DEL, C1, the line and paragraph separators, the byte-order mark, and the two noncharacters: never raw in a quoted scalar we write. */
const NEEDS_ESCAPE = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F\u2028\u2029\uFEFF\uFFFE\uFFFF]/;

/** Forms a reader may take for something other than a string: YAML 1.2's core schema and 1.1's (booleans, numbers with `_`, `:` or a base prefix, timestamps, `<<`, `=`). Conservative: a false positive costs a pair of quotes. */
const NOT_A_PLAIN_STRING: readonly RegExp[] = [
  /^(y|n|yes|no|on|off|true|false|null|~)$/i,
  /^[-+]?(\.inf|\.nan)$/i,
  /^[-+]?(\.|\d)[\d_.:,eExXoObBa-fA-F+-]*$/,
  /^\d{4}-\d\d?-\d\d?/,
  /^(<<|=)$/,
];

/** FR-008: may `text` be written plain, here? */
function plainSafe(text: string, inFlow: boolean): boolean {
  if (text === "" || /^\s|\s$/.test(text) || NEEDS_ESCAPE.test(text)) return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(text) || text.startsWith("...")) return false;
  if (/:(\s|$)/.test(text) || /[ \t]#/.test(text)) return false;
  if (inFlow && /[,[\]{}]/.test(text)) return false;
  return !NOT_A_PLAIN_STRING.some((pattern) => pattern.test(text));
}

function doubleQuote(text: string): string {
  let out = '"';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (character === '"') out += '\\"';
    else if (character === "\\") out += "\\\\";
    else if (character === "\n") out += "\\n";
    else if (character === "\r") out += "\\r";
    else if (character === "\t") out += "\\t";
    else if (code === 0x2028 || code === 0x2029 || code === 0xfeff || code === 0xfffe || code === 0xffff) out += `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) out += `\\x${code.toString(16).toUpperCase().padStart(2, "0")}`;
    else out += character;
  }
  return `${out}"`;
}

/** Single quotes hold anything printable on one line; an embedded `'` is doubled. */
function singleQuote(text: string): string | undefined {
  return NEEDS_ESCAPE.test(text) ? undefined : `'${text.replace(/'/g, "''")}'`;
}

export function renderYamlString(text: string, found: Pick<Found, "style" | "inFlow">): string {
  if (found.style === "single") return singleQuote(text) ?? doubleQuote(text);
  if (found.style === "double") return doubleQuote(text);
  return plainSafe(text, found.inFlow) ? text : doubleQuote(text);
}

