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
export declare const BYTE_ORDER_MARK = "\uFEFF";
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
export declare function documentPrefixMarks(text: string): number[];
/** Every U+FEFF in `text`, as UTF-16 indices. */
export declare function allMarks(text: string): number[];
/**
 * `text` with every prefix mark removed, so that no mark in a prefix can
 * disturb what follows it: `yaml` strips one per line itself, takes a second
 * into the first key, and — once that second is blanked instead — turns
 * `⌁⌁---` into ` ---`, which is not a document marker. Removal shifts every
 * later index, so the parser's indices are mapped back to stored ones by
 * `storedIndexer` (the Rust compiler's `NormalizedPos` is the precedent:
 * original = normalized + the total width removed before it).
 */
export declare function removePrefixMarks(text: string, prefixMarks: readonly number[]): string;
/**
 * Maps an index into `removePrefixMarks(text, prefixMarks)` back to the
 * stored text's index. The i-th removed mark (0-based, ascending) sat at
 * stored index `m` and left the parser's text at `m - i`; a parser index `p`
 * has had `i + 1` marks removed before it for every `m_i - i <= p`, so it
 * lands after them — a node's range begins after the prefix, never inside it.
 * Binary search: a document may have a very long prefix and many nodes.
 */
export declare function storedIndexer(prefixMarks: readonly number[]): (parserIndex: number) => number;
//# sourceMappingURL=marks.d.ts.map