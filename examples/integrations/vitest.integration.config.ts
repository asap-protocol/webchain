import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
    exclude: ["**/node_modules/**"],
    fileParallelism: false,
    pool: "forks",
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
});
