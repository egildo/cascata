# Phase 0 Research: Constraint Checker & Whole-Chain Validation

**Date**: 2026-08-31 | **Plan**: [plan.md](./plan.md)

Conducted under constitution v1.2.1's **probe gate**: a conclusion that existing code or a dependency
handles something "for free" must have been exercised against non-ASCII, boundary, and adversarial
input before it is written down. Unlike v0.3, this milestone's probes found two genuine defects in
what would otherwise have been assumed — see D2 and D4 below — which is exactly what the gate exists
to catch.

## Probe results

| Question | Probe | Result |
|---|---|---|
| Does `[...str].length` count code points correctly? | `"café"` (precomposed, U+00E9), `"café"` (combining, `e` + U+0301), `""`, `"\u{1F600}"` (😀, astral, one code point / two UTF-16 units), a lone surrogate `"\uD800"` | **Yes**, on every case. Precomposed=4, combining=5 (no normalization, matching §4.2), empty=0, astral emoji=1 (not 2 — `.length` alone would have been wrong), lone surrogate=1 without throwing. Confirms `[...str].length` (or `Array.from`) is the free, correct mechanism for `minLength`/`maxLength` |
| Does `new URL()` restrict scheme? | non-ASCII host (`https://例え.jp/パス`), empty string, a bare non-URL string, `javascript:alert(1)`, `file:///etc/passwd`, `data:text/html,...` | **No.** Non-ASCII succeeds (IDNA-encoded). Empty string and a bare string both throw (a real boundary refusal, not silently permissive). But `javascript:`, `file:`, and `data:` all parse as valid WHATWG URLs with no scheme restriction — §7 cites the *Standard*, not a scheme policy, so a schema demanding `type: url` accepts any of these as syntactically valid. Recorded as a finding, not a defect: this milestone validates a value's **shape**, not what it will be used for |
| Can a model string contain an embedded NUL (U+0000)? | `s: "a\u0000b"` parsed through the real `yaml` adapter | **Yes** — `[97, 0, 98]`, three code points, no rejection anywhere in the pipeline (§4.2 has no rule against it). This means `type: path`'s "POSIX pathname semantics" needs at least one real check: POSIX pathnames are null-terminated strings, so an embedded NUL is not a valid pathname, and this is not free — it must be checked explicitly |
| Is `pattern`'s ReDoS exposure real, or a hypothetical risk? | `/^(a+)+$/` (classic catastrophic backtracking) against `"a".repeat(n) + "!"` for `n = 10, 15, 20, 24` | **Real**, measured: 0ms / 1ms / 7ms / 109ms — visibly exponential, not linear. Extrapolating, `n` in the 40s would run for minutes. This is not a hypothetical; §11's "schemas are untrusted" is not academic here |
| Do bigint/number relational comparisons (`<`,`<=`,`>`,`>=`) lose precision at large magnitudes? | `9007199254740991n` (MAX_SAFE_INTEGER) vs `9007199254740991` (equal, boundary); `9007199254740993n` (MAX_SAFE_INTEGER+2, not exactly representable as `number`) vs `9007199254740992` (2^53, the nearest float) | **No.** `huge > boundFloat` correctly returns `true` even though `Number(huge) === boundFloat` (casting first would have silently lost the comparison). ECMA-262's Abstract Relational Comparison compares BigInt/Number pairs by exact mathematical value, not by casting either side first. Also confirmed: mixed **arithmetic** (`5n + 2`) throws `TypeError`; relational comparison never does. `NaN` and `±Infinity` bounds behave as expected (`5n < NaN` is `false`; `5n < Infinity` is `true`) |
| Does `picomatch` behave sanely on non-ASCII, boundary, and adversarial glob input? | `café/*.css` vs `café/style.css`; `*.pdf` vs `文書.pdf`; empty pattern; empty input; `../../etc/passwd` as both pattern and value; `**/../**`; a 50-star pattern against a 200-char value; a 4×10-branch brace-expansion pattern; an embedded-NUL value | **Mostly free, one real defect.** Non-ASCII matches correctly. Path-traversal-shaped strings match as ordinary glob syntax with no special handling (expected — this is value-shape validation, not filesystem access; sandboxing is v0.6's concern). The 50-star and brace-expansion adversarial patterns both completed in 0ms — no blowup found at this scale (not proof of immunity, but no smoking gun either). An embedded-NUL *value* matched without throwing (glob syntax itself has no NUL rule, unlike POSIX path syntax). **The real defect: `picomatch("")` throws** `"Expected pattern to be a non-empty string"` — an empty `glob:` demand value is not handled "for free" and must be guarded before picomatch is called, or it becomes an uncaught exception instead of a diagnostic |

## Decisions

### D1 — Closed-vocabulary reading mirrors `readKeysVocabulary`, but reads the field that function ignores

**Decision**: `src/validate/vocabulary.ts` reads `keys.<name>.demand` the same way `src/merge/strategy.ts`'s
`readKeysVocabulary` reads `provide`/`cascade` — same absent/empty/non-mapping-is-nothing posture
(v0.3 FR-003's rule) — but for the field that function's own module doc says by name it does not
read. `seal`, `final`, `delegate` stay unread by *this* module too (FR-002, unchanged).

**Rationale**: `demand` is genuinely new vocabulary a schema author writes; the existing function is
already the precedent for "read one field, ignore the rest of `keys.<name>`'s shape," and diverging
from its style for no reason would be two different reading conventions for the same section.

**Alternatives considered**: extending `readKeysVocabulary` itself to also read `demand` (rejected —
that function lives in `src/merge/`, and `demand` is validation's concern, not merge's; merge must
keep ignoring it per v0.3 FR-002, so widening its reader would blur that line for no gain).

### D2 — `type: url` and `format:` are not the same spelling, this milestone; the overlap is flagged, not resolved

**Decision**: `type: url | path | glob` is the only mechanism this milestone implements for the
built-in refinements (FR-011). `format` stays in §9's closed vocabulary — refused as **unimplemented**
if a schema writes it (mirroring `accept`/`types:`'s FR-011a/b treatment, and v0.3's precedent for
`merge-by-key`), not read as a second spelling for the same thing and not silently ignored.

**Rationale**: FR-011's replacement text (this milestone's spec closure) commits only to `type:`
carrying `url`/`path`/`glob`; it says nothing about `format:`. Reading `format: url` as accepted too
would be inventing a second keyword-spelling for one meaning with no citation authorizing it —
exactly what Principle VI forbids ("every semantic distinction costs a distinct keyword," and its
converse: no keyword may quietly acquire a second one). Reading `format:` as *silently accepted with
no effect* would violate Principle VI's other half (deny by default — an unrecognized-but-listed
keyword is refused, not waved through). Refusing it as unimplemented is the same posture already
established for `accept` and `types:` in this same spec closure, and needs no new mechanism.

**Flagged in the final report as a `SPEC.md` governance question, not fixed here (Principle I)**: §7
glosses `url`/`path`/`glob` as "JSON Schema `format` in spirit," and §9 separately lists `format`
among `demand`'s JSON-Schema-named leaf keywords. Whether `SPEC.md` means these to be the same
mechanism under two names, or two genuinely distinct keywords (`format` reserved for a JSON-Schema
`format`-registry vocabulary — `date-time`, `email`, `ipv4`, etc. — that §7/§9 never actually name),
is unresolved in the document itself. This implementer is not the right authority to settle it.

**Alternatives considered**: accepting `format: url`/`format: path`/`format: glob` as synonyms
(rejected — invents a second spelling with no citation); silently ignoring `format` like
`seal`/`final`/`delegate` (rejected — those are *unwritten-yet* v0.6/v0.7 vocabulary by name; `format`
is written into §9's *v1* vocabulary list today, so silence would be Principle VI's deny-by-default
failing exactly where it is supposed to hold firmest).

**Settled, after this milestone shipped** (`SPEC.md` §15, "`format` vs `type: url`"): the owner
dropped `format` from §9's vocabulary entirely. Everything constraining a leaf's shape is a type —
`url`/`path`/`glob` stay built-in types, and any future `email`/`date-time` arrive the same way, never
as a second keyword — because types cascade and narrow and a `format` keyword would not have, which
is the argument this entry's own "Flagged" paragraph gestured at without being the right authority to
conclude it. `format` is no longer in the closed list at all: a schema writing it now gets
`unknown-demand-keyword`, not `unimplemented-demand-keyword` — it is a typo like any other, not an
early use of real vocabulary. This entry's decision, rationale, and alternatives above are left as
written: the question was escalated correctly, and the record of that is worth keeping intact.

### D3 — `pattern`'s ReDoS exposure is accepted explicitly, not mitigated this milestone

**Decision**: No pattern-length cap, no catastrophic-shape denylist, no worker-based timeout. The
exposure is accepted and documented, with the probe's measured evidence on the record.

**Rationale**: The brief's own menu named three choices — cap pattern length, accept the exposure, or
defer. A pattern-*length* cap does not actually mitigate anything: the probe's catastrophic pattern
(`/^(a+)+$/`) is seven characters; the blowup is a function of the **value being matched**, not the
pattern's source length, so capping the pattern's length would burn effort on a control that does not
address the measured risk. A denylist of "known bad shapes" is a losing arms race (ReDoS patterns are
not enumerable) and is exactly the kind of heuristic guessing §8.1's razor rejects in a different
context ("systems that guess accumulate heuristics and CVEs"). A worker-based timeout is real
mitigation but needs infrastructure (a worker thread, a timeout/cancellation protocol) this milestone
was never scoped to build, and would not be "a few hundred lines," which the spec's own Assumptions
section names as the budget for the whole constraint checker.

**Cost accepted, stated plainly**: a schema (which §11 already treats as untrusted, remote-fetchable
input) can carry a `pattern` that hangs validation indefinitely against a sufficiently long — but
still document-size-capped — config value. This is a real, load-bearing limitation, not a
theoretical one (see the probe's measured 109ms at only 24 characters). It is recorded here rather
than silently shipped, per CLAUDE.md's instruction to report ambiguities and known gaps unsoftened.

**Alternatives considered**: capping the **value's** length before attempting a `pattern` match
(rejected for this milestone — it would silently stop enforcing `pattern` on legitimately long
strings, which is a semantic change spec.md's FRs do not authorize, and picking a threshold with no
citation would be inventing policy exactly where Principle V asks for one).

### D4 — `picomatch` is added as a runtime dependency; `pnpm add` is not silent

**Decision**: `picomatch@^4.0.7` (runtime) and `@types/picomatch@^4.0.3` (dev, no bundled types
shipped) are added to `package.json`. This is the one new runtime dependency this milestone
introduces, and it is on the constitution's own allow-list ("Technology & Security Constraints":
"`yaml` (eemeli's), `picomatch`, and Node's built-in WHATWG `URL`") — so no constitution amendment is
needed, but CLAUDE.md still asks for an explicit line, which this is it.

**Rationale**: §7 does not leave `glob` open to implementer choice the way `url`/`path` are — it names
the library outright: "`glob` → gitignore pattern syntax (implemented via `picomatch`), cited by
name." Writing a hand-rolled gitignore-syntax matcher instead would both duplicate real, tested work
and drift from the cited standard the moment gitignore's own edge cases (negation, `**`, character
classes) were gotten slightly wrong.

**Empty-pattern guard is load-bearing (the probe's one real defect)**: `picomatch("")` throws rather
than returning a matcher, so `src/validate/constraints.ts`'s `glob` check must special-case an empty
`Node`-string value as a `malformed-constraint-shape`-style refusal *before* calling `picomatch`, the
same way a wrong-shape `min`/`enum` value already needs FR-007's treatment — not let the exception
propagate as an uncaught throw from inside validation.

**Alternatives considered**: hand-rolling glob matching (rejected — undercuts §7's explicit citation
and the "leverage: software we don't write" posture §12 states plainly); deferring `glob` support and
refusing it as unimplemented (rejected — §7 and §9 both list it as v1, present-tense vocabulary, and
FR-011 (already closed, this milestone) commits to `url`/`path`/`glob` together as a set, not two-
thirds of one).

### D5 — `int`/`float` comparison under `min`/`max` uses native relational operators directly, never a cast

**Decision**: `min`/`max` (and any other numeric-range check) compares the raw `bigint` (`int`) or
`number` (`float`) values with JS's native `<`, `<=`, `>`, `>=` operators, whichever kinds appear on
either side of the comparison. Never `Number(bigintValue)` first, and never mixed arithmetic
(`value - bound`) to derive a sign.

**Rationale**: The probe found relational comparison exact at magnitudes where a naive
`Number()`-cast-then-compare would have silently been wrong (`9007199254740993n > 9007199254740992`
correctly `true`, even though `Number(9007199254740993n) === 9007199254740992`). ECMA-262's Abstract
Relational Comparison algorithm is specified to compare BigInt/Number operands by exact mathematical
value; this is a genuine "handles it for free" case, but only after the probe ruled out the more
obvious, wrong implementation (casting first) that this project's own history (v0.1's byte-offset/
code-point mixup) warns is exactly the failure shape to expect from an unprobed assumption.

**Alternatives considered**: normalizing both sides to `bigint` via `BigInt(Math.trunc(...))`
(rejected — lossy and wrong for a genuinely fractional float bound); normalizing both to `number`
(rejected — the probe's own counterexample is exactly why, an exact large `int` would silently
round).

## Deferred, with reasons

- **`types:` and `accept`** — refused as unimplemented, naming v0.5, per this milestone's own spec
  closure (FR-011a, FR-011b). Not built here; no vocabulary to design against yet.
- **`seal`, `final`, `delegate`** — continue to be ignored (unwritten v0.6/v0.7 vocabulary), unchanged
  from v0.3's FR-002 posture.
- **Static subsumption** (proving a weakening with no value present) — v1.x per §5.4; this milestone
  discharges FR-033 dynamically only.
- **A worker-based `pattern` timeout** — named in D3 as the real mitigation for the ReDoS exposure
  this milestone accepts; out of scope for v0.4's budget.
- **A command surface** (`tool certify`) — v0.4 research per spec.md's own Assumptions section:
  `certify` stays a library function this milestone, on the same reasoning v0.3's D3 gave for `why`.
