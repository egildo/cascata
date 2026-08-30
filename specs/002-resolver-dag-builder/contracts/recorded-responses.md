# Contract: Recorded Responses

**Implements**: research D7 | **Cites**: constitution Technology & Security Constraints

Tests MUST NOT perform network access. Remote behavior is exercised against recorded responses
supplied through the transport seam.

## Shape

A recording maps a request to a response: the URL and method in, and status, headers, and **body
bytes** out. Bodies are bytes rather than text, so encoding cases — the UTF-8 refusals of FR-002 —
are expressible against a fetched document exactly as against a local one.

A recording may specify a **failure** instead of a response: connection refused, or a timeout, so
the offline and unreachable paths (FR-018) are testable without waiting for a real timeout.

Multiple recordings for one URL are consumed in order, which is what makes revalidation testable:
first request returns a body and an `ETag`, second returns `304 Not Modified`.

## Runner contract

1. A request with no matching recording **fails loudly**. It is never silently passed to the real
   network, and never treated as a miss.
2. Unconsumed recordings at the end of a case are a failure — a test asserting a fetch happens must
   fail when it does not.
3. Recordings are data. Adding a case requires no code change, matching FR-024's rule for
   conformance cases generally.

## What this deliberately does not do

It is not a general HTTP mock library and not an extension point for users. It exists so the suite
is hermetic. Anything it cannot express is a signal to reconsider the test, not to grow the format.
