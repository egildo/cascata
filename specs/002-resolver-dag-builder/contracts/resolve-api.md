# Contract: Resolution Entry Point

**Implements**: FR-001–FR-004, FR-022, FR-025 | **Stability**: written before v1.0, when no compatibility promise was made; from v1.0 the surface follows `SPEC.md` §15's freeze rule (a correction always, an addition while no meaning changes, a changed meaning only at v2.0)

## Shape

```
parse(bytes, { origin }) -> ParseResult                      // v0.1's entry, now taking bytes
parseText(text, { origin }) -> ParseResult                   // retained; cannot enforce UTF-8

resolve(entry, { sandboxRoot, cacheDir?, transport?, limits? }) -> ResolveResult

ResolveResult =
  | { ok: true,  graph: Graph, pedigree: Pedigree }
  | { ok: false, diagnostics: Diagnostic[] }   // non-empty, ordered
```

`sandboxRoot` is **required**, and is `string | readonly string[]` as of v1.7 FR-004 (a bare string
is the one-element list; a reference is inside the sandbox when it is inside any granted root). There
is no default and none is inferred from the entry document's location (FR-022, held member-wise by
v1.7 FR-005) — a capability is granted, never ambient.

`cacheDir` is **conditionally required**: optional in the type, but resolution **throws** the moment
it reaches an `https://` reference without one — an exception, not a diagnostic. Missing it is
programmer error in the same sense a missing `sandboxRoot` is; the difference is only that it is
reachable data-dependently rather than at the door, so a caller who wraps only the up-front check
can still be surprised. Callers resolving anything that may reach a remote reference should supply
it unconditionally. A purely local chain neither needs nor should demand it,
and requiring it unconditionally would make every local caller declare a capability it cannot use.
The posture is the same as `sandboxRoot`'s — granted rather than ambient — enforced where it becomes
load-bearing rather than at the door.

## Behavioral contract

1. **Never throws for bad input.** Unreachable documents, cycles, pin mismatches, sandbox escapes
   are all diagnostics. Exceptions remain for programmer error — a missing `sandboxRoot`, or a
   missing `cacheDir` once resolution reaches a remote reference. Those two are the complete list.
2. **Total.** Every input terminates: cycles are detected, chain length is capped, fetches time out.
3. **Deterministic.** Same inputs and same cache state produce the same graph, the same pedigree
   order, and the same diagnostics in the same order (SC-009).
4. **Complete.** Independent failures are all reported from one attempt (FR-025), as v0.1 does
   within a document.
5. **No network when cached.** A chain whose documents were all fetched before resolves offline
   (FR-016).
6. **Nothing unverified enters the graph.** When a pin is present and does not match, the bytes are
   discarded, not merely flagged (FR-014).

## Bytes and text

`parse` taking bytes is what makes §4.2's UTF-8 mandate enforceable; `parseText` cannot, because
invalid sequences have already become replacement characters before it is called — verified, not
assumed. `parseText` documents this rather than implying otherwise (FR-003).

Given valid UTF-8, both produce identical trees, spans included (FR-004).

## Limits

| Option | Default | Refused with |
|---|---|---|
| `maxChainLength` | 32 | `chain-limit-exceeded` |
| `maxRedirects` | 5 | `too-many-redirects` |
| `requestTimeoutMs` | 10000 | `document-unreachable` |
| `maxBytes` | 8 MiB (from v0.1) | `size-limit-exceeded` |

Response size is enforced **during** streaming, not after: a hostile server advertising a small
body and sending an unbounded one must be cut off, not measured afterwards.

## Transport seam

`transport` is an injection point supplying recorded responses in tests (research D7). Its absence
means the real network. It exists so the suite stays hermetic, not as a general extension point.
