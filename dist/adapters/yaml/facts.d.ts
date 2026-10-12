/**
 * What one parse of a YAML document leaves for its writer -- v1.15 FR-004, specs/025-open-insert-delete.
 *
 * `Facts` is the reader's tree, the `yaml` AST it was built from and the functions that measured it. The
 * things a writer needs that cost a walk over the whole document -- every node's parent, `yaml`'s CST tokens,
 * where each block indicator (`-`, `:`, `?`) and property (`&anchor`, `!tag`) sits, the document's line
 * ending and indentation step -- are built the first time something asks and kept: at most once per
 * document, however many pointers are asked about. `parse-count.ts` counts the walks for the tests.
 */
import type { Document, Node as YamlNode, Pair } from "yaml";
import type { Node } from "../../model/node.js";
import type { Found } from "../edit.js";
import type { YamlSpans } from "./parse.js";
import type { AnchorTable } from "./anchors.js";
export interface RawToken {
    readonly type: string;
    readonly offset: number;
    readonly end: number;
}
/** The block indicators and properties of a document, as byte offsets, each list sorted. */
export interface Indicators {
    readonly dashes: readonly number[];
    readonly colons: readonly number[];
    readonly questionMarks: readonly number[];
    /** `&anchor` and `!tag` tokens: byte start and end. */
    readonly properties: readonly {
        readonly start: number;
        readonly end: number;
    }[];
}
export interface Facts {
    readonly bytes: Uint8Array;
    readonly doc: Document;
    readonly spans: YamlSpans;
    readonly anchors: AnchorTable;
    readonly tree: Node;
    parents: Map<YamlNode, YamlNode> | undefined;
    tokens: RawToken[] | undefined;
    indicators: Indicators | undefined;
    eol: string | undefined;
    style: DocumentStyle | undefined;
}
export declare function newFacts(bytes: Uint8Array, doc: Document, spans: YamlSpans, anchors: AnchorTable, tree: Node): Facts;
/** `yaml` types a pair's key and value `unknown`; this narrows them with the library's own guard instead of a cast. */
export declare function asNode(value: unknown): YamlNode | null;
/** The stored byte offset of the stored UTF-16 index `index` that `yaml`'s ranges (rewritten by the reader) hold. */
export declare function byteAt(facts: Facts, index: number): number;
/** A node's range as bytes: where it starts, where its value ends and where the node (a trailing comment included) ends. */
export declare function rangeBytes(facts: Facts, node: YamlNode): {
    readonly start: number;
    readonly valueEnd: number;
    readonly end: number;
} | undefined;
/** Each node's parent in the AST (a pair is skipped: a key's and a value's parent is the mapping). Built once per document. */
export declare function parentsIn(facts: Facts): Map<YamlNode, YamlNode>;
/** The CST tokens, built once per document. */
export declare function tokensIn(facts: Facts): RawToken[];
/** Where each block indicator and property is, in bytes, from the same tokens (built once per document). */
export declare function indicatorsIn(facts: Facts): Indicators;
/** The index of the last entry of `sorted` that is below `bound`, or -1. */
export declare function lastBelow(sorted: readonly number[], bound: number): number;
/** The index of the first entry of `sorted` that is at or above `bound`, or `sorted.length`. */
export declare function firstAtOrAbove(sorted: readonly number[], bound: number): number;
export declare function lineBreakOf(facts: Facts): string;
export declare function columnOf(bytes: Uint8Array, at: number): number;
/** The indentation habits of a document, from its first use of each (v1.15 FR-009). */
export interface DocumentStyle {
    /** Spaces per level: the first increase of indentation the document uses, else two. */
    readonly step: number;
    /** Whether a block sequence under a mapping's key is indented (`key:\n  - a`) rather than flush (`key:\n- a`); indented when the document has none to copy. */
    readonly dashIndented: boolean;
}
/**
 * The document's indentation step and dash habit: the first block mapping nested in a block mapping, or the first block
 * sequence under a key, in document order. Found by one walk, which stops as soon as it has both.
 */
export declare function styleOf(facts: Facts): DocumentStyle;
/**
 * Where a value found by the writer sits in the AST: the collection that holds it and the pair or index it is, whether
 * a flow collection is on the path (a block one cannot sit inside it). `node` is the value's AST node -- the anchored
 * one, where the walk went through an alias the policy lets it pass -- or `null` for a pair that has no value node.
 */
export interface Site {
    readonly node: YamlNode | null;
    /** The map or sequence holding the value; `undefined` for the document's root. */
    readonly parent: YamlNode | undefined;
    readonly pair: Pair | undefined;
    readonly index: number;
    readonly inFlow: boolean;
    /** The site of the collection that holds this value (the one before it on the path from the root); `undefined` at the root. */
    readonly up?: Site;
}
/** Remember where a `Found` value sits, for the operations that edit around it (`insert.ts`). */
export declare function recordSite(found: Found, site: Site): void;
export declare function siteOf(found: Found): Site;
export declare function isBlockCollection(node: YamlNode | null): boolean;
//# sourceMappingURL=facts.d.ts.map