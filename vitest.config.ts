import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Wall-clock tests run serially, after this suite: vitest.timing.config.ts.
    exclude: ["**/node_modules/**", "tests/timing/**"],
    watch: false,
    // Table-driven suites (the conformance corpus in particular) should never
    // reach out to the network — the corpus is fixtures-only and hermetic.
    passWithNoTests: false,
  },
});
