/**
 * Reading a schema's `keys:` vocabulary — SPEC.md §9 ("Schema vocabulary
 * per key: `demand`..., `provide`, `cascade: replace | append`, `seal:
 * open | closed`, `final`, `delegate: allow`"), §5.1, §5.2, §5.3; v0.3
 * FR-001, FR-002, FR-003, FR-011, FR-012, FR-015, FR-016; tasks.md T008,
 * T009, T029-T032.
 *
 * This is the first module in Cascata that reads schema **vocabulary**
 * rather than only the `$`-prefixed document keys v0.1/v0.2 read. It reads
 * exactly two things per key — `provide` and `cascade` — and nothing else:
 * `demand`, `seal`, `final`, and `delegate` are not read by this function at
 * all (FR-002). That is what "ignored" means here: there is no code path
 * that inspects them, so there is nothing to guess a meaning for.
 *
 * **Scope as of Phase 4 (User Story 2, T025-T034)**: `resolveStrategies`
 * now *acts* on `cascade` — tightening `replace` → `append` silently
 * (§5.2), refusing the reverse as `cascade-strategy-weakened` (FR-016),
 * and `accumulateAppend` performs the root-first accumulation itself
 * (FR-012), consumed by `src/merge/fold.ts`. **Still out of scope**
 * (Phase 6, User Story 4): refusing an unknown or non-string `cascade`
 * value (`unknown-cascade-strategy`/`unimplemented-cascade-strategy`,
 * T051-T052) and refusing `append` over a non-sequence
 * (`append-over-non-sequence`, T053) — `interpretCascade` below silently
 * ignores any value it does not recognize as `"append"`/`"replace"`
 * rather than refusing it, and `accumulateAppend` falls back to
 * replace-wholesale for a non-sequence contribution, precisely so neither
 * of those still-missing refusals is *simulated* ahead of the task that
 * actually implements them.
 */

import { createSequence, type Node } from "../model/node.js";
import { createDiagnostic, type Diagnostic } from "../diagnostics/diagnostic.js";
import type { Layer, MergeStrategy } from "./provenance.js";

/**
 * What one key's schema declaration says, restricted to the two fields
 * this milestone reads (FR-001). Either may be absent — a key can declare
 * only `provide`, only `cascade`, neither (in which case it would not
 * appear in `readKeysVocabulary`'s result at all), or both.
 */
export interface KeyVocabulary {
  /** The raw `provide` value node, if declared. Any `Node` shape — a schema may provide a scalar, a mapping, or a sequence. */
  readonly provide?: Node;
  /**
   * The raw `cascade` value node, if declared — unvalidated and
   * uninterpreted in this slice (see module doc). Phase 6 (User Story 4)
   * is where a non-string or unrecognized value is refused; this slice
   * only carries it through.
   */
  readonly cascade?: Node;
}

/**
 * Read the `keys:` section of a schema's tree into a map of key name →
 * declared vocabulary (`provide`/`cascade` only, FR-001).
 *
 * An absent `keys:`, an empty mapping, or a `keys:` value that is not a
 * mapping at all (a schema-authoring mistake, or simply a schema with
 * nothing to declare) all contribute nothing — an empty result, never a
 * diagnostic (FR-003, "a schema that provides nothing is not a broken
 * schema"). Likewise, a value under `keys:` that is not itself a mapping
 * (e.g. `keys: { styles: "not-a-mapping" }`) contributes nothing for that
 * one key — the same "not a mapping → nothing" reading applied one level
 * deeper, since there is no `provide`/`cascade` to find inside a scalar or
 * a sequence.
 *
 * `schemaTree` itself not being a mapping (a pathological schema whose
 * whole document is a scalar or a sequence) is handled the same way, for
 * the same reason: there is no `keys:` entry to find.
 *
 * **`keysNode.entries` is read one level deep only (v0.3 FR-027, T035)** —
 * each `keyName` here names a key of the merged configuration's own **top
 * level**; there is no syntax for `keys.<name>.<nested>` reaching into a
 * key's own value, and none is invented by reading any deeper than this
 * one loop does. `src/merge/fold.ts` enforces the consequence structurally
 * rather than by a second check here: `strategy` is threaded into
 * `mergeMappings` only for the outermost call, and every recursive call for
 * nested structure passes an empty strategy map, so a `keys:` entry can
 * never affect anything but the top-level key of the same name — see that
 * file's own module doc, rule 4.
 */
export function readKeysVocabulary(schemaTree: Node): ReadonlyMap<string, KeyVocabulary> {
  const result = new Map<string, KeyVocabulary>();

  if (schemaTree.type !== "mapping") {
    return result;
  }
  const keysNode = schemaTree.entries.get("keys");
  if (keysNode === undefined || keysNode.type !== "mapping") {
    return result;
  }

  for (const [keyName, declarationNode] of keysNode.entries) {
    if (declarationNode.type !== "mapping") {
      continue;
    }
    const provide = declarationNode.entries.get("provide");
    const cascade = declarationNode.entries.get("cascade");
    if (provide === undefined && cascade === undefined) {
      // Nothing this milestone reads was declared for this key (it may
      // still declare demand/seal/final/delegate, all ignored) — omit it
      // from the result rather than recording an empty entry.
      continue;
    }
    result.set(keyName, { ...(provide !== undefined ? { provide } : {}), ...(cascade !== undefined ? { cascade } : {}) });
  }

  return result;
}

// --- Strategy resolution — User Story 2 (T029-T032) ----------------------

/**
 * Every top-level key with no declared strategy is `replace` (FR-011) —
 * named here rather than left as an implicit fallback wherever
 * `strategies.get(key)` might return `undefined`, so the default is one
 * fact stated once.
 */
const DEFAULT_STRATEGY: MergeStrategy = "replace";

/** Look up `key`'s effective strategy, defaulting to `replace` (FR-011, T030). */
export function effectiveStrategy(key: string, strategies: ReadonlyMap<string, MergeStrategy>): MergeStrategy {
  return strategies.get(key) ?? DEFAULT_STRATEGY;
}

/**
 * Interpret a raw `cascade` value node as a `MergeStrategy` this phase
 * acts on, or `undefined` for anything else — a non-string scalar, a
 * string that is not `"append"` or `"replace"` (including the reserved
 * `"merge-by-key"`), a mapping, or a sequence. `undefined` here is not a
 * refusal: T051/T052 (Phase 6, User Story 4) are what turn an
 * unrecognized value into `unknown-cascade-strategy` or
 * `unimplemented-cascade-strategy`. Until then, this phase treats a
 * `cascade` declaration it cannot interpret exactly as it treats no
 * declaration at all, per this file's own module doc.
 */
export function interpretCascade(node: Node): MergeStrategy | undefined {
  if (node.type === "scalar" && node.kind === "string" && (node.value === "append" || node.value === "replace")) {
    return node.value;
  }
  return undefined;
}

/** `resolveStrategies`'s result: the effective strategy per top-level key, and any `cascade-strategy-weakened` refusals found along the way. */
export interface StrategyResolution {
  readonly strategies: ReadonlyMap<string, MergeStrategy>;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Resolve one effective `MergeStrategy` per top-level key across the whole
 * layer stack (T031, T032; FR-016; `SPEC.md` §5.2's cascade-strategy row).
 *
 * Reads only `layers` whose `role` is `"schema"`, root to leaf, in the
 * order `deriveLayers` already produces — a config's own `cascade`
 * declaration has no effect at all (FR-015): this function never looks at
 * a `role: "config"` layer's vocabulary in the first place, which is a
 * stronger guarantee than "ignored after being read".
 *
 * For each key, tracks one running effective strategy starting at
 * `"replace"` (FR-011) and applies every schema's declaration in order:
 *
 * - Restating the current strategy is legal and vacuous (no map entry
 *   changes).
 * - Tightening `"replace"` → `"append"` is legal and silent — once set,
 *   the key stays `"append"` for **every** layer's contribution to it,
 *   including layers ranked before the one that tightened it ("once a
 *   key accumulates, it keeps accumulating", `SPEC.md` §5.2) — which is
 *   exactly what applying one resolved strategy uniformly across the
 *   whole stack, rather than only from the declaring layer onward,
 *   achieves.
 * - Weakening `"append"` → `"replace"` is refused: `cascade-strategy-
 *   weakened`, primary span the descendant's own declared value (the
 *   `cascade` value node itself — contracts/diagnostics.md: "The
 *   descendant's declaration"). Every violation found is recorded, not
 *   only the first (T055's "report every failure independently" applies
 *   here too, even though T055 itself is Phase 6 work).
 *
 * A `cascade` value `interpretCascade` cannot read (Phase 6's job to
 * refuse) is treated as no declaration at all for that layer — it neither
 * advances nor is checked against the running strategy.
 */
export function resolveStrategies(layers: readonly Layer[]): StrategyResolution {
  const strategies = new Map<string, MergeStrategy>();
  const diagnostics: Diagnostic[] = [];

  for (const layer of layers) {
    if (layer.role !== "schema") {
      continue; // FR-015: a config's cascade declaration is never read.
    }
    const vocabulary = readKeysVocabulary(layer.tree);
    for (const [key, declaration] of vocabulary) {
      if (declaration.cascade === undefined) {
        continue;
      }
      const declared = interpretCascade(declaration.cascade);
      if (declared === undefined) {
        continue; // Unrecognized value — Phase 6's refusal, not this phase's.
      }
      const current = effectiveStrategy(key, strategies);
      if (declared === current) {
        continue; // Restating is legal and vacuous.
      }
      if (current === "replace" && declared === "append") {
        strategies.set(key, "append"); // Tighten — legal, silent.
        continue;
      }
      // The only remaining case: current === "append", declared === "replace" — weakening.
      diagnostics.push(
        createDiagnostic({
          code: "cascade-strategy-weakened",
          message: `key '${key}' cannot weaken 'cascade: append' to 'replace' — a descendant declaring 'replace' would discard every ancestor's accumulated contribution (SPEC.md §5.2)`,
          primary: declaration.cascade.span,
        }),
      );
    }
  }

  return { strategies, diagnostics };
}

/**
 * Advance `running`'s per-key strategy state by exactly one schema layer's
 * own declarations, root-to-leaf — the mechanism `fold()` uses to apply a
 * strategy **from its declaring layer downward** (v0.3 FR-026, T034), by
 * calling this once per layer, in the same order it merges that layer's
 * contribution, rather than resolving one flat map before the fold begins
 * and applying it uniformly to every layer.
 *
 * Deliberately does **not** check for a weakening — that is
 * `resolveStrategies`' whole-stack validation, which MUST already have
 * run (and found no diagnostics) before `fold()` relies on this function.
 * Given a stack `resolveStrategies` has accepted, the only transition that
 * can ever occur is tightening (`"replace"` → `"append"`); an explicit
 * `"replace"` declaration is therefore never itself acted on here — in a
 * validated stack it can only be restating the current strategy or
 * following a legal one-way transition already applied by an earlier
 * layer, both of which "leave the map unchanged" already covers. Calling
 * this on a stack `resolveStrategies` has refused is unspecified — nothing
 * in `fold()` does, and `foldConfiguration` never calls `fold()` when
 * `resolveStrategies` reported a diagnostic.
 *
 * Returns `running` itself, unchanged (no allocation), for the common
 * case — every `role: "config"` layer (FR-015: never read), and a schema
 * with no `cascade` declaration that tightens anything.
 */
export function advanceStrategies(running: ReadonlyMap<string, MergeStrategy>, layer: Layer): ReadonlyMap<string, MergeStrategy> {
  if (layer.role !== "schema") {
    return running;
  }
  const vocabulary = readKeysVocabulary(layer.tree);
  let next: Map<string, MergeStrategy> | undefined;
  for (const [key, declaration] of vocabulary) {
    if (declaration.cascade === undefined) {
      continue;
    }
    if (interpretCascade(declaration.cascade) !== "append") {
      continue; // Not a tightening — either "replace", or unrecognized (Phase 6's refusal).
    }
    if (effectiveStrategy(key, running) === "append") {
      continue; // Already there — restating is vacuous.
    }
    if (next === undefined) {
      next = new Map(running);
    }
    next.set(key, "append");
  }
  return next ?? running;
}

// --- Append accumulation — User Story 2 (T029) ----------------------------

/**
 * Accumulate one top-level key's contribution under `cascade: append`
 * (FR-012), root-first. Called once per layer during the fold
 * (`src/merge/fold.ts`), in root-to-leaf order — `current` is everything
 * folded from ancestor layers so far, `incoming` is the next (nearer)
 * layer's raw contribution at this key. Because `fold()` calls this
 * exactly once per layer, in that order, `current` already holds every
 * earlier layer's items in place before `incoming`'s are appended after
 * them: root-first accumulation falls out of the existing per-layer fold
 * loop, not a separate pass.
 *
 * - `incoming === undefined` (rule 6: a layer silent on this key) leaves
 *   `current` unchanged.
 * - `current === undefined` (the first contributor) is `incoming`
 *   unmodified — nothing to append to yet.
 * - An empty sequence needs no special case at all: concatenating `[]`
 *   changes nothing, which is exactly FR-012's "an empty contribution
 *   removes nothing".
 * - The result's own span is the nearest contributor's (`incoming`'s) —
 *   research D4, "for an appended sequence, the nearest contributor's".
 *
 * If either side is present but is not a `Sequence`, this phase has no
 * way to refuse it (`append-over-non-sequence` is T053, Phase 6, not yet
 * implemented) — falling through to replace-wholesale (`incoming` wins)
 * is the same behaviour an undeclared key would get, never a silent data
 * loss and never a crash, and is exactly the behaviour T053 will replace
 * with a refusal.
 */
export function accumulateAppend(current: Node | undefined, incoming: Node | undefined): Node | undefined {
  if (incoming === undefined) {
    return current;
  }
  if (current === undefined) {
    return incoming;
  }
  if (current.type === "sequence" && incoming.type === "sequence") {
    return createSequence([...current.items, ...incoming.items], incoming.span);
  }
  return incoming;
}
