/**
 * The counted witness for "parse once, ask many" (v1.15 FR-004, FR-025) -- no public API.
 *
 * `parseCalls()` is how many times a format's parser has read a whole document in this process;
 * `tokenizeCalls()` is how many times the YAML writer has run `yaml`'s CST tokenizer over one, and
 * `parentWalkCalls()` how many times it has walked one to learn every node's parent. A
 * test takes the difference around the call it witnesses, so CLAUDE.md's rule holds: where the
 * work can be counted it is counted, not timed. Nothing outside `src/adapters/` and the tests
 * imports this file, and the package root exports neither function.
 */

let parses = 0;
let tokenizes = 0;
let parentWalks = 0;

export function countParse(): void {
  parses += 1;
}

export function countTokenize(): void {
  tokenizes += 1;
}

export function countParentWalk(): void {
  parentWalks += 1;
}

export function parentWalkCalls(): number {
  return parentWalks;
}

export function parseCalls(): number {
  return parses;
}

export function tokenizeCalls(): number {
  return tokenizes;
}
