/**
 * The recorded-response transport seam — contracts/recorded-responses.md,
 * research D7.
 *
 * Tests MUST NOT perform network access (constitution, Technology &
 * Security Constraints). Remote behavior in User Story 3 (fetching,
 * caching, pinning — out of scope for this slice) will be exercised
 * against recorded responses supplied through this seam rather than the
 * real network. This is Foundational scaffolding (tasks.md Phase 2): no
 * fetch layer exists yet to consume a `Transport` (`src/resolve/fetch.ts`
 * is User Story 3, T040), so nothing in this slice constructs a real,
 * network-backed implementation of it — only this recorded one, and the
 * unit tests proving its own two guarantees (T010, and this file's
 * `RecordedTransport` tests).
 *
 * A `Transport` models one HTTP request/response at a time — a single
 * hop, deliberately. Following redirects hop-by-hop (research D4) is
 * `fetch.ts`'s job; this seam only needs to answer "what happened when
 * *this* request was made," once per call.
 */

/** One recorded HTTP response: status, headers, and body **bytes** — not text, so encoding cases are expressible against a fetched document (contracts/recorded-responses.md). */
export interface RecordedResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

/** A recorded failure to reach the server at all — distinct from a response, so the offline/unreachable paths (FR-018) are testable without a real timeout. */
export type RecordedFailureKind = "connection-refused" | "timeout";

export interface RecordedFailure {
  readonly kind: RecordedFailureKind;
}

export type RecordingOutcome = { readonly kind: "response"; readonly response: RecordedResponse } | { readonly kind: "failure"; readonly failure: RecordedFailure };

/** One entry in a case's recorded-response list: a request to match, and what happens when it's made. */
export interface Recording {
  readonly url: string;
  readonly method: string;
  readonly outcome: RecordingOutcome;
}

/** What `src/resolve/fetch.ts` (User Story 3) will depend on to make one request — implemented for tests by `RecordedTransport` here, and by a real `fetch`-backed transport when that file is written. */
export interface Transport {
  request(url: string, method: string): Promise<RecordingOutcome>;
}

function recordingKey(url: string, method: string): string {
  return `${method} ${url}`;
}

/**
 * A `Transport` backed entirely by data supplied up front — no network,
 * ever. Recordings for the same (method, url) pair are consumed **in
 * order** (contracts/recorded-responses.md), which is what makes
 * revalidation testable: a first recording returns a body with an
 * `ETag`, a second returns `304 Not Modified`.
 *
 * Fails loudly — throws, not a soft "no match" value — on a request with
 * no matching recording left in its queue (runner contract point 1): a
 * silently-passed-through request would not be network access exactly,
 * but it is the same failure in spirit, "the test claims hermeticity it
 * did not verify."
 */
export class RecordedTransport implements Transport {
  private readonly queues: Map<string, RecordingOutcome[]>;

  constructor(recordings: readonly Recording[]) {
    this.queues = new Map();
    for (const recording of recordings) {
      const key = recordingKey(recording.url, recording.method);
      const queue = this.queues.get(key);
      if (queue === undefined) {
        this.queues.set(key, [recording.outcome]);
      } else {
        queue.push(recording.outcome);
      }
    }
  }

  // `async`, not a plain function manually returning a Promise: this is
  // what turns a synchronous throw (an unmatched request, or the internal
  // consistency guard below) into a *rejected* promise rather than an
  // exception thrown before any Promise exists — the distinction a caller
  // using `await`/`.catch()` uniformly depends on, and the one a manual
  // `throw` inside a non-`async` Promise-returning function gets wrong.
  async request(url: string, method: string): Promise<RecordingOutcome> {
    const key = recordingKey(url, method);
    const queue = this.queues.get(key);
    if (queue === undefined || queue.length === 0) {
      throw new Error(`RecordedTransport: no recorded response left for ${method} ${url} — this transport never falls through to the real network`);
    }
    const outcome = queue.shift();
    if (outcome === undefined) {
      // Unreachable: the length check above guarantees shift() returns a
      // value. Defensive per this codebase's noUncheckedIndexedAccess
      // convention.
      throw new Error("Internal error: RecordedTransport queue was non-empty but shift() returned undefined");
    }
    return outcome;
  }

  /**
   * T010: assert every recording supplied to this transport was
   * consumed. A case asserting a fetch happens must fail when it does
   * not — an unconsumed recording is exactly that: a request the case
   * expected that never occurred.
   */
  assertAllConsumed(): void {
    const unconsumed = [...this.queues.entries()].filter(([, queue]) => queue.length > 0);
    if (unconsumed.length === 0) {
      return;
    }
    const summary = unconsumed.map(([key, queue]) => `${key} (${queue.length} unconsumed)`).join(", ");
    throw new Error(`RecordedTransport: recordings were never consumed: ${summary}`);
  }
}
