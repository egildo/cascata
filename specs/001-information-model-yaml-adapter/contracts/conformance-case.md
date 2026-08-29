# Contract: Conformance Case Format

**Implements**: FR-021 – FR-024 | **Cites**: `SPEC.md` §12 | **Shape borrowed from**: `toml-test`

A case is **data**. Adding one requires editing no code (FR-024) — that is the property that lets
this corpus outlive the YAML adapter and serve the JSON and TOML adapters unchanged (research D8).

## Fields

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Stable identifier, printed on failure |
| `cites` | yes | The `SPEC.md` section this case is the oracle for — Principle I |
| `format` | yes | Which adapter reads `input`; selects the adapter at run time |
| `input` | yes | The document text |
| `expect` | yes | Exactly one of `tree` or `diagnostics` |

## Expecting acceptance

`expect.tree` is the model the input must produce, written as data. Spans are asserted **selectively**
— a case names the nodes whose positions matter to it, by path, rather than restating every offset in
the document. Exhaustive span assertions would make every case unreadable and every whitespace edit a
mass failure; selective ones keep each case about the thing it is testing.

Equality uses the model's single definition (data-model.md), so a case never has to say whether
mapping order matters. It does not.

## Expecting refusal

`expect.diagnostics` is a list of `{ code, line, column }`, compared as a **set** — order of discovery
is not contractual, but **completeness is**: a case listing two diagnostics fails if the reader
produces one, three, or two different ones.

Positions are compared, not merely codes (SC-004). A diagnostic with the right code pointing at the
wrong line is a failure, since position precision is the entire point of Principle III.

## Runner contract

1. Executes **every** case; one failure never prevents another from running.
2. Reports pass or fail **per named case**; a failure prints the case name, what was expected, and
   what was produced.
3. Selects the adapter from `format` alone, and contains no format-specific logic itself.
4. Discovers cases from the corpus directory — adding a file is sufficient to add a case.
5. Fails loudly on a case it cannot interpret, rather than skipping it. A silently skipped case is
   worse than no case, because it reads as coverage.

## Coverage obligation

Every portability-floor decision in §4.2 carries **at least one accepting and one refusing case**
(FR-023, SC-002). The corpus is the oracle for §12's citations, so a standard cited without a case
backing it is an unbacked claim under Principle V.
