/**
 * How a Cascata name becomes a TypeScript identifier — `SPEC.md` Article
 * VIII ("Identifiers are kept, quoted, or refused — never silently
 * renamed"), v1.1 FR-015, FR-026;
 * specs/010-type-generator/contracts/emitted-type.md §3, research D-6.
 *
 * Two namespaces, two rules, and they are deliberately different:
 *
 * - **Property names** may be quoted, so nothing ever has to be renamed:
 *   a key is emitted bare where it is an ASCII identifier and as a
 *   double-quoted TypeScript string literal otherwise, verbatim.
 * - **Type alias names** cannot be quoted. TypeScript refuses `type
 *   default = …` and `type my-type = …` outright, and refuses the
 *   predefined type names (`type string = …`) by a rule of its own. Those
 *   need an escape, and an escape can collide, which is why FR-026 makes a
 *   collision a **refusal** rather than a rename.
 *
 * **The rule is ASCII, and fixed.** ECMAScript identifiers are Unicode:
 * `città` compiles bare, as a property *and* as an alias name (research
 * F-5, probed rather than assumed). Quoting it anyway is a choice — an
 * ASCII rule needs no Unicode table, cannot drift with the compiler's
 * identifier definition, and is the same rule in every emitter this tree
 * ever grows. §9.1's own `Ident` grammar is ASCII, so the only type names
 * that need the escape at all are hyphenated ones and reserved words.
 *
 * **No global type name is escaped, and none is referenced.** A
 * module-scope `type Object = …` shadows the global harmlessly (F-5), and
 * `emit.ts` writes no `Readonly<>`, `Record<>` or `Array<>` — which is why
 * the shadow can never bite. The spec's Assumption that globals would be
 * escaped was written before the probe and is withdrawn (research W-2).
 */

/** An ASCII ECMAScript identifier, which is all §9.1's own `Ident` grammar can produce anyway. */
const BARE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Every name TypeScript refuses as a **type alias name**, probed (F-5) and
 * fixed here rather than derived from the compiler: the predefined type
 * names, which it refuses by a dedicated rule ("Type alias name cannot be
 * 'string'"), and the ECMAScript reserved words, which are parse errors.
 * The strict-mode future reserved words are included because an emitted
 * module is always strict.
 *
 * Being generous costs only readability — an over-escaped name is still
 * correct — while a missing entry emits a file that does not compile.
 */
const RESERVED_ALIAS_NAMES: ReadonlySet<string> = new Set([
  // Predefined type names.
  "any",
  "bigint",
  "boolean",
  "never",
  "null",
  "number",
  "object",
  "string",
  "symbol",
  "undefined",
  "unknown",
  "void",
  // ECMAScript reserved words.
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "while",
  "with",
  // Strict-mode future reserved words — an emitted module is always strict.
  "await",
  "implements",
  "interface",
  "let",
  "package",
  "private",
  "protected",
  "public",
  "static",
  "yield",
]);

/**
 * The escape: `$` followed by the name with every character outside
 * `[A-Za-z0-9_]` replaced by `_`.
 *
 * `$` is what makes the escape safe rather than merely tidy: §9.1's `Ident`
 * is `[A-Za-z_][A-Za-z0-9_-]*`, so **no name a type expression can
 * reference begins with `$`**, and an escaped name therefore can never
 * collide with a bare one. Two *escaped* names still can (`a-b` and `a_b`
 * both reach `$a_b`), and that collision is FR-026's refusal — the one
 * thing this rule cannot rule out, made loud instead of silent.
 */
function escapeAlias(name: string): string {
  return `$${name.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

/** One type name as an alias identifier: bare where it is an ASCII identifier and not reserved, escaped otherwise. */
export function aliasName(name: string): string {
  return BARE_IDENTIFIER.test(name) && !RESERVED_ALIAS_NAMES.has(name) ? name : escapeAlias(name);
}

/**
 * §7's qualifier prefixed to a name — the spelling a chain uses where it
 * declares one name more than once (FR-025). Where two declaring layers
 * share a qualifier, `rank` distinguishes them, deterministically and by a
 * number the pedigree already assigns.
 *
 * The joined string goes through `aliasName` as a whole, so a qualifier
 * needing an escape (`my-lib`) escapes the combined identifier once rather
 * than leaving a `-` in the middle of it.
 */
export function qualifiedAlias(qualifier: string, name: string, rank?: number): string {
  return aliasName(rank === undefined ? `${qualifier}_${name}` : `${qualifier}_${rank}_${name}`);
}
