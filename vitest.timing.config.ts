import { defineConfig } from "vitest/config";

// The wall-clock tests (tests/timing/), run by `pnpm test:timing` after the main suite: one file at a
// time, nothing else alongside, so a ratio of elapsed times measures the code and not the machine's load.
export default defineConfig({
  test: {
    include: ["tests/timing/**/*.test.ts"],
    watch: false,
    passWithNoTests: false,
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
