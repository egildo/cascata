# Milestone report: the launching schema (012)

**What landed.** `ResolveOptions.schema?: string`, and so `LoadOptions.schema`. In `resolveEntry`, where an entry naming no `$schema` used to return a single-document graph unconditionally, it now does so only when the option is absent; when present, a `Reference` is minted from the option's text (`kind: "schema"`, `authority: "config-authored"`, a zero-width span at the entry document's origin) and handed to `walkAdoptsChain` exactly where an authored `$schema` would have gone. `generateTypes()` passes `undefined` explicitly. One optional field, one branch, one `createReference` call.

**Conformance.** Four resolve-conformance cases (`launching-schema-used`, `-ignored`, `-tilde`, `-unreachable`) with hand-derived hashes, and five unit tests through `load()` and `generateTypes()` with the in-memory host. Written before the code; the two that exercise the new branch (FR-001 used, FR-004 unreachable) were watched go red under a `SABOTAGE` that disabled the branch, then green after restore. `grep -rn SABOTAGE src/ tests/` is empty. Full suite: 84 files, 1507 tests, green; `tsc --noEmit` clean.

**Documents.** `SPEC.md` Article VI gains a law; §15 gains the entry; §14's exporter moves from v1.3 to v1.4, on the JSON adapter's own precedent. `README.md` gains the milestone row and a paragraph under the host seam. `package.json` 1.2.0 → 1.3.0.

## Found, recorded rather than smoothed

- **The corpus format could not cite its own present.** `tests/corpus/resolve-case.ts` accepted `cites` only in the form `v0.2 FR-n`. Widened to `v(0.2|1.3) FR-n`. Nothing had been added to the resolve corpus since v0.2, which is itself a finding: every later milestone's resolution behaviour (delegation, the host seam, remote pinning) is pinned in unit tests, not conformance cases.
- **Two design choices an implementer had to make, both stated in the option's doc comment so they are found by reading.** The option's text is read relative to the entry document's directory, not the working directory, because "as if the entry had written it" was the one sentence that needed no second rule. And the option counts as config-authored, so it is sandbox-exempt and `~/`-expanding; the alternative, schema-authored, would have refused the very use it was built for (a venue schema above the document's directory, outside a sandbox rooted there).
- **The milestone folder is one `spec.md` and this report**, not the flow's seven files. Complexity Tracking is in `spec.md`. If the constitution wants the seven files for every addition regardless of size, that is a governance question; this report flags it and does not decide it.

## Not done, deliberately

- **Not merged to `main`, not published.** Both are Egildo's acts. Publishing as `@egildo/cascata` on GitHub Packages, which BelType's plan assumes, also means renaming the package, and the rename is a decision this milestone does not make.
- **No default.** The option has none, and nothing is inferred from the entry's location. v0.2 FR-022's posture, kept on purpose.

## Questions for Egildo

1. The version. This shipped as **1.3.0** and moved the exporter to v1.4, following the JSON adapter's precedent (an addition takes the next minor and the roadmap renumbers). If the intent was a patch release, the two edits are `package.json` and §14's two lines.
2. The package name for GitHub Packages: `@egildo/cascata`, or keep `cascata` and publish elsewhere.
3. Whether a resolve-conformance case should also carry the option through `load()` (value-level assertions), which the corpus format cannot express today and the unit test covers instead.
