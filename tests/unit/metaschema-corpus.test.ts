/**
 * v0.7 part 2 (008) FR-017, FR-018 / SC-002 — **the corpus is the
 * oracle.** Six milestones of hand-written schema fixtures were never held
 * to a meta-schema; running them against one is what says whether the
 * meta-schema describes the language *as built* or only *as imagined*.
 *
 * **FR-017's wording does not survive contact with the corpus, and the
 * correction is recorded rather than quietly applied.** It says "every
 * schema document in the conformance corpus MUST validate against the
 * meta-schema". Many corpus schemas are *deliberately malformed* — they
 * exist so the pipeline can be seen refusing them — and a meta-schema that
 * passed those would be the broken one. The obligation that can be
 * satisfied, and the one this file discharges, is:
 *
 *   1. every schema the **pipeline accepts** must pass the meta-schema,
 *      except where a divergence is named and explained below; and
 *   2. every schema the pipeline **refuses** for a vocabulary error must
 *      also be refused by the meta-schema (FR-018's verdict agreement).
 *
 * **FR-018 is about verdicts, not codes** (research.md W-4). The
 * hand-written checks produce purpose-built diagnostics — `unknown-cascade-
 * strategy`, `unimplemented-cascade-strategy`, `delegate-value-
 * unimplemented`, `unknown-authority-member` — where the meta-schema
 * yields a generic `enum-violated` or `seal-violation`. That is the
 * hand-written check being *better*, not the meta-schema being wrong, and
 * each pair below is a candidate for teaching the meta-schema a `pattern`
 * or `enum` that recovers the better message.
 *
 * The two tables are asserted in **both directions**: a schema that starts
 * failing breaks the sweep, and a divergence that gets fixed breaks the
 * table. Neither can rot silently.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { metaValidate, parse } from "../../src/index.js";
import { createNodeHost, nodeMetaSchemaLocation } from "../../src/host/node.js";
import { createOrigin } from "../../src/model/span.js";

const CASES_DIR = join(__dirname, "..", "corpus", "cases");
const META_LOCATION = nodeMetaSchemaLocation();

/**
 * Every top-level section name a schema document can carry (§9). A
 * document declaring at least one of them, and **not** carrying
 * `$schema`, is a schema: `$schema` is precisely the config-side pointer
 * (§9), so it is what distinguishes a config that happens to declare an
 * inert `keys:`/`types:`/`authority:` section — the corpus has several,
 * on purpose — from a real schema.
 */
const SECTIONS: ReadonlySet<string> = new Set(["keys", "types", "authority", "directives"]);

function yamlFilesUnder(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      out.push(...yamlFilesUnder(path));
    } else if (path.endsWith(".yaml") || path.endsWith(".yml")) {
      out.push(path);
    }
  }
  return out;
}

function schemaDocuments(): string[] {
  const out: string[] = [];
  for (const file of yamlFilesUnder(CASES_DIR).sort()) {
    const parsed = parse(new Uint8Array(readFileSync(file)), { origin: createOrigin(file, file) });
    if (!parsed.ok || parsed.tree.type !== "mapping") {
      continue; // a deliberately unparseable fixture is v0.1's business, not this file's
    }
    const keys = [...parsed.tree.entries.keys()];
    if (keys.includes("$schema") || !keys.some((key) => SECTIONS.has(key))) {
      continue;
    }
    out.push(file);
  }
  return out;
}

/**
 * Every corpus schema the meta-schema refuses, with what it draws and why.
 *
 * `pipeline: "REFUSE"` — the two agree on the verdict and differ only on
 * the code (research.md W-4). The fixture is deliberately malformed and
 * both authorities say so.
 *
 * `pipeline: "ACCEPT"` — a genuine **divergence**, and each of the four is
 * traceable to a hole in the implementation rather than to a sloppy
 * fixture. None of these fixtures is touched: each states something true
 * about the pipeline, and the meta-schema disagreeing with the pipeline is
 * the finding this milestone exists to produce.
 */
const REFUSED: readonly { readonly fixture: string; readonly pipeline: "ACCEPT" | "REFUSE"; readonly metaCodes: readonly string[]; readonly why: string }[] = [
  {
    fixture: "authority/unknown-authority-member/root.yaml",
    pipeline: "REFUSE",
    metaCodes: ["seal-violation"],
    why: "Verdicts agree. Hand-written: `unknown-authority-member`, which names the section. The meta-schema reaches the same answer through `authority`'s `seal: closed`, generically.",
  },
  {
    fixture: "directives/unknown-directive-key/schema.yaml",
    pipeline: "REFUSE",
    metaCodes: ["seal-violation"],
    why: "Verdicts agree. Hand-written: `unknown-directive-key` (v0.7 part 2's own). The meta-schema's `directives` is `seal: closed` over the six reserved names.",
  },
  {
    fixture: "merge-fold/inert-vocabulary/keys-not-a-mapping/schema.yaml",
    pipeline: "ACCEPT",
    metaCodes: ["type-mismatch"],
    why: "DIVERGENCE. `keys: not-a-mapping-value`. Every section reader in this codebase treats a non-mapping section as 'nothing to read, never an error' — a posture documented since v0.3. The meta-schema says a `keys:` section is a mapping and refuses. The meta-schema is right and the posture is a hole; changing it would be a governance decision, not an implementer's.",
  },
  {
    fixture: "merge-fold/inert-vocabulary/vocabulary-ignored/schema.yaml",
    pipeline: "ACCEPT",
    metaCodes: ["seal-violation"],
    why: "DIVERGENCE. The fixture carries a **per-key** `seal: closed` — the pre-v0.7 spelling, from before `seal` moved into the `demand` vocabulary (§9/§15, v0.7 part 1). Nothing in the implementation closes a top-level key declaration's vocabulary, so the stale keyword is silently inert. The meta-schema's `keyDecl` is `seal: closed` over {demand, provide, cascade, final, delegate} and is the first thing in six milestones to notice.",
  },
  {
    fixture: "merge-policy/cross-category/schema.yaml",
    pipeline: "REFUSE",
    metaCodes: ["enum-violated"],
    why: "Verdicts agree. Hand-written: `unknown-cascade-strategy`, which tells the author their strategy does not exist. The meta-schema: `enum-violated` against [replace, append].",
  },
  {
    fixture: "merge-policy/reserved/schema.yaml",
    pipeline: "REFUSE",
    metaCodes: ["enum-violated"],
    why: "Verdicts agree, and this is the sharpest code divergence of the fourteen. Hand-written: `unimplemented-cascade-strategy` — `merge-by-key` is *reserved by §5.3*, so an author writing it is early, not wrong, and the code says so. The meta-schema flattens that to `enum-violated`, losing the distinction v0.3 built two codes to preserve.",
  },
  {
    fixture: "merge-policy/unknown/bad-string/schema.yaml",
    pipeline: "REFUSE",
    metaCodes: ["enum-violated"],
    why: "Verdicts agree; `unknown-cascade-strategy` versus `enum-violated`.",
  },
  {
    fixture: "merge-policy/unknown/non-string/schema.yaml",
    pipeline: "REFUSE",
    metaCodes: ["enum-violated", "type-mismatch"],
    why: "Verdicts agree. The meta-schema produces two diagnostics for one mistake (a non-string `cascade` fails both `type: string` and the `enum`), where the hand-written check produces one. Worth noting rather than fixing: §5.1's demands compose by intersection and both genuinely fail.",
  },
  {
    fixture: "validate-delegation/delegate-value-unimplemented/schema.yaml",
    pipeline: "REFUSE",
    metaCodes: ["enum-violated"],
    why: "Verdicts agree. Hand-written: `delegate-value-unimplemented`, which tells the author §8.4's future doors exist. The meta-schema: `enum-violated` against [allow].",
  },
  {
    fixture: "validate-types/non-mapping-section/schema.yaml",
    pipeline: "ACCEPT",
    metaCodes: ["type-mismatch"],
    why: "DIVERGENCE, the twin of keys-not-a-mapping: `types: oops`. Same posture, same hole, same verdict from the meta-schema.",
  },
  {
    fixture: "validate-vocabulary/collect-all/schema.yaml",
    pipeline: "REFUSE",
    metaCodes: ["seal-violation", "type-mismatch"],
    why: "Verdicts agree. Hand-written: `unknown-demand-keyword` + `malformed-demand-value` + `unknown-type-name`. The meta-schema catches the first two shapes and cannot see the third at all — `unknown-type-name` is name *resolution*, which is relational and outside what a meta-schema can express (research.md W-3).",
  },
  {
    fixture: "validate-vocabulary/inert-vocabulary/schema.yaml",
    pipeline: "ACCEPT",
    metaCodes: ["seal-violation"],
    why: "DIVERGENCE, the twin of merge-fold/inert-vocabulary: a stale per-key `seal: closed`, inert because no hand-written check closes a key declaration's vocabulary.",
  },
  {
    fixture: "validate-vocabulary/malformed-value/schema.yaml",
    pipeline: "REFUSE",
    metaCodes: ["type-mismatch"],
    why: "Verdicts agree. Hand-written: `malformed-demand-value`, three of them. The meta-schema: three `type-mismatch`es, at the same three positions.",
  },
  {
    fixture: "validate-vocabulary/unknown-keyword/schema.yaml",
    pipeline: "REFUSE",
    metaCodes: ["seal-violation"],
    why: "Verdicts agree. Hand-written: `unknown-demand-keyword`. The meta-schema: `seal-violation` from `demand`'s own `seal: closed` — the same closed vocabulary, said twice in two languages, which is what self-hosting looks like when it works.",
  },
  {
    fixture: "values/values-key-declaration-refused/schema.yaml",
    pipeline: "REFUSE",
    metaCodes: ["seal-violation"],
    why: "Verdicts agree. `values: { demand: {...} }` is the key-declaration shape the first v0.7 implementation took (SPEC.md §9/§15, corrected). Hand-written: `unknown-demand-keyword`, since `demand` is not itself a demand keyword. The meta-schema: `seal-violation`, because `values`'s own demand type is `seal: closed` and `demand` is not among its keywords.",
  },
];

describe("v0.7 part 2 FR-017 / SC-002 — every corpus schema, against the meta-schema", () => {
  it("the sweep matches the recorded table exactly, in both directions", async () => {
    const host = createNodeHost();
    const files = schemaDocuments();
    expect(files.length, "the corpus should hold well over a hundred schema documents").toBeGreaterThan(150);

    const expected = new Map(REFUSED.map((row) => [row.fixture, row]));
    const unexpectedFailures: string[] = [];
    const unexpectedPasses: string[] = [];
    const wrongCodes: string[] = [];
    let passing = 0;

    for (const file of files) {
      const fixture = relative(CASES_DIR, file).split("\\").join("/");
      const result = await metaValidate({ host, subject: file, metaSchema: META_LOCATION });
      const row = expected.get(fixture);
      if (result.ok) {
        passing += 1;
        if (row !== undefined) unexpectedPasses.push(fixture);
        continue;
      }
      const codes = [...new Set(result.diagnostics.map((d) => d.code))].sort();
      if (row === undefined) {
        unexpectedFailures.push(`${fixture} :: ${codes.join(",")}`);
        continue;
      }
      const recorded = [...row.metaCodes].sort();
      if (JSON.stringify(codes) !== JSON.stringify(recorded)) {
        wrongCodes.push(`${fixture} :: recorded ${recorded.join(",")}, got ${codes.join(",")}`);
      }
    }

    expect(unexpectedFailures, "a corpus schema started failing the meta-schema — triage it, do not add it to the table without a reason").toEqual([]);
    expect(unexpectedPasses, "a recorded divergence went away — delete its row and say why in the report").toEqual([]);
    expect(wrongCodes).toEqual([]);
    expect(passing).toBe(files.length - REFUSED.length);
  });
});

describe("v0.7 part 2 FR-018 — the verdicts agree; the codes are where the hand-written checks are better", () => {
  it("every fixture the meta-schema refuses is one the pipeline also refuses, except the four recorded divergences", async () => {
    const host = createNodeHost();
    const disagreements: string[] = [];
    for (const row of REFUSED) {
      const subject = join(CASES_DIR, row.fixture);
      const meta = await metaValidate({ host, subject, metaSchema: META_LOCATION });
      expect(meta.ok, `${row.fixture} is in the table but the meta-schema accepts it`).toBe(false);

      // The pipeline's own verdict, from the fixture's own case directory.
      const configPath = join(dirname(subject), "config.yaml");
      const { load } = await import("../../src/index.js");
      const pipeline = await load(configPath, { host, sandboxRoot: dirname(subject) });
      const observed = pipeline.ok ? "ACCEPT" : "REFUSE";
      if (observed !== row.pipeline) {
        disagreements.push(`${row.fixture}: table says pipeline ${row.pipeline}, observed ${observed}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("exactly four divergences, and every one is the meta-schema being STRICTER than the pipeline", () => {
    const divergences = REFUSED.filter((row) => row.pipeline === "ACCEPT");
    expect(divergences.map((row) => row.fixture)).toEqual([
      "merge-fold/inert-vocabulary/keys-not-a-mapping/schema.yaml",
      "merge-fold/inert-vocabulary/vocabulary-ignored/schema.yaml",
      "validate-types/non-mapping-section/schema.yaml",
      "validate-vocabulary/inert-vocabulary/schema.yaml",
    ]);
    // Two holes, two fixtures each: a non-mapping top-level section is read
    // as "nothing", and a top-level key declaration's vocabulary is not
    // closed. Both are the implementation being laxer than §9, not the
    // meta-schema being wrong — see the milestone report.
    for (const row of divergences) {
      expect(row.why.startsWith("DIVERGENCE")).toBe(true);
    }
  });
});
