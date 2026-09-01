/**
 * Delegation primitives — SPEC.md §8, §8.4; v0.6 FR-001 through FR-005,
 * FR-021 through FR-023, FR-026; specs/006-delegation/research.md D2, D6,
 * D7; contracts/delegation-resolution.md.
 *
 * **What lives here vs. what lives in `src/index.ts`** (research.md D1,
 * v0.6 FR-008/FR-008a): this file is format-blind and IO-blind, exactly
 * like the rest of `src/resolve/` — it walks already-parsed `Node` trees
 * and pure strings, and never reads a byte or calls an adapter. Reading a
 * delegated fragment's bytes and parsing them (crossing into
 * `src/adapters/`, which `src/resolve/` may never do —
 * `tests/unit/layering.test.ts`) is `src/index.ts`'s own job, exactly as
 * it already is for `$schema`/`$adopts` (`walkAdoptsChain`). This module
 * supplies the two things that job needs and cannot itself contain
 * without becoming schema-aware: reading `delegate:` grants out of a
 * schema's own tree (`collectDelegationGrants`), and the two
 * delegation-specific security checks research.md D6/D7 settle
 * (`isAbsoluteDelegatedPath`, `resolveDelegatedLocation`).
 *
 * **Grant scope is `keys` only, not `items`** (research.md D2) — no
 * Acceptance Scenario or worked example in `SPEC.md` §8 or this
 * milestone's own spec.md exercises a `delegate` grant nested under
 * `items`. Recorded as a scope decision, not a citation gap.
 */

import { isAbsolute } from "node:path";
import type { Node } from "../model/node.js";
import type { SourceSpan } from "../model/span.js";
import { createDiagnostic, type Diagnostic } from "../diagnostics/diagnostic.js";
import { pointerFromPath } from "../model/pointer.js";
import { isWithinSandbox } from "./location.js";
import { parseTypeExpression } from "../validate/typeexpr.js";
import type { Host } from "./host.js";

/** One `delegate: allow` grant, at one position in one schema layer's own `keys:` tree. */
export interface DelegationGrant {
  /** RFC 6901 path segments from the schema's own `keys:` root, e.g. `["network","subnet"]`. */
  readonly pointer: readonly string[];
  /** Which schema document granted it — for diagnostics naming "the schema's own position". */
  readonly declaringDocument: string;
  readonly declaringRank: number;
  /** The `delegate: allow` value's own span. */
  readonly span: SourceSpan;
}

/**
 * The recursive shape `collectDelegationGrants` builds, one node per
 * schema `keys:`/nested-`keys` position reachable from the root: whether
 * *this* position is itself granted, and which of its own named children
 * carry further grants beneath them (v0.6 FR-012's "wherever the
 * governing schema grants it").
 */
export interface DelegationGrantNode {
  readonly grant?: DelegationGrant;
  readonly keys: ReadonlyMap<string, DelegationGrantNode>;
}

const EMPTY_GRANT_NODE: DelegationGrantNode = { keys: new Map() };

/**
 * Whether a granted key's own `demand` (siblings at the same `keys.<name>`
 * position, never a resolved/accumulated demand across the pedigree — v0.7
 * FR-005, `SPEC.md` §8.1) is a leaf shape an inline string scalar would
 * satisfy — the §8.1 razor's own "almost" case: a fragment reached through
 * `delegate: allow` is a document, so the config author is very unlikely to
 * have meant "store the literal string I wrote" once the key can also load
 * a file, but a bare string scalar fragment would in fact satisfy such a
 * demand, so this is a lint, not a refusal.
 *
 * **Deliberately scoped to what grant-collection can decide on its own**
 * (research.md D4's sibling reasoning, applied here): this runs per schema
 * layer, before merge or named-type resolution exist, so it cannot resolve
 * a qualified or pedigree-declared type name the way `src/validate/check.ts`
 * can at validate time. It recognizes exactly two shapes, both syntactic:
 * no `type:` constraint at all (nothing to violate — vacuously satisfied),
 * and `type: string` as a single, depth-0, unqualified alternative — §8.1's
 * own "plain case". A union that merely *includes* `string`
 * (`string | mapping`), or a named type that would resolve to `string`, is
 * out of this function's reach and is not lint-covered — recorded as a
 * scope decision in the milestone report, not silently dropped.
 */
function demandAcceptsInlineString(demandNode: Node | undefined): boolean {
  if (demandNode === undefined || demandNode.type !== "mapping") {
    return true;
  }
  const typeNode = demandNode.entries.get("type");
  if (typeNode === undefined) {
    return true;
  }
  if (typeNode.type !== "scalar" || typeNode.kind !== "string") {
    return false;
  }
  const parsed = parseTypeExpression(typeNode.value);
  if (!parsed.ok || parsed.value.alternatives.length !== 1) {
    return false;
  }
  const alt = parsed.value.alternatives[0];
  return alt !== undefined && alt.depth === 0 && alt.name === "string";
}

function lookupMappingEntry(tree: Node, key: string): Node | undefined {
  if (tree.type !== "mapping") {
    return undefined;
  }
  return tree.entries.get(key);
}

/**
 * Read one schema layer's own `keys:` section into a `DelegationGrantNode`
 * tree, recursing into `demand.keys.<child>` to arbitrary depth (v0.5's
 * own nested-`keys` precedent, applied here to a different keyword).
 * `delegate: allow` is the only recognized value (FR-002); anything else
 * present under a `delegate:` key is refused as
 * `delegate-value-unimplemented` at its own position, naming what is
 * supported, and contributes no grant.
 */
export function collectDelegationGrants(schemaTree: Node, declaringDocument: string, declaringRank: number): { readonly tree: DelegationGrantNode; readonly problems: readonly Diagnostic[] } {
  const problems: Diagnostic[] = [];

  function readEntry(entryNode: Node, pointer: readonly string[]): DelegationGrantNode {
    if (entryNode.type !== "mapping") {
      return EMPTY_GRANT_NODE;
    }
    const demandNode = entryNode.entries.get("demand");
    let grant: DelegationGrant | undefined;
    const delegateNode = entryNode.entries.get("delegate");
    if (delegateNode !== undefined) {
      if (delegateNode.type === "scalar" && delegateNode.kind === "string" && delegateNode.value === "allow") {
        grant = { pointer, declaringDocument, declaringRank, span: delegateNode.span };
        if (demandAcceptsInlineString(demandNode)) {
          problems.push(
            createDiagnostic({
              level: "info",
              code: "delegate-inline-string-loaded",
              message: `'${pointerFromPath(pointer)}' grants 'delegate: allow' but its own demand is a leaf shape an inline string would satisfy — an inline string here is LOADED as a delegation target, never matched against that demand (SPEC.md §8.1, v0.7 FR-005)`,
              primary: delegateNode.span,
              demand: { pointer: pointerFromPath([...pointer, "delegate"]), span: delegateNode.span },
              pedigreePosition: declaringRank,
            }),
          );
        }
      } else {
        problems.push(
          createDiagnostic({ level: "error",
            code: "delegate-value-unimplemented",
            message: `'${pointerFromPath(pointer)}.delegate' is not 'allow' — v0.6 recognizes only 'delegate: allow'; a selector-style form ('delegate: { allow: true, formats: [...] }') is a future door, not yet implemented (SPEC.md §8.4, v0.6 FR-002)`,
            primary: delegateNode.span,
            demand: { pointer: pointerFromPath([...pointer, "delegate"]), span: delegateNode.span },
            pedigreePosition: declaringRank,
          }),
        );
      }
    }
    const keys = new Map<string, DelegationGrantNode>();
    const nestedKeysNode = demandNode !== undefined && demandNode.type === "mapping" ? demandNode.entries.get("keys") : undefined;
    if (nestedKeysNode !== undefined && nestedKeysNode.type === "mapping") {
      for (const [childName, childEntry] of nestedKeysNode.entries) {
        keys.set(childName, readEntry(childEntry, [...pointer, childName]));
      }
    }
    if (grant === undefined && keys.size === 0) {
      return EMPTY_GRANT_NODE;
    }
    return { ...(grant !== undefined ? { grant } : {}), keys };
  }

  const keysNode = lookupMappingEntry(schemaTree, "keys");
  const keys = new Map<string, DelegationGrantNode>();
  if (keysNode !== undefined && keysNode.type === "mapping") {
    for (const [name, entryNode] of keysNode.entries) {
      keys.set(name, readEntry(entryNode, [name]));
    }
  }
  return { tree: { keys }, problems };
}

/**
 * Union two grant trees (v0.6 FR-012, spec.md's Key Entities): a
 * position is delegable if *either* tree says so — `delegate` is a
 * permission, not a composing constraint, so there is no narrowing/
 * widening question here the way there is for `demand` (v0.5). The
 * **first** grant found (by pedigree rank, ascending) wins when both
 * trees grant the identical position, purely so `FR-002`'s own-position
 * refusal has one deterministic span to report — v0.6 has no Acceptance
 * Scenario distinguishing "two layers both grant the same key", so this
 * is a scope decision, not a spec citation.
 */
export function mergeGrantTrees(a: DelegationGrantNode, b: DelegationGrantNode): DelegationGrantNode {
  const grant = a.grant ?? b.grant;
  const keys = new Map<string, DelegationGrantNode>();
  const names = new Set([...a.keys.keys(), ...b.keys.keys()]);
  for (const name of names) {
    const left = a.keys.get(name) ?? EMPTY_GRANT_NODE;
    const right = b.keys.get(name) ?? EMPTY_GRANT_NODE;
    keys.set(name, mergeGrantTrees(left, right));
  }
  return { ...(grant !== undefined ? { grant } : {}), keys };
}

/**
 * Whether `text` (a delegated reference's raw, unresolved text, before
 * any `~/`-expansion) is an absolute filesystem path — checked
 * **before** any resolution, refused unconditionally regardless of
 * whether the resolved location would sit inside the sandbox root (v0.6
 * FR-023, research.md D7: this is a separate rule from sandbox
 * confinement, not folded into it). A scheme prefix (`https://…`) is not
 * "absolute" in this sense — that is `classifyReferenceLocation`'s own
 * concern, checked first by the caller. A leading `~/` is not "absolute"
 * either by this literal check (research.md D6, revised during
 * implementation): the orchestrator reuses `classifyReferenceLocation`
 * as-is for delegation (`authority: "config-authored"`, so `~/` *does*
 * expand, the same as `$schema`), which is safe precisely because
 * `isDelegationSandboxEscape` below is unconditional — an expanded
 * `~/foo` almost always resolves outside the sandbox root and is caught
 * there regardless, so refusing it a second, earlier way was judged not
 * worth the extra code path.
 */
export function isAbsoluteDelegatedPath(text: string): boolean {
  return isAbsolute(text);
}

/**
 * Whether a delegated reference resolving to `location` escapes
 * `sandboxRoot` (v0.6 FR-022, research.md D6) — **unconditional**,
 * unlike `src/resolve/location.ts`'s `isSandboxEscape`, which exempts a
 * config-authored reference entirely. Delegation gets no such exemption:
 * the string that triggers a load can appear anywhere, including several
 * delegation hops deep inside a fragment nobody hand-reviewed as a
 * top-level choice the way `$schema` is, which is exactly why §8.4 states
 * the confinement without an authority carve-out. Reuses
 * `isWithinSandbox` directly — the real-path-following primitive
 * `isSandboxEscape` itself calls — never the authority-gated wrapper
 * (FR-026: reuse the sandbox *machinery*, not its `$schema`/`$adopts`-
 * specific policy). `async`/`Host`-backed as of v0.7 — `isWithinSandbox`
 * itself now asks the host to canonicalize, rather than calling
 * `realpathSync` directly (SPEC.md Article VI).
 */
export async function isDelegationSandboxEscape(host: Host, location: string, sandboxRoot: string): Promise<boolean> {
  return !(await isWithinSandbox(host, location, sandboxRoot));
}
