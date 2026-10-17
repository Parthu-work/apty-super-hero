import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",
    silent: true,
    environment: "jsdom",
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Coverage instrumentation slows the collector several times over, so
    // tests that hold it to its wall-clock budget relax it in that run; the
    // plain run (CI's Test step) still holds them to the real budget.
    env: {
      DOM_SNAPSHOT_INSTRUMENTED: process.argv.includes("--coverage") ? "1" : "",
    },
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
