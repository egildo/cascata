# Contract: Recorded Responses

**Implements**: research D7 | **Cites**: constitution Technology & Security Constraints

Tests MUST NOT perform network access. Remote behavior is exercised against recorded responses
supplied through the transport seam.

## Shape

A recording maps a request to a response: the URL, method, **and request headers** in, and status,
headers, and **body bytes** out.

Request headers are part of the contract, not an omission corrected later: without them the transport
cannot send `If-None-Match` or `If-Modified-Since`, so a real server has no reason to ever answer
`304` and revalidation silently degrades to always refetching the whole body — while remaining fully
green against recordings, because a recording can be told to return `304` regardless of what was
asked. That is exactly the shape of defect this project keeps finding: hermetically testable, and
wrong in production. A conforming transport MUST forward the request headers it is given. Bodies are bytes rather than text, so encoding cases — the UTF-8 refusals of FR-002 —
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
