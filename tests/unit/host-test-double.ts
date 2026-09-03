/**
 * An in-memory `Host` test double — v0.7 US4, mirroring
 * `tests/corpus/transport.ts`'s `RecordedTransport` role for the local
 * side of the seam: a hermetic stand-in that proves `resolve()`/`load()`
 * genuinely go through `Host` rather than reaching the real filesystem
 * behind its back.
 */
import type { Host, HostReadResult } from "../../src/resolve/host.js";
import type { PathFacility } from "../../src/paths.js";

export interface InMemoryHostOptions {
  /** location -> bytes. A location absent from this map is a read refusal. */
  readonly files?: ReadonlyMap<string, Uint8Array>;
  /** location -> canonical identity. A location absent resolves to `undefined` (cannot canonicalize) unless `canonicalizeIsIdentity` is set. */
  readonly canonical?: ReadonlyMap<string, string>;
  /** When true, `canonicalize` returns its input unchanged for any location not explicitly listed in `canonical` — the common case for a flat in-memory filesystem with no symlinks. */
  readonly canonicalizeIsIdentity?: boolean;
  /**
   * The host's own namespace (v1.4 FR-001): reference text -> the
   * location it names. **Supplying this is what gives the host a
   * `locate` method at all** — omit it and the instance has none, which
   * is every host written before v1.4 and the case FR-004 needs to pin.
   */
  readonly identities?: ReadonlyMap<string, string>;
  /**
   * The host's path facility (v1.5, issue #1). Omit for the library's
   * POSIX default — which is what every case written before v1.5 wants,
   * since their locations are all POSIX-shaped. Supply one to pin that a
   * host's own path semantics are actually the ones used.
   */
  readonly paths?: PathFacility;
}

/** A `Host` backed entirely by an in-memory map — no `node:fs`, ever. Tracks every call it received, so a test can assert *what was asked*, not just what came back. */
export class InMemoryHost implements Host {
  readonly reads: string[] = [];
  readonly canonicalizes: string[] = [];
  readonly cacheReads: string[] = [];
  readonly cacheWrites: string[] = [];
  readonly locates: string[] = [];
  /** Present only when the constructor was given `identities` — see that option's own doc. */
  locate?: (reference: string) => Promise<string | undefined>;
  /** Present only when the constructor was given `paths` — otherwise the library's POSIX default applies, as it does for any host that answers none. */
  readonly paths?: PathFacility;

  private readonly files: ReadonlyMap<string, Uint8Array>;
  private readonly canonical: ReadonlyMap<string, string>;
  private readonly canonicalizeIsIdentity: boolean;
  private readonly cache = new Map<string, Uint8Array>();

  constructor(options?: InMemoryHostOptions) {
    this.files = options?.files ?? new Map();
    this.canonical = options?.canonical ?? new Map();
    this.canonicalizeIsIdentity = options?.canonicalizeIsIdentity ?? true;
    if (options?.paths !== undefined) {
      this.paths = options.paths;
    }
    const identities = options?.identities;
    if (identities !== undefined) {
      this.locate = async (reference: string): Promise<string | undefined> => {
        this.locates.push(reference);
        return identities.get(reference);
      };
    }
  }

  async read(location: string): Promise<HostReadResult> {
    this.reads.push(location);
    const bytes = this.files.get(location);
    if (bytes === undefined) {
      return { ok: false, reason: `InMemoryHost: no file at '${location}'` };
    }
    return { ok: true, bytes };
  }

  async canonicalize(location: string): Promise<string | undefined> {
    this.canonicalizes.push(location);
    if (this.canonical.has(location)) {
      return this.canonical.get(location);
    }
    return this.canonicalizeIsIdentity ? location : undefined;
  }

  async cacheRead(key: string): Promise<Uint8Array | undefined> {
    this.cacheReads.push(key);
    return this.cache.get(key);
  }

  async cacheWrite(key: string, bytes: Uint8Array): Promise<void> {
    this.cacheWrites.push(key);
    this.cache.set(key, bytes);
  }
}
