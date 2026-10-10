import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",
    silent: true,
    environment: "jsdom",
    exclude: ["**/node_modules/**", "**/dist/**"],
    // `npm run test:coverage`: package-wide thresholds are a ratchet, set
    // one point below the measured value. They may only go up
    // (docs/development/coverage.md).
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "**/__tests__/**", "**/*.d.ts"],
      thresholds: {
        statements: 89,
        branches: 81,
        functions: 96,
        lines: 91,
      },
    },
  },
});
