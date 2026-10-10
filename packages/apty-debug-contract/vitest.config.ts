import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",
    silent: true,
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**"],
    // `npm run test:coverage`: package-wide thresholds are a ratchet, set
    // one point below the measured value; they may only go up
    // (docs/development/coverage.md). Redaction keeps its own stricter
    // gate: everything the model or a log viewer sees passes through it.
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
      thresholds: {
        statements: 83,
        branches: 77,
        functions: 92,
        lines: 86,
        "src/{redact,json-redact,contract}.ts": {
          statements: 88,
          branches: 82,
          functions: 93,
          lines: 92,
        },
      },
    },
  },
});
