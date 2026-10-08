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
 * Only the first prefix is scanned. A later document may have its own — after
 * `...`, or ahead of its `---` — but Cascata refuses a second document anyway
 * (`multiple-documents`); `laterDocumentMark` finds the one form `yaml` misses.
 */
export function documentPrefixMarks(text: string): number[] {
  return scanPrefix(text, 0).marks;
}

/** A prefix from `from`: its marks, and the index where content begins (or `text.length`). */
function scanPrefix(text: string, from: number): { readonly marks: number[]; readonly content: number } {
  const marks: number[] = [];
  let index = from;
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
    if (probe >= text.length) return { marks, content: text.length };
    if (text[probe] === "\r" && text[probe + 1] === "\n") {
      index = probe + 2;
    } else if (text[probe] === "\n" || text[probe] === "\r") {
      index = probe + 1;
    } else {
      return { marks, content: index }; // content begins on this line
    }
  }
}

/**
 * The first mark after the leading prefix that opens a later document's prefix ahead of its `---`
 * (YAML 1.2.2's `c-byte-order-mark l-comment* l-explicit-document`), with the marker's index; v1.12.1.
 * `yaml` does not see such a `---` as a marker at all, so it reports no second document there.
 */
export function laterDocumentMark(text: string, prefixMarks: readonly number[]): { readonly mark: number; readonly marker: number } | undefined {
  const inPrefix = new Set(prefixMarks);
  for (const mark of allMarks(text)) {
    if (inPrefix.has(mark) || (mark > 0 && text[mark - 1] !== "\n" && text[mark - 1] !== "\r")) continue;
    const marker = scanPrefix(text, mark).content;
    const after = text[marker + 3];
    if (text.startsWith("---", marker) && (after === undefined || after === " " || after === "\t" || after === "\n" || after === "\r")) {
      return { mark, marker };
    }
  }
  return undefined;
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
 * `text` with every prefix mark removed, so that no mark in a prefix can
 * disturb what follows it: `yaml` strips one per line itself, takes a second
 * into the first key, and — once that second is blanked instead — turns
 * `⌁⌁---` into ` ---`, which is not a document marker. Removal shifts every
 * later index, so the parser's indices are mapped back to stored ones by
 * `storedIndexer` (the Rust compiler's `NormalizedPos` is the precedent:
 * original = normalized + the total width removed before it).
 */
export function removePrefixMarks(text: string, prefixMarks: readonly number[]): string {
  if (prefixMarks.length === 0) return text;
  // One pass, joined once — a prefix of 300,000 marks must not cost 300,000 copies.
  const pieces: string[] = [];
  let from = 0;
  for (const index of prefixMarks) {
    pieces.push(text.slice(from, index));
    from = index + 1;
  }
  pieces.push(text.slice(from));
  return pieces.join("");
}

/**
 * Maps an index into `removePrefixMarks(text, prefixMarks)` back to the
 * stored text's index. The i-th removed mark (0-based, ascending) sat at
 * stored index `m` and left the parser's text at `m - i`; a parser index `p`
 * has had `i + 1` marks removed before it for every `m_i - i <= p`, so it
 * lands after them — a node's range begins after the prefix, never inside it.
 * Binary search: a document may have a very long prefix and many nodes.
 */
export function storedIndexer(prefixMarks: readonly number[]): (parserIndex: number) => number {
  return (parserIndex) => {
    let low = 0;
    let high = prefixMarks.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((prefixMarks[middle] ?? 0) - middle <= parserIndex) low = middle + 1;
      else high = middle;
    }
    return parserIndex + low;
  };
}
