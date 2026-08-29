import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    watch: false,
    // Table-driven suites (the conformance corpus in particular) should never
    // reach out to the network — the corpus is fixtures-only and hermetic.
    passWithNoTests: false,
  },
});
