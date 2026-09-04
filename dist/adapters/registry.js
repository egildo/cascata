/**
 * The format registry — plan.md's Structure Decision: "the orchestrator
 * in `index.ts` consults `adapters/registry.ts` between them, which is
 * the one place a format name resolves to an adapter." tasks.md T032.
 *
 * This is the *only* module `src/index.ts`'s `resolve()` orchestrator
 * imports to reach a format adapter. Neither `src/resolve/` nor
 * `src/graph/` may import from `src/adapters/` at all (Principle IV,
 * `tests/unit/layering.test.ts`) — this file, and the orchestrator that
 * consults it, are what let `resolve()` parse a byte-read document
 * without either of those two stages ever knowing YAML exists.
 *
 * v0.2 registered exactly one format. The registry existed already, ahead
 * of needing more than one entry, because it is the seam the JSON and TOML
 * adapters (§14 v1.x) were meant to join with **no** change to `resolve/`
 * or `graph/` — plan.md's stated reason for the split.
 *
 * **v1.2 collected on that promise, and found half a bill outstanding.**
 * The JSON adapter joined by adding one line to `REGISTRY` and two
 * extensions to `formatForLocation`, and `src/resolve/` and `src/graph/`
 * were indeed untouched. But `src/index.ts` — the orchestrator this file's
 * own doc names as its only consumer — had never used the registry it
 * consults: both of its parse-at-location sites read `formatForLocation`
 * and then compared the answer to the literal `"yaml"`, calling
 * `parseYamlBytes` directly. Registering an adapter therefore changed
 * nothing a caller could reach until those two sites were made to look
 * the answer up (specs/011-json-adapter research P-7). The seam was real;
 * it simply had nothing plugged into the far end of it.
 *
 * `formatForLocation` is still deliberately the simplest thing that could
 * work (a file-extension map). It grows real content-sniffing or
 * config-driven selection only when something needs to choose between two
 * formats that share an extension, which nothing does.
 */
import { parseYamlBytes } from "./yaml/parse.js";
import { parseJsonBytes } from "./json/parse.js";
const REGISTRY = {
    yaml: { parseBytes: parseYamlBytes },
    json: { parseBytes: parseJsonBytes },
};
/** Look up the adapter registered for `format` (e.g. `"yaml"`), or `undefined` if none is. */
export function adapterForFormat(format) {
    return REGISTRY[format];
}
/**
 * Which format a local document at `location` should be read as, by file
 * extension. `undefined` for anything not recognized — the orchestrator
 * turns that into a diagnostic, never a silent guess.
 *
 * `.yaml`/`.yml` (v0.2) and `.json` (v1.2). TOML is still unwritten
 * (§14). This is deliberately not a general MIME/content-sniffing scheme
 * — extension-based selection resolves every case any fixture or worked
 * example actually uses, and it is confined to this one function so a
 * real scheme can replace it without touching `resolve/` or `graph/`.
 *
 * A compound extension needs no special case: the archive host that
 * motivated the JSON adapter answers a **virtual** location ending in
 * `.packet.json`, which ends in `.json`, so it selects the JSON adapter by
 * the ordinary rule. Nothing here knows what a packet is, and nothing here
 * should — the host invents the location and supplies the bytes; the
 * library decides what they mean (SPEC.md §16).
 */
export function formatForLocation(location) {
    const lower = location.toLowerCase();
    if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
        return "yaml";
    }
    if (lower.endsWith(".json")) {
        return "json";
    }
    return undefined;
}
//# sourceMappingURL=registry.js.map