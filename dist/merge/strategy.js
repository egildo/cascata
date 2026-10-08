/**
 * Reading a schema's `keys:` vocabulary — SPEC.md §9 ("Schema vocabulary
 * per key: `demand`..., `provide`, `cascade: replace | append`, `seal:
 * open | closed`, `final`, `delegate: allow`"), §5.1, §5.2, §5.3; v0.3
 * FR-001, FR-002, FR-003, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016;
 * tasks.md T008, T009, T029-T032, T054-T056.
 *
 * This is the first module in Cascata that reads schema **vocabulary**
 * rather than only the `$`-prefixed document keys v0.1/v0.2 read. It reads
 * exactly two things per key — `provide` and `cascade` — and nothing else:
 * `demand`, `seal`, `final`, and `delegate` are not read by this function at
 * all (FR-002). That is what "ignored" means here: there is no code path
 * that inspects them, so there is nothing to guess a meaning for.
 *
 * **Scope as of Phase 4 (User Story 2, T025-T034)**: `resolveStrategies`
 * *acts* on `cascade` — tightening `replace` → `append` silently (§5.2),
 * refusing the reverse as `cascade-strategy-weakened` (FR-016) — and
 * `accumulateAppend` performs the root-first accumulation itself (FR-012),
 * consumed by `src/merge/fold.ts`.
 *
 * **Scope as of Phase 6 (User Story 4, T054-T056)**: `resolveStrategies`
 * also refuses a `cascade` value it cannot interpret — `unknown-cascade
 * -strategy` for anything that is not `"replace"`/`"append"`, and the
 * distinct `unimplemented-cascade-strategy` for the reserved
 * `"merge-by-key"` (FR-014, `classifyUnrecognizedCascade` below). Refusing
 * `append` over a non-sequence value (FR-013, `append-over-non-sequence`)
 * is `checkAppendable` below — but *finding* every such refusal, across
 * every top-level key a single fold touches, without stopping at the
 * first, is `src/merge/fold.ts`'s job (T058), since it is that file's
 * `foldWithProvenance` loop that owns the only two moments a value's
 * shape needs checking: when a layer freshly supplies it, and when a
 * key's strategy first transitions to `append` over whatever the fold had
 * already produced (see that file's own module doc). `checkAppendable`
 * here is the shared predicate both moments call, so the position is
 * always the offending `Node`'s own span — the document that actually
 * supplied it, not necessarily the one that declared `cascade: append`
 * (contracts/diagnostics.md).
 *
 * **Ignoring a config's own `cascade` (FR-015, T057) needed no new code**
 * here: `resolveStrategies` and `advanceStrategies` already skip every
 * `role !== "schema"` layer before reading its vocabulary at all (the
 * guard predates Phase 6, from User Story 2's own FR-015 reading) — a
 * config's `keys:` section, cascade included, was already inert as
 * *policy*. What Phase 6 confirms with a conformance case
 * (`tests/corpus/cases/merge-policy/config-policy/`) is the other half of
 * FR-015: that a config writing a top-level key literally named `keys` is
 * writing ordinary *data*, which `src/merge/fold.ts` was already treating
 * as such (nothing in `contributionOf` for a `role: "config"` layer ever
 * special-cases a key named `keys`) — see the milestone report.
 */
import { createSequence } from "../model/node.js";
import { createDiagnostic } from "../diagnostics/diagnostic.js";
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
export function readKeysVocabulary(schemaTree) {
    const result = new Map();
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
const DEFAULT_STRATEGY = "replace";
/** Look up `key`'s effective strategy, defaulting to `replace` (FR-011, T030). */
export function effectiveStrategy(key, strategies) {
    return strategies.get(key) ?? DEFAULT_STRATEGY;
}
/**
 * Interpret a raw `cascade` value node as a `MergeStrategy`, or `undefined`
 * for anything else — a non-string scalar, a string that is not
 * `"append"` or `"replace"` (including the reserved `"merge-by-key"`), a
 * mapping, or a sequence. `undefined` is never itself a refusal — it only
 * tells the caller "not a recognized strategy, decide what that means":
 * `resolveStrategies` below is the caller that turns it into
 * `unknown-cascade-strategy` or `unimplemented-cascade-strategy`
 * (`classifyUnrecognizedCascade`, FR-014), via `readKeysVocabulary`.
 * `advanceStrategies` is the *other* caller, and deliberately does not —
 * per its own doc comment, it only ever runs on a stack `resolveStrategies`
 * has already accepted, where an unrecognized value can no longer occur.
 */
export function interpretCascade(node) {
    if (node.type === "scalar" && node.kind === "string" && (node.value === "append" || node.value === "replace")) {
        return node.value;
    }
    return undefined;
}
/** SPEC.md §5.3's reserved-but-unbuilt strategy name — refused distinctly (FR-014, contracts/diagnostics.md). */
const RESERVED_STRATEGY_NAME = "merge-by-key";
/**
 * Render a `cascade` value `interpretCascade` could not read, for a
 * diagnostic's message text. Scalars show their own literal value (a
 * `bigint` `int` needs `String`, not `JSON.stringify`, which throws on
 * one); a mapping or sequence just names its shape, since a diagnostic
 * message is not required to dump a whole structure.
 */
function describeCascadeValue(node) {
    if (node.type === "scalar") {
        return node.kind === "string" ? JSON.stringify(node.value) : String(node.value);
    }
    return `a ${node.type}`;
}
/**
 * Classify a `cascade` value `interpretCascade` could not read into the
 * two distinct refusals FR-014 and contracts/diagnostics.md require:
 * `unimplemented-cascade-strategy` for exactly the reserved
 * `"merge-by-key"` string (SPEC.md §5.3 names it, so the author is early,
 * not wrong — the same reasoning that made a sequence-valued `$adopts`
 * refuse as `multiple-adoption` rather than as malformed, v0.2), and
 * `unknown-cascade-strategy` for every other unrecognized value — a
 * different string, a non-string scalar, a mapping, or a sequence. Both
 * share the same primary span: the declared value's own
 * (contracts/diagnostics.md: "The declared value").
 *
 * Callers must only reach this for a value `interpretCascade` returned
 * `undefined` for — it does not re-check `"replace"`/`"append"` itself.
 */
function classifyUnrecognizedCascade(key, node) {
    if (node.type === "scalar" && node.kind === "string" && node.value === RESERVED_STRATEGY_NAME) {
        return createDiagnostic({ level: "error",
            code: "unimplemented-cascade-strategy",
            message: `key '${key}' declares 'cascade: merge-by-key' — reserved by SPEC.md §5.3 but not built in this version; supported strategies are 'replace' and 'append'`,
            primary: node.span,
        });
    }
    return createDiagnostic({ level: "error",
        code: "unknown-cascade-strategy",
        message: `key '${key}' declares 'cascade: ${describeCascadeValue(node)}', which is not a strategy this version implements; supported strategies are 'replace' and 'append'`,
        primary: node.span,
    });
}
/**
 * Read `node` as an `append` contribution (v0.3 FR-013, amended by v1.8
 * FR-001, FR-002 and FR-005).
 *
 * **A scalar is a list of one** (v1.8). `append` promises a list, and the
 * commonest contribution to one is a single item — one stylesheet, one
 * component — so a scalar is taken as the sequence of that one scalar
 * rather than refused. The synthetic sequence carries the **scalar's own
 * span**, and its single item is the scalar `Node` itself with its origin
 * untouched: that is what makes `why()` on the wrapped item name the
 * author's own line without provenance needing to know a wrap happened at
 * all (v1.8 FR-007). The author is told with `append-scalar-wrapped`,
 * `info` — never silently, the posture `precision-narrowed` set in §17.
 *
 * A **mapping** has no one-item reading and is still refused.
 *
 * The primary span of either diagnostic is `node`'s own — whichever real
 * document actually supplied it — never a span synthesized from the key's
 * declaration, because the layer that declared `cascade: append` and the
 * layer that supplied the value can be different documents
 * (contracts/diagnostics.md: "the offending value, in the layer that
 * supplied it"; see `src/merge/fold.ts`'s module doc for the two moments
 * this is called from). v1.8 FR-004 keeps that rule for the notice: a
 * scalar that pre-existed the transition to `append` is noticed at the
 * ancestor that wrote it, not at the descendant that declared the
 * strategy.
 *
 * The demand is not consulted, and cannot be: `src/merge/` may not import
 * `src/validate/` (Principle IV, `tests/unit/layering.test.ts`). Whole-chain
 * validation runs over the merged tree afterwards, so a scalar whose type
 * the item demand refuses is refused **by the demand, at the same span**
 * (v1.8 FR-006) — the right refusal, from the right stage, with no special
 * path here.
 */
export function checkAppendable(key, node) {
    if (node.type === "sequence") {
        return { node };
    }
    if (node.type === "scalar") {
        return {
            node: createSequence([node], node.span),
            diagnostic: createDiagnostic({ level: "info",
                code: "append-scalar-wrapped",
                message: `key '${key}' is under 'cascade: append'; the single value '${describeScalarValue(node)}' was taken as a list of one — write [${describeScalarValue(node)}] to say so explicitly`,
                primary: node.span,
            }),
        };
    }
    return {
        node,
        diagnostic: createDiagnostic({ level: "error",
            code: "append-over-non-sequence",
            message: `key '${key}' is under 'cascade: append' but a ${node.type} has no one-item reading and cannot be accumulated (SPEC.md §5.3; a single scalar is taken as a list of one, a mapping is not)`,
            primary: node.span,
        }),
    };
}
/** A scalar's value as the author wrote it, for `append-scalar-wrapped`'s message. A string shows bare — the message already quotes it, and `JSON.stringify` would double the quoting on the very value the author is being told to bracket. A `bigint` needs `String`, which `JSON.stringify` cannot do at all (it throws). */
function describeScalarValue(node) {
    return node.kind === "string" ? node.value : String(node.value);
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
 *   only the first — the loop below never returns early, so every key's
 *   declarations are checked regardless of what an earlier key found.
 * - A `cascade` value `interpretCascade` cannot read (T054, T055; FR-014)
 *   is refused too, via `classifyUnrecognizedCascade` — the reserved
 *   `"merge-by-key"` distinctly, as `unimplemented-cascade-strategy`
 *   rather than `unknown-cascade-strategy` — and, like weakening,
 *   collected without aborting the loop: this same pass already had to
 *   visit every schema layer's every declared key, so refusing here too
 *   costs nothing extra and is what makes `foldConfiguration`'s single
 *   `diagnostics.length > 0` check downstream see every vocabulary-level
 *   refusal a stack has, not just whichever key happened to be checked
 *   first. It neither advances the running strategy for that key nor is
 *   checked against it — exactly as if nothing had been declared, since
 *   what "declared" would even mean here is precisely what is unclear.
 */
export function resolveStrategies(layers) {
    const strategies = new Map();
    const diagnostics = [];
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
                diagnostics.push(classifyUnrecognizedCascade(key, declaration.cascade));
                continue;
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
            diagnostics.push(createDiagnostic({ level: "error",
                code: "cascade-strategy-weakened",
                message: `key '${key}' cannot weaken 'cascade: append' to 'replace' — a descendant declaring 'replace' would discard every ancestor's accumulated contribution (SPEC.md §5.2)`,
                primary: declaration.cascade.span,
            }));
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
 * `resolveStrategies`' whole-stack validation, run separately (and
 * concatenated with this file's data-dependent findings by
 * `src/merge/fold.ts`'s `foldConfiguration`, v0.3 FR-028, T061). This
 * function only ever *acts* on a declaration that reads as `"append"`
 * (`interpretCascade(declaration.cascade) === "append"`); every other
 * declaration — an explicit `"replace"` (whether it is merely restating the
 * default or is attempting an illegal weakening `resolveStrategies` would
 * refuse), or a value `interpretCascade` cannot read at all (unrecognized,
 * non-string, `merge-by-key`) — falls through the same `continue` and
 * leaves the running map untouched for that key.
 *
 * **Total over every layer stack, not only ones `resolveStrategies` has
 * accepted** — `foldConfiguration` now relies on this (v0.3 FR-028, T061):
 * running the fold to look for `append-over-non-sequence` failures must not
 * be skipped merely because some *other* key's `cascade` is illegal or
 * unreadable, and this function is exactly why that is safe. On a stack
 * `resolveStrategies` would refuse, the refused declaration itself is
 * always one this function already treats as a no-op (per the paragraph
 * above) — so the running strategy for the key it names simply stays
 * whatever it already was, "exactly as if nothing had been declared," the
 * same reading `resolveStrategies`' own doc comment gives that key. It
 * never crashes, never invents a strategy for a value it cannot interpret,
 * and never lets a bad declaration for one key perturb any other key's
 * strategy. What it does **not** do — and this remains true regardless of
 * validity — is retroactively correct a key that legitimately reached
 * `"append"` before an (illegal) weakening was declared: that key stays
 * `"append"`, matching the verdict `resolveStrategies` itself reaches (it
 * never removes a key from its own map on a weakening either, only reports
 * a diagnostic).
 *
 * Returns `running` itself, unchanged (no allocation), for the common
 * case — every `role: "config"` layer (FR-015: never read), and a schema
 * with no `cascade` declaration that tightens anything.
 */
export function advanceStrategies(running, layer) {
    if (layer.role !== "schema") {
        return running;
    }
    const vocabulary = readKeysVocabulary(layer.tree);
    let next;
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
 * If either side is present but is not a `Sequence`, this function itself
 * still does not refuse it (`append-over-non-sequence`, T056, lives in
 * `checkAppendable` above) — it falls through to replace-wholesale
 * (`incoming` wins), same as an undeclared key would get. This is
 * deliberate, not a leftover gap: by the time `src/merge/fold.ts` calls
 * this function, it has already called `checkAppendable` on the relevant
 * value(s) and recorded a diagnostic if either failed (T058's collect-all
 * — the fold keeps going after finding one, rather than stopping, so a
 * later key's own violation is never missed), and `foldConfiguration`
 * discards the tree entirely whenever any diagnostic was found. What this
 * function returns when a value fails validation is therefore never
 * observed by a caller — it only has to not crash, so the tree-building
 * pass can keep running long enough to finish checking every other key.
 */
export function accumulateAppend(current, incoming) {
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
//# sourceMappingURL=strategy.js.map