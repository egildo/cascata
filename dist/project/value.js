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
 * 3. **The demand decides the numeric type, not the document.** `kind` is
 *    lexical — `30` is an int and `30.0` is a float — so a faithful
 *    projection would let a config author's punctuation decide whether the
 *    consuming application sees `bigint` or `number` under an unchanged
 *    schema. `src/validate/numeric.ts` computes the accumulated admission
 *    per pointer; `projectScalar` below reads it, and emits §17's
 *    `precision-narrowed` lint where a normalization would actually drop a
 *    digit — never on the shape, because "a lint that cried on every
 *    `int | float` key would be ignored within a week".
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
import { createDiagnostic } from "../diagnostics/diagnostic.js";
import { pointerFromPath } from "../model/pointer.js";
import { collectNumericDemands } from "../validate/numeric.js";
/**
 * Whether converting `value` to a double loses information.
 *
 * **The round trip, not `Number.isSafeInteger`.** 2^53, 3·2^52 and 2^60 are
 * all exactly representable as doubles and all fail `isSafeInteger`, so
 * that predicate would fire the lint on values that lose nothing — "a lint
 * that cried on the shape rather than the value would be ignored within a
 * week" (§17), one layer down from where the article says it. Found by
 * probe before any of this was written (research.md F-3), and the case that
 * catches it is FR-020's required *absence* assertion.
 *
 * The `isFinite` guard is equally load-bearing rather than defensive:
 * `Number(2n ** 1024n)` is `Infinity`, and `BigInt(Infinity)` **throws**
 * `RangeError` — which under Article VI would be a legal document making
 * `load()` throw.
 */
function narrowsInexactly(value) {
    const asNumber = Number(value);
    if (!Number.isFinite(asNumber)) {
        return true;
    }
    return BigInt(asNumber) !== value;
}
/**
 * Project one scalar, consulting the accumulated numeric demand at its own
 * pointer (§17's table, `contracts/numeric-projection.md` §1).
 *
 * A pointer **absent** from `numeric` is the table's fourth row — "no
 * numeric demand", projected faithfully by lexical kind, which for an
 * `int` is `bigint` at every magnitude. Absence is the honest spelling of
 * "nothing was promised"; an enum member for it would invite this function
 * to forget one of three cases.
 *
 * Only an `int`-kind scalar can be affected. A `float` is a `number` under
 * every demand — there is none under which an IEEE-754 double becomes
 * exact — and a `float` value under `type: int` is a *validation* refusal
 * that never reaches a successful projection.
 */
/**
 * The pedigree position and delegation breadcrumb of the layer a value's
 * own span traces back to — constitution gate 5, which holds an `info` to
 * exactly the fields an `error` of the same milestone carries ("a lint
 * diagnosed worse than a refusal is a lint nobody acts on").
 *
 * `check.ts`'s own `layerForSpanOrigin` **throws** where an origin matches
 * neither a layer nor a delegation breadcrumb, which is right for a walk
 * whose inputs came from the fold. It would be wrong here: FR-014 says the
 * projection never throws on a legal document, and `project()`'s contract
 * takes a configuration from anywhere. Both fields are therefore simply
 * absent when the origin is unrecognized — the never-phasing floor (code,
 * sentence, positioned span) is unaffected, since the span is the node's
 * own either way.
 */
function attributionOf(configuration, node) {
    const originId = node.span.origin.id;
    const direct = configuration.layers.find((layer) => layer.identity.location === originId);
    if (direct !== undefined) {
        return { pedigreePosition: direct.rank };
    }
    const breadcrumb = configuration.delegationBreadcrumbs.get(originId);
    if (breadcrumb === undefined || configuration.layers.length === 0) {
        return {};
    }
    // Every delegated value belongs to the config layer (v0.6 FR-010), which
    // in every pedigree is the single highest-rank one — `check.ts`'s own
    // rule, applied here for the same reason.
    const configLayer = configuration.layers.reduce((highest, layer) => (layer.rank > highest.rank ? layer : highest));
    return { pedigreePosition: configLayer.rank, delegatedFrom: breadcrumb };
}
function projectScalar(configuration, node, pointer, numeric, diagnostics) {
    if (node.kind !== "int" || numeric.get(pointer) !== "number") {
        return node.value;
    }
    if (narrowsInexactly(node.value)) {
        diagnostics.push(createDiagnostic({
            level: "info",
            code: "precision-narrowed",
            // §17: the diagnostic "names the key and both values" — both, so
            // an author can see exactly what they lose.
            message: `'${pointer}' is ${node.value} in the document, and the accumulated demand admits 'float' — a consumer receives ${Number(node.value)}, which is not the same number (SPEC.md §17, v1.0 FR-019)`,
            // Principle III's never-phasing obligation: the position is the
            // offending construct's own — the value's, not that of the demand
            // that caused the narrowing.
            primary: node.span,
            pointer,
            demand: { pointer, span: node.span },
            ...attributionOf(configuration, node),
        }));
    }
    return Number(node.value);
}
/**
 * Project `configuration.tree` into ordinary JS data.
 *
 * Total (FR-014), pure (FR-013), and a projection rather than a
 * replacement (FR-012): the configuration handed in is untouched and its
 * tree, spans, provenance and pedigree stay exactly where they were, so
 * `why()` keeps answering by RFC 6901 pointer.
 */
export function project(configuration) {
    const numeric = collectNumericDemands(configuration);
    const diagnostics = [];
    const results = [];
    const tasks = [{ kind: "visit", node: configuration.tree, pointer: "" }];
    while (tasks.length > 0) {
        const task = tasks.pop();
        if (task === undefined) {
            break; // unreachable: the loop condition already established one is there.
        }
        if (task.kind === "mapping") {
            // `Object.create(null)`'s declared return type is `any`; it is
            // narrowed here, at the one site in this codebase that produces one,
            // by the annotation rather than by a cast.
            const target = Object.create(null);
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
            results.push(projectScalar(configuration, node, task.pointer, numeric, diagnostics));
            continue;
        }
        if (node.type === "mapping") {
            const mapping = node;
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
        const sequence = node;
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
    return { value: value, diagnostics };
}
//# sourceMappingURL=value.js.map