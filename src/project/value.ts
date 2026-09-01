/**
 * The value view — `SPEC.md` **Article VII (§17)**, §3's last pipeline
 * stage, v1.0 FR-008 through FR-021;
 * specs/009-output-surface-and-freeze/contracts/value-view.md.
 *
 * Seven milestones produced a positioned, frozen `Node` tree and no way to
 * read it as ordinary data. §1 promises the tool developer "a validated
 * configuration object"; until v1.0 it received a tagged union with spans,
 * `Map`s for mappings and `bigint`s for integers, and had to walk the model
 * by hand. This module is that promise kept.
 *
 * Four properties, each of which is a rule from the article rather than an
 * implementation preference:
 *
 * 1. **Null-prototype objects.** `Object.create(null)`, not `{}`, because a
 *    configuration key is author-controlled: on an ordinary object,
 *    `o["__proto__"] = v` *sets the prototype* and creates no own property
 *    at all, so a config author writing `__proto__:` in YAML would be
 *    reaching into the consuming application's object graph. On a
 *    null-prototype object the same assignment is an ordinary own data
 *    property. `constructor`, `toString` and `hasOwnProperty` come free
 *    from the same choice — nothing is inherited, so nothing is shadowed.
 *
 * 2. **Canonical insertion order**, which is as far as JavaScript goes.
 *    §4.2 stores mappings sorted by code point and this walk inserts in
 *    that order, but ECMA-262's `OrdinaryOwnPropertyKeys` returns every
 *    **array-index** key — a canonical numeric string in `[0, 2^32−2]` —
 *    first, ascending, ahead of everything else. No object can do
 *    otherwise. Article VII says keys are *inserted* canonically, which is
 *    met exactly; the milestone's own FR-009 says they *enumerate* that
 *    way, which is not satisfiable and is reported as a gap rather than
 *    silently approximated. `tests/unit/value-view.test.ts` asserts the
 *    limit in both directions.
 *
 * 3. **Scalars project by lexical kind here** — an `int` is a `bigint` at
 *    every magnitude, which is §17's "no numeric demand" row and the only
 *    row this file decides on its own. The other three rows need the
 *    *accumulated* demand and arrive with `src/validate/numeric.ts` in the
 *    next user story; the seam is `projectScalar` below and nothing else.
 *
 * 4. **Iterative, not recursive.** FR-014: projection must not throw on any
 *    legal document. A recursive walk overflows the stack a few thousand
 *    levels down, and `validate()`'s own contract (like this one) takes a
 *    configuration from anywhere, not only from a parser bounded by §11's
 *    depth cap — `tests/unit/recursion-termination.test.ts` builds
 *    400-level trees by hand today. The explicit stack below is what makes
 *    the 5,000-level case in `tests/unit/value-view.test.ts` return instead
 *    of throwing. `src/extend.ts` is used for the same posture one level
 *    down: no call-site spread, ever.
 *
 * World-blind and pure (Principle IV, Article VI): it reads
 * `configuration` and nothing else, touches no node, and produces a fresh
 * value every call.
 */

import type { MergedConfiguration } from "../merge/provenance.js";
import type { Mapping, Node, Sequence } from "../model/node.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { pointerFromPath } from "../model/pointer.js";

/**
 * A configuration as ordinary JS data (Article VII).
 *
 * The mapping case is an index signature rather than a nominal type: a
 * null-prototype object has no observable type of its own, and giving it
 * one would be a promise about `instanceof` that nothing can keep.
 */
export type ConfigValue = string | bigint | number | boolean | null | readonly ConfigValue[] | { readonly [key: string]: ConfigValue };

/** What `project()` produces: the value, and whatever `info` lints the projection itself earned. */
export interface ProjectionResult<T = unknown> {
  /**
   * The value view. **`T` is the caller's claim and the library never
   * checks it** (Article VII): validation enforces the *schema* against the
   * value and cannot enforce the caller's belief about what the schema
   * says. A `T` that disagrees with its schema is a bug in the calling
   * code, and the v1.x generator (§14) exists to remove the guesswork by
   * deriving `T` from the schema chain.
   */
  readonly value: T;
  /** Today this is `precision-narrowed` and nothing else. Never `error`-level: a projection has no failure mode. */
  readonly diagnostics: readonly Diagnostic[];
}

/** One step of the explicit stack: either "project this node" or "the children are done, assemble the container". */
type Task = { readonly kind: "visit"; readonly node: Node; readonly pointer: string } | { readonly kind: "mapping"; readonly keys: readonly string[] } | { readonly kind: "sequence"; readonly length: number };

/**
 * Project one scalar by its lexical `kind` (§4.2): an `int` is a `bigint`
 * at every magnitude, exactly, which is §17's "no numeric demand" row.
 *
 * **This is the seam the numeric rule plugs into**, and it is deliberately
 * the only place a scalar becomes a JS value. §17's other three rows —
 * `int` → `bigint`, `float`/`int | float` → `number`, plus the
 * `precision-narrowed` lint — are decided from the *accumulated* demand
 * rather than from the node, and arrive here in the next user story.
 */
function projectScalar(node: Node & { readonly type: "scalar" }): ConfigValue {
  return node.value;
}

/**
 * Project `configuration.tree` into ordinary JS data.
 *
 * Total (FR-014), pure (FR-013), and a projection rather than a
 * replacement (FR-012): the configuration handed in is untouched and its
 * tree, spans, provenance and pedigree stay exactly where they were, so
 * `why()` keeps answering by RFC 6901 pointer.
 */
export function project<T = unknown>(configuration: MergedConfiguration): ProjectionResult<T> {
  const diagnostics: Diagnostic[] = [];
  const results: ConfigValue[] = [];
  const tasks: Task[] = [{ kind: "visit", node: configuration.tree, pointer: "" }];

  while (tasks.length > 0) {
    const task = tasks.pop();
    if (task === undefined) {
      break; // unreachable: the loop condition already established one is there.
    }
    if (task.kind === "mapping") {
      // `Object.create(null)`'s declared return type is `any`; it is
      // narrowed here, at the one site in this codebase that produces one,
      // by the annotation rather than by a cast.
      const target: Record<string, ConfigValue> = Object.create(null);
      const children = results.splice(results.length - task.keys.length, task.keys.length);
      task.keys.forEach((key, index) => {
        const child = children[index];
        if (child !== undefined) {
          // Plain assignment, deliberately: on a null-prototype object
          // `__proto__` is an ordinary own data property, which is the
          // whole reason for `Object.create(null)` (FR-010).
          target[key] = child;
        }
      });
      results.push(Object.freeze(target));
      continue;
    }
    if (task.kind === "sequence") {
      const items = results.splice(results.length - task.length, task.length);
      results.push(Object.freeze(items));
      continue;
    }
    const node = task.node;
    if (node.type === "scalar") {
      results.push(projectScalar(node));
      continue;
    }
    if (node.type === "mapping") {
      const mapping: Mapping = node;
      const keys = [...mapping.entries.keys()];
      // The assemble task goes on first so it is popped last — after every
      // child, and every child's own subtree, has finished. Children are
      // pushed in reverse so they pop in §4.2's canonical order, which is
      // what makes the insertion order canonical.
      tasks.push({ kind: "mapping", keys });
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        if (key === undefined) {
          continue;
        }
        const child = mapping.entries.get(key);
        if (child !== undefined) {
          tasks.push({ kind: "visit", node: child, pointer: `${task.pointer}${pointerFromPath([key])}` });
        }
      }
      continue;
    }
    const sequence: Sequence = node;
    tasks.push({ kind: "sequence", length: sequence.items.length });
    for (let index = sequence.items.length - 1; index >= 0; index -= 1) {
      const item = sequence.items[index];
      if (item !== undefined) {
        tasks.push({ kind: "visit", node: item, pointer: `${task.pointer}${pointerFromPath([index])}` });
      }
    }
  }

  const value = results[0];
  if (results.length !== 1 || value === undefined) {
    // A programmer error, not a fact about the world (Article VI): the
    // walk is total over every `Node` shape, so reaching here means this
    // function is wrong, not that the document is.
    throw new Error(`Internal error: projecting a configuration left ${results.length} values on the stack instead of exactly one`);
  }
  // The one unchecked cast in the library, and the *specified* behaviour:
  // "`load<T>()`'s `T` is the caller's claim, and the library never checks
  // it" (Article VII). It is not a cast on the node model — by this point
  // there is no node left, only plain JS data.
  return { value: value as T, diagnostics };
}
