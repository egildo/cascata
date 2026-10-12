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
import type { ParseLimits } from "./limits.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { Node } from "../model/node.js";
import type { Origin } from "../model/span.js";
/** Mirrors `adapters/yaml/parse.ts`'s `ParseOutcome` — every adapter in the registry MUST produce this same shape, format-blind past this point. */
export type AdapterParseOutcome = {
    readonly ok: true;
    readonly tree: Node;
} | {
    readonly ok: false;
    readonly diagnostics: Diagnostic[];
};
/** One format adapter's bytes-in entry point — the same shape as `src/index.ts`'s `parse()`, minus the origin-required-and-freezes wrapping that belongs to the public surface, not to an individual adapter. */
export type AdapterParseBytes = (bytes: Uint8Array, origin: Origin, limits?: Partial<ParseLimits>) => AdapterParseOutcome;
export interface FormatAdapter {
    readonly parseBytes: AdapterParseBytes;
}
/** Look up the adapter registered for `format` (e.g. `"yaml"`), or `undefined` if none is. */
export declare function adapterForFormat(format: string): FormatAdapter | undefined;
/**
 * Which format a document at `location` should be read as, by file
 * extension (a URL's path's, for an `https://` location: FR-021 above). `undefined` for anything not recognized — the orchestrator
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
export declare function formatForLocation(location: string): string | undefined;
//# sourceMappingURL=registry.d.ts.map