/**
 * Where a byte-order mark may sit in a YAML document — SPEC.md §4.2 and §15
 * ("Spans count stored bytes", v1.9); specs/017-stored-bytes FR-005.
 *
 * YAML 1.2.2 admits U+FEFF in exactly two places: in a **document prefix**
 * (`l-document-prefix ::= c-byte-order-mark? l-comment*`, repeatable, ahead of
 * the document's content), and as content of a **quoted scalar** (`nb-json`).
 * Everywhere else — a plain scalar, a block scalar, a comment (`nb-char`
 * excludes it), a key, a tag, a later line — it is not a character at all.
 * The `yaml` package eats one mark per line while it is still in its stream
 * state and otherwise admits one silently as the first character of a key
 * (research: specs/017-stored-bytes/plan.md), so the refusal is Cascata's.
 *
 * This file is format knowledge with no `yaml` import: it scans the stored
 * text. The quoted-scalar half needs the parsed AST and lives in `parse.ts`.
 */

export const BYTE_ORDER_MARK = "﻿";

/**
 * The marks of the document prefix at the start of `text`, as UTF-16 indices.
 *
 * A prefix is any number of: marks, then — when the rest of the line is blank
 * or a comment — that line. Scanning stops at the first line that carries
 * content (including `---`, `%` directives, anything else). A mark after
 * whitespace, or inside a comment, is not recorded: it is not in a prefix.
 *
 * Only the first prefix is scanned. A document after `...` may have its own,
 * but Cascata refuses a second document anyway (`multiple-documents`).
 */
export function documentPrefixMarks(text: string): number[] {
  const marks: number[] = [];
  let index = 0;
  for (;;) {
    while (text[index] === BYTE_ORDER_MARK) {
      marks.push(index);
      index += 1;
    }
    let probe = index;
    while (text[probe] === " " || text[probe] === "\t") probe += 1;
    if (text[probe] === "#") {
      while (probe < text.length && text[probe] !== "\n" && text[probe] !== "\r") probe += 1;
    }
    if (probe >= text.length) return marks;
    if (text[probe] === "\r" && text[probe + 1] === "\n") {
      index = probe + 2;
    } else if (text[probe] === "\n" || text[probe] === "\r") {
      index = probe + 1;
    } else {
      return marks; // content begins on this line
    }
  }
}

/** Every U+FEFF in `text`, as UTF-16 indices. */
export function allMarks(text: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(BYTE_ORDER_MARK); at !== -1; at = text.indexOf(BYTE_ORDER_MARK, at + 1)) {
    found.push(at);
  }
  return found;
}

/**
 * `text` with each prefix mark that is not the first on its line blanked to a
 * space — one code unit for one, so no offset moves. `yaml` strips the first
 * mark of a prefix line itself and takes a second (`⌁⌁a: 1`) into the key.
 */
export function blankRepeatedPrefixMarks(text: string, prefixMarks: readonly number[]): string {
  // One pass over the marks, joined once — a prefix of 300,000 marks must not
  // cost 300,000 copies of the document.
  const pieces: string[] = [];
  let from = 0;
  for (const index of prefixMarks) {
    if (text[index - 1] === BYTE_ORDER_MARK) {
      pieces.push(text.slice(from, index), " ");
      from = index + 1;
    }
  }
  if (from === 0) return text;
  pieces.push(text.slice(from));
  return pieces.join("");
}
