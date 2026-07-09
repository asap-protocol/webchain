import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /** Only unit tests under `src/` — do not scan `node_modules` (e.g. symlinked `@webchain/companion`). */
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.integration.test.ts",
        "src/index.ts",
        "src/test-support/**",
      ],
      thresholds: { lines: 90 },
    },
  },
});
