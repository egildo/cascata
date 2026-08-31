/**
 * §9.1's leaf DSL grammar — SPEC.md §9.1 (settled), v0.4 FR-008 through
 * FR-012; specs/004-constraint-checker/contracts/demand-vocabulary.md.
 *
 * ```ebnf
 * TypeExpr := Union
 * Union    := Array ( "|" Array )*
 * Array    := Primary "[]"*
 * Primary  := Name | "(" Union ")"
 * Name     := Ident ( "/" Ident )?          (* qualified: core/resource *)
 * Ident    := [A-Za-z_] [A-Za-z0-9_-]*
 * ```
 *
 * `[]` binds tighter than `|` (TypeScript precedence) — encoded directly in
 * the recursive-descent structure below: `parseArray` (which consumes
 * trailing `[]`) is called by `parseUnion`, never the reverse, so
 * `string | string[]` parses as `Union[Array[string], Array[string[]]]`,
 * never as `Array[Union[string, string][]]`. `(string | int)[]` needs the
 * parens for exactly this reason — `parsePrimary` is what recurses back
 * into `parseUnion` inside `( )`.
 *
 * Canonical form is a flattened, deduped **set** of `(name, depth)` pairs
 * (FR-010) — order in the source text carries no meaning for equality.
 * This module still returns that set **sorted** (by depth, then by name
 * via `compareByCodePoint` — the same code-point ordering rule §4.2
 * mandates everywhere else this codebase orders strings), so two
 * expressions that are equal produce byte-identical `alternatives` arrays,
 * which is what makes `type-mismatch` checking (`src/validate/
 * constraints.ts`) a straightforward array walk rather than needing its
 * own set-equality helper.
 *
 * Name resolution against FR-011's closed built-in set is a *separate*
 * step (`resolveAlternative` below), not part of parsing: a qualified name
 * (`core/resource`) parses successfully under the grammar (the `Name`
 * production allows it) but cannot resolve to anything until v0.5's named
 * types exist. This mirrors `src/validate/vocabulary.ts`'s split between
 * "read/parse what is there" and "judge whether it is legal" — parsing
 * answers "is this well-formed", resolution answers "does this book
 * anywhere real".
 *
 * **Position tracking, this milestone's scope**: `unknown-type-name` and
 * `malformed-type-expression` diagnostics anchor to the **whole `type:`
 * value's own span**, not a computed sub-span for one name or token within
 * the DSL string. Recovering a byte-precise sub-span would mean re-doing
 * line/column math against a scalar's own source text — the same class of
 * work `src/adapters/yaml/parse.ts` already does once, at parse time, for
 * every node. Duplicating it here for one string's internal structure was
 * judged not worth it for this milestone: the whole expression's span
 * already opens the right file at the right key, and a `type:` value is
 * normally short enough that "which name inside it" is not a research
 * project once "which line" is known. Recorded here, and in
 * contracts/diagnostics.md, as a deliberate simplification rather than an
 * oversight.
 */

import { compareByCodePoint } from "../model/node.js";

/** FR-011's closed set of type names this milestone resolves. */
export const BUILTIN_TYPE_NAMES = ["string", "int", "float", "bool", "null", "mapping", "sequence", "url", "path", "glob"] as const;

export type BuiltinTypeName = (typeof BUILTIN_TYPE_NAMES)[number];

const BUILTIN_TYPE_NAME_SET: ReadonlySet<string> = new Set(BUILTIN_TYPE_NAMES);

/** One alternative in a type expression's canonical set form: a name at some array depth (`string` is depth 0, `string[]` is depth 1). */
export interface Alternative {
  /** As written — may be qualified (`core/resource`), which never resolves this milestone (no named types until v0.5). */
  readonly name: string;
  readonly depth: number;
}

/** A parsed `type` expression — FR-010's canonical set form, sorted for byte-identical comparison of equal expressions. */
export interface TypeExpression {
  readonly alternatives: readonly Alternative[];
}

export type ParseTypeExpressionResult = { readonly ok: true; readonly value: TypeExpression } | { readonly ok: false; readonly reason: string };

// --- Tokenizer --------------------------------------------------------

type Token = { readonly kind: "ident"; readonly value: string } | { readonly kind: "punct"; readonly value: "|" | "(" | ")" | "[" | "]" | "/" };

const IDENT_START = /[A-Za-z_]/;
const IDENT_CONT = /[A-Za-z0-9_-]/;

function tokenize(source: string): { readonly ok: true; readonly tokens: Token[] } | { readonly ok: false; readonly reason: string } {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const ch = source[index];
    if (ch === undefined) {
      break;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
      continue;
    }
    if (ch === "|" || ch === "(" || ch === ")" || ch === "[" || ch === "]" || ch === "/") {
      tokens.push({ kind: "punct", value: ch });
      index += 1;
      continue;
    }
    if (IDENT_START.test(ch)) {
      let end = index + 1;
      while (end < source.length) {
        const next = source[end];
        if (next === undefined || !IDENT_CONT.test(next)) {
          break;
        }
        end += 1;
      }
      tokens.push({ kind: "ident", value: source.slice(index, end) });
      index = end;
      continue;
    }
    return { ok: false, reason: `unexpected character '${ch}' at offset ${index}` };
  }
  return { ok: true, tokens };
}

// --- Recursive-descent parser ------------------------------------------

class ParseError extends Error {}

class Parser {
  private readonly tokens: readonly Token[];
  private position = 0;

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private advance(): Token {
    const token = this.tokens[this.position];
    if (token === undefined) {
      throw new ParseError("unexpected end of type expression");
    }
    this.position += 1;
    return token;
  }

  private expectPunct(value: "(" | ")" | "[" | "]" | "/" | "|"): void {
    const token = this.advance();
    if (token.kind !== "punct" || token.value !== value) {
      throw new ParseError(`expected '${value}'`);
    }
  }

  /** `Name := Ident ( "/" Ident )?` */
  private parseName(): string {
    const first = this.advance();
    if (first.kind !== "ident") {
      throw new ParseError("expected a type name");
    }
    if (this.peek()?.kind === "punct" && this.peek()?.value === "/") {
      this.expectPunct("/");
      const second = this.advance();
      if (second.kind !== "ident") {
        throw new ParseError("expected a qualified name segment after '/'");
      }
      return `${first.value}/${second.value}`;
    }
    return first.value;
  }

  /** `Primary := Name | "(" Union ")"` */
  private parsePrimary(): Alternative[] {
    const token = this.peek();
    if (token === undefined) {
      throw new ParseError("expected a type name or '('");
    }
    if (token.kind === "punct" && token.value === "(") {
      this.expectPunct("(");
      const inner = this.parseUnion();
      this.expectPunct(")");
      return inner;
    }
    const name = this.parseName();
    return [{ name, depth: 0 }];
  }

  /** `Array := Primary "[]"*` */
  private parseArray(): Alternative[] {
    let alternatives = this.parsePrimary();
    while (this.peek()?.kind === "punct" && this.peek()?.value === "[") {
      this.expectPunct("[");
      this.expectPunct("]");
      alternatives = alternatives.map((alt) => ({ name: alt.name, depth: alt.depth + 1 }));
    }
    return alternatives;
  }

  /** `Union := Array ( "|" Array )*` */
  parseUnion(): Alternative[] {
    let alternatives = this.parseArray();
    while (this.peek()?.kind === "punct" && this.peek()?.value === "|") {
      this.expectPunct("|");
      const more = this.parseArray();
      alternatives = [...alternatives, ...more];
    }
    return alternatives;
  }

  atEnd(): boolean {
    return this.position >= this.tokens.length;
  }
}

/** Sort and dedupe a flat alternative list into FR-010's canonical set form. */
function canonicalize(alternatives: readonly Alternative[]): readonly Alternative[] {
  const seen = new Map<string, Alternative>();
  for (const alt of alternatives) {
    seen.set(`${alt.depth} ${alt.name}`, alt);
  }
  return [...seen.values()].sort((a, b) => (a.depth !== b.depth ? a.depth - b.depth : compareByCodePoint(a.name, b.name)));
}

/**
 * Parse a `type` value's source text into canonical form (FR-008, FR-009,
 * FR-010). A `TypeExpr` with zero alternatives cannot occur — the grammar
 * has no production for an empty expression, so an empty or
 * whitespace-only `source` is a parse failure (`Primary` requires a name
 * or `(`), never a vacuously-true "no alternatives" result.
 */
export function parseTypeExpression(source: string): ParseTypeExpressionResult {
  const tokenized = tokenize(source);
  if (!tokenized.ok) {
    return { ok: false, reason: tokenized.reason };
  }
  const parser = new Parser(tokenized.tokens);
  try {
    const alternatives = parser.parseUnion();
    if (!parser.atEnd()) {
      return { ok: false, reason: "unexpected trailing content after a complete type expression" };
    }
    return { ok: true, value: { alternatives: canonicalize(alternatives) } };
  } catch (error) {
    if (error instanceof ParseError) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

/** Whether `alternative`'s name resolves against FR-011's built-in set — depth plays no part in resolution, only in matching a value later. */
export function resolvesToBuiltin(alternative: Alternative): alternative is Alternative & { readonly name: BuiltinTypeName } {
  return BUILTIN_TYPE_NAME_SET.has(alternative.name);
}

/** Every alternative in `expr` that fails to resolve against FR-011's built-in set (a typo, or a qualified/named-type reference — named types do not exist until v0.5). Empty when every alternative resolves. */
export function unresolvedAlternatives(expr: TypeExpression): readonly Alternative[] {
  return expr.alternatives.filter((alt) => !resolvesToBuiltin(alt));
}
