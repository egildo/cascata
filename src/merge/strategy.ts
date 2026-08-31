/**
 * Reading a schema's `keys:` vocabulary — SPEC.md §9 ("Schema vocabulary
 * per key: `demand`..., `provide`, `cascade: replace | append`, `seal:
 * open | closed`, `final`, `delegate: allow`"), §5.1, §5.3; v0.3 FR-001,
 * FR-002, FR-003; tasks.md T008, T009.
 *
 * This is the first module in Cascata that reads schema **vocabulary**
 * rather than only the `$`-prefixed document keys v0.1/v0.2 read. It reads
 * exactly two things per key — `provide` and `cascade` — and nothing else:
 * `demand`, `seal`, `final`, and `delegate` are not read by this function at
 * all (FR-002). That is what "ignored" means here: there is no code path
 * that inspects them, so there is nothing to guess a meaning for.
 *
 * **Scope for this slice (T001–T024)**: `cascade` is read and carried on
 * `KeyVocabulary` (T008 asks for both `provide` and `cascade`), but nothing
 * in `src/merge/fold.ts` yet *acts* on its value — `cascade: append`
 * (User Story 2), strategy-mutation refusal, and validating unknown/
 * unimplemented strategy values (User Story 4) are Phase 4 and Phase 6,
 * out of this slice's scope. Every key in this slice's fold behaves as
 * `replace` regardless of what `cascade` says, which is the FR-011 default
 * anyway — so no test in this slice's scope can observe a difference.
 */

import type { Node } from "../model/node.js";

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
