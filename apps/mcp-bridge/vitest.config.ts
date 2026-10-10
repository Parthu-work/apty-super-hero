import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // `npm run test:coverage`: package-wide thresholds are a ratchet, set
    // one point below the measured value. They may only go up
    // (docs/development/coverage.md).
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
      thresholds: {
        statements: 20,
        branches: 17,
        functions: 23,
        lines: 20,
      },
    },
  },
});
