/**
 * The cascade fixture v1.11 (specs/020-edit-targets) is written against, in memory.
 *
 * Every pointer, location and span asserted in the tests that use it was counted by hand from the
 * texts below, never from a run.
 *
 *   /virtual/root.yaml      schema: provides defaults.height (3.0) and styles ([house.css], append)
 *   /virtual/project.yaml   entry:  walls.W1.height, styles [a.css, b.css], levels delegated to levels.yaml
 *   /virtual/override.yaml  override: walls.W2.height, styles [c.css]
 *   /virtual/levels.yaml    fragment: L1.elevation
 *
 * Merged: styles is [house.css, a.css, b.css, c.css]; walls holds W1 (project) and W2 (override).
 */
import { merge, resolve, type MergedConfiguration, type ResolveOptions } from "../../src/index.js";
import { InMemoryHost } from "./host-test-double.js";

const ENCODER = new TextEncoder();

export const ROOT = [
  "$id: edit/root",
  "keys:",
  "  defaults:",
  "    demand:",
  "      type: mapping",
  "    provide:",
  "      height: 3.0",
  "  levels:",
  "    demand:",
  "      type: mapping",
  "    delegate: allow",
  "  styles:",
  "    demand:",
  "      type: sequence",
  "      items:",
  "        type: string",
  "    cascade: append",
  "    provide:",
  "      - house.css",
  "  walls:",
  "    demand:",
  "      type: mapping",
  "      values:",
  "        type: mapping",
  "        keys:",
  "          height:",
  "            demand:",
  "              type: float",
  "              required: true",
  "",
].join("\n");

export const PROJECT = ["$schema: ./root.yaml", "levels: ./levels.yaml", "styles:", "  - a.css", "  - b.css", "walls:", "  W1:", "    height: 3.2", ""].join("\n");
export const OVERRIDE = ["styles:", "  - c.css", "walls:", "  W2:", "    height: 2.8", ""].join("\n");
export const LEVELS = ["L1:", "  elevation: 0", ""].join("\n");

export const PROJECT_JSON = JSON.stringify({ $schema: "./root.yaml", walls: { W1: { height: 3.2 } } }, null, 2) + "\n";
export const LEVELS_JSON = '{\n  "L1": {\n    "elevation": 0\n  }\n}\n';

export function files(extra: Readonly<Record<string, string>> = {}): Map<string, Uint8Array> {
  const all: Record<string, string> = {
    "/virtual/root.yaml": ROOT,
    "/virtual/project.yaml": PROJECT,
    "/virtual/override.yaml": OVERRIDE,
    "/virtual/levels.yaml": LEVELS,
    ...extra,
  };
  return new Map(Object.entries(all).map(([location, text]) => [location, ENCODER.encode(text)]));
}

export async function build(entry: string, extra: Readonly<Record<string, string>> = {}, options: Partial<ResolveOptions> = {}): Promise<MergedConfiguration> {
  const resolved = await resolve(entry, { host: new InMemoryHost({ files: files(extra) }), sandboxRoot: "/virtual", ...options });
  if (!resolved.ok) throw new Error(`resolve: ${JSON.stringify(resolved.diagnostics)}`);
  const merged = merge(resolved);
  if (!merged.ok) throw new Error(`merge: ${JSON.stringify(merged.diagnostics)}`);
  return merged.configuration;
}

/** The full cascade: project over root, with the override above both. */
export function cascade(extra: Readonly<Record<string, string>> = {}, options: Partial<ResolveOptions> = {}): Promise<MergedConfiguration> {
  return build("/virtual/project.yaml", extra, { overrides: ["./override.yaml"], ...options });
}
