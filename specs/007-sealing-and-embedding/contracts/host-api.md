# Contract: The Host Seam

## `Host` (`src/resolve/host.ts`)

```ts
type HostReadResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: string };
interface Host {
  read(location: string): Promise<HostReadResult>;
  canonicalize(location: string): Promise<string | undefined>;
  cacheRead(key: string): Promise<Uint8Array | undefined>;
  cacheWrite(key: string, bytes: Uint8Array): Promise<void>;
}
```

1. `read` answers bytes-or-refusal for a **local** location string. Never called for an
   `https://` location — that stays `Transport`'s job (`src/resolve/fetch.ts`, unchanged).
2. `canonicalize` answers the canonical identity of a location, or `undefined` if none can be
   determined (the location does not exist, a permission error, etc.). Never a policy verdict —
   the library alone decides whether a canonical identity lies inside a sandbox.
3. `cacheRead`/`cacheWrite` are an opaque byte store keyed by strings the library constructs
   (content hashes and hashed URLs — never a path the host is expected to interpret). A host with
   no cache configured may throw from either, mirroring `sandboxRoot`'s "required exactly when
   needed" posture.
4. Every method returns a `Promise` — the seam is async throughout (spec.md's own Assumption).
5. Never throws for "the world said no" — a nonexistent file is `{ok: false, reason: ...}` from
   `read`, or `undefined` from `canonicalize`, never a rejected promise. A `Host` **may** throw for
   its own misconfiguration (no cache directory configured), which is a programmer error, not a
   fact about the world.

## `resolve()` / `load()` options — the host-shaped fields

- `host: Host` — **required**. Omitting it, or passing something that fails a basic shape check,
  throws synchronously before any asynchronous work begins (FR-028).
- `transport?: Transport` — unchanged shape, but **no default**. A remote reference reached with no
  `transport` supplied throws the same way reaching one with no `cacheDir` did in v0.2–v0.6.

## `createNodeHost` / `createNodeTransport` (`cascata/host/node.js`, new entry point)

```ts
function createNodeHost(options?: { cacheDir?: string }): Host;
function createNodeTransport(maxBytes?: number): Transport;
```

The shipped host. `createNodeHost`'s `read`/`canonicalize` read the real filesystem
(`node:fs`/`node:fs`'s `realpathSync`, wrapped as promises); `cacheRead`/`cacheWrite` read/write
files under `options.cacheDir`, throwing if it was never supplied. `createNodeTransport` performs
real HTTPS requests via the platform `fetch`, identical in behavior to v0.2–v0.6's
`createNetworkTransport`, moved verbatim.

**Never imported by anything under `src/` except test files and `src/index.ts`'s own doc examples**
— importing it from the library's own core would defeat the boundary (`tests/unit/layering.test.ts`'s
new sweep, FR-023/FR-024, names this file as the one permitted exception, and permits it only
because it lives at a genuinely separate entry point, not because it is special-cased inline).

## Diagnostics

A host `read` refusal is reported as `document-unreachable`, anchored to the reference that asked
(FR-028) — reused, not a new code (research.md D1). A library-side refusal made *before* asking the
host (sandbox confinement, a missing remote-delegation opt-in) keeps its own existing code
(`sandbox-escape`, `remote-delegation-not-permitted`) and is unaffected by this milestone (FR-029).
