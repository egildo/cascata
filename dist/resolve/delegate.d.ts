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
import type { PathFacility } from "../paths.js";
import type { Node } from "../model/node.js";
import type { SourceSpan } from "../model/span.js";
import { type Diagnostic } from "../diagnostics/diagnostic.js";
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
/**
 * Read one schema layer's own `keys:` section into a `DelegationGrantNode`
 * tree, recursing into `demand.keys.<child>` to arbitrary depth (v0.5's
 * own nested-`keys` precedent, applied here to a different keyword).
 * `delegate: allow` is the only recognized value (FR-002); anything else
 * present under a `delegate:` key is refused as
 * `delegate-value-unimplemented` at its own position, naming what is
 * supported, and contributes no grant.
 */
export declare function collectDelegationGrants(schemaTree: Node, declaringDocument: string, declaringRank: number): {
    readonly tree: DelegationGrantNode;
    readonly problems: readonly Diagnostic[];
};
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
export declare function mergeGrantTrees(a: DelegationGrantNode, b: DelegationGrantNode): DelegationGrantNode;
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
export declare function isAbsoluteDelegatedPath(text: string, paths: PathFacility): boolean;
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
 *
 * **v1.7 FR-006**: the roots are the caller's whole granted list, not a
 * set of delegation's own. §8.4 confines a delegated path to "the sandbox",
 * and there is one sandbox, not one per mechanism — a per-root policy
 * (this root for `$adopts`, that one for delegation) is explicitly out of
 * scope. The reuse this function has always practised is what makes that
 * free: widening `isWithinSandbox` widened delegation with it.
 */
export declare function isDelegationSandboxEscape(host: Host, location: string, sandboxRoots: readonly string[]): Promise<boolean>;
//# sourceMappingURL=delegate.d.ts.map