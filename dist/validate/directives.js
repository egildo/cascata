/**
 * The `directives:` section — `SPEC.md` §9 (amended v0.7; §15's
 * "Constraining the reserved `$`-keys"), §6.1;
 * specs/008-metaschema-bootstrap FR-011 through FR-014,
 * contracts/values-and-directives.md §4.
 *
 * Reserved keys are **directives, not data**: they govern how a document
 * is found and what governs it, and they are stripped before a
 * configuration exists (§9, settled in v0.3). That is correct, and it is
 * exactly why a meta-schema cannot constrain them through `keys:` — it
 * would be constraining something the pipeline has already, rightly,
 * removed. `directives:` is the third top-level section, whose vocabulary
 * is **closed to the six reserved keys** and whose entries take the same
 * per-key vocabulary a `keys:` entry takes.
 *
 * Two properties this module exists to keep true, and both are structural
 * rather than careful:
 *
 * - **A directive is read from the config layer's own parsed tree**
 *   (`layer.tree`), never from the merged configuration. Nothing here
 *   touches the fold, so FR-013 — "no reserved key appears in a merged
 *   configuration, before or after `directives:` exists" — holds by
 *   construction. The failure mode it guards against is silent and would
 *   corrupt every merged tree, which is why the reading is stated here and
 *   tested on its own.
 * - **The closed set is `src/merge/fold.ts`'s own
 *   `RESERVED_DOCUMENT_KEYS`**, imported rather than restated. One list.
 *   If the two could drift, a `directives:` entry could name a key the
 *   fold does not strip, and that key would enter the data plane.
 *
 * Running each entry's `demand` against the value is `check.ts`'s job —
 * this module says *what* a directives section is; that one owns the one
 * implementation of "check a demand against a value" and there is no
 * second copy of it anywhere.
 */
import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { pointerFromPath } from "../model/pointer.js";
import { RESERVED_DOCUMENT_KEYS } from "../merge/fold.js";
import { readKeyDeclarationDemand } from "./vocabulary.js";
/**
 * Read one layer's own `directives:` section, plus any closed-vocabulary
 * refusals found doing so (FR-011).
 *
 * `layer.role !== "schema"` contributes nothing — **FR-014**: a
 * `directives:` section declared by a config has no effect, exactly as a
 * config's own `keys:` and `types:` sections already have none (v0.4
 * FR-003, v0.5). An absent, empty, or non-mapping `directives:`
 * contributes nothing either, and an entry that is not a mapping
 * contributes only its name check — the "not a mapping -> nothing, never
 * an error" posture v0.3 onward uses throughout for reading a section.
 *
 * `provide`, `cascade`, `final` and `delegate` inside an entry are
 * **accepted and inert**. FR-012 requires the entry to take a `keys:`
 * entry's whole vocabulary, and a directive is never merged and governs no
 * layer, so there is nothing for the governance keywords to do. Recorded
 * as a reading of FR-012 rather than left to be inferred: refusing them
 * would contradict FR-012, and honouring them would need semantics no
 * document states.
 */
export function readDirectives(layer) {
    const declarations = [];
    const problems = [];
    if (layer.role !== "schema" || layer.tree.type !== "mapping") {
        return { declarations, problems };
    }
    const section = layer.tree.entries.get("directives");
    if (section === undefined || section.type !== "mapping") {
        return { declarations, problems };
    }
    for (const [name, entryNode] of section.entries) {
        if (!RESERVED_DOCUMENT_KEYS.has(name)) {
            problems.push(createDiagnostic({
                level: "error",
                code: "unknown-directive-key",
                message: `'directives' declares '${name}', which is not one of SPEC.md §9's six reserved document keys (${[...RESERVED_DOCUMENT_KEYS].join(", ")}) — the section's vocabulary is closed`,
                primary: entryNode.span,
                demand: { pointer: pointerFromPath(["directives", name]), span: entryNode.span },
                pedigreePosition: layer.rank,
            }));
            continue;
        }
        declarations.push({ name, demand: readKeyDeclarationDemand(entryNode), span: entryNode.span });
    }
    return { declarations, problems };
}
/**
 * The value of reserved key `name` in `layer`'s own **parsed document**,
 * or `undefined` if it carries none.
 *
 * Deliberately `layer.tree`, not `configuration.tree`: by the time a
 * configuration exists the reserved keys are gone, and reading them back
 * out of it is impossible by design (§9). See this module's own doc for
 * why that is the property rather than an obstacle.
 */
export function reservedKeyValue(layer, name) {
    if (layer.tree.type !== "mapping") {
        return undefined;
    }
    return layer.tree.entries.get(name);
}
//# sourceMappingURL=directives.js.map