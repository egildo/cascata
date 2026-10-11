/**
 * v1.14 FR-002, FR-003, FR-020 -- the `glob` grammar, a strict subset of the LSP `GlobPattern`.
 *
 * Written from the spec before `src/validate/glob.ts` existed. Every offset below is counted by hand, in code
 * points from 0 (so `a\b` has its backslash at 1, and a character above the BMP is one position, not two).
 * A refusal is reported at the *first* offending position in the pattern.
 */

import { describe, expect, it } from "vitest";
import { checkGlobPattern, type GlobCheck } from "../../src/validate/glob.js";

const accepted: readonly (readonly [string, string])[] = [
  ["a wildcard extension", "*.md"],
  ["a literal prefix, a double star, a wildcard", "content/**/*.md"],
  ["a single-character wildcard", "?.yaml"],
  ["a lone double star, the boundary", "**"],
  ["an absolute pattern: a leading slash is allowed", "/abs/*.md"],
  ["a leading dot-dot is allowed, as in a path", "../shared/*.md"],
  ["dot-dots are allowed while no wildcard has been seen", "a/../b/*.md"],
  ["only dot-dots", "../.."],
  ["three dots are an ordinary name", ".../x"],
  ["a single dot is an ordinary segment", "./*.md"],
  ["a bang that is not the first character", "a!b"],
  ["a bang after the leading slash is not the first character", "/!x"],
  ["a composed non-ASCII literal", "café/*.md"],
  ["a decomposed non-ASCII literal", "café/*.md"],
  ["CJK literals", "日本語/*.md"],
  ["a non-BMP literal before a wildcard", "\u{1F600}?.md"],
  ["a double star between literals", "a/**/b"],
  ["two double-star segments", "**/**"],
  ["a star beside a question mark", "a*?b"],
  ["a single character", "a"],
];

describe("v1.14 FR-002/FR-020 -- patterns the grammar accepts", () => {
  for (const [name, pattern] of accepted) {
    it(`accepts ${JSON.stringify(pattern)} (${name})`, () => {
      expect(checkGlobPattern(pattern)).toEqual({ ok: true });
    });
  }
});

/** [name, pattern, hand-counted code-point offset of the first offence, a fragment the message must contain]. */
const refused: readonly (readonly [string, string, number, string])[] = [
  // The empty pattern has its offence at 0, where its first segment would start.
  ["empty", "", 0, "empty"],
  // a=0 *=1 *=2: the run `**` starts at 1 and is not the whole segment.
  ["a double star at the end of a segment", "a**", 1, "**"],
  // *=0 *=1 b=2: the run starts at 0.
  ["a double star at the start of a segment", "**b", 0, "**"],
  // a=0 /=1 *=2 *=3 *=4: a run of three starts at 2.
  ["three stars", "a/***", 2, "**"],
  // a=0 ?=1 *=2 *=3: the run starts at 2.
  ["a double star after a question mark", "a?**", 2, "**"],
  ["a character class opens", "[ab].md", 0, "'['"],
  // a=0 ]=1
  ["a character class closes", "a]", 1, "']'"],
  ["a brace alternation opens", "{a,b}", 0, "'{'"],
  ["a brace closes", "a}", 1, "'}'"],
  // a=0 \=1 b=2
  ["a backslash", "a\\b", 1, "'\\'"],
  ["a leading bang", "!x", 0, "'!'"],
  // a=0 /=1 /=2: the empty segment is between the two slashes; the offence is the second slash.
  ["an empty segment", "a//b", 2, "empty segment"],
  // a=0 /=1: the slash that ends the pattern.
  ["a trailing slash", "a/", 1, "trailing"],
  // The slash alone is a trailing slash after nothing.
  ["a lone slash", "/", 0, "trailing"],
  // /=0 /=1: after the leading slash an empty segment follows.
  ["a double leading slash", "//a", 1, "empty segment"],
  // *=0 /=1 .=2 .=3 /=4 x=5: the `..` segment starts at 2.
  ["a dot-dot after a wildcard", "*/../x", 2, "'..'"],
  // *=0 *=1 /=2 .=3 .=4: starts at 3.
  ["a dot-dot after a double star", "**/..", 3, "'..'"],
  // *=0 /=1 x=2 /=3 .=4 .=5: a literal between does not undo the wildcard before.
  ["a dot-dot after a wildcard and a literal", "*/x/..", 4, "'..'"],
  // .=0 .=1 /=2 *=3 /=4 .=5 .=6 : the leading `..` is fine, the one after `*` is not.
  ["a leading dot-dot is fine, one after a wildcard is not", "../*/..", 5, "'..'"],
  // The first offence by position wins: `**` at 0 is found before `[` at 3.
  ["two offences: the earlier one is reported", "**b[", 0, "**"],
  // The non-BMP character is one code point (one position), though two UTF-16 units: [ is at 1, not 2.
  ["a refusal after a non-BMP character is counted in code points", "\u{1F600}[", 1, "'['"],
  // a=0 b=1 c=2 `\u{1F600}`=3 {=4
  ["a refusal after two BMP characters and a non-BMP one", "abc\u{1F600}{", 4, "'{'"],
];

describe("v1.14 FR-002/FR-004/FR-020 -- patterns the grammar refuses, each at its position and naming its offence", () => {
  for (const [name, pattern, offset, fragment] of refused) {
    it(`refuses ${JSON.stringify(pattern)} (${name}) at offset ${offset}`, () => {
      const result: GlobCheck = checkGlobPattern(pattern);
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.offset).toBe(offset);
      expect(result.message).toContain(fragment);
      expect(result.message).toContain(`offset ${offset}`);
    });
  }
});

describe("v1.14 FR-003/FR-020 -- validation is linear: one step per code point, counted not timed", () => {
  it("counts exactly one step per code point on an accepted pattern", () => {
    const counter = { steps: 0 };
    expect(checkGlobPattern("content/**/*.md", counter)).toEqual({ ok: true });
    expect(counter.steps).toBe("content/**/*.md".length); // all 15 characters are BMP
  });

  it("counts a non-BMP character as one step, not two", () => {
    const counter = { steps: 0 };
    checkGlobPattern("\u{1F600}\u{1F600}?", counter);
    expect(counter.steps).toBe(3);
  });

  it("`*` x 10,000 is refused after at most one step per character (no backtracking over the run)", () => {
    const counter = { steps: 0 };
    const result = checkGlobPattern("*".repeat(10_000), counter);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.offset).toBe(0);
    }
    expect(counter.steps).toBeLessThanOrEqual(10_000);
  });

  it("`**/` x 5,000 is refused (trailing slash) after exactly one step per character", () => {
    const pattern = "**/".repeat(5_000);
    const counter = { steps: 0 };
    const result = checkGlobPattern(pattern, counter);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The last slash is the trailing one: 3 * 5000 - 1.
      expect(result.offset).toBe(14_999);
    }
    expect(counter.steps).toBe(15_000);
  });

  it("`**/` x 5,000 followed by a name is accepted in exactly one step per character", () => {
    const pattern = `${"**/".repeat(5_000)}x`;
    const counter = { steps: 0 };
    expect(checkGlobPattern(pattern, counter)).toEqual({ ok: true });
    expect(counter.steps).toBe(15_001);
  });

  it("`*/` x 5,000 then `x` accepted: many wildcard segments cost nothing extra", () => {
    const counter = { steps: 0 };
    expect(checkGlobPattern(`${"*/".repeat(5_000)}x`, counter)).toEqual({ ok: true });
    expect(counter.steps).toBe(10_001);
  });

  it("a pattern at the document size cap (8 MiB) is accepted in exactly one step per character", () => {
    const length = 8 * 1024 * 1024;
    const counter = { steps: 0 };
    expect(checkGlobPattern("a".repeat(length), counter)).toEqual({ ok: true });
    expect(counter.steps).toBe(length);
  });

  it("a refusal late in a long pattern still costs one step per character up to it", () => {
    const counter = { steps: 0 };
    const result = checkGlobPattern(`${"a/".repeat(10_000)}[`, counter);
    expect(result.ok).toBe(false);
    expect(counter.steps).toBe(20_001);
  });
});
