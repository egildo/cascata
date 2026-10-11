/**
 * Shared scaffolding for the v1.13 graph-identity cases: an in-memory host from plain objects, and a
 * resolve() wrapper that stands the sandbox at `/v`. Locations are POSIX and written out by hand.
 */
import { resolve, type ResolveResult } from "../../src/index.js";
import type { Transport } from "../../src/resolve/transport.js";
import { InMemoryHost } from "./host-test-double.js";

const ENCODER = new TextEncoder();

/** An in-memory host holding `files` (location -> text). `canonical` maps a spelling to the file's true path; any location not listed canonicalizes to itself, as every earlier in-memory host did. */
export function vhost(files: Readonly<Record<string, string>>, canonical: Readonly<Record<string, string>> = {}, canonicalizeIsIdentity = true): InMemoryHost {
  return new InMemoryHost({ files: new Map(Object.entries(files).map(([location, text]) => [location, ENCODER.encode(text)])), canonical: new Map(Object.entries(canonical)), canonicalizeIsIdentity });
}

export function resolveAt(host: InMemoryHost, entry: string, extra: { readonly transport?: Transport; readonly sandboxRoot?: string; readonly allowRemoteDelegation?: boolean } = {}): Promise<ResolveResult> {
  return resolve(entry, { host, sandboxRoot: extra.sandboxRoot ?? "/v", ...(extra.transport === undefined ? {} : { transport: extra.transport }), ...(extra.allowRemoteDelegation === undefined ? {} : { allowRemoteDelegation: extra.allowRemoteDelegation }) });
}

/** The failure of a resolve() that must have failed, or a thrown description of what came back instead. */
export function failureOf(result: ResolveResult) {
  if (result.ok) throw new Error(`expected a refusal, resolved ${result.graph.documents.map((d) => d.identity.location).join(", ")}`);
  return result.diagnostics;
}
