import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",
    silent: true,
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**"],
    // `npm run test:coverage` gates redaction: everything the model or a
    // log viewer sees passes through it.
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      include: ["src/redact.ts", "src/json-redact.ts", "src/contract.ts"],
      thresholds: { statements: 88, branches: 82, functions: 93, lines: 92 },
    },
  },
});
