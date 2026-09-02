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
 * v0.2 registers exactly one format. The registry exists now, ahead of
 * needing more than one entry, because it is the seam the JSON and TOML
 * adapters (§14 v1.x, out of scope here) are meant to join with **no**
 * change to `resolve/` or `graph/` — plan.md's stated reason for the
 * split. `formatForLocation` is deliberately the simplest thing that
 * could work for that one entry (a file-extension map); it grows real
 * content-sniffing or config-driven selection only once a second format
 * adapter exists to select between.
 */

import { parseYamlBytes } from "./yaml/parse.js";
import type { ParseLimits } from "./limits.js";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { Node } from "../model/node.js";
import type { Origin } from "../model/span.js";

/** Mirrors `adapters/yaml/parse.ts`'s `ParseOutcome` — every adapter in the registry MUST produce this same shape, format-blind past this point. */
export type AdapterParseOutcome = { readonly ok: true; readonly tree: Node } | { readonly ok: false; readonly diagnostics: Diagnostic[] };

/** One format adapter's bytes-in entry point — the same shape as `src/index.ts`'s `parse()`, minus the origin-required-and-freezes wrapping that belongs to the public surface, not to an individual adapter. */
export type AdapterParseBytes = (bytes: Uint8Array, origin: Origin, limits?: Partial<ParseLimits>) => AdapterParseOutcome;

export interface FormatAdapter {
  readonly parseBytes: AdapterParseBytes;
}

const REGISTRY: Readonly<Record<string, FormatAdapter>> = {
  yaml: { parseBytes: parseYamlBytes },
};

/** Look up the adapter registered for `format` (e.g. `"yaml"`), or `undefined` if none is. */
export function adapterForFormat(format: string): FormatAdapter | undefined {
  return REGISTRY[format];
}

/**
 * Which format a local document at `location` should be read as, by file
 * extension. `undefined` for anything not recognized — the orchestrator
 * turns that into a diagnostic, never a silent guess.
 *
 * Only `.yaml`/`.yml` are recognized because only the YAML adapter
 * exists (§14: JSON/TOML are v1.x, out of scope). This is deliberately
 * not a general MIME/content-sniffing scheme — extension-based selection
 * is the simplest thing that resolves every case this milestone's
 * fixtures and worked examples actually use, and it is confined to this
 * one function so a real scheme can replace it without touching
 * `resolve/` or `graph/`.
 */
export function formatForLocation(location: string): string | undefined {
  const lower = location.toLowerCase();
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return "yaml";
  }
  return undefined;
}
